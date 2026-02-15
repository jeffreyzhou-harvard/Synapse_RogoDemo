"""
Synapse Verification Engine — 6-step claim verification pipeline.

Steps:
1. Claim Decomposition → atomic sub-claims
2. Multi-Source Evidence Retrieval (Semantic Scholar, Perplexity Sonar, counter-evidence)
3. Evidence Quality Evaluation
4. Verdict Synthesis
5. Provenance Tracing
6. Corrected Claim Generation

Each step emits structured events for SSE streaming to the frontend.
"""

from __future__ import annotations
import os, json, time, re, hashlib
from typing import List, Dict, Any, Optional, Generator
from dataclasses import dataclass, field, asdict
from enum import Enum
import httpx

# ---------------------------------------------------------------------------
# Data models
# ---------------------------------------------------------------------------

class Verdict(str, Enum):
    SUPPORTED = "supported"
    PARTIALLY_SUPPORTED = "partially_supported"
    EXAGGERATED = "exaggerated"
    CONTRADICTED = "contradicted"
    UNSUPPORTED = "unsupported"
    MIXED = "mixed"

class Confidence(str, Enum):
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"

@dataclass
class SubClaim:
    id: str
    text: str
    type: str  # quantitative, directional, provenance, categorical
    verdict: Optional[str] = None
    confidence: Optional[str] = None
    summary: Optional[str] = None

@dataclass
class EvidenceSource:
    id: str
    title: str
    snippet: str
    source: str  # URL or journal name
    tier: str  # academic, institutional, journalism, counter
    study_type: Optional[str] = None  # meta-analysis, RCT, cohort, etc.
    year: Optional[int] = None
    citations: Optional[int] = None
    quality_score: Optional[int] = None  # 0-100
    supports_claim: Optional[bool] = None

@dataclass
class ProvenanceNode:
    id: str
    source_type: str  # study, journalist, podcast, social, claim
    source_name: str
    text: str
    date: Optional[str] = None
    mutation_severity: str = "none"  # none, slight, significant, severe

@dataclass
class ProvenanceEdge:
    from_id: str
    to_id: str

@dataclass
class CorrectedClaim:
    original: str
    corrected: str
    steelmanned: str
    one_sentence: str
    caveats: List[str] = field(default_factory=list)

@dataclass
class VerificationEvent:
    type: str
    data: Optional[Dict[str, Any]] = None

    def to_sse(self) -> str:
        payload = {"type": self.type}
        if self.data:
            payload["data"] = self.data
        return f"data: {json.dumps(payload)}\n\n"


# ---------------------------------------------------------------------------
# LLM helpers (reuse from main.py patterns)
# ---------------------------------------------------------------------------

def _get_claude_client():
    try:
        from anthropic import Anthropic
        key = os.getenv("ANTHROPIC_API_KEY")
        if key:
            return Anthropic(api_key=key)
    except Exception:
        pass
    return None

def _get_gemini():
    try:
        import google.generativeai as genai
        key = os.getenv("GOOGLE_API_KEY")
        if key:
            genai.configure(api_key=key)
            return genai
    except Exception:
        pass
    return None

def _call_llm(prompt: str, system: str = "", max_tokens: int = 4000) -> str:
    """Call Claude first, fall back to Gemini."""
    # Try Claude
    client = _get_claude_client()
    if client:
        try:
            resp = client.messages.create(
                model=os.getenv("DEFAULT_MODEL", "claude-sonnet-4-20250514"),
                max_tokens=max_tokens,
                temperature=0.3,
                system=system or "You are a precise fact-checking AI.",
                messages=[{"role": "user", "content": prompt}],
            )
            return resp.content[0].text
        except Exception as e:
            print(f"[Verify] Claude error: {e}")

    # Try Gemini
    genai = _get_gemini()
    if genai:
        try:
            full = f"{system}\n\n{prompt}" if system else prompt
            model = genai.GenerativeModel("gemini-2.0-flash")
            resp = model.generate_content(full, generation_config=genai.types.GenerationConfig(max_output_tokens=max_tokens, temperature=0.3))
            return resp.text
        except Exception as e:
            print(f"[Verify] Gemini error: {e}")

    return '{"error": "No LLM available"}'

