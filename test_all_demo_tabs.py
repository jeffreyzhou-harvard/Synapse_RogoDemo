#!/usr/bin/env python3
"""
Test all demo tabs to ensure they're working
"""

import requests
import json

BASE_URL = "http://localhost:8000"

def test_tab(name, endpoint, method="GET", data=None):
    """Test a single tab endpoint"""
    print(f"\n{'='*60}")
    print(f"Testing: {name}")
    print(f"{'='*60}")
    
    try:
        if method == "GET":
            response = requests.get(f"{BASE_URL}{endpoint}")
        else:
            response = requests.post(
                f"{BASE_URL}{endpoint}",
                json=data,
                headers={"Content-Type": "application/json"}
            )
        
        if response.status_code == 200:
            result = response.json()
            print(f"✅ {name} - WORKING")
            print(f"Status: {response.status_code}")
            
            # Show relevant data
            if isinstance(result, dict):
                if 'tasks' in result:
                    print(f"Tasks: {len(result['tasks'])}")
                if 'nodes' in result and isinstance(result['nodes'], list):
                    print(f"Nodes: {len(result['nodes'])}")
                if 'edges' in result and isinstance(result['edges'], list):
                    print(f"Edges: {len(result['edges'])}")
                if 'stdout' in result:
                    print(f"Output: {result['stdout']}")
                if 'draft' in result:
                    print(f"Draft length: {len(result['draft'])} chars")
            elif isinstance(result, list):
                print(f"Items: {len(result)}")
            
            return True
        else:
            print(f"❌ {name} - ERROR")
            print(f"Status: {response.status_code}")
            print(f"Response: {response.text[:200]}")
            return False
            
    except Exception as e:
        print(f"❌ {name} - EXCEPTION")
        print(f"Error: {e}")
        return False

def main():
    print("\n" + "🎯"*30)
    print("  TESTING ALL DEMO TABS")
    print("🎯"*30)
    
    results = {}
    
    # Tab 1: Plan
    print("\n\n📋 TAB 1: PLAN")
    results['plan'] = test_tab(
        "Plan Generation",
        "/plan",
        "POST",
        {
            "goal": "Ship a task planning agent MVP",
            "notes": "Test notes",
            "context": {"repo": "midlayer-exp"}
        }
    )
    
    results['prioritize'] = test_tab(
        "Task Prioritization",
        "/prioritize",
        "POST",
        {
            "method": "CUSTOMER",
            "tasks": [
                {
                    "id": "T-1",
                    "title": "Test task",
                    "reach": 100,
                    "impact": 3,
                    "confidence": 0.8,
                    "effort": 2
                }
            ]
        }
    )
    
    # Tab 2: Sandbox
    print("\n\n🧪 TAB 2: SANDBOX")
    results['sandbox'] = test_tab(
        "Code Sandbox",
        "/sandbox/execute",
        "POST",
        {
            "code": "print('Hello from sandbox')\nresult = 2 + 2",
            "timeout_ms": 2000
        }
    )
    
    # Tab 3: RFC
    print("\n\n📝 TAB 3: RFC")
    results['rfc'] = test_tab(
        "RFC Generation",
        "/rfc/draft",
        "POST",
        {"context": "Build a payment processing API with Stripe integration"}
    )
    
    # Tab 4: Graph
    print("\n\n🕸️  TAB 4: DEPENDENCY GRAPH")
    results['graph'] = test_tab(
        "Dependency Graph",
        "/graph/dependencies",
        "POST",
        {"path": "app"}
    )
    
    # Tab 5: Hotspots
    print("\n\n🔥 TAB 5: HOTSPOTS")
    results['hotspots'] = test_tab(
        "Code Hotspots",
        "/hotspots",
        "POST",
        {"path": "app"}
    )
    
    # Tab 6: Runbook
    print("\n\n📖 TAB 6: RUNBOOK")
    results['runbook'] = test_tab(
        "Runbook Execution",
        "/runbook/execute",
        "POST",
        [
            {"action": "echo", "args": {"text": "Starting runbook"}},
            {"action": "http_get", "args": {"url": "http://localhost:8000/health"}}
        ]
    )
    
    # Tab 7: Knowledge Graph
    print("\n\n🧠 TAB 7: KNOWLEDGE GRAPH")
    results['kg_status'] = test_tab(
        "Knowledge Graph Status",
        "/knowledge-graph/status",
        "GET"
    )
    
    results['kg_graph'] = test_tab(
        "Knowledge Graph Data",
        "/knowledge-graph/graph",
        "GET"
    )
    
    results['kg_suggestions'] = test_tab(
        "Reassignment Suggestions",
        "/knowledge-graph/reassignment-suggestions",
        "GET"
    )
    
    # Tab 8: Living Specs
    print("\n\n📊 TAB 8: LIVING SPECS")
    results['specs_living'] = test_tab(
        "Living Technical Spec",
        "/specs/living",
        "GET"
    )
    
    results['specs_decisions'] = test_tab(
        "Architectural Decisions",
        "/specs/architectural-decisions",
        "GET"
    )
    
    results['specs_tech'] = test_tab(
        "Technology Stack",
        "/specs/technology-stack",
        "GET"
    )
    
    # Additional: Agent Delegation
    print("\n\n🤖 BONUS: AGENT DELEGATION")
    results['llm_status'] = test_tab(
        "LLM Status",
        "/llm/status",
        "GET"
    )
    
    # Additional: Slack Integration
    print("\n\n💬 BONUS: SLACK INTEGRATION")
    results['slack_status'] = test_tab(
        "Slack Status",
        "/slack/status",
        "GET"
    )
    
    # Summary
    print("\n\n" + "="*60)
    print("  SUMMARY")
    print("="*60)
    
    total = len(results)
    passed = sum(1 for v in results.values() if v)
    failed = total - passed
    
    print(f"\nTotal Tests: {total}")
    print(f"✅ Passed: {passed}")
    print(f"❌ Failed: {failed}")
    print(f"\nSuccess Rate: {(passed/total)*100:.1f}%")
    
    if failed == 0:
        print("\n🎉 ALL TABS ARE WORKING! 🎉")
        print("\nYour demo is ready to use!")
        print("\nAccess the frontend at: http://localhost:5174")
        print("API documentation at: http://localhost:8000/docs")
    else:
        print("\n⚠️  Some tabs have issues")
        print("\nFailed tests:")
        for name, passed in results.items():
            if not passed:
                print(f"  - {name}")
    
    print("\n" + "="*60)
    
    return failed == 0

if __name__ == "__main__":
    try:
        success = main()
        exit(0 if success else 1)
    except requests.exceptions.ConnectionError:
        print("\n❌ ERROR: Could not connect to server")
        print("Make sure the server is running on http://localhost:8000")
        print("\nStart server with:")
        print("  python -m uvicorn app.main:app --reload --port 8000")
        exit(1)
    except Exception as e:
        print(f"\n❌ Unexpected error: {e}")
        exit(1)
