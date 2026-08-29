#!/usr/bin/env python3
"""Verify a BMO install end to end and say plainly what to fix.

Written for the moment right after `git clone`, when the usual question is "did I set
this up right?" — so every failure names the specific thing to change rather than
printing a status code and leaving you to guess.

    python3 scripts/check_setup.py
"""
import importlib.util
import json
import os
import re
import shutil
import subprocess
import sys
import urllib.error
import urllib.request

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

OLLAMA = os.getenv("OLLAMA_URL", "http://localhost:11434").rstrip("/")
TOKEN = os.getenv("API_TOKEN") or os.getenv("VITE_BMO_API_KEY") or ""
PORT = os.getenv("BMO_PORT", "18789")
BMO = os.getenv("BMO_CHECK_URL", f"http://localhost:{PORT}").rstrip("/")

GREEN, RED, YELLOW, DIM, RESET = "\033[32m", "\033[31m", "\033[33m", "\033[2m", "\033[0m"
results = []


def report(ok, name, detail="", fix=""):
    results.append(ok)
    mark = f"{GREEN}PASS{RESET}" if ok else f"{RED}FAIL{RESET}"
    print(f"  [{mark}] {name}")
    if detail:
        print(f"         {DIM}{detail}{RESET}")
    if not ok and fix:
        print(f"         {YELLOW}fix: {fix}{RESET}")


def warn(name, detail):
    print(f"  [{YELLOW}WARN{RESET}] {name}")
    print(f"         {DIM}{detail}{RESET}")


def get(url, token=None, timeout=10):
    req = urllib.request.Request(url)
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.status, json.loads(r.read().decode())


def post(url, payload, token=None, timeout=180):
    req = urllib.request.Request(
        url, data=json.dumps(payload).encode(), method="POST")
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.status, json.loads(r.read().decode())


print("\nBMO setup check")
print("=" * 58)

# 1. Configuration
if not TOKEN:
    report(False, "API token configured", "",
           "cp .env.example .env, then set VITE_BMO_API_KEY to a random secret")
elif TOKEN == "bmo-secret-key-2026":
    report(True, "API token configured", "using the well-known default")
    warn("Token is the public default",
         "Anyone who reads the source knows it. Generate your own before exposing "
         "BMO beyond localhost:  python3 -c \"import secrets; print(secrets.token_urlsafe(32))\"")
else:
    report(True, "API token configured", f"{len(TOKEN)} chars")

# Carried over from before the cloud brain moved server-side. Anyone upgrading still has
# this in their .env. The server does still read it as a fallback, so the warning has to
# say "deprecated", not "unused" — telling someone their working key does nothing sends
# them chasing a problem they don't have. The real hazard is the VITE_ prefix itself.
if os.getenv("VITE_GEMINI_API_KEY"):
    warn("VITE_GEMINI_API_KEY is set — deprecated, rename it to GEMINI_API_KEY",
         "The server still honours this name as a fallback, so your cloud brain works. "
         "But anything VITE_-prefixed is baked into the client bundle in plaintext, "
         "including any APK you build and share. Rename it to GEMINI_API_KEY in .env, and "
         "revoke the old key if you have ever distributed a build made with it.")

# 2. Ollama
try:
    _, tags = get(f"{OLLAMA}/api/tags", timeout=5)
    models = [m["name"] for m in tags.get("models", [])]
    chat_models = [m for m in models if "moondream" not in m and "llava" not in m]
    report(True, "Ollama reachable", f"{OLLAMA} — {len(models)} model(s)")
    if chat_models:
        report(True, "A chat model is installed", ", ".join(chat_models[:3]))
    else:
        report(False, "A chat model is installed", "only vision models found",
               "ollama pull qwen2.5:3b")
except Exception as e:
    report(False, "Ollama reachable", str(e)[:70],
           "start it with `ollama serve`, or set OLLAMA_URL in .env")
    chat_models = []

# 3. Context window — the quiet one that makes BMO seem forgetful
if chat_models:
    try:
        _, ps = get(f"{OLLAMA}/api/ps", timeout=5)
        loaded = {m.get("name"): m.get("context_length") for m in ps.get("models", [])}
        ctx = next((v for v in loaded.values() if v), None)
        if ctx is None:
            warn("Model context window",
                 "No model loaded yet, so its real context is unknown. Send BMO a "
                 "message, then re-run this check.")
        elif ctx < 8192:
            warn("Model context window",
                 f"Only {ctx} tokens — BMO will forget things mid-conversation. "
                 "See the README section 'Context window' to raise num_ctx.")
        else:
            report(True, "Model context window", f"{ctx} tokens")
    except Exception:
        pass