def _parse_json_from_llm(text: str) -> Any:
    """Extract JSON from LLM response, handling markdown fences."""
    cleaned = text.strip()
    cleaned = re.sub(r'^```(?:json)?\s*', '', cleaned)
    cleaned = re.sub(r'\s*```$', '', cleaned)
    # Try direct parse
    try:
        return json.loads(cleaned)
    except Exception:
        pass
    # Try finding array or object
    for start_char, end_char in [('[', ']'), ('{', '}')]:
        s = cleaned.find(start_char)
        e = cleaned.rfind(end_char)
        if s >= 0 and e > s:
            try:
                return json.loads(cleaned[s:e+1])
            except Exception:
                pass
    return None


# ---------------------------------------------------------------------------
# Search APIs
# ---------------------------------------------------------------------------

def search_semantic_scholar(query: str, limit: int = 5) -> List[Dict]:
    """Search Semantic Scholar for academic papers."""
    try:
        resp = httpx.get(
            "https://api.semanticscholar.org/graph/v1/paper/search",
            params={
                "query": query,
                "limit": limit,
                "fields": "title,abstract,citationCount,year,authors,journal,url",
            },
            timeout=15,
        )
        if resp.status_code == 200:
            data = resp.json()
            return data.get("data", [])
    except Exception as e:
        print(f"[SemanticScholar] Error: {e}")
    return []

def search_perplexity(query: str, focus: str = "") -> Dict:
    """Search via Perplexity Sonar API for grounded web results."""
    api_key = os.getenv("PERPLEXITY_API_KEY")
    if not api_key:
        return {"text": "", "citations": []}
    try:
        system_msg = "You are a fact-checking research assistant. Provide specific evidence with sources."
        if focus:
            system_msg += f" Focus on: {focus}"
        resp = httpx.post(
            "https://api.perplexity.ai/chat/completions",
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            json={
                "model": "sonar",
                "messages": [
                    {"role": "system", "content": system_msg},
                    {"role": "user", "content": query},
                ],
            },
            timeout=30,
        )
        if resp.status_code == 200:
            data = resp.json()
            text = data.get("choices", [{}])[0].get("message", {}).get("content", "")
            citations = data.get("citations", [])
            return {"text": text, "citations": citations}
    except Exception as e:
        print(f"[Perplexity] Error: {e}")
    return {"text": "", "citations": []}


# ---------------------------------------------------------------------------
# URL content extraction
# ---------------------------------------------------------------------------

_BOT_WALL_MARKERS = [
    "just a moment", "enable javascript", "checking your browser",
    "cloudflare", "captcha", "access denied", "please verify",
    "ray id", "cf-browser-verification", "bot detection",
]

def _is_bot_wall(text: str) -> bool:
    """Detect if scraped text is a Cloudflare / bot-protection wall."""
    lower = text.lower()
    hits = sum(1 for m in _BOT_WALL_MARKERS if m in lower)
    # If very short AND contains bot markers → wall
    if len(text.split()) < 100 and hits >= 1:
        return True
    # If multiple markers even in longer text
    if hits >= 3:
        return True
    return False

def _strip_html(raw_html: str) -> tuple:
    """Strip HTML to plain text, return (title, text)."""
    import re as _re
    # Extract title before stripping
    title_match = _re.search(r'<title[^>]*>(.*?)</title>', raw_html, _re.IGNORECASE | _re.DOTALL)
    title = title_match.group(1).strip() if title_match else ""
    # Remove script/style
    clean = _re.sub(r'<script[^>]*>.*?</script>', '', raw_html, flags=_re.DOTALL | _re.IGNORECASE)
    clean = _re.sub(r'<style[^>]*>.*?</style>', '', clean, flags=_re.DOTALL | _re.IGNORECASE)
    clean = _re.sub(r'<[^>]+>', ' ', clean)
    clean = _re.sub(r'\s+', ' ', clean).strip()
    return title, clean

