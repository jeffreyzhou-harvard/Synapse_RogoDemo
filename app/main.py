from __future__ import annotations

import os
from typing import List, Optional, Dict, Any, Tuple, Set
import json
import io
import time
import ast
import subprocess
import contextlib
import uuid
import re
from multiprocessing import Process, Queue
from urllib.parse import urlencode

from fastapi import FastAPI, HTTPException, Request, BackgroundTasks, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
import networkx as nx
from dotenv import load_dotenv
from pathlib import Path

try:
    from openai import OpenAI  # type: ignore
except Exception:  # pragma: no cover
    OpenAI = None  # type: ignore

try:
    import google.generativeai as genai  # type: ignore
except Exception:  # pragma: no cover
    genai = None  # type: ignore

try:
    from anthropic import Anthropic  # type: ignore
except Exception:  # pragma: no cover
    Anthropic = None  # type: ignore

try:
    from deepgram import DeepgramClient, PrerecordedOptions  # type: ignore
except Exception:  # pragma: no cover
    DeepgramClient = None  # type: ignore
    PrerecordedOptions = None  # type: ignore

import httpx


# Load .env from project root explicitly (robust for different CWDs)
_ENV_PATH = Path(__file__).resolve().parents[1] / ".env"
load_dotenv(dotenv_path=_ENV_PATH, override=True)

app = FastAPI(title="MidLayer-Exp", version="0.1.0")

# Allow local frontend dev
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Global knowledge graph and agent state
global_knowledge_graph = None  # Will be initialized after class definitions
agent_assignments: Dict[str, AgentAssignment] = {}
active_agents: Set[str] = set()

def generate_agent_id() -> str:
    """Generate a unique agent ID"""
    return f"agent_{uuid.uuid4().hex[:8]}"

def initialize_knowledge_graph_from_plan(plan: List[Task]) -> None:
    """Initialize knowledge graph when a new plan is created"""
    current_time = time.time()
    
    # Add task nodes
    for task in plan:
        node = KnowledgeNode(
            id=task.id,
            type="task",
            name=task.title,
            properties={
                "description": task.description,
                "estimate": task.estimate,
                "priority": task.priority,
                "status": task.status if hasattr(task, 'status') else "todo",
                "keywords": extract_keywords(task.title + " " + (task.description or "")),
                "tech_category": task.id.split('-')[0] if '-' in task.id else 'GENERAL',
                "team": task.team if hasattr(task, 'team') else None,
                "owner": task.owner if hasattr(task, 'owner') else None
            },
            created_at=current_time,
            updated_at=current_time
        )
        global_knowledge_graph.add_node(node)
        
        # Add team/owner nodes if they exist
        if hasattr(task, 'team') and task.team:
            team_node = KnowledgeNode(
                id=f"team_{task.team.lower().replace(' ', '_')}",
                type="team",
                name=task.team,
                properties={"members": []},
                created_at=current_time,
                updated_at=current_time
            )
            if team_node.id not in global_knowledge_graph.nodes:
                global_knowledge_graph.add_node(team_node)
            
            # Add edge from team to task
            edge = KnowledgeEdge(
                id=f"{team_node.id}_responsible_for_{task.id}",
                source_id=team_node.id,
                target_id=task.id,
                relationship="responsible_for",
                created_at=current_time
            )
            global_knowledge_graph.add_edge(edge)
            
        if hasattr(task, 'owner') and task.owner:
            owner_node = KnowledgeNode(
                id=f"person_{task.owner.lower().replace(' ', '_')}",
                type="person",
                name=task.owner,
                properties={"assigned_tasks": [task.id]},
                created_at=current_time,
                updated_at=current_time
            )
            if owner_node.id not in global_knowledge_graph.nodes:
                global_knowledge_graph.add_node(owner_node)
            else:
                # Update existing person's assigned tasks
                existing_person = global_knowledge_graph.nodes[owner_node.id]
                assigned_tasks = existing_person.properties.get("assigned_tasks", [])
                if task.id not in assigned_tasks:
                    assigned_tasks.append(task.id)
                    existing_person.properties["assigned_tasks"] = assigned_tasks
            
            # Add edge from person to task
            edge = KnowledgeEdge(
                id=f"{owner_node.id}_assigned_to_{task.id}",
                source_id=owner_node.id,
                target_id=task.id,
                relationship="assigned_to",
                created_at=current_time
            )
            global_knowledge_graph.add_edge(edge)
    
    # Add dependency edges
    for task in plan:
        if task.dependencies:
            for dep_id in task.dependencies:
                edge = KnowledgeEdge(
                    id=f"{dep_id}_blocks_{task.id}",
                    source_id=dep_id,
                    target_id=task.id,
                    relationship="blocks",
                    created_at=current_time
                )
                global_knowledge_graph.add_edge(edge)
                
    # Add component nodes based on tech categories
    tech_components = set()
    for task in plan:
        tech_category = task.id.split('-')[0] if '-' in task.id else 'GENERAL'
        tech_components.add(tech_category)
    
    for component in tech_components:
        comp_node = KnowledgeNode(
            id=f"component_{component.lower()}",
            type="component",
            name=f"{component} Component",
            properties={
                "category": component,
                "related_tasks": [t.id for t in plan if t.id.startswith(component)]
            },
            created_at=current_time,
            updated_at=current_time
        )
        global_knowledge_graph.add_node(comp_node)
        
        # Add edges from component to related tasks
        for task in plan:
            if task.id.startswith(component):
                edge = KnowledgeEdge(
                    id=f"{comp_node.id}_encompasses_{task.id}",
                    source_id=comp_node.id,
                    target_id=task.id,
                    relationship="encompasses",
                    created_at=current_time
                )
                global_knowledge_graph.add_edge(edge)

def extract_keywords(text: str) -> List[str]:
    """Extract keywords from task text for semantic analysis"""
    # Simple keyword extraction - could be enhanced with NLP
    tech_keywords = ['api', 'database', 'frontend', 'backend', 'auth', 'user', 'schema', 
                    'component', 'endpoint', 'migration', 'test', 'deploy', 'docker']
    
    words = text.lower().split()
    keywords = [word for word in words if word in tech_keywords or len(word) > 5]
    return list(set(keywords))

def update_knowledge_graph_on_completion(task_id: str, execution_result: Dict[str, Any]) -> List[ReassignmentSuggestion]:
    """Update knowledge graph when a task completes and suggest reassignments"""
    current_time = time.time()
    
    # Update task node
    if task_id in global_knowledge_graph.nodes:
        node = global_knowledge_graph.nodes[task_id]
        node.properties.update({
            'status': 'completed',
            'files_created': execution_result.get('files_created', []),
            'completion_time': current_time
        })
        node.updated_at = current_time
    
    # Add file nodes for created files
    for file_path in execution_result.get('files_created', []):
        file_node = KnowledgeNode(
            id=f"file_{file_path.replace('/', '_')}",
            type="file",
            name=file_path,
            properties={
                'path': file_path,
                'created_by_task': task_id,
                'file_type': file_path.split('.')[-1] if '.' in file_path else 'unknown'
            },
            created_at=current_time,
            updated_at=current_time
        )
        global_knowledge_graph.add_node(file_node)
        
        # Add edge from task to file
        edge = KnowledgeEdge(
            id=f"{task_id}_creates_{file_node.id}",
            source_id=task_id,
            target_id=file_node.id,
            relationship="creates",
            created_at=current_time
        )
        global_knowledge_graph.add_edge(edge)
    
    # Find affected tasks and generate reassignment suggestions
    affected_task_ids = global_knowledge_graph.find_affected_tasks(task_id)
    suggestions = []
    
    for affected_id in affected_task_ids:
        suggestion = analyze_reassignment_need(affected_id, task_id)
        if suggestion:
            suggestions.append(suggestion)
    
    return suggestions

def analyze_reassignment_need(task_id: str, completed_task_id: str) -> Optional[ReassignmentSuggestion]:
    """Analyze if a task needs reassignment based on completed task knowledge"""
    if task_id not in global_knowledge_graph.nodes:
        return None
    
    task_node = global_knowledge_graph.nodes[task_id]
    completed_node = global_knowledge_graph.nodes.get(completed_task_id)
    
    if not completed_node:
        return None
    
    # Find current assignment
    current_assignment = None
    for assignment in agent_assignments.values():
        if assignment.task_id == task_id and assignment.status in ['assigned', 'in_progress']:
            current_assignment = assignment
            break
    
    # Determine best agent based on knowledge gained from completed task
    suggested_agent = find_optimal_agent_for_task(task_node, completed_node)
    
    # If no current assignment or different optimal agent, suggest reassignment
    if not current_assignment or current_assignment.agent_id != suggested_agent:
        confidence = calculate_reassignment_confidence(task_node, completed_node)
        reason = generate_reassignment_reason(task_node, completed_node)
        
        return ReassignmentSuggestion(
            task_id=task_id,
            current_agent=current_assignment.agent_id if current_assignment else None,
            suggested_agent=suggested_agent,
            reason=reason,
            confidence=confidence,
            affected_by=[completed_task_id]
        )
    
    return None

def find_optimal_agent_for_task(task_node: KnowledgeNode, completed_node: KnowledgeNode) -> str:
    """Find the optimal agent for a task based on knowledge graph"""
    # For now, assign based on tech category - could be enhanced with agent skill tracking
    tech_category = task_node.properties.get('tech_category', 'GENERAL')
    
    # Try to find an agent already working on similar tasks
    for assignment in agent_assignments.values():
        if assignment.status in ['assigned', 'in_progress']:
            assigned_task = global_knowledge_graph.nodes.get(assignment.task_id)
            if assigned_task and assigned_task.properties.get('tech_category') == tech_category:
                return assignment.agent_id
    
    # Generate new agent for this category
    return generate_agent_id()

def calculate_reassignment_confidence(task_node: KnowledgeNode, completed_node: KnowledgeNode) -> float:
    """Calculate confidence score for reassignment suggestion"""
    # Simple heuristic - could be enhanced with ML
    shared_keywords = set(task_node.properties.get('keywords', [])).intersection(
        set(completed_node.properties.get('keywords', []))
    )
    
    confidence = min(len(shared_keywords) / 3.0, 1.0)  # Max confidence at 3+ shared keywords
    return confidence

def generate_reassignment_reason(task_node: KnowledgeNode, completed_node: KnowledgeNode) -> str:
    """Generate human-readable reason for reassignment"""
    shared_keywords = set(task_node.properties.get('keywords', [])).intersection(
        set(completed_node.properties.get('keywords', []))
    )
    
    if shared_keywords:
        return f"Task shares {len(shared_keywords)} technical concepts with completed task: {', '.join(list(shared_keywords)[:3])}"
    else:
        return "Task dependencies resolved by completed task"

def analyze_code_file(file_path: str) -> Dict[str, Any]:
    """Analyze a code file to extract technical patterns and decisions"""
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            content = f.read()
        
        analysis = {
            'file_type': file_path.split('.')[-1] if '.' in file_path else 'unknown',
            'imports': [],
            'classes': [],
            'functions': [],
            'api_endpoints': [],
            'database_models': [],
            'patterns': [],
            'technologies': [],
            'architectural_decisions': []
        }
        
        lines = content.split('\n')
        
        # Extract imports
        for line in lines:
            line = line.strip()
            if line.startswith(('import ', 'from ')):
                analysis['imports'].append(line)
                # Detect technologies from imports
                if 'fastapi' in line.lower():
                    analysis['technologies'].append('FastAPI')
                elif 'flask' in line.lower():
                    analysis['technologies'].append('Flask')
                elif 'django' in line.lower():
                    analysis['technologies'].append('Django')
                elif 'sqlalchemy' in line.lower():
                    analysis['technologies'].append('SQLAlchemy')
                elif 'jwt' in line.lower():
                    analysis['technologies'].append('JWT Authentication')
                elif 'bcrypt' in line.lower():
                    analysis['technologies'].append('Password Hashing')
                elif 'redis' in line.lower():
                    analysis['technologies'].append('Redis Cache')
        
        # Extract functions and API endpoints
        for line in lines:
            line = line.strip()
            if line.startswith('def '):
                func_name = line.split('(')[0].replace('def ', '')
                analysis['functions'].append(func_name)
            elif '@app.' in line:  # FastAPI/Flask routes
                method = line.split('@app.')[1].split('(')[0]
                if '("' in line:
                    endpoint = line.split('("')[1].split('")')[0]
                    analysis['api_endpoints'].append(f"{method.upper()} {endpoint}")
        
        # Extract classes (potential models)
        for line in lines:
            line = line.strip()
            if line.startswith('class '):
                class_name = line.split('(')[0].replace('class ', '')
                analysis['classes'].append(class_name)
                if 'BaseModel' in line or 'Model' in line:
                    analysis['database_models'].append(class_name)
        
        # Detect architectural patterns
        content_lower = content.lower()
        if 'middleware' in content_lower:
            analysis['patterns'].append('Middleware Pattern')
        if 'factory' in content_lower:
            analysis['patterns'].append('Factory Pattern')
        if 'singleton' in content_lower:
            analysis['patterns'].append('Singleton Pattern')
        if '@decorator' in content or 'decorator' in content_lower:
            analysis['patterns'].append('Decorator Pattern')
        
        # Detect architectural decisions
        if 'jwt' in content_lower and 'auth' in content_lower:
            analysis['architectural_decisions'].append({
                'decision': 'JWT Authentication',
                'reasoning': 'Stateless authentication chosen over session-based',
                'trade_offs': 'Better scalability, but token management complexity'
            })
        
        if 'redis' in content_lower:
            analysis['architectural_decisions'].append({
                'decision': 'Redis for Caching',
                'reasoning': 'In-memory caching for performance',
                'trade_offs': 'Fast access but additional infrastructure dependency'
            })
        
        if 'async def' in content:
            analysis['architectural_decisions'].append({
                'decision': 'Asynchronous Architecture',
                'reasoning': 'Non-blocking operations for better performance',
                'trade_offs': 'Higher performance but increased complexity'
            })
        
        return analysis
        
    except Exception as e:
        return {'error': str(e), 'file_path': file_path}

