import os
import json
import requests
import asyncio
from fastapi import FastAPI, Request, HTTPException, Depends, status, WebSocket, WebSocketDisconnect
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from fastapi.middleware.cors import CORSMiddleware
from typing import List, Optional, Union
from pydantic import BaseModel
from git import Repo

app = FastAPI()
auth_scheme = HTTPBearer()

class WorkspaceFile(BaseModel):
    content: str

# Agent Subprocess Tracking (Loop 5/6)
class AgentExecutor:
    def __init__(self):
        self.active_process = None
        self.pending_command = None # For Phase 4 Sentinel
        self.repo = None
        try:
            self.repo = Repo("/app")
        except:
            print("Git repo not found in /app")

    async def checkpoint(self):
        if self.repo:
            try:
                # Fix dubious ownership inside container
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
            self.active_process = await asyncio.create_subprocess_shell(
                cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE
            )

            async def stream_pipe(pipe, prefix):
                while True:
                    line = await pipe.readline()
                    if not line: break
                    await broadcast_fn(f"{prefix} {line.decode().strip()}")

            await asyncio.gather(
                stream_pipe(self.active_process.stdout, ""),
                stream_pipe(self.active_process.stderr, "\u001b[31m[ERR]\u001b[0m")
            )

            await self.active_process.wait()
            await broadcast_fn(f"\u001b[32m[FINISHED] Exit code: {self.active_process.returncode}\u001b[0m")
        except Exception as e:
            await broadcast_fn(f"\u001b[31m[EXECUTION_ERROR] {e}\u001b[0m")
        finally:
            self.active_process = None
            self.pending_command = None

    def kill(self):
        if self.active_process:
            self.active_process.kill()
            print("Active subprocess KILLED by SIGINT")
            return True
        return False

executor = AgentExecutor()

# Track active websocket connections
class ConnectionManager:
    def __init__(self):
        self.active_connections: List[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)

    async def broadcast(self, message: str):
        for connection in self.active_connections:
            try:
                await connection.send_text(message)
            except:
                pass

manager = ConnectionManager()

# Track telemetry in a global buffer for HTTP polling
telemetry_buffer = []

async def broadcast_to_managers(message: str):
    telemetry_buffer.append(message)
    if len(telemetry_buffer) > 1000:
        telemetry_buffer.pop(0)
    await manager.broadcast(message)

# Background heartbeat task (Loop 6 fix)
async def start_heartbeat():
    while True:
        await asyncio.sleep(15) # Reduced frequency to minimize noise
        await broadcast_to_managers("\u001b[35m[HEARTBEAT] KERNEL IS ALIVE\u001b[0m")

@app.on_event("startup")
async def startup_event():
    asyncio.create_task(start_heartbeat())

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Configuration
OPENCLAW_URL = "http://openclaw:18789"
API_TOKEN = "bmo-secret-key-2026"
HISTORY_FILE = "history.json"

def get_token(authorization: HTTPAuthorizationCredentials = Depends(auth_scheme)):
    if authorization.credentials != API_TOKEN:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid API Token",
        )
    return authorization.credentials

def load_history():
    if os.path.exists(HISTORY_FILE):
        with open(HISTORY_FILE, "r") as f:
            return json.load(f)
    return {"chats": [], "messages": []}

def save_history(history):
    with open(HISTORY_FILE, "w") as f:
        json.dump(history, f, indent=2)

@app.get("/v1/telemetry")
async def get_telemetry_poll(token: str = Depends(get_token)):
    return {"lines": telemetry_buffer}

@app.post("/v1/telemetry/state")
async def update_telemetry_state(request: Request, token: str = Depends(get_token)):
    global is_safety_stride_active, is_dreaming_active
    msg = await request.json()
    
    if "safety_stride" in msg:
        is_safety_stride_active = bool(msg["safety_stride"])
        status_color = "\u001b[32mON" if is_safety_stride_active else "\u001b[31mOFF"
        await broadcast_to_managers(f"\u001b[36m[GUARDIAN] PROTOCOL IS {status_color}\u001b[0m")

    if "is_dreaming" in msg:
        is_dreaming_active = bool(msg["is_dreaming"])
        status_color = "\u001b[35mACTIVE" if is_dreaming_active else "\u001b[31mINACTIVE"
        await broadcast_to_managers(f"\u001b[35m[DREAMER] STATE IS {status_color}\u001b[0m")
        
    return {"status": "updated"}

# Track sentinel states
is_safety_stride_active = True
is_dreaming_active = False