def _fetch_via_sonar(url: str) -> Dict[str, str]:
    """Use Perplexity Sonar to read and summarize a URL's content."""
    api_key = os.getenv("PERPLEXITY_API_KEY")
    if not api_key:
        return {"title": url, "text": "", "url": url, "error": "No Perplexity key for fallback"}
    try:
        print(f"[URL Extract] Direct scrape failed/blocked — falling back to Sonar for {url}")
        resp = httpx.post(
            "https://api.perplexity.ai/chat/completions",
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            json={
                "model": "sonar",
                "messages": [
                    {"role": "system", "content": "You are a content extraction assistant. Read the given URL and reproduce its full article content as faithfully as possible. Include all factual claims, statistics, quotes, and key arguments. Do NOT summarize — reproduce the content."},
                    {"role": "user", "content": f"Read this URL and reproduce its full article content:\n{url}"},
                ],
            },
            timeout=30,
        )
        if resp.status_code == 200:
            data = resp.json()
            text = data.get("choices", [{}])[0].get("message", {}).get("content", "")
            if text and len(text.split()) > 30:
                # Derive title from first line or sentence
                first_line = text.split('\n')[0].strip().strip('#').strip()
                title = first_line[:120] if len(first_line) > 5 else url
                return {"title": title, "text": text, "url": url}
    except Exception as e:
        print(f"[URL Extract Sonar Fallback] Error: {e}")
    return {"title": url, "text": "", "url": url, "error": "Sonar fallback also failed"}

def extract_url_content(url: str) -> Dict[str, str]:
    """Fetch and extract clean text from a URL. Falls back to Sonar if blocked."""
    try:
        headers = {
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9",
        }
        resp = httpx.get(url, headers=headers, timeout=20, follow_redirects=True)
        title, text = _strip_html(resp.text)
        title = title or url

        # Check for bot walls or garbage content
        if _is_bot_wall(text) or len(text.split()) < 50:
            print(f"[URL Extract] Bot wall or too short ({len(text.split())} words) — trying Sonar")
            return _fetch_via_sonar(url)

        # Limit to first ~5000 words
        words = text.split()
        text = ' '.join(words[:5000])

        return {"title": title, "text": text, "url": url}
    except Exception as e:
        print(f"[URL Extract] Direct fetch error: {e} — trying Sonar")
        return _fetch_via_sonar(url)


# ---------------------------------------------------------------------------
# Step 1: Claim Extraction (from raw text)
# ---------------------------------------------------------------------------

def extract_claims(text: str) -> List[Dict]:
    """Extract verifiable factual claims from text."""
    prompt = f"""Analyze the following text and extract every discrete, verifiable factual claim.

Rules:
- Extract ONLY factual claims (things that can be verified against evidence)
- Skip opinions, subjective statements, rhetorical questions, jokes
- Each claim should be a single, atomic statement
- Provide the original wording and a normalized version optimized for search
- Tag each claim type: "quantitative" (has numbers), "directional" (more/less/better), "categorical" (X is Y), "provenance" (according to/studies show)

TEXT:
{text[:4000]}

Return ONLY a JSON array:
[
  {{
    "id": "claim-1",
    "original": "exact text from source",
    "normalized": "clean searchable version",
    "type": "quantitative|directional|categorical|provenance"
  }}
]

Extract 3-10 claims. Return ONLY valid JSON, no markdown."""

    raw = _call_llm(prompt, "You are a precise claim extraction engine. Return only valid JSON arrays.")
    parsed = _parse_json_from_llm(raw)
    if isinstance(parsed, list):
        return parsed
    return []


# ---------------------------------------------------------------------------
# Step 2: Claim Decomposition
# ---------------------------------------------------------------------------

def decompose_claim(claim: str) -> List[Dict]:
    """Break a claim into atomic sub-claims."""
    prompt = f"""Break this claim into independently verifiable atomic sub-claims:

CLAIM: "{claim}"

For each sub-claim, identify:
- The specific assertion that can be checked
- The type: "directional" (X causes/increases Y), "quantitative" (specific number), "provenance" (source attribution), "categorical" (X is Y)

Return ONLY a JSON array:
[
  {{
    "id": "sub-1",
    "text": "the atomic sub-claim",
    "type": "directional|quantitative|provenance|categorical"
  }}
]

Return 2-4 sub-claims. Return ONLY valid JSON."""

    raw = _call_llm(prompt, "You are a claim decomposition engine. Break claims into atomic verifiable parts.")
    parsed = _parse_json_from_llm(raw)
    if isinstance(parsed, list):
        return parsed
    return [{"id": "sub-1", "text": claim, "type": "categorical"}]


