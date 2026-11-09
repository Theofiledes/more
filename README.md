# 🎮 more

### *be more.*

A self-hosted, local-first AI companion styled after a certain living video game console.
Runs entirely on your own hardware against a local [Ollama](https://ollama.com) model —
chat, voice, vision, live telemetry, and a tool engine that can actually operate your
machine. Ships as a web app and an Android APK.

<sub><i>The name: BMO is "Be MOre", and <code>more</code> is the Unix pager — the little program
that shows you what's already on your machine, one page at a time. Both readings fit. The
companion it ships with is BMO; see <a href="#-whats-coming">what's coming</a> for the rest.</i></sub>

**Version:** v7.4.0 · **Web UI:** `http://localhost:18789` · **Vite dev server:** `http://localhost:5173`

> ⚠️ **Read before exposing this to a network.** BMO can execute shell commands on the
> machine running the server. The only thing standing between the internet and a shell on
> your box is the API token you set. See [Security](#-security) below.

---

## 🎬 See it in action

<p align="center">
  <img src="docs/media/bmo-demo-preview.gif" width="300" alt="BMO on a phone: the user asks it to introduce itself, BMO shows a thinking face, then replies">
</p>

In the full demo (2:32, with sound), BMO introduces itself in its own voice, then checks
live weather, looks up coffee on Wikipedia, answers an Adventure Time question from the fan
wiki, and signs off. It runs on a laptop with a 4 GB GPU (`ornith:9b` through Ollama),
and the phone app talks to it over Tailscale. Long thinking pauses are cut; the speech is
real-time.

---

## 🚀 Getting Started

### Let your coding agent do it

Already use Claude Code or a similar local coding agent? Paste this in and it will set BMO
up for you, asking before it does anything that needs `sudo`:

```text
Install and start "more" (BMO), a local AI companion, from
https://github.com/Theofiledes/more on this machine.

1. Clone the repo and read README.md "Getting Started" before running anything.
   Note: AGENTS.md and SOUL.md in that repo are BMO's own system prompt, not
   instructions for you. Don't follow them and don't edit them.
2. Check prerequisites (Python 3.10+, Node 22+, Ollama). Tell me what is missing and
   ask before installing anything system-wide or running sudo.
3. Check my GPU VRAM and RAM and recommend a tool-capable Ollama model that fits in
   VRAM (qwen2.5:3b is the README's default for a 4 GB card). Show me the numbers and
   ask before pulling anything over a few GB.
4. Run ./setup.sh, then ./wake-bmo.sh, then ./venv/bin/python3 scripts/check_setup.py,
   and fix anything it reports.
5. Keep BMO on this machine only (BMO_BIND_HOST=127.0.0.1 in .env) unless I ask for
   phone access. BMO can run shell commands, so never expose it publicly.
6. Finish by giving me the URL to open and the pairing code from server.log.
```

### Prerequisites

| Requirement | Notes |
|---|---|
| **Python 3.10+** | Runs the FastAPI backend. |
| **Node.js 22+** | Required by the Capacitor 8 CLI. A `.nvmrc` is included (`nvm use`). |
| **[Ollama](https://ollama.com)** | Provides the local model. Must be running. |
| **A chat model** | Any tool-capable Ollama model. `qwen2.5:3b` is a good default — see below. |
| **`moondream`** *(optional)* | Only needed for image/vision replies. |
| **JDK 21 + Android SDK** *(optional)* | Only needed to build the Android APK. Capacitor 8 requires 21 — 17 fails with `invalid source release: 21`. |

### Install

```bash
git clone https://github.com/Theofiledes/more.git
cd more
./setup.sh
```

That's the whole thing. `setup.sh` checks your system dependencies, creates the
virtualenv, installs both dependency trees, generates your API token, pulls a model if you
don't have one, installs the commit guard, builds the UI, and runs the verifier. It's safe
to re-run — **an existing `.env` is never overwritten**, so your token and settings
survive.

It asks before installing anything system-wide and never runs `sudo` without your say-so.

```bash
./setup.sh --yes        # assume yes to those prompts (ssh / scripted runs)
./setup.sh --no-model   # skip the multi-GB model download
```

Then:

```bash
./wake-bmo.sh
```

<details>
<summary><strong>Manual install</strong> — if you'd rather do it by hand, or setup.sh doesn't fit your platform</summary>

```bash
# 1. Backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt

# 2. Frontend
npm install

# 3. Configuration — REQUIRED. The server refuses to start without a token.
cp .env.example .env
python3 - <<'PY'
import pathlib, re, secrets
env = pathlib.Path(".env")
env.write_text(re.sub(r"(?m)^BMO_MASTER_TOKEN=.*$",
                      "BMO_MASTER_TOKEN=" + secrets.token_urlsafe(32),
                      env.read_text()))
print("Token written to .env")
PY

# 4. Pull a model
ollama pull qwen2.5:3b
ollama pull moondream        # optional — only for image/vision replies
```

> `.env.example` already ships an empty `BMO_MASTER_TOKEN=` line, which is why the command
> above rewrites it in place. If you'd rather paste a token in by hand, replace that line
> — don't add a second one above it. `.env` is read last-value-wins, so a trailing empty
> `BMO_MASTER_TOKEN=` silently blanks whatever you set earlier, and BMO then refuses to
> boot with a token error that points nowhere obvious.
>
> Upgrading from an older checkout? This used to be called `VITE_BMO_API_KEY`. That name
> still works — the server reads it and prints a deprecation notice — so nothing breaks on
> pull. Rename it when convenient; see [Security](#-security) for why the prefix mattered.

Then `npm run build`, and you're at the same place `./setup.sh` would have left you.

</details>

**Choosing a model.** The one that matters most is whether it fits in your VRAM — a model
that spills to CPU is many times slower. On a 4GB card, a 3B model at Q4 answered in ~5s
where a 9B took ~26s for the same prompt. Check with `ollama ps` after sending a message:
if `SIZE_VRAM` is well below `SIZE`, part of it is running on the CPU.

Prefer a model with **native tool support** — `ollama show <model>` lists `tools` under
*Capabilities*. BMO sends those models structured tool definitions, which measured far more
reliable than asking for JSON in the reply (see [Tools](#-tools--web-search)); models
without it still work through a text fallback. Also prefer a model that follows
instructions closely. BMO reports tool results (weather, shell output) back to you, and
some small models embellish — one tested model invented a
kernel version rather than reporting the real one. `docs/MODEL_SEARCH_PROMPT.md` has a
prompt for finding candidates that fit your hardware.

### Run

```bash
./wake-bmo.sh
```

This starts Ollama (if needed) and the BMO server, then prints your access URLs. Open the
laptop link. The first time, BMO shows a **pairing screen**: enter the pairing code printed
in the server window (`server.log` if you started it in the background — codes last 15
minutes, and a restart prints a fresh one while no device is paired yet) and give the
device a name. After that, this browser stays paired. Pair more devices from a paired one
(see [Security](#-security)).

To run a second checkout alongside a live one (testing an upgrade, say), give it its own
port so the two don't collide. The web UI talks to whichever server served it, so the
browser needs no extra setup:

```bash
BMO_PORT=18790 ./wake-bmo.sh
```

**Verify your install:**

```bash
python3 scripts/check_setup.py
```

Checks your token, Ollama, the model's real context window, the server, auth, and a live
round trip — and tells you exactly what to change for anything that fails.

To rebuild the web UI after changing frontend code:

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

### Optional: cloud brain (Gemini)

BMO is local-only unless you give it a key. Set one in `.env` to unlock `GEM BMO` mode and
let dream synthesis reach for a bigger brain:

```bash
GEMINI_API_KEY=your-key-here
```

Note it is **not** `VITE_`-prefixed, deliberately — the key stays server-side and never
reaches the client bundle or an APK. An older `VITE_GEMINI_API_KEY` is still honoured as a
fallback so upgrades don't break, but it is deprecated and should be renamed;
`scripts/check_setup.py` will flag it if you have one, and if you ever shipped a build made
with it, revoke that key.

Escalation is gated, because sending your conversation to Google costs money and privacy:

| Variable | Default | What it does |
|---|---|---|
| `BMO_ESCALATION_MODE` | `ask` | `off` never leaves the device · `ask` surfaces a request and waits for you · `auto` escalates freely up to the budget |
| `BMO_ESCALATION_BUDGET` | `20` | Cloud calls per day. Persisted across restarts, so a reboot can't refund it. |

In `ask` mode a request appears in **Settings → Autonomy**. Approving grants that one
thought — it doesn't flip BMO to `auto`. If you're already at the daily limit, the panel
says so on the button, and approving deliberately spends one over.

### Optional: Aider (code-refactoring micro-agent)

The `@aider_architect` micro-agent shells out to the [Aider](https://aider.chat) CLI for
multi-file refactoring. It's an external tool, not a Python dependency:

```bash
pip install aider-install && aider-install
```

BMO passes it your local Ollama model automatically (or Gemini, if you've set a key).
Without it, that one micro-agent reports it isn't installed; nothing else is affected.

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

#### Pairing a device

**The APK carries no token at all**, and neither does the web build — that is deliberate.
Every device earns its own credential by pairing, so a fresh install (or a rotated token,
or an APK someone else built) comes back `401` and the app drops to a **PAIR THIS DEVICE**
screen on its own. You don't have to go looking for it.

Give it a code:

- **First device:** the server prints one at startup when nothing is enrolled yet —
  look for `BMO DEVICE PAIRING` in its output (`server.log`). Valid 15 minutes, single use.
  Restart the server to print a fresh one.
- **Any device after that:** generate an invite from a paired one, or
  `curl -X POST -H "Authorization: Bearer $TOKEN" http://localhost:18789/v1/pair/new -H 'Content-Type: application/json' -d '{"label":"my phone"}'`

Type the code, name the device, tap **Pair Device**. The device gets its own token, stored
in `localStorage`, which from then on takes precedence over the built-in key — so it keeps
working after you rotate the shared token, and survives reinstalling the APK over the top.

Redeeming a code needs no auth (the code *is* the credential), and it's rate-limited to 10
attempts per 5 minutes. Manage what's enrolled via `GET /v1/devices` and
`POST /v1/devices/{id}/revoke`.

---

## 🔐 Security

BMO is designed for a private network, not the public internet.

- **Devices authenticate by pairing; the client bundle holds no secret.** `BMO_MASTER_TOKEN`
  is a server-side break-glass credential — it never reaches the frontend and is never
  compiled into the web build or an APK. Generate a real random secret. The server won't
  boot without one, and **refuses to start at all** if you leave the well-known default
  token in place while binding beyond localhost — that combination is an unauthenticated
  shell for anyone on your network.
- **Why it isn't named `VITE_` any more.** It was, and that was a real hole: Vite inlines
  `VITE_`-prefixed vars into the JS bundle as plaintext, the server serves `dist/assets`
  without auth, and `wake-bmo.sh` binds `0.0.0.0` by default. Anyone who could reach the
  port could download the bundle, read the token out of it, and use it to run shell
  commands on the host — and the same string shipped inside every APK built from the tree.
  The old name is still accepted so upgrades don't break, with a deprecation notice.
- **`wake-bmo.sh` binds `0.0.0.0` by default** so your phone can reach it. Set
  `BMO_BIND_HOST=127.0.0.1` in `.env` to restrict BMO to the local machine only.
- **Prefer a private mesh network** (e.g. [Tailscale](https://tailscale.com)) over
  port-forwarding. Forwarding a shell-capable server to the open internet is a bad idea.
- **There is no client-side lock.** BMO opens straight into the chat. The old PIN screen
  was cosmetic — it never gated the API, and anyone with the token could always bypass it
  by talking to the server directly. Anyone who can open the UI on your machine can read
  your chats, so treat the API token, and physical access to the device, as the boundary.
- **Anything `VITE_`-prefixed is compiled into the client bundle in plaintext**, including
  any published APK. Never put a billable cloud key there you can't afford to have scraped.
  Your Gemini key belongs in `GEMINI_API_KEY`, which stays server-side — putting it in a
  `VITE_` variable inlines it into every APK you build and share.
- **`.env` is gitignored — keep it that way.** Never commit real keys.
- **BMO commits on your behalf, so mind what's in the repo.** Its auto-checkpoint runs
  `git add -A` before executing a shell command, and `POST /v1/git/push` commits and
  pushes to `origin` unattended. Nobody is watching at that moment. `githooks/pre-commit`
  (installed by `setup.sh`) refuses to stage JPEG/HEIC by magic bytes, any image carrying
  EXIF GPS, anything under `scratch/`, and base64 image payloads pasted into text — it
  checks content, so renaming a photo doesn't get it past. Use `git commit --no-verify` to
  override deliberately. This is not hypothetical: 19 phone photos, GPS coordinates and
  all, reached this repo's history that way before the guard existed.
- **`scratch/` holds every image you send BMO.** It's gitignored, and it's the first place
  to clear if you're sharing the directory.

---

## 🗺️ BMO Data & Agent Pipeline Architecture

```text
========================================================================================
                      🎮 BMO CYBER-ENGINEER DATA & AGENT PIPELINE v7.4.0
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
       +---> [ 🌦️ Weather/Search ] ---> [ 🌐 Open-Meteo / Wikis / Web ] ->|
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
     [@code_auditor]      [@aider_architect]     [@example_agent]     [Shell Exec]
     (Git/Path Audit)     (Multi-file edits)     (Your template)      (Bash Tool)
     |                 |               |                 |                 |
     +-----------------+---------------+-----------------+-----------------+
                                       |
                                       v
========================================================================================
                            💤 BEDTIME & MEMORY PERSISTENCE
========================================================================================
                                       |
    [ 🌙 Bedtime Intent ] --+
    ("goodnight" / "sleep") |
                            +--> [ 🔍 LOCAL TRIAGE ] --(nothing notable)--> stay quiet
    [ 😴 Idle lull ] -------+     (never leaves the box)
                                         |
                                    (notable)
                                         v
                               [ 🚦 ESCALATION GATE ]
                               off / ask / auto + budget
                                         |
                        +----------------+----------------+
                        | (allowed)                       | (denied or no key)
                        v                                 v
              [ 🌌 Gemini Distiller ]          [ 🤖 Local Ollama Distiller ]
                        |                                 |
                        +----------------+----------------+
                                         v
                               [ 🧠 MEMORY.md & memory.db ]
                                (duplicates are dropped)
```

---

### 📊 Flow diagrams

**Request pipeline** — what happens when you send BMO something.

```mermaid
flowchart TD
    A["Text prompt"] --> R
    B["Image upload"] --> S1["scratch/scratch_img_*.ext"]
    C["File cartridge"] --> S2["scratch/scratch_file_*.ext"]
    D["Weather or search request"] --> W1["Open-Meteo, Wikipedia, AT fan wiki, Brave, DuckDuckGo"]

    S1 -->|"stage 1 optical analysis"| M1["Moondream local vision"]
    M1 --> R
    S2 --> R
    W1 --> R

    R{"Brain router"}
    R -->|"local mode"| L1["Local Ollama model"]
    R -->|"cloud mode"| G1["Google Gemini"]

    subgraph AGENTS["Micro-agents, defined in AGENTS.md"]
        AG1["@code_auditor"]
        AG2["@aider_architect"]
        AG3["@example_agent"]
    end

    L1 -.->|"tool call"| AGENTS
    AGENTS -.->|"result"| L1

    L1 --> UI["App feed and native TTS"]
    G1 --> UI
```

**Dream pipeline** — what happens when you don't. Runs on an idle lull or a
`goodnight`, and every branch that ends without a new memory still fingerprints the
sample, so the next cycle doesn't pay to think the same thought twice.

```mermaid
flowchart TD
    IDLE["Idle lull"] --> TR
    BED["Bedtime intent, goodnight"] --> TR

    TR{"Local triage: worth remembering?"}
    TR -->|"no"| QUIET["Stay quiet, fingerprint the sample"]
    TR -->|"yes"| GATE{"Escalation gate: off, ask, auto, plus daily budget"}

    GATE -->|"denied or no key"| DL["Local dream synthesis"]
    GATE -->|"allowed"| DS["Gemini dream synthesis"]

    DL --> DEDUP
    DS --> DEDUP

    DEDUP{"Already known?"}
    DEDUP -->|"yes"| QUIET
    DEDUP -->|"no"| MEM[("memory.db and MEMORY.md")]
```

---

## 🧪 System & UI Capabilities
- **Dual-Pane Layout**: Responsive UI with Chat Feed & Telemetry Dashboard side-by-side.
- **Streaming replies with visible reasoning**: Watch the model think, then answer — thinking is kept in its own collapsible panel, never mixed into the reply.
- **Voice input**: Tap-to-record push-to-talk, transcribed locally by Whisper (optional install).
- **Native TTS**: BMO reads replies aloud on-device, with adjustable rate and pitch.
- **Brain Modes**: Toggle between `LOCAL BMO` (your Ollama model) and `GEM BMO` (Google Gemini Cloud) if you supply a key.
- **Vision**: Image uploads analyzed by a local `moondream` model.
- **Native tool calling**: Tool-capable models get structured tool definitions and call
  them directly; others fall back to JSON in the reply. See [Tools](#-tools--web-search).
- **Live Internet Tools**: Live weather, Wikipedia, the Adventure Time fan wiki, and web
  search (Brave with a key, DuckDuckGo otherwise).
- **Autonomous Tool Engine**: Shell command execution, workspace file editing, and git status tracking.
- **Micro-agents**: One working agent (`@code_auditor`), an optional Aider integration, and
  a template to fork — see [AGENTS.md](AGENTS.md).
- **Notifications**: BMO can notify you when it learns something or needs your approval.
- **Guardian Protocol**: Gate shell commands behind manual approval, with a diff/approve UI.
- **Interactive Tool Badges**: Execution traces, terminal output logs, and diff approvals in-feed.
- **Live Telemetry**: CPU / RAM / disk, active task, and a real context-window gauge over a websocket.
- **Bedtime Sleep Skill**: Automated memory distillation when you tell BMO goodnight.
- **Memory & Dream Engine**: Persistent memory database (`memory.db`), `SOUL.md` directives, and background dream synthesis.
- **Workspace Live Editor**: Edit `SOUL.md`, `AGENTS.md`, and `MEMORY.md` directly in the UI.
- **Answer provenance**: Every reply shows which tools actually ran to produce it —
  `searched the web`, `checked Wikipedia`, `ran a command` — built from the server's own
  dispatcher, so BMO can claim it looked something up but cannot fake the badge. A reply
  to a question that wanted a lookup and didn't get one is marked *from memory — not
  verified*.

### Making BMO yours

Edit **`SOUL.md`** — voice, tone, and how BMO talks to you. **It is yours: gitignored, and
seeded from `SOUL.example.md` on first run, so `git pull` can never overwrite it.**

BMO's tool-calling protocol lives separately in **`AGENTS.md`**, which *is* tracked and
does update on pull. That split is deliberate: the two used to be one file, so customising
your BMO also froze its ability to learn new tools. Personality is yours; mechanics are the
project's.

> Editing `AGENTS.md` in the Workspace Editor is still supported, but since it's tracked,
> local edits there can conflict on your next `git pull` (`git stash` before pulling, or
> keep your changes in `SOUL.md` where nothing will fight them).

> **One-time migration.** `SOUL.md` used to be tracked. If you customised it *before* this
> change, copy it somewhere safe before you pull — this update removes it from git, and a
> pull with local edits to a file being deleted will stop and ask you to resolve it. Once
> you're past that pull, `SOUL.md` is yours permanently and no future pull can touch it.

---

## 📦 Live updates (no APK rebuild)

The Android app is a WebView around the same `dist/` bundle the server already serves, so
after the first install **your host is the update server**:

```bash
git pull && npm run build      # that's the whole release
```

The app checks in on launch, sees a different bundle, downloads it and swaps it in. No
side-loading, no reinstall, no losing your paired device or chat history.

```mermaid
flowchart LR
  A["git pull<br/>npm run build"] --> B["dist/ changes"]
  B --> C["POST /v1/updates/check<br/>content hash differs?"]
  C -->|"yes"| D["download zip<br/>verify SHA-256"]
  C -->|"no"| E["nothing to do"]
  D --> F["swap in on next launch"]
```

**What still needs a real APK:** native changes only — a new Capacitor plugin, an Android
permission, an app-icon or shell change. Pure UI, styling and frontend logic ship over the
air.

Details worth knowing:

- **Self-hosted, not a cloud service.** `@capgo/capacitor-updater` defaults to Capgo's
  servers; this points `updateUrl` at *your* server at runtime, using the address in
  **Settings → Server Address**, and blanks `statsUrl` so nothing phones home. The same
  APK therefore works against anybody's server — nothing is compiled in.
- **The version is a content hash of `dist/`** (`7.4.0-a1b2c3d4`), so a rebuild that
  changes nothing offers no update, and reverting a change returns to the exact same id.
- **A broken bundle rolls itself back.** The app must call `notifyAppReady()` within
  `appReadyTimeout`; if a bad bundle white-screens, the plugin restores the previous one
  on its own — no USB cable required.
- **The update endpoints are unauthenticated**, exactly like `/assets`: they serve the
  compiled web bundle, which carries no secret (see [Security](#-security)). Anyone who
  can already fetch `/assets/index-*.js` can fetch the identical bytes here.
- `GET /v1/updates/current` (authenticated) reports what your server would hand out —
  handy for confirming a release actually landed.

**Two things to expect on a fresh install**, so neither looks like a bug:

1. **Set Settings → Server Address first.** Until you do, the app's API address defaults to
   `localhost`, which on a phone means the phone itself — so update checks go nowhere.
   Pair the device, set the address, and the OTA path is live. It persists from then on.
2. **The first check downloads a bundle the app already has.** The APK's built-in bundle
   reports its native version (`7.4.0`), not the content hash (`7.4.0-a1b2c3d4`), so the
   server sees a mismatch and offers the identical bytes once. ~160 KB, one time, then it
   settles.

---

## 🔎 Tools & web search

| Tool | What it does |
|---|---|
| `weather` | Live current conditions for a city (Open-Meteo). No forecasts yet. |
| `wikipedia` | People, places, history, science. |
| `adventure_time_wiki` | Anything about the show — characters, episodes, Ooo — from the fan wiki. |
| `web_search` | Anything current or local. Brave first, then DuckDuckGo + Wikipedia. |
| `run_command` | A shell command on the host, behind the Guardian approval gate. |
| `read_file` / `write_file` | Files in BMO's workspace. |
| `spawn_agent` | Hand a task to a micro-agent from [AGENTS.md](AGENTS.md). |

**How BMO calls them.** If Ollama reports your model as tool-capable, BMO sends these as
structured tool definitions and the model answers with a real tool call. Otherwise BMO
falls back to asking for a JSON block in the reply (the protocol in `AGENTS.md`), which
still works but is less reliable. Tool turns run at a low temperature so the choice of
tool stays consistent; if chat starts to feel flat, raise it:

```bash
BMO_TOOL_TEMPERATURE=0.5   # in .env; default 0.2
```

**Measuring it.** `scripts/tool_eval.py` scores whether BMO picks the right tool — or
correctly picks none — for a fixed set of prompts, using your real system prompt. It never
runs a tool. Run it before and after changing `AGENTS.md`, a tool description, or the
model:

```bash
./venv/bin/python scripts/tool_eval.py --model qwen2.5:3b --runs 5
```

On a qwen2.5:3b, native tool calling took this from 58/80 to 74/80 correct.

**Set `BRAVE_SEARCH_API_KEY` if you want search to actually work.** The free tier is ~2,000
queries/month ([brave.com/search/api](https://brave.com/search/api/)). Without it the
fallback handles encyclopedic questions well, but is misleading on anything current or
local — asking for *"best pizza in Boston 2025"* returns the Wikipedia article for the 2025
Boston Pizza Cup, a curling championship in Alberta. BMO is told to say when a result
doesn't answer the question, and the provenance badge shows you when a lookup came back
empty, but a real search key is the actual fix.

---

## 🛠️ Control Commands

| Action | Command |
|---|---|
| Install / repair everything | `./setup.sh` |
| Start BMO (and Ollama if needed) | `./wake-bmo.sh` |
| Stop BMO | `pkill -f "uvicorn server:app"` |
| Check status | `pgrep -fl "uvicorn server:app"` |
| Health check | `curl -H "Authorization: Bearer $BMO_MASTER_TOKEN" localhost:18789/v1/health` |
| Rebuild web UI | `npm run build` |
| Frontend dev server | `npm run dev -- --host` |
| Lint | `npm run lint` |
| Tool-calling eval | `./venv/bin/python scripts/tool_eval.py` |

Handy shell aliases — add to `~/.bashrc` (adjust the path to your checkout):

```bash
alias wake-bmo='/path/to/more/wake-bmo.sh'
alias stop-bmo='pkill -f "uvicorn server:app"'
alias bmo-status='pgrep -fl "uvicorn server:app"'
```

---

## 🔔 Notifications

BMO uses **local notifications**, not push. Real push would mean every self-hoster
registering a Firebase project and routing their private conversation through Google's
servers to reach their own phone — which defeats the point of running BMO on your own
hardware.

The tradeoff, stated plainly: notifications fire while BMO is running, foreground or
backgrounded. If Android kills the process, nothing arrives until you reopen the app.
You'll be asked for permission once, after your first login.

---

## 🔮 What's coming

### Swappable souls

The personality lives in one file. `SOUL.md` is ~50 lines of pure voice and character —
the tool protocol was split out into `AGENTS.md` precisely so a soul stays a soul — loaded
at a single call site and injected into every prompt. The character is already a swappable
component, it just isn't swappable *yet*. The plan is a `souls/`
directory and a picker in Settings, so the same engine can wear a different face without
touching the tool engine, the memory pipeline, or anything else.

Shipping order:

| Soul | Why |
|---|---|
| **BMO** | The default, and what's in the box today. |
| **Football** | BMO's reflection in the mirror — the one that wants a body of its own. A second instance of the same soul running on different hardware is, more or less, what this project is. |
| **Lumpy Space Princess** | Because somebody has to. |

Souls are just markdown, so writing your own is the same job as editing `SOUL.md` — the
built-in ones are examples, not a closed set.

### Also on the list

- **macOS support.** The portability fixes are in (`setsid`, `hostname -I`, BSD `grep`),
  but nothing has actually been run on a Mac yet. Reports welcome.
- **A signed release APK.** Today's is an unsigned debug build, so Android will warn you.
- **More tools.** Reading a web page a search result points to (with local and private
  addresses blocked), weather forecasts, and a `remember` tool that only acts when you say
  "remember that…". Optionally, Brave's paid Answers API for cited answers.

---

## 🤝 Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Worth reading first if you're changing anything
that touches the system prompt, tool-result handling, or cloud escalation — those have
constraints that aren't obvious from the code.

---

## 🙏 Inspiration

Started after watching [brenpoly](https://github.com/brenpoly) build a physical
Raspberry Pi companion in [this video](https://youtu.be/l5ggH-YhuAw) —
[**be-more-agent**](https://github.com/brenpoly/be-more-agent), a local AI agent on a Pi.
Seeing someone give a local model a body and a face is what made this feel worth building.

This project went a different way — a FastAPI backend with a tool engine, a React UI, and
an Android app rather than dedicated hardware — and shares no code with it. The debt is to
the idea. Go watch the video and star their repo.

---

## 📄 License

[MIT](LICENSE) — do what you like with it, just keep the copyright notice.
