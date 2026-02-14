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

from fastapi import FastAPI, HTTPException, Request, BackgroundTasks
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
            model=os.getenv("DEFAULT_MODEL", "claude-3-5-sonnet-20241022"),
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
        
        model = genai.GenerativeModel('gemini-1.5-pro')
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
    last_error = None
    for service_name, service_func in services:
        try:
            return service_func(prompt, system_prompt, max_tokens)
        except Exception as e:
            print(f"[AI Fallback] {service_name} failed: {str(e)}")
            last_error = e
            continue
    
    # If all services fail, raise the last error
    if last_error:
        raise HTTPException(status_code=503, detail=f"All AI services failed. Last error: {str(last_error)}")
    else:
        raise HTTPException(status_code=503, detail="No AI services available")


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
            full_prompt = f"""BUSINESS-TO-TECHNICAL TRANSLATION TASK (FREEFORM FRIENDLY):

Use freeform if present; otherwise use fields.
Freeform: {req.freeform}
Business Use Case: {req.goal}
Success Metrics: {req.notes}
Technical Constraints: {req.context}

Your mission: Transform this business requirement into executable technical deliverables.

THINK LIKE A SENIOR PM + TECH LEAD:
1. Break down the business use case into user stories
2. Identify the technical architecture needed
3. Create specific, executable tasks spanning:
   - Backend APIs & database design
   - Frontend components & user experience
   - Integration points & data flows
   - Testing, deployment, and monitoring
   - Documentation and stakeholder communication

Return a JSON object with this structure:
{{
  "goal": "Refined technical goal based on business use case",
  "tasks": [
    {{
      "id": "API-1",
      "title": "Design user authentication API",
      "description": "Create REST endpoints for login/signup with JWT tokens, input validation, and rate limiting",
      "estimate": "3d",
      "dependencies": [],
      "priority": "P1",
      "reach": 10000,
      "impact": 4.5,
      "confidence": 4.0,
      "effort": 24,
      "customerImpactScore": 8.5,
      "revenueImpact": 50.0,
      "retentionImpact": 15.0,
      "satisfactionImpact": 12.0,
      "adoptionImpact": 75.0,
      "successMetrics": ["conversion_rate", "time_to_value", "user_engagement"]
    }},
    {{
      "id": "DB-1", 
      "title": "Design user and order tracking database schema",
      "description": "Create tables for users, orders, tracking_events with proper indexing and relationships",
      "estimate": "2d",
      "dependencies": [],
      "priority": "P1",
      "reach": 10000,
      "impact": 4.0,
      "confidence": 4.5,
      "effort": 16,
      "customerImpactScore": 7.0,
      "revenueImpact": 25.0,
      "retentionImpact": 8.0,
      "satisfactionImpact": 25.0,
      "adoptionImpact": 60.0,
      "successMetrics": ["data_accuracy", "system_reliability"]
    }},
    {{
      "id": "FE-1",
      "title": "Build order tracking dashboard component",
      "description": "React component showing real-time order status with progress indicator and estimated delivery",
      "estimate": "4d", 
      "dependencies": ["API-1", "DB-1"],
      "priority": "P1",
      "reach": 8000,
      "impact": 4.5,
      "confidence": 3.5,
      "effort": 32,
      "customerImpactScore": 9.0,
      "revenueImpact": 75.0,
      "retentionImpact": 20.0,
      "satisfactionImpact": 25.0,
      "adoptionImpact": 60.0,
      "successMetrics": ["customer_satisfaction", "support_ticket_reduction", "user_retention"]
    }}
  ],
  "notes": "Generated technical implementation plan from business requirements"
}}

TASK CATEGORIES TO INCLUDE:
- API/Backend services (API-X)
- Database design (DB-X) 
- Frontend components (FE-X)
- Integration work (INT-X)
- Testing & QA (TEST-X)
- DevOps & deployment (DEPLOY-X)
- Documentation (DOC-X)

Generate 10-15 specific technical tasks that would deliver the business value described or implied by the freeform notes. Make each task:
- Executable by a developer
- Clearly scoped with specific deliverables
- Properly estimated and prioritized
- Connected to business impact

CRITICAL: For each task, estimate customer success metrics based on the business use case:
- customerImpactScore: 1-10 scale of direct customer benefit
- revenueImpact: Expected revenue impact in thousands ($K)
- retentionImpact: Percentage improvement in customer retention
- satisfactionImpact: Expected NPS/CSAT improvement (1-50 scale)
- adoptionImpact: Percentage of users who will use this feature (0-100)
- successMetrics: Array of specific KPIs this task improves (e.g., ["conversion_rate", "churn_reduction"])

These metrics should directly connect to the success metrics provided in the business case."""

            system_prompt = system + "\n\nYou are an expert technical product manager and software architect. Return ONLY valid JSON with no additional text or formatting."
            
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

@app.get("/slack/status")
def slack_status():
    """Check Slack integration status"""
    return {
        "enabled": SLACK_ENABLED,
        "configured": bool(slack_service and slack_service.bot_token),
        "message": "Slack integration is active" if SLACK_ENABLED else "Slack integration disabled - check environment variables"
    }
