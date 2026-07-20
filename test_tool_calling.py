import os
import requests
import json
from dotenv import load_dotenv

load_dotenv()

def run_benchmark():
    api_url = os.getenv("VITE_BMO_API_URL") or "http://localhost:18789"
    api_token = os.getenv("VITE_BMO_API_KEY") or "bmo-secret-key-2026"
    full_url = f"{api_url.rstrip('/')}/v1/chat/completions"

    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {api_token}"
    }

    test_prompts = [
        {"name": "1. Conversational Chat", "prompt": "Hello BMO! What are your favorite video games?"},
        {"name": "2. Git Workspace Status", "prompt": "BMO, please run `git status` to see what files were modified."},
        {"name": "3. System Info Shell Command", "prompt": "BMO, run the `uname -a` command and tell me the Linux kernel version."},
        {"name": "4. File Read Inspection", "prompt": "BMO, please inspect the contents of SOUL.md."}
    ]

    print("=" * 60)
    print("🤖 BMO TOOL CALLING BENCHMARK SUITE")
    print("=" * 60)

    for test in test_prompts:
        print(f"\n🧪 TEST: {test['name']}")
        print(f"📥 User Input: {test['prompt']}")

        payload = {
            "model": "ornith:9b",
            "messages": [
                {"role": "user", "content": test['prompt']}
            ]
        }

        try:
            res = requests.post(full_url, headers=headers, json=payload, timeout=60)
            if res.status_code == 200:
                data = res.json()
                reply = data.get('choices', [{}])[0].get('message', {}).get('content', '')
                print(f"📤 BMO Output:\n{reply}")
            else:
                print(f"❌ Failed ({res.status_code}): {res.text}")
        except Exception as e:
            print(f"❌ Error: {e}")

    print("\n" + "=" * 60)
    print("✅ BENCHMARK SUITE COMPLETE")
    print("=" * 60)

if __name__ == "__main__":
    run_benchmark()
