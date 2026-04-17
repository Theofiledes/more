import os
import json
import requests
import asyncio
import signal
import sys
from fastapi import FastAPI, Request, HTTPException, Depends, status, WebSocket, WebSocketDisconnect
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from fastapi.middleware.cors import CORSMiddleware
from typing import List, Optional, Union
from pydantic import BaseModel
from git import Repo
import psutil

app = FastAPI()
auth_scheme = HTTPBearer()

class WorkspaceFile(BaseModel):
    content: str

# Agent Subprocess Tracking
class AgentExecutor:
    def __init__(self):
        self.active_process = None
        self.pending_command = None
        self.current_task = "IDLE"
        self.repo = None
        try:
            self.repo = Repo("/app")
        except:
            print("Git repo not found in /app")

    async def checkpoint(self):
        if self.repo:
            try:
                self.repo.git.config("--global", "--add", "safe.directory", "/app")
                self.repo.git.add(A=True)
                if self.repo.is_dirty():
                    self.repo.index.commit("Pre-execution state [BMO_AUTO]")
                    print("Git checkpoint created.")
                return True
            except Exception as e:
                print(f"Git checkpoint failed: {e}")
        return False

    async def run_command(self, cmd: str, broadcast_fn, wait_for_approval=False):
        if ".." in cmd or cmd.startswith("/"):
             if not cmd.startswith("/app"):
                await broadcast_fn("\u001b[31m[SENTINEL] Path escape detected. Blocked.\u001b[0m")
                return
        self.current_task = f"RUNNING: {cmd[:20]}..."
        if wait_for_approval:
            self.pending_command = cmd
            await broadcast_fn(json.dumps({
                "tool": "sentinel",
                "status": "pending",
                "pending_approval": True,
                "diff": f"COMMAND: {cmd}\n[WAITING FOR HUMAN PERMISSION...]"
            }))
            return
        await self.checkpoint()
        await broadcast_fn(f"\u001b[33m[EXECUTING] {cmd}\u001b[0m")
        try:
            self.active_process = await asyncio.create_subprocess_shell(cmd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
            async def stream_pipe(pipe, prefix):
                while True:
                    line = await pipe.readline()
                    if not line: break
                    msg = line.decode().strip()
                    if "Error 500" in msg or "Failed to connect" in msg:
                        await broadcast_fn(f"\u001b[31m[AUTO-REPAIR] Potential network issue detected.\u001b[0m")
                    await broadcast_fn(f"{prefix} {msg}")
            await asyncio.gather(stream_pipe(self.active_process.stdout, ""), stream_pipe(self.active_process.stderr, "\u001b[31m[ERR]\u001b[0m"))
            await self.active_process.wait()
            await broadcast_fn(f"\u001b[32m[FINISHED] Exit code: {self.active_process.returncode}\u001b[0m")
        except Exception as e:
            await broadcast_fn(f"\u001b[31m[EXECUTION_ERROR] {e}\u001b[0m")
        finally:
            self.active_process = None
            self.pending_command = None
            self.current_task = "IDLE"

    def kill(self):
        if self.active_process:
            try:
                self.active_process.kill()
                return True
            except: pass
        return False

executor = AgentExecutor()

def signal_handler(sig, frame):
    executor.kill()
    sys.exit(0)
signal.signal(signal.SIGINT, signal_handler)
signal.signal(signal.SIGTERM, signal_handler)

class ConnectionManager:
    def __init__(self):
        self.active_connections: List[WebSocket] = []
    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)
    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections: self.active_connections.remove(websocket)
    async def broadcast(self, message: str):
        for connection in self.active_connections:
            try: await connection.send_text(message)
            except: pass

manager = ConnectionManager()
telemetry_buffer = []

async def broadcast_to_managers(message: str):
    telemetry_buffer.append(message)
    if len(telemetry_buffer) > 1000: telemetry_buffer.pop(0)
    await manager.broadcast(message)

async def start_heartbeat():
    while True:
        await asyncio.sleep(15)
        await broadcast_to_managers("\u001b[35m[HEARTBEAT] KERNEL IS ALIVE\u001b[0m")

@app.on_event("startup")
async def startup_event():
    asyncio.create_task(start_heartbeat())

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["*"]
)

OPENCLAW_URL = "http://openclaw_agent:18789"
API_TOKEN = "bmo-secret-key-2026"
HISTORY_FILE = "history.json"

def get_token(authorization: HTTPAuthorizationCredentials = Depends(auth_scheme)):
    if authorization.credentials != API_TOKEN:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid API Token")
    return authorization.credentials

def load_history():
    if os.path.exists(HISTORY_FILE):
        with open(HISTORY_FILE, "r") as f: return json.load(f)
    return {"chats": [], "messages": []}