def generate_living_spec_from_knowledge_graph() -> Dict[str, Any]:
    """Generate a living technical specification from the current knowledge graph"""
    spec = {
        'title': 'Living Technical Specification',
        'generated_at': time.time(),
        'version': '1.0',
        'overview': {
            'tasks_completed': 0,
            'files_created': 0,
            'technologies_used': set(),
            'patterns_detected': set(),
            'api_endpoints': [],
            'database_models': []
        },
        'architecture': {
            'decisions': [],
            'patterns': [],
            'technology_stack': []
        },
        'implementation': {
            'apis': {},
            'database': {},
            'authentication': {},
            'caching': {},
            'deployment': {}
        },
        'gaps': []
    }
    
    # Analyze all file nodes in knowledge graph
    for node_id, node in global_knowledge_graph.nodes.items():
        if node.type == 'file':
            file_path = node.properties.get('path', '')
            if file_path and os.path.exists(file_path):
                analysis = analyze_code_file(file_path)
                
                # Update overview
                spec['overview']['files_created'] += 1
                spec['overview']['technologies_used'].update(analysis.get('technologies', []))
                spec['overview']['patterns_detected'].update(analysis.get('patterns', []))
                spec['overview']['api_endpoints'].extend(analysis.get('api_endpoints', []))
                spec['overview']['database_models'].extend(analysis.get('database_models', []))
                
                # Update architecture decisions
                spec['architecture']['decisions'].extend(analysis.get('architectural_decisions', []))
                
                # Update implementation sections based on file analysis
                if 'auth' in file_path.lower() or 'jwt' in str(analysis.get('technologies', [])).lower():
                    spec['implementation']['authentication'] = {
                        'type': 'JWT' if 'JWT' in analysis.get('technologies', []) else 'Unknown',
                        'implementation_file': file_path,
                        'functions': analysis.get('functions', []),
                        'endpoints': [ep for ep in analysis.get('api_endpoints', []) if 'auth' in ep.lower()]
                    }
                
                if 'redis' in str(analysis.get('technologies', [])).lower():
                    spec['implementation']['caching'] = {
                        'type': 'Redis',
                        'implementation_file': file_path
                    }
    
    # Convert sets to lists for JSON serialization
    spec['overview']['technologies_used'] = list(spec['overview']['technologies_used'])
    spec['overview']['patterns_detected'] = list(spec['overview']['patterns_detected'])
    
    # Count completed tasks
    spec['overview']['tasks_completed'] = len([
        node for node in global_knowledge_graph.nodes.values()
        if node.type == 'task' and node.properties.get('status') == 'completed'
    ])
    
    # Generate gap analysis
    planned_tasks = [
        node for node in global_knowledge_graph.nodes.values()
        if node.type == 'task' and node.properties.get('status') != 'completed'
    ]
    
    if planned_tasks:
        spec['gaps'] = [
            {
                'type': 'Unimplemented Feature',
                'description': f"Task '{task.name}' is planned but not implemented",
                'task_id': task.id
            }
            for task in planned_tasks[:5]  # Top 5 gaps
        ]
    
    return spec


class Task(BaseModel):
    # Allow camelCase aliases from LLMs (e.g., dueDate → due_date)
    model_config = {
        "populate_by_name": True,
        "str_strip_whitespace": True,
        "extra": "ignore",
    }
    id: str
    title: str
    description: str = ""
    priority: str = Field("P2", pattern=r"P[0-3]")
    owner: Optional[str] = None
    estimate: Optional[str] = None  # e.g. "2d", "6h"
    dependencies: List[str] = Field(default_factory=list)
    status: str = Field("todo")

    # Optional attributes for prioritization/constraints
    team: Optional[str] = None
    skills: List[str] = Field(default_factory=list)
    due_date: Optional[str] = Field(default=None, alias="dueDate")
    impact: Optional[float] = None
    reach: Optional[float] = None
    confidence: Optional[float] = None
    effort: Optional[float] = None
    business_value: Optional[float] = Field(default=None, alias="businessValue")
    time_criticality: Optional[float] = Field(default=None, alias="timeCriticality")
    risk_reduction: Optional[float] = Field(default=None, alias="riskReduction")
    
    # Customer Success Metrics
    customer_impact_score: Optional[float] = Field(default=None, alias="customerImpactScore")
    revenue_impact: Optional[float] = Field(default=None, alias="revenueImpact")  # Expected $ impact
    retention_impact: Optional[float] = Field(default=None, alias="retentionImpact")  # % improvement
    satisfaction_impact: Optional[float] = Field(default=None, alias="satisfactionImpact")  # NPS/CSAT improvement
    adoption_impact: Optional[float] = Field(default=None, alias="adoptionImpact")  # % user adoption
    success_metrics: Optional[List[str]] = Field(default=None, alias="successMetrics")  # Specific KPIs this affects


class PlanResponse(BaseModel):
    goal: str
    tasks: List[Task]
    critical_path: List[str]
    notes: str = ""


# Schema for structured Gemini output
class LlmPlanTask(BaseModel):
    id: str
    title: str
    description: Optional[str] = ""
    estimate: Optional[str] = None
    dependencies: List[str] = []
    priority: Optional[str] = None
    owner: Optional[str] = None
    reach: Optional[float] = None
    impact: Optional[float] = None
    confidence: Optional[float] = None
    effort: Optional[float] = None


class LlmPlan(BaseModel):
    goal: str
    tasks: List[LlmPlanTask]
    criticalPath: Optional[List[str]] = None
    notes: Optional[str] = ""


def parse_estimate_hours(estimate: Optional[str]) -> float:
    if not estimate:
        return 8.0
    e = estimate.strip().lower()
    try:
        value = float(e[:-1])
        unit = e[-1]
        if unit == "h":
            return value
        if unit == "d":
            return value * 8
        if unit == "w":
            return value * 40
        if unit == "m":
            return value * 160
    except Exception:
        pass
    return 8.0


def compute_critical_path(tasks: List[Task]) -> List[str]:
    g = nx.DiGraph()
    for t in tasks:
        g.add_node(t.id, duration=t.effort or parse_estimate_hours(t.estimate))
    for t in tasks:
        for dep in t.dependencies:
            if dep in g and t.id in g:
                g.add_edge(dep, t.id)
    try:
        order = list(nx.topological_sort(g))
    except Exception:
        return [t.id for t in tasks]
    # Longest path by duration
    dist: Dict[str, float] = {}
    prev: Dict[str, Optional[str]] = {}
    for n in order:
        dur = float(g.nodes[n].get("duration", 0))
        best = dur
        parent: Optional[str] = None
        for p in g.predecessors(n):
            cand = dist.get(p, 0.0) + dur
            if cand > best:
                best = cand
                parent = p
        dist[n] = best
        prev[n] = parent
    if not order:
        return []
    end = max(order, key=lambda n: dist.get(n, 0.0))
    path: List[str] = []
    cur: Optional[str] = end
    while cur is not None:
        path.append(cur)
        cur = prev.get(cur)
    return list(reversed(path))


def heuristic_plan(goal: str) -> PlanResponse:
    tasks = [
        Task(id="T-1", title=goal, description="Clarify scope, constraints, success metrics.", priority="P1", estimate="1d"),
        Task(id="T-2", title="Break down requirements", dependencies=["T-1"], estimate="1d"),
        Task(id="T-3", title="Design plan", dependencies=["T-2"], estimate="2d"),
        Task(id="T-4", title="Implementation", dependencies=["T-3"], estimate="4d"),
        Task(id="T-5", title="QA and docs", dependencies=["T-4"], estimate="2d"),
    ]
    cp = compute_critical_path(tasks)
    return PlanResponse(goal=goal, tasks=tasks, critical_path=cp, notes="Heuristic plan generated locally.")


class PlanRequest(BaseModel):
    goal: str
    notes: str = ""
    instructions: Optional[str] = None  # user-provided planning guidance
    context: Dict[str, Any] = Field(default_factory=dict)
    freeform: Optional[str] = None  # Notion-like unstructured notes input


@app.get("/health")
def health() -> Dict[str, bool]:
    return {"ok": True}


@app.get("/llm/status")
def llm_status() -> Dict[str, bool]:
    return {
        "claude": bool(os.getenv("ANTHROPIC_API_KEY")) and Anthropic is not None,
        "gemini": bool(os.getenv("GOOGLE_API_KEY")) and genai is not None,
        "openai": bool(os.getenv("OPENAI_API_KEY")) and OpenAI is not None,
    }


def _call_claude(prompt: str, system_prompt: str = "", max_tokens: int = 4000) -> str:
    """Helper function to call Claude Sonnet API"""
    anthropic_key = os.getenv("ANTHROPIC_API_KEY")
    if not anthropic_key or Anthropic is None:
        raise HTTPException(status_code=503, detail="Claude API not available")
    
    try:
        client = Anthropic(api_key=anthropic_key)
        
        messages = [{"role": "user", "content": prompt}]
        
        response = client.messages.create(
            model=os.getenv("DEFAULT_MODEL", "claude-sonnet-4-20250514"),
            max_tokens=max_tokens,
            temperature=float(os.getenv("TEMPERATURE", "0.7")),
            system=system_prompt if system_prompt else "You are a helpful AI assistant.",
            messages=messages
        )
        
        return response.content[0].text
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Claude API error: {str(e)}")


def _call_gemini(prompt: str, system_prompt: str = "", max_tokens: int = 4000) -> str:
    """Helper function to call Google Gemini API"""
    google_key = os.getenv("GOOGLE_API_KEY")
    if not google_key or genai is None:
        raise HTTPException(status_code=503, detail="Gemini API not available")
    
    try:
        genai.configure(api_key=google_key)
        
        # Combine system prompt and user prompt for Gemini
        full_prompt = f"{system_prompt}\n\n{prompt}" if system_prompt else prompt
        
        model = genai.GenerativeModel('gemini-2.0-flash')
        response = model.generate_content(
            full_prompt,
            generation_config=genai.types.GenerationConfig(
                max_output_tokens=max_tokens,
                temperature=float(os.getenv("TEMPERATURE", "0.7")),
            )
        )
        
        return response.text
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Gemini API error: {str(e)}")


def _call_ai_with_fallback(prompt: str, system_prompt: str = "", max_tokens: int = 4000, prefer_claude: bool = False) -> str:
    """
    Smart AI service selector with fallback support.
    Respects PREFERRED_AI_SERVICE environment variable, with manual override via prefer_claude parameter.
    """
    services = []
    
    # Check environment preference (can be overridden by prefer_claude parameter)
    env_preference = os.getenv("PREFERRED_AI_SERVICE", "gemini").lower()
    should_prefer_claude = prefer_claude or (env_preference == "claude")
    
    # Determine order based on preference
    if should_prefer_claude:
        if os.getenv("ANTHROPIC_API_KEY") and Anthropic is not None:
            services.append(("Claude", _call_claude))
        if os.getenv("GOOGLE_API_KEY") and genai is not None:
            services.append(("Gemini", _call_gemini))
    else:
        if os.getenv("GOOGLE_API_KEY") and genai is not None:
            services.append(("Gemini", _call_gemini))
        if os.getenv("ANTHROPIC_API_KEY") and Anthropic is not None:
            services.append(("Claude", _call_claude))
    
    # Try each service in order
    errors = []
    for service_name, service_func in services:
        try:
            return service_func(prompt, system_prompt, max_tokens)
        except Exception as e:
            error_msg = str(e)
            # Extract a short, user-friendly message
            if "credit balance is too low" in error_msg:
                short_msg = f"{service_name}: API credits exhausted — add billing"
            elif "exceeded your current quota" in error_msg or "429" in error_msg:
                short_msg = f"{service_name}: Rate limit / quota exceeded — wait or upgrade"
            elif "invalid_api_key" in error_msg or "401" in error_msg:
                short_msg = f"{service_name}: Invalid API key"
            elif "not_found_error" in error_msg or "404" in error_msg:
                short_msg = f"{service_name}: Model not found — check model name"
            else:
                short_msg = f"{service_name}: {error_msg[:120]}"
            print(f"[AI Fallback] {service_name} failed: {error_msg}")
            errors.append(short_msg)
            continue
    
    # If all services fail, raise with clear summary
    if errors:
        summary = " | ".join(errors)
        raise HTTPException(status_code=503, detail=f"All AI services failed — {summary}")
    else:
        raise HTTPException(status_code=503, detail="No AI services configured. Add ANTHROPIC_API_KEY or GOOGLE_API_KEY to .env")


def _try_parse_json(text: str) -> Optional[Dict[str, Any]]:
    """Enhanced JSON parser that handles various AI response formats"""
    if not text or not text.strip():
        return None
    
    text = text.strip()
    
    # Try direct JSON parsing first
    try:
        return json.loads(text)
    except Exception:
        pass
    
    # Try fenced code blocks ```json ... ```
    if text.startswith("```"):
        try:
            # Remove opening and closing ```
            inner = text.strip('`').strip()
            # Remove language tag if present (e.g., json) and split first newline
            if inner.startswith("json\n"):
                inner = inner[len("json\n"):].strip()
            elif inner.startswith("json "):
                inner = inner[len("json "):].strip()
            return json.loads(inner)
        except Exception:
            pass
    
    # Try to find JSON between other text (common with Claude)
    import re
    json_pattern = r'\{.*\}'
    matches = re.findall(json_pattern, text, re.DOTALL)
    for match in matches:
        try:
            return json.loads(match)
        except Exception:
            continue
    
    # Try to extract JSON from Claude's typical response pattern
    if "```json" in text.lower():
        try:
            start = text.lower().find("```json") + 7
            end = text.find("```", start)
            if end != -1:
                json_content = text[start:end].strip()
                return json.loads(json_content)
        except Exception:
            pass
    
    # Look for JSON starting with { and ending with }
    start_idx = text.find('{')
    end_idx = text.rfind('}')
    if start_idx != -1 and end_idx != -1 and end_idx > start_idx:
        try:
            json_content = text[start_idx:end_idx + 1]
            return json.loads(json_content)
        except Exception:
            pass
    
    return None


