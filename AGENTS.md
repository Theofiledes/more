# AGENTS.md - BMO Sub-Routine & Micro-Agent Playbook

This document defines specialized sub-routine playbooks and micro-agents used by BMO to perform targeted automated workflows.

## 1. @android_debugger
- **Goal**: Analyze Android app crash logs and generate patches.
- **Workflow**:
  1. Inspect `adb logcat -d` output.
  2. Filter for `FATAL EXCEPTION`, `NullPointerException`, or `Crashlytics`.
  3. Locate exact line of failure in source files under `android/` or `src/`.
  4. Draft precise patch.

## 2. @ui_polisher
- **Goal**: Review and polish frontend UI components.
- **Workflow**:
  1. Review `src/App.jsx` and CSS files.
  2. Propose high-impact aesthetic enhancements (smooth transitions, retro game colors, micro-animations).

## 3. @code_auditor
- **Goal**: Perform security, safety, and performance audits.
- **Workflow**:
  1. Inspect recent git diffs (`git status`, `git diff HEAD~1`).
  2. Verify path safety, input validation, and resource efficiency.

## 4. @dream_synthesizer
- **Goal**: Nightly background memory distillation.
- **Workflow**:
  1. Parse recent user interactions from `history.json`.
  2. Extract key user preferences, project facts, and milestones.
  3. Update `MEMORY.md` and SQLite `memory.db`.

## 5. @aider_architect
- **Goal**: Execute automated multi-file code refactoring using `/home/anthony/.local/bin/aider`.
- **Workflow**:
  1. Receive target file list and feature request from BMO.
  2. Execute `aider --yes-always --message "<task>"` inside `/home/anthony/Desktop/bmoapp/`.
  3. Verify git diff output and report results to BMO.
