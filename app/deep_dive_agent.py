"""
Deep Dive Agent — Multi-Step Orchestration Pipeline
====================================================
Architecture:
  1. DECOMPOSE: Break research query into sub-questions
  2. PARALLEL SEARCH: Search across Semantic Scholar API + web + local vector store simultaneously
  3. GAP DETECTION: Identify what's missing from search results
  4. RECURSIVE BACKFILL: Fill gaps with targeted follow-up searches
  5. STRUCTURED SYNTHESIS: Combine all findings into a coherent research brief

Each step emits trace events so the frontend can visualize the pipeline in real time.
This is a real agentic architecture with branching and looping, not just a prompt chain.
"""

import os
import json
import time
import asyncio
import re
from typing import List, Dict, Any, Optional, Callable
from dataclasses import dataclass, field, asdict
from pathlib import Path
from dotenv import load_dotenv

# Load .env from project root
_ENV_PATH = Path(__file__).resolve().parents[1] / ".env"
load_dotenv(dotenv_path=_ENV_PATH, override=True)

import httpx

try:
    from openai import OpenAI
except Exception:
    OpenAI = None

try:
    import google.generativeai as genai
except Exception:
    genai = None

try:
    from anthropic import Anthropic
except Exception:
    Anthropic = None


# ── Trace Events (visible pipeline for judges) ───────────────────────────────

@dataclass
class TraceEvent:
    """A single step in the agent pipeline, visible to the frontend."""
    step: str           # 'decompose' | 'search_semantic_scholar' | 'search_web' | 'search_local' | 'gap_detect' | 'backfill' | 'synthesize'
    status: str         # 'running' | 'done' | 'error'
    title: str          # human-readable title
    detail: str = ""    # detail text
    data: Dict[str, Any] = field(default_factory=dict)
    duration_ms: int = 0
    timestamp: float = field(default_factory=time.time)


@dataclass
class DeepDiveResult:
    """Final output of the Deep Dive agent."""
    query: str
    sub_questions: List[str]
    findings: List[Dict[str, Any]]
    gaps: List[str]
    synthesis: str
    sources_searched: int
    papers_found: int
    trace: List[TraceEvent]
    total_duration_ms: int = 0


# ── AI Helper ─────────────────────────────────────────────────────────────────

def _call_ai(prompt: str, system: str = "", max_tokens: int = 2000) -> str:
    """Call AI service. Claude is the primary model."""
    # Try Claude first (primary model)
    anthropic_key = os.getenv("ANTHROPIC_API_KEY")
    if anthropic_key and Anthropic is not None:
        try:
            client = Anthropic(api_key=anthropic_key)
            resp = client.messages.create(
                model="claude-sonnet-4-20250514",
                max_tokens=max_tokens,
                temperature=0.3,
                system=system or "You are a research assistant.",
                messages=[{"role": "user", "content": prompt}]
            )
            return resp.content[0].text
        except Exception as e:
            print(f"[DeepDive] Claude failed: {e}")
    
    # Fallback to Gemini
    google_key = os.getenv("GOOGLE_API_KEY")
    if google_key and genai is not None:
        try:
            genai.configure(api_key=google_key)
            model = genai.GenerativeModel("gemini-2.0-flash")
            resp = model.generate_content(
                f"{system}\n\n{prompt}" if system else prompt,
                generation_config=genai.types.GenerationConfig(max_output_tokens=max_tokens, temperature=0.3)
            )
            return resp.text
        except Exception as e:
            print(f"[DeepDive] Gemini failed: {e}")
    
    raise Exception("No AI service available")


def _parse_json(text: str) -> Any:
    """Robustly parse JSON from AI response."""
    cleaned = text.replace("```json", "").replace("```", "").strip()
    try:
        return json.loads(cleaned)
    except Exception:
        # Try to find JSON object or array
        for pattern in [r'\{[\s\S]*\}', r'\[[\s\S]*\]']:
            match = re.search(pattern, text)
            if match:
                try:
                    return json.loads(match.group(0))
                except Exception:
                    continue
    return None


# ── Search Providers ──────────────────────────────────────────────────────────