@app.post("/plan", response_model=PlanResponse)
def plan(req: PlanRequest) -> PlanResponse:
    # System/instructions: configurable via env or request; defaults kept minimal
    system = os.getenv("PLANNER_SYSTEM_PROMPT", "Return ONLY JSON for a task plan.")
    guidance = os.getenv("PLANNER_GUIDANCE", "")
    if req.instructions:
        guidance = (guidance + "\n" + req.instructions).strip()
    # Build prompt either from freeform or structured fields
    if req.freeform and req.freeform.strip():
        prompt = (f"Freeform Notes (infer goal, metrics, constraints, and task breakdown):\n{req.freeform}\n\n"
                  f"If additional hints: {guidance}").strip()
    else:
        prompt = (f"Goal: {req.goal}\nNotes: {req.notes}\nContext: {req.context}\n{guidance}".strip())

    content: Optional[str] = None

    # Prefer Claude if configured
    anthropic_key = os.getenv("ANTHROPIC_API_KEY")
    if anthropic_key and Anthropic is not None:
        try:
            # Use Claude Sonnet for planning
            full_prompt = f"""LEARNING PLAN GENERATION TASK:

Use freeform if present; otherwise use fields.
Freeform: {req.freeform}
Learning Goal: {req.goal}
Additional Notes: {req.notes}
Context: {req.context}

Your mission: Transform this learning goal into a structured, progressive study plan.

THINK LIKE AN EXPERT TUTOR + CURRICULUM DESIGNER:
1. Break the learning goal into logical modules/topics
2. Identify prerequisites and dependencies between topics  
3. Create specific, achievable learning modules spanning:
   - Foundational concepts (FOUNDATION-X)
   - Core theory and principles (CORE-X)
   - Hands-on practice exercises (PRACTICE-X)
   - Applied projects and case studies (PROJECT-X)
   - Assessment and review (REVIEW-X)

Return a JSON object with this structure:
{{
  "goal": "Structured learning path for the subject",
  "tasks": [
    {{
      "id": "FOUNDATION-1",
      "title": "Understand the basic terminology and history",
      "description": "Learn the fundamental vocabulary, key historical developments, and why this subject matters. Start with the big picture before diving into details.",
      "estimate": "2h",
      "dependencies": [],
      "priority": "P0",
      "reach": 100,
      "impact": 5.0,
      "confidence": 5.0,
      "effort": 2,
      "customerImpactScore": 9.0,
      "revenueImpact": 0,
      "retentionImpact": 0,
      "satisfactionImpact": 0,
      "adoptionImpact": 100,
      "successMetrics": ["concept_understanding", "vocabulary_mastery"]
    }},
    {{
      "id": "CORE-1",
      "title": "Master the first key principle",
      "description": "Deep dive into the first major concept with examples, analogies, and visual explanations.",
      "estimate": "3h",
      "dependencies": ["FOUNDATION-1"],
      "priority": "P1",
      "reach": 100,
      "impact": 4.5,
      "confidence": 4.0,
      "effort": 3,
      "customerImpactScore": 8.0,
      "revenueImpact": 0,
      "retentionImpact": 0,
      "satisfactionImpact": 0,
      "adoptionImpact": 90,
      "successMetrics": ["principle_application", "problem_solving"]
    }},
    {{
      "id": "PRACTICE-1",
      "title": "Hands-on exercise: Apply the first principle",
      "description": "Work through guided practice problems that reinforce the concept. Start simple and progressively increase difficulty.",
      "estimate": "2h",
      "dependencies": ["CORE-1"],
      "priority": "P1",
      "reach": 100,
      "impact": 5.0,
      "confidence": 4.0,
      "effort": 2,
      "customerImpactScore": 9.5,
      "revenueImpact": 0,
      "retentionImpact": 0,
      "satisfactionImpact": 0,
      "adoptionImpact": 85,
      "successMetrics": ["exercise_completion", "accuracy_rate"]
    }}
  ],
  "notes": "AI-generated learning path - study modules ordered by prerequisite dependencies"
}}

MODULE CATEGORIES TO INCLUDE:
- Foundation / Prerequisites (FOUNDATION-X): Key terminology, history, motivation
- Core Concepts (CORE-X): Main theories, principles, frameworks
- Practice / Exercises (PRACTICE-X): Hands-on problems, coding exercises, worksheets
- Projects / Applications (PROJECT-X): Real-world applications, case studies
- Review / Assessment (REVIEW-X): Self-tests, knowledge checks, synthesis

Generate 8-12 learning modules that build progressively. Make each module:
- Achievable by a student in one sitting
- Clearly building on previous modules
- Including specific learning objectives
- Estimated in hours of study time

CRITICAL: Structure the learning path so that:
- Foundation modules come first with no dependencies
- Each module builds on specific prerequisites
- Practice follows theory
- There's a mix of reading, doing, and testing
- The path ends with synthesis/review modules"""

            system_prompt = system + "\n\nYou are an expert educational curriculum designer and tutor. Create learning plans that are progressive, engaging, and pedagogically sound. Return ONLY valid JSON with no additional text or formatting."
            
            content = _call_claude(full_prompt, system_prompt, max_tokens=4000)
            print(f"DEBUG: Claude response: {content}")
        except Exception as e:
            print(f"DEBUG: Claude error: {e}")
            content = None

    # Fallback to OpenAI if configured
    if content is None and os.getenv("OPENAI_API_KEY") and OpenAI is not None:
        try:
            client = OpenAI()
            resp = client.chat.completions.create(
                model="gpt-4o-mini",
                messages=[{"role": "system", "content": system}, {"role": "user", "content": prompt}],
                response_format={"type": "json_object"},
                temperature=0.2,
            )
            content = resp.choices[0].message.content or ""
        except Exception:
            content = None

    if not content:
        return heuristic_plan(req.goal)

    try:
        data = _try_parse_json(content)
        if data is None:
            raise ValueError("not json")
        goal = str(data.get("goal", req.goal))
        # Map LLM tasks to our Task model safely
        mapped_tasks: List[Task] = []
        for t in data.get("tasks", []):
            mapped_tasks.append(
                Task(
                    id=str(t.get("id")),
                    title=str(t.get("title")),
                    description=str(t.get("description", "")),
                    estimate=t.get("estimate"),
                    dependencies=list(t.get("dependencies", [])),
                    priority=t.get("priority") or "P2",
                    owner=t.get("owner"),
                    reach=float(t.get("reach", 0)) if t.get("reach") else None,
                    impact=float(t.get("impact", 0)) if t.get("impact") else None,
                    confidence=float(t.get("confidence", 0)) if t.get("confidence") else None,
                    effort=float(t.get("effort", 0)) if t.get("effort") else None,
                    customer_impact_score=float(t.get("customerImpactScore", 0)) if t.get("customerImpactScore") else None,
                    revenue_impact=float(t.get("revenueImpact", 0)) if t.get("revenueImpact") else None,
                    retention_impact=float(t.get("retentionImpact", 0)) if t.get("retentionImpact") else None,
                    satisfaction_impact=float(t.get("satisfactionImpact", 0)) if t.get("satisfactionImpact") else None,
                    adoption_impact=float(t.get("adoptionImpact", 0)) if t.get("adoptionImpact") else None,
                    success_metrics=list(t.get("successMetrics", [])) if t.get("successMetrics") else None,
                )
            )
        cp = data.get("criticalPath") or compute_critical_path(mapped_tasks)
        notes = str(data.get("notes", ""))
        
        # Initialize knowledge graph with the new plan
        print(f"[DEBUG] Initializing knowledge graph with {len(mapped_tasks)} tasks")
        initialize_knowledge_graph_from_plan(mapped_tasks)
        save_knowledge_graph(global_knowledge_graph)
        print(f"[DEBUG] Knowledge graph now has {len(global_knowledge_graph.nodes)} nodes and {len(global_knowledge_graph.edges)} edges")
        
        return PlanResponse(goal=goal, tasks=mapped_tasks, critical_path=list(cp), notes=notes)
    except Exception:
        return heuristic_plan(req.goal)


# ── Research Question Refinement ──────────────────────────────────────────────

class RefineQuestionRequest(BaseModel):
    topic: str
    conversation: List[Dict[str, str]] = []  # [{"role":"user"|"ai","text":"..."}]

class RefineQuestionResponse(BaseModel):
    question: Optional[str] = None   # refined research question (when ready)
    follow_up: Optional[str] = None  # Socratic follow-up question (when still refining)
    is_complete: bool = False

@app.post("/refine-question", response_model=RefineQuestionResponse)
def refine_question(req: RefineQuestionRequest) -> RefineQuestionResponse:
    """Socratic dialogue to refine a rough topic into a specific research question."""

    history = ""
    for msg in req.conversation:
        role = "Student" if msg.get("role") == "user" else "Advisor"
        history += f"{role}: {msg.get('text', '')}\n"

    turn_count = len([m for m in req.conversation if m.get("role") == "user"])

    if turn_count >= 3:
        # Enough dialogue — synthesize a refined research question
        prompt = f"""You are a research advisor helping a student refine their topic into a strong research question.

TOPIC: {req.topic}

CONVERSATION SO FAR:
{history}

Based on this dialogue, synthesize ONE specific, focused, and defensible research question for the student.

Rules:
- Return ONLY the research question itself, nothing else
- It should be a single sentence ending with a question mark
- It should be specific enough to be answerable in a research paper
- It should reflect the narrowing that happened in the conversation"""

        system = "You output exactly one research question. No preamble, no explanation."
        try:
            rq = _call_ai_with_fallback(prompt, system, max_tokens=200)
            rq = rq.strip().strip('"').strip("'")
            return RefineQuestionResponse(question=rq, is_complete=True)
        except Exception:
            return RefineQuestionResponse(
                question=f"How does {req.topic} impact society?",
                is_complete=True,
            )
    else:
        # Ask a Socratic follow-up
        prompt = f"""You are a research advisor helping a student narrow a broad topic into a focused research question.

TOPIC: {req.topic}

CONVERSATION SO FAR:
{history}

Ask ONE short, probing Socratic question (1-2 sentences) that helps the student:
- Narrow their scope
- Identify a specific angle, population, or context
- Think about what's debatable or measurable

This is question {turn_count + 1} of 3.
{"Focus on narrowing the scope." if turn_count == 0 else ""}
{"Focus on identifying the specific angle or argument." if turn_count == 1 else ""}
{"Focus on making it researchable and debatable." if turn_count == 2 else ""}

Return ONLY the question. No preamble."""

        system = "You are a Socratic research advisor. Ask one focused question to help narrow a research topic. No preamble."
        try:
            follow_up = _call_ai_with_fallback(prompt, system, max_tokens=200)
            return RefineQuestionResponse(follow_up=follow_up.strip(), is_complete=False)
        except Exception:
            fallback_qs = [
                f"What specific aspect of {req.topic} are you most interested in exploring?",
                "What population, time period, or geographic context would you focus on?",
                "What's the debatable claim you want to investigate?"
            ]
            return RefineQuestionResponse(
                follow_up=fallback_qs[min(turn_count, len(fallback_qs) - 1)],
                is_complete=False,
            )


# ── Research Paper Generation ─────────────────────────────────────────────────

class GeneratePaperRequest(BaseModel):
    topic: str
    style: str = "academic"  # academic, argumentative, literature-review, expository

class GeneratePaperResponse(BaseModel):
    title: str
    content: str  # full paper body in plain text / light markdown


@app.post("/generate-paper", response_model=GeneratePaperResponse)
def generate_paper(req: GeneratePaperRequest) -> GeneratePaperResponse:
    """Generate a paper FORMAT — section headings and short guidance notes only. No written content."""

    style_hints = {
        "academic": "a formal academic research paper (Abstract → Introduction → Literature Review → Methodology → Results → Discussion → Conclusion → References)",
        "argumentative": "an argumentative research paper (Introduction with thesis → Supporting Arguments → Counter-arguments → Rebuttal → Conclusion → References)",
        "literature-review": "a literature review paper (Introduction → Thematic sections surveying existing research → Gap Analysis → Future Directions → References)",
        "expository": "an expository research paper (Introduction → Background / Definitions → Analysis sections → Implications → Conclusion → References)",
    }
    style_desc = style_hints.get(req.style, style_hints["academic"])

    prompt = f"""Create ONLY the section headings for {style_desc} on this topic:

TOPIC: {req.topic}

RULES:
1. First line: a specific, compelling paper title.
2. Then list every section and sub-section heading, one per line.
3. Use indentation (two spaces) for sub-headings under a parent section.
4. Do NOT include any descriptions, instructions, guidance notes, brackets, or body text — ONLY the heading names.
5. Do NOT use asterisks, pound signs, or any markdown formatting.
6. End with a References heading.

Example output:
The Rise of Remote Work: Productivity, Well-Being, and Organizational Culture

Abstract
Introduction
Literature Review
  Remote Work and Productivity
  Employee Well-Being
  Organizational Culture Shifts
Methodology
Results
  Quantitative Findings
  Qualitative Themes
Discussion
Conclusion
References"""

    system_prompt = "You output ONLY section heading names for research papers. No descriptions, no instructions, no formatting symbols. Just clean heading text, one per line."

    try:
        raw = _call_ai_with_fallback(prompt, system_prompt, max_tokens=800)

        # Clean up: strip any markdown/asterisks/brackets the model may have added
        lines = raw.strip().split('\n')
        cleaned_lines: list[str] = []
        title = req.topic
        found_title = False

        for line in lines:
            # Strip markdown formatting
            cleaned = line.replace('**', '').replace('*', '').replace('# ', '').replace('#', '')
            # Remove bracketed instructions like [Write your...]
            cleaned = re.sub(r'\[.*?\]', '', cleaned)
            # Remove leading dashes/bullets
            cleaned = re.sub(r'^[\-•]\s*', '', cleaned)
            cleaned = cleaned.rstrip()

            if not cleaned.strip():
                cleaned_lines.append('')
                continue

            # First non-empty line is the title
            if not found_title:
                title = cleaned.strip()
                found_title = True
                continue

            cleaned_lines.append(cleaned)

        # Build body: add blank lines between top-level headings for readability
        body_lines: list[str] = []
        for line in cleaned_lines:
            stripped = line.strip()
            if stripped and not line.startswith('  '):
                # Top-level heading — add a blank line before it (unless start)
                if body_lines and body_lines[-1] != '':
                    body_lines.append('')
                body_lines.append(stripped)
            elif stripped:
                # Sub-heading (indented)
                body_lines.append('  ' + stripped)
            else:
                if body_lines and body_lines[-1] != '':
                    body_lines.append('')

        body = '\n'.join(body_lines).strip()
        if not body:
            body = raw.strip()

        return GeneratePaperResponse(title=title, content=body)

    except Exception as e:
        fallback_title = f"{req.topic}"
        fallback_body = """Abstract

Introduction

Literature Review

Methodology

Results

Discussion

Conclusion

References"""

        return GeneratePaperResponse(title=fallback_title, content=fallback_body)


class PrioritizeRequest(BaseModel):
    tasks: List[Task]
    method: str = Field("CUSTOMER", pattern=r"^(RICE|ICE|WSJF|CD3|CUSTOMER|BUSINESS)$")


class PrioritizedTask(Task):
    score: float = 0.0


