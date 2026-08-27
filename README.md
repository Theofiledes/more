# 🎮 BMO App: Companion & Cyber-Engineer AI

A self-hosted, local-first AI companion styled after a certain living video game console.
Runs entirely on your own hardware against a local [Ollama](https://ollama.com) model —
chat, voice, vision, live telemetry, and a tool engine that can actually operate your
machine. Ships as a web app and an Android APK.

**Version:** v7.2.0 · **Web UI:** `http://localhost:18789` · **Vite dev server:** `http://localhost:5173`

> ⚠️ **Read before exposing this to a network.** BMO can execute shell commands on the
> machine running the server. The only thing standing between the internet and a shell on
> your box is the API token you set. See [Security](#-security) below.

---

## 🚀 Getting Started

### Prerequisites

| Requirement | Notes |
|---|---|
| **Python 3.10+** | Runs the FastAPI backend. |
| **Node.js 22+** | Required by the Capacitor 8 CLI. A `.nvmrc` is included (`nvm use`). |
| **[Ollama](https://ollama.com)** | Provides the local model. Must be running. |
| **A chat model** | Any tool-capable Ollama model, e.g. `qwen3`, `llama3.1`. |
| **`moondream`** *(optional)* | Only needed for image/vision replies. |
| **JDK 17 + Android SDK** *(optional)* | Only needed to build the Android APK. |

### Install

```bash
git clone <your-fork-url> bmoapp
cd bmoapp

# 1. Backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt

# 2. Frontend
npm install

# 3. Configuration — REQUIRED. The server refuses to start without a token.
cp .env.example .env
python3 -c "import secrets; print('VITE_BMO_API_KEY=' + secrets.token_urlsafe(32))"
# paste that line into .env

# 4. Pull a model
ollama pull qwen3
```

### Run

```bash
./wake-bmo.sh
```

This starts Ollama (if needed) and the BMO server, then prints your access URLs. Open the
laptop link it gives you. To rebuild the web UI after changing frontend code:

```bash
npm run build     # server.py serves dist/ directly
npm run dev       # or hot-reload dev server on :5173
```

### Context window (important)

Ollama defaults new models to a small context (often 4096), which makes BMO forget things
mid-conversation. Set it explicitly on your model and tell BMO the true value:

```bash
ollama show --modelfile <your-model> > Modelfile
echo "PARAMETER num_ctx 16384" >> Modelfile
ollama create <your-model> -f Modelfile
ollama ps          # confirm "context_length"
```

Then set `BMO_CONTEXT_LIMIT` in `.env` to the **same number**. This value doesn't change
the model — it keeps the context gauge and history trimming honest. If you swap models,
redo this, or BMO will silently misreport how much room it has left.

### Optional: voice input

Push-to-talk transcription needs one extra dependency, kept out of the base install
because it pulls in a model download:

```bash
pip install -r requirements-voice.txt
```

Without it the mic button reports that voice input isn't configured; everything else works
normally. Tune the model with `WHISPER_MODEL_SIZE` in `.env` (`tiny`→`large-v3`).

### Optional: Android APK

```bash
nvm use                      # Node 22
npm run build
npx cap sync android
cd android && ./gradlew assembleDebug
# → android/app/build/outputs/apk/debug/app-debug.apk
```

The APK bundles the web UI, so set **Settings → Server Address** in-app to point at your
server (e.g. a Tailscale IP) rather than baking a personal address into the build.

---

## 🔐 Security

BMO is designed for a private network, not the public internet.

- **`VITE_BMO_API_KEY` is the only access gate.** Generate a real random secret. The server
  won't boot without one and warns loudly if you leave the well-known default in place.
- **`wake-bmo.sh` binds `0.0.0.0` by default** so your phone can reach it. Set
  `BMO_BIND_HOST=127.0.0.1` in `.env` to restrict BMO to the local machine only.
- **Prefer a private mesh network** (e.g. [Tailscale](https://tailscale.com)) over
  port-forwarding. Forwarding a shell-capable server to the open internet is a bad idea.
- **The login PIN screen is cosmetic**, stored client-side only — it is *not* an access
  control. Treat the API token as the real boundary.
- **Anything `VITE_`-prefixed is compiled into the client bundle in plaintext**, including
  any published APK. Never put a billable cloud key there you can't afford to have scraped.
- **`.env` is gitignored — keep it that way.** Never commit real keys.

---

## 🗺️ BMO Data & Agent Pipeline Architecture

```text
========================================================================================
                      🎮 BMO CYBER-ENGINEER DATA & AGENT PIPELINE v7.2.0
========================================================================================

  [ USER INPUT ] ---> ( 📱 Android App / 💻 Laptop Companion UI )
       |
       +---> [ 💬 Text Prompt ] ------> Standard Chat Pipeline
       |
       +---> [ 📸 Image / Photo ] ----> [ 💾 Scratch Cache ] -> [ 👁️ Moondream Vision Sensor ]
       |                                (/scratch/img_*.ext)           |
       |                                                               v (Visual Summary)
       +---> [ 📼 File Cartridge ] ---> [ 💾 Scratch Cache ] -> [ 📝 Context Injector ]
       |                                (/scratch/file_*.ext)          |
       |                                                               v
       +---> [ 🌦️ Weather/Search ] ---> [ 🌐 Open-Meteo / DDG ] ------>|
                                                                       |
                                                                       v
========================================================================================
                                 🧠 DUAL-BRAIN ROUTER
========================================================================================
                                       |
                   +-------------------+-------------------+
                   |                                       |
        [ 🤖 LOCAL BMO MODE ]                   [ ☁️ GEM BMO MODE ]
        (Your local Ollama model)               (Google Gemini Cloud API)
                   |                                       |
                   +-------------------+-------------------+
                                       |
                                       v
========================================================================================
                              ⚙️ TOOL & SUB-ROUTINE ENGINE
========================================================================================
                                       |
     +-----------------+---------------+-----------------+-----------------+
     |                 |               |                 |                 |
[@android_debugger] [@ui_polisher] [@code_auditor] [@dream_synthesizer] [Shell Exec]
(Crash Analyzer)    (CSS/JSX Polish) (Git/Path Audit) (Memory Distill)   (Bash Tool)
     |                 |               |                 |                 |
     +-----------------+---------------+-----------------+-----------------+
                                       |
                                       v
========================================================================================
                            💤 BEDTIME & MEMORY PERSISTENCE
========================================================================================
                                       |
    [ 🌙 Bedtime Intent ] -------------> [ 🌌 Gemini Dream Distiller ]
    ("goodnight" / "sleep")                    |
                                               v
                                   [ 🧠 MEMORY.md & memory.db ]
```

---

### 📊 GitHub Interactive Flow Diagram (Mermaid)

```mermaid
flowchart TD
    subgraph Inputs ["📥 User Inputs"]
        A[💬 Text Prompt]
        B[📸 Image Upload]
        C[📼 File Cartridge]
        D[🌦️ Weather/Search Request]
        E[🌙 Bedtime Intent "goodnight"]
    end

    subgraph Pipeline ["⚙️ Data Ingestion & Scratch Storage"]
        B -->|Auto-Cache Base64| S1[💾 /scratch/scratch_img_*.ext]
        C -->|Auto-Cache Cartridge| S2[💾 /scratch/scratch_file_*.ext]
        S1 -->|Stage 1 Optical Analysis| M1[👁️ Moondream Local Vision Sensor]
        D -->|Live API Query| W1[🌐 Open-Meteo Weather / DDG API]
    end

    subgraph BrainRouter ["🧠 Dual-Brain Router"]
        M1 --> R[Brain Router]
        S2 --> R
        A --> R
        W1 --> R
        R -->|Local Mode| L1[🤖 Local Ollama model]
        R -->|Cloud Mode| G1[☁️ Google Gemini Cloud API]
    end

    subgraph SubRoutines ["🤖 Micro-Agent Engine (AGENTS.md)"]
        L1 --> AG1["@android_debugger (Logcat Crash Analyzer)"]
        L1 --> AG2["@ui_polisher (UI/CSS Enhancements)"]
        L1 --> AG3["@code_auditor (Security & Git Diff Audit)"]
        L1 --> AG4["@dream_synthesizer (Memory Distillation)"]
    end

    subgraph MemoryPersistence ["💾 Persistence & Bedtime Sleep Mode"]
        E --> DS[🌌 Gemini Cloud Dream Synthesis]
        AG4 --> DS
        DS -->|Update Facts| DB[(SQLite memory.db)]
        DS -->|Append Milestones| MD[📄 MEMORY.md]
    end

    L1 -->|BMO Voice Output| UI[📱 App Feed & Native TTS]
    G1 -->|BMO Voice Output| UI
```

---

## 🧪 System & UI Capabilities
- **Dual-Pane Layout**: Responsive UI with Chat Feed & Telemetry Dashboard side-by-side.
- **Streaming replies with visible reasoning**: Watch the model think, then answer — thinking is kept in its own collapsible panel, never mixed into the reply.
- **Voice input**: Tap-to-record push-to-talk, transcribed locally by Whisper (optional install).
- **Native TTS**: BMO reads replies aloud on-device, with adjustable rate and pitch.
- **Brain Modes**: Toggle between `LOCAL BMO` (your Ollama model) and `GEM BMO` (Google Gemini Cloud) if you supply a key.
- **Vision**: Image uploads analyzed by a local `moondream` model.
- **Live Internet Tools**: Built-in weather (`/v1/tools/weather`) and web search (`/v1/tools/search`).
- **Autonomous Tool Engine**: Shell command execution, workspace file editing, and git status tracking.
- **Guardian Protocol**: Gate shell commands behind manual approval, with a diff/approve UI.
- **Interactive Tool Badges**: Execution traces, terminal output logs, and diff approvals in-feed.
- **Live Telemetry**: CPU / RAM / disk, active task, and a real context-window gauge over a websocket.
- **Bedtime Sleep Skill**: Automated memory distillation when you tell BMO goodnight.
- **Memory & Dream Engine**: Persistent memory database (`memory.db`), `SOUL.md` directives, and background dream synthesis.
- **Workspace Live Editor**: Edit `SOUL.md`, `AGENTS.md`, and `MEMORY.md` directly in the UI.

Make BMO yours by editing **`SOUL.md`** — personality, voice, and tool rules all live there.

---

## 🛠️ Control Commands

| Action | Command |
|---|---|
| Start BMO (and Ollama if needed) | `./wake-bmo.sh` |
| Stop BMO | `pkill -f "uvicorn server:app"` |
| Check status | `curl -H "Authorization: Bearer $VITE_BMO_API_KEY" localhost:18789/v1/health` |
| Rebuild web UI | `npm run build` |
| Frontend dev server | `npm run dev -- --host` |
| Lint | `npm run lint` |

---

## 📄 License

[MIT](LICENSE) — do what you like with it, just keep the copyright notice.