def save_history(history):
    with open(HISTORY_FILE, "w") as f: json.dump(history, f, indent=2)

@app.get("/v1/health")
async def health_check():
    status = {"backend": "OK", "openclaw": "UNKNOWN"}
    try:
        res = requests.get(f"{OPENCLAW_URL}/v1/chat/history", headers={"Authorization": f"Bearer {API_TOKEN}"}, timeout=2)
        status["openclaw"] = "OK" if res.ok else "ERROR"
    except: status["openclaw"] = "OFFLINE"
    return status

@app.get("/v1/telemetry")
async def get_telemetry_poll(token: str = Depends(get_token)):
    return {"lines": telemetry_buffer}

@app.get("/v1/system/metrics")
async def get_system_metrics(token: str = Depends(get_token)):
    return {"cpu": psutil.cpu_percent(), "ram": psutil.virtual_memory().percent, "task": executor.current_task, "disk": psutil.disk_usage('/').percent}

@app.get("/v1/telemetry/state")
async def get_telemetry_state(token: str = Depends(get_token)):
    global is_safety_stride_active, is_dreaming_active
    return { "safety_stride": is_safety_stride_active, "is_dreaming": is_dreaming_active }

@app.post("/v1/telemetry/state")
async def update_telemetry_state(request: Request, token: str = Depends(get_token)):
    global is_safety_stride_active, is_dreaming_active
    msg = await request.json()
    if "safety_stride" in msg: is_safety_stride_active = bool(msg["safety_stride"])
    if "is_dreaming" in msg:
        is_dreaming_active = bool(msg["is_dreaming"])
        if is_dreaming_active: asyncio.create_task(run_dream_cycle())
    return {"status": "updated"}

is_safety_stride_active = True
is_dreaming_active = False

async def run_dream_cycle():
    await broadcast_to_managers("\u001b[35m[DREAMER] BMO is starting a Dream Cycle...\u001b[0m")
    hist = load_history()
    msgs = hist.get("messages", [])[-20:]
    if not msgs: return
    summary_prompt = f"Summarize the following interaction into 3-5 key facts for long-term memory: {json.dumps(msgs)}"
    try:
        headers = {"Content-Type": "application/json", "Authorization": f"Bearer {API_TOKEN}"}
        payload = {"model": "phi4", "messages": [{"role": "user", "content": summary_prompt}], "keep_alive": -1}
        res = requests.post(f"{OPENCLAW_URL}/v1/chat/completions", json=payload, headers=headers)
        if res.ok:
            fact = res.json()["choices"][0]["message"]["content"]
            from memory_manager import memory_manager
            memory_manager.save_workspace_file("MEMORY.md", f"\n### Dream Synthesis\n{fact}", append=True)
            await broadcast_to_managers(f"\u001b[32m[DREAMER] Memory extraction complete. Fact stored.\u001b[0m")
    except Exception as e: await broadcast_to_managers(f"\u001b[31m[DREAMER] Error: {e}\u001b[0m")

@app.post("/v1/chat/completions")
async def chat_completions(request: Request, token: str = Depends(get_token)):
    body = await request.json()
    executor.current_task = "THINKING..."
    body["keep_alive"] = -1
    model_to_use = body.get("model", "moondream")
    if model_to_use == "openclaw": model_to_use = "moondream"
    body["model"] = model_to_use
    await executor.checkpoint()
    headers = {"Content-Type": "application/json", "Authorization": f"Bearer {API_TOKEN}"}
    try:
        response = requests.post(f"{OPENCLAW_URL}/v1/chat/completions", json=body, headers=headers, timeout=120)
        response.raise_for_status()
        data = response.json()
        if "choices" in data and len(data["choices"]) > 0:
            assistant_message = data["choices"][0]["message"]["content"]
            user_message = body["messages"][-1]["content"]
            if isinstance(user_message, list): user_message = " ".join([p["text"] for p in user_message if p["type"] == "text"])
            hist = load_history()
            hist["messages"].append({"id": len(hist["messages"]) + 1, "chatId": 1, "user": "Anthony", "sender": "user", "type": "text", "text": user_message})
            hist["messages"].append({"id": len(hist["messages"]) + 2, "chatId": 1, "user": "Anthony", "sender": "bmo", "type": "text", "text": assistant_message})
            save_history(hist)
        return data
    except Exception as e:
        await broadcast_to_managers(f"\u001b[31m[AUTO-REPAIR] Completions Failed: {e}\u001b[0m")
        raise HTTPException(status_code=500, detail=str(e))
    finally: executor.current_task = "IDLE"

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=18789)
