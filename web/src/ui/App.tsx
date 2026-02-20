import React, { useMemo, useState, useEffect } from 'react';
import KnowledgeGraphModal from '../components/KnowledgeGraphModal';

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

export default function App(): JSX.Element {
  const [goal, setGoal] = useState('Ship a task planning agent MVP');
  const [notes, setNotes] = useState('');
  const [context, setContext] = useState('{"repo":"midlayer-exp"}');
  const [freeform, setFreeform] = useState('');
  const [loading, setLoading] = useState(false);
  const [plan, setPlan] = useState<PlanResponse | null>(null);
  const [method, setMethod] = useState<'RICE' | 'ICE' | 'WSJF' | 'CD3' | 'CUSTOMER' | 'BUSINESS'>('CUSTOMER');
  const [prioritized, setPrioritized] = useState<Array<PlanTask & { score: number }>>([]);
  const [editingTask, setEditingTask] = useState<string | null>(null);
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
  const [reassignmentSuggestions, setReassignmentSuggestions] = useState<any[]>([]);
  const [livingSpec, setLivingSpec] = useState<any>(null);
  const [architecturalDecisions, setArchitecturalDecisions] = useState<any[]>([]);
  const [technologyStack, setTechnologyStack] = useState<any[]>([]);
  const [showKnowledgeGraphModal, setShowKnowledgeGraphModal] = useState(false);

  async function generatePlan(): Promise<void> {
    setLoading(true);
    try {
      const ctx = context ? JSON.parse(context) : {};
      const p = await api<PlanResponse>('/plan', freeform.trim() ? { freeform, goal, notes, context: ctx } : { goal, notes, context: ctx });
      setPlan(p);
      setPrioritized([]);
      
      // Auto-update knowledge graph when plan is generated
      setTimeout(() => {
        loadKnowledgeGraph();
      }, 1000); // Small delay to ensure backend has processed the plan
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

  async function runSandbox(): Promise<void> {
    const res = await api<{stdout:string;result?:string;error?:string}>('/sandbox/execute', { code: sandboxCode, timeout_ms: 2000 });
    setSandboxOut(JSON.stringify(res, null, 2));
  }

  async function genRfc(): Promise<void> {
    const res = await api<{draft:string}>('/rfc/draft', { context: notes || goal });
    setRfcText(res.draft);
  }

  async function loadGraph(): Promise<void> {
    const res = await api<{nodes:string[];edges:[string,string][]}>('/graph/dependencies', { path: 'app' });
    setGraphInfo({ nodes: res.nodes.length, edges: res.edges.length });
  }

  async function loadHotspots(): Promise<void> {
    const res = await api<Array<{file:string;lines:number;churn:number;score:number}>>('/hotspots', { path: 'app' });
    setHotspots(res);
  }

  async function runRunbook(): Promise<void> {
    const res = await api<{events:any[]}>('/runbook/execute', [
      { action: 'echo', args: { text: 'Kickoff' } },
      { action: 'http_get', args: { url: 'http://localhost:4000/health' } },
    ]);
    setRunbookEvents(res.events);
  }

  async function loadKnowledgeGraph(): Promise<void> {
    try {
      const [graphRes, statsRes, suggestionsRes] = await Promise.all([
        api<{nodes: any[], edges: any[]}>('/knowledge-graph/graph'),
        api<any>('/knowledge-graph/status'),
        api<{suggestions: any[]}>('/knowledge-graph/reassignment-suggestions')
      ]);
      
      setKnowledgeGraph(graphRes);
      setKnowledgeStats(statsRes);
      setReassignmentSuggestions(suggestionsRes.suggestions);
    } catch (error) {
      console.error('Failed to load knowledge graph:', error);
    }
  }

  // Removed agent assignment functionality - focusing on task dependencies and file tracking

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

  async function refreshLivingSpecs(): Promise<void> {
    try {
      await api<any>('/specs/refresh', {});
      await loadLivingSpecs(); // Reload fresh data
    } catch (error) {
      console.error('Failed to refresh living specs:', error);
    }
  }

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
      
      // Auto-update knowledge graph when task is executed
      setTimeout(() => {
        loadKnowledgeGraph();
      }, 1000);
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
    // Add to delegation queue if not already there
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
    // Clear the queue after execution
    setDelegationQueue([]);
  }

  function reorderDelegationQueue(fromIndex: number, toIndex: number): void {
    setDelegationQueue(prev => {
      const newQueue = [...prev];
      const [removed] = newQueue.splice(fromIndex, 1);
      newQueue.splice(toIndex, 0, removed);
      return newQueue;
    });
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
    <div className="min-h-screen bg-white text-slate-900">
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
        <aside className="w-64 bg-gray-50 border-r border-gray-200 min-h-screen flex flex-col">
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
        <aside className="w-60 bg-white border-r border-gray-200 min-h-screen sticky top-14 self-start">
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
        <main className="flex-1 max-w-4xl mx-auto px-12 py-8">
        {tab==='Plan' && (
        <div className="space-y-8">
          {/* Notion-like Freeform Prompting */}
          <section className="bg-white rounded-lg border shadow-sm">
            <div className="p-6 border-b">
              <h2 className="text-base font-medium">Prompt</h2>
              <p className="text-sm text-slate-500">Type like you would in Notion. Write intent, constraints, context.</p>
            </div>
            <div className="p-6">
              <div className="rounded-md border bg-white focus-within:border-slate-400">
                <textarea
                  className="w-full min-h-[200px] outline-none p-4 text-[15px] leading-7 placeholder-slate-400"
                  placeholder={"e.g. We need an authentication system. \n- Use FastAPI \n- JWT tokens \n- Store users in Postgres \n- Include password reset and email verification \n- Ship in 2 sprints with tests and deployment scripts."}
                  value={freeform}
                  onChange={e => setFreeform(e.target.value)}
                />
              </div>
              <div className="mt-3 flex items-center justify-between">
                <div className="text-xs text-slate-500">Tip: Paste product briefs, notes, or bullet points—AI infers structure.</div>
                <button
                  onClick={generatePlan}
                  disabled={loading}
                  className="px-4 py-2 rounded-md bg-slate-900 text-white text-sm flex items-center gap-2 disabled:bg-slate-400"
                >
                  {loading ? (<><span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"/> Generating...</>) : (<>Generate Plan</>)}
                </button>
              </div>
            </div>
          </section>
        </div>
        )}

        {tab==='Plan' && plan && (
          <section className="grid gap-8 xl:grid-cols-5">
            {/* Tasks Section - Takes 3/5 of the width */}
            <div className="xl:col-span-3 bg-white rounded-lg border shadow-sm p-6">
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                  <div className="h-8 w-8 bg-gradient-to-br from-emerald-500 to-teal-500 rounded-lg flex items-center justify-center">
                    <span className="text-white text-sm">○</span>
                  </div>
                  <h3 className="text-xl font-bold text-slate-800">Project Tasks</h3>
                </div>
                <div className="text-sm text-slate-500 bg-slate-100 px-3 py-1 rounded-full">
                  {plan.tasks.length} tasks generated
                </div>
              </div>
              
              <div className="space-y-4 max-h-[800px] overflow-y-auto pr-2">
                {plan.tasks.map((t, idx) => (
                  <div key={t.id} className={`group rounded-xl border-2 p-5 transition-all duration-200 hover:shadow-lg ${
                    criticalSet.has(t.id) 
                      ? 'border-amber-200 bg-gradient-to-r from-amber-50 to-orange-50 shadow-md' 
                      : 'border-slate-200 bg-white hover:border-slate-300'
                  }`}>
                    {/* Task Header */}
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex items-start gap-3 flex-1">
                        <div className={`h-8 w-8 rounded-lg flex items-center justify-center text-sm font-bold ${
                          criticalSet.has(t.id)
                            ? 'bg-amber-500 text-white'
                            : 'bg-slate-100 text-slate-600'
                        }`}>
                          {idx + 1}
                        </div>
                        <div className="flex-1">
                          <h4 className="font-semibold text-slate-800 group-hover:text-slate-900 mb-1">
                            {t.title}
                          </h4>
                          {t.description && (
                            <p className="text-sm text-slate-600 leading-relaxed mb-3">{t.description}</p>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {criticalSet.has(t.id) && (
                          <span className="text-xs bg-amber-500 text-white px-2 py-1 rounded-full font-medium">
                            Critical Path
                          </span>
                        )}
                        <span className="text-xs bg-slate-100 text-slate-600 px-2 py-1 rounded-full font-medium">
                          {t.estimate || '—'}
                        </span>
                        
                        {/* Delegate Button */}
                        <button
                          onClick={() => delegateTask(t)}
                          disabled={delegationQueue.find(dt => dt.id === t.id) !== undefined}
                          className={`text-xs px-3 py-1 rounded-full font-medium transition-all duration-200 mr-2 ${
                            delegationQueue.find(dt => dt.id === t.id)
                              ? 'bg-orange-500 text-white'
                              : 'bg-orange-400 hover:bg-orange-500 text-white hover:shadow-md'
                          }`}
                        >
                          {delegationQueue.find(dt => dt.id === t.id) ? '○ Queued' : '○ Delegate'}
                        </button>

                        {/* Execute Button */}
                        <button
                          onClick={() => executeTask(t.id, t.title, t.description || '')}
                          disabled={executingTasks.has(t.id)}
                          className={`text-xs px-3 py-1 rounded-full font-medium transition-all duration-200 ${
                            executedTasks.has(t.id)
                              ? executedTasks.get(t.id)?.status === 'success'
                                ? 'bg-green-500 text-white'
                                : 'bg-red-500 text-white'
                              : executingTasks.has(t.id)
                              ? 'bg-blue-300 text-white cursor-not-allowed'
                              : 'bg-blue-500 hover:bg-blue-600 text-white hover:shadow-md'
                          }`}
                        >
                          {executingTasks.has(t.id) ? (
                            <>
                              <div className="w-3 h-3 border border-white/30 border-t-white rounded-full animate-spin inline-block mr-1"></div>
                              Executing...
                            </>
                          ) : executedTasks.has(t.id) ? (
                            executedTasks.get(t.id)?.status === 'success' ? '✓ Done' : '✗ Failed'
                          ) : (
                            '○ Execute'
                          )}
                        </button>
                      </div>
                    </div>

                    {/* Dependencies */}
                    {t.dependencies && t.dependencies.length > 0 && (
                      <div className="mb-4">
                        <span className="text-xs font-medium text-slate-500">Depends on: </span>
                        <span className="text-xs text-slate-600">{t.dependencies.join(', ')}</span>
                      </div>
                    )}
                    
                    {/* Business Metrics */}
                    <div className="bg-slate-50 rounded-lg p-4">
                      <div className="flex items-center gap-2 mb-3">
                        <span className="text-sm font-semibold text-slate-700">Business Metrics</span>
                        <span className="text-xs bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full font-medium">
                          AI Generated
                        </span>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="text-xs font-medium text-slate-600 block mb-1">Reach (users)</label>
                          <input
                            type="number"
                            className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:border-blue-500 focus:ring-0"
                            value={t.reach || ''}
                            onChange={e => updateTaskMetric(t.id, 'reach', e.target.value)}
                            onBlur={autoUpdatePriority}
                          />
                        </div>
                        <div>
                          <label className="text-xs font-medium text-slate-600 block mb-1">Impact (1-5)</label>
                          <input
                            type="number"
                            step="0.1"
                            min="1"
                            max="5"
                            className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:border-blue-500 focus:ring-0"
                            value={t.impact || ''}
                            onChange={e => updateTaskMetric(t.id, 'impact', e.target.value)}
                            onBlur={autoUpdatePriority}
                          />
                        </div>
                        <div>
                          <label className="text-xs font-medium text-slate-600 block mb-1">Confidence (1-5)</label>
                          <input
                            type="number"
                            step="0.1"
                            min="1"
                            max="5"
                            className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:border-blue-500 focus:ring-0"
                            value={t.confidence || ''}
                            onChange={e => updateTaskMetric(t.id, 'confidence', e.target.value)}
                            onBlur={autoUpdatePriority}
                          />
                        </div>
                        <div>
                          <label className="text-xs font-medium text-slate-600 block mb-1">Effort (hours)</label>
                          <input
                            type="number"
                            className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:border-blue-500 focus:ring-0"
                            value={t.effort || ''}
                            onChange={e => updateTaskMetric(t.id, 'effort', e.target.value)}
                            onBlur={autoUpdatePriority}
                          />
                        </div>
                      </div>
                    </div>

                    {/* Execution Results */}
                    {executedTasks.has(t.id) && (
                      <div className="mt-4 p-4 bg-slate-50 rounded-lg border-l-4 border-blue-500">
                        <div className="flex items-center gap-2 mb-2">
                          <span className="text-sm font-semibold text-slate-700">Execution Result</span>
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                            executedTasks.get(t.id)?.status === 'success' 
                              ? 'bg-green-100 text-green-700' 
                              : 'bg-red-100 text-red-700'
                          }`}>
                            {executedTasks.get(t.id)?.status}
                          </span>
                        </div>
                        
                        {executedTasks.get(t.id)?.files_created?.length > 0 && (
                          <div className="mb-2">
                            <span className="text-xs font-medium text-slate-600">Files Created:</span>
                            <ul className="text-xs text-slate-600 ml-2">
                              {executedTasks.get(t.id)?.files_created.map((file: string, idx: number) => (
                                <li key={idx} className="font-mono">○ {file}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                        
                        {executedTasks.get(t.id)?.error && (
                          <div className="text-xs text-red-600 bg-red-50 p-2 rounded">
                            <strong>Error:</strong> {executedTasks.get(t.id)?.error}
                          </div>
                        )}
                        
                        {executedTasks.get(t.id)?.code_generated && (
                          <details className="mt-2">
                            <summary className="text-xs font-medium text-slate-600 cursor-pointer hover:text-slate-800">
                              View Generated Code
                            </summary>
                            <pre className="text-xs bg-slate-900 text-green-400 p-3 rounded mt-2 overflow-x-auto">
                              {executedTasks.get(t.id)?.code_generated}
                            </pre>
                          </details>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Prioritization Section - Takes 2/5 of the width */}
            <div className="xl:col-span-2 bg-white rounded-lg border shadow-sm p-6">
              <div className="flex items-center gap-3 mb-6">
                <div className="h-8 w-8 bg-gradient-to-br from-purple-500 to-pink-500 rounded-lg flex items-center justify-center">
                  <span className="text-white text-sm">○</span>
                </div>
                <h3 className="text-xl font-bold text-slate-800">Priority Ranking</h3>
              </div>
              
              <div className="space-y-4">
                {/* Method Selection */}
                <div>
                  <label className="text-sm font-semibold text-slate-700 block mb-2">Prioritization Method</label>
                  <select 
                    className="w-full border-2 border-slate-200 rounded-xl px-4 py-3 focus:border-purple-500 focus:ring-0" 
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

                {/* Method explanation */}
                <div className="p-4 bg-slate-50 rounded-xl">
                  <div className="text-sm font-medium text-slate-700 mb-1">How {method} Works:</div>
                  <div className="text-sm text-slate-600">
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
                  className="w-full bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 text-white font-semibold px-6 py-3 rounded-xl shadow-lg hover:shadow-xl transition-all duration-200"
                >
                  ○ Compute Priority Scores
                </button>

                {prioritized.length > 0 && (
                  <div>
                    <div className="flex items-center justify-between mb-4">
                      <h4 className="text-sm font-bold text-slate-800">Priority Ranking</h4>
                      <span className="text-xs bg-purple-100 text-purple-700 px-2 py-1 rounded-full">
                        Sorted by {method}
                      </span>
                    </div>
                    
                    <div className="space-y-3 max-h-[600px] overflow-y-auto">
                      {prioritized.map((t, idx) => (
                        <div key={t.id} className={`rounded-xl border-2 p-4 transition-all duration-200 ${
                          idx < 3 
                            ? 'border-emerald-200 bg-gradient-to-r from-emerald-50 to-green-50 shadow-md' 
                            : 'border-slate-200 bg-white'
                        }`}>
                          <div className="flex items-start justify-between">
                            <div className="flex-1">
                              <div className="flex items-center gap-2 mb-2">
                                <div className={`h-6 w-6 rounded-full flex items-center justify-center text-xs font-bold ${
                                  idx < 3 
                                    ? 'bg-emerald-500 text-white' 
                                    : 'bg-slate-300 text-slate-600'
                                }`}>
                                  {idx + 1}
                                </div>
                                <div className="font-semibold text-slate-800 text-sm">{t.title}</div>
                              </div>
                              <div className="text-xs text-slate-500 space-y-1">
                                {(method === 'CUSTOMER' || method === 'BUSINESS') && (
                                  <>
                                    {(t as any).customerImpactScore && <div>○ Customer Impact: {(t as any).customerImpactScore}/10</div>}
                                    {(t as any).revenueImpact && <div>$ Revenue: ${(t as any).revenueImpact}K</div>}
                                    {(t as any).retentionImpact && <div>↗ Retention: +{(t as any).retentionImpact}%</div>}
                                    {(t as any).satisfactionImpact && <div>☺ Satisfaction: +{(t as any).satisfactionImpact} pts</div>}
                                    {(t as any).successMetrics && (
                                      <div>○ KPIs: {(t as any).successMetrics.slice(0, 2).join(', ')}</div>
                                    )}
                                  </>
                                )}
                                {(method === 'RICE' || method === 'ICE' || method === 'WSJF' || method === 'CD3') && t.reach && t.impact && t.confidence && t.effort && (
                                  <>
                                    <div>○ {t.reach} users</div>
                                    <div>○ Impact: {t.impact}/5</div>
                                    <div>○ Confidence: {t.confidence}/5</div>
                                    <div>○ {t.effort}h effort</div>
                                  </>
                                )}
                              </div>
                            </div>
                            <div className="text-right ml-3">
                              <div className="text-lg font-bold text-slate-900">{t.score.toFixed(1)}</div>
                              <div className="text-xs text-slate-500">{method} score</div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                    
                    <div className="mt-4 p-3 bg-blue-50 rounded-xl">
                      <div className="text-sm font-medium text-blue-800 mb-1">○ Priority Insights</div>
                      <div className="text-xs text-blue-700">
                        Top 3 tasks (highlighted in green) should be tackled first for maximum impact.
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </section>
        )}

        {tab==='Sandbox' && (
          <section className="bg-white rounded-xl shadow-sm border p-6">
            <h3 className="font-semibold mb-4">Live Code Block (Python)</h3>
            <textarea className="w-full h-40 border rounded-md font-mono p-2" value={sandboxCode} onChange={e=>setSandboxCode(e.target.value)} />
            <div className="mt-3"><button onClick={runSandbox} className="rounded-md bg-slate-900 text-white px-3 py-2">Run</button></div>
            <pre className="mt-3 bg-slate-100 p-3 rounded-md text-sm whitespace-pre-wrap">{sandboxOut}</pre>
          </section>
        )}

        {tab==='RFC' && (
          <section className="bg-white rounded-xl shadow-sm border p-6">
            <h3 className="font-semibold mb-4">RFC Draft</h3>
            <div className="flex gap-2 mb-3"><button onClick={genRfc} className="rounded-md bg-brand-600 text-white px-3 py-2">Generate from Notes</button></div>
            <pre className="bg-slate-50 p-4 rounded-md whitespace-pre-wrap">{rfcText}</pre>
          </section>
        )}

        {tab==='Graph' && (
          <section className="bg-white rounded-xl shadow-sm border p-6">
            <h3 className="font-semibold mb-4">Dependency Graph (Python imports)</h3>
            <div className="flex gap-2 mb-3"><button onClick={loadGraph} className="rounded-md bg-slate-900 text-white px-3 py-2">Analyze</button></div>
            {graphInfo && <div className="text-sm text-slate-600">Nodes: {graphInfo.nodes}, Edges: {graphInfo.edges}</div>}
          </section>
        )}

        {tab==='Hotspots' && (
          <section className="bg-white rounded-xl shadow-sm border p-6">
            <h3 className="font-semibold mb-4">Hotspots</h3>
            <div className="flex gap-2 mb-3"><button onClick={loadHotspots} className="rounded-md bg-slate-900 text-white px-3 py-2">Scan</button></div>
            <ul className="space-y-2">
              {hotspots.map(h => (
                <li key={h.file} className="text-sm flex justify-between border rounded-md p-2"><span>{h.file}</span><span className="text-slate-500">lines {h.lines} · churn {h.churn}</span></li>
              ))}
            </ul>
          </section>
        )}

        {tab==='Runbook' && (
          <section className="bg-white rounded-xl shadow-sm border p-6">
            <h3 className="font-semibold mb-4">Runbook Demo</h3>
            <div className="flex gap-2 mb-3"><button onClick={runRunbook} className="rounded-md bg-slate-900 text-white px-3 py-2">Run Sample</button></div>
            <pre className="bg-slate-50 p-4 rounded-md whitespace-pre-wrap text-sm">{JSON.stringify(runbookEvents, null, 2)}</pre>
          </section>
        )}

        {tab==='Knowledge' && (
          <div className="space-y-8">
            {/* Project Overview */}
            <section className="bg-white rounded-lg border shadow-sm p-6">
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                  <div className="h-8 w-8 bg-gradient-to-br from-blue-500 to-cyan-500 rounded-lg flex items-center justify-center">
                    <span className="text-white text-sm">○</span>
                  </div>
                  <h2 className="text-xl font-bold text-slate-800">Project Overview</h2>
                </div>
                <button 
                  onClick={loadKnowledgeGraph}
                  className="px-4 py-2 rounded-md bg-blue-500 text-white text-sm hover:bg-blue-600 transition-colors"
                >
                  Refresh
                </button>
              </div>
              
              {knowledgeStats && (
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  <div className="bg-gradient-to-br from-blue-50 to-blue-100 rounded-xl p-4 text-center">
                    <div className="text-2xl font-bold text-blue-600">{knowledgeStats.task_nodes}</div>
                    <div className="text-sm text-blue-600 font-medium">Tasks</div>
                  </div>
                  <div className="bg-gradient-to-br from-green-50 to-green-100 rounded-xl p-4 text-center">
                    <div className="text-2xl font-bold text-green-600">{knowledgeStats.file_nodes}</div>
                    <div className="text-sm text-green-600 font-medium">Generated Files</div>
                  </div>
                  <div className="bg-gradient-to-br from-purple-50 to-purple-100 rounded-xl p-4 text-center">
                    <div className="text-2xl font-bold text-purple-600">{knowledgeStats.edges}</div>
                    <div className="text-sm text-purple-600 font-medium">Dependencies</div>
                  </div>
                </div>
              )}
            </section>

            {/* Task Dependencies & Files */}
            <div className="grid gap-8 xl:grid-cols-2">
              {/* Task Dependencies */}
              <section className="bg-white rounded-lg border shadow-sm p-6">
                <div className="flex items-center gap-3 mb-6">
                  <div className="h-8 w-8 bg-gradient-to-br from-blue-500 to-cyan-500 rounded-lg flex items-center justify-center">
                    <span className="text-white text-sm">○</span>
                  </div>
                  <h3 className="text-xl font-bold text-slate-800">Task Dependencies</h3>
                </div>
                
                {knowledgeGraph && knowledgeGraph.nodes ? (
                  <div className="bg-slate-50 rounded-xl p-6 min-h-[400px]">
                    <div className="text-center text-slate-600 mb-4">
                      <div className="text-lg font-semibold">Task Network</div>
                      <div className="text-sm">{knowledgeGraph.nodes.filter(n => n.type === 'task').length} tasks, {knowledgeGraph.edges.length} dependencies</div>
                    </div>
                    
                    {/* Task list with status */}
                    <div className="grid grid-cols-1 gap-2 max-h-80 overflow-y-auto">
                      {knowledgeGraph.nodes.filter(node => node.type === 'task').map((node) => (
                        <div key={node.id} className="flex items-center justify-between p-3 rounded-lg border bg-blue-50 border-blue-200">
                          <div className="flex items-center gap-3">
                            <div className={`h-3 w-3 rounded-full ${
                              node.metadata?.status === 'completed' ? 'bg-green-500' : 
                              node.metadata?.status === 'in_progress' ? 'bg-yellow-500' : 'bg-gray-400'
                            }`}></div>
                            <div>
                              <div className="font-medium text-sm">{node.name || node.id}</div>
                              <div className="text-xs text-slate-500">{node.metadata?.title || 'Task'}</div>
                            </div>
                          </div>
                          <div className="text-xs text-slate-400">
                            {node.metadata?.status || 'pending'}
                          </div>
                        </div>
                      ))}
                    </div>
                    
                    {knowledgeGraph.nodes.filter(n => n.type === 'task').length === 0 && (
                      <div className="text-center text-slate-500">
                        <div className="text-4xl mb-4">○</div>
                        <p>No tasks yet.</p>
                        <p className="text-sm">Generate a plan to see task dependencies.</p>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="bg-slate-50 rounded-xl p-6 min-h-[400px] flex items-center justify-center">
                    <div className="text-center text-slate-500">
                      <div className="text-4xl mb-4">○</div>
                      <p>Loading task data...</p>
                    </div>
                  </div>
                )}
              </section>

              {/* Generated Files */}
              <section className="bg-white rounded-lg border shadow-sm p-6">
                <div className="flex items-center gap-3 mb-6">
                  <div className="h-8 w-8 bg-gradient-to-br from-green-500 to-emerald-500 rounded-lg flex items-center justify-center">
                    <span className="text-white text-sm">○</span>
                  </div>
                  <h3 className="text-xl font-bold text-slate-800">Generated Files</h3>
                </div>
                
                {knowledgeGraph && knowledgeGraph.nodes ? (
                  <div className="bg-slate-50 rounded-xl p-6 min-h-[400px]">
                    <div className="text-center text-slate-600 mb-4">
                      <div className="text-lg font-semibold">Code Files</div>
                      <div className="text-sm">{knowledgeGraph.nodes.filter(n => n.type === 'file').length} files created</div>
                    </div>
                    
                    {/* File list */}
                    <div className="grid grid-cols-1 gap-2 max-h-80 overflow-y-auto">
                      {knowledgeGraph.nodes.filter(node => node.type === 'file').map((node) => (
                        <div key={node.id} className="flex items-center justify-between p-3 rounded-lg border bg-green-50 border-green-200">
                          <div className="flex items-center gap-3">
                            <div className="h-3 w-3 rounded-full bg-green-500"></div>
                            <div>
                              <div className="font-medium text-sm">{node.name || node.id}</div>
                              <div className="text-xs text-slate-500">{node.metadata?.path || 'Generated file'}</div>
                            </div>
                          </div>
                          <div className="text-xs text-slate-400">
                            {node.metadata?.type || 'file'}
                          </div>
                        </div>
                      ))}
                    </div>
                    
                    {knowledgeGraph.nodes.filter(n => n.type === 'file').length === 0 && (
                      <div className="text-center text-slate-500">
                        <div className="text-4xl mb-4">○</div>
                        <p>No files generated yet.</p>
                        <p className="text-sm">Execute tasks to generate code files.</p>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="bg-slate-50 rounded-xl p-6 min-h-[400px] flex items-center justify-center">
                    <div className="text-center text-slate-500">
                      <div className="text-4xl mb-4">○</div>
                      <p>Loading file data...</p>
                    </div>
                  </div>
                )}
              </section>
            </div>

            {/* How it works */}
            <section className="bg-gradient-to-r from-indigo-50 to-purple-50 border border-indigo-200 rounded-lg p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="h-8 w-8 bg-gradient-to-br from-indigo-500 to-purple-500 rounded-lg flex items-center justify-center">
                  <span className="text-white text-sm">○</span>
                </div>
                <h3 className="text-xl font-bold text-slate-800">How It Works</h3>
              </div>
              <div className="grid md:grid-cols-2 gap-6">
                <div>
                  <h4 className="font-semibold text-slate-700 mb-2">○ Task Tracking:</h4>
                  <ul className="text-sm text-slate-600 space-y-1">
                    <li>• Track task dependencies and completion status</li>
                    <li>• Visualize which tasks block others</li>
                    <li>• Monitor project progress in real-time</li>
                    <li>• Identify critical path and bottlenecks</li>
                  </ul>
                </div>
                <div>
                  <h4 className="font-semibold text-slate-700 mb-2">○ File Management:</h4>
                  <ul className="text-sm text-slate-600 space-y-1">
                    <li>• Keep track of all generated code files</li>
                    <li>• Link files back to the tasks that created them</li>
                    <li>• Monitor codebase growth and organization</li>
                    <li>• View architectural evolution over time</li>
                  </ul>
                </div>
              </div>
            </section>
          </div>
        )}

        {tab==='Specs' && (
          <div className="space-y-8">
            {/* Living Specs Header */}
            <section className="bg-white rounded-lg border shadow-sm p-6">
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 bg-gradient-to-br from-emerald-500 to-teal-600 rounded-xl flex items-center justify-center">
                    <span className="text-white text-lg">○</span>
                  </div>
                  <div>
                    <h2 className="text-2xl font-bold text-slate-800">Living Technical Specifications</h2>
                    <p className="text-slate-600">Auto-generated specs that evolve with your codebase</p>
                  </div>
                </div>
                <div className="flex gap-3">
                  <button 
                    onClick={loadLivingSpecs} 
                    className="bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white font-semibold px-6 py-3 rounded-xl shadow-lg hover:shadow-xl transition-all duration-200"
                  >
                    ○ Load Specs
                  </button>
                  <button 
                    onClick={refreshLivingSpecs} 
                    className="bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-semibold px-6 py-3 rounded-xl shadow-lg hover:shadow-xl transition-all duration-200"
                  >
                    ○ Refresh
                  </button>
                </div>
              </div>

              {/* Overview Stats */}
              {livingSpec && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
                  <div className="bg-gradient-to-br from-emerald-50 to-teal-100 rounded-xl p-4 text-center">
                    <div className="text-2xl font-bold text-emerald-600">{livingSpec.overview.tasks_completed}</div>
                    <div className="text-sm text-emerald-600 font-medium">Tasks Completed</div>
                  </div>
                  <div className="bg-gradient-to-br from-blue-50 to-blue-100 rounded-xl p-4 text-center">
                    <div className="text-2xl font-bold text-blue-600">{livingSpec.overview.files_created}</div>
                    <div className="text-sm text-blue-600 font-medium">Files Created</div>
                  </div>
                  <div className="bg-gradient-to-br from-purple-50 to-purple-100 rounded-xl p-4 text-center">
                    <div className="text-2xl font-bold text-purple-600">{livingSpec.overview.technologies_used.length}</div>
                    <div className="text-sm text-purple-600 font-medium">Technologies</div>
                  </div>
                  <div className="bg-gradient-to-br from-orange-50 to-orange-100 rounded-xl p-4 text-center">
                    <div className="text-2xl font-bold text-orange-600">{livingSpec.overview.api_endpoints.length}</div>
                    <div className="text-sm text-orange-600 font-medium">API Endpoints</div>
                  </div>
                </div>
              )}
            </section>

            {/* Spec Content */}
            <div className="grid gap-8 xl:grid-cols-2">
              {/* Architectural Decisions */}
              <section className="bg-white rounded-lg border shadow-sm p-6">
                <div className="flex items-center gap-3 mb-6">
                  <div className="h-8 w-8 bg-gradient-to-br from-amber-500 to-orange-500 rounded-lg flex items-center justify-center">
                    <span className="text-white text-sm">○</span>
                  </div>
                  <h3 className="text-xl font-bold text-slate-800">Architectural Decisions</h3>
                </div>
                
                {architecturalDecisions.length > 0 ? (
                  <div className="space-y-4">
                    {architecturalDecisions.map((decision, idx) => (
                      <div key={idx} className="bg-gradient-to-r from-amber-50 to-orange-50 border border-amber-200 rounded-xl p-4">
                        <div className="flex items-center justify-between mb-2">
                          <h4 className="font-semibold text-slate-800">{decision.decision}</h4>
                          <span className="text-xs bg-amber-500 text-white px-2 py-1 rounded-full">
                            {Math.round(decision.detection_confidence * 100)}% confidence
                          </span>
                        </div>
                        <p className="text-sm text-slate-600 mb-2">{decision.reasoning}</p>
                        <div className="text-xs text-slate-500">
                          <strong>Trade-offs:</strong> {decision.trade_offs}
                        </div>
                        <div className="text-xs text-slate-400 mt-2">
                          Detected in: <code className="bg-slate-100 px-1 rounded">{decision.detected_in_file}</code>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="bg-slate-50 rounded-xl p-6 min-h-[300px] flex items-center justify-center">
                    <div className="text-center text-slate-500">
                      <div className="text-4xl mb-4">○</div>
                      <p>No architectural decisions detected yet.</p>
                      <p className="text-sm">Execute some tasks to see AI-detected decisions.</p>
                    </div>
                  </div>
                )}
              </section>

              {/* Technology Stack */}
              <section className="bg-white rounded-lg border shadow-sm p-6">
                <div className="flex items-center gap-3 mb-6">
                  <div className="h-8 w-8 bg-gradient-to-br from-blue-500 to-cyan-500 rounded-lg flex items-center justify-center">
                    <span className="text-white text-sm">○</span>
                  </div>
                  <h3 className="text-xl font-bold text-slate-800">Technology Stack</h3>
                </div>
                
                {technologyStack.length > 0 ? (
                  <div className="space-y-3">
                    {technologyStack.map((tech, idx) => (
                      <div key={idx} className="bg-gradient-to-r from-blue-50 to-cyan-50 border border-blue-200 rounded-xl p-4">
                        <div className="flex items-center justify-between mb-2">
                          <h4 className="font-semibold text-slate-800">{tech.name}</h4>
                          <span className="text-xs bg-blue-500 text-white px-2 py-1 rounded-full">
                            {tech.usage_count} files
                          </span>
                        </div>
                        <div className="text-xs text-slate-500">
                          <strong>Used in:</strong> {tech.files.slice(0, 3).join(', ')}
                          {tech.files.length > 3 && ` +${tech.files.length - 3} more`}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="bg-slate-50 rounded-xl p-6 min-h-[300px] flex items-center justify-center">
                    <div className="text-center text-slate-500">
                      <div className="text-4xl mb-4">○</div>
                      <p>No technologies detected yet.</p>
                      <p className="text-sm">Execute some tasks to see the tech stack.</p>
                    </div>
                  </div>
                )}
              </section>
            </div>

            {/* API Endpoints & Implementation Details */}
            {livingSpec && livingSpec.overview.api_endpoints.length > 0 && (
              <section className="bg-white rounded-lg border shadow-sm p-6">
                <div className="flex items-center gap-3 mb-6">
                  <div className="h-8 w-8 bg-gradient-to-br from-green-500 to-emerald-500 rounded-lg flex items-center justify-center">
                    <span className="text-white text-sm">○</span>
                  </div>
                  <h3 className="text-xl font-bold text-slate-800">API Endpoints Discovered</h3>
                </div>
                
                <div className="grid gap-2">
                  {livingSpec.overview.api_endpoints.map((endpoint: string, idx: number) => (
                    <div key={idx} className="bg-slate-50 rounded-lg p-3 font-mono text-sm">
                      <span className={`inline-block px-2 py-1 rounded text-xs font-bold mr-3 ${
                        endpoint.startsWith('GET') ? 'bg-green-100 text-green-700' :
                        endpoint.startsWith('POST') ? 'bg-blue-100 text-blue-700' :
                        endpoint.startsWith('PUT') ? 'bg-orange-100 text-orange-700' :
                        endpoint.startsWith('DELETE') ? 'bg-red-100 text-red-700' :
                        'bg-gray-100 text-gray-700'
                      }`}>
                        {endpoint.split(' ')[0]}
                      </span>
                      <span className="text-slate-700">{endpoint.split(' ').slice(1).join(' ')}</span>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Gap Analysis */}
            {livingSpec && livingSpec.gaps.length > 0 && (
              <section className="bg-gradient-to-r from-red-50 to-pink-50 border border-red-200 rounded-2xl p-6">
                <div className="flex items-center gap-3 mb-4">
                  <div className="h-8 w-8 bg-gradient-to-br from-red-500 to-pink-500 rounded-lg flex items-center justify-center">
                    <span className="text-white text-sm">!</span>
                  </div>
                  <h3 className="text-xl font-bold text-slate-800">Implementation Gaps</h3>
                </div>
                
                <div className="space-y-3">
                  {livingSpec.gaps.map((gap: any, idx: number) => (
                    <div key={idx} className="bg-white rounded-lg p-3 border border-red-100">
                      <div className="font-medium text-slate-800">{gap.type}</div>
                      <div className="text-sm text-slate-600">{gap.description}</div>
                      <div className="text-xs text-slate-400 mt-1">Task ID: {gap.task_id}</div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Revolutionary Features Info */}
            <section className="bg-gradient-to-r from-emerald-50 to-teal-50 border border-emerald-200 rounded-2xl p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="h-8 w-8 bg-gradient-to-br from-emerald-500 to-teal-500 rounded-lg flex items-center justify-center">
                  <span className="text-white text-sm">*</span>
                </div>
                <h3 className="text-xl font-bold text-slate-800">Revolutionary Features</h3>
              </div>
              <div className="grid md:grid-cols-2 gap-6">
                <div>
                  <h4 className="font-semibold text-slate-700 mb-2">○ Self-Updating Specs:</h4>
                  <ul className="text-sm text-slate-600 space-y-1">
                    <li>• Specs automatically update as code is executed</li>
                    <li>• Architectural decisions detected from implementations</li>
                    <li>• Technology stack discovered from import analysis</li>
                    <li>• API endpoints extracted from route definitions</li>
                  </ul>
                </div>
                <div>
                  <h4 className="font-semibold text-slate-700 mb-2">○ Benefits:</h4>
                  <ul className="text-sm text-slate-600 space-y-1">
                    <li>• Specifications never get outdated</li>
                    <li>• Documents what was actually built, not planned</li>
                    <li>• Tracks architectural evolution over time</li>
                    <li>• Provides gap analysis between plan and reality</li>
                  </ul>
                </div>
              </div>
            </section>
          </div>
        )}
      </main>

      {/* Delegation Panel */}
      {showDelegationPanel && (
        <div className="fixed inset-0 bg-black/30 z-50 flex justify-end">
          <div className="bg-white w-96 h-full shadow-2xl flex flex-col">
            <div className="p-6 border-b bg-gradient-to-r from-orange-500 to-red-500 text-white">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-bold">Delegation Queue</h3>
                  <p className="text-sm opacity-90">{delegationQueue.length} tasks ready for agents</p>
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
                <div className="text-center py-8 text-slate-500">
                  <div className="text-4xl mb-4">○</div>
                  <p>No tasks delegated yet.</p>
                  <p className="text-sm">Click "○ Delegate" on any task to add it here.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {delegationQueue.map((task, idx) => (
                    <div key={task.id} className="bg-slate-50 rounded-lg p-4 border">
                      <div className="flex items-start justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <div className="h-6 w-6 bg-orange-500 text-white rounded-full flex items-center justify-center text-xs font-bold">
                            {idx + 1}
                          </div>
                          <h4 className="font-semibold text-slate-800 text-sm">{task.title}</h4>
                        </div>
                        <button
                          onClick={() => removeDelegatedTask(task.id)}
                          className="text-slate-400 hover:text-red-500 transition-colors"
                        >
                          ×
                        </button>
                      </div>
                      <p className="text-xs text-slate-600 mb-2">{task.description}</p>
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-slate-500">{task.estimate || '—'}</span>
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
              <div className="p-4 border-t bg-slate-50">
                <button
                  onClick={executeDelegationQueue}
                  className="w-full bg-gradient-to-r from-orange-500 to-red-500 hover:from-orange-600 hover:to-red-600 text-white font-semibold py-3 px-6 rounded-xl shadow-lg hover:shadow-xl transition-all duration-200"
                >
                  ○ Execute All Delegated Tasks ({delegationQueue.length})
                </button>
                <p className="text-xs text-slate-500 mt-2 text-center">
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
          className="fixed bottom-6 right-6 bg-gradient-to-r from-orange-500 to-red-500 text-white p-4 rounded-full shadow-lg hover:shadow-xl transition-all duration-200 z-40"
        >
          <div className="flex items-center gap-2">
            <span className="text-lg">○</span>
            <span className="bg-white text-orange-600 rounded-full h-6 w-6 flex items-center justify-center text-sm font-bold">
              {delegationQueue.length}
            </span>
          </div>
        </button>
      )}

      <footer className="bg-white border-t border-slate-200 mt-16">
        <div className="max-w-7xl mx-auto px-6 py-8">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="h-8 w-8 bg-gradient-to-br from-blue-600 to-indigo-600 rounded-lg flex items-center justify-center text-white text-sm font-bold">
                MP
              </div>
              <div>
                <div className="font-semibold text-slate-800">MidLayer Planner</div>
                <div className="text-sm text-slate-500">AI-Powered Product Planning</div>
              </div>
            </div>
            <div className="text-sm text-slate-500">
              Made with ♡ for product teams
            </div>
          </div>
        </div>
      </footer>

      {/* Floating Knowledge Graph Button */}
      <button
        onClick={() => {
          if (!knowledgeGraph) {
            loadKnowledgeGraph();
          }
          setShowKnowledgeGraphModal(true);
        }}
        className="fixed bottom-6 right-6 w-14 h-14 bg-gradient-to-br from-purple-600 to-indigo-600 text-white rounded-full shadow-lg hover:shadow-xl transition-all duration-200 flex items-center justify-center text-xl hover:scale-105"
        title="View Knowledge Graph"
      >
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" className="w-6 h-6" fill="currentColor">
          <path d="m25.24,28l13,13-13,13-4.24-4.24,5.76-5.76h0s-7.76,0-7.76,0c-8.5,0-14-5.5-14-14s5.5-14,14-14h9v6h-9c-5.16,0-8,2.84-8,8s2.84,8,8,8h7.76l-5.76-5.76,4.24-4.24Zm24.76-18h-18v18h18V10Zm-10,22v18h18v-18h-18Z"/>
        </svg>
      </button>

      {/* Knowledge Graph Modal */}
      <KnowledgeGraphModal
        isOpen={showKnowledgeGraphModal}
        onClose={() => setShowKnowledgeGraphModal(false)}
        graphData={knowledgeGraph}
        onRefresh={loadKnowledgeGraph}
      />
        </div>
      </div>
  );
}

