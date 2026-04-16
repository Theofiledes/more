---
active: true
iteration: 1
max_iterations: 10
completion_promise: "SYSTEM_METRICS_AND_AUTOHEAL_ONLINE"
started_at: "2026-04-16T03:44:09Z"
---

# Objective: Phase 6 - Advanced System Metrics & Task Visibility
**Target:** `server.py`, `src/components/TelemetryTerminal.jsx`

**Directives:**
1. Install `psutil` in the backend container. Create a `/v1/system/metrics` endpoint returning CPU, RAM, and Temperature data.
2. Implement a "Current Task" state in the backend that updates whenever a chat completion or tool call starts.
3. Build a "BMO Status Bar" at the top of the `TelemetryTerminal` showing these real-time stats in hand-drawn style.
4. Auto-Healing: Add a parser to `server.py` that detects "Error 500" or "Failed to connect" in logs and broadcasts a \u001b[31m[AUTO-REPAIR]\u001b[0m suggestion to the terminal.
<promise>SYSTEM_METRICS_AND_AUTOHEAL_ONLINE</promise>