# ---------------------------------------------------------------------------
# Step 3: Multi-Source Evidence Retrieval
# ---------------------------------------------------------------------------

def retrieve_evidence(subclaim: str, claim_context: str = "") -> List[Dict]:
    """Retrieve evidence from multiple tiers for a sub-claim."""
    evidence = []
    eid = 0

    # Tier 1: Academic (Semantic Scholar)
    papers = search_semantic_scholar(subclaim, limit=5)
    for p in papers:
        eid += 1
        authors = ", ".join([a.get("name", "") for a in (p.get("authors") or [])[:3]])
        evidence.append({
            "id": f"ev-{eid}",
            "title": p.get("title", ""),
            "snippet": (p.get("abstract") or "")[:300],
            "source": p.get("url") or f"Semantic Scholar",
            "tier": "academic",
            "study_type": None,
            "year": p.get("year"),
            "citations": p.get("citationCount", 0),
            "authors": authors,
            "journal": (p.get("journal") or {}).get("name", ""),
        })

    # Tier 2: Institutional + journalism (Perplexity Sonar)
    sonar = search_perplexity(
        f"Find authoritative evidence about: {subclaim}",
        focus="institutional sources, .gov, .edu, WHO, NIH, CDC, peer-reviewed"
    )
    if sonar["text"]:
        eid += 1
        evidence.append({
            "id": f"ev-{eid}",
            "title": "Web Evidence (Institutional + Journalism)",
            "snippet": sonar["text"][:500],
            "source": "Perplexity Sonar",
            "tier": "institutional",
            "citations_urls": sonar.get("citations", []),
        })

    # Tier 3: Counter-evidence (deliberate)
    counter = search_perplexity(
        f"Find evidence AGAINST or criticism of: {subclaim}. What are the strongest arguments that this claim is wrong, exaggerated, or misleading?",
        focus="counter-evidence, criticism, contradictions"
    )
    if counter["text"]:
        eid += 1
        evidence.append({
            "id": f"ev-{eid}",
            "title": "Counter-Evidence Search",
            "snippet": counter["text"][:500],
            "source": "Perplexity Sonar (counter-search)",
            "tier": "counter",
            "citations_urls": counter.get("citations", []),
        })

    return evidence


# ---------------------------------------------------------------------------
# Step 4: Evidence Quality Evaluation
# ---------------------------------------------------------------------------

def evaluate_evidence(evidence_list: List[Dict], subclaim: str) -> List[Dict]:
    """Score each piece of evidence for quality."""
    if not evidence_list:
        return evidence_list

    evidence_summary = "\n".join([
        f"[{e['id']}] Tier: {e.get('tier','?')} | Title: {e.get('title','')} | Year: {e.get('year','?')} | Citations: {e.get('citations','?')} | Snippet: {e.get('snippet','')[:200]}"
        for e in evidence_list
    ])

    prompt = f"""Evaluate the quality of each evidence source for verifying this claim:

CLAIM: "{subclaim}"

EVIDENCE:
{evidence_summary}

For each evidence ID, provide:
- quality_score (0-100): based on study type, recency, citation count, source authority
- study_type: meta-analysis, systematic_review, RCT, cohort, case_study, expert_opinion, news_report, web_source
- supports_claim: true/false/partial
- brief assessment (1 sentence)

Return ONLY a JSON array:
[
  {{
    "id": "ev-1",
    "quality_score": 85,
    "study_type": "RCT",
    "supports_claim": true,
    "assessment": "High-quality randomized trial directly testing the claim"
  }}
]"""

    raw = _call_llm(prompt, "You are an evidence quality evaluator. Be rigorous and precise.")
    parsed = _parse_json_from_llm(raw)

    if isinstance(parsed, list):
        score_map = {item["id"]: item for item in parsed if "id" in item}
        for ev in evidence_list:
            if ev["id"] in score_map:
                scored = score_map[ev["id"]]
                ev["quality_score"] = scored.get("quality_score", 50)
                ev["study_type"] = scored.get("study_type", ev.get("study_type"))
                ev["supports_claim"] = scored.get("supports_claim")
                ev["assessment"] = scored.get("assessment", "")

    return evidence_list


