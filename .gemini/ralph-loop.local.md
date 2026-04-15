---
active: true
iteration: 1
max_iterations: 0
completion_promise: "LOCAL_RAG_MEMORY_ONLINE"
started_at: "2026-04-14T20:35:49Z"
---

# Objective: Plain-Text Memory & SQLite RAG
**Target:** `main.py` and new `memory_manager.py`.

**Directives:**
1. Create `GET` and `PUT` REST endpoints pointing strictly to the Docker `/workspace` so the Android app can read and edit `SOUL.md`, `AGENTS.md`, and `MEMORY.md`.
2. Implement a lightweight SQLite database using `sqlite-vec`. Embed and store the conversation turns.
3. Implement Context Injection (RAG): Before sending a prompt to the LLM, perform a vector similarity search on the SQLite DB and inject the top 3 relevant historical facts into the system prompt.
<promise>LOCAL_RAG_MEMORY_ONLINE</promise>
