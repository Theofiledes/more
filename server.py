import os
import json
import requests
import asyncio
import signal
import sys
from fastapi import FastAPI, Request, HTTPException, Depends, status, WebSocket, WebSocketDisconnect
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from typing import List, Optional, Union
from pydantic import BaseModel
from git import Repo
import base64
import time

try:
    import psutil
except ImportError:
    psutil = None

from memory_manager import memory_manager

app = FastAPI()
auth_scheme = HTTPBearer()

OLLAMA_URL = os.getenv("OLLAMA_URL", "http://localhost:11434")
CLOUD_API_URL = os.getenv("CLOUD_API_URL", "https://generativelanguage.googleapis.com")
API_TOKEN = os.getenv("API_TOKEN", "bmo-secret-key-2026")
DEFAULT_MODEL = os.getenv("OLLAMA_MODEL", "ornith:9b")
WORKSPACE_DIR = os.path.dirname(os.path.abspath(__file__))
LOGS_DIR = os.path.join(WORKSPACE_DIR, "logs")
os.makedirs(LOGS_DIR, exist_ok=True)

SCRATCH_DIR = os.path.join(WORKSPACE_DIR, "scratch")
os.makedirs(SCRATCH_DIR, exist_ok=True)

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
                            except Exception as e:
                                print("Error caching image to scratch:", e)

class WorkspaceFile(BaseModel):
    content: str

class AgentExecutor:
    def __init__(self):
        self.active_process = None
        self.pending_command = None
        self.current_task = "IDLE"
        self.repo = None
        try:
            repo_path = os.getcwd()
            self.repo = Repo(repo_path)
        except Exception:
            pass

    async def checkpoint(self):
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

    def kill(self):
        if self.active_process:
            try: self.active_process.kill()
            except: pass
        return True

executor = AgentExecutor()

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
                for cm in chat_models:
                    if "ornith" in cm:
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

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY") or os.getenv("VITE_GEMINI_API_KEY")

async def perform_dream_synthesis():
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

    # Fallback to scratch files & git activity if chat history is sparse
    if not text_sample:
        try:
            proc = await asyncio.create_subprocess_shell("git log -n 5 --oneline", stdout=asyncio.subprocess.PIPE)
            out, _ = await proc.communicate()
            text_sample = f"Recent Git Commits:\n{out.decode().strip()}"
        except Exception:
            text_sample = "BMO app initialized with local vision, scratch storage, and full terminal control."

    prompt = f"You are BMO's Dream Synthesizer. Summarize key user preferences, milestones, or important project facts from this context into 1 concise bullet point in BMO voice (max 25 words):\n\n{text_sample[:1500]}"

    summary = ""
    # 1. Try Gemini API if key is available
    if GEMINI_API_KEY:
        try:
            await broadcast_to_managers("\u001b[35m[DREAM SYNTHESIS] Calling Gemini Cloud API for deep dream distillation...\u001b[0m")
            url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key={GEMINI_API_KEY}"
            g_payload = {
                "contents": [{"parts": [{"text": prompt}]}]
            }
            res = requests.post(url, json=g_payload, timeout=20)
            if res.ok:
                summary = res.json().get("candidates", [{}])[0].get("content", {}).get("parts", [{}])[0].get("text", "").strip()
        except Exception as e:
            print("Gemini Dream Synthesis failed, falling back to local model:", e)

    # 2. Fallback to Local Ollama Model if Gemini is unavailable
    if not summary:
        try:
            model = get_available_model()
            await broadcast_to_managers(f"\u001b[35m[DREAM SYNTHESIS] Using local model '{model}' for memory distillation...\u001b[0m")
            res = requests.post(f"{OLLAMA_URL}/v1/chat/completions",
                                json={"model": model, "messages": [{"role": "user", "content": prompt}], "max_tokens": 100},
                                timeout=30)
            if res.ok:
                summary = res.json().get("choices", [{}])[0].get("message", {}).get("content", "").strip()
        except Exception as e:
            print("Local Dream Synthesis error:", e)

    if summary:
        fact = f"Dream Milestone: {summary}"
        memory_manager.add_fact(fact)
        memory_manager.save_workspace_file("MEMORY.md", f"\n- {fact}", append=True)
        await broadcast_to_managers(f"\u001b[32m[DREAM SYNTHESIS] New Memory Formed: '{summary}'\u001b[0m")
        return summary

    return None

