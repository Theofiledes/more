import os
import requests
import json
from dotenv import load_dotenv

# Load environment variables from .env
load_dotenv()

def test_openclaw_connection():
    api_url = os.getenv("VITE_OPENCLAW_API_URL")
    api_token = os.getenv("VITE_OPENCLAW_API_KEY")

    if not api_url or not api_token:
        print("❌ Error: VITE_OPENCLAW_API_URL or VITE_OPENCLAW_API_KEY missing from .env")
        return

    # The app appends /api/messages
    full_url = f"{api_url.rstrip('/')}/api/messages"
    
    print(f"🔍 Testing connection to: {full_url}")
    print(f"🔑 Using token: {api_token[:5]}...{api_token[-5:]}")

    payload = {
        "channel": "api",
        "message": "PING",
        "context": {
            "device": "tester_cli",
            "action": "press"
        }
    }

    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {api_token}"
    }

    try:
        response = requests.post(full_url, headers=headers, json=payload, timeout=10)
        
        print(f"📡 Status Code: {response.status_code}")
        
        if response.status_code == 200:
            print("✅ SUCCESS: OpenClaw responded!")
            print(f"📝 Response body: {json.dumps(response.json(), indent=2)}")
        elif response.status_code == 404:
            print("❌ FAIL: 404 Not Found. Check if the /api/messages endpoint exists on this OpenClaw version.")
        elif response.status_code == 401:
            print("❌ FAIL: 401 Unauthorized. Check your VITE_OPENCLAW_API_KEY.")
        else:
            print(f"❌ FAIL: Received unexpected status code {response.status_code}")
            print(f"📝 Error Details: {response.text}")

    except requests.exceptions.ConnectionError:
        print(f"❌ FAIL: Could not connect to {api_url}. Is the OpenClaw bot running? Is Tailscale connected?")
    except Exception as e:
        print(f"❌ FAIL: An unexpected error occurred: {e}")

if __name__ == "__main__":
    test_openclaw_connection()