# 4. BMO server
server_up = False
try:
    _, health = get(f"{BMO}/v1/health", timeout=5)
    server_up = True
    report(health.get("backend") == "OK", "BMO server reachable",
           f"{BMO} — ollama link: {health.get('ollama')}, model: {health.get('active_model')}")
except Exception as e:
    report(False, "BMO server reachable", str(e)[:70],
           "start it with ./wake-bmo.sh")

# 5. Auth
if server_up:
    try:
        status, _ = get(f"{BMO}/v1/models", token=TOKEN, timeout=8)
        report(status == 200, "Token accepted by the server")
    except urllib.error.HTTPError as e:
        if e.code == 401:
            report(False, "Token accepted by the server", "401 Unauthorized",
                   "the token in .env doesn't match the server's. If you set "
                   "BMO_SHARED_TOKEN=off, pair a device instead — the server prints a "
                   "pairing code at startup when none are enrolled.")
        else:
            report(False, "Token accepted by the server", f"HTTP {e.code}")
    except Exception as e:
        report(False, "Token accepted by the server", str(e)[:70])

# 6. A real round trip
if server_up and chat_models:
    try:
        print(f"  {DIM}...asking BMO to reply (first run loads the model, be patient){RESET}")
        status, data = post(f"{BMO}/v1/chat/completions",
                            {"messages": [{"role": "user", "content": "Say OK"}]},
                            token=TOKEN)
        text = data.get("choices", [{}])[0].get("message", {}).get("content", "")
        report(bool(text.strip()), "BMO answers a message", text.strip()[:60])
    except urllib.error.HTTPError as e:
        report(False, "BMO answers a message", f"HTTP {e.code}")
    except Exception as e:
        report(False, "BMO answers a message", str(e)[:70])

# 7. Optional extras — absence is fine, so these never fail the run
print(f"\n  {DIM}Optional:{RESET}")
voice = importlib.util.find_spec("faster_whisper") is not None
print(f"    voice input (push-to-talk): "
      f"{'installed' if voice else 'not installed — pip install -r requirements-voice.txt'}")
# Mirror server.py's own lookup, which falls back to the deprecated VITE_ name. Checking
# only GEMINI_API_KEY reported "local-only" to people whose cloud brain was in fact live.
gem = bool(os.getenv("GEMINI_API_KEY") or os.getenv("VITE_GEMINI_API_KEY"))
print(f"    cloud brain (Gemini):      "
      f"{'key set' if gem else 'no key — local-only, which is a fine way to run BMO'}")
print(f"    aider micro-agent:         "
      f"{'installed' if shutil.which('aider') else 'not installed — pip install aider-install'}")

# Only matters if you build the APK, but the failure it prevents is a bad one: Gradle
# runs for two minutes before dying on "invalid source release: 21", which reads like a
# project bug rather than a JDK that's too old.
java_note = "not installed — only needed to build the Android APK"
if shutil.which("java"):
    try:
        out = subprocess.run(["java", "-version"], capture_output=True, text=True, timeout=10)
        raw = (out.stderr or out.stdout).splitlines()[0] if (out.stderr or out.stdout) else ""
        m = re.search(r'"(\d+)', raw)
        major = int(m.group(1)) if m else 0
        if major >= 21:
            java_note = f"Java {major}"
        elif major:
            java_note = (f"Java {major} — too old to build the APK. Capacitor 8 needs 21; "
                         f"install a JDK 21 (the server itself doesn't need Java at all)")
        else:
            java_note = f"installed, version unreadable ({raw[:40]})"
    except Exception:
        java_note = "installed, but `java -version` failed"
print(f"    JDK (for APK builds):      {java_note}")

print("=" * 58)
failed = results.count(False)
if failed:
    print(f"{RED}{failed} check(s) failed.{RESET} Fix the items above and re-run.\n")
    sys.exit(1)
print(f"{GREEN}Everything checks out — BMO is ready.{RESET}\n")
