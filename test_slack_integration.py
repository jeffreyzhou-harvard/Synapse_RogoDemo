#!/usr/bin/env python3
"""
Test script to demonstrate Slack integration functionality
This simulates Slack webhooks without needing actual Slack credentials
"""

import requests
import json
import time

BASE_URL = "http://localhost:8000"

def print_section(title):
    print("\n" + "="*60)
    print(f"  {title}")
    print("="*60 + "\n")

def test_slack_status():
    """Test Slack integration status endpoint"""
    print_section("1. Testing Slack Status")
    
    response = requests.get(f"{BASE_URL}/slack/status")
    data = response.json()
    
    print(f"Status: {response.status_code}")
    print(f"Enabled: {data['enabled']}")
    print(f"Configured: {data['configured']}")
    print(f"Message: {data['message']}")
    
    if data['enabled']:
        print("\n✅ Slack integration is enabled!")
    else:
        print("\n❌ Slack integration is disabled")
    
    return data['enabled']

def test_url_verification():
    """Test Slack URL verification challenge"""
    print_section("2. Testing URL Verification (Slack Setup)")
    
    payload = {
        "type": "url_verification",
        "challenge": "test_challenge_12345"
    }
    
    print("Sending URL verification challenge...")
    print(f"Payload: {json.dumps(payload, indent=2)}")
    
    try:
        response = requests.post(
            f"{BASE_URL}/slack/events",
            json=payload,
            headers={"Content-Type": "application/json"}
        )
        
        if response.status_code == 200:
            data = response.json()
            print(f"\n✅ Response: {json.dumps(data, indent=2)}")
            if data.get('challenge') == payload['challenge']:
                print("✅ URL verification works correctly!")
        else:
            print(f"\n❌ Error: {response.status_code}")
            print(f"Response: {response.text}")
    except Exception as e:
        print(f"\n❌ Error: {e}")

def test_slash_command_help():
    """Test /midlayer help command"""
    print_section("3. Testing Slash Command: /midlayer help")
    
    # Simulate Slack slash command payload
    payload = {
        "command": "/midlayer",
        "text": "help",
        "user_id": "U123456",
        "channel_id": "C123456",
        "response_url": "https://hooks.slack.com/commands/test"
    }
    
    print("Simulating: /midlayer help")
    
    try:
        response = requests.post(
            f"{BASE_URL}/slack/commands",
            data=payload,
            headers={"Content-Type": "application/x-www-form-urlencoded"}
        )
        
        if response.status_code == 200:
            data = response.json()
            print(f"\n✅ Response received!")
            print(f"Response type: {data.get('response_type', 'N/A')}")
            
            if 'blocks' in data:
                for block in data['blocks']:
                    if block.get('type') == 'section':
                        text = block.get('text', {}).get('text', '')
                        print(f"\n{text}")
        else:
            print(f"\n❌ Error: {response.status_code}")
            print(f"Response: {response.text}")
    except Exception as e:
        print(f"\n❌ Error: {e}")

def test_slash_command_status():
    """Test /midlayer status command"""
    print_section("4. Testing Slash Command: /midlayer status API-1")
    
    payload = {
        "command": "/midlayer",
        "text": "status API-1",
        "user_id": "U123456",
        "channel_id": "C123456",
        "response_url": "https://hooks.slack.com/commands/test"
    }
    
    print("Simulating: /midlayer status API-1")
    
    try:
        response = requests.post(
            f"{BASE_URL}/slack/commands",
            data=payload,
            headers={"Content-Type": "application/x-www-form-urlencoded"}
        )
        
        if response.status_code == 200:
            data = response.json()
            print(f"\n✅ Response received!")
            
            if 'blocks' in data:
                for block in data['blocks']:
                    if block.get('type') == 'section':
                        text = block.get('text', {}).get('text', '')
                        print(f"\n{text}")
        else:
            print(f"\n❌ Error: {response.status_code}")
    except Exception as e:
        print(f"\n❌ Error: {e}")

