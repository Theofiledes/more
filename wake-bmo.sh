#!/bin/bash

# BMO Wakeup & Service Controller
PROJECT_DIR="/home/anthony/Desktop/bmoapp"
TOKEN="bmo-secret-key-2026"
BMO_PORT="18789"
OLLAMA_PORT="11434"

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
    nohup python3 -m uvicorn server:app --host 0.0.0.0 --port "$BMO_PORT" > server.log 2>&1 &
    echo "⏳ Waiting for BMO to stretch..."
    sleep 3
fi

# Summary Links
echo "--------------------------------------------------"
echo "🎮 BMO DUAL-DASHBOARD SYSTEM ACTIVE!"
echo ""
echo "📟 BMO COMPANION UI (Pixel Fold Optimized):"
echo "   🏠 Laptop: http://localhost:$BMO_PORT/?token=$TOKEN"
echo "   📱 Phone:  http://$IP:$BMO_PORT/?token=$TOKEN"
echo ""
echo "🧠 OLLAMA BRAIN API:"
echo "   🏠 Endpoint: http://localhost:$OLLAMA_PORT"
echo "--------------------------------------------------"
echo "Note: For the best experience on your Pixel 9 Pro Fold,"
echo "use the dedicated BMO Android App! 🎮🤖"