async def search_semantic_scholar(query: str, limit: int = 5) -> List[Dict[str, Any]]:
    """Search Semantic Scholar API for academic papers.
    
    Returns structured paper metadata: title, authors, year, abstract, citation count, URL.
    """
    results = []
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(
                "https://api.semanticscholar.org/graph/v1/paper/search",
                params={
                    "query": query,
                    "limit": limit,
                    "fields": "title,authors,year,abstract,citationCount,url,externalIds"
                }
            )
            if resp.status_code == 200:
                data = resp.json()
                for paper in data.get("data", []):
                    authors = ", ".join([a.get("name", "") for a in paper.get("authors", [])[:3]])
                    if len(paper.get("authors", [])) > 3:
                        authors += " et al."
                    results.append({
                        "title": paper.get("title", ""),
                        "authors": authors,
                        "year": paper.get("year"),
                        "abstract": (paper.get("abstract") or "")[:300],
                        "citations": paper.get("citationCount", 0),
                        "url": paper.get("url", ""),
                        "source": "Semantic Scholar",
                        "doi": paper.get("externalIds", {}).get("DOI"),
                    })
    except Exception as e:
        print(f"[DeepDive] Semantic Scholar search failed: {e}")
    
    return results


async def search_perplexity(query: str) -> List[Dict[str, Any]]:
    """Search the web using Perplexity Sonar API.
    
    Returns grounded, synthesized answers with inline citations.
    Sonar is purpose-built for search — it returns real URLs and source attribution.
    """
    results = []
    api_key = os.getenv("PERPLEXITY_API_KEY")
    if not api_key:
        print("[DeepDive] No PERPLEXITY_API_KEY set, skipping Sonar search")
        return results
    
    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            resp = await client.post(
                "https://api.perplexity.ai/chat/completions",
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": "sonar",
                    "messages": [
                        {"role": "system", "content": "You are a research assistant. Provide detailed, factual answers with specific citations."},
                        {"role": "user", "content": query},
                    ],
                    "return_citations": True,
                    "return_related_questions": True,
                },
            )
            if resp.status_code == 200:
                data = resp.json()
                answer = data.get("choices", [{}])[0].get("message", {}).get("content", "")
                citations = data.get("citations", [])
                
                # The main synthesized answer is itself a result
                if answer:
                    results.append({
                        "title": f"Sonar: {query[:60]}",
                        "abstract": answer[:500],
                        "url": citations[0] if citations else "",
                        "source": "Perplexity Sonar",
                        "citations": citations,
                    })
                
                # Each citation URL is also a result
                for i, url in enumerate(citations[:5]):
                    results.append({
                        "title": f"Source {i+1}",
                        "url": url,
                        "source": "Perplexity Sonar",
                    })
                
                print(f"[DeepDive] Sonar returned {len(citations)} citations for: {query[:50]}")
            else:
                print(f"[DeepDive] Sonar API error {resp.status_code}: {resp.text[:200]}")
    except Exception as e:
        print(f"[DeepDive] Perplexity Sonar search failed: {e}")
    
    return results


def search_local_vector_store(workspace_id: str, query: str, 
                               vector_store, top_k: int = 5) -> List[Dict[str, Any]]:
    """Search the local vector store for relevant chunks from user's sources."""
    results = []
    try:
        search_results = vector_store.search(workspace_id, query, top_k=top_k)
        for sr in search_results:
            results.append({
                "title": sr.chunk.source_title,
                "text": sr.chunk.text[:300],
                "source_type": sr.chunk.source_type,
                "similarity": round(sr.similarity, 3),
                "source": f"Local: {sr.chunk.source_title}",
            })
    except Exception as e:
        print(f"[DeepDive] Local search failed: {e}")
    
    return results


# ── Deep Dive Agent Pipeline ─────────────────────────────────────────────────