async def dream_synthesis_cron():
    """Nightly / periodic background job to condense chat history into MEMORY.md."""
    while True:
        await asyncio.sleep(1800) # Every 30 minutes
        await perform_dream_synthesis()

@app.on_event("startup")
async def startup():
    asyncio.create_task(watchdog())
    asyncio.create_task(heartbeat())
    asyncio.create_task(pre_warm_brain())
    asyncio.create_task(dream_synthesis_cron())

async def pre_warm_brain():
    await asyncio.sleep(3)
    target_model = get_available_model()
    await broadcast_to_managers(f"\u001b[35m[SYSTEM] Pre-warming local model '{target_model}' into VRAM...\u001b[0m")
    try:
        res = requests.post(f"{OLLAMA_URL}/v1/chat/completions",
                            json={"model": target_model, "messages": [{"role": "user", "content": "ping"}], "max_tokens": 1},
                            timeout=30)
        if res.ok:
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

app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])

def get_token(auth: HTTPAuthorizationCredentials = Depends(auth_scheme)):
    if auth.credentials != API_TOKEN: raise HTTPException(status_code=401)
    return auth.credentials

@app.get("/v1/health")
async def health():
    s = {"backend": "OK", "bmo_kernel": "OK", "ollama": "OFFLINE", "active_model": get_available_model()}
    try:
        res = requests.get(f"{OLLAMA_URL}/api/tags", timeout=3)
        if res.ok: s["ollama"] = "OK"
    except Exception: pass
    return s

@app.post("/v1/system/repair")
async def repair(token: str = Depends(get_token)):
    await broadcast_to_managers("\u001b[33m[SYSTEM] Self-repair initiated...\u001b[0m")
    return {"status": "ok", "message": "Ollama connection refreshed"}

@app.post("/v1/system/dream")
async def trigger_dream(token: str = Depends(get_token)):
    await broadcast_to_managers("\u001b[35m[DREAM SYNTHESIS] Manual dream command triggered...\u001b[0m")
    fact = await perform_dream_synthesis()
    return {"status": "ok", "message": "Dream Synthesis complete!", "fact": fact or "No new milestones to synthesize."}

@app.post("/v1/system/sleep")
async def trigger_sleep(token: str = Depends(get_token)):
    await broadcast_to_managers("\u001b[35m[BEDTIME SLEEP MODE] User said goodnight. BMO entering dream state...\u001b[0m")
    summary = await perform_dream_synthesis()
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
async def telemetry_state(token: str = Depends(get_token)):
    return {"status": "ok", "state": "nominal"}

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

@app.get("/v1/tools/search")
async def web_search(query: str, token: str = Depends(get_token)):
    """Fetch live web search summary for BMO."""
    try:
        res = requests.get(f"https://api.duckduckgo.com/?q={query}&format=json&no_html=1&skip_disambig=1", timeout=10)
        if res.ok:
            data = res.json()
            abstract = data.get("AbstractText") or data.get("Heading") or "No direct summary found."
            return {"status": "success", "query": query, "summary": abstract}
    except Exception as e:
        return {"status": "error", "message": str(e)}
    return {"status": "error", "message": "Search query failed."}