@app.post("/prioritize", response_model=List[PrioritizedTask])
def prioritize(req: PrioritizeRequest) -> List[PrioritizedTask]:
    def ice(t: Task) -> float:
        impact = t.impact or 1.0
        confidence = t.confidence or 0.5
        effort = t.effort or parse_estimate_hours(t.estimate)
        return (impact * confidence) / max(effort, 0.1)

    def rice(t: Task) -> float:
        reach = t.reach or 1.0
        impact = t.impact or 1.0
        confidence = t.confidence or 0.5
        effort = t.effort or parse_estimate_hours(t.estimate)
        return (reach * impact * confidence) / max(effort, 0.1)

    def wsjf(t: Task) -> float:
        cod = (t.business_value or 0.0) + (t.time_criticality or 0.0) + (t.risk_reduction or 0.0)
        job_size = t.effort or parse_estimate_hours(t.estimate)
        return cod / max(job_size, 0.1)

    def cd3(t: Task) -> float:
        cod = (t.business_value or 0.0) + (t.time_criticality or 0.0) + (t.risk_reduction or 0.0)
        duration = t.effort or parse_estimate_hours(t.estimate)
        return cod / max(duration, 0.1)

    def customer_success_score(t: Task) -> float:
        """Customer Success Impact Score - prioritizes based on customer outcomes"""
        # Base customer impact (1-10 scale)
        customer_impact = t.customer_impact_score or 0
        
        # Revenue impact (in thousands, normalized)
        revenue_boost = min((t.revenue_impact or 0) / 10, 10)  # Cap at 10 for $100k+
        
        # Retention impact (percentage improvement)
        retention_boost = (t.retention_impact or 0) * 2  # 5% retention = 10 points
        
        # Satisfaction impact (NPS/CSAT improvement)
        satisfaction_boost = (t.satisfaction_impact or 0) * 1.5  # 10 point NPS = 15 points
        
        # Adoption impact (percentage of users affected)
        adoption_boost = (t.adoption_impact or 0) / 10  # 50% adoption = 5 points
        
        # Success metrics multiplier (more KPIs affected = higher impact)
        metrics_multiplier = 1 + (len(t.success_metrics or []) * 0.2)
        
        # Effort penalty (reduce score for high effort tasks)
        effort_hours = parse_estimate_hours(t.estimate)
        effort_penalty = max(1, effort_hours / 40)  # Penalty starts at 40+ hours
        
        # Calculate weighted score
        total_impact = (customer_impact + revenue_boost + retention_boost + 
                       satisfaction_boost + adoption_boost) * metrics_multiplier
        
        return total_impact / effort_penalty

    def business_value_score(t: Task) -> float:
        """Comprehensive business value scoring combining multiple dimensions"""
        # Customer success weight (50%)
        customer_score = customer_success_score(t) * 0.5
        
        # Traditional RICE weight (30%) 
        rice_score = rice(t) * 0.3
        
        # Strategic value weight (20%)
        strategic_value = (t.business_value or 0) * 0.2
        
        return customer_score + rice_score + strategic_value

    scoring = {"ICE": ice, "RICE": rice, "WSJF": wsjf, "CD3": cd3, "CUSTOMER": customer_success_score, "BUSINESS": business_value_score}[req.method]
    scored = [PrioritizedTask(**t.model_dump(), score=float(scoring(t))) for t in req.tasks]
    scored.sort(key=lambda x: x.score, reverse=True)
    return scored


# ─────────────────────────────────────────
# LEARNING ENDPOINTS
# ─────────────────────────────────────────

class QuizRequest(BaseModel):
    topic: str
    num_questions: int = 5
    difficulty: str = "medium"  # easy, medium, hard


class QuizQuestion(BaseModel):
    question: str
    options: List[str]
    correct_index: int
    explanation: str


class QuizResponse(BaseModel):
    topic: str
    questions: List[QuizQuestion]


@app.post("/generate-quiz", response_model=QuizResponse)
def generate_quiz(req: QuizRequest) -> QuizResponse:
    """Generate a quiz on a given topic using AI."""
    prompt = f"""Generate a quiz with exactly {req.num_questions} multiple-choice questions about: {req.topic}
Difficulty level: {req.difficulty}

Return ONLY a JSON object with this exact structure:
{{
  "topic": "{req.topic}",
  "questions": [
    {{
      "question": "What is...?",
      "options": ["Option A", "Option B", "Option C", "Option D"],
      "correct_index": 0,
      "explanation": "The correct answer is A because..."
    }}
  ]
}}

Make the questions educational and thought-provoking, not just rote memorization.
Include explanations that teach the student WHY the answer is correct.
Each question MUST have exactly 4 options.
correct_index is 0-based (0=first option, 1=second, etc.)."""

    system_prompt = "You are an expert educator creating engaging quiz questions. Return ONLY valid JSON."
    
    try:
        content = _call_ai_with_fallback(prompt, system_prompt, max_tokens=4000)
        data = _try_parse_json(content)
        if data and "questions" in data:
            questions = []
            for q in data["questions"][:req.num_questions]:
                questions.append(QuizQuestion(
                    question=q.get("question", ""),
                    options=q.get("options", ["A", "B", "C", "D"]),
                    correct_index=int(q.get("correct_index", 0)),
                    explanation=q.get("explanation", "")
                ))
            return QuizResponse(topic=req.topic, questions=questions)
    except Exception as e:
        print(f"Quiz generation error: {e}")
    
    # Fallback: return a basic quiz
    return QuizResponse(topic=req.topic, questions=[
        QuizQuestion(
            question=f"What is the most fundamental concept in {req.topic}?",
            options=["Core principles", "Advanced theory", "Historical context", "Practical applications"],
            correct_index=0,
            explanation="Understanding core principles is the foundation for learning any subject."
        )
    ])


class ExplainRequest(BaseModel):
    concept: str
    depth: str = "detailed"  # brief, detailed, expert


class ExplainResponse(BaseModel):
    concept: str
    explanation: str


@app.post("/explain-concept", response_model=ExplainResponse)
def explain_concept(req: ExplainRequest) -> ExplainResponse:
    """Generate a detailed AI explanation of a concept."""
    depth_instructions = {
        "brief": "Give a concise 2-3 paragraph explanation suitable for a quick overview.",
        "detailed": "Give a thorough explanation with examples, analogies, and key takeaways. Use clear sections.",
        "expert": "Give an in-depth expert-level explanation covering theory, edge cases, and advanced connections."
    }
    
    prompt = f"""Explain the following concept/topic: {req.concept}

{depth_instructions.get(req.depth, depth_instructions["detailed"])}

Structure your explanation with:
1. **What it is** - Clear definition in simple terms
2. **Why it matters** - Real-world relevance and applications
3. **How it works** - Step-by-step breakdown with examples
4. **Key takeaways** - The most important things to remember
5. **Common misconceptions** - What students often get wrong

Use analogies to make abstract concepts concrete. Write as if you're an enthusiastic tutor explaining to a curious student."""

    system_prompt = "You are an expert tutor who excels at making complex topics accessible and engaging. Explain concepts clearly with examples and analogies."
    
    try:
        content = _call_ai_with_fallback(prompt, system_prompt, max_tokens=4000)
        return ExplainResponse(concept=req.concept, explanation=content)
    except Exception as e:
        return ExplainResponse(
            concept=req.concept,
            explanation=f"I'd be happy to explain {req.concept}, but I'm having trouble connecting to the AI service right now. Please try again in a moment."
        )


class LearningProgressResponse(BaseModel):
    total_modules: int
    completed_modules: int
    progress_percent: float
    topics_covered: List[str]
    suggested_next: Optional[str] = None


@app.get("/learning-progress", response_model=LearningProgressResponse)
def get_learning_progress() -> LearningProgressResponse:
    """Get current learning progress from the knowledge graph."""
    task_nodes = [n for n in knowledge_graph.nodes.values() if n.type == "task"]
    completed = [n for n in task_nodes if n.properties.get("status") == "completed"]
    
    total = len(task_nodes)
    completed_count = len(completed)
    progress = (completed_count / total * 100) if total > 0 else 0
    
    topics = [n.name for n in completed]
    
    # Find next suggested module (first pending with satisfied dependencies)
    pending = [n for n in task_nodes if n.properties.get("status") != "completed"]
    suggested = pending[0].name if pending else None
    
    return LearningProgressResponse(
        total_modules=total,
        completed_modules=completed_count,
        progress_percent=round(progress, 1),
        topics_covered=topics,
        suggested_next=suggested
    )


class InlineAIRequest(BaseModel):
    action: str
    selected_text: str
    selected_text_2: str = ""  # For "connect" agent — second highlighted block
    document_context: str = ""

class InlineAIResponse(BaseModel):
    action: str
    selected_text: str
    result: str

# ── Specialized Agent Definitions ──────────────────────────────────────────────
# Each agent has a distinct system prompt, user prompt template, and pedagogical
# purpose.  This is NOT "one model doing everything generically" — each agent is
# tuned for a specific cognitive task.

AGENTS = {
    "evidence": {
        "system": (
            "You are a Research Agent embedded in a student's notes. Your job is to "
            "find evidence — supporting AND contradicting — for the claim or idea the "
            "student highlighted. Always cite where the evidence comes from (field, "
            "study, author, year if you can). Be balanced. The student should walk "
            "away knowing what the evidence actually says, not just what supports "
            "their view. You MUST return valid JSON — no markdown, no extra text."
        ),
        "template": """The student highlighted the following text and asked you to FIND EVIDENCE for it.

HIGHLIGHTED TEXT:
\"\"\"{selected_text}\"\"\"

{context}

You MUST return ONLY valid JSON in this exact format (no markdown fences, no extra text):
{{
  "claim": "restate the core claim in one sentence",
  "verdict": "well-supported" | "debated" | "mixed" | "weak" | "unsupported",
  "sources": [
    {{
      "title": "short descriptive title of the finding",
      "finding": "what the evidence says in 1-2 sentences",
      "source": "Author(s), Year — Journal/Book/Field",
      "type": "supporting" | "contradicting" | "complicating",
      "relevance": "high" | "medium" | "low"
    }}
  ],
  "next_steps": ["specific thing to search for 1", "specific thing to search for 2"]
}}

Return 4-6 sources. Be specific with citations. Return ONLY the JSON object.""",
    },

    "challenge": {
        "system": (
            "You are a Devil's Advocate Agent. Your purpose is to make the student's "
            "thinking STRONGER by attacking it. You are not hostile — you are the "
            "intellectual sparring partner every student needs. Find logical gaps, "
            "unstated assumptions, counterexamples, and the strongest objections. "
            "The student should feel intellectually challenged, not criticized."
        ),
        "template": """The student highlighted the following text and asked you to CHALLENGE IT.

HIGHLIGHTED TEXT:
\"\"\"{selected_text}\"\"\"

{context}

Return your response in this exact structure:

**Assumptions you're making:** (list 2-3 unstated assumptions in this text)

**Strongest counterargument:** (the single best objection — make it sharp)

**Logical gaps:** (any reasoning leaps, missing evidence, or weak links)

**What about...** (a concrete counterexample or edge case that complicates this)

**If you're right, then...** (follow the logic to its conclusions — does it still hold up?)""",
    },

    "eli5": {
        "system": (
            "You are a Simplification Agent. Your job is to strip away jargon and "
            "make the idea accessible without losing accuracy. Use analogies from "
            "everyday life. If a 12-year-old couldn't understand your explanation, "
            "try again. But never dumb it down so far that it becomes wrong."
        ),
        "template": """The student highlighted the following text and asked you to EXPLAIN IT SIMPLY.

HIGHLIGHTED TEXT:
\"\"\"{selected_text}\"\"\"

{context}

Return your response in this exact structure:

**In plain English:** (2-3 sentences, no jargon)

**Analogy:** (an everyday analogy that captures the core idea)

**The key thing to remember:** (one sentence — the takeaway)

**Where this gets more complex:** (one sentence hinting at the deeper layer — so the student knows there's more to explore)""",
    },

    "steelman": {
        "system": (
            "You are a Steelman Agent. Your job is to take the student's idea and "
            "make it as strong as possible. Find the best version of their argument. "
            "Add nuance they missed, evidence they could cite, framing that makes it "
            "more compelling. You are their intellectual ally making sure they put "
            "their best thinking forward."
        ),
        "template": """The student highlighted the following text and asked you to STEELMAN IT — make the argument as strong as possible.

HIGHLIGHTED TEXT:
\"\"\"{selected_text}\"\"\"

{context}

Return your response in this exact structure:

**Strongest version of this argument:** (rewrite the core claim with more precision and force)

**Evidence to add:** (2-3 pieces of supporting evidence or data the student should include)

**Better framing:** (how to frame this more compellingly — what angle is most persuasive?)

**Anticipate objections:** (the top objection, and how the steelmanned version handles it)""",
    },

    "socratic": {
        "system": (
            "You are a Socratic Agent. You NEVER give answers. You ONLY ask questions. "
            "Your questions should guide the student to discover insights themselves. "
            "Start with what they said, then probe assumptions, implications, and "
            "connections they haven't made yet. This is the most important agent — "
            "it's the one that makes Synapse a thinking partner, not a homework machine."
        ),
        "template": """The student highlighted the following text. Your job is to ask questions that make them THINK DEEPER — do NOT give answers.

HIGHLIGHTED TEXT:
\"\"\"{selected_text}\"\"\"

{context}

Return ONLY questions. 5 questions, ordered from concrete to abstract:

1. (A clarification question — what exactly do they mean?)
2. (An assumption question — what are they taking for granted?)
3. (An evidence question — how do they know this is true?)
4. (A connection question — how does this relate to something else they should know?)
5. (An implication question — if this is true, what follows? what changes?)""",
    },

    "connect": {
        "system": (
            "You are a Connection Agent. The student highlighted TWO separate pieces "
            "of text and wants you to analyze the relationship between them. Find "
            "hidden connections, tensions, shared assumptions, causal links, or "
            "surprising parallels. This is the agent that only works in a canvas-first "
            "tool — it's your superpower."
        ),
        "template": """The student highlighted TWO separate blocks of text and wants you to analyze the CONNECTION between them.

BLOCK 1:
\"\"\"{selected_text}\"\"\"

BLOCK 2:
\"\"\"{selected_text_2}\"\"\"

{context}

Return your response in this exact structure:

**The connection:** (one sentence — what's the relationship between these two ideas?)

**How they reinforce each other:** (if they're aligned — what does each add to the other?)

**Where they tension:** (if they conflict — what's the disagreement, and why does it matter?)

**The synthesis:** (what new insight emerges when you hold both ideas together?)

**Question to explore:** (one question the student should think about based on this connection)""",
    },
}


@app.post("/inline-ai", response_model=InlineAIResponse)
def inline_ai(req: InlineAIRequest) -> InlineAIResponse:
    """Dispatch to a specialized agent based on the action type."""
    agent = AGENTS.get(req.action)
    if not agent:
        # Fallback for any unknown action
        agent = AGENTS["eli5"]

    context_line = f"Document context (for reference only): {req.document_context[:600]}" if req.document_context else ""
    prompt = agent["template"].format(
        selected_text=req.selected_text,
        selected_text_2=req.selected_text_2 or "(not provided)",
        context=context_line,
    )

    try:
        content = _call_ai_with_fallback(prompt, agent["system"], max_tokens=3000)
        return InlineAIResponse(action=req.action, selected_text=req.selected_text, result=content)
    except Exception as e:
        return InlineAIResponse(
            action=req.action,
            selected_text=req.selected_text,
            result=f"Agent '{req.action}' encountered an error: {str(e)}",
        )


class RefineRequest(BaseModel):
    tasks: List[Task]
    feedback: str


