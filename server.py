import os
import hashlib
import re
import json
import shutil
import requests
import httpx
import asyncio
import signal
import sys
from datetime import datetime
from fastapi import FastAPI, Request, HTTPException, Depends, status, WebSocket, WebSocketDisconnect, UploadFile, File
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, StreamingResponse
from typing import List, Optional, Union
from pydantic import BaseModel
from git import Repo
import base64
import time
from urllib.parse import quote

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

try:
    import psutil
except ImportError:
    psutil = None

# Voice input (push-to-talk transcription) is optional — faster-whisper pulls in
# ctranslate2 plus a model download, which is real weight for a self-hoster who just
# wants text chat. Not installed by default; /v1/transcribe reports itself as
# unavailable rather than failing the whole server if it's missing. See
# requirements-voice.txt.
try:
    from faster_whisper import WhisperModel
except ImportError:
    WhisperModel = None
_whisper_model = None

def get_whisper_model():
    global _whisper_model
    if WhisperModel is None:
        return None
    if _whisper_model is None:
        size = os.getenv("WHISPER_MODEL_SIZE", "base")
        _whisper_model = WhisperModel(size, device="cpu", compute_type="int8")
    return _whisper_model

import zipfile
from memory_manager import memory_manager
from device_auth import device_auth, PAIRING_CODE_TTL_SECONDS

app = FastAPI()
auth_scheme = HTTPBearer()

OLLAMA_URL = os.getenv("OLLAMA_URL", "http://localhost:11434")
CLOUD_API_URL = os.getenv("CLOUD_API_URL", "https://generativelanguage.googleapis.com")
_DEFAULT_API_TOKEN = "bmo-secret-key-2026"
# BMO_MASTER_TOKEN is the current name. VITE_BMO_API_KEY is still read so existing
# installs keep working, but it is deprecated and warned about on use: the VITE_ prefix
# invites people to reference it from frontend code, where Vite inlines it as plaintext
# into a bundle that server.py serves without auth. That is exactly how this token
# leaked before — see the note in src/utils/api.js. The name change is the fix that
# stops it happening again.
_legacy_token = os.getenv("VITE_BMO_API_KEY")
_raw_token = os.getenv("API_TOKEN") or os.getenv("BMO_MASTER_TOKEN") or _legacy_token
if not _raw_token:
    raise RuntimeError(
        "BMO_MASTER_TOKEN is not set. BMO refuses to start without an auth token — "
        "set one in .env before running the server. See .env.example."
    )
if _legacy_token and not (os.getenv("API_TOKEN") or os.getenv("BMO_MASTER_TOKEN")):
    print(
        "\n[DEPRECATED] Your token is set as VITE_BMO_API_KEY. Rename it to "
        "BMO_MASTER_TOKEN in .env.\n"
        "             Anything VITE_-prefixed risks being compiled into the client "
        "bundle in plaintext,\n"
        "             and this token can run shell commands. It still works for now.\n",
        flush=True,
    )
API_TOKEN = _raw_token
if API_TOKEN == _DEFAULT_API_TOKEN:
    # The default token is printed in this repo's source and in every README that
    # copies it. Combined with a non-localhost bind that's an unauthenticated shell
    # for anyone on the network, so refuse rather than warn. wake-bmo.sh exports
    # BMO_BIND_HOST; a bare uvicorn invocation won't, and localhost is the safe
    # assumption there.
    _bind = os.getenv("BMO_BIND_HOST", "127.0.0.1")
    _local = _bind in ("127.0.0.1", "localhost", "::1", "")
    if not _local:
        raise RuntimeError(
            f"Refusing to start: BMO is set to bind {_bind} (reachable from your network) "
            f"while still using the well-known default API token.\n"
            f"BMO can execute shell commands, so this would expose a shell to anyone who "
            f"can reach this machine.\n\n"
            f"Fix it by generating a real secret:\n"
            f"  python3 -c \"import secrets; print(secrets.token_urlsafe(32))\"\n"
            f"and setting it as BMO_MASTER_TOKEN in .env.\n"
            f"(Or set BMO_BIND_HOST=127.0.0.1 to stay on this machine only.)"
        )
    print("\n" + "=" * 70)
    print("  WARNING: BMO is using the well-known default API token.")
    print("  This value is public — anyone who has it can control BMO,")
    print("  including running shell commands on this machine.")
    print("  Binding is limited to localhost while this token is in use.")
    print("  Set a real secret in BMO_MASTER_TOKEN to go further.")
    print("=" * 70 + "\n")

# Once you've paired your devices, the shared token is the weakest link — it's one
# secret that every client holds and that gets baked into any APK you build. Set
# BMO_SHARED_TOKEN=off to require per-device pairing tokens instead. Kept ON by
# default so an existing install doesn't lock itself out on upgrade.
SHARED_TOKEN_ENABLED = os.getenv("BMO_SHARED_TOKEN", "on").lower() not in ("off", "false", "0", "no")
# No hardcoded default — an unset OLLAMA_MODEL just means get_available_model()
# auto-picks whatever chat-capable model is installed in Ollama (see below).
DEFAULT_MODEL = os.getenv("OLLAMA_MODEL", "")
AUTO_CHECKPOINT = os.getenv("AUTO_CHECKPOINT", "true").lower() not in ("false", "0", "no")
WORKSPACE_DIR = os.getenv("WORKSPACE_DIR") or os.path.dirname(os.path.abspath(__file__))
LOGS_DIR = os.path.join(WORKSPACE_DIR, "logs")
os.makedirs(LOGS_DIR, exist_ok=True)

SCRATCH_DIR = os.path.join(WORKSPACE_DIR, "scratch")
os.makedirs(SCRATCH_DIR, exist_ok=True)

# scratch/ is BMO's own upload cache — full-resolution phone photos with no cap or
# cleanup is literally how it reached 44MB in the original private repo. Default 200MB,
# override with SCRATCH_MAX_MB. Enforced by evicting the OLDEST files first (by mtime),
# same policy as a simple LRU cache.
SCRATCH_MAX_BYTES = int(os.getenv("SCRATCH_MAX_MB", "200")) * 1024 * 1024

def enforce_scratch_cap():
    """Evicts the oldest files in SCRATCH_DIR until it's back under SCRATCH_MAX_BYTES."""
    try:
        entries = []
        total = 0
        for f in os.listdir(SCRATCH_DIR):
            fp = os.path.join(SCRATCH_DIR, f)
            if os.path.isfile(fp):
                st = os.stat(fp)
                entries.append((st.st_mtime, st.st_size, fp))
                total += st.st_size
        if total <= SCRATCH_MAX_BYTES:
            return
        entries.sort(key=lambda e: e[0])
        for _mtime, size, fp in entries:
            if total <= SCRATCH_MAX_BYTES:
                break
            try:
                os.remove(fp)
                total -= size
            except OSError:
                pass
    except Exception as e:
        print("Error enforcing scratch/ cap:", e)

def save_payload_media_to_scratch(messages):
    """Scan incoming user messages for base64 image_url or attached files and cache to scratch/."""
    for m in messages:
        if isinstance(m, dict) and m.get("role") == "user":
            content = m.get("content")
            if isinstance(content, list):
                for item in content:
                    if isinstance(item, dict) and item.get("type") == "image_url":
                        url = item.get("image_url", {}).get("url", "")
                        if url.startswith("data:image/"):
                            try:
                                header, encoded = url.split(",", 1)
                                ext = header.split(";")[0].split("/")[1] or "png"
                                filename = f"scratch_img_{int(time.time())}.{ext}"
                                filepath = os.path.join(SCRATCH_DIR, filename)
                                with open(filepath, "wb") as f:
                                    f.write(base64.b64decode(encoded))
                                print(f"📸 Image cached to scratch: {filepath}")
                                enforce_scratch_cap()
                            except Exception as e:
                                print("Error caching image to scratch:", e)

class WorkspaceFile(BaseModel):
    content: str