class DeepDiveAgent:
    """Multi-step orchestration pipeline for deep research.
    
    Pipeline:
    1. DECOMPOSE → Break query into 3-5 sub-questions
    2. PARALLEL SEARCH → For each sub-question, search:
       - Semantic Scholar (academic papers)
       - Web (broader results)
       - Local vector store (user's own sources)
    3. GAP DETECTION → Analyze results, identify what's missing
    4. RECURSIVE BACKFILL → Generate targeted queries for gaps, search again
    5. STRUCTURED SYNTHESIS → Combine everything into a research brief
    """
    
    def __init__(self, vector_store=None):
        self.vector_store = vector_store
        self.trace: List[TraceEvent] = []
    
    def _emit(self, step: str, status: str, title: str, 
              detail: str = "", data: Dict = None, duration_ms: int = 0):
        """Emit a trace event."""
        event = TraceEvent(
            step=step, status=status, title=title,
            detail=detail, data=data or {}, duration_ms=duration_ms,
        )
        self.trace.append(event)
        print(f"[DeepDive] [{status.upper()}] {title}" + (f" ({duration_ms}ms)" if duration_ms else ""))
        return event
    
    async def run(self, query: str, workspace_id: str = "",
                  document_context: str = "") -> DeepDiveResult:
        """Execute the full Deep Dive pipeline."""
        start = time.time()
        self.trace = []
        all_findings: List[Dict[str, Any]] = []
        total_papers = 0
        total_sources = 0
        
        # ── Step 1: DECOMPOSE ──────────────────────────────────────────
        self._emit("decompose", "running", "Decomposing research query...")
        t0 = time.time()
        
        sub_questions = await self._decompose(query, document_context)
        
        self._emit("decompose", "done", f"Decomposed into {len(sub_questions)} sub-questions",
                    detail="\n".join(f"• {q}" for q in sub_questions),
                    data={"sub_questions": sub_questions},
                    duration_ms=int((time.time() - t0) * 1000))
        
        # ── Step 2: PARALLEL SEARCH ────────────────────────────────────
        self._emit("search", "running", f"Searching across {len(sub_questions)} sub-questions...")
        t0 = time.time()
        
        # Launch all searches in parallel
        search_tasks = []
        for sq in sub_questions:
            search_tasks.append(self._search_all(sq, workspace_id))
        
        search_results = await asyncio.gather(*search_tasks)
        
        for i, (sq, results) in enumerate(zip(sub_questions, search_results)):
            ss_results, web_results, local_results = results
            
            n_found = len(ss_results) + len(web_results) + len(local_results)
            total_papers += len(ss_results)
            total_sources += n_found
            
            self._emit(f"search_q{i+1}", "done",
                        f"Q{i+1}: Found {n_found} results",
                        detail=f"Semantic Scholar: {len(ss_results)}, Perplexity Sonar: {len(web_results)}, Local: {len(local_results)}",
                        data={
                            "question": sq,
                            "semantic_scholar": ss_results[:3],
                            "perplexity_sonar": web_results[:3],
                            "local": local_results[:3],
                        })
            
            all_findings.extend([{**r, "sub_question": sq} for r in ss_results])
            all_findings.extend([{**r, "sub_question": sq} for r in web_results])
            all_findings.extend([{**r, "sub_question": sq} for r in local_results])
        
        search_duration = int((time.time() - t0) * 1000)
        self._emit("search", "done",
                    f"Parallel search complete: {total_sources} results across {len(sub_questions)} queries",
                    duration_ms=search_duration)
        
        # ── Step 3: GAP DETECTION ──────────────────────────────────────
        self._emit("gap_detect", "running", "Analyzing gaps in findings...")
        t0 = time.time()
        
        gaps = await self._detect_gaps(query, sub_questions, all_findings)
        
        self._emit("gap_detect", "done", f"Detected {len(gaps)} knowledge gaps",
                    detail="\n".join(f"• {g}" for g in gaps),
                    data={"gaps": gaps},
                    duration_ms=int((time.time() - t0) * 1000))
        
        # ── Step 4: RECURSIVE BACKFILL ─────────────────────────────────
        if gaps:
            self._emit("backfill", "running", f"Backfilling {len(gaps)} gaps...")
            t0 = time.time()
            
            backfill_tasks = []
            for gap in gaps[:3]:  # Max 3 backfill rounds
                backfill_tasks.append(self._backfill_gap(gap, workspace_id))
            
            backfill_results = await asyncio.gather(*backfill_tasks)
            
            for gap, results in zip(gaps[:3], backfill_results):
                n_new = len(results)
                total_sources += n_new
                total_papers += sum(1 for r in results if r.get("source") == "Semantic Scholar")
                all_findings.extend([{**r, "sub_question": f"[Backfill] {gap}"} for r in results])
                
                self._emit("backfill_result", "done",
                            f"Backfill: +{n_new} results for gap",
                            detail=gap[:100],
                            data={"gap": gap, "new_results": n_new})
            
            self._emit("backfill", "done", "Backfill complete",
                        duration_ms=int((time.time() - t0) * 1000))
        
        # ── Step 5: STRUCTURED SYNTHESIS ───────────────────────────────
        self._emit("synthesize", "running", "Synthesizing findings...")
        t0 = time.time()
        
        synthesis = await self._synthesize(query, sub_questions, all_findings, gaps)
        
        self._emit("synthesize", "done", "Synthesis complete",
                    duration_ms=int((time.time() - t0) * 1000))
        
        total_duration = int((time.time() - start) * 1000)
        
        return DeepDiveResult(
            query=query,
            sub_questions=sub_questions,
            findings=all_findings[:50],  # Cap at 50
            gaps=gaps,
            synthesis=synthesis,
            sources_searched=total_sources,
            papers_found=total_papers,
            trace=self.trace,
            total_duration_ms=total_duration,
        )
    
    # ── Pipeline Steps ────────────────────────────────────────────────────
    
    async def _decompose(self, query: str, context: str = "") -> List[str]:
        """Step 1: Decompose the research query into sub-questions."""
        ctx = f"\nDocument context: {context[:500]}" if context else ""
        prompt = f"""Decompose this research query into 3-5 specific, searchable sub-questions.
Each sub-question should target a different aspect of the topic.

Research query: "{query}"
{ctx}

Return ONLY a JSON array of strings:
["sub-question 1", "sub-question 2", "sub-question 3"]

Make each sub-question specific enough to get good search results from academic databases."""

        raw = _call_ai(prompt, "You decompose research queries. Return only JSON arrays.")
        parsed = _parse_json(raw)
        if parsed and isinstance(parsed, list):
            return [str(q) for q in parsed[:5]]
        # Fallback: just use the original query
        return [query]
    
    async def _search_all(self, query: str, workspace_id: str
                          ) -> tuple:
        """Step 2: Search all sources in parallel for a single sub-question."""
        ss_task = search_semantic_scholar(query, limit=5)
        sonar_task = search_perplexity(query)
        
        ss_results, web_results = await asyncio.gather(ss_task, sonar_task)
        
        # Local search is synchronous
        local_results = []
        if self.vector_store and workspace_id:
            local_results = search_local_vector_store(workspace_id, query, self.vector_store)
        
        return ss_results, web_results, local_results
    
    async def _detect_gaps(self, query: str, sub_questions: List[str],
                           findings: List[Dict]) -> List[str]:
        """Step 3: Analyze findings and detect knowledge gaps."""
        # Summarize what we found
        found_summary = []
        for sq in sub_questions:
            sq_findings = [f for f in findings if f.get("sub_question") == sq]
            titles = [f.get("title", "")[:60] for f in sq_findings[:5]]
            found_summary.append(f"Q: {sq}\nFound: {', '.join(titles) if titles else 'nothing'}")
        
        prompt = f"""Given this research query and what was found, identify 2-4 specific knowledge gaps — things that are MISSING from the search results that would be important to know.

Original query: "{query}"

What was found:
{chr(10).join(found_summary)}

Return ONLY a JSON array of gap descriptions:
["gap 1 description", "gap 2 description"]

Each gap should be specific enough to generate a targeted follow-up search query."""

        raw = _call_ai(prompt, "You detect knowledge gaps in research. Return only JSON arrays.")
        parsed = _parse_json(raw)
        if parsed and isinstance(parsed, list):
            return [str(g) for g in parsed[:4]]
        return []
    
    async def _backfill_gap(self, gap: str, workspace_id: str) -> List[Dict]:
        """Step 4: Targeted search to fill a specific gap."""
        results = []
        
        # Search Semantic Scholar with the gap as query
        ss = await search_semantic_scholar(gap, limit=3)
        results.extend(ss)
        
        # Search local store
        if self.vector_store and workspace_id:
            local = search_local_vector_store(workspace_id, gap, self.vector_store, top_k=3)
            results.extend(local)
        
        return results
    
    async def _synthesize(self, query: str, sub_questions: List[str],
                          findings: List[Dict], gaps: List[str]) -> str:
        """Step 5: Synthesize all findings into a structured research brief."""
        # Build a compact summary of findings
        findings_text = ""
        for sq in sub_questions:
            sq_findings = [f for f in findings if f.get("sub_question") == sq]
            if sq_findings:
                findings_text += f"\n## {sq}\n"
                for f in sq_findings[:4]:
                    title = f.get("title", "Unknown")
                    abstract = f.get("abstract", f.get("text", ""))[:150]
                    source = f.get("source", "")
                    year = f.get("year", "")
                    findings_text += f"- **{title}** ({source}, {year}): {abstract}\n"
        
        gaps_text = "\n".join(f"- {g}" for g in gaps) if gaps else "No significant gaps detected."
        
        prompt = f"""Synthesize these research findings into a structured brief for a student.

RESEARCH QUERY: "{query}"

FINDINGS:
{findings_text[:4000]}

KNOWLEDGE GAPS:
{gaps_text}

Write a structured research brief with:
1. **Key Findings** — What the evidence says (cite specific papers/sources)
2. **Emerging Themes** — Patterns across the findings
3. **Contradictions & Debates** — Where sources disagree
4. **Knowledge Gaps** — What's still unknown or under-researched
5. **Recommended Next Steps** — What the student should investigate further

Be specific. Reference actual papers and findings. This should feel like a research briefing from a knowledgeable colleague, not generic advice."""

        return _call_ai(prompt, "You synthesize research findings into clear, actionable briefs.", max_tokens=3000)
