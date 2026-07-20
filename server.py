import os
import json
import requests
import asyncio
import signal
import sys
import docker
from fastapi import FastAPI, Request, HTTPException, Depends, status, WebSocket, WebSocketDisconnect
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from typing import List, Optional, Union
from pydantic import BaseModel
from git import Repo
import psutil

app = FastAPI()
auth_scheme = HTTPBearer()
docker_client = docker.from_env()

class WorkspaceFile(BaseModel):
    content: str

class AgentExecutor:
    def __init__(self):
        self.active_process = None
        self.pending_command = None
        self.current_task = "IDLE"
        self.repo = None
        try: self.repo = Repo("/app")
        except: pass

    async def checkpoint(self):
        if self.repo:
            try:
                self.repo.git.config("--global", "--add", "safe.directory", "/app")
                self.repo.git.add(A=True)
                if self.repo.is_dirty(): self.repo.index.commit("Auto-checkpoint")
                return True
            except: return False
        return False

    async def run_command(self, cmd: str, broadcast_fn, wait_for_approval=False):
        if ".." in cmd or cmd.startswith("/"):
             if not cmd.startswith("/app"):
                await broadcast_fn("\u001b[31m[SENTINEL] Path escape blocked.\u001b[0m")
                return
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

# --- WATCHDOG ---
failure_count = 0
async def watchdog():
    global failure_count
    while True:
        await asyncio.sleep(45)
        try:
            res = requests.get("http://openclaw_agent:18789/v1/chat/history", headers={"Authorization": f"Bearer {API_TOKEN}"}, timeout=5)
            if res.ok: failure_count = 0
            else: failure_count += 1
        except: failure_count += 1
        
        if failure_count >= 3:
            await broadcast_to_managers("\u001b[31m[WATCHDOG] Brain froze. RESTARTING...\u001b[0m")
            try:
                docker.from_env().containers.get("openclaw_agent").restart()
                failure_count = 0
            except: pass

@app.on_event("startup")
async def startup():
    asyncio.create_task(watchdog())
    asyncio.create_task(heartbeat())
    asyncio.create_task(pre_warm_brain())

async def pre_warm_brain():
    await asyncio.sleep(5)
    await broadcast_to_managers("\u001b[35m[SYSTEM] Pre-warming Gemma-4 into VRAM (Hot-Idle)...\u001b[0m")
    try:
        # Pre-warm Gemma-4 (Gemma 4 e2b)
        res = requests.post(f"{OPENCLAW_URL}/v1/chat/completions", 
                            json={"model": "openclaw", "messages": [{"role": "user", "content": "ping"}], "max_tokens": 1, "keep_alive": -1}, 
                            headers={"Authorization": f"Bearer {API_TOKEN}"}, timeout=60)
        if res.ok: await broadcast_to_managers("\u001b[32m[SYSTEM] Gemma-4 LOCKED in VRAM. Ready.\u001b[0m")
    except: pass

async def heartbeat():
    while True:
        await asyncio.sleep(15)
        await broadcast_to_managers("\u001b[35m[HEARTBEAT] SYSTEM NOMINAL\u001b[0m")

app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])

OPENCLAW_URL = "http://openclaw_agent:18789"
API_TOKEN = "bmo-secret-key-2026"

def get_token(auth: HTTPAuthorizationCredentials = Depends(auth_scheme)):
    if auth.credentials != API_TOKEN: raise HTTPException(status_code=401)
    return auth.credentials

@app.get("/v1/health")
async def health():
    s = {"backend": "OK", "openclaw": "OFFLINE"}
    try:
        res = requests.get(f"{OPENCLAW_URL}/v1/chat/history", headers={"Authorization": f"Bearer {API_TOKEN}"}, timeout=3)
        if res.ok: s["openclaw"] = "OK"
    except: pass
    return s

@app.post("/v1/system/repair")
async def repair(token: str = Depends(get_token)):
    try:
        docker.from_env().containers.get("openclaw_agent").restart()
        return {"status": "ok"}
    except: raise HTTPException(status_code=500)

@app.get("/v1/telemetry")
async def telemetry(token: str = Depends(get_token)): return {"lines": telemetry_buffer}

@app.get("/v1/system/metrics")
async def metrics(token: str = Depends(get_token)):
    return {"cpu": psutil.cpu_percent(), "ram": psutil.virtual_memory().percent, "task": executor.current_task, "disk": psutil.disk_usage('/').percent}

@app.post("/v1/chat/completions")
async def chat(request: Request, token: str = Depends(get_token)):
    body = await request.json()
    executor.current_task = "THINKING"
    
    # HARD-IDLE: Force model to stay in VRAM forever
    body["keep_alive"] = -1
    body["model"] = "openclaw" 
    
    try:
        res = requests.post(f"{OPENCLAW_URL}/v1/chat/completions", json=body, headers={"Authorization": f"Bearer {API_TOKEN}"}, timeout=180)
        res.raise_for_status()
        return res.json()
    except Exception as e:
        await broadcast_to_managers(f"\u001b[31m[ERROR] Brain Timeout: {e}\u001b[0m")
        raise HTTPException(status_code=500)
    finally: executor.current_task = "IDLE"

@app.get("/v1/workspace/{f}")
async def get_wf(f: str, token: str = Depends(get_token)):
    from memory_manager import memory_manager
    c = memory_manager.get_workspace_file(f)
    if c is None: raise HTTPException(status_code=403)
    return {"content": c}

@app.put("/v1/workspace/{f}")
async def save_wf(f: str, file: WorkspaceFile, token: str = Depends(get_token)):
    from memory_manager import memory_manager
    memory_manager.save_workspace_file(f, file.content)
    return {"status": "saved"}

@app.get("/v1/chat/history")
async def get_hist(token: str = Depends(get_token)):
    if os.path.exists("history.json"):
        with open("history.json", "r") as f: return json.load(f)
    return {"chats": [], "messages": []}

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

# Checkpoint