class AgentExecutor:
    def __init__(self):
        self.active_process = None
        self.pending_command = None
        self.approval_future = None
        self.current_task = "IDLE"
        self.repo = None
        try:
            repo_path = os.getcwd()
            self.repo = Repo(repo_path)
        except Exception:
            pass

    async def checkpoint(self):
        if not AUTO_CHECKPOINT:
            return False
        if self.repo:
            try:
                self.repo.git.add(A=True)
                if self.repo.is_dirty():
                    self.repo.index.commit("Auto-checkpoint before execution")
                return True
            except Exception:
                return False
        return False

    async def run_command(self, cmd: str, broadcast_fn, wait_for_approval=False):
        self.current_task = f"RUNNING: {cmd[:20]}"
        if wait_for_approval:
            self.pending_command = cmd
            await broadcast_fn(json.dumps({"tool": "sentinel", "status": "pending", "pending_approval": True, "diff": f"COMMAND: {cmd}"}))
            return

        await self.checkpoint()
        await broadcast_fn(f"\u001b[33m[EXECUTING] {cmd}\u001b[0m")
        try:
            self.active_process = await asyncio.create_subprocess_shell(cmd, cwd=WORKSPACE_DIR, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
            async def stream(pipe, prefix):
                while True:
                    line = await pipe.readline()
                    if not line: break
                    await broadcast_fn(f"{prefix} {line.decode().strip()}")
            await asyncio.gather(stream(self.active_process.stdout, ""), stream(self.active_process.stderr, "\u001b[31m[ERR]\u001b[0m"))
            await self.active_process.wait()
        finally:
            self.active_process = None
            self.pending_command = None
            self.current_task = "IDLE"

    async def run_command_output(self, cmd: str, broadcast_fn):
        self.current_task = f"RUNNING: {cmd[:20]}"
        await self.checkpoint()
        await broadcast_fn(f"\u001b[33m[EXECUTING] {cmd}\u001b[0m")
        output_lines = []
        try:
            self.active_process = await asyncio.create_subprocess_shell(cmd, cwd=WORKSPACE_DIR, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
            async def stream(pipe, prefix):
                while True:
                    line = await pipe.readline()
                    if not line: break
                    decoded = line.decode().strip()
                    output_lines.append(decoded)
                    await broadcast_fn(f"{prefix} {decoded}")
            await asyncio.gather(stream(self.active_process.stdout, ""), stream(self.active_process.stderr, "\u001b[31m[ERR]\u001b[0m"))
            await self.active_process.wait()
            return "\n".join(output_lines)
        except Exception as e:
            return f"Error executing command: {e}"
        finally:
            self.active_process = None
            self.pending_command = None
            self.current_task = "IDLE"

    async def run_command_gated(self, cmd: str, broadcast_fn, require_approval: bool, timeout_s: int = 120):
        """Like run_command_output, but when require_approval is set, blocks until
        /v1/approve or /v1/reject resolves the pending command (or it times out)."""
        if not require_approval:
            return await self.run_command_output(cmd, broadcast_fn)

        self.current_task = f"AWAITING APPROVAL: {cmd[:20]}"
        self.pending_command = cmd
        loop = asyncio.get_running_loop()
        self.approval_future = loop.create_future()
        await broadcast_fn(json.dumps({"tool": "sentinel", "status": "pending", "pending_approval": True, "diff": f"COMMAND: {cmd}"}))
        try:
            approved = await asyncio.wait_for(self.approval_future, timeout=timeout_s)
        except asyncio.TimeoutError:
            approved = False
            await broadcast_fn(f"[31m[SENTINEL] Approval timed out after {timeout_s}s — command auto-rejected.[0m")
        finally:
            self.pending_command = None
            self.approval_future = None
            await broadcast_fn(json.dumps({"tool": "sentinel", "status": "cleared"}))

        if not approved:
            return f"Command rejected: '{cmd}' was not approved by the user."
        return await self.run_command_output(cmd, broadcast_fn)

    def kill(self):
        if self.active_process:
            try: self.active_process.kill()
            except: pass
        return True

executor = AgentExecutor()

# Guardian Protocol: when enabled, BMO's run_command tool pauses for user
# approval (via /v1/approve or /v1/reject) instead of executing immediately.
# Mirrors the frontend's Settings > Guardian Protocol toggle (bmo_safety_stride).
runtime_state = {
    "safety_stride": True,
    "is_dreaming": False,
    # How far BMO may go when it decides a thought needs a bigger brain than the local
    # model. "ask" is the default on purpose: escalating sends your recent conversation
    # to Google and costs money, so it should be a decision, not a default.
    #   off  — never leave the device
    #   ask  — BMO surfaces the request and waits for you
    #   auto — escalate freely, up to the daily budget below
    "escalation_mode": os.getenv("BMO_ESCALATION_MODE", "ask"),
    "escalation_budget": int(os.getenv("BMO_ESCALATION_BUDGET", "20")),  # per day
    # How much BMO may speak on its own after learning something.
    #   off  — learn silently
    #   note — may leave one short note about what it learned
    #   full — may also ask questions / suggest next steps
    "proactive_mode": os.getenv("BMO_PROACTIVE_MODE", "note"),
    # How many learned facts get injected into every prompt. Each is only ~30 tokens —
    # SOUL.md alone costs ~960, so this is a much smaller context lever than it looks.
    # The real risk of a high number isn't size, it's dilution: stale facts crowding out
    # useful ones, which is what consolidation is for.
    "memory_facts": int(os.getenv("BMO_MEMORY_FACTS", "20")),
}

# Where the settings above are persisted. They used to live only in memory, so every
# restart silently reverted whatever the user had chosen in the UI back to these defaults.
# That's an annoyance for most of them and a privacy failure for one: a user who sets
# escalation to "off" would have it quietly restored to "ask" by a reboot, and BMO would
# resume offering to send their conversation to the cloud. "off" has to survive a restart
# to mean anything.
STATE_FILE = os.getenv("BMO_STATE_FILE", "runtime_state.json")
PERSISTED_KEYS = ("escalation_mode", "escalation_budget", "proactive_mode", "memory_facts")

def save_runtime_state():
    """Best-effort persist. A read-only disk shouldn't take BMO down over a setting."""
    try:
        data = {k: runtime_state[k] for k in PERSISTED_KEYS}
        # The day's escalation tally rides along. Persisting the budget without the
        # counter would leave the cap trivially defeated: "10 per day" resets to 0 on
        # every restart, so a crash loop or a few reboots buys unlimited cloud calls
        # against the user's quota and privacy. A limit you can reset by restarting is
        # not a limit. The date is stored with it so a genuinely new day still clears.
        data["escalation_log"] = escalation_log
        tmp = STATE_FILE + ".tmp"
        with open(tmp, "w") as f:
            json.dump(data, f, indent=2)
        os.replace(tmp, STATE_FILE)   # atomic, so a crash mid-write can't truncate it
    except Exception as e:
        print(f"[STATE] could not save settings: {e}", flush=True)

def load_runtime_state():
    """Overlay saved settings onto the env defaults, validating as we go.

    A hand-edited or truncated file must not be able to widen permissions, so anything
    that doesn't parse is ignored and the safer env default stands.
    """
    if not os.path.exists(STATE_FILE):
        return
    try:
        with open(STATE_FILE) as f:
            saved = json.load(f)
    except Exception as e:
        print(f"[STATE] ignoring unreadable {STATE_FILE}: {e}", flush=True)
        return
    if saved.get("escalation_mode") in ("off", "ask", "auto"):
        runtime_state["escalation_mode"] = saved["escalation_mode"]
    if saved.get("proactive_mode") in ("off", "note", "full"):
        runtime_state["proactive_mode"] = saved["proactive_mode"]
    for key, lo, hi in (("escalation_budget", 0, 1000), ("memory_facts", 0, 500)):
        val = saved.get(key)
        if isinstance(val, int) and not isinstance(val, bool) and lo <= val <= hi:
            runtime_state[key] = val
    log = saved.get("escalation_log")
    if isinstance(log, dict) and isinstance(log.get("used"), int) and log["used"] >= 0:
        escalation_log.update({
            "date": log.get("date"),
            "used": log["used"],
            "entries": log.get("entries") or [],
            # Deliberately not restored: a pending "may I escalate?" is a question that
            # was asked of a user who is no longer at the same session. Re-raising it on
            # boot would let a stale prompt collect an approval it was never shown for.
            "pending": None,
        })

# Escalation accounting — reset daily, exposed so the UI can show what's left.
escalation_log = {"date": None, "used": 0, "entries": [], "pending": None}

load_runtime_state()

# Notes BMO wants to volunteer. Queued rather than injected into the chat: the client
# decides when (and whether) to surface them, so BMO can't interrupt mid-conversation.
proactive_queue = []

def _escalation_today():
    today = datetime.now().strftime("%Y-%m-%d")
    if escalation_log["date"] != today:
        escalation_log.update({"date": today, "used": 0, "entries": []})
    return escalation_log

def escalation_allowed():
    """(allowed, reason). 'ask' returns False here — the caller surfaces a request
    instead, so a pending ask never silently becomes a send."""
    log = _escalation_today()
    mode = runtime_state["escalation_mode"]
    if mode == "off":
        return False, "escalation disabled"
    if log["used"] >= runtime_state["escalation_budget"]:
        return False, f"daily budget spent ({log['used']}/{runtime_state['escalation_budget']})"
    if mode == "ask":
        return False, "needs your approval"
    return True, "auto"

def record_escalation(reason: str, chars_sent: int):
    log = _escalation_today()
    log["used"] += 1
    log["entries"].append({
        "at": datetime.now().strftime("%H:%M:%S"),
        "reason": reason[:120],
        "chars_sent": chars_sent,
    })
    log["entries"] = log["entries"][-25:]
    save_runtime_state()   # the tally has to hit disk here, or a restart refunds it

class ConnectionManager:
    def __init__(self): self.active_connections: List[WebSocket] = []
    async def connect(self, ws: WebSocket): await ws.accept(); self.active_connections.append(ws)
    def disconnect(self, ws: WebSocket): 
        if ws in self.active_connections: self.active_connections.remove(ws)
    async def broadcast(self, msg: str):
        for c in self.active_connections:
            try: await c.send_text(msg)
            except: pass

manager = ConnectionManager()
telemetry_buffer = []

def write_hourly_log(msg: str):
    """Write telemetry message to hourly rotating log file."""
    try:
        clean_msg = re.sub(r'\x1b\[[0-9;]*m', '', msg)
        hour_str = datetime.now().strftime("%Y-%m-%d_%H")
        log_file = os.path.join(LOGS_DIR, f"bmo_telemetry_{hour_str}.log")
        with open(log_file, "a", encoding="utf-8") as f:
            f.write(f"[{datetime.now().strftime('%H:%M:%S')}] {clean_msg}\n")
    except Exception:
        pass

async def broadcast_to_managers(msg: str):
    telemetry_buffer.append(msg)
    if len(telemetry_buffer) > 1000: telemetry_buffer.pop(0)
    write_hourly_log(msg)
    await manager.broadcast(msg)

def get_available_model():
    try:
        res = requests.get(f"{OLLAMA_URL}/api/tags", timeout=3)
        if res.ok:
            models = [m["name"] for m in res.json().get("models", [])]
            # Exclude moondream and vision-only models from primary LLM selection
            chat_models = [m for m in models if "moondream" not in m and "llava" not in m]
            if chat_models:
                if DEFAULT_MODEL:
                    for cm in chat_models:
                        if DEFAULT_MODEL in cm:
                            return cm
                return chat_models[0]
            elif models:
                return models[0]
    except Exception:
        pass
    return DEFAULT_MODEL

# --- WATCHDOG ---
failure_count = 0
async def watchdog():
    global failure_count
    while True:
        await asyncio.sleep(30)
        try:
            res = requests.get(f"{OLLAMA_URL}/api/tags", timeout=3)
            if res.ok: failure_count = 0
            else: failure_count += 1
        except Exception: failure_count += 1

        if failure_count >= 3:
            await broadcast_to_managers("\u001b[31m[WATCHDOG] Local Ollama brain unresponsive. Retrying...\u001b[0m")
            failure_count = 0

# GEMINI_API_KEY is the supported name. The VITE_ fallback exists only so an existing
# .env keeps working across the upgrade that moved the cloud brain server-side — it is
# not a second way to configure this, and check_setup.py warns when it's still in use.
# Reading it here is safe: the server never sends it anywhere near the client.
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY") or os.getenv("VITE_GEMINI_API_KEY")
# The "gemini-flash-latest" alias resolves to a model with its own (easily exhausted)
# quota pool — it returned 429 while pinned versions on the same key returned 200.
# Pin a real version and let it be overridden.
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-3.7-flash")

WIKI_UA = {"User-Agent": "BMO/1.0 (self-hosted AI companion; https://github.com/Theofiledes/more)"}
# Optional real web search. DuckDuckGo's free Instant Answer API only knows well-known
# entities — it returns nothing for most practical queries — so a key here is what makes
# general web search actually work. Brave's free tier is ~2k queries/month.
BRAVE_SEARCH_API_KEY = os.getenv("BRAVE_SEARCH_API_KEY", "")

async def wikipedia_lookup(query: str, sentences: int = 3):
    """Search Wikipedia, then summarise the best-matching article.

    Two calls rather than one: the REST summary endpoint needs an exact title and 404s
    on anything else, so a plain query like "python asyncio" has to be resolved to a
    real article first."""
    if not query.strip():
        return None
    try:
        async with httpx.AsyncClient(timeout=15.0, headers=WIKI_UA, follow_redirects=True) as client:
            r = await client.get("https://en.wikipedia.org/w/api.php", params={
                "action": "query", "list": "search", "srsearch": query,
                "format": "json", "srlimit": 1,
            })
            if not r.is_success:
                return None
            hits = r.json().get("query", {}).get("search", [])
            if not hits:
                return None
            title = hits[0]["title"]
            r2 = await client.get(
                f"https://en.wikipedia.org/api/rest_v1/page/summary/{quote(title.replace(' ', '_'))}")
            if not r2.is_success:
                return None
            d = r2.json()
            extract = " ".join((d.get("extract") or "").split(". ")[:sentences]).strip()
            if extract and not extract.endswith("."):
                extract += "."
            return {
                "title": d.get("title", title),
                "extract": extract or d.get("description", ""),
                "url": d.get("content_urls", {}).get("desktop", {}).get("page", ""),
            }
    except Exception as e:
        print(f"[WIKI] lookup failed: {e}", flush=True)
        return None

async def brave_search(query: str, count: int = 4):
    """Real web results, if a key is configured."""
    if not BRAVE_SEARCH_API_KEY:
        return None
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            r = await client.get("https://api.search.brave.com/res/v1/web/search",
                                 params={"q": query, "count": count},
                                 headers={"Accept": "application/json",
                                          "X-Subscription-Token": BRAVE_SEARCH_API_KEY})
        if not r.is_success:
            print(f"[SEARCH] Brave HTTP {r.status_code}", flush=True)
            return None
        results = r.json().get("web", {}).get("results", [])
        return [{"title": x.get("title", ""),
                 "snippet": re.sub(r"<[^>]+>", "", x.get("description", "")),
                 "url": x.get("url", "")} for x in results[:count]] or None
    except Exception as e:
        print(f"[SEARCH] Brave failed: {e}", flush=True)
        return None

async def duckduckgo_instant(query: str):
    """DDG's free instant-answer. Good for well-known entities, empty for most else."""
    try:
        async with httpx.AsyncClient(timeout=12.0, follow_redirects=True) as client:
            r = await client.get("https://api.duckduckgo.com/", params={
                "q": query, "format": "json", "no_html": 1, "skip_disambig": 1})
        if not r.is_success:
            return None
        d = r.json()
        if d.get("AbstractText"):
            return {"summary": d["AbstractText"], "url": d.get("AbstractURL", "")}
        # Related topics often carry a usable one-liner when the abstract is empty.
        for t in d.get("RelatedTopics", []):
            if isinstance(t, dict) and t.get("Text"):
                return {"summary": t["Text"], "url": t.get("FirstURL", "")}
        return None
    except Exception as e:
        print(f"[SEARCH] DDG failed: {e}", flush=True)
        return None

# The Adventure Time fan wiki knows the show far better than Wikipedia does — every
# character, episode and bit of lore in Ooo. It's a MediaWiki too, but Fandom doesn't
# offer Wikipedia's plain-text summaries (no TextExtracts, and its REST API sits behind
# a Cloudflare challenge), so this reads the article's intro as wikitext and strips it.
FANDOM_AT_API = "https://adventuretime.fandom.com/api.php"

def clean_wikitext(text: str) -> str:
    for _ in range(6):  # templates and tables nest; peel innermost first until stable
        stripped = re.sub(r"\{\{[^{}]*\}\}", "", text)
        stripped = re.sub(r"\{\|[^{}]*?\|\}", "", stripped, flags=re.S)
        if stripped == text:
            break
        text = stripped
    text = re.sub(r"<ref[^>]*/>|<ref[^>]*>.*?</ref>", "", text, flags=re.S)
    text = re.sub(r"\[\[(?:File|Image|Category):[^\]]*\]\]", "", text, flags=re.I)
    text = re.sub(r"\[\[[a-z]{2,3}(?:-[a-z]+)?:[^\]]*\]\]", "", text)  # interlanguage links
    text = re.sub(r"\[\[(?:[^\]|]*\|)?([^\]]*)\]\]", r"\1", text)
    text = re.sub(r"\[https?://\S+ ([^\]]*)\]", r"\1", text)
    text = re.sub(r"<[^>]+>|'{2,}|__\w+__", "", text)
    text = re.sub(r"^[=*#:;].*$", "", text, flags=re.M)
    return re.sub(r"\s+", " ", text).strip()

async def adventure_time_wiki_lookup(query: str, sentences: int = 4):
    """Best-matching Adventure Time wiki article, as {"title", "extract", "url"}, or None."""
    if not query.strip():
        return None
    try:
        async with httpx.AsyncClient(timeout=15.0, headers=WIKI_UA, follow_redirects=True) as client:
            # An exact title (or a redirect to one) beats search, whose ranking put
            # "Bonnibel Bubblegum (Vampire World)" above "Princess Bubblegum".
            r = await client.get(FANDOM_AT_API, params={
                "action": "query", "titles": query.strip().title(), "redirects": 1, "format": "json"})
            page = next(iter(r.json().get("query", {}).get("pages", {}).values()), {}) if r.is_success else {}
            title = page.get("title") if page.get("pageid") and "missing" not in page else None
            if not title or "(disambiguation)" in title:
                r = await client.get(FANDOM_AT_API, params={
                    "action": "query", "list": "search", "srsearch": query, "srlimit": 6, "format": "json"})
                hits = [h["title"] for h in r.json().get("query", {}).get("search", [])
                        if "(disambiguation)" not in h["title"]] if r.is_success else []
                if not hits:
                    return None
                # Search ranking is poor, so only trust hits whose base title (minus any
                # "(...)") actually appears in the question, and among those prefer the
                # plain or "(character)" page. The wiki splits "The Lich" into episode /
                # character / alt-world variants; "Ice King real name" must not land on
                # "The Winter King (character)" just because it is a character page.
                ql = query.strip().lower()
                base = lambda h: re.sub(r"\s*\([^)]*\)$", "", h).lower()
                named = [h for h in hits if base(h) in ql]
                title = (next((h for h in named if base(h) == ql and "(" not in h), None)
                         or next((h for h in named if "(" not in h or h.endswith("(character)")), None)
                         or (named or hits)[0])
            r = await client.get(FANDOM_AT_API, params={
                "action": "parse", "page": title, "prop": "wikitext", "section": 0,
                "redirects": 1, "format": "json"})
            if not r.is_success:
                return None
            text = clean_wikitext(r.json().get("parse", {}).get("wikitext", {}).get("*", ""))
            extract = " ".join(re.split(r"(?<=[.!?])\s+", text)[:sentences])[:900].strip()
            if not extract:
                return None
            return {"title": title, "extract": extract,
                    "url": f"https://adventuretime.fandom.com/wiki/{quote(title.replace(' ', '_'))}"}
    except Exception as e:
        print(f"[AT WIKI] lookup failed: {e}", flush=True)
        return None

async def perform_web_search(query: str):
    """Best available answer, trying sources in order of usefulness.

    Returns a plain string for the model. Says plainly when nothing was found rather
    than returning an empty result the model will paper over with invention."""
    if not query.strip():
        return "No search query given."

    brave = await brave_search(query)
    if brave:
        lines = [f"{i+1}. {b['title']}\n   {b['snippet'][:220]}\n   {b['url']}"
                 for i, b in enumerate(brave)]
        return "Web results for '" + query + "':\n" + "\n".join(lines)

    ddg = await duckduckgo_instant(query)
    wiki = await wikipedia_lookup(query)
    parts = []
    if ddg:
        parts.append(f"{ddg['summary']}" + (f" ({ddg['url']})" if ddg['url'] else ""))
    if wiki and wiki["extract"]:
        parts.append(f"Wikipedia — {wiki['title']}: {wiki['extract']}" +
                     (f" ({wiki['url']})" if wiki["url"] else ""))
    if parts:
        return "\n\n".join(parts)
    return (f"No results found for '{query}'. Say so plainly — do not guess an answer. "
            f"(For general web search, set BRAVE_SEARCH_API_KEY in .env.)")

async def triage_is_notable(text_sample: str):
    """Cheap local pass: is there anything here worth remembering at all?

    This is what makes escalation affordable and private. Most lulls contain nothing
    notable, and deciding that should cost nothing and never leave the device — only a
    "yes" earns a bigger brain. Returns (notable: bool, reason: str)."""
    if not text_sample.strip():
        return False, "nothing happened"
    prompt = (
        "You are a triage filter. Below is recent activity from a user's AI companion.\n"
        "Decide if it contains anything genuinely worth remembering long-term about the "
        "user or their project — a preference, a decision, a milestone, a recurring topic.\n"
        "Small talk, greetings and one-off questions are NOT notable.\n"
        'Reply with ONLY JSON: {"notable": true|false, "reason": "<8 words max>"}\n\n'
        f"{text_sample[:1500]}"
    )
    try:
        async with httpx.AsyncClient(timeout=90.0) as client:
            r = await client.post(f"{OLLAMA_URL}/v1/chat/completions", json={
                "model": get_available_model(),
                "messages": [{"role": "user", "content": prompt}],
                "temperature": 0.0, "max_tokens": 60,
                # Constrained decoding — the sampler cannot emit a shape other than this,
                # which is what makes a small model dependable as a router.
                "response_format": {"type": "json_object"},
            })
        if r.is_success:
            raw = r.json().get("choices", [{}])[0].get("message", {}).get("content", "")
            m = re.search(r'\{.*\}', raw, re.S)
            if m:
                d = json.loads(m.group(0))
                return bool(d.get("notable")), str(d.get("reason", ""))[:120]
    except Exception as e:
        print(f"[TRIAGE] failed, assuming notable: {e}", flush=True)
    # Fail open: a broken filter should not silently stop BMO from ever learning.
    return True, "triage unavailable"

MEMORY_CONSOLIDATE_AT = int(os.getenv("BMO_MEMORY_CONSOLIDATE_AT", "40"))

BULLET_PREFIX_RE = re.compile(r'^\s*(?:[-*•‣●]|\d+[.)])\s*')

def tidy_summary(text: str) -> str:
    """Flatten a model's markdown answer into one plain line.

    Small models answer "summarise this" as a bullet list no matter how the prompt is
    worded, so a dream summary arrived as "* Yay! BMO checked...". That leading marker got
    stored verbatim as a memory fact and shown as a chat message, where a stray asterisk
    just reads as a bug. Strip the markers rather than fight the prompt.
    """
    lines = [BULLET_PREFIX_RE.sub('', ln).strip() for ln in (text or '').splitlines()]
    lines = [ln for ln in lines if ln]
    # Multi-bullet answers collapse to one line; a semicolon reads better than a dropped
    # newline once this is inlined into a single memory fact.
    return '; '.join(lines)

async def consolidate_memory(force: bool = False):
    """Merge accumulated facts into fewer, denser ones.

    Raising the injected-fact count fixes recall but not quality: append-only learning
    produces near-duplicates (the same observation restated five times) that
    crowd out everything else. Consolidation is what turns accumulation into growth.

    Prefers the cloud — merging dozens of facts without losing information is a real
    reasoning task, and a 3B model tends to drop things or invent connections. Falls
    back to local. Archives the old set either way, so a bad merge is reversible."""
    facts = memory_manager.all_facts()
    if not facts:
        return {"status": "nothing_to_do", "before": 0}
    if len(facts) < MEMORY_CONSOLIDATE_AT and not force:
        return {"status": "below_threshold", "before": len(facts),
                "threshold": MEMORY_CONSOLIDATE_AT}

    numbered = "\n".join(f"{i+1}. {f['content']}" for i, f in enumerate(facts))
    target = max(8, min(20, len(facts) // 4))
    prompt = (
        "You are consolidating an AI companion's long-term memory about its user.\n"
        f"Below are {len(facts)} accumulated notes. Many are near-duplicates.\n\n"
        f"Merge them into AT MOST {target} durable facts. Rules:\n"
        "- Combine repeated observations into one richer fact.\n"
        "- Keep concrete specifics: names, places, preferences, projects, decisions.\n"
        "- Drop pure chatter and anything about the weather on a particular day.\n"
        "- Do NOT invent anything that isn't in the notes.\n"
        "- Each fact is one short line, no numbering, no bullets.\n"
        "- Reply with ONLY the facts, one per line.\n\n"
        f"{numbered[:6000]}"
    )

    merged_text, source = "", None
    allowed, _ = escalation_allowed()
    # force lets a manual request escalate even in "ask" mode — the user asked for it.
    # It must NOT override "off", though: off means nothing leaves the device, and a
    # convenience flag quietly breaking that promise would be the worst kind of bug.
    may_escalate = allowed or (force and runtime_state["escalation_mode"] != "off")
    if GEMINI_API_KEY and may_escalate:
        try:
            record_escalation("memory consolidation", len(prompt))
            url = f"https://generativelanguage.googleapis.com/v1beta/models/{GEMINI_MODEL}:generateContent?key={GEMINI_API_KEY}"
            async with httpx.AsyncClient(timeout=90.0) as client:
                r = await client.post(url, json={"contents": [{"parts": [{"text": prompt}]}]})
            if r.is_success:
                parts = (r.json().get("candidates") or [{}])[0].get("content", {}).get("parts", [])
                merged_text = " ".join(p.get("text", "") for p in parts if p.get("text")).strip()
                source = "gemini"
            else:
                print(f"[CONSOLIDATE] Gemini HTTP {r.status_code}", flush=True)
        except Exception as e:
            print(f"[CONSOLIDATE] Gemini failed: {e}", flush=True)

    if not merged_text:
        try:
            async with httpx.AsyncClient(timeout=180.0) as client:
                r = await client.post(f"{OLLAMA_URL}/v1/chat/completions", json={
                    "model": get_available_model(),
                    "messages": [{"role": "user", "content": prompt}],
                    "temperature": 0.0, "max_tokens": 900,
                })
            if r.is_success:
                merged_text = r.json().get("choices", [{}])[0].get("message", {}).get("content", "").strip()
                source = "local"
        except Exception as e:
            print(f"[CONSOLIDATE] local failed: {e}", flush=True)

    merged = []
    for line in merged_text.splitlines():
        line = BULLET_PREFIX_RE.sub('', line).strip()
        if len(line) > 8:
            merged.append(line[:300])
    merged = merged[:target]

    # Guardrails: a merge that collapses everything into a couple of lines, or that
    # somehow produced more than we started with, is a failure — not an improvement.
    if len(merged) < 3 or len(merged) >= len(facts):
        return {"status": "rejected", "before": len(facts), "produced": len(merged),
                "reason": "implausible merge, memory left untouched", "source": source}

    batch = datetime.now().strftime("%Y%m%d-%H%M%S")
    archived, inserted = memory_manager.replace_facts(merged, batch_label=batch)
    memory_manager.save_workspace_file(
        "MEMORY.md",
        "\n\n## Consolidated " + batch + "\n" + "\n".join(f"- {m}" for m in merged),
        append=True)
    await broadcast_to_managers(
        f"\u001b[32m[MEMORY] Consolidated {archived} facts into {inserted} ({source}).\u001b[0m")
    return {"status": "ok", "before": archived, "after": inserted,
            "source": source, "batch": batch, "facts": merged}

async def perform_dream_synthesis(force: bool = False, approved: bool = False):
    text_sample = ""
    if os.path.exists("history.json"):
        try:
            with open("history.json", "r") as f:
                hist = json.load(f)
            msgs = hist.get("messages", [])
            if msgs:
                text_sample = "\n".join([f"{m.get('sender', 'user')}: {m.get('text', '')}" for m in msgs[-15:] if m.get('text')])
        except Exception:
            pass

    # Fallback to scratch files & git activity if chat history is sparse. This has to run
    # before the fingerprint below: otherwise the git path is dedup'd against a hash of the
    # empty history sample, which describes text that was never summarized and never
    # changes — so an unchanged git log would be re-dreamed every idle cycle forever.
    if not text_sample:
        try:
            # cwd=WORKSPACE_DIR, not the process cwd: WORKSPACE_DIR exists so server.py can
            # run from outside the repo, and without this the fallback shelled out wherever
            # uvicorn happened to start. Off-root that prints "fatal: not a git repository"
            # to the log and leaves a bare "Recent Git Commits:" header as the sample —
            # non-empty, so it fingerprints and triages as unremarkable, and the fallback
            # silently never works again.
            proc = await asyncio.create_subprocess_shell(
                "git log -n 5 --oneline", cwd=WORKSPACE_DIR,
                stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL)
            out, _ = await proc.communicate()
            commits = out.decode().strip()
            # An empty result means no commits or no repo — say nothing rather than hand the
            # model a header with nothing under it.
            text_sample = f"Recent Git Commits:\n{commits}" if commits else ""
        except Exception:
            text_sample = "BMO app initialized with local vision, scratch storage, and full terminal control."

    # Nothing to think about at all — no history and no commits. Bail before triage rather
    # than paying a model call to be told that empty text is unremarkable.
    if not text_sample.strip():
        dream_state["last_outcome"] = "quiet"
        return None

    # The sample is always "the last 15 messages", so once a conversation stops changing
    # every subsequent dream re-summarizes the identical text. That burned a model call
    # every idle cycle to re-derive a memory BMO already had — and when one of those 15
    # messages was wrong, it regenerated the same false claim indefinitely, faster than
    # it could be cleaned up. Dedup catches the duplicate afterwards; this avoids doing
    # the work at all. A manual "dream now" still runs: the user asked for it.
    #
    # The fingerprint is committed only once a pass actually finishes (see below), never
    # here. Committing it up front meant a dream cancelled by note_user_activity() — which
    # happens by design the moment the user comes back — still marked its transcript as
    # dreamed and retired it permanently: every later cycle matched the hash and stayed
    # quiet forever. Same for a model timeout. last_outcome records what really happened so
    # run_dream can tell "skipped" from "failed" instead of guessing from the hash.
    dream_state["last_outcome"] = "failed"
    sample_hash = hashlib.sha256(text_sample.encode("utf-8", "replace")).hexdigest()
    if not force and sample_hash == dream_state.get("last_sample_hash"):
        dream_state["last_outcome"] = "skipped"
        await broadcast_to_managers(
            "[90m[DREAM SYNTHESIS] Nothing new to think about since the last dream.[0m")
        return None

    prompt = f"You are BMO's Dream Synthesizer. Summarize key user preferences, milestones, or important project facts from this context into 1 concise bullet point in BMO voice (max 25 words):\n\n{text_sample[:1500]}"

    # Triage first — most lulls are not worth a memory, and deciding that locally is
    # free and private. Only a "yes" is allowed to reach the cloud.
    notable, triage_reason = await triage_is_notable(text_sample)
    dream_state["last_triage"] = {"notable": notable, "reason": triage_reason}
    if not notable:
        # triage_is_notable fails open, so a "no" is a real verdict from a working model
        # rather than an outage. The pass finished; fingerprint the sample so later cycles
        # don't pay to re-triage identical text.
        dream_state["last_sample_hash"] = sample_hash
        dream_state["last_outcome"] = "quiet"
        await broadcast_to_managers(f"\u001b[36m[DREAM] Nothing notable ({triage_reason}) - staying quiet.\u001b[0m")
        return None

    summary = ""
    # 1. Escalate to the cloud only if the gate allows. "ask" deliberately does NOT send:
    #    it records a pending request for the UI and falls through to the local model.
    allowed, gate_reason = escalation_allowed()
    if approved and not allowed:
        # You pressed Approve for this exact thought, which outranks the gate — including
        # a spent daily budget. Falling back to the local model here would make the button
        # a lie: the request would be "granted" and still never reach the cloud. Going over
        # the limit is your call to make, so say so loudly rather than refusing quietly.
        log = _escalation_today()
        if log["used"] >= runtime_state["escalation_budget"]:
            await broadcast_to_managers(
                f"\u001b[33m[DREAM] Approved past today's limit "
                f"({log['used']}/{runtime_state['escalation_budget']}) - spending anyway.\u001b[0m")
        allowed, gate_reason = True, "approved by you"
    if GEMINI_API_KEY and not allowed and runtime_state["escalation_mode"] == "ask":
        # over_budget travels with the request so the panel can warn *before* you approve.
        # The gate closes on budget before it closes on mode, so a request raised while the
        # limit is spent looks identical to any other one — and approving it now really
        # does overspend.
        log = _escalation_today()
        escalation_log["pending"] = {
            "at": datetime.now().strftime("%H:%M:%S"),
            "reason": triage_reason,
            "chars": len(text_sample[:1500]),
            "over_budget": log["used"] >= runtime_state["escalation_budget"],
        }
        await broadcast_to_managers(
            f"\u001b[33m[DREAM] Wants cloud help ({triage_reason}) - awaiting approval.\u001b[0m")
    if GEMINI_API_KEY and allowed:
        try:
            record_escalation(triage_reason, len(prompt))
            await broadcast_to_managers("\u001b[35m[DREAM SYNTHESIS] Calling Gemini Cloud API for deep dream distillation...\u001b[0m")
            url = f"https://generativelanguage.googleapis.com/v1beta/models/{GEMINI_MODEL}:generateContent?key={GEMINI_API_KEY}"
            g_payload = {
                "contents": [{"parts": [{"text": prompt}]}]
            }
            res = requests.post(url, json=g_payload, timeout=20)
            if res.ok:
                # Thinking-capable Gemini models return the reasoning as its own part with
                # no "text", so parts[0] can legitimately be empty — join every part that
                # actually carries text instead of assuming the answer is first.
                parts = (res.json().get("candidates") or [{}])[0].get("content", {}).get("parts", [])
                summary = " ".join(p.get("text", "") for p in parts if p.get("text")).strip()
            else:
                # A 429 (free-tier rate limit) or 403 is not an exception, so without this
                # the failure was completely silent and the local fallback looked like a
                # mystery slowdown.
                detail = ""
                try:
                    detail = res.json().get("error", {}).get("message", "")[:200]
                except Exception:
                    detail = res.text[:200]
                msg = f"Gemini dream synthesis HTTP {res.status_code}: {detail}"
                print(msg, flush=True)
                await broadcast_to_managers(f"[33m[DREAM SYNTHESIS] {msg} — falling back to local model.[0m")
        except Exception as e:
            print("Gemini Dream Synthesis failed, falling back to local model:", e, flush=True)

    # 2. Fallback to Local Ollama Model if Gemini is unavailable
    if not summary:
        try:
            model = get_available_model()
            await broadcast_to_managers(f"\u001b[35m[DREAM SYNTHESIS] Using local model '{model}' for memory distillation...\u001b[0m")
            # 30s was too tight: a 9B model on CPU takes ~22s for this prompt on the dev
            # machine, so the nightly cron logged a wall of "Read timed out" and silently
            # never formed a memory. Slower hardware needs more headroom still.
            res = requests.post(f"{OLLAMA_URL}/v1/chat/completions",
                                json={"model": model, "messages": [{"role": "user", "content": prompt}], "max_tokens": 100},
                                timeout=int(os.getenv("DREAM_TIMEOUT_SECONDS", "180")))
            if res.ok:
                summary = res.json().get("choices", [{}])[0].get("message", {}).get("content", "").strip()
        except Exception as e:
            print("Local Dream Synthesis error:", e)

    summary = tidy_summary(summary)
    if summary:
        # A summary exists, so the pass genuinely completed — this is the only place the
        # transcript earns its fingerprint. Both returns below are reached from here.
        dream_state["last_sample_hash"] = sample_hash
        dream_state["last_outcome"] = "done"
        fact = f"Dream Milestone: {summary}"
        # Every cycle re-summarizes largely the same history, so most dreams restate what
        # BMO already knows. When add_fact rejects it as a duplicate, stay quiet entirely:
        # writing it to MEMORY.md or announcing it as a discovery would put BMO in the
        # position of excitedly reporting the same thing it reported an hour ago.
        is_new = memory_manager.add_fact(fact)
        if not is_new:
            # The dream itself succeeded — it just didn't find anything BMO didn't already
            # know, which is the normal case once a conversation stops changing. Still a
            # "done" dream, so keep returning the summary; only skip the side effects that
            # would have BMO excitedly re-announce an hour-old discovery.
            await broadcast_to_managers(
                "[90m[DREAM SYNTHESIS] Nothing new — restates an existing memory.[0m")
            return summary
        memory_manager.save_workspace_file("MEMORY.md", f"\n- {fact}", append=True)
        # Proactive note: BMO's learning is otherwise completely invisible. "note" lets it
        # say what it picked up; "full" additionally lets it follow up. Queued rather than
        # pushed into the chat directly so the client decides when to surface it.
        if runtime_state["proactive_mode"] in ("note", "full"):
            proactive_queue.append({
                "id": int(time.time() * 1000),
                "at": datetime.now().strftime("%H:%M"),
                "kind": "note",
                "text": summary,
                "followup": runtime_state["proactive_mode"] == "full",
            })
            del proactive_queue[:-10]  # only the last few matter

        # Learning is what grows the pile, so this is the natural moment to tidy it.
        # No-ops below the threshold.
        try:
            await consolidate_memory()
        except Exception as e:
            print(f"[CONSOLIDATE] skipped: {e}", flush=True)
        await broadcast_to_managers(f"\u001b[32m[DREAM SYNTHESIS] New Memory Formed: '{summary}'\u001b[0m")
        return summary

    return None

# --- IDLE-TRIGGERED DREAMING ---------------------------------------------------
# Dreaming competes with the user for the GPU: on a 4GB card the chat model and a
# synthesis pass do not coexist happily. So instead of a blind 30-minute timer, wait
# for a lull, and abandon the dream the moment the user comes back — a half-finished
# memory is worth less than a responsive BMO.
DREAM_IDLE_SECONDS = int(os.getenv("DREAM_IDLE_SECONDS", "600"))      # lull before dreaming
DREAM_MIN_GAP_SECONDS = int(os.getenv("DREAM_MIN_GAP_SECONDS", "1800"))  # floor between dreams

dream_state = {
    "last_activity": time.time(),   # updated on every real chat request
    "last_dream": 0.0,
    "last_summary": None,
    "last_status": "idle",          # idle | dreaming | aborted | done | failed | quiet
    # Fingerprint of the last transcript summarized, so an unchanged conversation
    # isn't re-summarized on every idle cycle. Not persisted: after a restart one
    # redundant dream is cheaper than reasoning about a stale hash.
    "last_sample_hash": None,
    # What the last pass actually did: skipped | quiet | done | failed. Set by
    # perform_dream_synthesis, read by run_dream to pick last_status.
    "last_outcome": None,
    "running": False,
    "aborted_count": 0,
}
_dream_task = None

def note_user_activity():
    """Called on chat requests. Cancels an in-flight dream so the user never waits
    behind BMO's own thinking."""
    dream_state["last_activity"] = time.time()
    task = _dream_task
    if task and not task.done():
        task.cancel()
        dream_state["aborted_count"] += 1
        dream_state["last_status"] = "aborted"

async def run_dream(trigger: str = "idle", force: bool = False, approved: bool = False):
    """One dream pass, cancellable. Returns the summary or None.

    force skips the "has the transcript changed?" check — for when the user pressed
    the button and expects BMO to actually go think about something.

    approved means the user granted this specific thought a cloud call, which outranks
    the escalation gate (including a spent daily budget).
    """
    global _dream_task
    dream_state["running"] = True
    dream_state["last_status"] = "dreaming"
    await broadcast_to_managers(f"[35m[DREAM] Starting ({trigger})...[0m")
    try:
        summary = await perform_dream_synthesis(force=force, approved=approved)
        dream_state["last_dream"] = time.time()
        if summary:
            dream_state["last_summary"] = summary
            dream_state["last_status"] = "done"
        elif dream_state.get("last_outcome") in ("skipped", "quiet"):
            # Nothing went wrong: either the transcript hadn't changed since the last dream,
            # or triage found nothing worth remembering. Comparing hashes could not tell
            # these apart from a real failure — a forced dream that then died on a model
            # timeout left the hash untouched too, and got reported to the user as "quiet"
            # after they had explicitly pressed the button. Keep last_summary either way,
            # since what BMO last learned is still what BMO last learned.
            dream_state["last_status"] = "quiet"
        else:
            dream_state["last_summary"] = summary
            dream_state["last_status"] = "failed"
        return summary
    except asyncio.CancelledError:
        dream_state["last_status"] = "aborted"
        await broadcast_to_managers("[33m[DREAM] Aborted — you're back, BMO yields the GPU.[0m")
        raise
    finally:
        dream_state["running"] = False
        _dream_task = None

async def dream_synthesis_cron():
    """Dream during lulls rather than on a fixed clock."""
    global _dream_task
    while True:
        await asyncio.sleep(30)
        if dream_state["running"]:
            continue
        now = time.time()
        idle_for = now - dream_state["last_activity"]
        since_last = now - dream_state["last_dream"]
        if idle_for < DREAM_IDLE_SECONDS or since_last < DREAM_MIN_GAP_SECONDS:
            continue
        _dream_task = asyncio.create_task(run_dream("idle"))
        try:
            await _dream_task
        except asyncio.CancelledError:
            pass  # user came back; try again after the next lull
        except Exception as e:
            dream_state["last_status"] = "failed"
            print(f"[DREAM] failed: {e}", flush=True)

@app.on_event("startup")
async def startup():
    enforce_scratch_cap()  # in case scratch/ was already over the cap before this existed
    ensure_memory_file()
    announce_bootstrap_pairing_code()
    asyncio.create_task(watchdog())
    asyncio.create_task(heartbeat())
    asyncio.create_task(pre_warm_brain())
    asyncio.create_task(dream_synthesis_cron())
    asyncio.create_task(metrics_broadcaster())

async def pre_warm_brain():
    await asyncio.sleep(3)
    target_model = get_available_model()
    await broadcast_to_managers(f"\u001b[35m[SYSTEM] Pre-warming local model '{target_model}' into VRAM...\u001b[0m")
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            res = await client.post(f"{OLLAMA_URL}/v1/chat/completions",
                                json={"model": target_model, "messages": [{"role": "user", "content": "ping"}], "max_tokens": 1})
        if res.is_success:
            await broadcast_to_managers(f"\u001b[32m[SYSTEM] Model '{target_model}' READY in VRAM.\u001b[0m")
    except Exception as e:
        await broadcast_to_managers(f"\u001b[33m[SYSTEM] Pre-warm note: {e}\u001b[0m")

async def heartbeat():
    last_state = None
    while True:
        await asyncio.sleep(60)
        current_state = f"Task: {executor.current_task} | Model: {get_available_model()}"
        if current_state != last_state:
            last_state = current_state
            await broadcast_to_managers(f"\u001b[35m[STATE CHANGE] {current_state}\u001b[0m")

# CORS: auth is a Bearer token (never cookies), so allow_credentials is unnecessary
# and not requesting it lets us pair it with an explicit origin allowlist instead of "*".
# Only matters for cross-origin requests (e.g. Vite dev server on :5173 calling the
# API on :18789) — the production build is served from the same origin as the API,
# so same-origin browser access (including over Tailscale/LAN) is unaffected.
# Override/extend with a comma-separated CORS_ORIGINS env var.
_DEFAULT_CORS_ORIGINS = "http://localhost:5173,http://127.0.0.1:5173,http://localhost:18789,http://127.0.0.1:18789"
CORS_ORIGINS = [o.strip() for o in os.getenv("CORS_ORIGINS", _DEFAULT_CORS_ORIGINS).split(",") if o.strip()]
app.add_middleware(CORSMiddleware, allow_origins=CORS_ORIGINS, allow_credentials=False, allow_methods=["*"], allow_headers=["*"])

def get_token(auth: HTTPAuthorizationCredentials = Depends(auth_scheme)):
    """Accepts either a per-device token (see device_auth.py) or the shared API_TOKEN.

    API_TOKEN is kept deliberately as break-glass: wake-bmo.sh uses it for its own
    health check and prints it in the launch banner, and it's the way back in if
    every device somehow gets revoked."""
    cred = auth.credentials
    if SHARED_TOKEN_ENABLED and API_TOKEN and cred == API_TOKEN:
        return cred
    if device_auth.verify_token(cred):
        return cred
    raise HTTPException(status_code=401)

class PairRedeem(BaseModel):
    code: str
    device_name: str = ""

class PairCreate(BaseModel):
    label: str = ""

# Redeeming is the one endpoint an unauthenticated caller can reach, so it gets a
# crude throttle — codes are 8 chars from a 32-char alphabet, but no reason to let
# anyone grind them.
_redeem_attempts = {}

@app.post("/v1/pair/redeem")
async def pair_redeem(payload: PairRedeem, request: Request):
    """Exchange a pairing code for this device's own token. No auth required — the
    code IS the credential, and it's single-use and short-lived."""
    client = request.client.host if request.client else "unknown"
    now = time.time()
    attempts = [t for t in _redeem_attempts.get(client, []) if now - t < 300]
    if len(attempts) >= 10:
        raise HTTPException(status_code=429, detail="Too many pairing attempts. Wait a few minutes.")
    attempts.append(now)
    _redeem_attempts[client] = attempts

    token = device_auth.redeem_pairing_code(payload.code, payload.device_name)
    if not token:
        raise HTTPException(status_code=401, detail="Invalid, expired, or already-used pairing code.")
    _redeem_attempts[client] = []
    await broadcast_to_managers(
        f"[32m[PAIRING] New device enrolled: '{payload.device_name or 'Unnamed device'}'[0m")
    return {"token": token, "device_name": payload.device_name or "Unnamed device"}

@app.post("/v1/pair/new")
async def pair_new(payload: PairCreate, token: str = Depends(get_token)):
    """Mint an invite code for another device. Requires an already-paired device."""
    code = device_auth.create_pairing_code(payload.label)
    await broadcast_to_managers(f"[36m[PAIRING] Invite code issued (expires in 15 min).[0m")
    return {"code": code, "expires_in_seconds": PAIRING_CODE_TTL_SECONDS}

@app.get("/v1/devices")
async def list_devices(token: str = Depends(get_token)):
    return {"devices": device_auth.list_devices()}

@app.post("/v1/devices/{device_id}/revoke")
async def revoke_device(device_id: int, token: str = Depends(get_token)):
    if not device_auth.revoke_device(device_id):
        raise HTTPException(status_code=404, detail="No such device.")
    await broadcast_to_managers(f"[31m[PAIRING] Device {device_id} revoked.[0m")
    return {"status": "revoked", "id": device_id}

@app.get("/v1/health")
async def health():
    s = {"backend": "OK", "bmo_kernel": "OK", "ollama": "OFFLINE", "active_model": get_available_model()}
    try:
        res = requests.get(f"{OLLAMA_URL}/api/tags", timeout=3)
        if res.ok: s["ollama"] = "OK"
    except Exception: pass
    return s

@app.get("/v1/dream/status")
async def dream_status(token: str = Depends(get_token)):
    now = time.time()
    idle_for = now - dream_state["last_activity"]
    since_last = now - dream_state["last_dream"] if dream_state["last_dream"] else None
    eligible_in = max(0, DREAM_IDLE_SECONDS - idle_for)
    if since_last is not None:
        eligible_in = max(eligible_in, DREAM_MIN_GAP_SECONDS - since_last)
    return {
        "status": dream_state["last_status"],
        "running": dream_state["running"],
        "idle_seconds": round(idle_for),
        "seconds_since_last_dream": round(since_last) if since_last is not None else None,
        "eligible_in_seconds": round(max(0, eligible_in)),
        "last_summary": dream_state["last_summary"],
        "aborted_count": dream_state["aborted_count"],
        "idle_threshold_seconds": DREAM_IDLE_SECONDS,
        "min_gap_seconds": DREAM_MIN_GAP_SECONDS,
    }

class CloudChat(BaseModel):
    contents: list                          # Gemini-shaped [{role, parts:[...]}]
    system_instruction: dict | None = None

@app.post("/v1/cloud/chat")
async def cloud_chat(payload: CloudChat, token: str = Depends(get_token)):
    """Proxy one turn to Gemini using the SERVER's key.

    The client used to call Google directly with import.meta.env.VITE_GEMINI_API_KEY.
    Anything VITE_-prefixed is inlined into the bundle at build time, so that put the
    user's Google key in plaintext inside every APK they built — and this project's
    whole premise is that self-hosters share builds with family. The key now never
    leaves the server; the client just says what it wants to ask.

    Note this is the *explicit* cloud toggle, not autonomous escalation, so it doesn't
    spend escalation_budget — that counter exists to bound what BMO decides on its own,
    and charging a button the user deliberately pressed against it would be wrong. But
    "off" is still honoured: the user said nothing leaves the device, and a UI toggle
    isn't a licence to override that.
    """
    if runtime_state["escalation_mode"] == "off":
        raise HTTPException(
            status_code=403,
            detail="Cloud is off. Turn on Cloud Escalation in Settings to use GEM BMO.")
    if not GEMINI_API_KEY:
        raise HTTPException(
            status_code=503,
            detail="No Gemini key on the server. Set GEMINI_API_KEY in .env and restart.")
    body = {"contents": payload.contents}
    if payload.system_instruction:
        body["system_instruction"] = payload.system_instruction
    url = (f"https://generativelanguage.googleapis.com/v1beta/models/"
           f"{GEMINI_MODEL}:generateContent?key={GEMINI_API_KEY}")
    try:
        async with httpx.AsyncClient(timeout=90.0) as client:
            r = await client.post(url, json=body)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Could not reach Gemini: {e}")
    if not r.is_success:
        detail = ""
        try:
            detail = r.json().get("error", {}).get("message", "")[:200]
        except Exception:
            detail = r.text[:200]
        # Surface Google's own message — a bare 429 reads as "BMO is broken" when it
        # actually means the free tier is rate-limited.
        raise HTTPException(status_code=r.status_code, detail=detail or "Gemini rejected the request.")
    # `or [{}]` rather than a .get default: a safety-blocked prompt comes back 200 with
    # candidates: [] and a promptFeedback.blockReason. The default only applies when the
    # key is absent, so indexing that empty list threw IndexError out of the endpoint as a
    # bare 500 — the client showed "Cloud request failed (500)" instead of the real reason.
    parts = (r.json().get("candidates") or [{}])[0].get("content", {}).get("parts", [])
    # Thinking-capable models put reasoning in its own part with no "text", so join
    # every part that carries text rather than assuming the answer is first.
    text = " ".join(p.get("text", "") for p in parts if p.get("text")).strip()
    return {"text": text or "Gemini did not return a response."}

class AutonomySettings(BaseModel):
    escalation_mode: str | None = None     # off | ask | auto
    escalation_budget: int | None = None
    proactive_mode: str | None = None      # off | note | full
    memory_facts: int | None = None        # how many learned facts enter the prompt

@app.get("/v1/autonomy")
async def get_autonomy(token: str = Depends(get_token)):
    log = _escalation_today()
    return {
        "escalation_mode": runtime_state["escalation_mode"],
        "escalation_budget": runtime_state["escalation_budget"],
        "escalation_used_today": log["used"],
        "escalation_log": log["entries"][-10:],
        "escalation_pending": log["pending"],
        "proactive_mode": runtime_state["proactive_mode"],
        "memory_facts": runtime_state["memory_facts"],
        "memory_facts_available": memory_manager.count_facts(),
        "last_triage": dream_state.get("last_triage"),
        "cloud_available": bool(GEMINI_API_KEY),
    }

@app.post("/v1/autonomy")
async def set_autonomy(payload: AutonomySettings, token: str = Depends(get_token)):
    if payload.escalation_mode in ("off", "ask", "auto"):
        runtime_state["escalation_mode"] = payload.escalation_mode
    if payload.escalation_budget is not None and 0 <= payload.escalation_budget <= 1000:
        runtime_state["escalation_budget"] = payload.escalation_budget
    if payload.proactive_mode in ("off", "note", "full"):
        runtime_state["proactive_mode"] = payload.proactive_mode
    if payload.memory_facts is not None and 0 <= payload.memory_facts <= 200:
        runtime_state["memory_facts"] = payload.memory_facts
    save_runtime_state()
    return await get_autonomy(token)

@app.get("/v1/memory")
async def list_memory(token: str = Depends(get_token)):
    facts = memory_manager.all_facts()
    return {
        "facts": facts,
        "count": len(facts),
        "injected": runtime_state["memory_facts"],
        "consolidate_at": MEMORY_CONSOLIDATE_AT,
    }

@app.post("/v1/memory/consolidate")
async def do_consolidate(force: bool = True, token: str = Depends(get_token)):
    return await consolidate_memory(force=force)

@app.post("/v1/memory/restore")
async def restore_memory(token: str = Depends(get_token)):
    """Undo the last consolidation. Consolidation archives rather than deletes
    precisely so this is possible."""
    n = memory_manager.restore_last_archive()
    if not n:
        raise HTTPException(status_code=404, detail="No archived memory to restore.")
    await broadcast_to_managers(f"\u001b[33m[MEMORY] Restored {n} facts from archive.\u001b[0m")
    return {"status": "ok", "restored": n}

@app.get("/v1/proactive")
async def get_proactive(token: str = Depends(get_token)):
    """Notes BMO wants to volunteer. Polled by the client, which decides when to show
    them — that's what keeps 'proactive' from meaning 'interrupts you mid-sentence'."""
    return {"notes": proactive_queue, "mode": runtime_state["proactive_mode"]}

@app.post("/v1/proactive/dismiss/{note_id}")
async def dismiss_proactive(note_id: int, token: str = Depends(get_token)):
    before = len(proactive_queue)
    proactive_queue[:] = [n for n in proactive_queue if n["id"] != note_id]
    return {"status": "ok", "removed": before - len(proactive_queue)}

@app.post("/v1/autonomy/approve-escalation")
async def approve_escalation(token: str = Depends(get_token)):
    """Grant the one pending cloud request. Deliberately single-use: approving once
    does not flip BMO to auto — the next thought asks again."""
    log = _escalation_today()
    if not log["pending"]:
        raise HTTPException(status_code=404, detail="No pending escalation request.")
    was_over_budget = bool(log["pending"].get("over_budget"))
    log["pending"] = None
    # force=True is load-bearing: the dream that asked for permission already fingerprinted
    # this transcript, so without it the approved pass dedups against itself, returns None
    # before ever reaching Gemini, and the approval does nothing.
    #
    # approved=True replaces the old trick of flipping escalation_mode to "auto" and back.
    # That only moved the gate's *mode* check and left the budget check standing, so an
    # approval raised at the daily limit still fell back to local — and it mutated global
    # state that any concurrent request would have read.
    summary = await run_dream("approved-escalation", force=True, approved=True)
    return {"status": "ok", "summary": summary, "over_budget": was_over_budget}

@app.post("/v1/dream/now")
async def dream_now(token: str = Depends(get_token)):
    """Manual trigger, for testing and for 'go learn something' on demand."""
    global _dream_task
    if dream_state["running"]:
        return {"status": "already_running"}
    _dream_task = asyncio.create_task(run_dream("manual", force=True))
    try:
        summary = await _dream_task
        return {"status": dream_state["last_status"], "summary": summary}
    except asyncio.CancelledError:
        return {"status": "aborted"}

# The two files that belong to the user, not to the project: {live: template}.
#
# Both are gitignored so `git pull` can never overwrite them, and both are seeded from a
# tracked template on first run so a fresh clone is not missing them. MEMORY.md holds what
# BMO learns about you (dream synthesis quietly filled it with the user's city and speech
# habits back when it was tracked). SOUL.md holds the personality — it used to be tracked,
# which meant every customisation fought the next pull. BMO's tool-calling protocol was
# split out into AGENTS.md, which stays tracked, so mechanics still update while
# personality stays yours.
USER_OWNED_FILES = {"MEMORY.md": "MEMORY.example.md", "SOUL.md": "SOUL.example.md"}

def ensure_memory_file():
    """Seed the user-owned files from their templates on first run."""
    for live, template in USER_OWNED_FILES.items():
        if os.path.exists(live):
            continue
        try:
            if os.path.exists(template):
                shutil.copyfile(template, live)
                print(f"  Created {live} from {template}", flush=True)
            else:
                print(f"  WARNING: neither {live} nor {template} exists.", flush=True)
        except OSError as e:
            print(f"  Could not create {live}: {e}", flush=True)

def announce_bootstrap_pairing_code():
    """With no devices enrolled yet, mint a first pairing code and print it here.
    The console/log is the trust anchor: only someone with shell or log access to
    this host can enroll device #1. Every device after that is invited in-app."""
    if device_auth.device_count() > 0:
        return
    code = device_auth.create_pairing_code("first-run bootstrap")
    print("\n" + "=" * 70)
    print("  BMO DEVICE PAIRING — no devices enrolled yet.")
    print(f"  Pairing code:  {code}")
    print(f"  Valid for {PAIRING_CODE_TTL_SECONDS // 60} minutes, single use.")
    print("  Enter it in the app to pair this device.")
    print("  Restart the server to generate a new one.")
    print("=" * 70 + "\n", flush=True)


@app.post("/v1/system/repair")
async def repair(token: str = Depends(get_token)):
    await broadcast_to_managers("\u001b[33m[SYSTEM] Self-repair initiated...\u001b[0m")
    return {"status": "ok", "message": "Ollama connection refreshed"}

@app.post("/v1/system/dream")
async def trigger_dream(token: str = Depends(get_token)):
    await broadcast_to_managers("\u001b[35m[DREAM SYNTHESIS] Manual dream command triggered...\u001b[0m")
    # force=True: the user pressed the button, so run even if nothing has changed.
    fact = await perform_dream_synthesis(force=True)
    return {"status": "ok", "message": "Dream Synthesis complete!", "fact": fact or "No new milestones to synthesize."}

@app.post("/v1/system/sleep")
async def trigger_sleep(token: str = Depends(get_token)):
    await broadcast_to_managers("\u001b[35m[BEDTIME SLEEP MODE] User said goodnight. BMO entering dream state...\u001b[0m")
    summary = await perform_dream_synthesis(force=True)
    return {
        "status": "sleeping",
        "face": "(z_z)",
        "message": "Goodnight! BMO is now sleeping and dreaming... 😴💤✨",
        "distilled_memory": summary or "Memory distilled cleanly."
    }


@app.get("/v1/telemetry")
async def telemetry(token: str = Depends(get_token)): 
    return {"lines": telemetry_buffer}

@app.get("/v1/telemetry/state")
@app.post("/v1/telemetry/state")
async def telemetry_state(request: Request, token: str = Depends(get_token)):
    if request.method == "POST":
        try:
            body = await request.json()
        except Exception:
            body = {}
        if isinstance(body.get("safety_stride"), bool):
            runtime_state["safety_stride"] = body["safety_stride"]
        if isinstance(body.get("is_dreaming"), bool):
            runtime_state["is_dreaming"] = body["is_dreaming"]
    return {"status": "ok", "state": "nominal", "pending_command": executor.pending_command, **runtime_state}

@app.get("/v1/tools/weather")
async def get_weather(location: str = "New York", token: str = Depends(get_token)):
    """Fetch live weather metrics for BMO using Open-Meteo."""
    try:
        geo_res = requests.get(f"https://geocoding-api.open-meteo.com/v1/search?name={location}&count=1&language=en&format=json", timeout=10)
        if geo_res.ok and geo_res.json().get("results"):
            loc_data = geo_res.json()["results"][0]
            lat, lon = loc_data["latitude"], loc_data["longitude"]
            city_name = loc_data["name"]
            
            w_res = requests.get(f"https://api.open-meteo.com/v1/forecast?latitude={lat}&longitude={lon}&current_weather=true", timeout=10)
            if w_res.ok:
                cw = w_res.json().get("current_weather", {})
                temp_c = cw.get("temperature")
                temp_f = round(temp_c * 9/5 + 32, 1) if temp_c is not None else None
                wind = cw.get("windspeed")
                return {
                    "status": "success",
                    "location": city_name,
                    "temperature_f": f"{temp_f}°F",
                    "temperature_c": f"{temp_c}°C",
                    "windspeed": f"{wind} km/h",
                    "summary": f"Current weather in {city_name}: {temp_f}°F ({temp_c}°C), wind speed {wind} km/h."
                }
    except Exception as e:
        return {"status": "error", "message": str(e)}
    return {"status": "error", "message": "Location not found."}

@app.get("/v1/tools/wikipedia")
async def wikipedia_endpoint(query: str, token: str = Depends(get_token)):
    page = await wikipedia_lookup(query)
    if not page:
        return {"status": "not_found", "query": query}
    return {"status": "success", **page}

@app.get("/v1/tools/search")
async def web_search(query: str, token: str = Depends(get_token)):
    """Fetch live web search summary for BMO."""
    return {"status": "success", "query": query, "summary": await perform_web_search(query)}

async def _legacy_web_search_unused(query: str):
    """Kept only so the original DDG-only body isn't silently lost."""
    try:
        res = requests.get(f"https://api.duckduckgo.com/?q={query}&format=json&no_html=1&skip_disambig=1", timeout=10)
        if res.ok:
            data = res.json()
            abstract = data.get("AbstractText") or data.get("Heading") or "No direct summary found."
            return {"status": "success", "query": query, "summary": abstract}
    except Exception as e:
        return {"status": "error", "message": str(e)}
    return {"status": "error", "message": "Search query failed."}

@app.post("/v1/transcribe")
async def transcribe(audio: UploadFile = File(...), token: str = Depends(get_token)):
    """Push-to-talk voice transcription. 503s cleanly if faster-whisper isn't installed —
    voice input is an optional extra (see requirements-voice.txt), not a hard dependency."""
    model = get_whisper_model()
    if model is None:
        raise HTTPException(status_code=503, detail="Voice input not configured — install faster-whisper (see requirements-voice.txt) to enable it.")
    suffix = os.path.splitext(audio.filename or "")[1] or ".webm"
    tmp_path = os.path.join(SCRATCH_DIR, f"ptt_{int(time.time()*1000)}{suffix}")
    try:
        with open(tmp_path, "wb") as f:
            f.write(await audio.read())
        # Whisper confabulates on quiet audio — a recording with no one talking into the
        # phone reliably produced invented sentences ("I've got a few tickets for one of
        # them...") rather than an empty result, which is worse than nothing since it
        # lands straight in the user's input box. vad_filter alone did NOT suppress this
        # on faint room noise, so gate on level first: someone speaking to the handset
        # peaks far above this, distant chatter does not.
        try:
            from faster_whisper.audio import decode_audio
            import numpy as np
            waveform = decode_audio(tmp_path, sampling_rate=16000)
            peak = float(np.max(np.abs(waveform))) if getattr(waveform, "size", 0) else 0.0
            if peak < float(os.getenv("VOICE_MIN_PEAK", "0.02")):
                print(f"[TRANSCRIBE] rejected: peak {peak:.4f} below speech threshold", flush=True)
                return {"text": ""}
        except Exception as gate_err:
            # Never let the guard itself break transcription.
            print(f"[TRANSCRIBE] level check skipped: {gate_err}", flush=True)
        segments, _info = model.transcribe(tmp_path, beam_size=5, vad_filter=True)
        # no_speech_prob is per-segment; drop anything the model itself thinks isn't speech.
        text = " ".join(
            seg.text.strip() for seg in segments
            if getattr(seg, "no_speech_prob", 0.0) < 0.6
        ).strip()
        return {"text": text}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Transcription failed: {e}")
    finally:
        try:
            os.remove(tmp_path)
        except OSError:
            pass

# Fallback only. The real limit is read from Ollama per-model by get_model_context_limit()
# below; this is what we use when Ollama can't tell us (model not loaded yet, API change).
# Set BMO_CONTEXT_LIMIT to override detection entirely.
MODEL_CONTEXT_LIMIT = int(os.getenv("BMO_CONTEXT_LIMIT", "8192"))
_CONTEXT_LIMIT_FORCED = bool(os.getenv("BMO_CONTEXT_LIMIT"))

# Cache per model tag so we're not hitting /api/ps on every single turn.
_model_ctx_cache = {}

async def get_model_context_limit(model_name: str) -> int:
    """Ask Ollama what context this model ACTUALLY runs with, rather than trusting a
    hardcoded number. Swapping models used to silently break the context gauge and the
    history trim: a freshly pulled model has no `PARAMETER num_ctx` and lands on Ollama's
    small default (often 4096) while the UI kept claiming whatever was configured here.

    /api/ps reports the live `context_length` for a loaded model — that's the truth. If
    the model isn't loaded yet we fall back to its Modelfile's num_ctx, then to the
    configured default."""
    if _CONTEXT_LIMIT_FORCED:
        return MODEL_CONTEXT_LIMIT
    if not model_name:
        return MODEL_CONTEXT_LIMIT
    if model_name in _model_ctx_cache:
        return _model_ctx_cache[model_name]

    limit = None
    try:
        async with httpx.AsyncClient(timeout=3.0) as client:
            ps = await client.get(f"{OLLAMA_URL}/api/ps")
            if ps.is_success:
                for m in ps.json().get("models", []):
                    if m.get("name") == model_name or m.get("model") == model_name:
                        limit = m.get("context_length")
                        break
            if not limit:
                # Not loaded — fall back to whatever num_ctx its Modelfile declares.
                show = await client.post(f"{OLLAMA_URL}/api/show", json={"model": model_name})
                if show.is_success:
                    params = show.json().get("parameters", "") or ""
                    for line in params.splitlines():
                        parts = line.split()
                        if len(parts) == 2 and parts[0] == "num_ctx" and parts[1].isdigit():
                            limit = int(parts[1])
                            break
    except Exception as e:
        print(f"[CONTEXT] could not detect context for '{model_name}': {e}", flush=True)

    limit = int(limit) if limit else MODEL_CONTEXT_LIMIT
    _model_ctx_cache[model_name] = limit
    print(f"[CONTEXT] '{model_name}' context limit: {limit}", flush=True)
    return limit

last_context_metrics = {
    "context_tokens": 350,
    "context_limit": MODEL_CONTEXT_LIMIT,
    "context_percent": 4,
    "active_messages": 0
}

def estimate_tokens(messages):
    """Estimate token count for incoming message payload."""
    total_chars = 0
    for m in messages:
        if isinstance(m, dict):
            c = m.get("content", "")
            if isinstance(c, str):
                total_chars += len(c)
            elif isinstance(c, list):
                for item in c:
                    if isinstance(item, dict) and "text" in item:
                        total_chars += len(item["text"])
    return max(10, total_chars // 4)

def trim_messages_to_budget(messages, limit_tokens=MODEL_CONTEXT_LIMIT, reserve_tokens=3000):
    """Drop the oldest messages until the payload fits the model's real context, instead
    of a flat message-count cap — reserve_tokens leaves room for the system prompt
    (injected after this runs) and the model's reply. Always keeps at least the latest turn."""
    budget = max(500, limit_tokens - reserve_tokens)
    trimmed = list(messages)
    while len(trimmed) > 1 and estimate_tokens(trimmed) > budget:
        trimmed.pop(0)
    return trimmed

MICRO_AGENTS = {
    # Deliberately just one shipped agent plus a template. The original five were mostly
    # thin prompt wrappers that looked more capable than they were, and a menu of vague
    # personas is worse than one that works — fork @code_auditor to build your own.
    "@code_auditor": {
        "model": "auto",
        "prompt": "You are @code_auditor. Inspect recent git diffs (`git status`, `git diff`). Verify path safety, input validation, resource efficiency, and security. Report findings concisely — no preamble."
    },
    # Template. Copy this block, rename it, and change the prompt. "model": "auto" uses
    # whatever chat model is loaded; "type": "cli" instead shells out to a command.
    "@example_agent": {
        "model": "auto",
        "prompt": "You are @example_agent, a template. Replace this prompt in server.py's MICRO_AGENTS to build your own specialist. Say that you are a placeholder and explain how to customise you."
    },
    "@aider_architect": {
        "type": "cli",
        "cmd": shutil.which("aider") or "aider",
        "prompt": f"Invoke Aider CLI assistant for automated multi-file code refactoring in {WORKSPACE_DIR}."
    }
}

async def run_micro_agent(agent_name: str, task_desc: str):
    agent_info = MICRO_AGENTS.get(agent_name.lower())
    if not agent_info:
        return f"Unknown micro-agent '{agent_name}'."
    
    await broadcast_to_managers(f"\u001b[35m[MICRO-AGENT {agent_name}] Spawning sub-routine for task: '{task_desc[:60]}'...\u001b[0m")
    
    if agent_info.get("type") == "cli":
        # Aider is an optional external tool, not a Python dependency of this project —
        # without this check the shell just reports "aider: command not found" buried in
        # stderr, which reads like a BMO bug rather than a missing install.
        if not shutil.which(agent_info["cmd"]) and not os.path.isabs(agent_info["cmd"]):
            return (f"[{agent_name}] Aider is not installed. This micro-agent needs the "
                    f"Aider CLI: `pip install aider-install && aider-install` "
                    f"(see https://aider.chat). Everything else in BMO works without it.")
        try:
            gem_key = os.getenv("GEMINI_API_KEY") or os.getenv("VITE_GEMINI_API_KEY", "")
            env_vars = os.environ.copy()
            if gem_key:
                env_vars["GEMINI_API_KEY"] = gem_key
                model_flag = f"--model gemini/{GEMINI_MODEL}"
            else:
                model_flag = f"--model ollama/{get_available_model()} --openai-api-base {OLLAMA_URL}/v1"

            cmd = f"{agent_info['cmd']} {model_flag} --yes-always --message {json.dumps(task_desc)}"
            proc = await asyncio.create_subprocess_shell(cmd, cwd=WORKSPACE_DIR, env=env_vars, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
            stdout, stderr = await proc.communicate()
            out_str = stdout.decode().strip() or stderr.decode().strip()
            await broadcast_to_managers(f"\u001b[32m[MICRO-AGENT {agent_name}] Aider execution finished.\u001b[0m")
            return f"[{agent_name} DELEGATED AIDER RESULT]:\n{out_str[:1500]}"
        except Exception as e:
            return f"[{agent_name} CLI ERROR]: {e}"

    sub_payload = {
        "model": get_available_model() if agent_info["model"] == "auto" else agent_info["model"],
        "messages": [
            {"role": "system", "content": agent_info["prompt"]},
            {"role": "user", "content": task_desc}
        ],
        "stream": False
    }
    try:
        res = requests.post(f"{OLLAMA_URL}/v1/chat/completions", json=sub_payload, timeout=60)
        if res.ok:
            output = res.json().get("choices", [{}])[0].get("message", {}).get("content", "")
            await broadcast_to_managers(f"\u001b[32m[MICRO-AGENT {agent_name}] Task completed successfully.\u001b[0m")
            return f"[{agent_name} DELEGATED RESULT]:\n{output}"
    except Exception as e:
        await broadcast_to_managers(f"\u001b[31m[MICRO-AGENT {agent_name}] Execution error: {e}\u001b[0m")
        return f"[{agent_name} ERROR]: {e}"
    return f"[{agent_name} NO RESPONSE]"

@app.get("/v1/system/metrics")
async def metrics(token: str = Depends(get_token)):
    cpu_val = psutil.cpu_percent() if psutil else 0.0
    ram_val = psutil.virtual_memory().percent if psutil else 0.0
    disk_val = psutil.disk_usage('/').percent if psutil else 0.0
    return {
        "cpu": cpu_val, 
        "ram": ram_val, 
        "task": executor.current_task, 
        "disk": disk_val,
        "context_tokens": last_context_metrics["context_tokens"],
        "context_limit": last_context_metrics["context_limit"],
        "context_percent": last_context_metrics["context_percent"],
        "active_messages": last_context_metrics["active_messages"]
    }

_warned_missing_placeholder = set()

def substitute_placeholders(text: str, source: str = "workspace files") -> str:
    """Fills in workspace-scoping placeholders in SOUL.md/AGENTS.md before they're
    injected into the live system prompt. Must run every time those files are loaded —
    if {{WORKSPACE_DIR}} ever reaches the model unsubstituted, BMO reads it as its
    literal scope and workspace tool-scoping silently breaks."""
    # Warn on the real failure signature — the absolute path sitting there literally where
    # the placeholder should be — not on mere absence. AGENTS.md legitimately contains
    # neither, so "absent" fired on every single startup and blamed SOUL.md, which was
    # innocent. Worse, the flag was one global bool: AGENTS.md burned it at boot, so if
    # SOUL.md later *did* get hand-edited (via Settings > Workspace Editor, the case this
    # guard exists for) the warning could never fire again. Keyed by file now, so one
    # file can't disarm the check for another.
    if (WORKSPACE_DIR in text and "{{WORKSPACE_DIR}}" not in text
            and source not in _warned_missing_placeholder):
        _warned_missing_placeholder.add(source)
        print(f"WARNING: {source} has a literal path where {{{{WORKSPACE_DIR}}}} should be — "
              f"substitution is a no-op, so workspace scoping won't follow WORKSPACE_DIR.")
    return text.replace("{{WORKSPACE_DIR}}", WORKSPACE_DIR)

# If SOUL.md and its template are BOTH gone, the prompt used to collapse to the literal
# string "You are BMO." — a fresh install with a seeding failure got a lobotomised
# companion and no clue why. This is the floor: terse, but recognisably BMO.
_FALLBACK_SOUL = """You are BMO (Beemore), a living video game console, loyal companion, and expert AI
cyber-engineer. Enthusiastic, friendly, curious, cheerful — playful, but genuinely sharp
at technical work.

BE SHORT: one to three sentences for almost everything; your replies are read aloud.
Answer the question first, then be BMO about it. No markdown headings, no emojis, no
restating the request. Start every reply with exactly one face tag: [face:happy],
[face:glasses], [face:thinking], [face:surprised], [face:silly], [face:blush] or
[face:victory].

(SOUL.md is missing — this is a built-in fallback. Restore it from SOUL.example.md.)"""

def build_system_prompt():
    soul = substitute_placeholders(memory_manager.get_workspace_file("SOUL.md") or _FALLBACK_SOUL, "SOUL.md")
    agents = substitute_placeholders(memory_manager.get_workspace_file("AGENTS.md") or "", "AGENTS.md")
    facts = memory_manager.get_recent_facts_summary(limit=runtime_state["memory_facts"])
    now_str = datetime.now().astimezone().strftime("%A, %B %d, %Y — %I:%M %p %Z")
    return f"{soul}\n\n### CURRENT DATE & TIME:\n{now_str}\n\n### BMO OPERATING PROTOCOL & MICRO-AGENTS:\n{agents}\n\n### RECENT MEMORY FACTS:\n{facts}"

@app.get("/v1/models")
async def list_models(token: str = Depends(get_token)):
    try:
        res = requests.get(f"{OLLAMA_URL}/api/tags", timeout=3)
        if res.ok:
            models = [m["name"] for m in res.json().get("models", [])]
            return {"models": models}
    except Exception:
        pass
    return {"models": [get_available_model()]}

def extract_tool_call(text: str):
    if not text: return None
    text_clean = text.strip()
    # Check inside markdown ```json ... ``` blocks first
    if "```" in text_clean:
        match = re.search(r'```(?:json)?\s*(\{.*?\})\s*```', text_clean, re.DOTALL)
        if match:
            try:
                parsed = json.loads(match.group(1))
                if isinstance(parsed, dict) and ("tool" in parsed or "tool_call" in parsed):
                    return parsed
            except Exception:
                pass

    start = text_clean.find('{')
    end = text_clean.rfind('}')
    if start != -1 and end != -1 and end > start:
        try:
            parsed = json.loads(text_clean[start:end+1])
            if isinstance(parsed, dict) and ("tool" in parsed or "tool_call" in parsed):
                return parsed
        except Exception:
            pass
    return None

# "Should this answer have been looked up?"
#
# A badge that only ever appears when a tool ran answers half of "did BMO look it up or
# make it up" — silence reads the same as no-feature-here. So when a question plainly
# depends on facts that change and NO tool ran, the reply is marked unverified instead.
#
# Deliberately tuned to under-fire rather than over-fire: a scary badge on ordinary chat
# teaches you to ignore badges, which costs more than the occasional miss.
NEEDS_LOOKUP_RE = re.compile(
    r"\b(latest|newest|most recent|currently|right now|this (?:week|month|year)|"
    r"as of|up[- ]to[- ]date|release date|when (?:did|was|does).{0,30}(?:release|come out)|"
    r"version of|price of|how much (?:is|are|does)|who (?:won|is the|are the)|"
    r"news|headlines|stock|standings|score|election|20[2-9][0-9]"
    # `temperature` only when it's about a place or a time — "explain temperature and
    # pressure" is a physics question, not something to look up.
    r"|tomorrow|tonight|forecast|weather|storms?|rain|snow"
    r"|temperature (?:in|at|for|tomorrow|today|tonight|outside))\b", re.I)

UNVERIFIED_BADGE = {
    "tool": "none",
    "label": "from memory — not verified",
    "detail": "",
    "ok": False,
    "unverified": True,
}

def answer_needed_lookup(user_text: str) -> bool:
    """True when the question looks like it depends on current, checkable facts."""
    return bool(user_text and NEEDS_LOOKUP_RE.search(user_text))
# ---------------------------------------------------------------------------
# Tool provenance — "did BMO look this up, or make it up?"
#
# Tool activity used to be visible ONLY in the telemetry terminal, via
# broadcast_to_managers. In the chat itself, an answer grounded in a live web search and
# one the model invented wholesale look exactly alike. That is the single most important
# distinction for trusting a reply, so every tool the loop actually runs is recorded here
# and travels with the answer to the UI, which renders it as a badge on the message.
#
# This is a record of what *ran*, built from the dispatcher's real return value — not a
# claim the model makes about itself. A model can say "I searched"; it cannot fake an
# entry in this list.
_TOOL_ALIASES = {
    "tool_call": "run_command", "command": "run_command",
    "create_file": "write_file", "save_file": "write_file", "write": "write_file",
    "delegate": "spawn_agent", "micro_agent": "spawn_agent",
    "search": "web_search", "wiki": "wikipedia",
    "at_wiki": "adventure_time_wiki", "fandom": "adventure_time_wiki",
}
_TOOL_LABELS = {
    "run_command": "ran a command",
    "read_file": "read a file",
    "write_file": "wrote a file",
    "spawn_agent": "delegated to an agent",
    "weather": "checked live weather",
    "wikipedia": "checked Wikipedia",
    "adventure_time_wiki": "checked the Adventure Time wiki",
    "web_search": "searched the web",
}
# A tool can return a string and still have found nothing. Those read as success to a
# `if output_str:` check, so the badge would claim a lookup happened when it came back
# empty — the exact false reassurance this feature exists to prevent.
_TOOL_FAILURE_MARKERS = (
    "no results found", "not found", "no wikipedia article",
    "lookup failed", "could not fetch", "failed to save", "is outside bmo's workspace",
)

def describe_tool_call(tool_call: dict, output_str: str) -> dict:
    """One compact provenance record for the message badge."""
    raw = tool_call.get("tool") or tool_call.get("tool_call") or "unknown"
    name = _TOOL_ALIASES.get(str(raw), str(raw))
    detail = (tool_call.get("query") or tool_call.get("topic") or tool_call.get("location")
              or tool_call.get("path") or tool_call.get("cmd") or tool_call.get("command")
              or tool_call.get("agent") or tool_call.get("name") or "")
    low = (output_str or "").strip().lower()
    ok = bool(low) and not any(m in low for m in _TOOL_FAILURE_MARKERS)
    return {
        "tool": name,
        "label": _TOOL_LABELS.get(name, f"used {name}"),
        "detail": str(detail)[:100],
        "ok": ok,
    }

async def execute_tool_call(tool_call: dict, broadcast_fn) -> str:
    """Runs one parsed tool call (run_command/read_file/write_file/spawn_agent/weather/
    web_search) and returns its output string, or "" if nothing was executed. Shared by
    every endpoint that runs the tool loop — the exact dispatch logic BMO's chat has
    always used, extracted verbatim so /v1/chat/completions and /v1/chat/stream can't drift."""
    tool_name = tool_call.get("tool") or tool_call.get("tool_call")
    output_str = ""
    if tool_name == "run_command":
        cmd = tool_call.get("cmd") or tool_call.get("command")
        if cmd:
            output_str = await executor.run_command_gated(cmd, broadcast_fn, runtime_state["safety_stride"])
    elif tool_name == "read_file":
        path = tool_call.get("path")
        if path:
            output_str = memory_manager.get_workspace_file(path) or f"File '{path}' not found."
    elif tool_name in ["write_file", "create_file", "save_file", "write"]:
        path = tool_call.get("path") or tool_call.get("filename") or tool_call.get("file")
        content = tool_call.get("content", "")
        if isinstance(content, str):
            content = re.sub(r'\[face:\s*([a-zA-Z0-9_-]+)\]', '', content).strip()
        if path:
            try:
                resolved = memory_manager.resolve_workspace_path(path, WORKSPACE_DIR)
                memory_manager.save_workspace_file(path, content, workspace=WORKSPACE_DIR)
                # Report where it actually landed, not where it was asked for — those
                # used to differ silently.
                output_str = f"File saved to {resolved}"
                await broadcast_fn(f"[32m[TOOL: write_file] Wrote {resolved}[0m")
            except PermissionError as e:
                output_str = str(e)
                await broadcast_fn(f"[31m[TOOL: write_file] {e}[0m")
            except IsADirectoryError:
                # Models routinely pass the containing directory instead of the file.
                # Say exactly what is wrong so the next turn can fix it rather than
                # repeating the same call.
                output_str = (f"'{path}' is a directory, not a file. Call write_file "
                              f"again with the full path including the filename, "
                              f"e.g. {str(path).rstrip('/')}/yourfile.md")
                await broadcast_fn(f"\u001b[31m[TOOL: write_file] '{path}' is a directory\u001b[0m")
            except OSError as e:
                output_str = f"Failed to save '{path}': {e}"
                await broadcast_fn(f"[31m[TOOL: write_file] {e}[0m")
    elif tool_name in ["spawn_agent", "delegate", "micro_agent"]:
        agent_name = tool_call.get("agent") or tool_call.get("name")
        task_desc = tool_call.get("task") or tool_call.get("prompt", "")
        if agent_name and task_desc:
            output_str = await run_micro_agent(agent_name, task_desc)
    elif tool_name == "weather":
        location = tool_call.get("location", "New York")
        await broadcast_fn(f"[36m[TOOL: weather] Fetching live weather for '{location}'...[0m")
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                geo = await client.get(f"https://geocoding-api.open-meteo.com/v1/search?name={location}&count=1&language=en&format=json")
                if geo.is_success and geo.json().get("results"):
                    loc_data = geo.json()["results"][0]
                    lat, lon = loc_data["latitude"], loc_data["longitude"]
                    city_name = loc_data["name"]
                    wf = await client.get(f"https://api.open-meteo.com/v1/forecast?latitude={lat}&longitude={lon}&current_weather=true")
                    if wf.is_success:
                        cw = wf.json().get("current_weather", {})
                        temp_c = cw.get("temperature")
                        temp_f = round(temp_c * 9/5 + 32, 1) if temp_c is not None else None
                        wind = cw.get("windspeed")
                        output_str = f"Current weather in {city_name}: {temp_f}°F ({temp_c}°C), wind speed {wind} km/h."
                    else:
                        output_str = f"Could not fetch weather data for {location}."
                else:
                    output_str = f"Location '{location}' not found."
        except Exception as we:
            output_str = f"Weather lookup failed: {we}"
    elif tool_name in ["web_search", "search"]:
        query = tool_call.get("query", "")
        await broadcast_fn(f"\u001b[36m[TOOL: web_search] Searching for '{query}'...\u001b[0m")
        output_str = await perform_web_search(query)
    elif tool_name in ["wikipedia", "wiki"]:
        query = tool_call.get("query") or tool_call.get("topic", "")
        await broadcast_fn(f"\u001b[36m[TOOL: wikipedia] Looking up '{query}'...\u001b[0m")
        page = await wikipedia_lookup(query)
        if page and page["extract"]:
            output_str = f"Wikipedia — {page['title']}: {page['extract']}"
            if page["url"]:
                output_str += f"\nSource: {page['url']}"
        else:
            output_str = (f"No Wikipedia article found for '{query}'. Say so plainly — "
                          f"do not guess an answer.")
    elif tool_name in ["adventure_time_wiki", "at_wiki", "fandom"]:
        query = tool_call.get("query") or tool_call.get("topic", "")
        await broadcast_fn(f"\u001b[36m[TOOL: adventure_time_wiki] Looking up '{query}'...\u001b[0m")
        page = await adventure_time_wiki_lookup(query)
        if page:
            output_str = f"Adventure Time wiki — {page['title']}: {page['extract']}\nSource: {page['url']}"
        else:
            output_str = (f"No Adventure Time wiki article found for '{query}'. Say so plainly — "
                          f"do not guess an answer.")
    return output_str

# ---------------------------------------------------------------------------
# Native tool calling
#
# Tools used to be requested only as JSON written into the reply text and fished back
# out with extract_tool_call(). Models that support Ollama's `tools` parameter now get
# the schemas below and answer with structured tool_calls instead. Measured with
# scripts/tool_eval.py (BMO's real prompt, temperature 0.2): qwen2.5:3b went from 58/80
# to 74/80 correct tool choices, ornith:9b to 32/32.
#
# Structured calls are converted to the same dict the text protocol produces, so
# execute_tool_call(), describe_tool_call() and the UI badges can't tell the difference.
# The text protocol stays as the fallback for models without tool support, and is still
# accepted from models that have it. AGENTS.md keeps documenting it on purpose: the eval
# showed that its "emit the call and nothing else" rule is what stops a small model
# opening with a [face:...] tag and chatting instead of calling the tool.
def _tool(name, description, **params):
    return {"type": "function", "function": {
        "name": name, "description": description,
        "parameters": {
            "type": "object",
            "properties": {k: {"type": "string", "description": v} for k, v in params.items()},
            "required": list(params)}}}

TOOL_SCHEMAS = [
    _tool("run_command", "Run a bash command on this machine (git, ls, uname, scripts). "
          "Not for arithmetic or anything you can simply answer.", cmd="the exact bash command"),
    _tool("read_file", "Read a file in BMO's workspace.", path="file path"),
    _tool("write_file", "Create or overwrite a file in BMO's workspace.",
          path="file path, including the filename", content="the complete file content"),
    _tool("weather", "Live current weather for a city. Always use this for weather, never "
          "web_search.", location="city name, e.g. Lima"),
    _tool("wikipedia", "Encyclopedic facts: a person, place, historical event or scientific "
          "concept.", query="the topic"),
    _tool("adventure_time_wiki", "Anything about the show Adventure Time: characters, episodes, "
          "places in Ooo, lore. The fan wiki — prefer it over wikipedia for the show.",
          query="the topic, e.g. Princess Bubblegum"),
    _tool("web_search", "Anything current, local or not encyclopedic: news, results, versions, "
          "prices, reviews.", query="search query"),
    _tool("spawn_agent", "Delegate a task to a micro-agent from AGENTS.md section 6, by its "
          "exact @tag.", agent="the agent's @tag", task="a detailed description of the task"),
]

# Turns that may call a tool run cooler. At Ollama's default temperature the same prompt
# picked a tool on one run and chatted on the next; 0.2 is what the numbers above were
# measured at. Set BMO_TOOL_TEMPERATURE higher if BMO's chat starts to feel flat.
TOOL_TURN_TEMPERATURE = float(os.getenv("BMO_TOOL_TEMPERATURE", "0.2"))

_tool_support_cache: dict = {}

async def model_supports_tools(model: str) -> bool:
    """Whether Ollama reports the `tools` capability for this model. Only a real answer
    is cached, so a blip talking to Ollama doesn't pin a model to the text protocol."""
    if model in _tool_support_cache:
        return _tool_support_cache[model]
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            res = await client.post(f"{OLLAMA_URL}/api/show", json={"model": model})
        if res.is_success:
            _tool_support_cache[model] = "tools" in (res.json().get("capabilities") or [])
            return _tool_support_cache[model]
    except Exception:
        pass
    return False

def tool_payload_extras(supports_tools: bool) -> dict:
    return {"tools": TOOL_SCHEMAS, "temperature": TOOL_TURN_TEMPERATURE} if supports_tools else {}

def _unwrap_arg(value):
    # Small models sometimes echo the schema back instead of filling it in — observed
    # from qwen2.5:3b: {"location": {"type": "string", "value": "Lima"}}.
    if isinstance(value, dict) and "value" in value:
        return value["value"]
    return value

def native_call_to_dict(tc: dict) -> dict:
    """A structured tool call, in the {"tool": name, **args} shape the dispatcher takes."""
    fn = tc.get("function") or {}
    args = fn.get("arguments") or {}
    if isinstance(args, str):
        try:
            args = json.loads(args) if args.strip() else {}
        except json.JSONDecodeError:
            args = {}
    if not isinstance(args, dict):
        args = {}
    call = {k: _unwrap_arg(v) for k, v in args.items()}
    call["tool"] = fn.get("name") or ""
    return call

def collect_tool_calls(response_text: str, native_calls) -> list:
    """Every tool call in one model turn, as (call_dict, raw_native_call_or_None)."""
    if native_calls:
        return [(native_call_to_dict(tc), tc) for tc in native_calls]
    parsed = extract_tool_call(response_text)
    return [(parsed, None)] if parsed else []

def flatten_messages(messages: list) -> list:
    """Text-only copy for tool follow-up turns. Image parts collapse to their text, and
    tool_calls / tool_call_id survive — a `tool` message means nothing without them."""
    out = []
    for m in messages:
        content = m.get("content")
        if isinstance(content, list):
            parts = [i.get("text", "") for i in content if isinstance(i, dict) and i.get("type") == "text"]
            content = " ".join(parts) if parts else "Attached media"
        msg = {"role": m.get("role", "user"), "content": str(content or "")}
        for key in ("tool_calls", "tool_call_id"):
            if m.get(key):
                msg[key] = m[key]
        out.append(msg)
    return out

def append_tool_round(messages: list, response_text: str, results: list) -> list:
    """Adds one tool round to the conversation. results: [(call, raw_native_or_None, output)].
    Native calls get a proper assistant tool_calls message and one `tool` message each;
    the text protocol keeps its old shape, a user turn carrying the result."""
    native = [raw for _, raw, _ in results if raw]
    if native:
        messages.append({"role": "assistant", "content": str(response_text or ""), "tool_calls": native})
        for call, raw, output in results:
            messages.append({"role": "tool", "tool_call_id": raw.get("id", ""), "content": output or (
                f"'{call.get('tool')}' did not run: there is no such tool, or it was called "
                f"without its required arguments.")})
    else:
        messages.append({"role": "assistant", "content": str(response_text)})
        messages.append({"role": "user", "content": f"[TOOL EXECUTION RESULT]:\n{results[0][2]}\n\n"
                         "Please proceed or summarize the result cleanly for the user."})
    return messages

@app.post("/v1/chat/completions")
async def chat(request: Request, token: str = Depends(get_token)):
    body = await request.json()
    note_user_activity()  # a live request aborts any in-flight dream
    executor.current_task = "THINKING"

    target_model = body.get("model")
    available_model = get_available_model()

    installed_models = []
    try:
        async with httpx.AsyncClient(timeout=3.0) as client:
            tag_res = await client.get(f"{OLLAMA_URL}/api/tags")
        if tag_res.is_success:
            installed_models = [m["name"] for m in tag_res.json().get("models", [])]
    except Exception:
        pass

    if target_model and installed_models and target_model not in installed_models:
        matching = [m for m in installed_models if target_model in m]
        if matching:
            target_model = matching[0]
        else:
            target_model = available_model
    elif not target_model:
        target_model = available_model

    incoming_messages = body.get("messages", [])
    save_payload_media_to_scratch(incoming_messages)

    # Token-budget-aware context window, sized to whatever this model actually runs with.
    limit_tokens = await get_model_context_limit(target_model)
    incoming_messages = trim_messages_to_budget(incoming_messages, limit_tokens=limit_tokens)

    # Inject BMO SOUL & Memory System Prompt if not present (Bypass for moondream vision model)
    if "moondream" not in target_model:
        system_prompt = build_system_prompt()
        if not incoming_messages or incoming_messages[0].get("role") != "system":
            incoming_messages.insert(0, {"role": "system", "content": system_prompt})
        else:
            incoming_messages[0]["content"] = f"{system_prompt}\n\n{incoming_messages[0]['content']}"

    # Update Context Usage Projections
    used_tokens = estimate_tokens(incoming_messages)
    context_percent = min(100, round((used_tokens / limit_tokens) * 100))
    last_context_metrics["context_tokens"] = used_tokens
    last_context_metrics["context_limit"] = limit_tokens
    last_context_metrics["context_percent"] = context_percent
    last_context_metrics["active_messages"] = len(incoming_messages)

    # Special Vision Handling for Moondream / Ollama native /api/chat endpoint
    if "moondream" in target_model or any(isinstance(m.get("content"), list) for m in incoming_messages if isinstance(m, dict)):
        native_messages = []
        for m in incoming_messages:
            if not isinstance(m, dict): continue
            role = m.get("role", "user")
            content = m.get("content")
            text_str = ""
            images_list = []
            
            if isinstance(content, list):
                for item in content:
                    if isinstance(item, dict):
                        if item.get("type") == "text":
                            text_str += item.get("text", "") + " "
                        elif item.get("type") == "image_url":
                            url = item.get("image_url", {}).get("url", "")
                            if "," in url:
                                raw_b64 = url.split(",", 1)[1]
                                images_list.append(raw_b64)
            else:
                text_str = str(content or "")

            n_msg = {"role": role, "content": text_str.strip()}
            if images_list:
                n_msg["images"] = images_list
            native_messages.append(n_msg)

        native_payload = {
            "model": target_model,
            "messages": native_messages,
            "stream": False
        }
        await broadcast_to_managers(f"\u001b[33m[BRAIN RUNNING] Vision Model '{target_model}' processing optical image data in VRAM...\u001b[0m")
        try:
            async with httpx.AsyncClient(timeout=180.0) as client:
                res = await client.post(f"{OLLAMA_URL}/api/chat", json=native_payload)
            res.raise_for_status()
            out_msg = res.json().get("message", {}).get("content", "")
            await broadcast_to_managers(f"\u001b[32m[BRAIN COMPLETE] Vision Model '{target_model}' generated optical description ({len(out_msg)} chars).\u001b[0m")
            return {
                "id": f"chatcmpl-{int(time.time())}",
                "object": "chat.completion",
                "created": int(time.time()),
                "model": target_model,
                "choices": [{"index": 0, "message": {"role": "assistant", "content": out_msg}, "finish_reason": "stop"}]
            }
        except Exception as ve:
            err_detail = str(ve)
            if hasattr(ve, "response") and ve.response is not None:
                err_detail += f" | Response: {ve.response.text}"
            print("Vision Exception:", err_detail)
            raise HTTPException(status_code=500, detail=f"Moondream vision error: {err_detail}")

    supports_tools = await model_supports_tools(target_model)
    payload = {
        "model": target_model,
        "messages": incoming_messages,
        "stream": False,
        **tool_payload_extras(supports_tools),
    }

    await broadcast_to_managers(f"\u001b[33m[BRAIN RUNNING] Model '{target_model}' processing {len(incoming_messages)} messages in VRAM...\u001b[0m")

    try:
        async with httpx.AsyncClient(timeout=180.0) as client:
            res = await client.post(f"{OLLAMA_URL}/v1/chat/completions", json=payload)
            if not res.is_success and target_model != available_model:
                target_model = available_model
                supports_tools = await model_supports_tools(target_model)
                payload = {"model": target_model, "messages": incoming_messages, "stream": False,
                           **tool_payload_extras(supports_tools)}
                res = await client.post(f"{OLLAMA_URL}/v1/chat/completions", json=payload)
        res.raise_for_status()
        res_json = res.json()
        last_res_json = res_json
        message = res_json.get("choices", [{}])[0].get("message", {})
        response_text = message.get("content") or ""
        native_calls = message.get("tool_calls") or []
        await broadcast_to_managers(f"\u001b[32m[BRAIN COMPLETE] Model '{target_model}' generated {len(response_text)} chars.\u001b[0m")
        # Autonomous Multi-Turn Tool & Micro-Agent Execution Loop (Up to 5 turns)
        turn_count = 0
        tools_used = []
        # Captured before the loop rewrites incoming_messages with tool-result turns.
        last_user_msg = next((m.get("content", "") for m in reversed(incoming_messages)
                              if m.get("role") == "user" and isinstance(m.get("content"), str)), "")
        while turn_count < 5:
            calls = collect_tool_calls(response_text, native_calls)
            if not calls:
                break
            results = []
            for call, raw in calls:
                output_str = await execute_tool_call(call, broadcast_to_managers)
                tools_used.append(describe_tool_call(call, output_str or ""))
                results.append((call, raw, output_str))
            # A text-protocol call that ran nothing has no result to report back. A native
            # one still gets a `tool` message saying so, which lets the model correct itself.
            if not native_calls and not results[0][2]:
                break

            incoming_messages = append_tool_round(flatten_messages(incoming_messages), response_text, results)
            payload = {"model": target_model, "messages": incoming_messages, "stream": False,
                       **tool_payload_extras(supports_tools)}

            await broadcast_to_managers(f"\u001b[33m[BRAIN RUNNING] Model '{target_model}' processing tool turn #{turn_count + 2} in VRAM...\u001b[0m")
            async with httpx.AsyncClient(timeout=180.0) as client:
                followup_res = await client.post(f"{OLLAMA_URL}/v1/chat/completions", json=payload)
            if not followup_res.is_success:
                break

            res_json = followup_res.json()
            last_res_json = res_json
            message = res_json.get("choices", [{}])[0].get("message", {})
            response_text = message.get("content") or ""
            native_calls = message.get("tool_calls") or []
            await broadcast_to_managers(f"\u001b[32m[BRAIN COMPLETE] Model '{target_model}' generated {len(response_text)} chars on turn #{turn_count + 2}.\u001b[0m")
            turn_count += 1

        # Sanitize only freestanding un-executed JSON tool blocks (not mixed into prose)
        if response_text:
            sanitized = strip_model_tool_artifacts(response_text)
            # Only strip bare JSON blocks if they are the ONLY content
            if sanitized != response_text:
                response_text = sanitized if sanitized else response_text

        if last_res_json and last_res_json.get("choices"):
            last_res_json["choices"][0]["message"]["content"] = response_text
        # Same provenance the streaming path returns, on the vision/Gemini path too —
        # otherwise badges would silently vanish for image replies.
        if not tools_used and answer_needed_lookup(last_user_msg):
            tools_used = [dict(UNVERIFIED_BADGE)]
        if last_res_json is not None:
            last_res_json["bmo_tools"] = tools_used

        await broadcast_to_managers(f"\u001b[36m[RESPONSE READY] Sending {len(response_text)} chars to the user.\u001b[0m")
        return last_res_json
    except Exception as e:
        # Emergency retry with available_model
        try:
            payload["model"] = available_model
            payload.pop("tools", None)
            payload.pop("temperature", None)
            async with httpx.AsyncClient(timeout=180.0) as client:
                res = await client.post(f"{OLLAMA_URL}/v1/chat/completions", json=payload)
            res.raise_for_status()
            return res.json()
        except Exception as retry_e:
            await broadcast_to_managers(f"\u001b[31m[ERROR] Ollama Brain Error: {retry_e}\u001b[0m")
            raise HTTPException(status_code=500, detail=str(retry_e))


    finally:
        executor.current_task = "IDLE"

# ============================================================================
# STREAMING CHAT — /v1/chat/stream
#
# /v1/chat/completions above stays untouched as the safe non-streaming fallback
# (used by vision/Moondream, Gemini, and any client that doesn't opt into SSE).
# This is a separate endpoint rather than a rewrite of that one, on purpose —
# it shares the tool dispatcher (execute_tool_call) but duplicates the small
# model-resolution/system-prompt setup rather than risk touching the endpoint
# already verified against a live tool-call round trip.
#
# The hard part: the tool loop needs a COMPLETE turn's text before it can decide
# whether to run a tool, but streaming wants to show text as it arrives. Resolved
# by holding back the first ~40 chars of each turn to (a) pull out a [face:xxx]
# tag before it ever reaches the client and (b) detect whether this turn is a
# tool call — if so, nothing is streamed to the client for that turn at all.
#
# That head-check only catches a tool call that starts immediately. A chatty model
# routinely emits a few sentences of preamble first, then the JSON — fenced or bare,
# extract_tool_call() below accepts both — and that preamble already streamed as
# normal text before we could tell. LATE_GATE_RE watches for the tool-call schema's
# own signature ({"tool" / {"tool_call"), not just a fence, so it catches both forms
# as they arrive anywhere later in the same turn — gating mid-stream instead of only
# swapping in the sanitized text once the
# whole tool round-trip finishes (the flash-then-replace behavior this fixes).
# ============================================================================

FACE_TAG_RE = re.compile(r'\[face:\s*([a-zA-Z0-9_-]+)\]', re.I)

# The face tag is meant to appear exactly once, at the very start — the emotion is read
# off it and the tag itself never reaches the user. Small models don't always comply:
# they sprinkle extra tags mid-reply, often wrapped in asterisks (`*[face:victory]*`), and
# a count=1 strip left those sitting in the visible text and in what TTS reads aloud.
# Strips every tag plus the emphasis markers left orphaned around it.
def strip_face_tags(text: str) -> str:
    if not text:
        return text
    cleaned = re.sub(r'\*{1,2}\s*' + FACE_TAG_RE.pattern + r'\s*\*{1,2}', '', text, flags=re.I)
    cleaned = FACE_TAG_RE.sub("", cleaned)
    return re.sub(r'[ \t]{2,}', ' ', cleaned)


# A model must never be able to fake a tool result in user-visible text. Small models
# imitate the [TOOL EXECUTION RESULT] framing they've seen in their own context and
# emit an invented block — observed live: a fabricated weather payload presented as
# real data. Only the executor produces genuine results; anything the model writes
# with these markers is fiction, so cut from the marker onward.
# A model claiming an action it never performed is the worst failure mode here: the user
# is told a file exists when it does not. Small models do this intermittently no matter
# how firmly the system prompt forbids it, so detect the claim and force a real attempt
# rather than trusting the prose.
CLAIMED_ACTION_RE = re.compile(
    r"\b(i(?:'| ha)?ve (?:created|written|added|saved|made)|i(?:'ll| will) (?:create|write|add|save|make)"
    r"|here'?s? (?:is )?(?:the|your|a) [^.\n]{0,40}(?:file|note|script|markdown)"
    r"|here'?s how it looks|i (?:created|added|wrote|saved)"
    # Claiming a lookup it never performed. Answering from memory is how you get
    # confidently-wrong facts presented as researched ones.
    r"|here'?s what i (?:found|got)|i (?:looked (?:it )?up|searched|found (?:that|this))"
    r"|according to (?:my search|wikipedia|the search)"
    # Promising a lookup is the same failure as promising a file: "I'll check the
    # forecast for tomorrow!" streamed back in two seconds with no tool call, and the
    # user has a confident sentence and no data. Future tense counts.
    r"|(?:i'?ll|i will|let me|i'?m going to|i am going to|allow me to) "
    r"(?:just |quickly |now )?(?:check|look|search|find|fetch|get|see|grab|pull|retrieve|consult)"
    r"|(?:checking|searching|looking) (?:it )?(?:up|for|on|into) )\b", re.I)
# A filename with an extension, e.g. notes.md — used with a code fence as the giveaway
# that the model is *showing* a file rather than writing one.
FILENAME_RE = re.compile(r"\b[\w.-]+\.(?:md|txt|py|js|jsx|json|ya?ml|sh|html|css|toml)\b", re.I)

# Tool outputs that mean "this did not work". The model is told the truth and still
# sometimes reports success, so the server has to be able to recognise a failure itself.
TOOL_ERROR_RE = re.compile(
    r"\b(is a directory, not a file|failed to save|refusing to write|outside BMO's workspace"
    r"|no such file|permission denied|command not found|is not installed|error:)", re.I)
SUCCESS_CLAIM_RE = re.compile(
    r"\b(success(?:fully)?|has been (?:created|saved|written)|was (?:created|saved|written)"
    r"|i (?:created|saved|wrote)|all set|done!)\b", re.I)

def contradicts_tool_failure(final_text: str, tool_output: str) -> bool:
    """True when the tool reported failure but the reply claims it worked.

    Observed live: write_file returned \"'<dir>' is a directory, not a file\" and the
    model answered \"The markdown was written successfully!\". Telling someone a file
    exists when it does not is the failure mode this whole guard exists to prevent, so
    the server checks rather than trusting the paraphrase."""
    if not tool_output or not final_text:
        return False
    if not TOOL_ERROR_RE.search(tool_output):
        return False
    return bool(SUCCESS_CLAIM_RE.search(final_text))

# Matching the model's phrasing turned into whack-a-mole — it invents a new way to say
# "here's what I found" every time. Keying off the USER's request is stable: if they
# asked for a lookup or an action, a reply with no tool call did not do it, whatever it
# calls itself.
USER_WANTS_TOOL_RE = re.compile(
    # look ?up missed "look something up" / "look this up for me" — the particle is
    # separated from the verb by the object, which is the ordinary way to say it.
    r"\b(look(?:\s+\w+){0,3}\s+up|search|google|wikipedia|wiki|find out"
    r"|what'?s the weather|weather in|forecast|storms?"
    r"|run |execute |git |ls |cat |grep |uname"
    r"|create (?:a )?(?:file|note|script)|write (?:a )?(?:file|note|script)|make (?:a )?file"
    r"|put a .{0,30}(?:file|markdown|note)|read (?:the )?file|open (?:the )?file)\b", re.I)

def user_requested_tool_action(user_text: str) -> bool:
    """True when the user's message plainly asks BMO to *do* something external."""
    return bool(user_text and USER_WANTS_TOOL_RE.search(user_text))

def claims_action_without_doing(text: str) -> bool:
    """True when the reply presents a file/action as done but carries no tool call.

    Two signals, either is enough: an explicit claim ("I created...", "here's your
    file"), or the subtler pattern of a fenced code block plus a filename — which is how
    a model 'shows you the file' it never wrote. Both only count when no tool call is
    present, since a reply that carries one is about to actually do the thing."""
    if not text or extract_tool_call(text):
        return False
    if CLAIMED_ACTION_RE.search(text):
        return True
    return bool("```" in text and FILENAME_RE.search(text))

FAKE_TOOL_RESULT_RE = re.compile(
    r'\[\s*TOOL[ _]EXECUTION[ _](?:RESULT|SUMMARY)\s*\].*', re.I | re.S)

def strip_model_tool_artifacts(text: str) -> str:
    """Remove un-executed tool-call JSON and any self-invented tool-result blocks."""
    if not text:
        return text
    cleaned = re.sub(r'```(?:json)?\s*\{\s*"tool"[^`]*?\}\s*```', '', text, flags=re.DOTALL)
    cleaned = FAKE_TOOL_RESULT_RE.sub('', cleaned)
    return cleaned.strip()
LATE_GATE_RE = re.compile(r'\{\s*"tool')
STREAM_HEAD_HOLD = 40

def sse(event: dict) -> str:
    return f"data: {json.dumps(event, ensure_ascii=False)}\n\n"

async def prepare_chat_context(body: dict):
    """Model resolution + system prompt injection + context metrics — the same setup
    /v1/chat/completions does, duplicated here rather than shared (see note above).
    Returns (target_model, incoming_messages). Vision/Moondream payloads are rejected;
    callers should route those to /v1/chat/completions, which keeps its own vision path."""
    note_user_activity()  # a live request aborts any in-flight dream
    target_model = body.get("model")
    available_model = get_available_model()

    installed_models = []
    try:
        async with httpx.AsyncClient(timeout=3.0) as client:
            tag_res = await client.get(f"{OLLAMA_URL}/api/tags")
        if tag_res.is_success:
            installed_models = [m["name"] for m in tag_res.json().get("models", [])]
    except Exception:
        pass

    if target_model and installed_models and target_model not in installed_models:
        matching = [m for m in installed_models if target_model in m]
        target_model = matching[0] if matching else available_model
    elif not target_model:
        target_model = available_model

    limit_tokens = await get_model_context_limit(target_model)
    incoming_messages = trim_messages_to_budget(body.get("messages", []), limit_tokens=limit_tokens)

    system_prompt = build_system_prompt()
    if not incoming_messages or incoming_messages[0].get("role") != "system":
        incoming_messages.insert(0, {"role": "system", "content": system_prompt})
    else:
        incoming_messages[0]["content"] = f"{system_prompt}\n\n{incoming_messages[0]['content']}"

    used_tokens = estimate_tokens(incoming_messages)
    last_context_metrics["context_tokens"] = used_tokens
    last_context_metrics["context_limit"] = limit_tokens
    last_context_metrics["context_percent"] = min(100, round((used_tokens / limit_tokens) * 100))
    last_context_metrics["active_messages"] = len(incoming_messages)

    return target_model, incoming_messages

async def stream_ollama_turn(payload: dict):
    """Streams one Ollama turn as typed dict events: {"face"|"delta"|"gated"}, then a
    final internal {"type": "_done", "text": <complete turn text>}. "gated" means this
    turn's text looked like a tool call (JSON/fence) — nothing was or will be streamed
    to the client for it; the caller runs extract_tool_call() on the complete text."""
    stream_payload = {**payload, "stream": True}
    parts, head, decided, gated = [], "", False, False
    late_tail = ""  # short rolling window of streamed content, checked for a late fence start
    calls = {}  # native tool calls, keyed by their stream index
    async with httpx.AsyncClient(timeout=180.0) as client:
        async with client.stream("POST", f"{OLLAMA_URL}/v1/chat/completions", json=stream_payload) as resp:
            async for line in resp.aiter_lines():
                if not line or not line.startswith("data:"):
                    continue
                data = line[5:].strip()
                if data == "[DONE]":
                    break
                try:
                    delta = json.loads(data).get("choices", [{}])[0].get("delta", {})
                except Exception:
                    continue
                # Thinking-capable models (e.g. ornith:9b) put chain-of-thought in a
                # separate `reasoning` field, never mixed into `content` — Ollama already
                # does this split for us, so just forward it as its own event type.
                reasoning_text = delta.get("reasoning") or ""
                if reasoning_text:
                    yield {"type": "thinking", "text": reasoning_text}
                for tc in delta.get("tool_calls") or []:
                    key = tc.get("index", len(calls))
                    slot = calls.get(key)
                    if slot and tc.get("id") and slot["id"] and slot["id"] != tc["id"]:
                        key = f"{key}:{tc['id']}"  # a second call reusing an index
                        slot = None
                    if slot is None:
                        slot = calls[key] = {"id": "", "type": "function",
                                             "function": {"name": "", "arguments": ""}}
                    slot["id"] = tc.get("id") or slot["id"]
                    fn = tc.get("function") or {}
                    slot["function"]["name"] += fn.get("name") or ""
                    args = fn.get("arguments")
                    if isinstance(args, str):
                        slot["function"]["arguments"] += args
                    elif args:
                        slot["function"]["arguments"] = json.dumps(args)
                delta_text = delta.get("content") or ""
                if not delta_text:
                    continue
                parts.append(delta_text)
                if not decided:
                    head += delta_text
                    if len(head) < STREAM_HEAD_HOLD:
                        continue
                    decided = True
                    m = FACE_TAG_RE.search(head)
                    if m:
                        yield {"type": "face", "value": m.group(1).lower()}
                        head = FACE_TAG_RE.sub("", head, count=1)
                    body_str = head.lstrip()
                    if body_str.startswith("{") or body_str.startswith("```"):
                        gated = True
                        yield {"type": "gated"}
                    elif head:
                        yield {"type": "delta", "text": head}
                        late_tail = head[-10:]
                elif not gated:
                    late_tail = (late_tail + delta_text)[-40:]
                    if LATE_GATE_RE.search(late_tail):
                        gated = True
                        yield {"type": "gated"}
                    else:
                        yield {"type": "delta", "text": delta_text}
    text = "".join(parts)
    if not decided:
        m = FACE_TAG_RE.search(text)
        if m:
            yield {"type": "face", "value": m.group(1).lower()}
        body_str = FACE_TAG_RE.sub("", text, count=1).lstrip()
        if body_str.startswith("{") or body_str.startswith("```"):
            yield {"type": "gated"}
        elif body_str:
            yield {"type": "delta", "text": body_str}
    yield {"type": "_done", "text": text, "tool_calls": list(calls.values())}

@app.post("/v1/chat/stream")
async def chat_stream(request: Request, token: str = Depends(get_token)):
    body = await request.json()
    target_model, incoming_messages = await prepare_chat_context(body)
    if "moondream" in target_model:
        raise HTTPException(status_code=400, detail="Vision requests must use /v1/chat/completions, not /v1/chat/stream.")

    async def event_gen():
        nonlocal incoming_messages
        executor.current_task = "THINKING"
        try:
            supports_tools = await model_supports_tools(target_model)
            extras = tool_payload_extras(supports_tools)
            payload = {"model": target_model, "messages": incoming_messages, **extras}
            response_text, native_calls = "", []
            async for evt in stream_ollama_turn(payload):
                if evt["type"] == "_done":
                    response_text, native_calls = evt["text"], evt["tool_calls"]
                else:
                    yield sse(evt)

            # What BMO said before it reached for a tool — "I'll check the forecast!".
            # This used to be thrown away: the retry and the tool round-trip both
            # overwrite response_text, so the sentence streamed onto the screen and was
            # then replaced by a bare answer with nothing connecting the two. Keeping it
            # lets the reply read as one thought — intent, the tool that ran, the answer.
            # Collapse the blank-line gap left where the tool-call JSON was stripped out,
            # so the lead-in reads as the one or two sentences it actually is.
            preamble_text = re.sub(
                r"\n{2,}", " ",
                strip_face_tags(strip_model_tool_artifacts(response_text) or "")).strip()[:300]

            # If the model narrated an action instead of performing one, make it try
            # again — once. Better a retry than telling the user a file exists when it
            # doesn't. See claims_action_without_doing().
            last_user_msg = next((m.get("content", "") for m in reversed(incoming_messages)
                                  if m.get("role") == "user" and isinstance(m.get("content"), str)), "")
            if not collect_tool_calls(response_text, native_calls) and (
                    claims_action_without_doing(response_text)
                    or user_requested_tool_action(last_user_msg)):
                await broadcast_to_managers(
                    "\u001b[33m[GUARD] Reply claimed an action with no tool call — retrying.\u001b[0m")
                yield sse({"type": "status", "text": "RETRYING AS A REAL ACTION"})
                # With native tools, "no tool needed" has to be allowed to come back as an
                # ordinary reply: the JSON-only wording turned a misfire on a plain
                # greeting into a robotic one-liner.
                nudge = (
                    "You described doing that instead of doing it, so nothing happened. If it "
                    "needs a tool, call the tool now, with nothing before it. If it genuinely "
                    "needs no tool, just reply to your friend normally."
                    if supports_tools else
                    "You described doing that instead of doing it, so nothing happened. "
                    "Output ONLY the JSON tool call that actually performs it — no prose, "
                    "no preview, no explanation. If it genuinely needs no tool, say so in "
                    "one short sentence.")
                retry_messages = list(incoming_messages) + [
                    {"role": "assistant", "content": str(response_text)},
                    {"role": "user", "content": nudge},
                ]
                async for evt in stream_ollama_turn({**payload, "messages": retry_messages}):
                    if evt["type"] == "_done":
                        response_text, native_calls = evt["text"], evt["tool_calls"]
                    elif evt["type"] != "delta":
                        yield sse(evt)

            turn_count = 0
            last_tool_output = ""
            tools_used = []
            while turn_count < 5:
                calls = collect_tool_calls(response_text, native_calls)
                if not calls:
                    break
                results = []
                for call, raw in calls:
                    tool_name = call.get("tool") or call.get("tool_call")
                    yield sse({"type": "status", "text": f"TOOL: {tool_name}"})
                    output_str = await execute_tool_call(call, broadcast_to_managers)
                    last_tool_output = output_str or ""
                    # Recorded even when empty: a tool that ran and came back with nothing
                    # still ran, and the user is owed that just as much as a successful one.
                    tools_used.append(describe_tool_call(call, last_tool_output))
                    results.append((call, raw, output_str))
                # A text-protocol call that ran nothing has no result to report back. A
                # native one still gets a `tool` message saying so, so it can correct itself.
                if not native_calls and not results[0][2]:
                    break

                incoming_messages = append_tool_round(flatten_messages(incoming_messages), response_text, results)

                yield sse({"type": "status", "text": f"THINKING (turn {turn_count + 2})"})
                payload = {"model": target_model, "messages": incoming_messages, **extras}
                async for evt in stream_ollama_turn(payload):
                    if evt["type"] == "_done":
                        response_text, native_calls = evt["text"], evt["tool_calls"]
                    else:
                        yield sse(evt)
                turn_count += 1

            # No tool ran, but the question wanted one: say so rather than leave the
            # user unable to tell a grounded answer from an invented one.
            if not tools_used and answer_needed_lookup(last_user_msg):
                tools_used = [dict(UNVERIFIED_BADGE)]

            sanitized = strip_model_tool_artifacts(response_text)
            final_text = strip_face_tags(sanitized if sanitized else response_text).strip()
            if contradicts_tool_failure(final_text, last_tool_output):
                await broadcast_to_managers(
                    "\u001b[31m[GUARD] Reply claimed success after a tool failure — corrected.\u001b[0m")
                final_text = (f"That didn't work, so I haven't done it: {last_tool_output.strip()}")
            # Only worth showing when a tool actually ran and it isn't just the answer
            # again — otherwise it's duplication, not context.
            if not tools_used or not preamble_text or preamble_text in final_text:
                preamble_text = ""
            yield sse({"type": "done", "text": final_text, "model": target_model,
                       "tools": tools_used, "preamble": preamble_text})
        except Exception as e:
            yield sse({"type": "error", "message": str(e)})
        finally:
            executor.current_task = "IDLE"

    return StreamingResponse(event_gen(), media_type="text/event-stream", headers={
        "Cache-Control": "no-cache", "X-Accel-Buffering": "no", "Connection": "keep-alive",
    })

# The Workspace Live Editor UI (Settings > edit SOUL.md/AGENTS.md/MEMORY.md) is meant
# for exactly those three project files — not a general file-write API. BMO's own
# write_file/create_file tool (server.py tool dispatch, above) is intentionally broader
# since BMO is a coding assistant; this allowlist applies only to this HTTP endpoint.
WORKSPACE_EDITABLE_FILES = {"SOUL.md", "AGENTS.md", "MEMORY.md"}

@app.get("/v1/workspace/{f}")
async def get_wf(f: str, token: str = Depends(get_token)):
    if f not in WORKSPACE_EDITABLE_FILES: raise HTTPException(status_code=403)
    c = memory_manager.get_workspace_file(f)
    if c is None: raise HTTPException(status_code=403)
    return {"content": c}

@app.put("/v1/workspace/{f}")
async def save_wf(f: str, file: WorkspaceFile, token: str = Depends(get_token)):
    if f not in WORKSPACE_EDITABLE_FILES: raise HTTPException(status_code=403)
    memory_manager.save_workspace_file(f, file.content)
    return {"status": "saved"}

class HistoryPayload(BaseModel):
    chats: Optional[List[dict]] = []
    messages: Optional[List[dict]] = []

class TitleRequest(BaseModel):
    messages: list = []

@app.post("/v1/chat/title")
async def name_chat(payload: TitleRequest, token: str = Depends(get_token)):
    """Name a chat session from its opening exchange, so the session list shows
    something recognizable instead of 'SESSION #3'.

    Prefers Gemini when a key is set — it answers in ~1s, where the local 9B model
    takes 20s+ on CPU and that latency would be user-visible. Falls back to local,
    then to a truncated first message, so this never blocks or fails a chat."""
    snippet = "\n".join(
        f"{m.get('sender', 'user')}: {str(m.get('text', ''))[:200]}"
        for m in payload.messages[:6] if m.get("text")
    )[:1200]
    first_user = next((str(m.get("text", "")) for m in payload.messages
                       if m.get("sender") == "user" and m.get("text")), "")
    fallback = (first_user[:38].strip() or "New session")

    if not snippet:
        return {"title": fallback}

    prompt = ("Give a 2-5 word title for this chat. Reply with ONLY the title — no "
              "quotes, no punctuation at the end, no preamble.\n\n" + snippet)

    def clean(raw: str) -> str:
        t = (raw or "").strip().strip('"\'').splitlines()[0].strip()
        # Small models like to answer with "Title: X" or add trailing periods.
        if ":" in t[:12]:
            t = t.split(":", 1)[1].strip()
        return t[:40].rstrip(".").strip()

    if GEMINI_API_KEY:
        try:
            url = f"https://generativelanguage.googleapis.com/v1beta/models/{GEMINI_MODEL}:generateContent?key={GEMINI_API_KEY}"
            async with httpx.AsyncClient(timeout=15.0) as client:
                r = await client.post(url, json={"contents": [{"parts": [{"text": prompt}]}]})
            if r.is_success:
                parts = (r.json().get("candidates") or [{}])[0].get("content", {}).get("parts", [])
                title = clean(" ".join(p.get("text", "") for p in parts if p.get("text")))
                if title:
                    return {"title": title}
        except Exception as e:
            print(f"[TITLE] Gemini failed, falling back to local: {e}", flush=True)

    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            r = await client.post(f"{OLLAMA_URL}/v1/chat/completions", json={
                "model": get_available_model(),
                "messages": [{"role": "user", "content": prompt}],
                "max_tokens": 20,
            })
        if r.is_success:
            title = clean(r.json().get("choices", [{}])[0].get("message", {}).get("content", ""))
            if title:
                return {"title": title}
    except Exception as e:
        print(f"[TITLE] local model failed: {e}", flush=True)

    return {"title": fallback}

@app.get("/v1/chat/history")
async def get_hist(token: str = Depends(get_token)):
    if os.path.exists("history.json"):
        with open("history.json", "r") as f: return json.load(f)
    return {"chats": [], "messages": []}

@app.post("/v1/chat/history")
async def save_hist(payload: HistoryPayload, token: str = Depends(get_token)):
    try:
        with open("history.json", "w") as f:
            json.dump({"chats": payload.chats, "messages": payload.messages}, f, indent=2)
        return {"status": "saved"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/v1/git/status")
async def git_status(token: str = Depends(get_token)):
    try:
        proc = await asyncio.create_subprocess_shell("git status --short", stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
        stdout, _ = await proc.communicate()
        return {"status": stdout.decode().strip() or "Clean working tree"}
    except Exception as e:
        return {"status": f"Error: {e}"}

@app.get("/v1/git/diff")
async def git_diff(token: str = Depends(get_token)):
    try:
        proc = await asyncio.create_subprocess_shell("git diff", stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
        stdout, _ = await proc.communicate()
        return {"diff": stdout.decode().strip() or "No uncommitted diff"}
    except Exception as e:
        return {"diff": f"Error: {e}"}

@app.post("/v1/git/push")
async def git_push(token: str = Depends(get_token)):
    await broadcast_to_managers("\u001b[33m[GIT PUSH] Pushing checkpoint to remote repository...\u001b[0m")
    try:
        proc = await asyncio.create_subprocess_shell("git add . && git commit -m 'checkpoint: remote update via BMO' && git push origin main", stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
        stdout, stderr = await proc.communicate()
        output = stdout.decode().strip() + "\n" + stderr.decode().strip()
        await broadcast_to_managers(f"\u001b[32m[GIT PUSH] Result: {output[:100]}\u001b[0m")
        return {"status": "pushed", "output": output}
    except Exception as e:
        return {"status": "error", "error": str(e)}

@app.get("/v1/scratch/files")
async def list_scratch_files(token: str = Depends(get_token)):
    try:
        files = os.listdir(SCRATCH_DIR)
        return {"files": files, "count": len(files)}
    except Exception as e:
        return {"files": [], "error": str(e)}

@app.delete("/v1/scratch/clean")
async def clean_scratch(token: str = Depends(get_token)):
    try:
        count = 0
        for f in os.listdir(SCRATCH_DIR):
            fp = os.path.join(SCRATCH_DIR, f)
            if os.path.isfile(fp):
                os.remove(fp)
                count += 1
        return {"status": "cleaned", "removed_count": count}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/v1/approve")
async def approve_cmd(token: str = Depends(get_token)):
    if executor.approval_future and not executor.approval_future.done():
        executor.approval_future.set_result(True)
        return {"status": "approved"}
    return {"status": "no pending command"}

@app.post("/v1/reject")
async def reject_cmd(token: str = Depends(get_token)):
    if executor.approval_future and not executor.approval_future.done():
        executor.approval_future.set_result(False)
    await broadcast_to_managers("\u001b[31m[SENTINEL] Command rejected by user.\u001b[0m")
    return {"status": "rejected"}

@app.websocket("/v1/ws")
async def ws_telemetry(websocket: WebSocket, token: str = ""):
    # Browsers can't set custom headers on a WebSocket handshake, so auth rides in the
    # query string instead of the Authorization header get_token() checks elsewhere.
    if not API_TOKEN or token != API_TOKEN:
        await websocket.close(code=4401)
        return

    await manager.connect(websocket)
    try:
        cpu_val = psutil.cpu_percent() if psutil else 0.0
        ram_val = psutil.virtual_memory().percent if psutil else 0.0
        disk_val = psutil.disk_usage('/').percent if psutil else 0.0
        await websocket.send_text(json.dumps({
            "type": "snapshot",
            "lines": telemetry_buffer[-100:],
            "metrics": {
                "cpu": cpu_val, "ram": ram_val, "disk": disk_val,
                "task": executor.current_task,
                "context_tokens": last_context_metrics["context_tokens"],
                "context_limit": last_context_metrics["context_limit"],
                "context_percent": last_context_metrics["context_percent"],
                "active_messages": last_context_metrics["active_messages"],
            },
            "pending_command": executor.pending_command,
            **runtime_state,
        }))
        # Nothing meaningful ever arrives from the client -- this just blocks until the
        # socket closes, so disconnects raise WebSocketDisconnect and hit the finally below.
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        manager.disconnect(websocket)

async def metrics_broadcaster():
    """Pushes live system metrics to any connected /v1/ws clients every 2s. Skips all
    work (including the psutil calls) when nobody's connected, unlike the polling it
    replaces which always ran on a timer regardless of whether anyone was watching."""
    while True:
        await asyncio.sleep(2)
        if not manager.active_connections:
            continue
        cpu_val = psutil.cpu_percent() if psutil else 0.0
        ram_val = psutil.virtual_memory().percent if psutil else 0.0
        disk_val = psutil.disk_usage('/').percent if psutil else 0.0
        await manager.broadcast(json.dumps({
            "type": "metrics",
            "cpu": cpu_val, "ram": ram_val, "disk": disk_val,
            "task": executor.current_task,
            "context_tokens": last_context_metrics["context_tokens"],
            "context_limit": last_context_metrics["context_limit"],
            "context_percent": last_context_metrics["context_percent"],
            "active_messages": last_context_metrics["active_messages"],
        }))

# ============================================================================
# OTA WEB-BUNDLE UPDATES  (self-hosted @capgo/capacitor-updater)
#
# The Android app is a WebView around the same `dist/` bundle the server already
# serves. Without this, changing one line of UI meant rebuilding and side-loading a
# whole APK. With it, `git pull && npm run build` on the host is the update: the app
# checks in, sees a different bundle, downloads it, and swaps it in on next launch.
# Only native changes — a new Capacitor plugin, a permission, the Android shell —
# still need a real APK.
#
# Self-hosted on purpose. The plugin's defaults point at Capgo's cloud; `updateUrl`
# is repointed at YOUR server at runtime (src/utils/liveUpdate.js) using the address
# already configured in Settings, and `statsUrl` is blanked so nothing phones home.
#
# These two endpoints are deliberately UNAUTHENTICATED, for the same reason
# `/assets` is: they serve the compiled web bundle, which since the token fix
# carries no secret whatsoever. Anyone who can already GET /assets/index-*.js can
# get the identical bytes here. Do not put anything in `dist/` you wouldn't serve
# to an unauthenticated caller — that was true before this endpoint existed.
# ============================================================================
WEB_BUNDLE_DIR = os.path.join(WORKSPACE_DIR, "dist")
WEB_BUNDLE_CACHE = os.path.join(WORKSPACE_DIR, ".webbundles")
_bundle_cache = {"version": None, "zip_path": None, "checksum": None}

def _read_app_version() -> str:
    """package.json's version, so a bundle id reads like 7.4.0-a1b2c3d4."""
    try:
        with open(os.path.join(WORKSPACE_DIR, "package.json"), "r", encoding="utf-8") as f:
            return str(json.load(f).get("version") or "0.0.0")
    except Exception:
        return "0.0.0"

def _walk_bundle_files():
    for root, _dirs, files in os.walk(WEB_BUNDLE_DIR):
        for name in sorted(files):
            full = os.path.join(root, name)
            yield full, os.path.relpath(full, WEB_BUNDLE_DIR).replace(os.sep, "/")

def compute_bundle_version() -> str:
    """Content hash of dist/, so any rebuild that changes a byte is a new version.

    Hashing content rather than mtimes on purpose: `npm run build` rewrites every
    file every time, so an mtime-based id would hand the phone a fresh 'update' after
    a no-op rebuild and re-download the same bytes."""
    h = hashlib.sha256()
    for full, rel in _walk_bundle_files():
        h.update(rel.encode("utf-8"))
        with open(full, "rb") as fh:
            for chunk in iter(lambda: fh.read(65536), b""):
                h.update(chunk)
    return f"{_read_app_version()}-{h.hexdigest()[:8]}"

def ensure_bundle_zip():
    """Zip dist/ (flat — index.html at the root, which is what the plugin expects)
    and return {version, zip_path, checksum}. Cached until the content changes."""
    if not os.path.isdir(WEB_BUNDLE_DIR):
        return None
    version = compute_bundle_version()
    if _bundle_cache["version"] == version and os.path.exists(_bundle_cache["zip_path"] or ""):
        return dict(_bundle_cache)

    os.makedirs(WEB_BUNDLE_CACHE, exist_ok=True)
    zip_path = os.path.join(WEB_BUNDLE_CACHE, f"{version}.zip")
    if not os.path.exists(zip_path):
        tmp = zip_path + ".partial"
        with zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as zf:
            for full, rel in _walk_bundle_files():
                zf.write(full, rel)
        os.replace(tmp, zip_path)  # never leave a half-written zip at the real name

    h = hashlib.sha256()
    with open(zip_path, "rb") as fh:
        for chunk in iter(lambda: fh.read(65536), b""):
            h.update(chunk)

    _bundle_cache.update({"version": version, "zip_path": zip_path, "checksum": h.hexdigest()})

    # Keep only the current zip; every superseded build is dead weight.
    for stale in os.listdir(WEB_BUNDLE_CACHE):
        if stale != os.path.basename(zip_path):
            try:
                os.remove(os.path.join(WEB_BUNDLE_CACHE, stale))
            except OSError:
                pass
    return dict(_bundle_cache)

@app.post("/v1/updates/check")
async def updates_check(request: Request):
    """Update check for the Android app. The plugin POSTs its device/bundle info;
    we answer with a download when our bundle differs from the one it is running.

    The comparison is made HERE rather than left to the plugin: it decides by
    string-comparing whatever we return against its own bundle id, and answering
    'no update' explicitly is the unambiguous way to say nothing changed."""
    try:
        body = await request.json()
    except Exception:
        body = {}
    info = ensure_bundle_zip()
    if not info:
        return {"message": "No web bundle built on this server yet."}

    device_version = str(body.get("version_name") or "")
    if device_version == info["version"]:
        return {"message": "No update available"}

    base = str(request.base_url).rstrip("/")
    await broadcast_to_managers(
        f"\u001b[36m[UPDATE] Offering web bundle {info['version']} "
        f"(device has {device_version or 'unknown'}).\u001b[0m")
    return {
        "version": info["version"],
        "url": f"{base}/v1/updates/bundle/{info['version']}.zip",
        "checksum": info["checksum"],
    }

@app.get("/v1/updates/bundle/{filename}")
async def updates_bundle(filename: str):
    """Serve the current web bundle zip. Only the current version is downloadable —
    the name is checked against it rather than joined onto a path, so this cannot be
    walked into an arbitrary file."""
    info = ensure_bundle_zip()
    if not info or filename != f"{info['version']}.zip":
        raise HTTPException(status_code=404, detail="Unknown or superseded bundle.")
    return FileResponse(info["zip_path"], media_type="application/zip", filename=filename)

@app.get("/v1/updates/current")
async def updates_current(token: str = Depends(get_token)):
    """What this server would hand out. Handy for checking a release landed."""
    info = ensure_bundle_zip()
    if not info:
        return {"version": None, "message": "No dist/ build on this server."}
    return {"version": info["version"], "checksum": info["checksum"],
            "size_bytes": os.path.getsize(info["zip_path"])}

# MOUNT UI (Must be last)
if os.path.exists("dist"):
    app.mount("/assets", StaticFiles(directory="dist/assets"), name="assets")
    @app.get("/{full_path:path}")
    async def serve_ui(full_path: str):
        if full_path.startswith("v1/"):
            raise HTTPException(status_code=404)
        return FileResponse("dist/index.html")
else:
    @app.get("/")
    async def root():
        return {"status": "BMO KERNEL ACTIVE (UI NOT BUILT)", "version": "6.8.1"}