# ---------------------------------------------------------------------------
# Step 5: Verdict Synthesis
# ---------------------------------------------------------------------------

def synthesize_verdict(subclaim: str, evidence_list: List[Dict]) -> Dict:
    """Synthesize a verdict for a sub-claim based on all evidence."""
    evidence_summary = "\n".join([
        f"[{e['id']}] Quality: {e.get('quality_score', '?')}/100 | Type: {e.get('study_type','?')} | Supports: {e.get('supports_claim','?')} | {e.get('snippet','')[:200]}"
        for e in evidence_list
    ])

    prompt = f"""Based on ALL the evidence below, synthesize a verdict for this claim:

CLAIM: "{subclaim}"

EVIDENCE:
{evidence_summary}

Provide:
- verdict: one of "supported", "partially_supported", "exaggerated", "contradicted", "unsupported"
- confidence: "high", "medium", or "low"
- summary: 2-3 sentences explaining the verdict
- strongest_supporting: ID of the strongest supporting evidence (or null)
- strongest_opposing: ID of the strongest opposing evidence (or null)

Return ONLY valid JSON:
{{
  "verdict": "...",
  "confidence": "...",
  "summary": "...",
  "strongest_supporting": "ev-X" or null,
  "strongest_opposing": "ev-Y" or null
}}"""

    raw = _call_llm(prompt, "You are a rigorous fact-checking verdict synthesizer. Be precise and evidence-based.")
    parsed = _parse_json_from_llm(raw)
    if isinstance(parsed, dict):
        return parsed
    return {"verdict": "unsupported", "confidence": "low", "summary": "Could not synthesize verdict."}


# ---------------------------------------------------------------------------
# Step 6: Overall Verdict
# ---------------------------------------------------------------------------

def synthesize_overall_verdict(claim: str, subclaim_verdicts: List[Dict]) -> Dict:
    """Combine sub-claim verdicts into an overall claim verdict."""
    verdicts_summary = "\n".join([
        f"Sub-claim: \"{v.get('text', '')}\" → {v.get('verdict', '?')} ({v.get('confidence', '?')} confidence): {v.get('summary', '')}"
        for v in subclaim_verdicts
    ])

    prompt = f"""Combine these sub-claim verdicts into an overall verdict for the original claim:

ORIGINAL CLAIM: "{claim}"

SUB-CLAIM VERDICTS:
{verdicts_summary}

Rules:
- If all sub-claims supported → "supported"
- If directionally correct but magnitude wrong → "exaggerated"
- If some supported, some contradicted → "mixed"
- If core claim contradicted → "contradicted"
- If insufficient evidence → "unsupported"

Return ONLY valid JSON:
{{
  "verdict": "...",
  "confidence": "...",
  "summary": "2-3 sentence overall assessment",
  "detail": "longer explanation of how sub-claims combine"
}}"""

    raw = _call_llm(prompt, "You are a fact-checking verdict synthesizer.")
    parsed = _parse_json_from_llm(raw)
    if isinstance(parsed, dict):
        return parsed
    return {"verdict": "unsupported", "confidence": "low", "summary": "Could not determine overall verdict."}


# ---------------------------------------------------------------------------
# Step 7: Provenance Tracing
# ---------------------------------------------------------------------------

