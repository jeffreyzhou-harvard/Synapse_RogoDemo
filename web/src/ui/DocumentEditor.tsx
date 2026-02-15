import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import AIChatSidebar, { ChatMessage } from './AIChatSidebar';
import CitationsPanel, { EvidenceResult, Citation, CitationFormat } from './CitationsPanel';
import TranscriptionPanel, { TranscriptionResult, Claim } from './TranscriptionPanel';
import ClaimTracker from './ClaimTracker';
import ArgumentMap from './ArgumentMap';
import MentionEditor from './MentionEditor';
import SelectionToolbar, { SelectionAction } from './SelectionToolbar';
import SourcePanel, { SourceMaterial } from './SourcePanel';
import DocumentService, { Document } from '../services/documentService';
import { parseSections, findSectionAt, getTargetWords } from './sectionUtils';
import { analyzeWritingQuality, QualityMetrics } from './writingQuality';
import { Document as DocxDocument, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType } from 'docx';
import { saveAs } from 'file-saver';

// Agent metadata
const AGENT_META: Record<string, { label: string; icon: string; color: string; verb: string }> = {
  evidence:  { label: 'Find Evidence', icon: '🔍', color: '#4299e1', verb: 'Find evidence for' },
  challenge: { label: 'Challenge',     icon: '⚔️',  color: '#e53e3e', verb: 'Challenge' },
  eli5:      { label: 'Simplify',      icon: '💡', color: '#ecc94b', verb: 'Simplify' },
  steelman:  { label: 'Steelman',      icon: '🛡️',  color: '#48bb78', verb: 'Steelman' },
  socratic:  { label: 'Ask Me',        icon: '🤔', color: '#9f7aea', verb: 'Ask Socratic questions about' },
  connect:   { label: 'Connect',       icon: '🔗', color: '#ed8936', verb: 'Connect' },
  chat:      { label: 'Synapse',       icon: '🧠', color: '#4a5568', verb: 'Thinking about' },
};

