import os
import requests
import json
from dotenv import load_dotenv

# Load environment variables from .env
load_dotenv()

def test_bmo_connection():
    api_url = os.getenv("VITE_BMO_API_URL") or "http://localhost:18789"
    api_token = os.getenv("VITE_BMO_API_KEY") or "bmo-secret-key-2026"

    if not api_url or not api_token:
        print("❌ Error: VITE_BMO_API_URL or VITE_BMO_API_KEY missing from .env")
        return

    # Test History Endpoint (Critical for Phase 1)
    history_url = f"{api_url.rstrip('/')}/v1/chat/history"
    print(f"🔍 Testing History at: {history_url}")
    
    headers = {
        "Authorization": f"Bearer {api_token}"
    }

    try:
        response = requests.get(history_url, headers=headers, timeout=10)
        print(f"📡 History Status: {response.status_code}")
        if response.status_code == 200:
            print("✅ SUCCESS: History endpoint is working!")
            # print(f"📝 History: {json.dumps(response.json(), indent=2)}")
        else:
            print(f"❌ FAIL: History endpoint returned {response.status_code}")
            print(f"📝 Response: {response.text}")
            
    except Exception as e:
        print(f"❌ FAIL: History endpoint error: {e}")

    # Test Chat Completions Endpoint
    chat_url = f"{api_url.rstrip('/')}/v1/chat/completions"
    print(f"\n🔍 Testing Chat at: {chat_url}")
    
    payload = {
        "model": "ornith:9b",
        "messages": [
            {"role": "user", "content": "PING"}
        ]
    }

    try:
        response = requests.post(chat_url, headers=headers, json=payload, timeout=120)
        print(f"📡 Chat Status: {response.status_code}")
        if response.status_code == 200:
            print("✅ SUCCESS: Chat proxy is working!")
            data = response.json()
            reply = data['choices'][0]['message']['content']
            print(f"🤖 BMO: {reply}")
        else:
            print(f"❌ FAIL: Chat proxy returned {response.status_code}")
            print(f"📝 Response: {response.text}")
            
    except Exception as e:
        print(f"❌ FAIL: Chat proxy error: {e}")

if __name__ == "__main__":
    test_bmo_connection()
