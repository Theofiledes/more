import os
import requests
import json
from dotenv import load_dotenv

# Load environment variables from .env
load_dotenv()

def test_bmo_chat():
    api_url = os.getenv("VITE_OPENCLAW_API_URL")
    api_token = os.getenv("VITE_OPENCLAW_API_KEY")

    if not api_url or not api_token:
        print("❌ Error: VITE_OPENCLAW_API_URL or VITE_OPENCLAW_API_KEY missing from .env")
        return

    # Using the verified OpenAI-compatible endpoint
    full_url = f"{api_url.rstrip('/')}/v1/chat/completions"
    
    print(f"🔍 Testing BMO Chat at: {full_url}")

    payload = {
        "model": "openclaw",
        "messages": [
            {"role": "user", "content": "Hello BMO! Are you awake?"}
        ]
    }

    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {api_token}"
    }

    try:
        response = requests.post(full_url, headers=headers, json=payload, timeout=60)
        
        print(f"📡 Status Code: {response.status_code}")
        
        if response.status_code == 200:
            data = response.json()
            reply = data['choices'][0]['message']['content']
            print("✅ SUCCESS: BMO responded!")
            print(f"🤖 BMO: {reply}")
        else:
            print(f"❌ FAIL: Received status code {response.status_code}")
            print(f"📝 Response: {response.text}")

    except Exception as e:
        print(f"❌ FAIL: {e}")

if __name__ == "__main__":
    test_bmo_chat()
