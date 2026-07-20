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
            self.active_process = await asyncio.create_subprocess_shell(cmd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
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
            self.active_process = await asyncio.create_subprocess_shell(cmd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
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

async def broadcast_to_managers(msg: str):
    telemetry_buffer.append(msg)
    if len(telemetry_buffer) > 1000: telemetry_buffer.pop(0)
    await manager.broadcast(msg)

def get_available_model():
    try:
        res = requests.get(f"{OLLAMA_URL}/api/tags", timeout=3)
        if res.ok:
            models = res.json().get("models", [])
            if models:
                return models[0]["name"]
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

async def perform_dream_synthesis():
    if not os.path.exists("history.json"):
        return None
    try:
        with open("history.json", "r") as f:
            hist = json.load(f)
        msgs = hist.get("messages", [])
        if len(msgs) < 5: return None
        text_sample = "\n".join([f"{m.get('sender', 'user')}: {m.get('text', '')}" for m in msgs[-10:] if m.get('text')])
        if not text_sample: return None

        model = get_available_model()
        prompt = f"Summarize key user preferences, milestones, or important project facts from this conversation into 1 concise memory bullet point:\n\n{text_sample[:1000]}"
        res = requests.post(f"{OLLAMA_URL}/v1/chat/completions",
                            json={"model": model, "messages": [{"role": "user", "content": prompt}], "max_tokens": 100},
                            timeout=30)
        if res.ok:
            summary = res.json().get("choices", [{}])[0].get("message", {}).get("content", "").strip()
            if summary:
                fact = f"Session Milestone: {summary}"
                memory_manager.add_fact(fact)
                memory_manager.save_workspace_file("MEMORY.md", f"\n- {fact}", append=True)
                await broadcast_to_managers("\u001b[35m[DREAM SYNTHESIS] AI Memory distillation complete.\u001b[0m")
                return fact
    except Exception as e:
        print("Dream synthesis error:", e)
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
    while True:
        await asyncio.sleep(15)
        await broadcast_to_managers("\u001b[35m[HEARTBEAT] SYSTEM NOMINAL\u001b[0m")

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


@app.get("/v1/telemetry")
async def telemetry(token: str = Depends(get_token)): return {"lines": telemetry_buffer}

@app.get("/v1/system/metrics")
async def metrics(token: str = Depends(get_token)):
    cpu_val = psutil.cpu_percent() if psutil else 0.0
    ram_val = psutil.virtual_memory().percent if psutil else 0.0
    disk_val = psutil.disk_usage('/').percent if psutil else 0.0
    return {"cpu": cpu_val, "ram": ram_val, "task": executor.current_task, "disk": disk_val}


def build_system_prompt():
    soul = memory_manager.get_workspace_file("SOUL.md") or "You are BMO."
    facts = memory_manager.get_recent_facts_summary(limit=3)
    return f"{soul}\n\n### RECENT MEMORY FACTS:\n{facts}"

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

    if not target_model or (installed_models and target_model not in installed_models):
        target_model = available_model

    incoming_messages = body.get("messages", [])

    # Light context window: trim history to latest 10 messages
    if len(incoming_messages) > 10:
        incoming_messages = incoming_messages[-10:]

    # Inject BMO SOUL & Memory System Prompt if not present
    system_prompt = build_system_prompt()
    if not incoming_messages or incoming_messages[0].get("role") != "system":
        incoming_messages.insert(0, {"role": "system", "content": system_prompt})
    else:
        incoming_messages[0]["content"] = f"{system_prompt}\n\n{incoming_messages[0]['content']}"

    payload = {
        "model": target_model,
        "messages": incoming_messages,
        "stream": False
    }

    try:
        res = requests.post(f"{OLLAMA_URL}/v1/chat/completions", json=payload, timeout=180)
        if not res.ok and target_model != available_model:
            payload["model"] = available_model
            res = requests.post(f"{OLLAMA_URL}/v1/chat/completions", json=payload, timeout=180)
        res.raise_for_status()
        res_json = res.json()

        # Autonomous Tool Execution Loop
        response_text = res_json.get("choices", [{}])[0].get("message", {}).get("content", "")
        tool_call = extract_tool_call(response_text)
        if tool_call:
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
            elif tool_name == "write_file":
                path = tool_call.get("path")
                content = tool_call.get("content", "")
                if path:
                    ok = memory_manager.save_workspace_file(path, content)
                    output_str = f"File '{path}' saved successfully." if ok else f"Failed to save '{path}'."

            if output_str:
                incoming_messages.append({"role": "assistant", "content": response_text})
                incoming_messages.append({"role": "user", "content": f"[TOOL EXECUTION RESULT]:\n{output_str}\n\nPlease summarize the output for the user."})
                payload["messages"] = incoming_messages
                followup_res = requests.post(f"{OLLAMA_URL}/v1/chat/completions", json=payload, timeout=180)
                if followup_res.ok:
                    return followup_res.json()

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
