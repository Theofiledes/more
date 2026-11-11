#!/bin/bash

# BMO Wakeup & Service Controller
PROJECT_DIR="${WORKSPACE_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)}"
if [ -f "$PROJECT_DIR/.env" ]; then
    set -a
    source "$PROJECT_DIR/.env"
    set +a
fi
# Break-glass token for this script's own health check. BMO_MASTER_TOKEN is the current
# name; VITE_BMO_API_KEY is the deprecated one, still accepted so an existing .env works.
TOKEN="${BMO_MASTER_TOKEN:-${VITE_BMO_API_KEY:?BMO_MASTER_TOKEN is not set — configure it in .env (see .env.example)}}"
# Overridable so a second checkout can run alongside this one. It was hardcoded, which
# silently defeated setting BMO_PORT in .env: the .env is sourced just above, then the
# assignment overwrote it. A test instance would find the *existing* server healthy on
# 18789, report "already awake", and hand you a URL carrying the wrong token.
BMO_PORT="${BMO_PORT:-18789}"
OLLAMA_PORT="${OLLAMA_PORT:-11434}"
# BMO can run a shell tool for the model. Binding beyond localhost means anyone who can
# reach this host and the API token can run commands on this machine. Defaults to 0.0.0.0
# to preserve phone/Tailscale access to this instance; set BMO_BIND_HOST=127.0.0.1 to
# restrict to this machine only.
BMO_BIND_HOST="${BMO_BIND_HOST:-0.0.0.0}"
export BMO_BIND_HOST  # server.py checks this to refuse a public bind on the default token
if [ "$BMO_BIND_HOST" != "127.0.0.1" ] && [ "$BMO_BIND_HOST" != "localhost" ]; then
    echo "⚠️  BMO is binding to $BMO_BIND_HOST:$BMO_PORT — reachable by anyone who can reach this host on your network."
    echo "    BMO can execute shell commands. Set BMO_BIND_HOST=127.0.0.1 to restrict to this machine only."
fi

# Get Tailscale IP, else this machine's LAN address. `hostname -I` is GNU-only and errors
# out on macOS, so fall through to the Darwin equivalent rather than printing a blank URL.
IP=$(tailscale ip -4 2>/dev/null \
     || hostname -I 2>/dev/null | awk '{print $1}' \
     || ipconfig getifaddr en0 2>/dev/null)
[ -n "$IP" ] || IP="localhost"

echo "🤖 Checking BMO's status..."

# 1. Verify Ollama Service
if curl -s "http://localhost:${OLLAMA_PORT}/api/tags" > /dev/null; then
    echo "✨ Ollama local brain is ONLINE!"
else
    echo "💤 Starting Ollama service..."
    if command -v setsid >/dev/null 2>&1; then OSETSID=setsid; else OSETSID=""; fi
    nohup $OSETSID ollama serve > /dev/null 2>&1 & disown
    sleep 3
fi

# 2. Verify BMO Backend Server
if curl -s "http://localhost:${BMO_PORT}/v1/health" > /dev/null; then
    echo "✨ BMO Server is already awake!"
else
    echo "💤 BMO Server is sleeping. Waking him up now..."
    cd "$PROJECT_DIR" || exit 1
    if [ -d "venv" ]; then
        source venv/bin/activate
    fi
    # setsid doesn't exist on macOS. `nohup ... & disown` already survives the shell
    # closing; setsid only adds full session detachment, so use it when it's there.
    if command -v setsid >/dev/null 2>&1; then SETSID=setsid; else SETSID=""; fi
    nohup $SETSID ./venv/bin/python3 -m uvicorn server:app --host "$BMO_BIND_HOST" --port "$BMO_PORT" > server.log 2>&1 & disown
    echo "⏳ Waiting for BMO to stretch..."
    # Poll instead of a blind sleep: a crash on startup (bad .env, port in use) used to
    # still print "ACTIVE" below with links to nothing.
    for _ in $(seq 1 30); do
        curl -s "http://localhost:${BMO_PORT}/v1/health" > /dev/null && break
        sleep 1
    done
    if ! curl -s "http://localhost:${BMO_PORT}/v1/health" > /dev/null; then
        echo "❌ BMO didn't come up. Last lines of server.log:"
        tail -n 15 server.log | sed 's/^/   /'
        exit 1
    fi
fi

# Summary Links
echo "--------------------------------------------------"
echo "🎮 BMO DUAL-DASHBOARD SYSTEM ACTIVE!"
echo ""
echo "📟 BMO COMPANION UI (open it, then pair the device):"
echo "   🏠 Laptop: http://localhost:$BMO_PORT/"
if [ "$BMO_BIND_HOST" = "127.0.0.1" ] || [ "$BMO_BIND_HOST" = "localhost" ]; then
    echo "   📱 Phone:  off (BMO_BIND_HOST=$BMO_BIND_HOST — this machine only)"
else
    echo "   📱 Phone:  http://$IP:$BMO_PORT/"
fi
echo ""
echo "🧠 OLLAMA BRAIN API:"
echo "   🏠 Endpoint: http://localhost:$OLLAMA_PORT"
echo "--------------------------------------------------"
echo "Note: for phone access, use the dedicated BMO Android App,"
echo "or open the Laptop link above in a mobile browser! 🎮🤖"