function formatDurationShort(seconds?: number): string {
  if (!seconds) return '';
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

const DocumentEditor: React.FC = () => {
  const navigate = useNavigate();
  const { id } = useParams<{ id?: string }>();
  const [searchParams] = useSearchParams();
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [isTitleFocused, setIsTitleFocused] = useState(false);
  const [isContentFocused, setIsContentFocused] = useState(false);
  const [currentDocument, setCurrentDocument] = useState<Document | null>(null);
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'unsaved' | 'published' | 'error'>('saved');
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [selectedText, setSelectedText] = useState('');
  // Chat state
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [isChatLoading, setIsChatLoading] = useState(false);
  // Citations panel state
  const [isCitationsOpen, setIsCitationsOpen] = useState(false);
  const [citationResults, setCitationResults] = useState<EvidenceResult[]>([]);
  const [isCitationsLoading, setIsCitationsLoading] = useState(false);
  const [citationsLoadingText, setCitationsLoadingText] = useState('');
  // Footnotes for inline source linking [N]
  const [footnotes, setFootnotes] = useState<string[]>([]);
  // Claim tracker
  const [isClaimTrackerOpen, setIsClaimTrackerOpen] = useState(false);
  // Argument map
  const [isArgumentMapOpen, setIsArgumentMapOpen] = useState(false);
  // Writing quality panel
  const [isQualityOpen, setIsQualityOpen] = useState(false);
  // Transcription state
  const [isTranscriptionOpen, setIsTranscriptionOpen] = useState(false);
  const [transcriptionResults, setTranscriptionResults] = useState<TranscriptionResult[]>([]);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [transcribeLoadingText, setTranscribeLoadingText] = useState('');
  const [isDragOver, setIsDragOver] = useState(false);
  // Selection toolbar position
  const [toolbarPosition, setToolbarPosition] = useState<{ top: number; left: number } | null>(null);
  // "Connect the Dots"
  const [pinnedSelection, setPinnedSelection] = useState<string | null>(null);
  // Split-view state
  const [isSplitView, setIsSplitView] = useState(searchParams.get('split') === 'true');
  const [sourceMaterials, setSourceMaterials] = useState<SourceMaterial[]>([]);
  const [sourceSelection, setSourceSelection] = useState<{ text: string; sourceTitle: string }>({ text: '', sourceTitle: '' });
  const [isSourcePDFLoading, setIsSourcePDFLoading] = useState(false);
  const [isSourceTranscriptLoading, setIsSourceTranscriptLoading] = useState(false);
  const [sourceLoadingText, setSourceLoadingText] = useState('');
  const [showSplitOnboarding, setShowSplitOnboarding] = useState(false);
  // Vector store & semantic search state
  const [vectorWorkspaceId] = useState(() => 'ws_' + Date.now().toString(36));
  const [semanticMatches, setSemanticMatches] = useState<{ text: string; source_title: string; source_type: string; similarity: number; rank: number }[]>([]);
  const [vectorStats, setVectorStats] = useState<{ total_chunks: number; embedded_chunks: number; embedding_provider: string } | null>(null);
  const [isSemanticSearching, setIsSemanticSearching] = useState(false);
  const [showSemanticDrawer, setShowSemanticDrawer] = useState(false);
  const semanticTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSearchContent = useRef('');
  // Deep Dive state
  const [deepDiveResult, setDeepDiveResult] = useState<any>(null);
  const [isDeepDiving, setIsDeepDiving] = useState(false);
  const [deepDiveQuery, setDeepDiveQuery] = useState('');
  const [deepDiveNextSteps, setDeepDiveNextSteps] = useState<{ action: string; query: string; rationale: string; priority: string; icon: string }[]>([]);
  const [isLoadingNextSteps, setIsLoadingNextSteps] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);
  const editorAreaRef = useRef<HTMLDivElement>(null);

  // ── Show onboarding tooltip when split view first opens ──────────
  useEffect(() => {
    if (isSplitView && sourceMaterials.length === 0) {
      const hasSeenOnboarding = sessionStorage.getItem('synapse-split-onboarding');
      if (!hasSeenOnboarding) {
        setShowSplitOnboarding(true);
        sessionStorage.setItem('synapse-split-onboarding', '1');
        const t = setTimeout(() => setShowSplitOnboarding(false), 8000);
        return () => clearTimeout(t);
      }
    }
  }, [isSplitView, sourceMaterials.length]);

  // ── Document loading & auto-save ──────────────────────────────────
  useEffect(() => {
    if (id) {
      const doc = DocumentService.getDocument(id);
      if (doc) { setTitle(doc.title); setContent(doc.content); setCurrentDocument(doc); }
    }
    if (titleRef.current) titleRef.current.focus();
  }, [id]);

  useEffect(() => {
    const t = setTimeout(() => {
      if ((title.trim() || content.trim()) && saveStatus !== 'saving') handleAutoSave();
    }, 2000);
    return () => clearTimeout(t);
  }, [title, content]);

  const handleAutoSave = () => {
    if (!title.trim() && !content.trim()) return;
    setSaveStatus('saving');
    try {
      if (currentDocument) {
        const updated = DocumentService.updateDocument(currentDocument.id, { title: title || 'Untitled', content, status: 'draft' });
        if (updated) setCurrentDocument(updated);
      } else {
        const saved = DocumentService.saveDocument({ title: title || 'Untitled', content, status: 'draft' });
        setCurrentDocument(saved);
        window.history.replaceState(null, '', `/editor/${saved.id}`);
      }
      setSaveStatus('saved');
    } catch { setSaveStatus('unsaved'); }
  };

  // ── Vector Store: auto-ingest sources when they change ──────────────
  useEffect(() => {
    if (sourceMaterials.length === 0) return;
    const ingest = async () => {
      try {
        const resp = await fetch('/vector/ingest', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            workspace_id: vectorWorkspaceId,
            sources: sourceMaterials.map(s => ({ title: s.title, content: s.content })),
            source_types: sourceMaterials.map(s => s.type || 'text'),
          }),
        });
        if (resp.ok) {
          const data = await resp.json();
          setVectorStats({ total_chunks: data.total_chunks, embedded_chunks: data.embedded_chunks, embedding_provider: data.embedding_provider });
          console.log('[Vector] Ingested:', data.total_chunks, 'chunks,', data.embedded_chunks, 'embedded via', data.embedding_provider);
        }
      } catch (e) { console.error('[Vector] Ingest error:', e); }
    };
    ingest();
  }, [sourceMaterials, vectorWorkspaceId]);

  // ── Real-time semantic search on keystroke debounce ──────────────────
  useEffect(() => {
    if (!content.trim() || !vectorStats || vectorStats.embedded_chunks === 0) return;
    if (content === lastSearchContent.current) return;
    lastSearchContent.current = content;

    if (semanticTimer.current) clearTimeout(semanticTimer.current);
    semanticTimer.current = setTimeout(async () => {
      const query = content.slice(-400).trim();
      if (query.length < 20) return;
      setIsSemanticSearching(true);
      try {
        const resp = await fetch('/semantic-search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ workspace_id: vectorWorkspaceId, query, top_k: 5, threshold: 0.3 }),
        });
        if (resp.ok) {
          const data = await resp.json();
          setSemanticMatches(data.results || []);
          console.log(`[Vector] Semantic search: ${data.results?.length || 0} matches in ${data.search_time_ms}ms (${data.total_chunks_searched} chunks, ${data.embedding_provider})`);
        }
      } catch (e) { console.error('[Vector] Search error:', e); }
      setIsSemanticSearching(false);
    }, 2500);

    return () => { if (semanticTimer.current) clearTimeout(semanticTimer.current); };
  }, [content, vectorWorkspaceId, vectorStats]);

  const handleSaveDraft = () => {
    if (!title.trim() && !content.trim()) { setSaveStatus('error'); setTimeout(() => setSaveStatus('unsaved'), 3000); return; }
    setSaveStatus('saving');
    try {
      if (currentDocument) {
        const updated = DocumentService.updateDocument(currentDocument.id, { title: title || 'Untitled', content, status: 'draft' });
        if (updated) setCurrentDocument(updated);
      } else {
        const saved = DocumentService.saveDocument({ title: title || 'Untitled', content, status: 'draft' });
        setCurrentDocument(saved);
        window.history.replaceState(null, '', `/editor/${saved.id}`);
      }
      setSaveStatus('saved');
    } catch { setSaveStatus('error'); setTimeout(() => setSaveStatus('unsaved'), 3000); }
  };

  // ── Selection polling ─────────────────────────────────────────────
  useEffect(() => {
    let lastText = '';
    const interval = setInterval(() => {
      const textarea = editorAreaRef.current?.querySelector('textarea');
      if (textarea && document.activeElement === textarea && textarea.selectionStart !== textarea.selectionEnd) {
        const text = textarea.value.substring(textarea.selectionStart, textarea.selectionEnd).trim();
        if (text && text !== lastText) {
          lastText = text;
          const rect = textarea.getBoundingClientRect();
          const beforeText = textarea.value.substring(0, textarea.selectionStart);
          const lineCount = beforeText.split('\n').length;
          const lineHeight = 25.6;
          const approxTop = rect.top + Math.min((lineCount - 1) * lineHeight, rect.height - lineHeight);
          const toolbarWidth = 480;
          let left = rect.left + rect.width / 2 - toolbarWidth / 2;
          left = Math.max(8, Math.min(left, window.innerWidth - toolbarWidth - 16));
          setSelectedText(text);
          setToolbarPosition({ top: Math.max(approxTop - 52, 8), left });
        }
        return;
      }
      const sel = window.getSelection();
      if (sel && !sel.isCollapsed && sel.toString().trim()) {
        // Only detect selections in the editor or in source content — NOT in form inputs
        const anchorEl = sel.anchorNode instanceof HTMLElement ? sel.anchorNode : sel.anchorNode?.parentElement;
        const isInFormField = anchorEl?.closest('input, textarea, [contenteditable="true"]');
        if (isInFormField && !(anchorEl && editorAreaRef.current?.contains(anchorEl))) {
          // Selection is in a form field outside the main editor — ignore it
        } else {
          const inEditor = editorAreaRef.current?.contains(sel.anchorNode);
          // Detect selections in source content area (data-source-content attribute)
          const inSourceContent = !!anchorEl?.closest('[data-source-content]');
          if (inEditor || inSourceContent) {
            const text = sel.toString().trim();
            if (text && text !== lastText) {
              lastText = text;
              try {
                const r = sel.getRangeAt(0).getBoundingClientRect();
                const toolbarWidth = 480;
                let left = r.left + r.width / 2 - toolbarWidth / 2;
                left = Math.max(8, Math.min(left, window.innerWidth - toolbarWidth - 16));
                setSelectedText(text);
                setToolbarPosition({ top: Math.max(r.top - 52, 8), left });
              } catch {}
            }
            return;
          }
        }
      }
      if (lastText) { lastText = ''; setSelectedText(''); setToolbarPosition(null); }
    }, 200);
    return () => clearInterval(interval);
  }, []);

  // ── Chat helper: add message ──────────────────────────────────────
  const addMessage = useCallback((msg: Omit<ChatMessage, 'id' | 'timestamp'>) => {
    const msgId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    setChatMessages(prev => [...prev, { ...msg, id: msgId, timestamp: new Date() }]);
    return msgId;
  }, []);

  const updateMessage = useCallback((msgId: string, updates: Partial<ChatMessage>) => {
    setChatMessages(prev => prev.map(m => m.id === msgId ? { ...m, ...updates } : m));
  }, []);

  // ── Section detection helper ────────────────────────────────────────
  const sections = useMemo(() => parseSections(content), [content]);

  // ── Writing quality per section ────────────────────────────────────
  const sectionQuality = useMemo(() => {
    const map: Record<string, QualityMetrics> = {};
    for (const sec of sections) {
      if (sec.text.trim() && sec.wordCount > 20) {
        map[sec.heading] = analyzeWritingQuality(sec.text);
      }
    }
    return map;
  }, [sections]);

  const overallQuality = useMemo(() => analyzeWritingQuality(content), [content]);

  const detectSection = useCallback((text: string): string => {
    const idx = content.indexOf(text);
    if (idx >= 0) {
      const sec = findSectionAt(sections, idx);
      if (sec) return sec.heading;
    }
    return '';
  }, [content, sections]);

  // Build combined context for agents when source material is present
  const getAgentContext = useCallback(() => {
    if (!isSplitView || sourceMaterials.length === 0) return content;
    const sourceContext = sourceMaterials.map(s => `\n--- SOURCE: "${s.title}" (${s.type}) ---\n${s.content.slice(0, 3000)}`).join('\n');
    return content + '\n\n[SOURCE MATERIALS]' + sourceContext;
  }, [content, isSplitView, sourceMaterials]);

  // ── Evidence agent → Citations panel ────────────────────────────────
  const callEvidence = useCallback(async (text: string) => {
    setIsCitationsOpen(true);
    setIsCitationsLoading(true);
    setCitationsLoadingText(`Finding sources for "${text.slice(0, 50)}..."`);

    const sectionName = detectSection(text);
    const sectionContext = sectionName ? `\nSection: "${sectionName}".` : '';

    try {
      const response = await fetch('/inline-ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'evidence', selected_text: text, document_context: getAgentContext() + sectionContext }),
      });
      if (response.ok) {
        const data = await response.json();
        let raw = data.result || '';
        // Try to parse JSON from the response
        let parsed: any = null;
        try {
          // Strip markdown fences if present
          const cleaned = raw.replace(/^```json?\s*/i, '').replace(/```\s*$/, '').trim();
          parsed = JSON.parse(cleaned);
        } catch {
          // Try extracting JSON from within text
          const jsonMatch = raw.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            try { parsed = JSON.parse(jsonMatch[0]); } catch {}
          }
        }

        if (parsed && parsed.sources) {
          const result: EvidenceResult = {
            id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
            claim: parsed.claim || text,
            verdict: parsed.verdict || 'mixed',
            sources: (parsed.sources || []).map((s: any) => ({
              title: s.title || 'Untitled',
              finding: s.finding || '',
              source: s.source || 'Unknown source',
              type: s.type || 'supporting',
              relevance: s.relevance || 'medium',
            })),
            nextSteps: parsed.next_steps || [],
            highlightedText: text,
            timestamp: new Date(),
          };
          setCitationResults(prev => [result, ...prev]);
        } else {
          // Fallback: couldn't parse JSON, put it in chat instead
          addMessage({ role: 'user', selectedText: text, agentColor: '#4299e1', content: `Find evidence for: "${text.slice(0, 80)}..."` });
          addMessage({ role: 'agent', agentType: 'evidence', agentIcon: '🔍', agentColor: '#4299e1', agentLabel: 'Find Evidence', content: raw, isLoading: false });
          setIsSidebarOpen(true);
        }
      }
    } catch {
      addMessage({ role: 'agent', agentType: 'evidence', agentIcon: '🔍', agentColor: '#4299e1', agentLabel: 'Find Evidence', content: 'Network error. Is the backend running?', isLoading: false });
      setIsSidebarOpen(true);
    } finally {
      setIsCitationsLoading(false);
      setCitationsLoadingText('');
    }
  }, [content, addMessage]);

  // ── Other agents → Chat sidebar ───────────────────────────────────
  const callAgent = useCallback(async (action: string, text: string, text2?: string) => {
    // Evidence goes to citations panel
    if (action === 'evidence') { callEvidence(text); return; }

    const meta = AGENT_META[action] || AGENT_META.chat;

    addMessage({
      role: 'user', selectedText: text, agentColor: meta.color,
      content: `${meta.verb}: "${text.slice(0, 120)}${text.length > 120 ? '...' : ''}"`,
    });

    const agentMsgId = addMessage({
      role: 'agent', agentType: action, agentIcon: meta.icon,
      agentColor: meta.color, agentLabel: meta.label, content: '', isLoading: true,
    });

    setIsChatLoading(true);
    setIsSidebarOpen(true);

    const sectionName = detectSection(text);
    const sectionContext = sectionName ? `\nThe selected text is in the "${sectionName}" section.` : '';

    try {
      const response = await fetch('/inline-ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, selected_text: text, selected_text_2: text2 || '', document_context: getAgentContext() + sectionContext }),
      });
      if (response.ok) {
        const data = await response.json();
        let result = data.result || '';
        if (result.includes("encountered an error:")) {
          if (result.includes("credits") || result.includes("credit balance"))
            result = "**API credits exhausted.** Please check your API key billing.";
          else if (result.includes("quota") || result.includes("Rate limit"))
            result = "**Rate limit reached.** Please wait a moment and try again.";
        }
        updateMessage(agentMsgId, { content: result, isLoading: false });
      } else {
        const errData = await response.json().catch(() => null);
        let errMsg = 'Failed to get a response.';
        if (errData?.detail) errMsg = errData.detail.length > 200 ? errData.detail.slice(0, 200) + '...' : errData.detail;
        updateMessage(agentMsgId, { content: errMsg, isLoading: false });
      }
    } catch {
      updateMessage(agentMsgId, { content: 'Network error. Is the backend running?', isLoading: false });
    } finally {
      setIsChatLoading(false);
    }
  }, [content, addMessage, updateMessage, callEvidence, getAgentContext]);

  // ── Deep Dive handler ───────────────────────────────────────────────
  const fetchNextSteps = useCallback(async (synthesis: string, query: string, gaps: string[]) => {
    setIsLoadingNextSteps(true);
    setDeepDiveNextSteps([]);
    try {
      const resp = await fetch('/deep-dive/next-steps', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ synthesis, query, gaps }),
      });
      if (resp.ok) {
        const data = await resp.json();
        setDeepDiveNextSteps(data.steps || []);
        console.log('[NextSteps]', data.steps?.length, 'steps generated');
      }
    } catch (e) { console.error('[NextSteps] Error:', e); }
    setIsLoadingNextSteps(false);
  }, []);

  const handleDeepDive = useCallback(async (query: string) => {
    console.log('[DeepDive] Starting for:', query.slice(0, 80));
    setIsDeepDiving(true);
    setDeepDiveResult(null);
    setDeepDiveQuery(query);
    setDeepDiveNextSteps([]);
    try {
      const resp = await fetch('/deep-dive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, workspace_id: vectorWorkspaceId, document_context: content.slice(0, 1000) }),
      });
      if (resp.ok) {
        const data = await resp.json();
        setDeepDiveResult(data);
        setIsDeepDiving(false);
        console.log('[DeepDive] Complete:', data.papers_found, 'papers,', data.trace?.length, 'trace steps,', data.total_duration_ms, 'ms');
        // Auto-fetch next steps from the synthesis
        if (data.synthesis) {
          fetchNextSteps(data.synthesis, query, data.gaps || []);
        }
        return;
      } else {
        const errText = await resp.text().catch(() => 'unknown');
        console.error('[DeepDive] Backend error:', resp.status, errText.slice(0, 300));
        setDeepDiveResult({
          query, sub_questions: [], findings: [], gaps: [],
          synthesis: `Error: Backend returned ${resp.status}. ${errText.slice(0, 200)}`,
          sources_searched: 0, papers_found: 0, trace: [], total_duration_ms: 0,
        });
      }
    } catch (e) {
      console.error('[DeepDive] Network error:', e);
      setDeepDiveResult({
        query, sub_questions: [], findings: [], gaps: [],
        synthesis: `Network error: ${e instanceof Error ? e.message : 'Unknown error'}. Is the backend running on port 4000?`,
        sources_searched: 0, papers_found: 0, trace: [], total_duration_ms: 0,
      });
    }
    setIsDeepDiving(false);
  }, [vectorWorkspaceId, content, fetchNextSteps]);

  // ── Handle selection toolbar action ───────────────────────────────
  const handleSelectionAction = useCallback(async (action: SelectionAction, text: string) => {
    if (action === 'deep-dive') {
      handleDeepDive(text);
      return;
    }
    if (action === 'connect') {
      if (pinnedSelection) {
        await callAgent('connect', pinnedSelection, text);
        setPinnedSelection(null);
      } else {
        setPinnedSelection(text);
      }
      return;
    }
    setPinnedSelection(null);
    await callAgent(action, text);
  }, [pinnedSelection, callAgent, handleDeepDive]);

  // ── Handle free-form chat input ───────────────────────────────────
  const handleChatSend = useCallback(async (message: string) => {
    const meta = AGENT_META.chat;
    addMessage({ role: 'user', content: message });
    const agentMsgId = addMessage({
      role: 'agent', agentType: 'chat', agentIcon: meta.icon,
      agentColor: meta.color, agentLabel: meta.label, content: '', isLoading: true,
    });
    setIsChatLoading(true);
    try {
      const response = await fetch('/inline-ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'eli5', selected_text: message, document_context: getAgentContext() }),
      });
      if (response.ok) {
        const data = await response.json();
        let result = data.result || '';
        if (result.includes("encountered an error:")) {
          if (result.includes("credits") || result.includes("credit balance"))
            result = "**API credits exhausted.** Please check your API key billing.";
          else if (result.includes("quota") || result.includes("Rate limit"))
            result = "**Rate limit reached.** Wait a moment and try again.";
        }
        updateMessage(agentMsgId, { content: result, isLoading: false });
      } else {
        const errData = await response.json().catch(() => null);
        let errMsg = 'Failed to get a response.';
        if (errData?.detail) errMsg = errData.detail.length > 200 ? errData.detail.slice(0, 200) + '...' : errData.detail;
        updateMessage(agentMsgId, { content: errMsg, isLoading: false });
      }
    } catch {
      updateMessage(agentMsgId, { content: 'Network error. Is the backend running?', isLoading: false });
    } finally {
      setIsChatLoading(false);
    }
  }, [content, addMessage, updateMessage, getAgentContext]);

  // ── Insert AI result into document ────────────────────────────────
  const handleInsertToDoc = useCallback((text: string) => {
    setContent(prev => prev + '\n\n' + text);
  }, []);

  // ── Split-view: source material handlers ────────────────────────────

  // Helper: run transcript analysis and update a source in-place with AI insights
  const analyzeTranscriptSource = useCallback(async (sourceId: string, transcript: string, title: string) => {
    try {
      setSourceLoadingText('Analyzing transcript with AI...');
      const resp = await fetch('/analyze-transcript', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transcript, title }),
      });
      if (resp.ok) {
        const data = await resp.json();
        setSourceMaterials(prev => prev.map(s => s.id === sourceId ? {
          ...s,
          title: data.title || s.title,
          summary: data.summary || undefined,
          keyClaims: data.key_claims || undefined,
          researchDirections: data.research_directions || undefined,
        } : s));
      }
    } catch { /* non-fatal — source still has raw transcript */ }
  }, []);

  const handleAddSource = useCallback((source: Omit<SourceMaterial, 'id' | 'addedAt'>) => {
    const sourceId = Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
    const newSource: SourceMaterial = { ...source, id: sourceId, addedAt: new Date() };
    setSourceMaterials(prev => [...prev, newSource]);
    if (!isSplitView) setIsSplitView(true);
    // Auto-analyze pasted transcripts and text sources that don't already have AI analysis
    if ((source.type === 'transcript' || source.type === 'text') && !source.summary && source.content.length > 100) {
      analyzeTranscriptSource(sourceId, source.content, source.title);
    }
  }, [isSplitView, analyzeTranscriptSource]);

  const handleRemoveSource = useCallback((id: string) => {
    setSourceMaterials(prev => prev.filter(s => s.id !== id));
  }, []);

  const handleSourceSelectionChange = useCallback((text: string, sourceTitle: string) => {
    setSourceSelection({ text, sourceTitle });
  }, []);

  const handleSourcePDFUpload = useCallback(async (file: File) => {
    setIsSourcePDFLoading(true);
    setSourceLoadingText(`Extracting text from ${file.name}...`);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const resp = await fetch('/extract-pdf', { method: 'POST', body: formData });
      if (resp.ok) {
        const data = await resp.json();
        handleAddSource({
          title: data.title || file.name.replace(/\.pdf$/i, ''),
          content: data.text || '',
          type: 'pdf',
          authors: data.authors || undefined,
          summary: data.summary || undefined,
          keyClaims: data.key_claims || undefined,
          researchDirections: data.research_directions || undefined,
          pageCount: data.page_count || undefined,
        });
      }
    } catch { /* non-fatal */ } finally {
      setIsSourcePDFLoading(false);
      setSourceLoadingText('');
    }
  }, [handleAddSource]);

  const handleSourceAudioUpload = useCallback(async (file: File) => {
    setIsSourceTranscriptLoading(true);
    setSourceLoadingText(`Transcribing ${file.name}...`);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const resp = await fetch('/transcribe', { method: 'POST', body: formData });
      if (resp.ok) {
        const data = await resp.json();
        const sourceTitle = file.name.replace(/\.[^.]+$/, '');
        const sourceId = Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
        const newSource: SourceMaterial = {
          id: sourceId, title: sourceTitle, content: data.transcript || '',
          type: 'transcript', addedAt: new Date(),
        };
        setSourceMaterials(prev => [...prev, newSource]);
        if (!isSplitView) setIsSplitView(true);
        // Now analyze the transcript for research directions
        if (data.transcript) {
          await analyzeTranscriptSource(sourceId, data.transcript, sourceTitle);
        }
      }
    } catch { /* non-fatal */ } finally {
      setIsSourceTranscriptLoading(false);
      setSourceLoadingText('');
    }
  }, [isSplitView, analyzeTranscriptSource]);

  const handleDelegateAgent = useCallback((action: string, query: string) => {
    // Route to the appropriate agent
    if (action === 'deep-dive') {
      handleDeepDive(query);
    } else if (action === 'evidence') {
      callEvidence(query);
    } else {
      callAgent(action as any, query);
    }
  }, [callEvidence, callAgent, handleDeepDive]);

  // ── Format helpers ──────────────────────────────────────────────────
  const fmtCite = (src: Citation, fmt: CitationFormat) => {
    const parts = src.source.split('—').map(s => s.trim());
    const authorYear = parts[0] || src.source;
    const venue = parts[1] || '';
    const yearMatch = authorYear.match(/(\d{4})/);
    const year = yearMatch ? yearMatch[1] : 'n.d.';
    const authors = authorYear.replace(/,?\s*\d{4}/, '').trim();
    const lastNameMatch = authors.match(/^([A-Za-z'-]+)/);
    const lastName = lastNameMatch ? lastNameMatch[1] : authors.split(',')[0];
    const inline = fmt === 'apa' ? `(${lastName}, ${year})` : fmt === 'mla' ? `(${lastName})` : `(${lastName} ${year})`;
    const full = fmt === 'apa' ? `${authors} (${year}). ${src.title}. ${venue ? `*${venue}*.` : ''}`
               : fmt === 'mla' ? `${authors}. "${src.title}." ${venue ? `*${venue}*,` : ''} ${year}.`
               : `${authors}. "${src.title}." ${venue ? `${venue},` : ''} ${year}.`;
    return { inline, full };
  };

  // ── Insert a single citation as footnote [N] ──────────────────────
  const handleInsertCitation = useCallback((citation: Citation, format: CitationFormat) => {
    const { full } = fmtCite(citation, format);
    setFootnotes(prev => {
      const newFootnotes = [...prev, full];
      const n = newFootnotes.length;
      // Insert footnote marker at cursor position + rebuild References
      setContent(prevContent => {
        // Remove old References section if present
        const refIdx = prevContent.lastIndexOf('\nReferences\n');
        const base = refIdx >= 0 ? prevContent.slice(0, refIdx) : prevContent;
        const refSection = '\n\nReferences\n' + newFootnotes.map((f, i) => `[${i + 1}] ${f}`).join('\n');
        // Get cursor position from textarea
        const textarea = editorAreaRef.current?.querySelector('textarea');
        const cursorPos = textarea ? textarea.selectionStart : base.length;
        // Clamp cursor to within base content
        const insertAt = Math.min(cursorPos, base.length);
        return base.slice(0, insertAt) + ` [${n}]` + base.slice(insertAt) + refSection;
      });
      return newFootnotes;
    });
  }, []);

  // ── Insert all sources from an evidence result as footnotes ────────
  const handleInsertAllCitations = useCallback((result: EvidenceResult, format: CitationFormat) => {
    setFootnotes(prev => {
      const newRefs = result.sources.map(s => fmtCite(s, format).full);
      const newFootnotes = [...prev, ...newRefs];
      const startN = prev.length + 1;
      const markers = result.sources.map((_, i) => `[${startN + i}]`).join('');
      setContent(prevContent => {
        const refIdx = prevContent.lastIndexOf('\nReferences\n');
        const base = refIdx >= 0 ? prevContent.slice(0, refIdx) : prevContent;
        const refSection = '\n\nReferences\n' + newFootnotes.map((f, i) => `[${i + 1}] ${f}`).join('\n');
        // Get cursor position from textarea
        const textarea = editorAreaRef.current?.querySelector('textarea');
        const cursorPos = textarea ? textarea.selectionStart : base.length;
        // Clamp cursor to within base content
        const insertAt = Math.min(cursorPos, base.length);
        return base.slice(0, insertAt) + ' ' + markers + base.slice(insertAt) + refSection;
      });
      return newFootnotes;
    });
  }, []);

  // ── Transcription: upload handler ──────────────────────────────────
  const handleTranscribeFile = useCallback(async (file: File) => {
    const audioVideoTypes = [
      'audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav', 'audio/wave',
      'audio/mp4', 'audio/m4a', 'audio/x-m4a', 'audio/ogg', 'audio/webm',
      'video/mp4', 'video/webm', 'video/quicktime', 'video/x-msvideo',
    ];
    const ext = file.name.split('.').pop()?.toLowerCase() || '';
    const knownExts = ['mp3', 'wav', 'mp4', 'm4a', 'ogg', 'webm', 'mov', 'avi', 'flac', 'aac'];
    if (!audioVideoTypes.includes(file.type) && !file.type.startsWith('audio/') && !file.type.startsWith('video/') && !knownExts.includes(ext)) {
      addMessage({ role: 'agent', agentType: 'chat', agentIcon: '🎙️', agentColor: '#6366f1', agentLabel: 'Transcription', content: `**Unsupported file type:** "${file.name}". Please upload an audio or video file (MP3, MP4, WAV, M4A, WebM, etc.).`, isLoading: false });
      setIsSidebarOpen(true);
      return;
    }

    setIsTranscribing(true);
    setIsTranscriptionOpen(true);
    setTranscribeLoadingText(`Transcribing "${file.name}" (${(file.size / 1024 / 1024).toFixed(1)} MB)...`);

    try {
      const formData = new FormData();
      formData.append('file', file);

      const response = await fetch('/transcribe', { method: 'POST', body: formData });

      if (!response.ok) {
        const errData = await response.json().catch(() => null);
        const errMsg = errData?.detail || `Server error (${response.status})`;
        addMessage({ role: 'agent', agentType: 'chat', agentIcon: '🎙️', agentColor: '#ef4444', agentLabel: 'Transcription Error', content: `**Transcription failed:** ${errMsg}`, isLoading: false });
        setIsSidebarOpen(true);
        return;
      }

      const data = await response.json();

      const result: TranscriptionResult = {
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
        filename: file.name,
        transcript: data.transcript || '',
        duration: data.duration,
        confidence: data.confidence,
        speakers: data.speakers,
        paragraphs: data.paragraphs,
        analysis: data.analysis,
        claims: data.claims,
        timestamp: new Date(),
      };

      setTranscriptionResults(prev => [result, ...prev]);

      // Also notify in chat
      const claimCount = data.claims?.length || 0;
      addMessage({
        role: 'agent', agentType: 'chat', agentIcon: '🎙️', agentColor: '#6366f1', agentLabel: 'Transcription',
        content: `**Transcribed "${file.name}"** — ${formatDurationShort(data.duration)}${claimCount > 0 ? `, ${claimCount} verifiable claims identified` : ''}. Check the 🎙️ Transcripts panel for details.`,
        isLoading: false,
      });

    } catch (err) {
      addMessage({ role: 'agent', agentType: 'chat', agentIcon: '🎙️', agentColor: '#ef4444', agentLabel: 'Transcription Error', content: '**Network error.** Is the backend running?', isLoading: false });
      setIsSidebarOpen(true);
    } finally {
      setIsTranscribing(false);
      setTranscribeLoadingText('');
    }
  }, [addMessage]);

  // Drag-and-drop handlers
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer.types.includes('Files')) {
      setIsDragOver(true);
    }
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // Only close if we're leaving the container (not entering a child)
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const { clientX, clientY } = e;
    if (clientX <= rect.left || clientX >= rect.right || clientY <= rect.top || clientY >= rect.bottom) {
      setIsDragOver(false);
    }
  }, []);

  // ── PDF ingestion handler ────────────────────────────────────────
  const handlePDFFile = useCallback(async (file: File) => {
    addMessage({ role: 'agent', agentType: 'chat', agentIcon: '📄', agentColor: '#6366f1', agentLabel: 'PDF Import', content: `**Extracting** "${file.name}"...`, isLoading: true });
    setIsSidebarOpen(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const resp = await fetch('/extract-pdf', { method: 'POST', body: formData });
      if (!resp.ok) {
        const err = await resp.json().catch(() => null);
        addMessage({ role: 'agent', agentType: 'chat', agentIcon: '📄', agentColor: '#ef4444', agentLabel: 'PDF Error', content: `**Failed:** ${err?.detail || 'Unknown error'}`, isLoading: false });
        return;
      }
      const data = await resp.json();
      // Add findings to chat
      let msg = `**Imported "${data.filename}"** (${data.page_count} pages)\n\n`;
      if (data.summary) msg += `${data.summary}\n\n`;
      if (data.key_findings?.length) {
        msg += `**Key findings:**\n${data.key_findings.map((f: string) => `• ${f}`).join('\n')}\n\n`;
      }
      if (data.suggested_citations?.length) {
        msg += `**Citable claims:**\n${data.suggested_citations.map((c: any) => `• "${c.claim}" — ${c.citation_text || ''}`).join('\n')}`;
      }
      // Replace the loading message
      setChatMessages(prev => {
        const last = prev[prev.length - 1];
        if (last && last.isLoading) {
          return [...prev.slice(0, -1), { ...last, content: msg, isLoading: false }];
        }
        return prev;
      });
    } catch {
      addMessage({ role: 'agent', agentType: 'chat', agentIcon: '📄', agentColor: '#ef4444', agentLabel: 'PDF Error', content: '**Network error.** Is the backend running?', isLoading: false });
    }
  }, [addMessage]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) {
      const file = files[0];
      const ext = file.name.split('.').pop()?.toLowerCase();
      if (ext === 'pdf') {
        if (isSplitView) handleSourcePDFUpload(file);
        else handlePDFFile(file);
      } else {
        if (isSplitView) handleSourceAudioUpload(file);
        else handleTranscribeFile(file);
      }
    }
  }, [handleTranscribeFile, handlePDFFile, isSplitView, handleSourcePDFUpload, handleSourceAudioUpload]);

  // File input ref for manual upload
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Insert transcript into document
  const handleInsertTranscript = useCallback((result: TranscriptionResult) => {
    const header = `\n\n--- Transcript: ${result.filename} ---\n`;
    const body = result.paragraphs ? result.paragraphs.join('\n\n') : result.transcript;
    setContent(prev => prev + header + body + '\n');
  }, []);

  // Insert a single claim into the document
  const handleInsertClaim = useCallback((claim: Claim) => {
    const text = `\n\n"${claim.claim}" ${claim.speaker ? `(${claim.speaker})` : ''}\n${claim.recommendation ? `Note: ${claim.recommendation}` : ''}`;
    setContent(prev => prev + text);
  }, []);

  // Fire "Find Evidence" for a claim via the existing evidence pipeline
  const handleFindEvidenceForClaim = useCallback((claimText: string) => {
    callEvidence(claimText);
  }, [callEvidence]);

  // ── Export as PDF ──────────────────────────────────────────────────
  const handleExportPDF = useCallback(() => {
    // Build clean HTML document for printing
    const date = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
    const wordCount = content.split(/\s+/).filter(Boolean).length;

    // Convert plain text content to paragraphs
    const paragraphs = content
      .split(/\n\n+/)
      .filter(p => p.trim())
      .map(p => {
        // Handle lines that look like headers (start with ** or #)
        const trimmed = p.trim();
        if (trimmed.startsWith('**') && trimmed.endsWith('**')) {
          return `<h2 style="font-size:16px;font-weight:700;margin:24px 0 8px;color:#1a202c;">${trimmed.replace(/\*\*/g, '')}</h2>`;
        }
        if (trimmed.startsWith('# ')) {
          return `<h2 style="font-size:16px;font-weight:700;margin:24px 0 8px;color:#1a202c;">${trimmed.slice(2)}</h2>`;
        }
        // Handle bullet/numbered lists
        if (trimmed.match(/^[\d]+\.\s|^[-•]\s/m)) {
          const items = trimmed.split('\n').map(line => {
            const cleaned = line.replace(/^[\d]+\.\s*|^[-•]\s*/, '').trim();
            return cleaned ? `<li style="margin-bottom:4px;">${cleaned}</li>` : '';
          }).join('');
          return `<ul style="margin:8px 0;padding-left:24px;color:#374151;">${items}</ul>`;
        }
        // Handle inline bold
        const withBold = trimmed.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
        // Handle inline italic
        const withItalic = withBold.replace(/\*(.+?)\*/g, '<em>$1</em>');
        return `<p style="margin:0 0 12px;line-height:1.75;color:#374151;">${withItalic.replace(/\n/g, '<br/>')}</p>`;
      })
      .join('');

    const html = `<!DOCTYPE html>
<html><head>
<meta charset="utf-8"/>
<title>${title || 'Untitled'}</title>
<style>
  @page { margin: 1in; size: letter; }
  body {
    font-family: Georgia, 'Times New Roman', serif;
    font-size: 12pt;
    line-height: 1.75;
    color: #1a202c;
    max-width: 100%;
    margin: 0;
    padding: 0;
  }
  .header { margin-bottom: 32px; border-bottom: 1px solid #e5e7eb; padding-bottom: 16px; }
  .title { font-size: 24pt; font-weight: 700; margin: 0 0 8px; color: #1a202c; }
  .meta { font-size: 10pt; color: #9ca3af; }
  .content { font-size: 12pt; }
  @media print {
    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  }
</style>
</head><body>
<div class="header">
  <div class="title">${title || 'Untitled'}</div>
  <div class="meta">${date} · ${wordCount} words</div>
</div>
<div class="content">${paragraphs}</div>
</body></html>`;

    // Open in a new window and trigger print
    const printWindow = window.open('', '_blank', 'width=800,height=1000');
    if (printWindow) {
      printWindow.document.write(html);
      printWindow.document.close();
      // Wait for content to render, then print
      setTimeout(() => {
        printWindow.print();
      }, 300);
    }
  }, [title, content]);

  // ── Export as DOCX ─────────────────────────────────────────────────
  const handleExportDOCX = useCallback(async () => {
    const docSections = parseSections(content);
    const children: Paragraph[] = [];

    // Title
    children.push(new Paragraph({
      children: [new TextRun({ text: title || 'Untitled', bold: true, size: 48, font: 'Times New Roman' })],
      heading: HeadingLevel.TITLE,
      alignment: AlignmentType.CENTER,
      spacing: { after: 200 },
    }));

    // Date line
    children.push(new Paragraph({
      children: [new TextRun({ text: new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }), size: 20, color: '999999', font: 'Times New Roman' })],
      alignment: AlignmentType.CENTER,
      spacing: { after: 400 },
    }));

    // If sections detected, use them; otherwise just dump content as paragraphs
    if (docSections.length > 0) {
      for (const sec of docSections) {
        children.push(new Paragraph({
          children: [new TextRun({ text: sec.heading, bold: true, size: 28, font: 'Times New Roman' })],
          heading: sec.level === 1 ? HeadingLevel.HEADING_1 : HeadingLevel.HEADING_2,
          spacing: { before: 300, after: 100 },
        }));
        // Body paragraphs
        const bodyParas = sec.text.split(/\n\n+/).filter(p => p.trim());
        for (const para of bodyParas) {
          children.push(new Paragraph({
            children: [new TextRun({ text: para.trim(), size: 24, font: 'Times New Roman' })],
            spacing: { after: 120 },
          }));
        }
      }
    } else {
      const paras = content.split(/\n\n+/).filter(p => p.trim());
      for (const para of paras) {
        children.push(new Paragraph({
          children: [new TextRun({ text: para.trim(), size: 24, font: 'Times New Roman' })],
          spacing: { after: 120 },
        }));
      }
    }

    const doc = new DocxDocument({
      sections: [{ children }],
    });

    const blob = await Packer.toBlob(doc);
    saveAs(blob, `${(title || 'Untitled').replace(/[^a-zA-Z0-9 ]/g, '')}.docx`);
  }, [title, content]);

  return (
    <>
      <style>{`
        @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes agentPulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
        @keyframes agentSlideIn { from { opacity: 0; transform: translateX(-6px); } to { opacity: 1; transform: translateX(0); } }
      `}</style>

      {/* Hidden file input for manual upload */}
      <input
        ref={fileInputRef}
        type="file"
        accept="audio/*,video/*,.mp3,.wav,.mp4,.m4a,.webm,.ogg,.flac,.aac,.mov,.avi,.pdf,application/pdf"
        style={{ display: 'none' }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) {
            if (file.name.toLowerCase().endsWith('.pdf')) {
              if (isSplitView) handleSourcePDFUpload(file);
              else handlePDFFile(file);
            } else {
              if (isSplitView) handleSourceAudioUpload(file);
              else handleTranscribeFile(file);
            }
          }
          e.target.value = '';
        }}
      />

      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        style={{ display: 'flex', minHeight: '100vh', fontFamily: "'Inter', system-ui, -apple-system, sans-serif", backgroundColor: '#fff', color: '#2d3748', position: 'relative' }}
      >
        {/* ── Drag-and-drop overlay ──────────────────────────────── */}
        {isDragOver && (
          <div
            style={{
              position: 'fixed',
              inset: 0,
              zIndex: 200,
              backgroundColor: 'rgba(59, 130, 246, 0.08)',
              backdropFilter: 'blur(2px)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              pointerEvents: 'none',
            }}
          >
            <div
              style={{
                padding: '40px 56px',
                borderRadius: '16px',
                border: '2px dashed #3b82f6',
                backgroundColor: 'rgba(255,255,255,0.95)',
                textAlign: 'center',
                boxShadow: '0 8px 32px rgba(59,130,246,0.15)',
              }}
            >
              <div style={{ fontSize: '40px', marginBottom: '12px' }}>📎</div>
              <div style={{ fontSize: '18px', fontWeight: 600, color: '#1e40af', marginBottom: '4px' }}>
                Drop to import
              </div>
              <div style={{ fontSize: '13px', color: '#6b7280' }}>
                Audio/Video (transcribe) or PDF (extract references)
              </div>
            </div>
          </div>
        )}

        {/* ── Main editor (full width, no sidebar) ────────────────── */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'auto', backgroundColor: '#fff', minWidth: 0 }}>
          {/* Top bar */}
          <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 16px', backgroundColor: '#fff', borderBottom: '1px solid #f0f0f0', minHeight: '44px', flexShrink: 0, position: 'sticky', top: 0, zIndex: 10 }}>
            {/* Left: Back + Title */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
              <button onClick={() => navigate('/')}
                style={{ display: 'flex', alignItems: 'center', border: 'none', background: 'none', cursor: 'pointer', padding: '4px', borderRadius: '6px', color: '#9ca3af', transition: 'all 0.12s', flexShrink: 0 }}
                onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#f3f4f6'; e.currentTarget.style.color = '#374151'; }}
                onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = '#9ca3af'; }}
                title="Back to documents"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
              </button>
              <div style={{ fontSize: '14px', fontWeight: 600, color: '#1a202c', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '180px' }}>
                {title || 'Untitled'}
              </div>
              <span style={{ fontSize: '11px', color: saveStatus === 'saved' ? '#059669' : saveStatus === 'saving' ? '#d97706' : '#9ca3af', flexShrink: 0 }}>
                {saveStatus === 'saving' ? '...' : saveStatus === 'saved' ? '✓' : ''}
              </span>
            </div>

            {/* ── Agent Activity Strip ─────────────────────────────── */}
            {(isDeepDiving || isCitationsLoading || isChatLoading || isTranscribing || isLoadingNextSteps || isSemanticSearching) && (
              <div style={{
                display: 'flex', alignItems: 'center', gap: '6px',
                padding: '3px 10px', borderRadius: '8px',
                backgroundColor: '#111827',
                animation: 'agentSlideIn 0.2s ease-out',
              }}>
                {isDeepDiving && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '5px', animation: 'agentSlideIn 0.15s ease-out' }}>
                    <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#a78bfa', animation: 'agentPulse 1.2s ease-in-out infinite', flexShrink: 0 }} />
                    <span style={{ fontSize: '10px', fontWeight: 600, color: '#c4b5fd', whiteSpace: 'nowrap' }}>🔬 Deep Dive</span>
                  </div>
                )}
                {isCitationsLoading && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '5px', animation: 'agentSlideIn 0.15s ease-out' }}>
                    <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#60a5fa', animation: 'agentPulse 1.2s ease-in-out infinite 0.2s', flexShrink: 0 }} />
                    <span style={{ fontSize: '10px', fontWeight: 600, color: '#93c5fd', whiteSpace: 'nowrap' }}>🔍 Evidence</span>
                  </div>
                )}
                {isChatLoading && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '5px', animation: 'agentSlideIn 0.15s ease-out' }}>
                    <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#34d399', animation: 'agentPulse 1.2s ease-in-out infinite 0.4s', flexShrink: 0 }} />
                    <span style={{ fontSize: '10px', fontWeight: 600, color: '#6ee7b7', whiteSpace: 'nowrap' }}>💬 Agent</span>
                  </div>
                )}
                {isTranscribing && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '5px', animation: 'agentSlideIn 0.15s ease-out' }}>
                    <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#f87171', animation: 'agentPulse 1.2s ease-in-out infinite 0.3s', flexShrink: 0 }} />
                    <span style={{ fontSize: '10px', fontWeight: 600, color: '#fca5a5', whiteSpace: 'nowrap' }}>🎙️ Transcribe</span>
                  </div>
                )}
                {isLoadingNextSteps && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '5px', animation: 'agentSlideIn 0.15s ease-out' }}>
                    <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#c084fc', animation: 'agentPulse 1.2s ease-in-out infinite 0.5s', flexShrink: 0 }} />
                    <span style={{ fontSize: '10px', fontWeight: 600, color: '#d8b4fe', whiteSpace: 'nowrap' }}>⚡ Next Steps</span>
                  </div>
                )}
                {isSemanticSearching && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '5px', animation: 'agentSlideIn 0.15s ease-out' }}>
                    <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#818cf8', animation: 'agentPulse 1.2s ease-in-out infinite 0.1s', flexShrink: 0 }} />
                    <span style={{ fontSize: '10px', fontWeight: 600, color: '#a5b4fc', whiteSpace: 'nowrap' }}>🧠 Search</span>
                  </div>
                )}
              </div>
            )}

            {/* Center: Tool buttons — compact icon pills */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '2px', backgroundColor: '#f8f9fa', borderRadius: '8px', padding: '3px' }}>
              {/* AI Chat */}
              <button onClick={() => setIsSidebarOpen(!isSidebarOpen)}
                title="AI Chat"
                style={{
                  height: '30px', padding: '0 10px', border: 'none', borderRadius: '6px',
                  backgroundColor: isSidebarOpen ? '#fff' : 'transparent', fontSize: '12px', fontWeight: 500,
                  color: isSidebarOpen ? '#1a202c' : '#6b7280', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', gap: '5px', transition: 'all 0.12s',
                  boxShadow: isSidebarOpen ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
                }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                Chat
                {chatMessages.filter(m => m.role === 'agent' && !m.isLoading).length > 0 && (
                  <span style={{ fontSize: '10px', backgroundColor: '#e0e7ff', color: '#4338ca', padding: '0 5px', borderRadius: '6px', lineHeight: '16px' }}>
                    {chatMessages.filter(m => m.role === 'agent' && !m.isLoading).length}
                  </span>
                )}
              </button>

              {/* Sources & Citations */}
              <button onClick={() => setIsCitationsOpen(!isCitationsOpen)}
                title="Sources & Citations"
                style={{
                  height: '30px', padding: '0 10px', border: 'none', borderRadius: '6px',
                  backgroundColor: isCitationsOpen ? '#fff' : 'transparent', fontSize: '12px', fontWeight: 500,
                  color: isCitationsOpen ? '#1a202c' : '#6b7280', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', gap: '5px', transition: 'all 0.12s',
                  boxShadow: isCitationsOpen ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
                }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                Sources
                {citationResults.length > 0 && (
                  <span style={{ fontSize: '10px', backgroundColor: '#dbeafe', color: '#1d4ed8', padding: '0 5px', borderRadius: '6px', lineHeight: '16px' }}>
                    {citationResults.reduce((n, r) => n + r.sources.length, 0)}
                  </span>
                )}
              </button>

              {/* Claims */}
              <button onClick={() => setIsClaimTrackerOpen(!isClaimTrackerOpen)}
                title="Claim Tracker"
                style={{
                  height: '30px', padding: '0 10px', border: 'none', borderRadius: '6px',
                  backgroundColor: isClaimTrackerOpen ? '#fff' : 'transparent', fontSize: '12px', fontWeight: 500,
                  color: isClaimTrackerOpen ? '#1a202c' : '#6b7280', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', gap: '5px', transition: 'all 0.12s',
                  boxShadow: isClaimTrackerOpen ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
                }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
                Claims
              </button>

              <div style={{ width: '1px', height: '16px', backgroundColor: '#e5e7eb', margin: '0 2px' }} />

              {/* More tools: Transcripts, Map, Quality */}
              <button onClick={() => setIsTranscriptionOpen(!isTranscriptionOpen)}
                title="Transcriptions"
                style={{
                  height: '30px', width: '30px', border: 'none', borderRadius: '6px',
                  backgroundColor: isTranscriptionOpen ? '#fff' : 'transparent',
                  color: isTranscriptionOpen ? '#1a202c' : '#9ca3af', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.12s',
                  boxShadow: isTranscriptionOpen ? '0 1px 3px rgba(0,0,0,0.08)' : 'none', position: 'relative',
                }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>
                {isTranscribing && <span style={{ position: 'absolute', top: '4px', right: '4px', width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#3b82f6' }} />}
              </button>

              <button onClick={() => setIsArgumentMapOpen(true)}
                title="Argument Map"
                style={{
                  height: '30px', width: '30px', border: 'none', borderRadius: '6px',
                  backgroundColor: 'transparent',
                  color: '#9ca3af', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.12s',
                }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"/><line x1="8" y1="2" x2="8" y2="18"/><line x1="16" y1="6" x2="16" y2="22"/></svg>
              </button>

              <button onClick={() => setIsQualityOpen(!isQualityOpen)}
                title="Writing Quality"
                style={{
                  height: '30px', width: '30px', border: 'none', borderRadius: '6px',
                  backgroundColor: isQualityOpen ? '#fff' : 'transparent',
                  color: isQualityOpen ? '#1a202c' : '#9ca3af', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.12s',
                  boxShadow: isQualityOpen ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
                }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>
              </button>
            </div>

            {/* Right: Split view + Export */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              {/* Split View toggle — prominent */}
              {/* Source Intelligence indicator */}
              {vectorStats && vectorStats.embedded_chunks > 0 && (
                <button
                  onClick={() => setShowSemanticDrawer(!showSemanticDrawer)}
                  title={`${vectorStats.total_chunks} chunks embedded · ${semanticMatches.length} live matches`}
                  style={{
                    height: '30px', padding: '0 10px', border: '1px solid',
                    borderColor: showSemanticDrawer ? '#c7d2fe' : (semanticMatches.length > 0 ? '#c7d2fe' : '#e5e7eb'),
                    borderRadius: '6px',
                    backgroundColor: showSemanticDrawer ? '#eef2ff' : (semanticMatches.length > 0 ? '#f5f3ff' : '#fff'),
                    fontSize: '11px', fontWeight: 600,
                    color: semanticMatches.length > 0 ? '#6366f1' : '#6b7280', cursor: 'pointer',
                    display: 'flex', alignItems: 'center', gap: '5px', transition: 'all 0.15s',
                    position: 'relative',
                  }}
                >
                  {isSemanticSearching ? (
                    <div style={{ width: '8px', height: '8px', border: '1.5px solid #c4b5fd', borderTopColor: '#6366f1', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
                  ) : (
                    <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: semanticMatches.length > 0 ? '#6366f1' : '#d1d5db' }} />
                  )}
                  {semanticMatches.length > 0 ? `${semanticMatches.length} matches` : 'Indexed'}
                </button>
              )}

              <button onClick={() => setIsSplitView(!isSplitView)}
                title="Split view — work with source material side-by-side"
                style={{
                  height: '30px', padding: '0 10px', border: '1px solid',
                  borderColor: isSplitView ? '#4a5568' : '#e5e7eb', borderRadius: '6px',
                  backgroundColor: isSplitView ? '#4a5568' : '#fff', fontSize: '12px', fontWeight: 600,
                  color: isSplitView ? '#fff' : '#374151', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', gap: '5px', transition: 'all 0.15s',
                }}
                onMouseEnter={(e) => { if (!isSplitView) e.currentTarget.style.backgroundColor = '#f3f4f6'; }}
                onMouseLeave={(e) => { if (!isSplitView) e.currentTarget.style.backgroundColor = '#fff'; }}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="18" height="18" rx="2" />
                  <line x1="12" y1="3" x2="12" y2="21" />
                </svg>
                Split
                {sourceMaterials.length > 0 && (
                  <span style={{ fontSize: '10px', backgroundColor: isSplitView ? 'rgba(255,255,255,0.2)' : '#e5e7eb', color: isSplitView ? '#fff' : '#4a5568', padding: '0 5px', borderRadius: '6px', lineHeight: '16px' }}>
                    {sourceMaterials.length}
                  </span>
                )}
              </button>

              <div style={{ width: '1px', height: '16px', backgroundColor: '#e5e7eb' }} />

              {/* Export buttons — icon-only */}
              <button onClick={handleExportDOCX}
                title="Export as DOCX"
                style={{ height: '30px', width: '30px', border: '1px solid #e5e7eb', borderRadius: '6px', backgroundColor: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#6b7280', transition: 'all 0.12s' }}
                onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#f3f4f6'; e.currentTarget.style.color = '#374151'; }}
                onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = '#fff'; e.currentTarget.style.color = '#6b7280'; }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
              </button>
              <button onClick={handleExportPDF}
                title="Export as PDF"
                style={{ height: '30px', width: '30px', border: '1px solid #e5e7eb', borderRadius: '6px', backgroundColor: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#6b7280', transition: 'all 0.12s' }}
                onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#f3f4f6'; e.currentTarget.style.color = '#374151'; }}
                onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = '#fff'; e.currentTarget.style.color = '#6b7280'; }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              </button>
              <button onClick={handleSaveDraft}
                title="Save draft"
                style={{ height: '30px', padding: '0 10px', border: '1px solid #e5e7eb', borderRadius: '6px', backgroundColor: '#fff', fontSize: '12px', color: '#374151', cursor: 'pointer', fontWeight: 500, transition: 'all 0.12s' }}
                onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#f3f4f6'; }}
                onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = '#fff'; }}
              >Save</button>
            </div>
          </header>

          {/* Editor body — split view container */}
          <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
            {/* Left: Editor */}
            <div style={{ flex: (isSplitView || deepDiveResult || isDeepDiving) ? '1 1 50%' : '1 1 100%', overflow: 'auto', display: 'flex', justifyContent: 'center', transition: 'flex 0.25s ease' }}>
            <div style={{ width: '100%', maxWidth: (isSplitView || deepDiveResult || isDeepDiving) ? '100%' : '720px', padding: (isSplitView || deepDiveResult || isDeepDiving) ? '32px 28px 120px' : '48px 40px 120px', minHeight: 'calc(100vh - 48px)' }}>
              {/* Title */}
              <input ref={titleRef} type="text" placeholder="Untitled" value={title}
                onChange={(e) => setTitle(e.target.value)}
                onFocus={() => setIsTitleFocused(true)} onBlur={() => setIsTitleFocused(false)}
                style={{
                  fontSize: '32px', fontWeight: 700, color: isTitleFocused || title ? '#1a202c' : '#c4c4c4',
                  border: 'none', outline: 'none', backgroundColor: 'transparent', width: '100%',
                  padding: '0', lineHeight: 1.25, marginBottom: '12px',
                  fontFamily: "'Georgia', 'Times New Roman', serif",
                }}
              />

              {/* Meta line */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', fontSize: '13px', color: '#c4c4c4', marginBottom: '32px', borderBottom: '1px solid #f5f5f5', paddingBottom: '16px' }}>
                <span>{new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                <span style={{ color: '#e5e7eb' }}>·</span>
                <span>{content.split(/\s+/).filter(Boolean).length} words</span>
              </div>

              {/* Section word-count progress (Feature #6) */}
              {sections.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '16px' }}>
                  {sections.filter(s => s.level === 1).map((sec, i) => {
                    const target = getTargetWords(sec.heading);
                    if (target === 0) return null;
                    const pct = Math.min(100, Math.round((sec.wordCount / target) * 100));
                    const color = pct >= 80 ? '#059669' : pct >= 40 ? '#d97706' : '#d1d5db';
                    return (
                      <div key={i} style={{
                        display: 'flex', alignItems: 'center', gap: '6px',
                        padding: '3px 10px', borderRadius: '6px', backgroundColor: '#fafafa',
                        border: '1px solid #f0f0f0', fontSize: '11px', color: '#6b7280',
                      }}>
                        <span style={{ fontWeight: 500, color: '#374151', maxWidth: '100px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {sec.heading}
                        </span>
                        <div style={{ width: '40px', height: '4px', backgroundColor: '#f0f0f0', borderRadius: '2px', overflow: 'hidden' }}>
                          <div style={{ width: `${pct}%`, height: '100%', backgroundColor: color, borderRadius: '2px', transition: 'width 0.3s' }} />
                        </div>
                        <span>{sec.wordCount}/{target}</span>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Writing Quality Indicators (Feature #6) */}
              {isQualityOpen && content.trim().length > 50 && (
                <div style={{
                  marginBottom: '20px', padding: '14px 16px', borderRadius: '10px',
                  backgroundColor: '#fafafa', border: '1px solid #f0f0f0',
                }}>
                  {/* Overall */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '12px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span style={{ fontSize: '12px', color: '#6b7280' }}>Readability:</span>
                      <span style={{
                        fontSize: '12px', fontWeight: 600, padding: '2px 8px', borderRadius: '4px',
                        backgroundColor: overallQuality.readabilityScore <= 10 ? '#ecfdf5' : overallQuality.readabilityScore <= 13 ? '#fffbeb' : '#fef2f2',
                        color: overallQuality.readabilityScore <= 10 ? '#059669' : overallQuality.readabilityScore <= 13 ? '#d97706' : '#dc2626',
                      }}>
                        Grade {overallQuality.readabilityScore} · {overallQuality.readabilityLabel}
                      </span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span style={{ fontSize: '12px', color: '#6b7280' }}>Passive:</span>
                      <span style={{
                        fontSize: '12px', fontWeight: 600, padding: '2px 8px', borderRadius: '4px',
                        backgroundColor: overallQuality.passiveVoicePct <= 20 ? '#ecfdf5' : overallQuality.passiveVoicePct <= 40 ? '#fffbeb' : '#fef2f2',
                        color: overallQuality.passiveVoicePct <= 20 ? '#059669' : overallQuality.passiveVoicePct <= 40 ? '#d97706' : '#dc2626',
                      }}>
                        {overallQuality.passiveVoicePct}%
                      </span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span style={{ fontSize: '12px', color: '#6b7280' }}>Jargon:</span>
                      <span style={{
                        fontSize: '12px', fontWeight: 600, padding: '2px 8px', borderRadius: '4px',
                        backgroundColor: overallQuality.jargonDensity <= 15 ? '#ecfdf5' : overallQuality.jargonDensity <= 25 ? '#fffbeb' : '#fef2f2',
                        color: overallQuality.jargonDensity <= 15 ? '#059669' : overallQuality.jargonDensity <= 25 ? '#d97706' : '#dc2626',
                      }}>
                        {overallQuality.jargonDensity}%
                      </span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span style={{ fontSize: '12px', color: '#6b7280' }}>Avg sentence:</span>
                      <span style={{ fontSize: '12px', fontWeight: 600, color: '#374151' }}>
                        {overallQuality.avgSentenceLength} words
                      </span>
                    </div>
                  </div>

                  {/* Suggestions */}
                  {overallQuality.suggestions.length > 0 && (
                    <div style={{ marginBottom: '12px' }}>
                      {overallQuality.suggestions.map((s, i) => (
                        <div key={i} style={{ fontSize: '12px', color: '#d97706', lineHeight: 1.5, display: 'flex', alignItems: 'flex-start', gap: '6px' }}>
                          <span style={{ flexShrink: 0 }}>💡</span> {s}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Per-section quality */}
                  {Object.keys(sectionQuality).length > 0 && (
                    <div>
                      <div style={{ fontSize: '11px', fontWeight: 600, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '6px' }}>
                        Per section
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        {Object.entries(sectionQuality).map(([heading, q]) => (
                          <div key={heading} style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '11px', padding: '3px 0' }}>
                            <span style={{ fontWeight: 500, color: '#374151', width: '120px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {heading}
                            </span>
                            <span style={{
                              padding: '1px 6px', borderRadius: '3px', fontWeight: 600,
                              backgroundColor: q.readabilityScore <= 10 ? '#ecfdf5' : q.readabilityScore <= 13 ? '#fffbeb' : '#fef2f2',
                              color: q.readabilityScore <= 10 ? '#059669' : q.readabilityScore <= 13 ? '#d97706' : '#dc2626',
                            }}>
                              G{q.readabilityScore}
                            </span>
                            <span style={{
                              padding: '1px 6px', borderRadius: '3px',
                              color: q.passiveVoicePct <= 20 ? '#059669' : q.passiveVoicePct <= 40 ? '#d97706' : '#dc2626',
                            }}>
                              {q.passiveVoicePct}% passive
                            </span>
                            <span style={{ color: '#9ca3af' }}>
                              {q.jargonDensity}% jargon
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Empty state — guided ghost blocks */}
              {!content.trim() && (
                <div style={{ marginBottom: '24px' }}>
                  <div style={{ fontSize: '15px', color: '#c4c4c4', marginBottom: '20px', lineHeight: 1.6, fontFamily: "'Georgia', serif" }}>
                    Start writing your thinking here...
                  </div>
                  <div style={{ fontSize: '13px', color: '#d1d5db', marginBottom: '20px', lineHeight: 1.5 }}>
                    Highlight any text — yours or your sources — to bring in AI agents.
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '24px' }}>
                    {[
                      { label: 'Your thesis', hint: 'What are you arguing or exploring?' },
                      { label: 'Key arguments', hint: 'What evidence supports your position?' },
                      { label: 'Open questions', hint: 'What do you still need to figure out?' },
                    ].map((ghost, i) => (
                      <div key={i}
                        onClick={() => { setContent(`${ghost.label}\n`); }}
                        style={{
                          padding: '10px 14px', borderRadius: '8px', cursor: 'pointer',
                          border: '1px dashed #e5e7eb', backgroundColor: '#fafafa',
                          transition: 'all 0.15s',
                        }}
                        onMouseEnter={(e) => { e.currentTarget.style.borderColor = '#d1d5db'; e.currentTarget.style.backgroundColor = '#f5f5f5'; }}
                        onMouseLeave={(e) => { e.currentTarget.style.borderColor = '#e5e7eb'; e.currentTarget.style.backgroundColor = '#fafafa'; }}
                      >
                        <div style={{ fontSize: '13px', fontWeight: 600, color: '#d1d5db' }}>{ghost.label}</div>
                        <div style={{ fontSize: '12px', color: '#e5e7eb', marginTop: '2px' }}>{ghost.hint}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Editor */}
              <div ref={editorAreaRef} style={{ flex: 1, minHeight: '400px' }}>
                <MentionEditor
                  value={content}
                  onChange={setContent}
                  onFocus={() => setIsContentFocused(true)}
                  onBlur={() => setIsContentFocused(false)}
                  placeholder="Start writing..."
                  isFocused={isContentFocused}
                  style={{ fontSize: '16px', lineHeight: 1.75, fontFamily: "'Georgia', 'Times New Roman', serif", color: '#2d3748' }}
                />
              </div>

              {/* ── Semantic Matches Drawer (toggled from toolbar) ──── */}
              {showSemanticDrawer && semanticMatches.length > 0 && (
                <div style={{
                  marginTop: '12px', borderRadius: '10px', border: '1px solid #e0e7ff',
                  backgroundColor: '#fafbff', overflow: 'hidden',
                  animation: 'fadeIn 0.2s ease',
                }}>
                  <div style={{ padding: '8px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid #eef2ff' }}>
                    <span style={{ fontSize: '11px', fontWeight: 600, color: '#6366f1' }}>
                      Relevant passages from your sources
                    </span>
                    <button onClick={() => setShowSemanticDrawer(false)} style={{ border: 'none', background: 'none', color: '#a5b4fc', cursor: 'pointer', fontSize: '13px', padding: '0 4px' }}>×</button>
                  </div>
                  <div style={{ padding: '6px 8px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    {semanticMatches.slice(0, 4).map((m, i) => (
                      <div key={i} style={{
                        display: 'flex', alignItems: 'flex-start', gap: '8px', padding: '8px 10px',
                        borderRadius: '8px', backgroundColor: '#fff', border: '1px solid #eef2ff',
                        cursor: 'pointer', transition: 'all 0.12s',
                      }}
                        onMouseEnter={(e) => { e.currentTarget.style.borderColor = '#c7d2fe'; e.currentTarget.style.boxShadow = '0 1px 4px rgba(99,102,241,0.08)'; }}
                        onMouseLeave={(e) => { e.currentTarget.style.borderColor = '#eef2ff'; e.currentTarget.style.boxShadow = 'none'; }}
                        onClick={() => setContent(prev => prev + '\n\n> ' + m.text.slice(0, 200) + ` (${m.source_title})`)}
                      >
                        <div style={{
                          width: '32px', height: '32px', borderRadius: '8px', flexShrink: 0,
                          backgroundColor: '#eef2ff', display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: '11px', fontWeight: 700, color: '#6366f1',
                        }}>
                          {Math.round(m.similarity * 100)}%
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: '12px', lineHeight: 1.5, color: '#374151' }}>
                            {m.text.slice(0, 140)}{m.text.length > 140 ? '...' : ''}
                          </div>
                          <div style={{ fontSize: '10px', color: '#a5b4fc', marginTop: '3px', fontWeight: 500 }}>
                            {m.source_title} · {m.source_type} · click to cite
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
            </div>

            {/* Right: Source Panel (split view) */}
            {isSplitView && (
              <div style={{ flex: '1 1 50%', borderLeft: '2px solid #e5e7eb', overflow: 'hidden', display: 'flex', flexDirection: 'column', transition: 'flex 0.25s ease', position: 'relative' }}>
                <SourcePanel
                  isOpen={isSplitView}
                  sources={sourceMaterials}
                  onAddSource={handleAddSource}
                  onRemoveSource={handleRemoveSource}
                  onSelectionChange={handleSourceSelectionChange}
                  onUploadPDF={handleSourcePDFUpload}
                  onUploadAudio={handleSourceAudioUpload}
                  onDelegateAgent={handleDelegateAgent}
                  isLoadingPDF={isSourcePDFLoading}
                  isLoadingTranscript={isSourceTranscriptLoading}
                  loadingText={sourceLoadingText}
                />

                {/* Split-view onboarding tooltip */}
                {showSplitOnboarding && (
                  <div style={{
                    position: 'absolute', top: '50%', left: '-12px', transform: 'translate(-100%, -50%)',
                    backgroundColor: '#1e293b', color: '#e2e8f0', padding: '16px 20px',
                    borderRadius: '12px', boxShadow: '0 8px 32px rgba(0,0,0,0.25)',
                    maxWidth: '280px', zIndex: 50, animation: 'fadeIn 0.3s ease',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
                      <span style={{ fontSize: '18px' }}>✨</span>
                      <span style={{ fontSize: '14px', fontWeight: 700 }}>How Split View works</span>
                      <button onClick={() => setShowSplitOnboarding(false)} style={{ marginLeft: 'auto', border: 'none', background: 'none', color: '#64748b', cursor: 'pointer', fontSize: '16px' }}>×</button>
                    </div>
                    <div style={{ fontSize: '13px', lineHeight: 1.6, color: '#94a3b8' }}>
                      <div style={{ marginBottom: '8px' }}>
                        <strong style={{ color: '#e2e8f0' }}>Left</strong> = your thinking. <strong style={{ color: '#e2e8f0' }}>Right</strong> = your sources.
                      </div>
                      <div style={{ marginBottom: '8px' }}>
                        <strong style={{ color: '#f59e0b' }}>Highlight text on either side</strong> to summon AI agents that work across both panels.
                      </div>
                      <div style={{ fontSize: '12px', color: '#64748b' }}>
                        Agents find evidence, challenge claims, and surface connections — but you always do the writing.
                      </div>
                    </div>
                    <div style={{
                      position: 'absolute', top: '50%', right: '-6px', transform: 'translateY(-50%)',
                      width: 0, height: 0, borderTop: '6px solid transparent',
                      borderBottom: '6px solid transparent', borderLeft: '6px solid #1e293b',
                    }} />
                  </div>
                )}
              </div>
            )}

            {/* ── Deep Dive Panel (inline split) ───────────────────── */}
            {(deepDiveResult || isDeepDiving) && (
              <div style={{
                flex: '1 1 50%', borderLeft: '2px solid #e5e7eb', overflow: 'hidden',
                display: 'flex', flexDirection: 'column', transition: 'flex 0.25s ease',
                backgroundColor: '#fff',
              }}>
                {/* Header */}
                <div style={{
                  padding: '14px 20px', borderBottom: '1px solid #f0f0f0',
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  backgroundColor: '#faf5ff', flexShrink: 0,
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <span style={{ fontSize: '18px' }}>🔬</span>
                    <div>
                      <div style={{ fontSize: '14px', fontWeight: 700, color: '#1e293b' }}>Deep Dive</div>
                      {deepDiveResult && (
                        <div style={{ fontSize: '11px', color: '#7c3aed', fontWeight: 500 }}>
                          {deepDiveResult.papers_found} papers · {deepDiveResult.sources_searched} sources · {(deepDiveResult.total_duration_ms / 1000).toFixed(1)}s
                        </div>
                      )}
                    </div>
                  </div>
                  <button onClick={() => { setDeepDiveResult(null); setIsDeepDiving(false); setDeepDiveNextSteps([]); }}
                    style={{ border: 'none', background: 'none', color: '#9ca3af', cursor: 'pointer', fontSize: '20px', padding: '0 4px', lineHeight: 1 }}>×</button>
                </div>

                {/* Loading state */}
                {isDeepDiving && !deepDiveResult && (
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '20px', padding: '48px' }}>
                    <div style={{ width: '40px', height: '40px', border: '3px solid #e9d5ff', borderTopColor: '#7c3aed', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: '14px', fontWeight: 600, color: '#5b21b6', marginBottom: '6px' }}>Running research pipeline...</div>
                      <div style={{ fontSize: '12px', color: '#a78bfa', lineHeight: 1.6, maxWidth: '320px' }}>
                        Decompose → Semantic Scholar + Perplexity Sonar + Local Sources → Gap Detection → Synthesis
                      </div>
                    </div>
                  </div>
                )}

                {/* Results */}
                {deepDiveResult && (
                  <div style={{ flex: 1, overflow: 'auto' }}>
                    {/* Agent Pipeline Trace */}
                    <div style={{ padding: '14px 20px', borderBottom: '1px solid #f0f0f0' }}>
                      <div style={{ fontSize: '10px', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '10px' }}>
                        Pipeline Trace
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px' }}>
                        {deepDiveResult.trace.filter((t: any) => t.status === 'done').map((t: any, i: number) => {
                          const stepColors: Record<string, string> = {
                            decompose: '#7c3aed', search: '#2563eb', gap_detect: '#d97706', backfill: '#059669', synthesize: '#dc2626',
                          };
                          const baseStep = t.step.replace(/_q\d+$/, '').replace(/_result$/, '');
                          const color = stepColors[baseStep] || '#64748b';
                          return (
                            <span key={i} title={t.detail || t.title} style={{
                              padding: '3px 10px', borderRadius: '6px', fontSize: '10px', fontWeight: 600,
                              backgroundColor: `${color}12`, color, border: `1px solid ${color}25`,
                            }}>
                              {t.title.slice(0, 40)}{t.duration_ms ? ` · ${t.duration_ms}ms` : ''}
                            </span>
                          );
                        })}
                      </div>
                    </div>

                    {/* Sub-questions */}
                    {deepDiveResult.sub_questions?.length > 0 && (
                      <div style={{ padding: '14px 20px', borderBottom: '1px solid #f0f0f0' }}>
                        <div style={{ fontSize: '10px', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '10px' }}>
                          Sub-questions explored
                        </div>
                        {deepDiveResult.sub_questions.map((q: string, i: number) => (
                          <div key={i} style={{
                            fontSize: '13px', color: '#374151', lineHeight: 1.6, padding: '4px 0',
                            display: 'flex', gap: '10px', alignItems: 'flex-start',
                          }}>
                            <span style={{ fontSize: '11px', fontWeight: 700, color: '#7c3aed', flexShrink: 0, marginTop: '3px' }}>{i + 1}</span>
                            <span>{q}</span>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Knowledge Gaps */}
                    {deepDiveResult.gaps?.length > 0 && (
                      <div style={{ padding: '14px 20px', borderBottom: '1px solid #f0f0f0', backgroundColor: '#fffbeb' }}>
                        <div style={{ fontSize: '10px', fontWeight: 700, color: '#d97706', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '10px' }}>
                          Knowledge Gaps
                        </div>
                        {deepDiveResult.gaps.map((g: string, i: number) => (
                          <div key={i} style={{
                            fontSize: '13px', color: '#92400e', lineHeight: 1.6, padding: '4px 0',
                            display: 'flex', gap: '8px', alignItems: 'flex-start',
                          }}>
                            <span style={{ flexShrink: 0, marginTop: '2px', fontSize: '11px' }}>⚠</span>
                            <span>{g}</span>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Synthesis */}
                    <div style={{ padding: '20px', borderBottom: '1px solid #f0f0f0' }}>
                      <div style={{ fontSize: '10px', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '12px' }}>
                        Research Synthesis
                      </div>
                      <div style={{
                        fontSize: '14px', lineHeight: 1.85, color: '#374151',
                        fontFamily: "'Georgia', 'Times New Roman', serif",
                        whiteSpace: 'pre-wrap',
                      }}>
                        {deepDiveResult.synthesis}
                      </div>
                    </div>

                    {/* ── Next Steps — recursive agent pipeline ──────── */}
                    <div style={{ padding: '20px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
                        <div style={{ fontSize: '10px', fontWeight: 700, color: '#7c3aed', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                          Next Steps
                        </div>
                        {isLoadingNextSteps && (
                          <div style={{ width: '10px', height: '10px', border: '1.5px solid #e9d5ff', borderTopColor: '#7c3aed', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
                        )}
                        {!isLoadingNextSteps && deepDiveNextSteps.length > 0 && (
                          <span style={{ fontSize: '10px', color: '#a78bfa' }}>Click to delegate to agent</span>
                        )}
                      </div>

                      {isLoadingNextSteps && deepDiveNextSteps.length === 0 && (
                        <div style={{ fontSize: '12px', color: '#a78bfa', padding: '8px 0' }}>
                          Claude is analyzing the synthesis to generate actionable next steps...
                        </div>
                      )}

                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        {deepDiveNextSteps.map((step, i) => {
                          const actionColors: Record<string, { bg: string; border: string; text: string }> = {
                            evidence:    { bg: '#eff6ff', border: '#bfdbfe', text: '#1d4ed8' },
                            challenge:   { bg: '#fef2f2', border: '#fecaca', text: '#b91c1c' },
                            'deep-dive': { bg: '#f5f3ff', border: '#ddd6fe', text: '#7c3aed' },
                            socratic:    { bg: '#f5f3ff', border: '#ddd6fe', text: '#7c3aed' },
                            steelman:    { bg: '#ecfdf5', border: '#a7f3d0', text: '#047857' },
                          };
                          const colors = actionColors[step.action] || actionColors.evidence;
                          return (
                            <div key={i}
                              onClick={() => {
                                if (step.action === 'deep-dive') {
                                  handleDeepDive(step.query);
                                } else if (step.action === 'evidence') {
                                  callEvidence(step.query);
                                } else {
                                  callAgent(step.action as any, step.query);
                                }
                              }}
                              style={{
                                padding: '12px 14px', borderRadius: '10px', cursor: 'pointer',
                                backgroundColor: colors.bg, border: `1px solid ${colors.border}`,
                                transition: 'all 0.12s',
                              }}
                              onMouseEnter={(e) => { e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.06)'; e.currentTarget.style.transform = 'translateY(-1px)'; }}
                              onMouseLeave={(e) => { e.currentTarget.style.boxShadow = 'none'; e.currentTarget.style.transform = 'none'; }}
                            >
                              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                                <span style={{ fontSize: '14px' }}>{step.icon}</span>
                                <span style={{ fontSize: '11px', fontWeight: 700, color: colors.text, textTransform: 'uppercase', letterSpacing: '0.3px' }}>
                                  {step.action.replace('-', ' ')}
                                </span>
                                {step.priority === 'high' && (
                                  <span style={{ fontSize: '9px', fontWeight: 700, color: '#dc2626', backgroundColor: '#fef2f2', padding: '1px 6px', borderRadius: '4px', marginLeft: 'auto' }}>HIGH</span>
                                )}
                              </div>
                              <div style={{ fontSize: '13px', color: '#374151', lineHeight: 1.5 }}>
                                {step.query}
                              </div>
                              <div style={{ fontSize: '11px', color: '#9ca3af', marginTop: '4px' }}>
                                {step.rationale}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* ── Pinned Selection Indicator ──────────────────────────── */}
        {pinnedSelection && (
          <div style={{
            position: 'fixed', bottom: '24px', right: '24px', zIndex: 100,
            backgroundColor: '#111827', color: '#e2e8f0', padding: '10px 16px',
            borderRadius: '10px', boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
            maxWidth: '280px', fontSize: '13px', animation: 'fadeIn 0.2s ease',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
              <span>🔗</span>
              <span style={{ fontWeight: 600, color: '#ed8936' }}>Block pinned</span>
              <button onClick={() => setPinnedSelection(null)} style={{ marginLeft: 'auto', border: 'none', background: 'none', color: '#9ca3af', cursor: 'pointer', fontSize: '14px', padding: '0 4px' }}>×</button>
            </div>
            <div style={{ color: '#9ca3af', fontSize: '12px', lineHeight: 1.4 }}>
              "{pinnedSelection.slice(0, 60)}{pinnedSelection.length > 60 ? '...' : ''}"
            </div>
            <div style={{ color: '#6b7280', fontSize: '11px', marginTop: '6px' }}>
              Select another block and click <strong style={{ color: '#ed8936' }}>Connect</strong>.
            </div>
          </div>
        )}

        {/* ── Transcription Panel (left side) ─────────────────────── */}
        <TranscriptionPanel
          isOpen={isTranscriptionOpen}
          onClose={() => setIsTranscriptionOpen(false)}
          results={transcriptionResults}
          isLoading={isTranscribing}
          loadingText={transcribeLoadingText}
          onInsertTranscript={handleInsertTranscript}
          onInsertClaim={handleInsertClaim}
          onFindEvidence={handleFindEvidenceForClaim}
        />

        {/* ── Citations Panel (left side) ─────────────────────────── */}
        <CitationsPanel
          isOpen={isCitationsOpen}
          onClose={() => setIsCitationsOpen(false)}
          results={citationResults}
          isLoading={isCitationsLoading}
          loadingText={citationsLoadingText}
          onInsertCitation={handleInsertCitation}
          onInsertAll={handleInsertAllCitations}
        />

        {/* ── Selection Toolbar ───────────────────────────────────── */}
        <SelectionToolbar
          selectedText={selectedText}
          position={toolbarPosition}
          onAction={handleSelectionAction}
          onDismiss={() => setToolbarPosition(null)}
          hasSecondSelection={!!pinnedSelection}
        />

        {/* ── AI Chat Sidebar ─────────────────────────────────────── */}
        <AIChatSidebar
          isOpen={isSidebarOpen}
          onClose={() => setIsSidebarOpen(false)}
          messages={chatMessages}
          onSendMessage={handleChatSend}
          onInsertToDoc={handleInsertToDoc}
          isLoading={isChatLoading}
          documentTitle={title}
        />

        {/* ── Claim Tracker (right side) ──────────────────────────── */}
        <ClaimTracker
          isOpen={isClaimTrackerOpen}
          onClose={() => setIsClaimTrackerOpen(false)}
          content={content}
          citationResults={citationResults}
          footnotes={footnotes}
          onFindEvidence={handleFindEvidenceForClaim}
        />

        {/* ── Argument Map (modal overlay) ────────────────────────── */}
        <ArgumentMap
          isOpen={isArgumentMapOpen}
          onClose={() => setIsArgumentMapOpen(false)}
          citationResults={citationResults}
        />
      </div>
    </>
  );
};

export default DocumentEditor;
