#!/bin/bash

# BMO Wakeup & Service Controller
PROJECT_DIR="${WORKSPACE_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)}"
if [ -f "$PROJECT_DIR/.env" ]; then
    set -a
    source "$PROJECT_DIR/.env"
    set +a
fi
TOKEN="${VITE_BMO_API_KEY:?VITE_BMO_API_KEY is not set — configure it in .env (see .env.example)}"
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

# Get Tailscale IP
IP=$(tailscale ip -4 2>/dev/null || hostname -I | awk '{print $1}')

echo "🤖 Checking BMO's status..."

# 1. Verify Ollama Service
if curl -s "http://localhost:${OLLAMA_PORT}/api/tags" > /dev/null; then
    echo "✨ Ollama local brain is ONLINE!"
else
    echo "💤 Starting Ollama service..."
    ollama serve > /dev/null 2>&1 &
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
    nohup setsid ./venv/bin/python3 -m uvicorn server:app --host "$BMO_BIND_HOST" --port "$BMO_PORT" > server.log 2>&1 & disown
    echo "⏳ Waiting for BMO to stretch..."
    sleep 3
fi

# Summary Links
echo "--------------------------------------------------"
echo "🎮 BMO DUAL-DASHBOARD SYSTEM ACTIVE!"
echo ""
echo "📟 BMO COMPANION UI:"
echo "   🏠 Laptop: http://localhost:$BMO_PORT/?token=$TOKEN"
echo "   📱 Phone:  http://$IP:$BMO_PORT/?token=$TOKEN"
echo ""
echo "🧠 OLLAMA BRAIN API:"
echo "   🏠 Endpoint: http://localhost:$OLLAMA_PORT"
echo "--------------------------------------------------"
echo "Note: for phone access, use the dedicated BMO Android App,"
echo "or open the Laptop link above in a mobile browser! 🎮🤖"
