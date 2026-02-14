# Demo Tabs Guide - All Working! ✅

## 🎉 Status: ALL TABS WORKING (15/15 tests passed)

Access the demo at: **http://localhost:5174**

---

## 📋 Tab 1: Plan

**What it does:** AI-powered task planning and prioritization

### Features:
- **Generate Plan**: Enter a goal and get AI-generated task breakdown
- **Prioritization Methods**: 
  - RICE (Reach × Impact × Confidence / Effort)
  - ICE (Impact × Confidence × Ease)
  - WSJF (Weighted Shortest Job First)
  - Customer Impact
  - Business Impact
- **Task Management**: Edit estimates, priorities, dependencies
- **Critical Path**: Automatically identifies critical tasks
- **Delegation**: Queue tasks for agent execution

### Try it:
1. Enter goal: "Ship a task planning agent MVP"
2. Click "Generate Plan"
3. Select prioritization method
4. Click "Prioritize"
5. View tasks with scores and critical path

---

## 🧪 Tab 2: Sandbox

**What it does:** Execute Python code safely in isolated environment

### Features:
- **Code Editor**: Write Python code
- **Safe Execution**: Runs in sandboxed environment with timeouts
- **Output Display**: See stdout, results, and errors
- **Quick Testing**: Test code snippets without files

### Try it:
```python
print('Hello from sandbox!')
result = 2 + 2
print(f'Result: {result}')

# Try some calculations
import math
print(f'Pi: {math.pi}')
```

Click "Run Sandbox" to execute.

---

## 📝 Tab 3: RFC

**What it does:** AI-generated Request for Comments (RFC) drafts

### Features:
- **Context-Aware**: Uses your goal/notes as context
- **Structured Format**: Generates proper RFC structure
- **Quick Drafts**: Get started with AI suggestions
- **Editable**: Use as starting point for your RFC

### Try it:
1. Enter context: "Build a payment processing API with Stripe"
2. Click "Generate RFC"
3. Review the generated RFC structure
4. Edit and refine as needed

---

## 🕸️ Tab 4: Dependency Graph

**What it does:** Visualize code dependencies and relationships

### Features:
- **Import Analysis**: Scans Python files for imports
- **Dependency Mapping**: Shows which files depend on what
- **Module Relationships**: Visualize your codebase structure
- **Metrics**: Node and edge counts

### Try it:
1. Click "Load Graph"
2. See nodes (files) and edges (dependencies)
3. Understand your codebase structure

**Current Stats:**
- 6 files analyzed
- 66 dependencies mapped

---

## 🔥 Tab 5: Hotspots

**What it does:** Identify complex or problematic code areas

### Features:
- **Complexity Analysis**: Lines of code per file
- **Churn Detection**: Files that change frequently
- **Hotspot Scoring**: Identifies high-risk areas
- **Prioritization**: Focus refactoring efforts

### Try it:
1. Click "Load Hotspots"
2. See files ranked by complexity
3. Identify areas needing attention

**Current Hotspots:**
- main.py: 2,540 lines
- slack_service.py: 528 lines
- slack_endpoints.py: 320 lines

---

## 📖 Tab 6: Runbook

**What it does:** Execute automated operational playbooks

### Features:
- **Automated Tasks**: Run sequences of operations
- **HTTP Requests**: Make API calls
- **Echo Commands**: Log messages
- **Event Timeline**: See execution history
- **Error Handling**: Graceful failure handling

### Try it:
1. Click "Run Runbook"
2. Watch automated tasks execute
3. See event timeline with results

**Example Runbook:**
```json
[
  {"action": "echo", "args": {"text": "Starting deployment"}},
  {"action": "http_get", "args": {"url": "http://localhost:8000/health"}}
]
```

---

## 🧠 Tab 7: Knowledge Graph

**What it does:** Intelligent task and team relationship mapping

### Features:
- **Task Relationships**: Dependencies, blocks, encompasses
- **Team Mapping**: Who owns what
- **Agent Assignments**: Track AI agent work
- **Reassignment Suggestions**: AI-powered optimization
- **Impact Analysis**: See how tasks affect each other

### Try it:
1. Generate a plan first (Tab 1)
2. Switch to Knowledge tab
3. Click "Load Knowledge Graph"
4. View graph visualization
5. See reassignment suggestions

**Current Stats:**
- 16 nodes (tasks, teams, components)
- 24 relationships
- 0 active agents (start delegating tasks!)

