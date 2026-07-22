# 🎮 BMO App: Companion & Cyber-Engineer AI

Current Status: **Standalone BMO System v7.2.0 Active**  
Host: `http://localhost:5173` (Vite Dev) | `http://localhost:18789` (FastAPI Server)

---

## 🗺️ BMO Data & Agent Pipeline Architecture

```text
========================================================================================
                      🎮 BMO CYBER-ENGINEER DATA & AGENT PIPELINE v7.2.0
========================================================================================

  [ USER INPUT ] ---> ( 📱 Pixel 9 Pro Fold / 💻 Laptop Companion UI )
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
        (Ollama `ornith:9b` / Local VRAM)       (Google Gemini Cloud API)
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
        R -->|Local Mode| L1[🤖 Local Ollama ornith:9b]
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
- **Secure Auth**: PIN validation for user sessions (`Anthony: 8436`, `Kayla: 4321`).
- **Brain Modes**: Toggle between `LOCAL BMO` (Local Ollama `ornith:9b`) and `GEM BMO` (Google Gemini Cloud `gemini-flash-latest`).
- **Live Internet Tools**: Built-in weather (`/v1/tools/weather`) and web search (`/v1/tools/search`) capabilities.
- **Autonomous Tool Engine**: Real-time shell command execution, workspace file editing, and git status tracking.
- **Interactive Tool Badges**: Displays execution traces, terminal output logs, and diff approvals.
- **Bedtime Sleep Skill**: Automated memory distillation on "goodnight" commands.
- **Memory & Dream Engine**: Persistent memory database (`memory.db`), `SOUL.md` directives, and smart background dream synthesis.
- **Workspace Live Editor**: Edit `SOUL.md`, `AGENTS.md`, and `MEMORY.md` directly in the UI.

---

## 🛠️ Control Commands
- **Wake BMO**: `wake bmo` or `wake-bmo`
- **Stop BMO**: `stop-bmo`
- **Check BMO Status**: `bmo-status`
- **Start Web Dev UI**: `npm run dev -- --host`