class ExecuteTaskRequest(BaseModel):
    task_id: str
    task_title: str
    task_description: str
    project_context: str = ""
    tech_stack: str = "Python"
    file_path: Optional[str] = None


class ExecuteTaskResponse(BaseModel):
    task_id: str
    status: str
    files_created: List[str]
    code_generated: str
    error: Optional[str] = None

# Knowledge Graph Models
class KnowledgeNode(BaseModel):
    id: str
    type: str  # task, file, concept, dependency, requirement
    name: str
    properties: Dict[str, Any] = {}
    created_at: float
    updated_at: float

class KnowledgeEdge(BaseModel):
    id: str
    source_id: str
    target_id: str
    relationship: str  # depends_on, creates, modifies, implements, relates_to
    properties: Dict[str, Any] = {}
    strength: float = 1.0  # relationship strength 0-1
    created_at: float

class KnowledgeGraph(BaseModel):
    nodes: Dict[str, KnowledgeNode] = {}
    edges: Dict[str, KnowledgeEdge] = {}
    
    def add_node(self, node: KnowledgeNode) -> None:
        self.nodes[node.id] = node
    
    def add_edge(self, edge: KnowledgeEdge) -> None:
        self.edges[edge.id] = edge
    
    def get_connected_nodes(self, node_id: str, relationship: Optional[str] = None) -> List[KnowledgeNode]:
        connected = []
        for edge in self.edges.values():
            if edge.source_id == node_id or edge.target_id == node_id:
                if relationship is None or edge.relationship == relationship:
                    other_id = edge.target_id if edge.source_id == node_id else edge.source_id
                    if other_id in self.nodes:
                        connected.append(self.nodes[other_id])
        return connected
    
    def find_affected_tasks(self, completed_task_id: str) -> List[str]:
        """Find tasks that should be reassigned based on completed task knowledge"""
        affected = []
        
        # Direct dependencies
        for edge in self.edges.values():
            if edge.source_id == completed_task_id and edge.relationship == "blocks":
                affected.append(edge.target_id)
        
        # Semantic relationships
        completed_node = self.nodes.get(completed_task_id)
        if completed_node:
            for node_id, node in self.nodes.items():
                if node.type == "task" and node_id != completed_task_id:
                    # Check for semantic overlap
                    if self._has_semantic_overlap(completed_node, node):
                        affected.append(node_id)
        
        return affected
    
    def _has_semantic_overlap(self, node1: KnowledgeNode, node2: KnowledgeNode) -> bool:
        """Check if two nodes have semantic overlap that would affect assignment"""
        # Simple keyword overlap for now - could be enhanced with NLP
        keywords1 = set(node1.name.lower().split() + 
                        [v for v in node1.properties.get('keywords', []) if isinstance(v, str)])
        keywords2 = set(node2.name.lower().split() + 
                        [v for v in node2.properties.get('keywords', []) if isinstance(v, str)])
        
        overlap = len(keywords1.intersection(keywords2))
        return overlap >= 2  # At least 2 shared keywords

class AgentAssignment(BaseModel):
    agent_id: str
    task_id: str
    assigned_at: float
    status: str  # assigned, in_progress, completed, reassigned
    priority: float = 1.0
    context: Dict[str, Any] = {}

class KnowledgeGraphUpdate(BaseModel):
    task_id: str
    status: str
    files_created: List[str] = []
    knowledge_extracted: Dict[str, Any] = {}
    
class ReassignmentSuggestion(BaseModel):
    task_id: str
    current_agent: Optional[str]
    suggested_agent: str
    reason: str
    confidence: float
    affected_by: List[str]  # Tasks that triggered this reassignment

# Initialize global knowledge graph after class definitions
# (moved to end of file)


@app.post("/refine", response_model=List[Task])
def refine(req: RefineRequest) -> List[Task]:
    # Simple local refinement: push tasks without owner or estimate to the top and mark as P1
    refined: List[Task] = []
    for t in req.tasks:
        if not t.owner or not t.estimate:
            t.priority = "P1"
        refined.append(t)
    return refined


@app.post("/execute-task", response_model=ExecuteTaskResponse)
def execute_task(req: ExecuteTaskRequest) -> ExecuteTaskResponse:
    """Execute a task by generating code with AI and writing it to the codebase."""
    try:
        # Generate code using Claude
        anthropic_key = os.getenv("ANTHROPIC_API_KEY")
        if not anthropic_key or Anthropic is None:
            return ExecuteTaskResponse(
                task_id=req.task_id,
                status="error",
                files_created=[],
                code_generated="",
                error="Claude API not available"
            )
        
        # Determine task type and generate appropriate deliverable
        task_type = req.task_id.split('-')[0] if '-' in req.task_id else 'CODE'
        
        if task_type == 'API':
            deliverable_type = "REST API endpoints with FastAPI/Flask"
        elif task_type == 'DB':
            deliverable_type = "Database schema with SQLAlchemy models"
        elif task_type == 'FE':
            deliverable_type = "React component with TypeScript"
        elif task_type == 'TEST':
            deliverable_type = "Test suite with pytest/jest"
        elif task_type == 'DEPLOY':
            deliverable_type = "Docker/deployment configuration"
        elif task_type == 'DOC':
            deliverable_type = "Technical documentation in Markdown"
        else:
            deliverable_type = "Production-ready code"

        # Create a detailed prompt for technical deliverable generation
        prompt = f"""BUSINESS-TO-TECHNICAL IMPLEMENTATION:

Task: {req.task_title}
Description: {req.task_description}
Type: {deliverable_type}
Tech Stack: {req.tech_stack}
Business Context: {req.project_context}

Generate a complete, production-ready technical deliverable for this business requirement.

REQUIREMENTS:
1. Business-focused: Address the user need directly
2. Production-ready: Include proper error handling, validation, logging
3. Well-documented: Clear comments explaining business logic
4. Scalable: Consider performance and maintainability
5. Testable: Structure for easy unit/integration testing

Based on the task type ({task_type}), generate:
- API tasks: REST endpoints with request/response schemas, authentication, validation
- DB tasks: Database models with relationships, indexes, migrations
- FE tasks: React components with props, state management, accessibility
- TEST tasks: Comprehensive test suites with business scenario coverage
- DEPLOY tasks: Infrastructure as code, CI/CD pipelines
- DOC tasks: Technical specifications, API docs, deployment guides

Respond with a JSON object:
{{
  "file_path": "suggested/appropriate/path",
  "code": "# Complete implementation here\\n...",
  "explanation": "How this delivers business value and technical implementation details"
}}"""
        
        # Use Claude for code generation
        system_prompt = "You are an expert software engineer. Generate production-ready code that follows best practices. Return ONLY valid JSON with no additional text."
        response_text = _call_claude(prompt, system_prompt, max_tokens=4000)
        
        # Parse the response
        result = json.loads(response_text)
        suggested_path = result.get("file_path", f"generated/{req.task_id}.py")
        code = result.get("code", "# No code generated")
        
        # Use provided path or suggestion
        final_path = req.file_path if req.file_path else suggested_path
        
        # Create directory if it doesn't exist
        os.makedirs(os.path.dirname(final_path), exist_ok=True)
        
        # Write the code to file
        with open(final_path, 'w') as f:
            f.write(code)
        
        # Update knowledge graph and get reassignment suggestions
        execution_result = {
            'files_created': [final_path],
            'code_generated': code,
            'status': 'success'
        }
        reassignment_suggestions = update_knowledge_graph_on_completion(req.task_id, execution_result)
        save_knowledge_graph(global_knowledge_graph)
        
        # Log reassignment suggestions (could be sent via WebSocket in real implementation)
        if reassignment_suggestions:
            print(f"🔄 Knowledge Graph Update: {len(reassignment_suggestions)} reassignment suggestions generated")
            for suggestion in reassignment_suggestions:
                print(f"   → Task {suggestion.task_id}: {suggestion.reason} (confidence: {suggestion.confidence:.2f})")
        
        return ExecuteTaskResponse(
            task_id=req.task_id,
            status="success",
            files_created=[final_path],
            code_generated=code,
            error=None
        )
        
    except Exception as e:
        return ExecuteTaskResponse(
            task_id=req.task_id,
            status="error",
            files_created=[],
            code_generated="",
            error=str(e)
        )


# ---------- Code-Native Documentation: sandboxed execution ----------
class SandboxRequest(BaseModel):
    code: str
    timeout_ms: int = 2000


class SandboxResult(BaseModel):
    stdout: str
    result: Optional[str] = None
    error: Optional[str] = None


def _sandbox_worker(code: str, queue: Queue) -> None:  # run in separate process
    stdout_buf = io.StringIO()
    local_ns: Dict[str, Any] = {}
    try:
        with contextlib.redirect_stdout(stdout_buf):
            exec(code, {"__builtins__": {"print": print, "range": range}}, local_ns)
        result = local_ns.get("result")
        queue.put({"stdout": stdout_buf.getvalue(), "result": repr(result)})
    except Exception as e:  # pragma: no cover (best-effort)
        queue.put({"stdout": stdout_buf.getvalue(), "error": str(e)})


@app.post("/sandbox/execute", response_model=SandboxResult)
def sandbox_execute(req: SandboxRequest) -> SandboxResult:
    queue: Queue = Queue()
    proc = Process(target=_sandbox_worker, args=(req.code, queue))
    proc.start()
    proc.join(timeout=req.timeout_ms / 1000.0)
    if proc.is_alive():
        proc.terminate()
        return SandboxResult(stdout="", error="Timeout exceeded")
    data = queue.get() if not queue.empty() else {"stdout": "", "error": "No output"}
    return SandboxResult(**data)


# ---------- Intelligent Technical Specs: RFC Draft ----------
class RfcRequest(BaseModel):
    context: str = ""


class RfcResponse(BaseModel):
    draft: str


@app.post("/rfc/draft", response_model=RfcResponse)
def rfc_draft(req: RfcRequest) -> RfcResponse:
    anthropic_key = os.getenv("ANTHROPIC_API_KEY")
    if anthropic_key and Anthropic is not None:
        try:
            prompt = (
                "Write a concise RFC draft with sections: Context, Problem, Goals, Non-goals, Proposed Approach, Impact, Risks, Observability, Open Questions.\n"
                f"Context: {req.context}"
            )
            system_prompt = "You are a technical architect writing RFC documentation. Create clear, structured technical documents."
            text = _call_claude(prompt, system_prompt, max_tokens=3000)
            return RfcResponse(draft=text)
        except Exception:
            pass
    # fallback
    base = (
        "# RFC Draft\n\n## Context\n"
        f"{req.context or 'N/A'}\n\n## Problem\nDescribe the problem.\n\n## Goals\n- Goal 1\n\n## Non-goals\n- Out of scope\n\n"
        "## Proposed Approach\nOutline design and tradeoffs.\n\n## Impact\nRisks, migration, and observability.\n\n## Open Questions\n- TBD\n"
    )
    return RfcResponse(draft=base)


# ---------- Dependency Graph & Hotspots ----------
class PathRequest(BaseModel):
    path: Optional[str] = None


class GraphResponse(BaseModel):
    nodes: List[str]
    edges: List[Tuple[str, str]]


def _discover_py_files(root: Path) -> List[Path]:
    out: List[Path] = []
    for dirpath, _dirnames, filenames in os.walk(root):
        for fn in filenames:
            if fn.endswith(".py"):
                out.append(Path(dirpath) / fn)
    return out


@app.post("/graph/dependencies", response_model=GraphResponse)
def graph_dependencies(req: PathRequest) -> GraphResponse:
    root = Path(req.path or Path.cwd())
    files = _discover_py_files(root)
    nodes: List[str] = []
    edges: List[Tuple[str, str]] = []
    module_of: Dict[Path, str] = {f: f.relative_to(root).as_posix() for f in files}
    for f in files:
        nodes.append(module_of[f])
        try:
            src = f.read_text(encoding="utf-8", errors="ignore")
            tree = ast.parse(src)
            for n in ast.walk(tree):
                if isinstance(n, ast.Import):
                    for alias in n.names:
                        edges.append((module_of[f], alias.name))
                elif isinstance(n, ast.ImportFrom):
                    mod = n.module or ""
                    edges.append((module_of[f], mod))
        except Exception:
            continue
    return GraphResponse(nodes=nodes, edges=edges)


class Hotspot(BaseModel):
    file: str
    lines: int
    churn: int
    score: float


@app.post("/hotspots", response_model=List[Hotspot])
def hotspots(req: PathRequest) -> List[Hotspot]:
    root = Path(req.path or Path.cwd())
    files = _discover_py_files(root)
    churn_map: Dict[str, int] = {}
    # Try git churn (best-effort)
    try:
        out = subprocess.check_output(
            ["git", "log", "--pretty=format:", "--name-only", "-n", "100"],
            cwd=root,
            stderr=subprocess.DEVNULL,
        ).decode()
        for line in out.splitlines():
            if line.endswith(".py"):
                churn_map[line] = churn_map.get(line, 0) + 1
    except Exception:
        pass
    results: List[Hotspot] = []
    for f in files:
        try:
            rel = f.relative_to(root).as_posix()
            lines = sum(1 for _ in f.open("r", encoding="utf-8", errors="ignore"))
            churn = churn_map.get(rel, 0)
            score = float(lines) * (1.0 + 0.5 * churn)
            results.append(Hotspot(file=rel, lines=lines, churn=churn, score=score))
        except Exception:
            continue
    results.sort(key=lambda h: h.score, reverse=True)
    return results[:20]


# ---------- Runbook (safe, simulated actions) ----------
class RunbookStep(BaseModel):
    action: str
    args: Dict[str, Any] = Field(default_factory=dict)


class RunbookResult(BaseModel):
    events: List[Dict[str, Any]]


@app.post("/runbook/execute", response_model=RunbookResult)
def runbook_execute(steps: List[RunbookStep]) -> RunbookResult:
    events: List[Dict[str, Any]] = []
    import httpx

    def log(event: Dict[str, Any]) -> None:
        event["ts"] = time.time()
        events.append(event)

    for step in steps:
        action = step.action
        if action == "echo":
            log({"action": action, "ok": True, "message": step.args.get("text", "")})
        elif action == "sleep":
            secs = min(float(step.args.get("seconds", 0)), 5.0)
            time.sleep(secs)
            log({"action": action, "ok": True, "seconds": secs})
        elif action == "http_get":
            url = str(step.args.get("url", ""))
            try:
                resp = httpx.get(url, timeout=5.0)
                log({"action": action, "ok": resp.status_code < 500, "status": resp.status_code, "url": url})
            except Exception as e:
                log({"action": action, "ok": False, "error": str(e), "url": url})
        else:
            log({"action": action, "ok": False, "error": "Unsupported action"})
    return RunbookResult(events=events)


# Knowledge Graph Endpoints

