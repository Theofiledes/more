# 🎮 BMO App: Ultimate Battle Plan

Current Status: **Phase 2 Complete / Testing Active**
Host: `http://localhost:5173` (Vite Dev) | `http://localhost:18789` (Backend)

---

## 🧪 Testing Protocol: "Touch Every Button"
*Use this list to verify the current build in the browser or on the device.*

- [ ] **Dual-Pane Layout:** Responsive check (>1024px) shows Chat + Dashboard side-by-side.
- [ ] **Secure Auth:** Enter PIN `1234` to unlock the chat.
- [ ] **Brain Swap:** Toggle between `GEM BMO` (Cloud) and `LOCAL BMO` (OpenClaw).
- [ ] **Chat Engine:** Send a text message and verify the response.
- [ ] **Tool Badges:** Verify JSON tool calls render as badges with expandable STDOUT.
- [ ] **Cartridge Animation:** Select a file and verify the "eating" face + Cartridge bubble.
- [ ] **Tactile Audio:** Click & Hold the center D-Pad button (PTT) to trigger recording state.
- [ ] **Telemetry Feed:** Verify the Right Pane is polling and displaying system heartbeats.
- [ ] **Macro Grid:** Click "ANDROID DEBUG" and verify the prompt fills the input field.
- [ ] **Haptics:** (Mobile Only) Verify vibration on button presses.

---

## ✅ Completed Phases

### Phase 1: The Hotfixes
- [x] Implemented `/v1/chat/history` in Python backend.
- [x] Added TTS Play/Stop/Pause UI widgets.
- [x] Formatted Multimodal Vision payloads for local model compatibility.

### Phase 2: Ralph Loop Master Blueprint
- [x] **Loop 1:** Dual-Pane Foldable UI + ANSI Terminal.
- [x] **Loop 2:** Interactive Agent Tool Traces + Cartridge Uploads.
- [x] **Loop 3:** PTT Audio Engine + Haptics + TTS Barge-in.
- [x] **Loop 4:** Dashboard Settings + Macro Playbook.
- [x] **Loop 5:** Async Git Sandbox (Auto-checkpoints before execution).
- [x] **Loop 6:** Local RAG Memory (SQLite-based fact injection).

---

## 🚀 Upcoming: Phase 3 (Workspace Editor)
*Target: Direct manipulation of BMO's "Brain" files.*

- [ ] **File Navigator:** UI to switch between `SOUL.md`, `AGENTS.md`, and `MEMORY.md`.
- [ ] **Live Editor:** Integration of a code editor (or styled textarea) using `GET/PUT /v1/workspace`.
- [ ] **Sync Indicator:** Visual "Saved" state when writing to the Docker workspace.
- [ ] **Hot-Reload Brain:** Button to signal OpenClaw to reload configuration after edits.

---

## 🛠️ Maintenance Commands
- **Start Dev Server:** `npm run dev -- --host`
- **Restart Backend:** `docker restart bmo_backend`
- **Check Logs:** `adb logcat -d | grep Capacitor`
- **Sync Android:** `npx cap sync android`