def trace_provenance(claim: str, evidence_list: List[Dict]) -> Dict:
    """Trace the likely origin and mutation path of a claim."""
    evidence_context = "\n".join([
        f"- {e.get('title', '')}: {e.get('snippet', '')[:200]} (Year: {e.get('year', '?')})"
        for e in evidence_list[:8]
    ])

    prompt = f"""Trace the likely origin and propagation path of this claim:

CLAIM: "{claim}"

AVAILABLE EVIDENCE:
{evidence_context}

Construct a provenance chain showing how this claim likely originated and mutated.
Each node represents a stage in the claim's propagation.

Return ONLY valid JSON:
{{
  "nodes": [
    {{
      "id": "prov-1",
      "source_type": "study|journalist|podcast|social|blog|claim",
      "source_name": "Name of source",
      "text": "What the claim looked like at this stage",
      "date": "YYYY or YYYY-MM",
      "mutation_severity": "none|slight|significant|severe"
    }}
  ],
  "edges": [
    {{ "from": "prov-1", "to": "prov-2" }}
  ],
  "analysis": "Brief explanation of how the claim mutated"
}}

Order nodes from original source (root) to the claim being checked (leaf).
Generate 3-6 nodes showing the propagation path."""

    raw = _call_llm(prompt, "You are a misinformation provenance tracer. Reconstruct likely propagation paths.")
    parsed = _parse_json_from_llm(raw)
    if isinstance(parsed, dict) and "nodes" in parsed:
        return parsed
    return {"nodes": [], "edges": [], "analysis": "Could not trace provenance."}


# ---------------------------------------------------------------------------
# Step 8: Corrected Claim Generation
# ---------------------------------------------------------------------------

def generate_corrected_claim(claim: str, verdict: Dict, evidence_list: List[Dict]) -> Dict:
    """Generate a corrected version of the claim based on evidence."""
    evidence_context = "\n".join([
        f"- [{e.get('quality_score', '?')}/100] {e.get('snippet', '')[:200]}"
        for e in evidence_list[:6]
    ])

    prompt = f"""The following claim has been fact-checked:

ORIGINAL CLAIM: "{claim}"
VERDICT: {verdict.get('verdict', 'unknown')} ({verdict.get('confidence', 'unknown')} confidence)
VERDICT SUMMARY: {verdict.get('summary', '')}

KEY EVIDENCE:
{evidence_context}

Generate:
1. A CORRECTED version that's actually supported by evidence
2. A STEEL-MANNED version (the strongest honest version the evidence supports)
3. A ONE-SENTENCE summary
4. Key CAVEATS the original claim leaves out (list of 2-4 items)

Return ONLY valid JSON:
{{
  "corrected": "...",
  "steelmanned": "...",
  "one_sentence": "...",
  "caveats": ["...", "..."]
}}"""

    raw = _call_llm(prompt, "You are a precise fact-checking editor. Generate accurate corrected claims.")
    parsed = _parse_json_from_llm(raw)
    if isinstance(parsed, dict):
        return parsed
    return {
        "corrected": claim,
        "steelmanned": claim,
        "one_sentence": "Could not generate correction.",
        "caveats": [],
    }


# ---------------------------------------------------------------------------
# Full Pipeline (Generator for SSE streaming)
# ---------------------------------------------------------------------------