@app.get("/knowledge-graph/status")
def get_knowledge_graph_status():
    """Get current knowledge graph statistics"""
    node_count = len(global_knowledge_graph.nodes)
    edge_count = len(global_knowledge_graph.edges)
    print(f"[DEBUG] Knowledge graph status: {node_count} nodes, {edge_count} edges")
    
    return {
        "nodes": node_count,
        "edges": edge_count,
        "task_nodes": len([n for n in global_knowledge_graph.nodes.values() if n.type == "task"]),
        "file_nodes": len([n for n in global_knowledge_graph.nodes.values() if n.type == "file"]),
        "active_agents": len(active_agents),
        "assignments": len(agent_assignments)
    }

@app.get("/knowledge-graph/graph")
def get_knowledge_graph():
    """Get the full knowledge graph for visualization"""
    # Convert to a format suitable for frontend visualization
    graph_data = {
        "nodes": [
            {
                "id": node.id,
                "type": node.type,
                "name": node.name,
                "properties": node.properties,
                "created_at": node.created_at,
                "updated_at": node.updated_at
            }
            for node in global_knowledge_graph.nodes.values()
        ],
        "edges": [
            {
                "id": edge.id,
                "source": edge.source_id,
                "target": edge.target_id,
                "relationship": edge.relationship,
                "strength": edge.strength,
                "properties": edge.properties
            }
            for edge in global_knowledge_graph.edges.values()
        ]
    }
    return graph_data

@app.post("/knowledge-graph/assign-agent")
def assign_agent_to_task(request: Dict[str, str]):
    """Manually assign an agent to a task"""
    task_id = request.get("task_id")
    agent_id = request.get("agent_id", generate_agent_id())
    
    if task_id not in global_knowledge_graph.nodes:
        raise HTTPException(status_code=404, detail="Task not found in knowledge graph")
    
    # Create assignment
    assignment = AgentAssignment(
        agent_id=agent_id,
        task_id=task_id,
        assigned_at=time.time(),
        status="assigned"
    )
    
    assignment_id = f"{agent_id}_{task_id}"
    agent_assignments[assignment_id] = assignment
    active_agents.add(agent_id)
    
    return {
        "assignment_id": assignment_id,
        "agent_id": agent_id,
        "task_id": task_id,
        "status": "assigned"
    }

@app.get("/knowledge-graph/reassignment-suggestions")
def get_reassignment_suggestions():
    """Get current reassignment suggestions based on knowledge graph"""
    suggestions = []
    
    # Find completed tasks and generate suggestions for pending tasks
    completed_tasks = [
        node_id for node_id, node in global_knowledge_graph.nodes.items()
        if node.type == "task" and node.properties.get("status") == "completed"
    ]
    
    for completed_task_id in completed_tasks:
        affected_task_ids = global_knowledge_graph.find_affected_tasks(completed_task_id)
        for affected_id in affected_task_ids:
            suggestion = analyze_reassignment_need(affected_id, completed_task_id)
            if suggestion:
                suggestions.append(suggestion.dict())
    
    return {"suggestions": suggestions}

@app.post("/knowledge-graph/update-task-status")
def update_task_status(request: Dict[str, str]):
    """Update task status in knowledge graph"""
    task_id = request.get("task_id")
    status = request.get("status")
    
    if task_id not in global_knowledge_graph.nodes:
        raise HTTPException(status_code=404, detail="Task not found")
    
    node = global_knowledge_graph.nodes[task_id]
    node.properties["status"] = status
    node.updated_at = time.time()
    
    # If task is completed, trigger reassignment analysis
    suggestions = []
    if status == "completed":
        suggestions = update_knowledge_graph_on_completion(task_id, {"status": status})
    
    return {
        "task_id": task_id,
        "status": status,
        "reassignment_suggestions": [s.dict() for s in suggestions]
    }

# Living Technical Specification Endpoints

@app.get("/specs/living")
def get_living_technical_spec():
    """Generate and return the current living technical specification"""
    spec = generate_living_spec_from_knowledge_graph()
    return spec

@app.get("/specs/analyze-file/{file_id}")
def analyze_file_from_knowledge_graph(file_id: str):
    """Analyze a specific file from the knowledge graph"""
    if file_id not in global_knowledge_graph.nodes:
        raise HTTPException(status_code=404, detail="File not found in knowledge graph")
    
    node = global_knowledge_graph.nodes[file_id]
    if node.type != 'file':
        raise HTTPException(status_code=400, detail="Node is not a file")
    
    file_path = node.properties.get('path', '')
    if not file_path or not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="File not found on filesystem")
    
    analysis = analyze_code_file(file_path)
    return {
        "file_id": file_id,
        "file_path": file_path,
        "analysis": analysis,
        "node_properties": node.properties
    }

@app.post("/specs/refresh")
def refresh_living_spec():
    """Trigger a refresh of the living technical specification"""
    # Re-analyze all files and update knowledge graph
    updated_files = []
    
    for node_id, node in global_knowledge_graph.nodes.items():
        if node.type == 'file':
            file_path = node.properties.get('path', '')
            if file_path and os.path.exists(file_path):
                analysis = analyze_code_file(file_path)
                
                # Update node properties with analysis
                node.properties.update({
                    'analysis': analysis,
                    'last_analyzed': time.time()
                })
                updated_files.append(file_path)
    
    # Generate fresh spec
    spec = generate_living_spec_from_knowledge_graph()
    
    return {
        "message": "Living specification refreshed",
        "files_analyzed": len(updated_files),
        "updated_files": updated_files,
        "spec_overview": spec['overview']
    }

@app.get("/specs/architectural-decisions")
def get_architectural_decisions():
    """Get all architectural decisions detected from the codebase"""
    decisions = []
    
    for node_id, node in global_knowledge_graph.nodes.items():
        if node.type == 'file':
            file_path = node.properties.get('path', '')
            if file_path and os.path.exists(file_path):
                analysis = analyze_code_file(file_path)
                for decision in analysis.get('architectural_decisions', []):
                    decisions.append({
                        **decision,
                        'detected_in_file': file_path,
                        'created_by_task': node.properties.get('created_by_task'),
                        'detection_confidence': 0.8  # Could be enhanced with ML
                    })
    
    return {
        "total_decisions": len(decisions),
        "decisions": decisions
    }

@app.get("/specs/technology-stack")
def get_technology_stack():
    """Get the detected technology stack from all files"""
    technologies = {}
    
    for node_id, node in global_knowledge_graph.nodes.items():
        if node.type == 'file':
            file_path = node.properties.get('path', '')
            if file_path and os.path.exists(file_path):
                analysis = analyze_code_file(file_path)
                for tech in analysis.get('technologies', []):
                    if tech not in technologies:
                        technologies[tech] = {
                            'name': tech,
                            'files': [],
                            'usage_count': 0
                        }
                    technologies[tech]['files'].append(file_path)
                    technologies[tech]['usage_count'] += 1
    
    return {
        "technology_count": len(technologies),
        "technologies": list(technologies.values())
    }

class DesignDocAnalysisRequest(BaseModel):
    content: str
    title: str = ""
    context: str = ""

class DesignDocAnalysisResponse(BaseModel):
    architecture_suggestions: List[str]
    subtasks: List[Dict[str, Any]]
    technical_gaps: List[str]
    implementation_recommendations: List[str]
    next_steps: List[str]

class AcceptSuggestionRequest(BaseModel):
    current_content: str
    title: str = ""
    accepted_suggestion: Dict[str, Any]
    suggestion_type: str  # 'architecture', 'subtask', 'gap', 'recommendation', 'next_step'

class AcceptSuggestionResponse(BaseModel):
    improved_content: str
    changes_made: List[str]
    explanation: str

class TaskMention(BaseModel):
    id: str
    assignee: str
    task: str
    line_number: int
    start_index: int
    end_index: int
    linear_url: str

class DetectMentionsRequest(BaseModel):
    content: str
    title: str = ""
    team_id: str = ""
    default_priority: str = "medium"
    default_labels: List[str] = []

class DetectMentionsResponse(BaseModel):
    mentions: List[TaskMention]
    summary: str
    assignee_groups: Dict[str, List[TaskMention]]

@app.post("/analyze-design-doc", response_model=DesignDocAnalysisResponse)
def analyze_design_doc(req: DesignDocAnalysisRequest) -> DesignDocAnalysisResponse:
    """Analyze design document content to identify architecture and suggest subtasks"""
    # Check if any AI service is available
    has_ai = (os.getenv("GOOGLE_API_KEY") and genai is not None) or (os.getenv("ANTHROPIC_API_KEY") and Anthropic is not None)
    if not has_ai:
        raise HTTPException(status_code=503, detail="No AI services available")
    
    try:
        prompt = f"""
DESIGN DOCUMENT ANALYSIS TASK

Document Title: {req.title}
Additional Context: {req.context}

Document Content:
{req.content}

Your mission: Analyze this design document to identify technical architecture needs and break down implementation into specific subtasks.

ANALYSIS FRAMEWORK:
1. **Architecture Assessment**: What technical systems, patterns, and infrastructure are implied?
2. **Gap Identification**: What technical details are missing or need clarification?
3. **Task Decomposition**: Break down the design into executable development tasks
4. **Implementation Strategy**: Suggest specific approaches and technologies

Return a JSON object with this structure:
{{
  "architecture_suggestions": [
    "Microservices architecture with API Gateway for scalability",
    "Event-driven architecture using message queues for async processing",
    "Database sharding strategy for user data partitioning"
  ],
  "subtasks": [
    {{
      "id": "ARCH-1",
      "title": "Design API Gateway and routing strategy",
      "description": "Define API endpoints, authentication, rate limiting, and service discovery",
      "category": "Architecture",
      "priority": "P1",
      "estimated_effort": "3-5 days",
      "dependencies": [],
      "technical_requirements": ["API design", "Authentication system", "Load balancing"]
    }},
    {{
      "id": "DB-1", 
      "title": "Design database schema and data models",
      "description": "Create entity relationships, indexing strategy, and migration plan",
      "category": "Database",
      "priority": "P1",
      "estimated_effort": "2-3 days",
      "dependencies": ["ARCH-1"],
      "technical_requirements": ["Data modeling", "Performance optimization", "Backup strategy"]
    }}
  ],
  "technical_gaps": [
    "Authentication and authorization strategy not specified",
    "Data backup and disaster recovery plan missing",
    "Performance requirements and SLA targets undefined"
  ],
  "implementation_recommendations": [
    "Start with MVP API endpoints to validate core functionality",
    "Implement comprehensive logging and monitoring from day 1",
    "Use infrastructure as code for reproducible deployments"
  ],
  "next_steps": [
    "Define detailed API specifications and data contracts",
    "Create technical proof-of-concept for core architecture",
    "Establish development and deployment pipeline"
  ]
}}

TASK CATEGORIES TO CONSIDER:
- Architecture & System Design (ARCH-X)
- Database Design & Modeling (DB-X)
- API Development (API-X)
- Frontend Components (FE-X)
- Authentication & Security (AUTH-X)
- DevOps & Infrastructure (INFRA-X)
- Testing & Quality Assurance (TEST-X)
- Documentation (DOC-X)
- Integration & Data Flow (INT-X)
- Performance & Monitoring (PERF-X)

FOCUS ON:
- Extracting implied technical requirements from business language
- Identifying missing technical specifications that need clarification
- Breaking down complex features into specific, actionable development tasks
- Suggesting modern, scalable technical approaches
- Prioritizing tasks based on dependencies and risk
"""

        system_prompt = """You are a senior technical architect and product manager with expertise in:
- Software architecture and system design
- Breaking down product requirements into technical tasks
- Identifying technical gaps and risks in product specifications
- Modern web development, cloud infrastructure, and DevOps practices

Analyze the design document with a focus on technical implementation. Be specific and actionable in your recommendations."""

        response_text = _call_ai_with_fallback(prompt, system_prompt, max_tokens=4000)
        
        # Parse the response
        result = _try_parse_json(response_text)
        if result is None:
            raise ValueError("Could not parse JSON from response")
        
        return DesignDocAnalysisResponse(
            architecture_suggestions=result.get("architecture_suggestions", []),
            subtasks=result.get("subtasks", []),
            technical_gaps=result.get("technical_gaps", []),
            implementation_recommendations=result.get("implementation_recommendations", []),
            next_steps=result.get("next_steps", [])
        )
        
    except json.JSONDecodeError as e:
        raise HTTPException(status_code=500, detail=f"Failed to parse AI response: {str(e)}. Response was: {response_text[:500]}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Analysis failed: {str(e)}")

