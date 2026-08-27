# Model Search Prompt

Paste the block below into a web search, ChatGPT/Claude/Gemini, or the Ollama library
search to find a faster model for this machine.

---

## The prompt

> I'm looking for a local LLM to run in **Ollama** on this hardware:
>
> - **GPU:** NVIDIA RTX 3050 Laptop — **4 GB VRAM** (this is the bottleneck)
> - **CPU:** Intel i7-12800H, 20 threads
> - **RAM:** 62 GB
>
> **The hard constraint:** the model plus its KV cache must fit inside roughly **3.5 GB of
> VRAM** so it runs fully on the GPU. Right now I'm running a 9B model at Q4_K_M (5.6 GB),
> which does *not* fit — Ollama offloads part of it to CPU and a short reply takes 20–30
> seconds. I want a model that fits entirely in VRAM, because that's the difference between
> ~25 seconds and ~1–2 seconds per reply.
>
> **Requirements, in priority order:**
> 1. Fits in ~3.5 GB VRAM at Q4_K_M quantization (realistically **3B–4B parameters**, or a
>    7–8B model at Q3 if quality holds up)
> 2. **Reliable tool/function calling** — it must emit clean, parseable JSON on demand,
>    since my app dispatches tools from the model's JSON output
> 3. Supports at least a **16K context window** (`num_ctx 16384`) without falling apart
> 4. Good instruction-following and persona adherence — it roleplays a character defined by
>    a system prompt and must respect formatting rules
> 5. Available directly on **ollama.com/library** (or as a GGUF I can import)
>
> **Nice to have:** visible reasoning / thinking output, and an Apache-2.0 or MIT license so
> I can ship it with an open-source project.
>
> Please recommend 3–5 specific Ollama model tags I can `ollama pull`, with the exact tag
> string, the on-disk size, and an honest note on where each one is weak. Prioritize
> *speed within my VRAM budget* over raw benchmark scores.

---

## Why 3.5 GB is the number

The 4 GB card can't use all 4 GB — the desktop compositor and display take a few hundred
MB, and the KV cache grows with your context window. Budgeting ~3.5 GB for weights leaves
headroom for a 16K context.

Quick sanity check on any candidate before committing:

```bash
ollama pull <model>
ollama run <model> "hi"          # forces it to load
ollama ps                         # look at SIZE vs SIZE_VRAM
```

If `SIZE_VRAM` is meaningfully smaller than `SIZE`, part of the model is on the CPU and it
will be slow. You want them roughly equal.

## After you pick one

New models default to a small context (often 4096). Set it explicitly:

```bash
ollama show --modelfile <model> > Modelfile
echo "PARAMETER num_ctx 16384" >> Modelfile
ollama create <model> -f Modelfile
ollama ps        # confirm context_length
```

BMO detects the real context automatically from Ollama, so there's nothing to change in
`.env` — but the value it reports will only be as big as what you set here.