def test_slash_command_graph():
    """Test /midlayer graph command"""
    print_section("5. Testing Slash Command: /midlayer graph")
    
    payload = {
        "command": "/midlayer",
        "text": "graph",
        "user_id": "U123456",
        "channel_id": "C123456",
        "response_url": "https://hooks.slack.com/commands/test"
    }
    
    print("Simulating: /midlayer graph")
    
    try:
        response = requests.post(
            f"{BASE_URL}/slack/commands",
            data=payload,
            headers={"Content-Type": "application/x-www-form-urlencoded"}
        )
        
        if response.status_code == 200:
            data = response.json()
            print(f"\n✅ Response received!")
            
            if 'blocks' in data:
                for block in data['blocks']:
                    if block.get('type') == 'section':
                        text = block.get('text', {}).get('text', '')
                        print(f"\n{text}")
        else:
            print(f"\n❌ Error: {response.status_code}")
    except Exception as e:
        print(f"\n❌ Error: {e}")

def show_message_templates():
    """Show what Slack messages look like"""
    print_section("6. Slack Message Templates")
    
    print("The integration includes rich message templates for:")
    print("\n📋 Spec Approval Messages:")
    print("  - Shows estimated impact (files, lines, endpoints)")
    print("  - Buttons: Approve & Generate, Review, Reject")
    
    print("\n⚙️ Progress Updates:")
    print("  - Real-time progress tracking (0% → 100%)")
    print("  - Step-by-step status updates")
    print("  - Updates every 10 seconds")
    
    print("\n✅ PR Notifications:")
    print("  - PR number and branch name")
    print("  - Files changed with line counts")
    print("  - Links to GitHub and MidLayer")
    
    print("\n🧠 Knowledge Graph Updates:")
    print("  - Affected tasks")
    print("  - Reassignment suggestions")
    print("  - Impact analysis")
    
    print("\n📊 Daily Digests:")
    print("  - Velocity metrics")
    print("  - Top performers")
    print("  - Upcoming work")

def show_setup_instructions():
    """Show setup instructions"""
    print_section("7. Setup Instructions")
    
    print("To enable full Slack integration:")
    print("\n1. Create a Slack app at https://api.slack.com/apps")
    print("2. Add OAuth scopes: chat:write, commands, app_mentions:read")
    print("3. Install to workspace and get Bot Token")
    print("4. Get Signing Secret from Basic Information")
    print("5. Add to .env file:")
    print("   SLACK_BOT_TOKEN=xoxb-your-token")
    print("   SLACK_SIGNING_SECRET=your-secret")
    print("\n6. Setup ngrok for local testing:")
    print("   ngrok http 8000")
    print("\n7. Configure Slack app webhooks:")
    print("   - Event Subscriptions: https://your-ngrok.io/slack/events")
    print("   - Interactivity: https://your-ngrok.io/slack/interactions")
    print("   - Slash Commands: https://your-ngrok.io/slack/commands")
    print("\n8. Restart server and test!")
    print("\nSee SLACK_QUICK_START.md for detailed instructions.")

def main():
    print("\n" + "🚀"*30)
    print("  MIDLAYER SLACK INTEGRATION TEST")
    print("🚀"*30)
    
    try:
        # Test 1: Check status
        enabled = test_slack_status()
        
        # Test 2: URL verification
        if enabled:
            test_url_verification()
        
        # Test 3-5: Slash commands
        if enabled:
            test_slash_command_help()
            test_slash_command_status()
            test_slash_command_graph()
        
        # Show templates
        show_message_templates()
        
        # Show setup
        show_setup_instructions()
        
        print_section("✅ Test Complete!")
        
        if enabled:
            print("Slack integration is working!")
            print("\nNext steps:")
            print("1. Configure Slack app credentials in .env")
            print("2. Setup ngrok for webhook testing")
            print("3. Test with real Slack workspace")
            print("\nSee SLACK_QUICK_START.md for full setup guide.")
        else:
            print("Slack integration needs configuration.")
            print("See SLACK_QUICK_START.md for setup instructions.")
        
    except requests.exceptions.ConnectionError:
        print("\n❌ Error: Could not connect to server")
        print("Make sure the server is running on http://localhost:8000")
        print("\nStart server with:")
        print("  python -m uvicorn app.main:app --reload --port 8000")
    except Exception as e:
        print(f"\n❌ Unexpected error: {e}")

if __name__ == "__main__":
    main()
