import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import AIChatSidebar, { ChatMessage } from './AIChatSidebar';
import CitationsPanel, { EvidenceResult, Citation, CitationFormat } from './CitationsPanel';
import TranscriptionPanel, { TranscriptionResult, Claim } from './TranscriptionPanel';
import ClaimTracker from './ClaimTracker';
import ArgumentMap from './ArgumentMap';
import MentionEditor from './MentionEditor';
import SelectionToolbar, { SelectionAction } from './SelectionToolbar';
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
  const titleRef = useRef<HTMLInputElement>(null);
  const editorAreaRef = useRef<HTMLDivElement>(null);

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
      if (sel && !sel.isCollapsed && sel.toString().trim() && editorAreaRef.current?.contains(sel.anchorNode)) {
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
        body: JSON.stringify({ action: 'evidence', selected_text: text, document_context: content + sectionContext }),
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
        body: JSON.stringify({ action, selected_text: text, selected_text_2: text2 || '', document_context: content + sectionContext }),
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
  }, [content, addMessage, updateMessage, callEvidence]);

  // ── Handle selection toolbar action ───────────────────────────────
  const handleSelectionAction = useCallback(async (action: SelectionAction, text: string) => {
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
  }, [pinnedSelection, callAgent]);

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
        body: JSON.stringify({ action: 'eli5', selected_text: message, document_context: content }),
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
  }, [content, addMessage, updateMessage]);

  // ── Insert AI result into document ────────────────────────────────
  const handleInsertToDoc = useCallback((text: string) => {
    setContent(prev => prev + '\n\n' + text);
  }, []);

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
      // Insert footnote marker + rebuild References
      setContent(prevContent => {
        // Remove old References section if present
        const refIdx = prevContent.lastIndexOf('\nReferences\n');
        const base = refIdx >= 0 ? prevContent.slice(0, refIdx) : prevContent;
        const refSection = '\n\nReferences\n' + newFootnotes.map((f, i) => `[${i + 1}] ${f}`).join('\n');
        return base + ` [${n}]` + refSection;
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
        return base + ' ' + markers + refSection;
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
        handlePDFFile(file);
      } else {
        handleTranscribeFile(file);
      }
    }
  }, [handleTranscribeFile, handlePDFFile]);

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
            if (file.name.toLowerCase().endsWith('.pdf')) handlePDFFile(file);
            else handleTranscribeFile(file);
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
          <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 20px', backgroundColor: '#fff', borderBottom: '1px solid #f0f0f0', minHeight: '48px', flexShrink: 0, position: 'sticky', top: 0, zIndex: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              {/* Back to home */}
              <button onClick={() => navigate('/')}
                style={{ display: 'flex', alignItems: 'center', gap: '6px', border: 'none', background: 'none', cursor: 'pointer', padding: '4px 8px', borderRadius: '6px', color: '#6b7280', fontSize: '13px', fontWeight: 500, transition: 'all 0.12s' }}
                onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#f3f4f6'; e.currentTarget.style.color = '#1a202c'; }}
                onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = '#6b7280'; }}
              >
                <span style={{ fontSize: '16px' }}>←</span>
                <div style={{ width: '20px', height: '20px', borderRadius: '4px', background: 'linear-gradient(135deg, #4a5568 0%, #2d3748 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontSize: '9px', fontWeight: 700 }}>S</div>
              </button>

              <div style={{ width: '1px', height: '20px', backgroundColor: '#f0f0f0' }} />

              {/* Transcriptions toggle */}
              <button onClick={() => setIsTranscriptionOpen(!isTranscriptionOpen)}
                title="Transcriptions"
                style={{
                  height: '32px', padding: '0 12px', border: '1px solid #e5e7eb', borderRadius: '6px',
                  backgroundColor: isTranscriptionOpen ? '#f0f0f0' : '#fff', fontSize: '13px', fontWeight: 500,
                  color: '#374151', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px',
                  transition: 'all 0.15s',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#f3f4f6'; }}
                onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = isTranscriptionOpen ? '#f0f0f0' : '#fff'; }}
              >
                🎙️ Transcripts
                {transcriptionResults.length > 0 && (
                  <span style={{ fontSize: '11px', backgroundColor: '#e0e7ff', color: '#4338ca', padding: '1px 6px', borderRadius: '8px' }}>
                    {transcriptionResults.length}
                  </span>
                )}
                {isTranscribing && (
                  <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#3b82f6', animation: 'fadeIn 0.5s ease infinite alternate' }} />
                )}
              </button>

              {/* Sources toggle */}
              <button onClick={() => setIsCitationsOpen(!isCitationsOpen)}
                title="Sources & Citations"
                style={{
                  height: '32px', padding: '0 12px', border: '1px solid #e5e7eb', borderRadius: '6px',
                  backgroundColor: isCitationsOpen ? '#f0f0f0' : '#fff', fontSize: '13px', fontWeight: 500,
                  color: '#374151', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px',
                  transition: 'all 0.15s',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#f3f4f6'; }}
                onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = isCitationsOpen ? '#f0f0f0' : '#fff'; }}
              >
                🔍 Sources
                {citationResults.length > 0 && (
                  <span style={{ fontSize: '11px', backgroundColor: '#dbeafe', color: '#1d4ed8', padding: '1px 6px', borderRadius: '8px' }}>
                    {citationResults.reduce((n, r) => n + r.sources.length, 0)}
                  </span>
                )}
              </button>

              {/* AI Chat toggle */}
              <button onClick={() => setIsSidebarOpen(!isSidebarOpen)}
                title="AI Chat"
                style={{
                  height: '32px', padding: '0 12px', border: '1px solid #e5e7eb', borderRadius: '6px',
                  backgroundColor: isSidebarOpen ? '#f0f0f0' : '#fff', fontSize: '13px', fontWeight: 500,
                  color: '#374151', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px',
                  transition: 'all 0.15s',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#f3f4f6'; }}
                onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = isSidebarOpen ? '#f0f0f0' : '#fff'; }}
              >
                🧠 Chat
                {chatMessages.length > 0 && (
                  <span style={{ fontSize: '11px', backgroundColor: '#e5e7eb', color: '#4a5568', padding: '1px 6px', borderRadius: '8px' }}>
                    {chatMessages.filter(m => m.role === 'agent' && !m.isLoading).length}
                  </span>
                )}
              </button>

              {/* Claim Tracker toggle */}
              <button onClick={() => setIsClaimTrackerOpen(!isClaimTrackerOpen)}
                title="Claim Tracker"
                style={{
                  height: '32px', padding: '0 12px', border: '1px solid #e5e7eb', borderRadius: '6px',
                  backgroundColor: isClaimTrackerOpen ? '#f0f0f0' : '#fff', fontSize: '13px', fontWeight: 500,
                  color: '#374151', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px',
                  transition: 'all 0.15s',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#f3f4f6'; }}
                onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = isClaimTrackerOpen ? '#f0f0f0' : '#fff'; }}
              >
                📋 Claims
              </button>

              {/* Argument Map */}
              <button onClick={() => setIsArgumentMapOpen(true)}
                title="Argument Map — visualize claims and sources"
                style={{
                  height: '32px', padding: '0 12px', border: '1px solid #e5e7eb', borderRadius: '6px',
                  backgroundColor: '#fff', fontSize: '13px', fontWeight: 500,
                  color: '#374151', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px',
                  transition: 'all 0.15s',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#f3f4f6'; }}
                onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = '#fff'; }}
              >
                🗺️ Map
                {citationResults.length > 0 && (
                  <span style={{ fontSize: '11px', backgroundColor: '#dbeafe', color: '#1e40af', padding: '1px 6px', borderRadius: '8px' }}>
                    {citationResults.length}
                  </span>
                )}
              </button>

              {/* Writing Quality toggle */}
              <button onClick={() => setIsQualityOpen(!isQualityOpen)}
                title="Writing quality indicators"
                style={{
                  height: '32px', padding: '0 12px', border: '1px solid #e5e7eb', borderRadius: '6px',
                  backgroundColor: isQualityOpen ? '#f0f0f0' : '#fff', fontSize: '13px', fontWeight: 500,
                  color: '#374151', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px',
                  transition: 'all 0.15s',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#f3f4f6'; }}
                onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = isQualityOpen ? '#f0f0f0' : '#fff'; }}
              >
                📊 Quality
              </button>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '12px', fontWeight: 500, color: saveStatus === 'saved' ? '#059669' : saveStatus === 'saving' ? '#d97706' : '#dc2626' }}>
                {saveStatus === 'saving' ? 'Saving...' : saveStatus === 'saved' ? '✓ Saved' : saveStatus === 'error' ? 'Error' : 'Unsaved'}
              </span>
              <button onClick={handleExportDOCX}
                title="Export as Word document"
                style={{ padding: '5px 12px', border: '1px solid #e5e7eb', borderRadius: '6px', backgroundColor: '#fff', fontSize: '13px', color: '#374151', cursor: 'pointer', fontWeight: 500, display: 'flex', alignItems: 'center', gap: '5px' }}
                onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#f9fafb'; }}
                onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = '#fff'; }}
              >DOCX</button>
              <button onClick={handleExportPDF}
                title="Export as PDF"
                style={{ padding: '5px 12px', border: '1px solid #e5e7eb', borderRadius: '6px', backgroundColor: '#fff', fontSize: '13px', color: '#374151', cursor: 'pointer', fontWeight: 500, display: 'flex', alignItems: 'center', gap: '5px' }}
                onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#f9fafb'; }}
                onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = '#fff'; }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
                PDF
              </button>
              <button onClick={handleSaveDraft}
                style={{ padding: '5px 12px', border: '1px solid #e5e7eb', borderRadius: '6px', backgroundColor: '#fff', fontSize: '13px', color: '#374151', cursor: 'pointer', fontWeight: 500 }}
                onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#f9fafb'; }}
                onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = '#fff'; }}
              >Save</button>
            </div>
          </header>

          {/* Editor body */}
          <div style={{ flex: 1, display: 'flex', justifyContent: 'center', overflow: 'auto' }}>
            <div style={{ width: '100%', maxWidth: '720px', padding: '48px 40px 120px', minHeight: 'calc(100vh - 48px)' }}>
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

              {/* Tip */}
              {!content.trim() && (
                <div style={{ fontSize: '14px', color: '#c4c4c4', marginBottom: '24px', lineHeight: 1.6 }}>
                  Start writing, then select text to summon specialized AI agents — find evidence, challenge ideas, simplify, or ask Socratic questions.
                  <br />
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', marginTop: '8px' }}>
                    📎 <button
                      onClick={() => fileInputRef.current?.click()}
                      style={{ border: 'none', background: 'none', color: '#6366f1', cursor: 'pointer', textDecoration: 'underline', fontSize: '14px', padding: 0 }}
                    >
                      Upload a recording or PDF
                    </button>
                    <span> — or drag & drop to transcribe interviews or extract references.</span>
                  </span>
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
            </div>
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
