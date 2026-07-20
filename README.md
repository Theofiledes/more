# 🎮 BMO App: Companion & Cyber-Engineer AI

Current Status: **Standalone BMO Architecture Active**
Host: `http://localhost:5173` (Vite Dev) | `http://localhost:18789` (FastAPI Server)

---

## 🧪 System & UI Capabilities
- **Dual-Pane Layout**: Responsive UI with Chat Feed & Telemetry Dashboard side-by-side.
- **Secure Auth**: PIN validation for user sessions.
- **Brain Modes**: Toggle between `LOCAL BMO` (Local Ollama `ornith:9b`) and `GEM BMO` (Google Gemini Cloud).
- **Autonomous Tool Engine**: Real-time shell command execution, workspace file editing, and git status tracking.
- **Interactive Tool Badges**: Displays execution traces, terminal output logs, and diff approvals.
- **Memory & Dream Engine**: Persistent memory database (`memory.db`), `SOUL.md` directives, and smart background dream synthesis.
- **Workspace Live Editor**: Edit `SOUL.md`, `AGENTS.md`, and `MEMORY.md` directly in the UI.

---

## 🛠️ Control Commands
- **Wake BMO**: `wake bmo` or `wake-bmo`
- **Stop BMO**: `stop-bmo`
- **Check BMO Status**: `bmo-status`
- **Start Web Dev UI**: `npm run dev -- --host`
