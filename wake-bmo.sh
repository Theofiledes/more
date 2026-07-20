#!/bin/bash

# Configuration
PROJECT_DIR="/home/anthony/openclaw-server"
TOKEN="bmo-secret-key-2026"
BMO_PORT="18789"
ADMIN_PORT="18788"

# Get Tailscale IP
IP=$(tailscale ip -4 2>/dev/null || hostname -I | awk '{print $1}')

echo "🤖 Checking BMO's status..."

# Check if containers are running
if sudo docker ps | grep -q "openclaw_agent"; then
    echo "✨ BMO is already awake!"
else
    echo "💤 BMO is sleeping. Waking him up now..."
    cd "$PROJECT_DIR"
    sudo docker compose up -d
    echo "⏳ Waiting for BMO to stretch..."
    sleep 5
fi

# Final Links
echo "--------------------------------------------------"
echo "🎮 BMO DUAL-DASHBOARD SYSTEM ACTIVE!"
echo ""
echo "📟 BMO COMPANION UI (Pixel Fold Optimized):"
echo "   🏠 Laptop: http://localhost:$BMO_PORT/?token=$TOKEN"
echo "   📱 Phone:  http://$IP:$BMO_PORT/?token=$TOKEN"
echo ""
echo "🧠 OPENCLAW ADMIN UI (Technical Settings):"
echo "   🏠 Laptop: http://localhost:$ADMIN_PORT"
echo "   📱 Phone:  http://$IP:$ADMIN_PORT"
echo "--------------------------------------------------"
echo "Note: For the best experience on your Pixel 9 Pro Fold,"
echo "use the dedicated BMO Android App! 🎮🤖"