@app.post("/accept-suggestion", response_model=AcceptSuggestionResponse)
def accept_suggestion(req: AcceptSuggestionRequest) -> AcceptSuggestionResponse:
    """Accept a suggestion and improve the document content with AI (Gemini/Claude fallback)"""
    # Check if any AI service is available
    has_ai = (os.getenv("GOOGLE_API_KEY") and genai is not None) or (os.getenv("ANTHROPIC_API_KEY") and Anthropic is not None)
    if not has_ai:
        raise HTTPException(status_code=503, detail="No AI services available")
    
    try:
        # Extract suggestion details
        suggestion_title = req.accepted_suggestion.get('title', '')
        suggestion_content = req.accepted_suggestion.get('content', '')
        suggestion_type = req.suggestion_type
        
        prompt = f"""
DOCUMENT IMPROVEMENT TASK

Document Title: {req.title}
Current Document Content:
{req.current_content}

Accepted Suggestion:
Type: {suggestion_type}
Title: {suggestion_title}
Content: {suggestion_content}

Your mission: Enhance the "{req.title}" document by incorporating the accepted suggestion. Use the document title as context to understand the project's scope and purpose. Rewrite or expand the document to address the suggestion while maintaining natural flow and readability.

IMPROVEMENT GUIDELINES:
1. **Context Awareness**: Reference the document title ("{req.title}") to understand the project context and tailor improvements accordingly
2. **Natural Language**: Write in complete, well-structured sentences that flow naturally together
3. **Professional Tone**: Maintain a professional technical writing style with clear, concise explanations
4. **Logical Organization**: Structure content in logical sections with smooth transitions between ideas
5. **Actionable Details**: Include specific, measurable requirements and clear implementation guidance

WRITING STYLE REQUIREMENTS:
- Use complete sentences and paragraphs for explanations and descriptions
- Only use bullet points or short lists for technical specifications, requirements lists, or feature enumerations
- Write naturally flowing text that reads like professional technical documentation
- Ensure each section has proper introductory sentences before any lists
- Connect ideas with transitional phrases and logical flow

CONTENT ENHANCEMENT BASED ON SUGGESTION TYPE:
- **Architecture**: Describe the technical architecture in complete sentences, explaining how components interact and why specific design decisions were made for the {req.title} project
- **Subtask**: Break down the feature into specific implementation phases, explaining the rationale and dependencies in narrative form
- **Gap**: Identify and address missing technical considerations, explaining their importance to the {req.title} project's success
- **Recommendation**: Incorporate industry best practices with explanations of why they're relevant to this specific project
- **Next Step**: Outline concrete action items with context about their priority and impact on the {req.title} development

Return a JSON object with this structure:
{{
  "improved_content": "The enhanced version of the document with natural, flowing prose and the suggestion incorporated",
  "changes_made": [
    "Enhanced authentication section with detailed explanations",
    "Added comprehensive security requirements with rationale",
    "Included implementation timeline with dependencies"
  ],
  "explanation": "Brief explanation of how the suggestion was incorporated and what improvements were made"
}}

REQUIREMENTS:
- Write the improved_content using natural, flowing prose with complete sentences
- Reference the document title ("{req.title}") for context throughout the enhancement
- Use bullet points only for technical specifications, feature lists, or requirement enumerations
- Include specific technical details with explanatory context
- Make the document comprehensive and actionable for development teams
- Maintain professional technical documentation standards
- DO NOT include any code examples, code snippets, or implementation code
- Focus on requirements, architecture, and specifications with proper explanations
"""

        system_prompt = """You are a senior technical writer and software architect specializing in creating comprehensive, naturally-flowing technical documentation. Your role is to enhance documents by incorporating suggestions while maintaining excellent readability and professional prose.

WRITING STYLE FOCUS:
- Write in complete, well-structured sentences that flow naturally
- Use narrative explanations to provide context and rationale
- Only use bullet points for technical specifications, feature lists, or requirement enumerations
- Connect ideas with smooth transitions and logical progression
- Reference the document title throughout to maintain project context
- Explain the "why" behind technical decisions, not just the "what"

CONTENT ENHANCEMENT PRIORITIES:
- Transform brief concepts into comprehensive explanations with proper context
- Add concrete technical specifications with explanatory background
- Include implementation details and best practices (but NO CODE)
- Make vague requirements specific and measurable through detailed descriptions
- Ensure the document provides clear guidance for development teams
- Incorporate architecture descriptions, system design rationale, and technical requirements
- Address performance specifications, deployment considerations, and operational requirements

CRITICAL CONSTRAINTS:
- Do NOT generate any code examples, code snippets, or implementation code
- Focus exclusively on documentation, requirements, and specifications
- Maintain professional technical documentation standards with natural prose
- Use the document title as a key reference point for contextual relevance

Return ONLY valid JSON with no additional text."""

        response_text = _call_ai_with_fallback(prompt, system_prompt, max_tokens=2000)
        
        # Parse the response
        result = _try_parse_json(response_text)
        if result is None:
            raise ValueError("Could not parse JSON from response")
        
        return AcceptSuggestionResponse(
            improved_content=result.get("improved_content", req.current_content),
            changes_made=result.get("changes_made", []),
            explanation=result.get("explanation", "Document improved based on accepted suggestion")
        )
        
    except json.JSONDecodeError as e:
        raise HTTPException(status_code=500, detail=f"Failed to parse AI response: {str(e)}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Document improvement failed: {str(e)}")

@app.post("/detect-mentions", response_model=DetectMentionsResponse)
def detect_mentions(req: DetectMentionsRequest) -> DetectMentionsResponse:
    """Detect @username task mentions in document content and generate Linear URLs"""
    import re
    from urllib.parse import urlencode
    
    try:
        mentions = []
        lines = req.content.split('\n')
        
        # Regex to match @username followed by task description
        mention_pattern = r'@([a-zA-Z0-9_-]+)\s+(.+)'
        
        for line_index, line in enumerate(lines):
            matches = re.finditer(mention_pattern, line)
            for match in matches:
                assignee = match.group(1)
                task = match.group(2).strip()
                
                if task:
                    # Generate Linear URL
                    base_url = f"https://linear.app/team/{req.team_id}/new" if req.team_id else "https://linear.new"
                    
                    params = {
                        'title': task,
                        'assignee': assignee,
                        'description': f"Task delegated from: {req.title or 'Design Document'}\n\nContext: This task was identified while working on {req.title}" if req.title else "Task delegated from design document",
                        'priority': req.default_priority
                    }
                    
                    if req.default_labels:
                        params['labels'] = ','.join(req.default_labels)
                    
                    linear_url = f"{base_url}?{urlencode(params)}"
                    
                    mention = TaskMention(
                        id=f"mention-{line_index}-{match.start()}",
                        assignee=assignee,
                        task=task,
                        line_number=line_index + 1,
                        start_index=match.start(),
                        end_index=match.end(),
                        linear_url=linear_url
                    )
                    mentions.append(mention)
        
        # Generate summary
        if not mentions:
            summary = "No task assignments detected"
        else:
            assignee_count = len(set(m.assignee for m in mentions))
            summary = f"{len(mentions)} task{'s' if len(mentions) > 1 else ''} assigned to {assignee_count} person{'s' if assignee_count > 1 else ''}"
        
        # Group by assignee
        assignee_groups = {}
        for mention in mentions:
            if mention.assignee not in assignee_groups:
                assignee_groups[mention.assignee] = []
            assignee_groups[mention.assignee].append(mention)
        
        return DetectMentionsResponse(
            mentions=mentions,
            summary=summary,
            assignee_groups=assignee_groups
        )
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Mention detection failed: {str(e)}")

# Agent Delegation Models
class AgentDelegationRequest(BaseModel):
    task_description: str
    selected_text: str
    document_context: str

class AgentDelegationResponse(BaseModel):
    task_id: str
    branch_name: str
    analysis: str
    commit_message: str
    pr_title: str
    pr_description: str
    file_changes: List[Dict[str, Any]]
    status: str
    error: Optional[str] = None

class CommitChangesRequest(BaseModel):
    task_id: str
    branch_name: str
    file_changes: List[Dict[str, Any]]
    commit_message: str

class CommitChangesResponse(BaseModel):
    task_id: str
    branch_name: str
    committed_files: List[Dict[str, Any]]
    status: str
    repository_url: str
    error: Optional[str] = None

class CreatePRRequest(BaseModel):
    branch_name: str
    pr_title: str
    pr_description: str

class CreatePRResponse(BaseModel):
    pr_number: int
    pr_url: str
    status: str
    error: Optional[str] = None

# Agent delegation endpoints
@app.post("/delegate-to-agent", response_model=AgentDelegationResponse)
def delegate_to_agent(req: AgentDelegationRequest) -> AgentDelegationResponse:
    """Delegate selected text to coding agent for implementation"""
    try:
        # Import here to avoid circular imports
        from .agent_service import AgentService
        
        agent_service = AgentService()
        result = agent_service.create_code_changes(
            task_description=req.task_description,
            selected_text=req.selected_text,
            document_context=req.document_context
        )
        
        if result.get('error'):
            return AgentDelegationResponse(
                task_id="",
                branch_name="",
                analysis="",
                commit_message="",
                pr_title="",
                pr_description="",
                file_changes=[],
                status="error",
                error=result['error']
            )
        
        return AgentDelegationResponse(
            task_id=result['task_id'],
            branch_name=result['branch_name'],
            analysis=result['analysis'],
            commit_message=result['commit_message'],
            pr_title=result['pr_title'],
            pr_description=result['pr_description'],
            file_changes=result['file_changes'],
            status=result['status']
        )
        
    except Exception as e:
        return AgentDelegationResponse(
            task_id="",
            branch_name="",
            analysis="",
            commit_message="",
            pr_title="",
            pr_description="",
            file_changes=[],
            status="error",
            error=str(e)
        )

@app.post("/commit-changes", response_model=CommitChangesResponse)
def commit_changes(req: CommitChangesRequest) -> CommitChangesResponse:
    """Commit and push the approved changes"""
    try:
        from .agent_service import AgentService
        
        agent_service = AgentService()
        result = agent_service.commit_and_push_changes(
            task_id=req.task_id,
            branch_name=req.branch_name,
            file_changes=req.file_changes,
            commit_message=req.commit_message
        )
        
        if result.get('error'):
            return CommitChangesResponse(
                task_id=req.task_id,
                branch_name=req.branch_name,
                committed_files=[],
                status="error",
                repository_url="",
                error=result['error']
            )
        
        return CommitChangesResponse(
            task_id=result['task_id'],
            branch_name=result['branch_name'],
            committed_files=result['committed_files'],
            status=result['status'],
            repository_url=result['repository_url']
        )
        
    except Exception as e:
        return CommitChangesResponse(
            task_id=req.task_id,
            branch_name=req.branch_name,
            committed_files=[],
            status="error",
            repository_url="",
            error=str(e)
        )

@app.post("/create-pr", response_model=CreatePRResponse)
def create_pr(req: CreatePRRequest) -> CreatePRResponse:
    """Create a pull request for the changes"""
    try:
        from .agent_service import AgentService
        
        agent_service = AgentService()
        result = agent_service.create_pull_request(
            branch_name=req.branch_name,
            pr_title=req.pr_title,
            pr_description=req.pr_description
        )
        
        if result.get('error'):
            return CreatePRResponse(
                pr_number=0,
                pr_url="",
                status="error",
                error=result['error']
            )
        
        return CreatePRResponse(
            pr_number=result['pr_number'],
            pr_url=result['pr_url'],
            status=result['status']
        )
        
    except Exception as e:
        return CreatePRResponse(
            pr_number=0,
            pr_url="",
            status="error",
            error=str(e)
        )

# Initialize global knowledge graph after all class definitions
def load_knowledge_graph() -> KnowledgeGraph:
    """Load knowledge graph from disk, or create new one if file doesn't exist"""
    kg_file = "knowledge_graph.json"
    try:
        if os.path.exists(kg_file):
            with open(kg_file, 'r') as f:
                data = json.load(f)
                kg = KnowledgeGraph(**data)
                print(f"[STARTUP] Loaded knowledge graph with {len(kg.nodes)} nodes and {len(kg.edges)} edges")
                return kg
    except Exception as e:
        print(f"[STARTUP] Failed to load knowledge graph: {e}")
    
    print("[STARTUP] Creating new empty knowledge graph")
    return KnowledgeGraph()

def save_knowledge_graph(kg: KnowledgeGraph) -> None:
    """Save knowledge graph to disk"""
    kg_file = "knowledge_graph.json"
    try:
        with open(kg_file, 'w') as f:
            json.dump(kg.dict(), f, indent=2)
        print(f"[SAVE] Knowledge graph saved with {len(kg.nodes)} nodes and {len(kg.edges)} edges")
    except Exception as e:
        print(f"[SAVE] Failed to save knowledge graph: {e}")

global_knowledge_graph = load_knowledge_graph()

# ============================================================================
# SLACK INTEGRATION ENDPOINTS
# ============================================================================

try:
    from app.slack_service import SlackService
    slack_service = SlackService()
    SLACK_ENABLED = True
except Exception as e:
    print(f"[STARTUP] Slack integration disabled: {e}")
    slack_service = None
    SLACK_ENABLED = False

@app.post("/slack/events")
async def slack_events(request: Request):
    """Handle Slack events (messages, mentions, etc.)"""
    if not SLACK_ENABLED:
        raise HTTPException(status_code=503, detail="Slack integration not configured")
    
    # Verify request signature
    timestamp = request.headers.get('X-Slack-Request-Timestamp', '')
    signature = request.headers.get('X-Slack-Signature', '')
    body = await request.body()
    
    if not slack_service.verify_request(timestamp, signature, body.decode()):
        raise HTTPException(status_code=401, detail="Invalid signature")
    
    payload = await request.json()
    
    # Handle URL verification challenge
    if payload.get('type') == 'url_verification':
        return {"challenge": payload['challenge']}
    
    # Handle events
    event = payload.get('event', {})
    event_type = event.get('type')
    
    if event_type == 'app_mention':
        await handle_slack_app_mention(event)
    elif event_type == 'message':
        await handle_slack_message(event)
    
    return {"ok": True}

@app.post("/slack/interactions")
async def slack_interactions(request: Request, background_tasks: BackgroundTasks):
    """Handle Slack interactive components (buttons, menus, etc.)"""
    if not SLACK_ENABLED:
        raise HTTPException(status_code=503, detail="Slack integration not configured")
    
    # Parse form data (Slack sends as application/x-www-form-urlencoded)
    form_data = await request.form()
    payload = json.loads(form_data.get('payload', '{}'))
    
    action_type = payload.get('type')
    actions = payload.get('actions', [])
    user = payload.get('user', {})
    channel = payload.get('channel', {})
    response_url = payload.get('response_url')
    
    if not actions:
        return {"ok": True}
    
    action = actions[0]
    action_id = action.get('action_id')
    value = action.get('value')
    
    # Handle different action types
    if action_id == 'approve_spec':
        background_tasks.add_task(handle_slack_spec_approval, value, user, channel, response_url)
        return {"text": '⚙️ Generating code... This will take about 45 seconds.'}
    
    elif action_id == 'reject_spec':
        return {"text": '❌ Spec rejected. The author will be notified.'}
    
    elif action_id == 'review_spec':
        return {"text": '👀 Opening spec in browser...'}
    
    elif action_id == 'view_knowledge_graph':
        return {"text": '🧠 Opening knowledge graph...'}
    
    elif action_id == 'apply_kg_suggestions':
        background_tasks.add_task(handle_slack_kg_suggestions, value, user, channel)
        return {"text": '✅ Applying reassignment suggestions...'}
    
    return {"ok": True}

@app.post("/slack/commands")
async def slack_commands(request: Request):
    """Handle Slack slash commands"""
    if not SLACK_ENABLED:
        raise HTTPException(status_code=503, detail="Slack integration not configured")
    
    # Parse form data
    form_data = await request.form()
    
    command = form_data.get('command')
    text = form_data.get('text', '')
    user_id = form_data.get('user_id')
    channel_id = form_data.get('channel_id')
    
    # Handle the command
    response = slack_service.handle_slash_command(command, text, user_id, channel_id)
    
    return response

# Background task handlers for Slack

async def handle_slack_app_mention(event: Dict[str, Any]):
    """Handle @midlayer mentions in messages"""
    text = event.get('text', '')
    channel = event.get('channel')
    user = event.get('user')
    
    # Check if this is a spec review request
    if 'review' in text.lower() and 'spec' in text.lower():
        # Extract spec ID or title from message
        spec_data = {
            'spec_id': 'spec_abc123',
            'title': 'Payment Flow Implementation',
            'author_id': user,
            'estimated_files': 3,
            'estimated_lines': 247,
            'estimated_endpoints': 2,
            'estimated_hours': '4-6 hours',
            'spec_url': f'{slack_service.app_base_url}/editor/abc123'
        }
        
        blocks = slack_service.create_spec_approval_message(spec_data)
        slack_service.post_message(channel, blocks, text="New spec ready for review")

async def handle_slack_message(event: Dict[str, Any]):
    """Handle regular messages (for future features)"""
    pass