@app.websocket("/ws/telemetry")
async def websocket_endpoint(websocket: WebSocket):
    global is_safety_stride_active, is_dreaming_active
    await manager.connect(websocket)
    try:
        await websocket.send_text("\u001b[32m[BMO_OS] TELEMETRY SUBSYSTEM ONLINE\u001b[0m")
        
        async def listen_for_commands():
            global is_safety_stride_active, is_dreaming_active
            try:
                while True:
                    data = await websocket.receive_text()
                    try:
                        msg = json.loads(data)
                        if "safety_stride" in msg:
                            is_safety_stride_active = bool(msg["safety_stride"])
                            status_color = "\u001b[32mON" if is_safety_stride_active else "\u001b[31mOFF"
                            await broadcast_to_managers(f"\u001b[36m[GUARDIAN] PROTOCOL IS {status_color}\u001b[0m")

                        if "is_dreaming" in msg:
                            is_dreaming_active = bool(msg["is_dreaming"])
                            status_color = "\u001b[35mACTIVE" if is_dreaming_active else "\u001b[31mINACTIVE"
                            await broadcast_to_managers(f"\u001b[35m[DREAMER] STATE IS {status_color}\u001b[0m")

                        if msg.get("command") == "SIGINT":
                            if executor.kill():
                                await broadcast_to_managers("\u001b[31m[KERNEL] INTERRUPT SIGNAL RECEIVED - PROCESS KILLED\u001b[0m")
                        
                        if msg.get("command") == "test_run":
                            asyncio.create_task(executor.run_command("ls -R /app", broadcast_to_managers, wait_for_approval=is_safety_stride_active))
                    except: pass
            except: pass

        asyncio.create_task(listen_for_commands())

        while True:
            await asyncio.sleep(10)
            # websocket keeps alive
    except WebSocketDisconnect:
        manager.disconnect(websocket)

@app.post("/v1/approve")
async def approve_command(token: str = Depends(get_token)):
    if not executor.pending_command:
        raise HTTPException(status_code=400, detail="No pending command to approve")
    
    cmd = executor.pending_command
    # Run in background so request returns immediately
    asyncio.create_task(executor.run_command(cmd, broadcast_to_managers))
    return {"status": "execution_started"}

@app.post("/v1/reject")
async def reject_command(token: str = Depends(get_token)):
    if not executor.pending_command:
        raise HTTPException(status_code=400, detail="No pending command to reject")
    
    executor.pending_command = None
    await broadcast_to_managers("\u001b[31m[SENTINEL] COMMAND REJECTED BY USER\u001b[0m")
    return {"status": "rejected"}

@app.get("/v1/chat/history")
async def get_history(token: str = Depends(get_token)):
    return load_history()

@app.get("/v1/workspace/{filename}")
async def get_workspace_file(filename: str, token: str = Depends(get_token)):
    from memory_manager import memory_manager
    content = memory_manager.get_workspace_file(filename)
    if content is None:
        raise HTTPException(status_code=403, detail="File access restricted")
    return {"content": content}

@app.put("/v1/workspace/{filename}")
async def save_workspace_file(filename: str, file: WorkspaceFile, token: str = Depends(get_token)):
    from memory_manager import memory_manager
    success = memory_manager.save_workspace_file(filename, file.content)
    if not success:
        raise HTTPException(status_code=403, detail="File access restricted")
    return {"status": "saved"}

@app.post("/v1/chat/completions")
async def chat_completions(request: Request, token: str = Depends(get_token)):
    body = await request.json()
    
    # Ensure a valid model is passed to OpenClaw (must match openclaw.json)
    if not body.get("model") or body.get("model") == "openclaw":
        body["model"] = "llama3.2:3b"

    # Loop 5: Pre-execution checkpoint
    await executor.checkpoint()

    # Proxy to OpenClaw
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {API_TOKEN}"
    }
    
    try:
        response = requests.post(
            f"{OPENCLAW_URL}/v1/chat/completions",
            json=body,
            headers=headers,
            timeout=120
        )
        response.raise_for_status()
        data = response.json()
        
        # Save message to history
        if "choices" in data and len(data["choices"]) > 0:
            assistant_message = data["choices"][0]["message"]["content"]
            user_message = body["messages"][-1]["content"]
            if isinstance(user_message, list):
                user_message = " ".join([p["text"] for p in user_message if p["type"] == "text"])
            
            hist = load_history()
            new_id = len(hist["messages"]) + 1
            hist["messages"].append({
                "id": new_id,
                "chatId": 1,
                "user": "Anthony",
                "sender": "user",
                "type": "text",
                "text": user_message
            })
            hist["messages"].append({
                "id": new_id + 1,
                "chatId": 1,
                "user": "Anthony",
                "sender": "bmo",
                "type": "text",
                "text": assistant_message
            })
            save_history(hist)
        
        return data
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=18789)