### Visualizations:
- **Graph Modal**: Interactive D3.js visualization
- **Status Panel**: Real-time statistics
- **Suggestions**: AI-powered recommendations

---

## 📊 Tab 8: Living Specs

**What it does:** Auto-generated technical documentation from code

### Features:
- **Living Documentation**: Always up-to-date with code
- **Architecture Analysis**: Detected patterns and decisions
- **Technology Stack**: Auto-discovered technologies
- **API Endpoints**: Extracted from code
- **Database Models**: Detected schemas
- **Gap Analysis**: Unimplemented features

### Try it:
1. Click "Load Living Spec"
2. See auto-generated documentation
3. Review architectural decisions
4. Check technology stack

### Sections:
- **Overview**: Tasks, files, technologies
- **Architecture**: Decisions, patterns, stack
- **Implementation**: APIs, database, auth
- **Gaps**: Planned but not implemented

---

## 🤖 Bonus Features

### Agent Delegation
- **AI Code Generation**: From design docs to PRs
- **GitHub Integration**: Automatic branch and PR creation
- **Preview Changes**: Review before committing
- **Status**: Check `/llm/status` for AI availability

### Slack Integration
- **Slash Commands**: `/midlayer help`, `/midlayer status`, etc.
- **Interactive Buttons**: Approve specs, view PRs
- **Real-time Updates**: Progress tracking
- **Status**: Check `/slack/status` for configuration

---

## 🎯 Demo Workflow

### Quick Demo (5 minutes):

1. **Tab 1 (Plan)**: Generate a plan
   - Goal: "Ship a task planning agent MVP"
   - Click "Generate Plan"
   - Click "Prioritize" with CUSTOMER method

2. **Tab 7 (Knowledge)**: View the graph
   - Click "Load Knowledge Graph"
   - See tasks and relationships
   - View reassignment suggestions

3. **Tab 2 (Sandbox)**: Test code execution
   - Write: `print("Hello!")`
   - Click "Run Sandbox"
   - See output

4. **Tab 3 (RFC)**: Generate documentation
   - Context: "Build payment API"
   - Click "Generate RFC"
   - Review structure

5. **Tab 8 (Specs)**: View living docs
   - Click "Load Living Spec"
   - See auto-generated documentation

### Full Demo (15 minutes):

Add these steps:

6. **Tab 4 (Graph)**: Analyze dependencies
7. **Tab 5 (Hotspots)**: Find complex code
8. **Tab 6 (Runbook)**: Execute automation

---

## 🔧 Troubleshooting

### Frontend not loading?
```bash
# Check if frontend is running
curl http://localhost:5174

# Restart if needed
cd web
npm run dev
```

### Backend not responding?
```bash
# Check if backend is running
curl http://localhost:8000/health

# Restart if needed
python -m uvicorn app.main:app --reload --port 8000
```

### Test all tabs:
```bash
python test_all_demo_tabs.py
```

---

## 📊 Test Results

```
Total Tests: 15
✅ Passed: 15
❌ Failed: 0
Success Rate: 100.0%
```

### Tested Endpoints:
✅ Plan Generation  
✅ Task Prioritization  
✅ Code Sandbox  
✅ RFC Generation  
✅ Dependency Graph  
✅ Code Hotspots  
✅ Runbook Execution  
✅ Knowledge Graph Status  
✅ Knowledge Graph Data  
✅ Reassignment Suggestions  
✅ Living Technical Spec  
✅ Architectural Decisions  
✅ Technology Stack  
✅ LLM Status  
✅ Slack Status  

---

## 🚀 Next Steps

### For Demo:
1. ✅ All tabs working
2. Practice the demo flow
3. Prepare talking points
4. Record demo video

### For Development:
1. Add more prioritization methods
2. Enhance knowledge graph visualization
3. Add more runbook actions
4. Expand living specs analysis

### For Production:
1. Add authentication
2. Implement user preferences
3. Add data persistence
4. Deploy to cloud

---

## 📞 Support

- **Test Suite**: `python test_all_demo_tabs.py`
- **API Docs**: http://localhost:8000/docs
- **Frontend**: http://localhost:5174
- **Backend**: http://localhost:8000

---

## 🎉 You're Ready!

All 8 tabs + bonus features are working perfectly. Your demo is ready to showcase!

**Access the demo**: http://localhost:5174

**Happy demoing!** 🚀