async def handle_slack_spec_approval(spec_id: str, user: Dict, channel: Dict, response_url: str):
    """Background task: Generate code when spec is approved"""
    import asyncio
    try:
        import requests as req_lib
    except ImportError:
        return
    
    # Update message to show progress
    progress_data = {
        'agent_id': 'a3f7',
        'progress': 0,
        'steps': [
            {'name': 'Analyzing spec requirements', 'status': 'in_progress'},
            {'name': 'Generating API endpoints', 'status': 'pending'},
            {'name': 'Creating database models', 'status': 'pending'},
            {'name': 'Writing tests', 'status': 'pending'}
        ],
        'last_update': 'just now'
    }
    
    blocks = slack_service.create_progress_message(progress_data)
    req_lib.post(response_url, json={'blocks': blocks, 'replace_original': False})
    
    # Simulate progress updates
    await asyncio.sleep(10)
    progress_data['progress'] = 25
    progress_data['steps'][0]['status'] = 'completed'
    progress_data['steps'][1]['status'] = 'in_progress'
    blocks = slack_service.create_progress_message(progress_data)
    req_lib.post(response_url, json={'blocks': blocks, 'replace_original': True})
    
    await asyncio.sleep(10)
    progress_data['progress'] = 50
    progress_data['steps'][1]['status'] = 'completed'
    progress_data['steps'][2]['status'] = 'in_progress'
    blocks = slack_service.create_progress_message(progress_data)
    req_lib.post(response_url, json={'blocks': blocks, 'replace_original': True})
    
    await asyncio.sleep(15)
    progress_data['progress'] = 75
    progress_data['steps'][2]['status'] = 'completed'
    progress_data['steps'][3]['status'] = 'in_progress'
    blocks = slack_service.create_progress_message(progress_data)
    req_lib.post(response_url, json={'blocks': blocks, 'replace_original': True})
    
    await asyncio.sleep(10)
    
    # Generate actual code using agent service (mock for now)
    pr_data = {
        'pr_number': 247,
        'branch_name': 'midlayer-payment-flow-1110',
        'files': [
            {'path': 'api/payments.py', 'additions': 156},
            {'path': 'models/transaction.py', 'additions': 67},
            {'path': 'tests/test_payments.py', 'additions': 24}
        ],
        'pr_url': 'https://github.com/yourorg/yourrepo/pull/247',
        'midlayer_url': f'{slack_service.app_base_url}/tasks/API-1'
    }
    
    # Post PR notification
    blocks = slack_service.create_pr_notification_message(pr_data)
    slack_service.post_message(
        channel['id'],
        blocks,
        text=f"PR #{pr_data['pr_number']} created successfully"
    )
    
    # Update knowledge graph and send notification
    kg_data = {
        'completed_task': 'Payment Flow Implementation',
        'agent_id': 'a3f7',
        'affected_tasks': [
            {'title': 'Refund Processing', 'status': 'unblocked'},
            {'title': 'Payment Analytics Dashboard', 'status': 'context available'}
        ],
        'graph_id': 'kg_123'
    }
    
    blocks = slack_service.create_knowledge_graph_notification(kg_data)
    slack_service.post_message(
        channel['id'],
        blocks,
        text="Knowledge graph updated"
    )

async def handle_slack_kg_suggestions(graph_id: str, user: Dict, channel: Dict):
    """Background task: Apply knowledge graph reassignment suggestions"""
    # Apply suggestions from knowledge graph
    pass

# ── PDF Reference Ingestion ───────────────────────────────────────────────────

class PDFExtractResponse(BaseModel):
    filename: str
    text: str
    page_count: int
    summary: Optional[str] = None
    key_findings: Optional[List[str]] = None
    suggested_citations: Optional[List[Dict[str, str]]] = None


@app.post("/extract-pdf", response_model=PDFExtractResponse)
async def extract_pdf(file: UploadFile = File(...)):
    """Extract text from a PDF and identify key findings for citation."""
    try:
        import pdfplumber
    except ImportError:
        raise HTTPException(status_code=503, detail="pdfplumber not installed")

    if not file.filename or not file.filename.lower().endswith('.pdf'):
        raise HTTPException(status_code=400, detail="Please upload a PDF file.")

    file_bytes = await file.read()
    if len(file_bytes) == 0:
        raise HTTPException(status_code=400, detail="Uploaded file is empty.")
    if len(file_bytes) > 100 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="File too large. Max 100 MB.")

    # Extract text
    try:
        pdf_text = ""
        page_count = 0
        with pdfplumber.open(io.BytesIO(file_bytes)) as pdf:
            page_count = len(pdf.pages)
            for page in pdf.pages:
                page_text = page.extract_text()
                if page_text:
                    pdf_text += page_text + "\n\n"
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to read PDF: {str(e)[:200]}")

    if not pdf_text.strip():
        return PDFExtractResponse(
            filename=file.filename or "unknown.pdf",
            text="(No text could be extracted from this PDF.)",
            page_count=page_count,
        )

    # Analyze the PDF for key findings
    summary = None
    key_findings = None
    suggested_citations = None

    try:
        analysis_prompt = f"""Analyze this academic paper/document and extract key information for citation purposes.

TEXT (first 6000 chars):
\"\"\"
{pdf_text[:6000]}
\"\"\"

Return ONLY valid JSON:
{{
  "summary": "2-3 sentence summary of the paper",
  "key_findings": ["finding 1", "finding 2", "finding 3"],
  "suggested_citations": [
    {{
      "claim": "a specific citable claim from the paper",
      "page_context": "roughly where in the paper this appears",
      "citation_text": "formatted as: Author(s), Year. Title. Venue."
    }}
  ]
}}

Extract 3-5 key findings and 2-4 citable claims. Return ONLY JSON."""

        raw = _call_ai_with_fallback(analysis_prompt, "You extract key findings from academic papers for citation. Return only valid JSON.", max_tokens=2000)

        parsed = None
        try:
            cleaned = raw.replace("```json", "").replace("```", "").strip()
            parsed = json.loads(cleaned)
        except Exception:
            json_match = re.search(r'\{[\s\S]*\}', raw)
            if json_match:
                try:
                    parsed = json.loads(json_match.group(0))
                except Exception:
                    pass

        if parsed:
            summary = parsed.get("summary")
            key_findings = parsed.get("key_findings")
            suggested_citations = parsed.get("suggested_citations")

    except Exception as e:
        print(f"[PDF] AI analysis failed: {e}")

    return PDFExtractResponse(
        filename=file.filename or "unknown.pdf",
        text=pdf_text[:50000],  # cap at 50k chars
        page_count=page_count,
        summary=summary,
        key_findings=key_findings,
        suggested_citations=suggested_citations,
    )


# ── Transcription (Deepgram) ──────────────────────────────────────────────────

class TranscriptionResponse(BaseModel):
    transcript: str
    duration: Optional[float] = None
    confidence: Optional[float] = None
    speakers: Optional[List[Dict[str, Any]]] = None
    paragraphs: Optional[List[str]] = None

class TranscribeAnalyzeResponse(BaseModel):
    transcript: str
    duration: Optional[float] = None
    confidence: Optional[float] = None
    speakers: Optional[List[Dict[str, Any]]] = None
    paragraphs: Optional[List[str]] = None
    analysis: Optional[str] = None  # raw AI analysis text
    claims: Optional[List[Dict[str, Any]]] = None  # structured claim objects
    error: Optional[str] = None


@app.post("/transcribe", response_model=TranscribeAnalyzeResponse)
async def transcribe_audio(file: UploadFile = File(...)):
    """
    Accept an audio/video file, transcribe it via Deepgram, then analyse the
    transcript for verifiable claims and suggest citations.
    """
    deepgram_key = os.getenv("DEEPGRAM_API_KEY")
    if not deepgram_key:
        raise HTTPException(status_code=503, detail="Deepgram API not configured. Set DEEPGRAM_API_KEY in .env")

    # Validate file type
    allowed_types = {
        "audio/mpeg", "audio/mp3", "audio/wav", "audio/x-wav", "audio/wave",
        "audio/mp4", "audio/m4a", "audio/x-m4a", "audio/ogg", "audio/webm",
        "video/mp4", "video/webm", "video/quicktime", "video/x-msvideo",
        "application/octet-stream",  # fallback for unknown types
    }
    content_type = file.content_type or "application/octet-stream"
    # Allow any audio/* or video/* even if not explicitly listed
    if not (content_type in allowed_types or content_type.startswith("audio/") or content_type.startswith("video/")):
        raise HTTPException(status_code=400, detail=f"Unsupported file type: {content_type}. Upload an audio or video file.")

    # Read the uploaded file
    file_bytes = await file.read()
    if len(file_bytes) == 0:
        raise HTTPException(status_code=400, detail="Uploaded file is empty.")
    if len(file_bytes) > 500 * 1024 * 1024:  # 500 MB limit
        raise HTTPException(status_code=400, detail="File too large. Max 500 MB.")

    # ── Step 1: Transcribe with Deepgram ──
    try:
        # Use Deepgram REST API directly with httpx for reliability
        async with httpx.AsyncClient(timeout=300.0) as client:
            resp = await client.post(
                "https://api.deepgram.com/v1/listen",
                headers={
                    "Authorization": f"Token {deepgram_key}",
                    "Content-Type": content_type,
                },
                params={
                    "model": "nova-3",
                    "smart_format": "true",
                    "paragraphs": "true",
                    "diarize": "true",
                    "punctuate": "true",
                    "utterances": "true",
                },
                content=file_bytes,
            )

        if resp.status_code != 200:
            detail = resp.text[:500]
            raise HTTPException(status_code=502, detail=f"Deepgram API error ({resp.status_code}): {detail}")

        dg_result = resp.json()

    except httpx.TimeoutException:
        raise HTTPException(status_code=504, detail="Deepgram transcription timed out. Try a shorter recording.")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Deepgram transcription failed: {str(e)[:300]}")

    # ── Parse Deepgram response ──
    channels = dg_result.get("results", {}).get("channels", [])
    if not channels:
        raise HTTPException(status_code=502, detail="Deepgram returned no results.")

    alt = channels[0].get("alternatives", [{}])[0]
    transcript_text = alt.get("transcript", "")
    confidence = alt.get("confidence")
    duration_val = dg_result.get("metadata", {}).get("duration")

    # Extract paragraphs if available
    paragraphs_data = alt.get("paragraphs", {}).get("paragraphs", [])
    paragraphs_list: List[str] = []
    speakers_info: List[Dict[str, Any]] = []

    if paragraphs_data:
        for para in paragraphs_data:
            speaker = para.get("speaker", None)
            sentences = para.get("sentences", [])
            text = " ".join(s.get("text", "") for s in sentences).strip()
            if text:
                prefix = f"Speaker {speaker}: " if speaker is not None else ""
                paragraphs_list.append(f"{prefix}{text}")
                if speaker is not None:
                    # Track unique speakers
                    if not any(sp["id"] == speaker for sp in speakers_info):
                        speakers_info.append({"id": speaker, "label": f"Speaker {speaker}"})
    else:
        # Fallback: split transcript into paragraphs on double newlines
        paragraphs_list = [p.strip() for p in transcript_text.split("\n\n") if p.strip()]

    if not transcript_text.strip():
        return TranscribeAnalyzeResponse(
            transcript="(No speech detected in the recording.)",
            duration=duration_val,
            confidence=confidence,
            speakers=speakers_info or None,
            paragraphs=paragraphs_list or None,
            error="No speech was detected. Make sure the recording contains audible speech."
        )

    # ── Step 2: Analyse transcript for claims & citation recommendations ──
    analysis_text = None
    claims_list = None

    try:
        analysis_prompt = f"""You are a research assistant helping a student verify claims from an expert interview or meeting recording.

Below is a transcript of a recorded meeting/interview. Your job is to:
1. Identify the key claims, assertions, or factual statements made by the speakers.
2. For each claim, assess whether it is verifiable and suggest specific academic sources or types of evidence that could support or challenge it.
3. Return your analysis as valid JSON (no markdown fences, no extra text).

TRANSCRIPT:
\"\"\"
{transcript_text[:8000]}
\"\"\"

Return ONLY valid JSON in this exact format:
{{
  "summary": "2-3 sentence summary of what the interview/meeting covered",
  "claims": [
    {{
      "claim": "the specific claim or assertion made",
      "speaker": "Speaker 0 or Speaker 1 or Unknown",
      "timestamp_context": "rough context of when this was said",
      "verifiability": "high" | "medium" | "low",
      "suggested_sources": [
        {{
          "type": "journal article" | "book" | "dataset" | "government report" | "news source",
          "description": "what to search for to verify this claim",
          "search_query": "a specific search query the student could use"
        }}
      ],
      "recommendation": "brief advice on how to cite or verify this point"
    }}
  ],
  "overall_credibility": "strong" | "moderate" | "weak" | "mixed",
  "next_steps": ["specific action 1", "specific action 2"]
}}

Return 3-8 claims. Focus on the most important, citable assertions. Return ONLY the JSON object."""

        analysis_system = "You are a meticulous research assistant that helps students verify claims from expert interviews and meetings. You identify verifiable assertions and suggest specific academic sources. Always return valid JSON."

        raw_analysis = _call_ai_with_fallback(analysis_prompt, analysis_system, max_tokens=4000)
        analysis_text = raw_analysis

        # Try to parse structured claims
        parsed = None
        try:
            cleaned = raw_analysis.replace("```json", "").replace("```", "").strip()
            parsed = json.loads(cleaned)
        except Exception:
            json_match = re.search(r'\{[\s\S]*\}', raw_analysis)
            if json_match:
                try:
                    parsed = json.loads(json_match.group(0))
                except Exception:
                    pass

        if parsed and "claims" in parsed:
            claims_list = parsed["claims"]
            # Attach summary and overall info to each claim for frontend convenience
            for c in claims_list:
                c.setdefault("verifiability", "medium")
                c.setdefault("suggested_sources", [])
                c.setdefault("recommendation", "")
            # Add summary as metadata
            if parsed.get("summary"):
                analysis_text = parsed["summary"]

    except Exception as e:
        print(f"[Transcribe] AI analysis failed: {e}")
        # Non-fatal: we still return the transcript

    return TranscribeAnalyzeResponse(
        transcript=transcript_text,
        duration=duration_val,
        confidence=confidence,
        speakers=speakers_info or None,
        paragraphs=paragraphs_list or None,
        analysis=analysis_text,
        claims=claims_list,
    )


@app.get("/slack/status")
def slack_status():
    """Check Slack integration status"""
    return {
        "enabled": SLACK_ENABLED,
        "configured": bool(slack_service and slack_service.bot_token),
        "message": "Slack integration is active" if SLACK_ENABLED else "Slack integration disabled - check environment variables"
    }