def run_verification_pipeline(claim_text: str) -> Generator[VerificationEvent, None, None]:
    """Run the full 6-step verification pipeline, yielding events for SSE streaming."""

    t0 = time.time()

    # --- Step 1: Decomposition ---
    yield VerificationEvent("step_start", {"step": "decomposition", "label": "Decomposing claim..."})
    subclaims = decompose_claim(claim_text)
    for sc in subclaims:
        yield VerificationEvent("subclaim", {"id": sc["id"], "text": sc["text"], "type": sc["type"]})
    yield VerificationEvent("step_complete", {"step": "decomposition", "count": len(subclaims), "duration_ms": int((time.time() - t0) * 1000)})

    # --- Step 2: Evidence Retrieval (per sub-claim) ---
    all_evidence: List[Dict] = []
    yield VerificationEvent("step_start", {"step": "evidence_retrieval", "label": "Searching for evidence..."})

    for sc in subclaims:
        yield VerificationEvent("search_start", {"subclaim_id": sc["id"], "subclaim": sc["text"]})
        evidence = retrieve_evidence(sc["text"], claim_text)
        for ev in evidence:
            ev["subclaim_id"] = sc["id"]
            yield VerificationEvent("evidence_found", {
                "subclaim_id": sc["id"],
                "id": ev["id"],
                "title": ev.get("title", ""),
                "snippet": ev.get("snippet", "")[:200],
                "tier": ev.get("tier", ""),
                "source": ev.get("source", ""),
                "year": ev.get("year"),
                "citations": ev.get("citations"),
            })
        all_evidence.extend(evidence)
        yield VerificationEvent("search_complete", {"subclaim_id": sc["id"], "count": len(evidence)})

    yield VerificationEvent("step_complete", {"step": "evidence_retrieval", "total_sources": len(all_evidence), "duration_ms": int((time.time() - t0) * 1000)})

    # --- Step 3: Evidence Quality Evaluation ---
    yield VerificationEvent("step_start", {"step": "evaluation", "label": "Evaluating evidence quality..."})
    all_evidence = evaluate_evidence(all_evidence, claim_text)
    for ev in all_evidence:
        yield VerificationEvent("evidence_scored", {
            "id": ev["id"],
            "quality_score": ev.get("quality_score"),
            "study_type": ev.get("study_type"),
            "supports_claim": ev.get("supports_claim"),
            "assessment": ev.get("assessment", ""),
        })
    yield VerificationEvent("step_complete", {"step": "evaluation", "duration_ms": int((time.time() - t0) * 1000)})

    # --- Step 4: Verdict Synthesis (per sub-claim, then overall) ---
    yield VerificationEvent("step_start", {"step": "synthesis", "label": "Synthesizing verdicts..."})

    subclaim_verdicts = []
    for sc in subclaims:
        sc_evidence = [e for e in all_evidence if e.get("subclaim_id") == sc["id"]]
        verdict = synthesize_verdict(sc["text"], sc_evidence)
        verdict["text"] = sc["text"]
        verdict["subclaim_id"] = sc["id"]
        subclaim_verdicts.append(verdict)
        yield VerificationEvent("subclaim_verdict", {
            "subclaim_id": sc["id"],
            "text": sc["text"],
            "verdict": verdict.get("verdict", "unsupported"),
            "confidence": verdict.get("confidence", "low"),
            "summary": verdict.get("summary", ""),
        })

    overall = synthesize_overall_verdict(claim_text, subclaim_verdicts)
    yield VerificationEvent("overall_verdict", {
        "verdict": overall.get("verdict", "unsupported"),
        "confidence": overall.get("confidence", "low"),
        "summary": overall.get("summary", ""),
        "detail": overall.get("detail", ""),
    })
    yield VerificationEvent("step_complete", {"step": "synthesis", "duration_ms": int((time.time() - t0) * 1000)})

    # --- Step 5: Provenance Tracing ---
    yield VerificationEvent("step_start", {"step": "provenance", "label": "Tracing claim origins..."})
    provenance = trace_provenance(claim_text, all_evidence)
    for node in provenance.get("nodes", []):
        yield VerificationEvent("provenance_node", node)
    for edge in provenance.get("edges", []):
        yield VerificationEvent("provenance_edge", edge)
    yield VerificationEvent("provenance_complete", {"analysis": provenance.get("analysis", ""), "duration_ms": int((time.time() - t0) * 1000)})
    yield VerificationEvent("step_complete", {"step": "provenance", "duration_ms": int((time.time() - t0) * 1000)})

    # --- Step 6: Corrected Claim ---
    yield VerificationEvent("step_start", {"step": "correction", "label": "Generating corrected claim..."})
    corrected = generate_corrected_claim(claim_text, overall, all_evidence)
    yield VerificationEvent("corrected_claim", {
        "original": claim_text,
        "corrected": corrected.get("corrected", ""),
        "steelmanned": corrected.get("steelmanned", ""),
        "one_sentence": corrected.get("one_sentence", ""),
        "caveats": corrected.get("caveats", []),
    })
    yield VerificationEvent("step_complete", {"step": "correction", "duration_ms": int((time.time() - t0) * 1000)})

    # --- Done ---
    total_ms = int((time.time() - t0) * 1000)
    yield VerificationEvent("verification_complete", {
        "total_duration_ms": total_ms,
        "total_sources": len(all_evidence),
        "subclaims_count": len(subclaims),
        "overall_verdict": overall.get("verdict", "unsupported"),
    })