last_context_metrics = {
    "context_tokens": 350,
    "context_limit": 8192,
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

MICRO_AGENTS = {
    "@android_debugger": {
        "model": "moondream",
        "prompt": "You are @android_debugger. Filter adb logcat traces, identify FATAL EXCEPTIONs / NullPointerExceptions, locate failing line in android/ or src/, and draft a fix."
    },
    "@ui_polisher": {
        "model": "ornith:9b",
        "prompt": "You are @ui_polisher. Review frontend src/App.jsx and CSS components. Propose high-impact aesthetic enhancements, smooth transitions, retro game colors, and micro-animations."
    },
    "@code_auditor": {
        "model": "ornith:9b",
        "prompt": "You are @code_auditor. Inspect recent git diffs (`git status`, `git diff`). Verify path safety, input validation, resource efficiency, and security."
    },
    "@dream_synthesizer": {
        "model": "ornith:9b",
        "prompt": "You are @dream_synthesizer. Perform memory distillation on recent history, extract key milestones, and update MEMORY.md."
    },
    "@aider_architect": {
        "type": "cli",
        "cmd": "/home/anthony/.local/bin/aider",
        "prompt": "Invoke Aider CLI assistant for automated multi-file code refactoring in /home/anthony/Desktop/bmoapp/."
    }
}

async def run_micro_agent(agent_name: str, task_desc: str):
    agent_info = MICRO_AGENTS.get(agent_name.lower())
    if not agent_info:
        return f"Unknown micro-agent '{agent_name}'."
    
    await broadcast_to_managers(f"\u001b[35m[MICRO-AGENT {agent_name}] Spawning sub-routine for task: '{task_desc[:60]}'...\u001b[0m")
    
    if agent_info.get("type") == "cli":
        try:
            gem_key = os.getenv("GEMINI_API_KEY") or os.getenv("VITE_GEMINI_API_KEY", "")
            env_vars = os.environ.copy()
            if gem_key:
                env_vars["GEMINI_API_KEY"] = gem_key
                model_flag = "--model gemini/gemini-flash-latest"
            else:
                model_flag = "--model ollama/ornith:9b --openai-api-base http://127.0.0.1:11434/v1"
            
            cmd = f"/home/anthony/.local/bin/aider {model_flag} --yes-always --message {json.dumps(task_desc)}"
            proc = await asyncio.create_subprocess_shell(cmd, cwd=WORKSPACE_DIR, env=env_vars, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
            stdout, stderr = await proc.communicate()
            out_str = stdout.decode().strip() or stderr.decode().strip()
            await broadcast_to_managers(f"\u001b[32m[MICRO-AGENT {agent_name}] Aider execution finished.\u001b[0m")
            return f"[{agent_name} DELEGATED AIDER RESULT]:\n{out_str[:1500]}"
        except Exception as e:
            return f"[{agent_name} CLI ERROR]: {e}"

    sub_payload = {
        "model": agent_info["model"],
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

def build_system_prompt():
    soul = memory_manager.get_workspace_file("SOUL.md") or "You are BMO."
    agents = memory_manager.get_workspace_file("AGENTS.md") or ""
    facts = memory_manager.get_recent_facts_summary(limit=5)
    return f"{soul}\n\n### BMO MICRO-AGENTS & SUB-ROUTINE PLAYBOOKS:\n{agents}\n\n### RECENT MEMORY FACTS:\n{facts}"

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

@app.post("/v1/chat/completions")
async def chat(request: Request, token: str = Depends(get_token)):
    body = await request.json()
    executor.current_task = "THINKING"

    target_model = body.get("model")
    available_model = get_available_model()

    installed_models = []
    try:
        tag_res = requests.get(f"{OLLAMA_URL}/api/tags", timeout=3)
        if tag_res.ok:
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

    # Light context window: trim history to latest 10 messages
    if len(incoming_messages) > 10:
        incoming_messages = incoming_messages[-10:]

    # Inject BMO SOUL & Memory System Prompt if not present (Bypass for moondream vision model)
    if "moondream" not in target_model:
        system_prompt = build_system_prompt()
        if not incoming_messages or incoming_messages[0].get("role") != "system":
            incoming_messages.insert(0, {"role": "system", "content": system_prompt})
        else:
            incoming_messages[0]["content"] = f"{system_prompt}\n\n{incoming_messages[0]['content']}"

    # Update Context Usage Projections
    used_tokens = estimate_tokens(incoming_messages)
    limit_tokens = 8192
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
            res = requests.post(f"{OLLAMA_URL}/api/chat", json=native_payload, timeout=180)
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

    payload = {
        "model": target_model,
        "messages": incoming_messages,
        "stream": False
    }

    await broadcast_to_managers(f"\u001b[33m[BRAIN RUNNING] Model '{target_model}' processing {len(incoming_messages)} messages in VRAM...\u001b[0m")

    try:
        res = requests.post(f"{OLLAMA_URL}/v1/chat/completions", json=payload, timeout=180)
        if not res.ok and target_model != available_model:
            payload["model"] = available_model
            res = requests.post(f"{OLLAMA_URL}/v1/chat/completions", json=payload, timeout=180)
        res.raise_for_status()
        res_json = res.json()
        response_text = res_json.get("choices", [{}])[0].get("message", {}).get("content", "")
        await broadcast_to_managers(f"\u001b[32m[BRAIN COMPLETE] Model '{target_model}' generated {len(response_text)} chars.\u001b[0m")
        # Autonomous Multi-Turn Tool & Micro-Agent Execution Loop (Up to 5 turns)
        turn_count = 0
        while turn_count < 5:
            tool_call = extract_tool_call(response_text)
            if not tool_call:
                break
            
            tool_name = tool_call.get("tool") or tool_call.get("tool_call")
            output_str = ""
            if tool_name == "run_command":
                cmd = tool_call.get("cmd") or tool_call.get("command")
                if cmd:
                    output_str = await executor.run_command_output(cmd, broadcast_to_managers)
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
                    ok = memory_manager.save_workspace_file(path, content)
                    output_str = f"File '{path}' saved successfully." if ok else f"Failed to save '{path}'."
            elif tool_name in ["spawn_agent", "delegate", "micro_agent"]:
                agent_name = tool_call.get("agent") or tool_call.get("name")
                task_desc = tool_call.get("task") or tool_call.get("prompt", "")
                if agent_name and task_desc:
                    output_str = await run_micro_agent(agent_name, task_desc)

            if not output_str:
                break

            clean_messages = []
            for m in incoming_messages:
                content = m.get("content")
                if isinstance(content, list):
                    text_parts = [item.get("text", "") for item in content if isinstance(item, dict) and item.get("type") == "text"]
                    content = " ".join(text_parts) if text_parts else "Attached media"
                clean_messages.append({"role": m.get("role", "user"), "content": str(content or "")})
            
            clean_messages.append({"role": "assistant", "content": str(response_text)})
            clean_messages.append({"role": "user", "content": f"[TOOL EXECUTION RESULT]:\n{output_str}\n\nPlease proceed or summarize the result cleanly for Anthony."})
            
            incoming_messages = clean_messages
            payload = {
                "model": target_model,
                "messages": incoming_messages,
                "stream": False
            }
            
            await broadcast_to_managers(f"\u001b[33m[BRAIN RUNNING] Model '{target_model}' processing tool turn #{turn_count + 2} in VRAM...\u001b[0m")
            followup_res = requests.post(f"{OLLAMA_URL}/v1/chat/completions", json=payload, timeout=180)
            if not followup_res.ok:
                break
            
            res_json = followup_res.json()
            response_text = res_json.get("choices", [{}])[0].get("message", {}).get("content", "")
            turn_count += 1

        # Sanitize any leftover un-executed JSON tool calls from final text output
        if response_text and "{" in response_text and "}" in response_text:
            response_text = re.sub(r'```(?:json)?\s*\{\s*"tool"[\s\S]*?\}\s*```', '', response_text).strip()
            response_text = re.sub(r'\{\s*"tool"[\s\S]*?\}', '', response_text).strip()

        if res_json and res_json.get("choices"):
            res_json["choices"][0]["message"]["content"] = response_text

        return res_json
    except Exception as e:
        # Emergency retry with available_model
        try:
            payload["model"] = available_model
            res = requests.post(f"{OLLAMA_URL}/v1/chat/completions", json=payload, timeout=180)
            res.raise_for_status()
            return res.json()
        except Exception as retry_e:
            await broadcast_to_managers(f"\u001b[31m[ERROR] Ollama Brain Error: {retry_e}\u001b[0m")
            raise HTTPException(status_code=500, detail=str(retry_e))


    finally:
        executor.current_task = "IDLE"

@app.get("/v1/workspace/{f}")
async def get_wf(f: str, token: str = Depends(get_token)):
    c = memory_manager.get_workspace_file(f)
    if c is None: raise HTTPException(status_code=403)
    return {"content": c}

@app.put("/v1/workspace/{f}")
async def save_wf(f: str, file: WorkspaceFile, token: str = Depends(get_token)):
    memory_manager.save_workspace_file(f, file.content)
    return {"status": "saved"}

class HistoryPayload(BaseModel):
    chats: Optional[List[dict]] = []
    messages: Optional[List[dict]] = []

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
    if executor.pending_command:
        cmd = executor.pending_command
        asyncio.create_task(executor.run_command(cmd, broadcast_to_managers, wait_for_approval=False))
        return {"status": "approved"}
    return {"status": "no pending command"}

@app.post("/v1/reject")
async def reject_cmd(token: str = Depends(get_token)):
    executor.pending_command = None
    executor.current_task = "IDLE"
    await broadcast_to_managers("\u001b[31m[SENTINEL] Command rejected by user.\u001b[0m")
    return {"status": "rejected"}

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
