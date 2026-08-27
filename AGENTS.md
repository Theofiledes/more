# AGENTS.md — BMO Micro-Agents

Micro-agents are named specialists BMO can delegate to. Mention one by its `@tag` in chat
and BMO hands the task over to it.

This file is injected into BMO's system prompt, so keep it short — every line costs
context on every message.

## 1. @code_auditor
- **Goal**: Review recent changes for correctness, safety and efficiency.
- **Workflow**:
  1. Inspect `git status` and `git diff`.
  2. Check path safety, input validation, resource use, and security.
  3. Report findings concisely, most important first.

## 2. @aider_architect *(optional — needs the Aider CLI installed)*
- **Goal**: Multi-file code refactoring that actually edits files.
- **Workflow**: Delegates to [Aider](https://aider.chat), passing your local Ollama model
  (or Gemini if a key is set). Reports back what it changed.
- Without Aider installed, this agent says so and nothing else is affected.

## 3. @example_agent *(template — build your own)*
- A placeholder that explains itself. Copy its block in `server.py`'s `MICRO_AGENTS`,
  rename it, and rewrite the prompt to create a specialist of your own.
- `"model": "auto"` runs the prompt against whatever chat model is loaded.
- `"type": "cli"` instead shells out to a command, like `@aider_architect` does.

---

**A note on adding agents.** A micro-agent is only as good as the tools behind it. A
prompt that says "you are a debugger" does not make the model better at debugging — it
just renames it. The agents worth adding are ones that wrap something real: a CLI, an
API, a script.
