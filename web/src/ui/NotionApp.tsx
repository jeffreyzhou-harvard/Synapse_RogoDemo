import React, { useMemo, useState, useEffect } from 'react';

type PlanTask = {
  id: string;
  title: string;
  description?: string;
  estimate?: string;
  dependencies?: string[];
  priority?: string;
  reach?: number;
  impact?: number;
  confidence?: number;
  effort?: number;
  customer_impact_score?: number;
  revenue_impact?: number;
  retention_impact?: number;
  satisfaction_impact?: number;
  adoption_impact?: number;
  success_metrics?: string[];
};

type PlanResponse = {
  goal: string;
  tasks: PlanTask[];
  critical_path: string[];
  notes: string;
};

async function api<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export default function NotionApp(): JSX.Element {
  const [goal, setGoal] = useState('Ship a task planning agent MVP');
  const [notes, setNotes] = useState('');
  const [context, setContext] = useState('{"repo":"midlayer-exp"}');
  const [freeform, setFreeform] = useState('');
  const [loading, setLoading] = useState(false);
  const [plan, setPlan] = useState<PlanResponse | null>(null);
  const [method, setMethod] = useState<'RICE' | 'ICE' | 'WSJF' | 'CD3' | 'CUSTOMER' | 'BUSINESS'>('CUSTOMER');
  const [prioritized, setPrioritized] = useState<Array<PlanTask & { score: number }>>([]);
  const [executingTasks, setExecutingTasks] = useState<Set<string>>(new Set());
  const [executedTasks, setExecutedTasks] = useState<Map<string, any>>(new Map());
  const [delegationQueue, setDelegationQueue] = useState<PlanTask[]>([]);
  const [showDelegationPanel, setShowDelegationPanel] = useState(false);
  const [tab, setTab] = useState<'Plan'|'Sandbox'|'RFC'|'Graph'|'Hotspots'|'Runbook'|'Knowledge'|'Specs'>('Plan');
  const [sandboxCode, setSandboxCode] = useState("print('hello')\nresult = 1+1");
  const [sandboxOut, setSandboxOut] = useState('');
  const [rfcText, setRfcText] = useState('');
  const [graphInfo, setGraphInfo] = useState<{nodes:number, edges:number}|null>(null);
  const [hotspots, setHotspots] = useState<Array<{file:string;lines:number;churn:number;score:number}>>([]);
  const [runbookEvents, setRunbookEvents] = useState<Array<any>>([]);
  const [knowledgeGraph, setKnowledgeGraph] = useState<{nodes: any[], edges: any[]} | null>(null);
  const [knowledgeStats, setKnowledgeStats] = useState<any>(null);
  const [livingSpec, setLivingSpec] = useState<any>(null);
  const [architecturalDecisions, setArchitecturalDecisions] = useState<any[]>([]);
  const [technologyStack, setTechnologyStack] = useState<any[]>([]);

  async function generatePlan(): Promise<void> {
    setLoading(true);
    try {
      const ctx = context ? JSON.parse(context) : {};
      const p = await api<PlanResponse>('/plan', freeform.trim() ? { freeform, goal, notes, context: ctx } : { goal, notes, context: ctx });
      setPlan(p);
      setPrioritized([]);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  async function doPrioritize(): Promise<void> {
    if (!plan) return;
    const tasks = plan.tasks.map(t => ({ ...t }));
    const res = await api<Array<PlanTask & { score: number }>>('/prioritize', { method, tasks });
    setPrioritized(res);
  }

  function updateTaskMetric(taskId: string, field: string, value: string): void {
    if (!plan) return;
    const numValue = parseFloat(value) || 0;
    setPlan({
      ...plan,
      tasks: plan.tasks.map(t => 
        t.id === taskId ? { ...t, [field]: numValue } : t
      )
    });
  }

  async function autoUpdatePriority(): Promise<void> {
    if (!plan) return;
    const tasks = plan.tasks.map(t => ({ ...t }));
    const res = await api<Array<PlanTask & { score: number }>>('/prioritize', { method, tasks });
    setPrioritized(res);
  }

  const criticalSet = useMemo(() => new Set(plan?.critical_path ?? []), [plan]);

  async function executeTask(taskId: string, title: string, description: string): Promise<void> {
    setExecutingTasks(prev => new Set([...prev, taskId]));
    
    try {
      const res = await api<{
        task_id: string;
        status: string;
        files_created: string[];
        code_generated: string;
        error?: string;
      }>('/execute-task', {
        task_id: taskId,
        task_title: title,
        task_description: description,
        project_context: `Goal: ${goal}\nNotes: ${notes}`,
        tech_stack: 'Python',
      });
      
      setExecutedTasks(prev => new Map(prev).set(taskId, res));
    } catch (error) {
      console.error('Task execution failed:', error);
      setExecutedTasks(prev => new Map(prev).set(taskId, {
        task_id: taskId,
        status: 'error',
        files_created: [],
        code_generated: '',
        error: 'Execution failed'
      }));
    } finally {
      setExecutingTasks(prev => {
        const next = new Set(prev);
        next.delete(taskId);
        return next;
      });
    }
  }

  function delegateTask(task: PlanTask): void {
    if (!delegationQueue.find(t => t.id === task.id)) {
      setDelegationQueue(prev => [...prev, task]);
      setShowDelegationPanel(true);
    }
  }

  function removeDelegatedTask(taskId: string): void {
    setDelegationQueue(prev => prev.filter(t => t.id !== taskId));
  }

  async function executeDelegationQueue(): Promise<void> {
    for (const task of delegationQueue) {
      if (!executingTasks.has(task.id) && !executedTasks.has(task.id)) {
        await executeTask(task.id, task.title, task.description || '');
      }
    }
    setDelegationQueue([]);
  }

  async function loadKnowledgeGraph(): Promise<void> {
    try {
      const [graphRes, statsRes] = await Promise.all([
        api<{nodes: any[], edges: any[]}>('/knowledge-graph/graph'),
        api<any>('/knowledge-graph/status')
      ]);
      
      setKnowledgeGraph(graphRes);
      setKnowledgeStats(statsRes);
    } catch (error) {
      console.error('Failed to load knowledge graph:', error);
    }
  }

  async function loadLivingSpecs(): Promise<void> {
    try {
      const [specRes, decisionsRes, techRes] = await Promise.all([
        api<any>('/specs/living'),
        api<{decisions: any[]}>('/specs/architectural-decisions'),
        api<{technologies: any[]}>('/specs/technology-stack')
      ]);
      
      setLivingSpec(specRes);
      setArchitecturalDecisions(decisionsRes.decisions);
      setTechnologyStack(techRes.technologies);
    } catch (error) {
      console.error('Failed to load living specs:', error);
    }
  }

  async function runSandbox(): Promise<void> {
    const res = await api<{stdout:string;result?:string;error?:string}>('/sandbox/execute', { code: sandboxCode, timeout_ms: 2000 });
    setSandboxOut(JSON.stringify(res, null, 2));
  }

  async function genRfc(): Promise<void> {
    const res = await api<{draft:string}>('/rfc/draft', { context: notes || goal });
    setRfcText(res.draft);
  }

  // Auto-load data when switching tabs
  useEffect(() => {
    if (tab === 'Knowledge') {
      loadKnowledgeGraph();
    } else if (tab === 'Specs') {
      loadLivingSpecs();
    }
  }, [tab]);

  return (
    <div className="min-h-screen bg-white text-gray-900">
      {/* Header */}
      <header className="h-14 bg-white border-b border-gray-200 px-6 flex items-center justify-between sticky top-0 z-50">
        {/* Breadcrumb */}
        <div className="flex items-center text-sm">
          <a href="#" className="text-blue-600 hover:text-blue-800 no-underline">Home</a>
          <span className="mx-2 text-gray-400">/</span>
          <span className="text-gray-900 font-medium">{tab}</span>
        </div>
        
        {/* Header Actions */}
        <div className="flex items-center gap-3">
          {/* Avatar Stack */}
          <div className="flex -space-x-2">
            <div className="w-7 h-7 bg-indigo-500 rounded-full border-2 border-white flex items-center justify-center text-xs font-semibold text-white">AI</div>
            <div className="w-7 h-7 bg-emerald-500 rounded-full border-2 border-white flex items-center justify-center text-xs font-semibold text-white">U</div>
          </div>
          
          {/* Action Buttons */}
          <button 
            onClick={generatePlan} 
            className="px-3 py-1.5 text-sm bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-md border transition-colors"
          >
            Generate Plan
          </button>
          <button 
            onClick={loadKnowledgeGraph} 
            className="px-3 py-1.5 text-sm bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-md border transition-colors"
          >
            Refresh
          </button>
        </div>
      </header>

      <div className="flex">
        {/* Sidebar */}
        <aside className="hidden lg:flex lg:flex-col w-64 bg-gray-50 border-r border-gray-200 min-h-screen">
          {/* Sidebar Header */}
          <div className="p-4 flex items-center gap-3 border-b border-gray-200">
            <div className="w-8 h-8 bg-indigo-600 rounded-md flex items-center justify-center text-white font-semibold text-sm">
              M
            </div>
            <div>
              <div className="font-semibold text-gray-900 text-base">MidLayer</div>
              <div className="text-xs text-gray-500">AI Planning Tool</div>
            </div>
          </div>

          {/* Navigation */}
          <nav className="p-2 flex-1">
            <div className="space-y-1">
              {[
                { id: 'Plan', label: 'Project Plan', icon: '○' },
                { id: 'Knowledge', label: 'Knowledge Graph', icon: '○' },
                { id: 'Specs', label: 'Living Specs', icon: '○' },
                { id: 'Sandbox', label: 'Code Sandbox', icon: '○' },
                { id: 'RFC', label: 'RFC Generator', icon: '○' },
                { id: 'Graph', label: 'Dependencies', icon: '○' },
                { id: 'Hotspots', label: 'Code Hotspots', icon: '○' },
                { id: 'Runbook', label: 'Runbooks', icon: '○' }
              ].map(item => (
                <button
                  key={item.id}
                  onClick={() => setTab(item.id as any)}
                  className={`w-full flex items-center gap-3 px-4 py-2 text-sm rounded-md transition-colors ${
                    tab === item.id 
                      ? 'bg-gray-200 text-gray-900' 
                      : 'text-gray-600 hover:bg-gray-100 hover:text-gray-800'
                  }`}
                >
                  <span className="text-lg flex-shrink-0">{item.icon}</span>
                  <span className="text-left font-medium">{item.label}</span>
                </button>
              ))}
            </div>

            {/* Collections Section */}
            <div className="mt-6">
              <div className="px-4 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                Collections
              </div>
              <div className="ml-3 border-l border-gray-200">
                <div className="space-y-1">
                  <div className="flex items-center gap-2 px-4 py-2 text-sm text-gray-600">
                    <span>○</span>
                    <span>Analytics</span>
                  </div>
                  <div className="flex items-center gap-2 px-4 py-2 text-sm text-gray-600">
                    <span>○</span>
                    <span>Goals & OKRs</span>
                  </div>
                  <div className="flex items-center gap-2 px-4 py-2 text-sm text-gray-600">
                    <span>○</span>
                    <span>Team Resources</span>
                  </div>
                </div>
              </div>
            </div>
          </nav>

          {/* Bottom Actions */}
          <div className="border-t border-gray-200">
            <div className="p-4 space-y-2">
              <div className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-800 cursor-pointer">
                <span>○</span>
                <span>Settings</span>
              </div>
              <div className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-800 cursor-pointer">
                <span>○</span>
                <span>Help & Support</span>
              </div>
            </div>
          </div>
        </aside>

        {/* Table of Contents */}
        <aside className="hidden xl:block w-60 bg-white border-r border-gray-200 min-h-screen sticky top-14 self-start">
          <div className="p-6">
            <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-4">
              Table of Contents
            </div>
            <nav className="space-y-2">
              {tab === 'Plan' && [
                { label: 'Project Overview', href: '#overview' },
                { label: 'Task Generation', href: '#tasks' },
                { label: 'Priority Ranking', href: '#priority' },
                { label: 'Execution Queue', href: '#execution' },
                { label: 'Business Metrics', href: '#metrics' }
              ].map(item => (
                <a
                  key={item.href}
                  href={item.href}
                  className="block text-sm text-gray-600 hover:text-gray-900 py-2 transition-colors"
                >
                  {item.label}
                </a>
              ))}
              
              {tab === 'Knowledge' && [
                { label: 'Knowledge Graph', href: '#graph' },
                { label: 'Task Dependencies', href: '#dependencies' },
                { label: 'Generated Files', href: '#files' },
                { label: 'Agent Assignments', href: '#agents' }
              ].map(item => (
                <a
                  key={item.href}
                  href={item.href}
                  className="block text-sm text-gray-600 hover:text-gray-900 py-2 transition-colors"
                >
                  {item.label}
                </a>
              ))}
              
              {tab === 'Specs' && [
                { label: 'Technical Overview', href: '#tech-overview' },
                { label: 'Architecture Decisions', href: '#architecture' },
                { label: 'Technology Stack', href: '#tech-stack' },
                { label: 'API Endpoints', href: '#apis' },
                { label: 'Gap Analysis', href: '#gaps' }
              ].map(item => (
                <a
                  key={item.href}
                  href={item.href}
                  className="block text-sm text-gray-600 hover:text-gray-900 py-2 transition-colors"
                >
                  {item.label}
                </a>
              ))}
            </nav>
          </div>
        </aside>

        {/* Main Content */}
        <main className="flex-1 max-w-4xl mx-auto px-4 md:px-8 xl:px-12 py-8">
          {tab === 'Plan' && (
            <div>
              {/* Document Title */}
              <div className="mb-8" id="overview">
                <h1 className="text-4xl font-bold text-gray-900 mb-2 leading-tight">
                  AI-Powered Project Planning
                  <span className="ml-3 text-2xl">*</span>
                </h1>
                <div className="text-sm text-gray-500 mb-8">
                  Last updated {new Date().toLocaleDateString()} · Created by AI Assistant
                </div>
              </div>

              {/* Notion-style Freeform Input */}
              <section className="mb-12" id="tasks">
                <h2 className="text-2xl font-semibold text-gray-900 mb-4 mt-8">Project Requirements</h2>
                <p className="text-base text-gray-700 leading-relaxed mb-4">
                  Describe your project like you would in a product brief. AI will automatically structure it into actionable tasks with business metrics and dependencies.
                </p>
                
                <div className="bg-gray-50 rounded-lg p-4 mb-6">
                  <textarea
                    className="w-full min-h-[200px] bg-transparent outline-none resize-none text-base leading-relaxed placeholder-gray-400"
                    placeholder={"e.g. We need an authentication system.\n\n- Use FastAPI for the backend\n- JWT tokens for stateless auth\n- Store users in Postgres\n- Include password reset and email verification\n- Ship in 2 sprints with comprehensive tests\n- Set up CI/CD pipeline for deployment\n\nSuccess metrics: 95% uptime, <200ms login response time, support 10K users"}
                    value={freeform}
                    onChange={e => setFreeform(e.target.value)}
                  />
                </div>
                
                <div className="flex items-center justify-between">
                  <div className="text-sm text-gray-500">
                    ○ Paste product requirements, user stories, or technical specs—AI will structure them automatically
                  </div>
                  <button
                    onClick={generatePlan}
                    disabled={loading}
                    className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded-lg font-medium text-sm flex items-center gap-2 disabled:bg-gray-400 transition-colors"
                  >
                    {loading ? (
                      <>
                        <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        Generating...
                      </>
                    ) : (
                      <>Generate Project Plan</>
                    )}
                  </button>
                </div>
              </section>

              {/* Generated Tasks */}
              {plan && (
                <section className="mb-12" id="priority">
                  <h2 className="text-2xl font-semibold text-gray-900 mb-4">Generated Project Plan</h2>
                  <p className="text-base text-gray-700 leading-relaxed mb-6">
                    AI has analyzed your requirements and created a structured plan with {plan.tasks.length} tasks, 
                    including business impact metrics and dependency mapping.
                  </p>
                  
                  <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-lg p-6 mb-8">
                    <div className="flex items-center gap-3 mb-4">
                      <div className="w-8 h-8 bg-blue-500 rounded-lg flex items-center justify-center text-white font-semibold">
                        ○
                      </div>
                      <div>
                        <h3 className="font-semibold text-gray-900">Project Goal</h3>
                        <p className="text-gray-700">{plan.goal}</p>
                      </div>
                    </div>
                    {plan.notes && (
                      <div className="text-sm text-gray-600 bg-white rounded p-3">
                        <strong>Notes:</strong> {plan.notes}
                      </div>
                    )}
                  </div>

                  {/* Tasks Grid */}
                  <div className="grid gap-6">
                    {plan.tasks.map((task, idx) => (
                      <div
                        key={task.id}
                        className={`rounded-lg border p-6 transition-all ${
                          criticalSet.has(task.id)
                            ? 'border-orange-200 bg-gradient-to-r from-orange-50 to-amber-50'
                            : 'border-gray-200 bg-white hover:border-gray-300'
                        }`}
                      >
                        <div className="flex items-start justify-between mb-4">
                          <div className="flex items-start gap-4 flex-1">
                            <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold ${
                              criticalSet.has(task.id) ? 'bg-orange-500 text-white' : 'bg-gray-100 text-gray-600'
                            }`}>
                              {idx + 1}
                            </div>
                            <div className="flex-1">
                              <h4 className="text-lg font-semibold text-gray-900 mb-2">{task.title}</h4>
                              {task.description && (
                                <p className="text-gray-700 leading-relaxed mb-3">{task.description}</p>
                              )}
                              {task.dependencies && task.dependencies.length > 0 && (
                                <div className="text-sm text-gray-500">
                                  <strong>Dependencies:</strong> {task.dependencies.join(', ')}
                                </div>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            {criticalSet.has(task.id) && (
                              <span className="text-xs bg-orange-500 text-white px-2 py-1 rounded-full font-medium">
                                Critical Path
                              </span>
                            )}
                            <span className="text-xs bg-gray-100 text-gray-600 px-2 py-1 rounded font-medium">
                              {task.estimate || '—'}
                            </span>
                            
                            <button
                              onClick={() => delegateTask(task)}
                              disabled={delegationQueue.find(dt => dt.id === task.id) !== undefined}
                              className={`text-xs px-3 py-1 rounded-full font-medium transition-all mr-2 ${
                                delegationQueue.find(dt => dt.id === task.id)
                                  ? 'bg-orange-500 text-white'
                                  : 'bg-orange-400 hover:bg-orange-500 text-white'
                              }`}
                            >
                              {delegationQueue.find(dt => dt.id === task.id) ? '○ Queued' : '○ Delegate'}
                            </button>

                            <button
                              onClick={() => executeTask(task.id, task.title, task.description || '')}
                              disabled={executingTasks.has(task.id)}
                              className={`text-xs px-3 py-1 rounded-full font-medium transition-all ${
                                executedTasks.has(task.id)
                                  ? executedTasks.get(task.id)?.status === 'success'
                                    ? 'bg-green-500 text-white'
                                    : 'bg-red-500 text-white'
                                  : executingTasks.has(task.id)
                                  ? 'bg-blue-300 text-white cursor-not-allowed'
                                  : 'bg-blue-500 hover:bg-blue-600 text-white'
                              }`}
                            >
                              {executingTasks.has(task.id) ? (
                                <>
                                  <div className="w-3 h-3 border border-white/30 border-t-white rounded-full animate-spin inline-block mr-1"></div>
                                  Executing...
                                </>
                              ) : executedTasks.has(task.id) ? (
                                executedTasks.get(task.id)?.status === 'success' ? '✓ Done' : '✗ Failed'
                              ) : (
                                '○ Execute'
                              )}
                            </button>
                          </div>
                        </div>

                        {/* Business Metrics Section */}
                        <div className="bg-gray-50 rounded-lg p-4 mb-4">
                          <div className="flex items-center gap-2 mb-3">
                            <span className="text-sm font-semibold text-gray-700">Business Impact Metrics</span>
                            <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium">
                              AI Generated
                            </span>
                          </div>
                          <div className="grid grid-cols-2 gap-3">
                            <div>
                              <label className="text-xs font-medium text-gray-600 block mb-1">Reach (users)</label>
                              <input
                                type="number"
                                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:border-blue-500 focus:ring-0"
                                value={task.reach || ''}
                                onChange={e => updateTaskMetric(task.id, 'reach', e.target.value)}
                                onBlur={autoUpdatePriority}
                              />
                            </div>
                            <div>
                              <label className="text-xs font-medium text-gray-600 block mb-1">Impact (1-5)</label>
                              <input
                                type="number"
                                step="0.1"
                                min="1"
                                max="5"
                                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:border-blue-500 focus:ring-0"
                                value={task.impact || ''}
                                onChange={e => updateTaskMetric(task.id, 'impact', e.target.value)}
                                onBlur={autoUpdatePriority}
                              />
                            </div>
                            <div>
                              <label className="text-xs font-medium text-gray-600 block mb-1">Confidence (1-5)</label>
                              <input
                                type="number"
                                step="0.1"
                                min="1"
                                max="5"
                                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:border-blue-500 focus:ring-0"
                                value={task.confidence || ''}
                                onChange={e => updateTaskMetric(task.id, 'confidence', e.target.value)}
                                onBlur={autoUpdatePriority}
                              />
                            </div>
                            <div>
                              <label className="text-xs font-medium text-gray-600 block mb-1">Effort (hours)</label>
                              <input
                                type="number"
                                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:border-blue-500 focus:ring-0"
                                value={task.effort || ''}
                                onChange={e => updateTaskMetric(task.id, 'effort', e.target.value)}
                                onBlur={autoUpdatePriority}
                              />
                            </div>
                          </div>
                        </div>

                        {/* Execution Results */}
                        {executedTasks.has(task.id) && (
                          <div className="bg-blue-50 rounded-lg p-4 border-l-4 border-blue-500">
                            <div className="flex items-center gap-2 mb-2">
                              <span className="text-sm font-semibold text-gray-700">Execution Result</span>
                              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                                executedTasks.get(task.id)?.status === 'success' 
                                  ? 'bg-green-100 text-green-700' 
                                  : 'bg-red-100 text-red-700'
                              }`}>
                                {executedTasks.get(task.id)?.status}
                              </span>
                            </div>
                            
                            {executedTasks.get(task.id)?.files_created?.length > 0 && (
                              <div className="mb-2">
                                <span className="text-xs font-medium text-gray-600">Files Created:</span>
                                <ul className="text-xs text-gray-600 ml-2">
                                  {executedTasks.get(task.id)?.files_created.map((file: string, idx: number) => (
                                    <li key={idx} className="font-mono">○ {file}</li>
                                  ))}
                                </ul>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>

                  {/* Priority Ranking Section */}
                  <div className="mt-12" id="execution">
                    <h2 className="text-2xl font-semibold text-gray-900 mb-4">Priority Ranking</h2>
                    <p className="text-base text-gray-700 leading-relaxed mb-6">
                      Use different prioritization frameworks to rank tasks by business impact and strategic value.
                    </p>

                    <div className="bg-white border border-gray-200 rounded-lg p-6">
                      <div className="mb-4">
                        <label className="text-sm font-semibold text-gray-700 block mb-2">Prioritization Method</label>
                        <select 
                          className="w-full max-w-md border border-gray-300 rounded-lg px-3 py-2 focus:border-blue-500 focus:ring-0" 
                          value={method} 
                          onChange={e => setMethod(e.target.value as any)}
                        >
                          <option value="CUSTOMER">Customer Success Score</option>
                          <option value="BUSINESS">Business Value Score</option>
                          <option value="RICE">RICE Framework</option>
                          <option value="ICE">ICE Framework</option>
                          <option value="WSJF">WSJF (SAFe)</option>
                          <option value="CD3">Cost of Delay</option>
                        </select>
                      </div>

                      <div className="mb-6 p-4 bg-blue-50 rounded-lg">
                        <div className="text-sm font-medium text-blue-800 mb-1">How {method} Works:</div>
                        <div className="text-sm text-blue-700">
                          {method === 'CUSTOMER' && 'Revenue + Retention + Satisfaction + Adoption impacts ÷ Effort'}
                          {method === 'BUSINESS' && '50% Customer Success + 30% RICE + 20% Strategic Value'}
                          {method === 'RICE' && '(Reach × Impact × Confidence) ÷ Effort'}
                          {method === 'ICE' && 'Impact × Confidence × Ease (1/Effort)'}
                          {method === 'WSJF' && 'Value ÷ Effort (higher = better)'}
                          {method === 'CD3' && 'Cost of Delay ÷ Duration (higher = better)'}
                        </div>
                      </div>

                      <button 
                        onClick={doPrioritize} 
                        className="bg-blue-600 hover:bg-blue-700 text-white font-semibold px-6 py-3 rounded-lg transition-colors"
                      >
                        ○ Compute Priority Scores
                      </button>

                      {prioritized.length > 0 && (
                        <div className="mt-8">
                          <h4 className="text-lg font-semibold text-gray-900 mb-4">Priority Ranking Results</h4>
                          <div className="space-y-3">
                            {prioritized.map((task, idx) => (
                              <div key={task.id} className={`rounded-lg border p-4 ${
                                idx < 3 ? 'border-green-200 bg-green-50' : 'border-gray-200 bg-white'
                              }`}>
                                <div className="flex items-center justify-between">
                                  <div className="flex items-center gap-3">
                                    <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                                      idx < 3 ? 'bg-green-500 text-white' : 'bg-gray-300 text-gray-600'
                                    }`}>
                                      {idx + 1}
                                    </div>
                                    <div>
                                      <div className="font-medium text-gray-900">{task.title}</div>
                                      <div className="text-sm text-gray-500">
                                        {task.customer_impact_score && `○ ${task.customer_impact_score}/10`}
                                        {task.revenue_impact && ` · $ $${task.revenue_impact}K`}
                                        {task.retention_impact && ` · ↗ +${task.retention_impact}%`}
                                      </div>
                                    </div>
                                  </div>
                                  <div className="text-right">
                                    <div className="text-lg font-bold text-gray-900">{task.score.toFixed(1)}</div>
                                    <div className="text-xs text-gray-500">{method} score</div>
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </section>
              )}
            </div>
          )}

          {/* Other tabs content can be added here with similar document styling */}
          {tab === 'Sandbox' && (
            <div>
              <h1 className="text-4xl font-bold text-gray-900 mb-2 leading-tight">Code Sandbox</h1>
              <div className="text-sm text-gray-500 mb-8">Interactive Python code execution environment</div>
              
              <h2 className="text-2xl font-semibold text-gray-900 mb-4">Live Code Block (Python)</h2>
              <div className="bg-gray-50 rounded-lg p-4 mb-4">
                <textarea 
                  className="w-full h-40 bg-transparent font-mono text-sm outline-none resize-none" 
                  value={sandboxCode} 
                  onChange={e => setSandboxCode(e.target.value)} 
                />
              </div>
              <button onClick={runSandbox} className="bg-blue-600 text-white px-4 py-2 rounded-lg mb-4">Run Code</button>
              <pre className="bg-gray-100 p-4 rounded-lg text-sm whitespace-pre-wrap">{sandboxOut}</pre>
            </div>
          )}
        </main>
      </div>

      {/* Delegation Panel */}
      {showDelegationPanel && (
        <div className="fixed inset-0 bg-black/30 z-50 flex justify-end">
          <div className="bg-white w-96 h-full shadow-2xl flex flex-col">
            <div className="p-6 border-b bg-gradient-to-r from-orange-500 to-red-500 text-white">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-bold">Delegation Queue</h3>
                  <p className="text-sm opacity-90">{delegationQueue.length} tasks ready for execution</p>
                </div>
                <button 
                  onClick={() => setShowDelegationPanel(false)}
                  className="text-white hover:bg-white/20 rounded-lg p-2 transition-colors"
                >
                  ×
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4">
              {delegationQueue.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  <div className="text-4xl mb-4">○</div>
                  <p>No tasks delegated yet.</p>
                  <p className="text-sm">Click "○ Delegate" on any task to add it here.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {delegationQueue.map((task, idx) => (
                    <div key={task.id} className="bg-gray-50 rounded-lg p-4 border">
                      <div className="flex items-start justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <div className="h-6 w-6 bg-orange-500 text-white rounded-full flex items-center justify-center text-xs font-bold">
                            {idx + 1}
                          </div>
                          <h4 className="font-semibold text-gray-800 text-sm">{task.title}</h4>
                        </div>
                        <button
                          onClick={() => removeDelegatedTask(task.id)}
                          className="text-gray-400 hover:text-red-500 transition-colors"
                        >
                          ×
                        </button>
                      </div>
                      <p className="text-xs text-gray-600 mb-2">{task.description}</p>
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-gray-500">{task.estimate || '—'}</span>
                        <span className="bg-orange-100 text-orange-700 px-2 py-1 rounded">
                          {task.id}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {delegationQueue.length > 0 && (
              <div className="p-4 border-t bg-gray-50">
                <button
                  onClick={executeDelegationQueue}
                  className="w-full bg-gradient-to-r from-orange-500 to-red-500 hover:from-orange-600 hover:to-red-600 text-white font-semibold py-3 px-6 rounded-lg transition-all"
                >
                  ○ Execute All Delegated Tasks ({delegationQueue.length})
                </button>
                <p className="text-xs text-gray-500 mt-2 text-center">
                  Tasks will be executed in order by AI agents
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Floating Delegation Button */}
      {delegationQueue.length > 0 && !showDelegationPanel && (
        <button
          onClick={() => setShowDelegationPanel(true)}
          className="fixed bottom-6 right-6 bg-gradient-to-r from-orange-500 to-red-500 text-white p-4 rounded-full shadow-lg hover:shadow-xl transition-all z-40"
        >
          <div className="flex items-center gap-2">
            <span className="text-lg">○</span>
            <span className="bg-white text-orange-600 rounded-full h-6 w-6 flex items-center justify-center text-sm font-bold">
              {delegationQueue.length}
            </span>
          </div>
        </button>
      )}
    </div>
  );
}