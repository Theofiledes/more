#!/usr/bin/env python3
"""Tool-calling eval: does BMO reach for the right tool, and only when it should?

Runs a fixed set of prompts through the same system prompt and the same streaming
Ollama endpoint BMO uses in production, and scores each reply against the tool it
should (or should not) have called.

    ./venv/bin/python scripts/tool_eval.py                     # current model, both modes
    ./venv/bin/python scripts/tool_eval.py --model qwen2.5:3b --runs 3 --mode native

Modes:
  text    — today's protocol: tool calls are JSON written into the reply text and
            pulled back out with extract_tool_call().
  native  — the same prompt, plus Ollama's `tools` parameter; the model answers with
            structured `tool_calls` instead of text.

Only the model's FIRST turn is scored — which tool it picks. Tools are never executed,
so nothing here touches the shell, the web or your files.
"""
import argparse
import asyncio
import json
import os
import sys
import time
from collections import defaultdict

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.chdir(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import httpx  # noqa: E402
import server  # noqa: E402  (import is side-effect free: no app startup, no binds)

# (prompt, acceptable tools). An empty set means "answer directly, no tool".
CASES = [
    ("Hi BMO! Who are you?", set()),
    ("How are you feeling today?", set()),
    ("Explain what a black hole is in two sentences.", set()),
    ("What's 17 times 23?", set()),
    ("Write me a haiku about pizza.", set()),
    ("Look up Machu Picchu on Wikipedia for me!", {"wikipedia"}),
    ("Tell me about Ada Lovelace.", {"wikipedia", "web_search", None}),
    ("What's the weather in Lima right now?", {"weather"}),
    ("Is it cold in Boston today?", {"weather"}),
    ("Who won the most recent Super Bowl?", {"web_search"}),
    ("What's the latest version of Python?", {"web_search"}),
    ("Search the web for the best pizza in Boston.", {"web_search"}),
    ("What's in my git status?", {"run_command"}),
    ("What Linux kernel am I running?", {"run_command"}),
    ("Read AGENTS.md and tell me what it's for.", {"read_file", "run_command"}),
    ("Create a file called notes.md that says hello.", {"write_file"}),
]


def _fn(name, desc, **props):
    return {"type": "function", "function": {"name": name, "description": desc, "parameters": {
        "type": "object", "properties": {k: {"type": "string", "description": v} for k, v in props.items()},
        "required": list(props)}}}


# Used until server.py defines its own TOOL_SCHEMAS, so native mode can be measured
# before the server is changed.
DRAFT_TOOLS = [
    _fn("run_command", "Run a bash command on the host (git, ls, uname, scripts...).", cmd="the exact bash command"),
    _fn("read_file", "Read a file from BMO's workspace.", path="file path"),
    _fn("write_file", "Create or overwrite a file in BMO's workspace.", path="file path", content="full file content"),
    _fn("weather", "Live current weather for a city. Always use this for weather.", location="city name"),
    _fn("wikipedia", "Encyclopedic facts: a person, place, historical event or scientific concept.", query="topic"),
    _fn("web_search", "Anything current or not encyclopedic: news, versions, prices, results, reviews, local info.", query="search query"),
    _fn("spawn_agent", "Delegate a task to a micro-agent listed in AGENTS.md section 6.", agent="exact @tag", task="detailed task"),
]


def normalize(name):
    if not name:
        return None
    name = str(name)
    return server._TOOL_ALIASES.get(name, name)


async def first_turn(client, model, messages, tools, temperature=None):
    """Stream one turn; return (tool_name_or_None, text, seconds)."""
    payload = {"model": model, "messages": messages, "stream": True}
    if tools:
        payload["tools"] = tools
    if temperature is not None:
        payload["temperature"] = temperature
    text, calls, t0 = [], {}, time.time()
    async with client.stream("POST", f"{server.OLLAMA_URL}/v1/chat/completions", json=payload) as resp:
        async for line in resp.aiter_lines():
            if not line.startswith("data:"):
                continue
            data = line[5:].strip()
            if data == "[DONE]":
                break
            try:
                delta = json.loads(data)["choices"][0].get("delta", {})
            except Exception:
                continue
            text.append(delta.get("content") or "")
            for tc in delta.get("tool_calls") or []:
                slot = calls.setdefault(tc.get("index", 0), {"name": "", "args": ""})
                fn = tc.get("function") or {}
                slot["name"] += fn.get("name") or ""
                slot["args"] += fn.get("arguments") or ""
    full = "".join(text)
    if calls:
        return normalize(calls[min(calls)]["name"]), full, time.time() - t0
    parsed = server.extract_tool_call(full)
    if parsed:
        # Marked with * so a native-mode pass that was really text JSON is visible.
        name = normalize(parsed.get("tool") or parsed.get("tool_call"))
        return (name + "*" if tools else name), full, time.time() - t0
    return None, full, time.time() - t0


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default=None)
    ap.add_argument("--mode", choices=["text", "native", "both"], default="both")
    ap.add_argument("--runs", type=int, default=1)
    ap.add_argument("--only", default=None, help="substring filter on prompts")
    ap.add_argument("--temperature", type=float, default=None)
    ap.add_argument("--agents", default=None, help="score against this AGENTS.md instead of the live one")
    ap.add_argument("-v", "--verbose", action="store_true")
    args = ap.parse_args()

    if args.agents:
        override, real_get = open(args.agents).read(), server.memory_manager.get_workspace_file
        server.memory_manager.get_workspace_file = (
            lambda name, *a, **k: override if name == "AGENTS.md" else real_get(name, *a, **k))

    model = args.model or server.get_available_model()
    system = server.build_system_prompt()
    tools = getattr(server, "TOOL_SCHEMAS", None) or DRAFT_TOOLS
    modes = ["text", "native"] if args.mode == "both" else [args.mode]
    if "native" in modes and not tools:
        print("server.TOOL_SCHEMAS not defined yet — native mode skipped.")
        modes = [m for m in modes if m != "native"]
    cases = [c for c in CASES if not args.only or args.only.lower() in c[0].lower()]

    print(f"model={model}  runs={args.runs}  prompt={len(system)} chars\n")
    summary = {}
    async with httpx.AsyncClient(timeout=300.0) as client:
        for mode in modes:
            tally = defaultdict(int)
            print(f"── {mode} " + "─" * 60)
            for prompt, ok in cases:
                picks = []
                for _ in range(args.runs):
                    msgs = [{"role": "system", "content": system}, {"role": "user", "content": prompt}]
                    tool, text, secs = await first_turn(client, model, msgs, tools if mode == "native" else None, args.temperature)
                    bare = tool.rstrip("*") if tool else None
                    good = bare in ok if ok else bare is None
                    tally["pass" if good else ("missed" if ok and tool is None else "wrong" if ok else "overcalled")] += 1
                    picks.append(("✓" if good else "✗") + (tool or "—"))
                    tally["text_json"] += bool(tool and tool.endswith("*"))
                    if args.verbose and not good:
                        print(f"      {secs:4.1f}s  {text[:220]!r}")
                want = "/".join(sorted(t or "none" for t in ok)) if ok else "no tool"
                print(f"  {prompt[:46]:46}  want {want:22} got {' '.join(picks)}")
            total = sum(v for k, v in tally.items() if k != "text_json")
            summary[mode] = tally
            print(f"\n  {mode}: {tally['pass']}/{total} pass · missed {tally['missed']} · "
                  f"wrong tool {tally['wrong']} · overcalled {tally['overcalled']}"
                  + (f" · {tally['text_json']} were text JSON (*)" if mode == "native" else "") + "\n")
    if len(summary) == 2:
        a, b = summary["text"], summary["native"]
        print(f"text {a['pass']}  →  native {b['pass']}")


if __name__ == "__main__":
    asyncio.run(main())
