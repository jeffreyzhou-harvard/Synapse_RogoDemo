"""
Synapse Financial Verification Engine — 7-step claim verification pipeline.

Steps:
1. Claim Decomposition → atomic sub-claims
2. Multi-Source Evidence Retrieval (EDGAR SEC Filings, Earnings Transcripts, Financial News, counter-evidence)
3. Evidence Quality Evaluation
3.5. Contradiction Detection (cross-source comparison)
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
    tier: str  # sec_filing, earnings_transcript, press_release, analyst_report, market_data, counter
    study_type: Optional[str] = None  # meta-analysis, RCT, cohort, etc.
    year: Optional[int] = None
    citations: Optional[int] = None
    quality_score: Optional[int] = None  # 0-100
    supports_claim: Optional[bool] = None
    filing_type: Optional[str] = None  # 10-K, 10-Q, 8-K, etc.
    accession_number: Optional[str] = None
    filing_date: Optional[str] = None
    company_ticker: Optional[str] = None
    verified_against: Optional[str] = None

@dataclass
class ContradictionItem:
    id: str
    source_a: Dict[str, Any]  # {type, name, text, filing_ref?}
    source_b: Dict[str, Any]  # {type, name, text, filing_ref?}
    severity: str  # low, medium, high
    explanation: str

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

# ---------------------------------------------------------------------------
# Ticker → CIK mapping (via SEC EDGAR)
# ---------------------------------------------------------------------------

_TICKER_CIK_CACHE: Dict[str, str] = {}

def _resolve_ticker_to_cik(ticker: str) -> Optional[str]:
    """Resolve a stock ticker to SEC CIK number."""
    ticker = ticker.upper().strip()
    if ticker in _TICKER_CIK_CACHE:
        return _TICKER_CIK_CACHE[ticker]
    try:
        resp = httpx.get(
            "https://www.sec.gov/cgi-bin/browse-edgar",
            params={"action": "getcompany", "company": ticker, "type": "", "dateb": "", "owner": "include", "count": "5", "search_text": "", "output": "atom"},
            headers={"User-Agent": "Synapse/1.0 (verification@synapse.ai)"},
            timeout=10,
        )
        # Try ticker-to-CIK JSON endpoint first
        resp2 = httpx.get(
            "https://www.sec.gov/files/company_tickers.json",
            headers={"User-Agent": "Synapse/1.0 (verification@synapse.ai)"},
            timeout=10,
        )
        if resp2.status_code == 200:
            tickers = resp2.json()
            for entry in tickers.values():
                if entry.get("ticker", "").upper() == ticker:
                    cik = str(entry["cik_str"]).zfill(10)
                    _TICKER_CIK_CACHE[ticker] = cik
                    return cik
    except Exception as e:
        print(f"[CIK Resolve] Error: {e}")
    return None


def _get_xbrl_entries(us_gaap: Dict, metric_key: str) -> List[Dict]:
    """Get all USD entries for a given XBRL metric key."""
    if metric_key not in us_gaap:
        return []
    entries = us_gaap[metric_key].get("units", {}).get("USD", [])
    return [e for e in entries if isinstance(e, dict) and e.get("val") is not None and e.get("end")]


def _find_xbrl_value(entries: List[Dict], target_end: str, quarterly: bool = False) -> Optional[Dict]:
    """Find the XBRL entry matching a target period end date.

    If quarterly=True, only match entries with ~3 month duration.
    If quarterly=False, match entries with ~12 month duration (annual).
    """
    from datetime import datetime, timedelta

    best = None
    best_dist = 9999

    for e in entries:
        end_str = e.get("end", "")
        start_str = e.get("start", "")
        if not end_str:
            continue

        try:
            end_dt = datetime.strptime(end_str, "%Y-%m-%d")
            target_dt = datetime.strptime(target_end, "%Y-%m-%d")
        except ValueError:
            continue

        # Check period duration if start is available
        if start_str:
            try:
                start_dt = datetime.strptime(start_str, "%Y-%m-%d")
                duration_days = (end_dt - start_dt).days
                if quarterly and duration_days > 120:  # More than ~4 months → skip
                    continue
                if not quarterly and duration_days < 300:  # Less than ~10 months → skip
                    continue
            except ValueError:
                pass

        dist = abs((end_dt - target_dt).days)
        if dist < best_dist:
            best_dist = dist
            best = e

    # Allow up to 15 days tolerance for period end matching
    if best and best_dist <= 15:
        return best
    return None


def lookup_xbrl_facts(ticker: str, claim_text: str) -> Optional[Dict]:
    """Look up structured XBRL financial data from SEC and compare against claim.

    Uses a two-step approach:
    1. LLM extracts what metric and period the claim refers to
    2. Python deterministically looks up the XBRL value and does the math
    """
    cik = _resolve_ticker_to_cik(ticker)
    if not cik:
        return None

    try:
        resp = httpx.get(
            f"https://data.sec.gov/api/xbrl/companyfacts/CIK{cik}.json",
            headers={"User-Agent": "Synapse/1.0 (verification@synapse.ai)"},
            timeout=15,
        )
        if resp.status_code != 200:
            return None

        company_data = resp.json()
        entity_name = company_data.get("entityName", "")
        us_gaap = company_data.get("facts", {}).get("us-gaap", {})

        # Collect available metric names and their period end dates for context
        available_metrics = {}
        all_metric_keys = [
            "Revenues", "RevenueFromContractWithCustomerExcludingAssessedTax",
            "GrossProfit", "NetIncomeLoss", "OperatingIncomeLoss",
            "EarningsPerShareBasic", "EarningsPerShareDiluted",
            "Assets", "StockholdersEquity", "CostOfGoodsAndServicesSold",
            "CommonStockSharesOutstanding", "LongTermDebt",
            "CashAndCashEquivalentsAtCarryingValue",
            "OperatingExpenses", "ResearchAndDevelopmentExpense",
            "SellingGeneralAndAdministrativeExpense",
        ]
        for mk in all_metric_keys:
            entries = _get_xbrl_entries(us_gaap, mk)
            if entries:
                recent_ends = sorted(set(
                    f"{e['end']} ({e.get('form','?')}, start={e.get('start','?')})"
                    for e in entries[-12:]
                ))
                available_metrics[mk] = recent_ends

        if not available_metrics:
            return None

        # Format available periods for context
        periods_str = ""
        for mk, ends in available_metrics.items():
            periods_str += f"\n  {mk}: {'; '.join(ends[-6:])}"

        # Step 1: LLM identifies WHAT to look up (not the values)
        extract_prompt = f"""Given this financial claim about {entity_name}, identify what to look up in SEC XBRL data.

CLAIM: "{claim_text}"

AVAILABLE XBRL METRICS AND THEIR PERIODS:{periods_str}

Instructions:
- Identify the XBRL metric(s) needed to verify this claim
- Determine the exact period end date that matches the claim
- If the claim is about a DERIVED metric (e.g., gross margin = GrossProfit / Revenue), list ALL component metrics needed
- Consider the company's fiscal year calendar based on the 10-K period end dates shown above

Return ONLY valid JSON:
{{
  "claimed_value": "the numeric value claimed (as string, e.g. '46.2%' or '$391B')",
  "is_derived": true/false,
  "primary_metric": "exact XBRL key name, e.g. GrossProfit",
  "denominator_metric": "exact XBRL key name if derived (e.g. RevenueFromContractWithCustomerExcludingAssessedTax), or null",
  "target_period_end": "YYYY-MM-DD of the period end date to look up",
  "is_quarterly": true/false,
  "derivation_type": "percentage|ratio|growth_yoy|absolute|null",
  "description": "brief description of what we're computing"
}}

If the claim cannot be matched, return {{"primary_metric": null, "description": "explanation"}}."""

        raw = _call_llm(extract_prompt, "You are a financial data analyst. Identify exactly which XBRL metrics and periods to look up. Be precise with metric key names — use exactly the names shown in the available list.")
        parsed = _parse_json_from_llm(raw)
        if not isinstance(parsed, dict) or not parsed.get("primary_metric"):
            return None

        primary_key = parsed["primary_metric"]
        denom_key = parsed.get("denominator_metric")
        target_end = parsed.get("target_period_end", "")
        is_quarterly = parsed.get("is_quarterly", False)
        is_derived = parsed.get("is_derived", False)
        derivation_type = parsed.get("derivation_type", "absolute")
        claimed_value = parsed.get("claimed_value", "")

        if not target_end:
            return None

        # Step 2: Deterministic lookup — Python finds the exact values
        primary_entries = _get_xbrl_entries(us_gaap, primary_key)
        primary_match = _find_xbrl_value(primary_entries, target_end, quarterly=is_quarterly)

        if not primary_match:
            # Try alternate revenue key
            if primary_key == "Revenues":
                primary_entries = _get_xbrl_entries(us_gaap, "RevenueFromContractWithCustomerExcludingAssessedTax")
                primary_match = _find_xbrl_value(primary_entries, target_end, quarterly=is_quarterly)
            elif primary_key == "RevenueFromContractWithCustomerExcludingAssessedTax":
                primary_entries = _get_xbrl_entries(us_gaap, "Revenues")
                primary_match = _find_xbrl_value(primary_entries, target_end, quarterly=is_quarterly)

        if not primary_match:
            return None

        primary_val = primary_match["val"]
        period_end = primary_match["end"]
        period_start = primary_match.get("start", "")
        form = primary_match.get("form", "")

        # Step 3: Compute the actual value
        if is_derived and denom_key and derivation_type == "percentage":
            denom_entries = _get_xbrl_entries(us_gaap, denom_key)
            denom_match = _find_xbrl_value(denom_entries, target_end, quarterly=is_quarterly)
            if not denom_match:
                return None
            denom_val = denom_match["val"]
            if denom_val == 0:
                return None
            actual_pct = (primary_val / denom_val) * 100
            actual_value_str = f"{actual_pct:.1f}%"
            computation = (
                f"{primary_key} / {denom_key} = "
                f"${primary_val/1e6:,.0f}M / ${denom_val/1e6:,.0f}M = "
                f"{actual_pct:.2f}% "
                f"(period {period_start} to {period_end}, {form})"
            )
            actual_raw = round(actual_pct, 2)
        elif is_derived and derivation_type == "growth_yoy":
            # YoY growth: need same metric from prior year
            from datetime import datetime, timedelta
            try:
                end_dt = datetime.strptime(target_end, "%Y-%m-%d")
                prior_end = (end_dt - timedelta(days=365)).strftime("%Y-%m-%d")
            except ValueError:
                return None
            prior_match = _find_xbrl_value(primary_entries, prior_end, quarterly=is_quarterly)
            if not prior_match or prior_match["val"] == 0:
                return None
            growth_pct = ((primary_val - prior_match["val"]) / prior_match["val"]) * 100
            actual_value_str = f"{growth_pct:.1f}%"
            computation = (
                f"({primary_key} current - prior) / prior = "
                f"(${primary_val/1e6:,.0f}M - ${prior_match['val']/1e6:,.0f}M) / ${prior_match['val']/1e6:,.0f}M = "
                f"{growth_pct:.1f}% YoY "
                f"(current: {period_end}, prior: {prior_match['end']})"
            )
            actual_raw = round(growth_pct, 2)
        else:
            # Absolute value
            if abs(primary_val) >= 1e9:
                actual_value_str = f"${primary_val/1e9:,.2f}B"
            elif abs(primary_val) >= 1e6:
                actual_value_str = f"${primary_val/1e6:,.0f}M"
            else:
                actual_value_str = f"{primary_val:,.2f}"
            computation = f"{primary_key} = {actual_value_str} (period {period_start} to {period_end}, {form})"
            actual_raw = primary_val

        # Step 4: Compare claimed vs actual
        # Parse claimed numeric value for comparison
        try:
            claimed_num = float(claimed_value.replace("%", "").replace("$", "").replace(",", "").replace("B", "").replace("M", "").replace("b", "").replace("m", "").strip())
            # Adjust for B/M suffix
            if "B" in claimed_value or "b" in claimed_value:
                if actual_raw > 1e8:  # actual is in raw, claimed in billions
                    claimed_num = claimed_num * 1e9
            elif "M" in claimed_value or "m" in claimed_value:
                if actual_raw > 1e5:
                    claimed_num = claimed_num * 1e6

            # For percentages, compare directly
            if "%" in claimed_value:
                diff = abs(claimed_num - actual_raw)
                if diff < 0.15:
                    match_status = "exact"
                elif diff < 1.0:
                    match_status = "close"
                else:
                    match_status = "different"
                discrepancy = f"Claimed {claimed_value}, actual {actual_value_str} (difference: {diff:.2f} percentage points)" if match_status != "exact" else ""
            else:
                # For absolute values
                if actual_raw != 0:
                    pct_diff = abs(claimed_num - actual_raw) / abs(actual_raw) * 100
                else:
                    pct_diff = 100
                if pct_diff < 1:
                    match_status = "exact"
                elif pct_diff < 5:
                    match_status = "close"
                else:
                    match_status = "different"
                discrepancy = f"Claimed {claimed_value}, actual {actual_value_str} ({pct_diff:.1f}% difference)" if match_status != "exact" else ""
        except (ValueError, ZeroDivisionError):
            match_status = "unverifiable"
            discrepancy = "Could not parse claimed value for comparison"

        return {
            "metric_name": primary_key + (f" / {denom_key}" if denom_key and is_derived else ""),
            "claimed_value": claimed_value,
            "actual_value": actual_value_str,
            "actual_raw": actual_raw,
            "period": period_end,
            "form": form,
            "match": match_status,
            "discrepancy": discrepancy,
            "computation": computation,
            "entity_name": entity_name,
            "cik": cik,
            "data_source": "SEC XBRL (EDGAR Company Facts API)",
        }
    except Exception as e:
        print(f"[XBRL Lookup] Error: {e}")
    return None


def search_edgar(query: str, company: str = "", filing_type: str = "") -> List[Dict]:
    """Search SEC EDGAR full-text search API for financial filings."""
    try:
        params: Dict[str, Any] = {
            "q": f"{company} {query}".strip(),
            "dateRange": "custom",
            "startdt": "2020-01-01",
            "enddt": "2025-12-31",
        }
        if filing_type:
            params["forms"] = filing_type
        else:
            params["forms"] = "10-K,10-Q,8-K,DEF 14A,S-1"

        resp = httpx.get(
            "https://efts.sec.gov/LATEST/search-index",
            params=params,
            headers={"User-Agent": "Synapse/1.0 (verification@synapse.ai)"},
            timeout=15,
        )
        if resp.status_code == 200:
            data = resp.json()
            hits = data.get("hits", {}).get("hits", [])
            results = []
            for hit in hits[:5]:
                src = hit.get("_source", {})
                # Extract company name from display_names array
                display_names = src.get("display_names", [])
                company_name = display_names[0] if display_names else "Unknown"
                cik = src.get("ciks", [""])[0] if src.get("ciks") else ""
                adsh = src.get("adsh", "")
                adsh_clean = adsh.replace("-", "")
                file_nums = src.get("file_num", [])
                file_num = file_nums[0] if file_nums else ""
                # Build direct link to filing index page
                filing_url = f"https://www.sec.gov/Archives/edgar/data/{cik}/{adsh_clean}/{adsh}-index.htm" if adsh and cik else ""
                results.append({
                    "company": company_name,
                    "cik": cik,
                    "filing_type": src.get("form", src.get("root_forms", [""])[0] if src.get("root_forms") else ""),
                    "filing_date": src.get("file_date", ""),
                    "accession_number": adsh or file_num,
                    "url": filing_url,
                    "snippet": f"{company_name} — {src.get('form', '')} filed {src.get('file_date', '')}. Period ending {src.get('period_ending', 'N/A')}. Filing: {adsh}",
                })
            if results:
                return results
    except Exception as e:
        print(f"[EDGAR] Error: {e}")

    # Fallback: use Perplexity Sonar with SEC-focused query
    sonar = search_perplexity(
        f"SEC EDGAR filing {company} {query} site:sec.gov",
        focus="SEC filings, 10-K, 10-Q, 8-K annual reports, quarterly filings"
    )
    if sonar["text"]:
        return [{
            "company": company or "Unknown",
            "cik": "",
            "filing_type": filing_type or "Unknown",
            "filing_date": "",
            "accession_number": "",
            "url": sonar.get("citations", [""])[0] if sonar.get("citations") else "",
            "snippet": sonar["text"][:400],
        }]
    return []


def search_earnings_transcripts(query: str, company: str = "") -> Dict:
    """Search for earnings call transcript quotes via Perplexity Sonar with finance-focused prompts."""
    return search_perplexity(
        f"earnings call transcript {company} {query}. Include exact quotes from management with speaker name, quarter, and year.",
        focus="earnings call transcripts, quarterly earnings, management commentary, guidance, analyst Q&A"
    )


def search_financial_news(query: str, company: str = "") -> Dict:
    """Search for financial press releases, deal announcements, and market data."""
    return search_perplexity(
        f"financial news press release {company} {query}",
        focus="press releases, deal announcements, M&A transactions, market data, analyst reports, investor presentations"
    )


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

def _is_tweet_url(url: str) -> bool:
    """Check if URL is a Twitter/X tweet."""
    return bool(re.match(r'https?://(twitter\.com|x\.com)/\w+/status/\d+', url))

def _extract_tweet_id(url: str) -> Optional[str]:
    """Extract tweet ID from a Twitter/X URL."""
    m = re.search(r'/status/(\d+)', url)
    return m.group(1) if m else None

def _extract_tweet(url: str) -> Dict[str, str]:
    """Extract tweet content via X API v2 (Bearer Token). Falls back to Sonar."""
    tweet_id = _extract_tweet_id(url)
    bearer = os.getenv("X_BEARER_TOKEN")

    # Try X API v2 first
    if tweet_id and bearer:
        try:
            print(f"[Tweet Extract] Fetching tweet {tweet_id} via X API v2")
            resp = httpx.get(
                f"https://api.x.com/2/tweets/{tweet_id}",
                params={
                    "tweet.fields": "author_id,created_at,text,public_metrics,context_annotations",
                    "expansions": "author_id",
                    "user.fields": "name,username",
                },
                headers={"Authorization": f"Bearer {bearer}"},
                timeout=15,
            )
            if resp.status_code == 200:
                data = resp.json()
                tweet_data = data.get("data", {})
                tweet_text = tweet_data.get("text", "")
                created_at = tweet_data.get("created_at", "")

                # Get author info from includes
                users = data.get("includes", {}).get("users", [])
                author = users[0].get("name", "Unknown") if users else "Unknown"
                handle = f"@{users[0].get('username', '')}" if users else ""

                # Get metrics
                metrics = tweet_data.get("public_metrics", {})
                likes = metrics.get("like_count", 0)
                retweets = metrics.get("retweet_count", 0)
                replies = metrics.get("reply_count", 0)

                title = f"Tweet by {author} {handle}".strip()
                full_text = f"Author: {author}\nHandle: {handle}\nDate: {created_at}\nLikes: {likes} · Retweets: {retweets} · Replies: {replies}\n\nTweet:\n{tweet_text}"

                return {"title": title, "text": full_text, "url": url, "source_type": "tweet", "author": author, "handle": handle}
            else:
                print(f"[Tweet Extract] X API returned {resp.status_code}: {resp.text[:200]}")
        except Exception as e:
            print(f"[Tweet Extract] X API error: {e}")

    # Fallback to Sonar
    api_key = os.getenv("PERPLEXITY_API_KEY")
    if api_key:
        try:
            print(f"[Tweet Extract] Falling back to Sonar for {url}")
            resp = httpx.post(
                "https://api.perplexity.ai/chat/completions",
                headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
                json={
                    "model": "sonar",
                    "messages": [
                        {"role": "system", "content": "You are a tweet extraction assistant. Given a tweet URL, reproduce the EXACT tweet text, the author's name, their handle (@username), and the date if visible. Format:\n\nAuthor: [name]\nHandle: [@handle]\nDate: [date or 'unknown']\n\nTweet:\n[exact tweet text]"},
                        {"role": "user", "content": f"Extract the full content of this tweet:\n{url}"},
                    ],
                },
                timeout=30,
            )
            if resp.status_code == 200:
                data = resp.json()
                text = data.get("choices", [{}])[0].get("message", {}).get("content", "")
                if text and len(text.split()) > 5:
                    author_match = re.search(r'Author:\s*(.+)', text)
                    handle_match = re.search(r'Handle:\s*(@\w+)', text)
                    author = author_match.group(1).strip() if author_match else "Unknown"
                    handle = handle_match.group(1).strip() if handle_match else ""
                    title = f"Tweet by {author} {handle}".strip()
                    return {"title": title, "text": text, "url": url, "source_type": "tweet", "author": author, "handle": handle}
        except Exception as e:
            print(f"[Tweet Extract] Sonar fallback error: {e}")

    return {"title": url, "text": "", "url": url, "source_type": "tweet", "error": "Failed to extract tweet"}

def extract_url_content(url: str) -> Dict[str, str]:
    """Fetch and extract clean text from a URL. Falls back to Sonar if blocked."""
    # Detect tweet URLs and use specialized extraction
    if _is_tweet_url(url):
        return _extract_tweet(url)
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
    """Extract verifiable financial claims from text."""
    prompt = f"""Extract EVERY discrete, verifiable factual claim from this text. Be thorough — focus on financial and business claims that can be verified against SEC filings, earnings calls, and market data.

INCLUDE these types of claims:
- Financial metrics: revenue, margins, EPS, growth rates, profitability figures ("gross margin was 46.2%", "revenue of $94.8 billion")
- Valuation: multiples, enterprise value, market cap ("trades at 25x earnings", "market cap of $3 trillion")
- Transactions: M&A deals, IPOs, buybacks with parties, values, dates ("acquired Activision for $68.7B")
- Regulatory: compliance statements, filing references, capital ratios ("CET1 ratio was 15.0%")
- Guidance: forward-looking statements, projections ("expects revenue growth of 10-12%")
- Operational: delivery numbers, headcount, market share ("delivered 1.81 million vehicles")
- Comparative: year-over-year changes, rankings ("grew 409% year-over-year")

EXCLUDE (do NOT extract):
- Opinions, subjective analysis, rhetorical questions
- Vague statements without specific verifiable data points
- Author biographical info or article metadata

Rules:
- Each claim must be a single, atomic, independently verifiable statement
- Provide the original wording and a normalized version optimized for financial search
- Tag type: "financial_metric" (revenue, margins, EPS, growth), "valuation" (multiples, EV, market cap), "transaction" (M&A, IPO, buyback), "regulatory" (compliance, filing refs, capital ratios), "guidance" (projections, forward-looking)
- Extract company ticker when possible

TEXT:
{text[:6000]}

Return ONLY a JSON array:
[
  {{
    "id": "claim-1",
    "original": "exact text from source",
    "normalized": "clean searchable version",
    "type": "financial_metric|valuation|transaction|regulatory|guidance",
    "company_ticker": "AAPL or null"
  }}
]

Extract 8-20 claims. Be thorough. Return ONLY valid JSON, no markdown."""

    raw = _call_llm(prompt, "You are a precise financial claim extraction engine specializing in SEC filings, earnings data, and market metrics. Return only valid JSON arrays.")
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

def retrieve_evidence(subclaim: str, claim_context: str = "", company_ticker: str = "") -> List[Dict]:
    """Retrieve evidence from multiple financial tiers for a sub-claim."""
    evidence = []
    eid = 0

    # Tier 0: XBRL Structured Data Grounding (if we have a ticker)
    if company_ticker:
        xbrl_result = lookup_xbrl_facts(company_ticker, subclaim)
        if xbrl_result and xbrl_result.get("match") != "unverifiable":
            eid += 1
            match_status = xbrl_result.get("match", "unverifiable")
            discrepancy = xbrl_result.get("discrepancy", "")
            computation = xbrl_result.get("computation", "")
            snippet_parts = []
            if xbrl_result.get("claimed_value"):
                snippet_parts.append(f"Claimed: {xbrl_result['claimed_value']}")
            if xbrl_result.get("actual_value"):
                snippet_parts.append(f"Actual (SEC filing): {xbrl_result['actual_value']}")
            if computation:
                snippet_parts.append(f"Computation: {computation}")
            if discrepancy:
                snippet_parts.append(f"Discrepancy: {discrepancy}")

            evidence.append({
                "id": f"ev-{eid}",
                "title": f"XBRL Ground Truth — {xbrl_result.get('entity_name', company_ticker)}",
                "snippet": " | ".join(snippet_parts),
                "source": f"SEC XBRL ({xbrl_result.get('form', 'Filing')} ending {xbrl_result.get('period', 'N/A')})",
                "tier": "sec_filing",
                "filing_type": xbrl_result.get("form", ""),
                "filing_date": xbrl_result.get("period", ""),
                "company_ticker": company_ticker,
                "verified_against": f"{xbrl_result.get('form', '')} ending {xbrl_result.get('period', '')}",
                "xbrl_match": match_status,
                "xbrl_data": xbrl_result,
            })

    # Tier 1: SEC EDGAR Filings (highest authority)
    edgar_results = search_edgar(subclaim, company=company_ticker)
    for r in edgar_results:
        eid += 1
        evidence.append({
            "id": f"ev-{eid}",
            "title": f"{r.get('filing_type', 'SEC Filing')} — {r.get('company', 'Unknown')}",
            "snippet": r.get("snippet", "")[:400],
            "source": r.get("url", "SEC EDGAR"),
            "tier": "sec_filing",
            "filing_type": r.get("filing_type", ""),
            "accession_number": r.get("accession_number", ""),
            "filing_date": r.get("filing_date", ""),
            "company_ticker": r.get("company", ""),
        })

    # Tier 2: Earnings Transcripts
    earnings = search_earnings_transcripts(subclaim)
    if earnings["text"]:
        eid += 1
        evidence.append({
            "id": f"ev-{eid}",
            "title": "Earnings Call Transcript",
            "snippet": earnings["text"][:500],
            "source": "Perplexity Sonar (Earnings)",
            "tier": "earnings_transcript",
            "citations_urls": earnings.get("citations", []),
        })

    # Tier 3: Financial News / Press Releases
    news = search_financial_news(subclaim)
    if news["text"]:
        eid += 1
        evidence.append({
            "id": f"ev-{eid}",
            "title": "Financial News / Press Release",
            "snippet": news["text"][:500],
            "source": "Perplexity Sonar (Financial News)",
            "tier": "press_release",
            "citations_urls": news.get("citations", []),
        })

    # Tier 4: Counter-evidence (deliberate)
    counter = search_perplexity(
        f"Find evidence AGAINST or contradicting: {subclaim}. Are there any discrepancies, restatements, corrections, or conflicting data from SEC filings, earnings calls, or analyst reports?",
        focus="counter-evidence, financial restatements, corrections, contradictions, analyst downgrades"
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
# Step 3.5: Contradiction Detection
# ---------------------------------------------------------------------------

def detect_contradictions(claim: str, evidence_list: List[Dict]) -> List[Dict]:
    """Detect contradictions between different evidence sources."""
    if len(evidence_list) < 2:
        return []

    evidence_summary = "\n".join([
        f"[{e['id']}] Source type: {e.get('tier','?')} | Title: {e.get('title','')} | Snippet: {e.get('snippet','')[:250]}"
        for e in evidence_list
    ])

    prompt = f"""Compare the following evidence sources for the claim and identify any contradictions or discrepancies between them.

CLAIM: "{claim}"

EVIDENCE SOURCES:
{evidence_summary}

Look for:
- Different numbers/figures for the same metric across sources
- Conflicting dates or timelines
- Inconsistent characterizations of the same event
- Discrepancies between SEC filings and earnings call statements
- Differences between press releases and regulatory filings

Return ONLY a JSON array of contradictions found (empty array [] if none):
[
  {{
    "id": "contra-1",
    "source_a": {{ "id": "ev-X", "type": "source type", "name": "source title", "text": "relevant quote from source A" }},
    "source_b": {{ "id": "ev-Y", "type": "source type", "name": "source title", "text": "relevant quote from source B" }},
    "severity": "low|medium|high",
    "explanation": "Why these sources contradict each other"
  }}
]

Return ONLY valid JSON."""

    raw = _call_llm(prompt, "You are a financial contradiction detection engine. Identify discrepancies between evidence sources with precision.")
    parsed = _parse_json_from_llm(raw)
    if isinstance(parsed, list):
        return parsed
    return []


# ---------------------------------------------------------------------------
# Step 5: Verdict Synthesis
# ---------------------------------------------------------------------------

def synthesize_verdict(subclaim: str, evidence_list: List[Dict]) -> Dict:
    """Synthesize a verdict for a sub-claim based on all evidence, weighted by financial source authority."""
    evidence_summary = "\n".join([
        f"[{e['id']}] Tier: {e.get('tier','?')} | Quality: {e.get('quality_score', '?')}/100 | Type: {e.get('study_type','?')} | Filing: {e.get('filing_type','')} | Supports: {e.get('supports_claim','?')} | {e.get('snippet','')[:200]}"
        for e in evidence_list
    ])

    prompt = f"""Based on ALL the evidence below, synthesize a verdict for this financial claim.

IMPORTANT: Weight evidence by source authority:
- SEC Filings (10-K, 10-Q, 8-K) = HIGHEST authority — audited, legally binding
- Earnings Transcripts = HIGH authority — direct management statements
- Press Releases = MEDIUM authority — company-issued but not audited
- News Reports / Analyst Reports = LOW authority — secondary sources

CLAIM: "{subclaim}"

EVIDENCE:
{evidence_summary}

Provide:
- verdict: one of "supported", "partially_supported", "exaggerated", "contradicted", "unsupported"
- confidence: "high", "medium", or "low"
- summary: 2-3 sentences explaining the verdict
- verified_against: what the claim was verified against, e.g. "10-K FY2024", "Q3 2024 Earnings Call", "Press Release" (or null)
- strongest_supporting: ID of the strongest supporting evidence (or null)
- strongest_opposing: ID of the strongest opposing evidence (or null)

Return ONLY valid JSON:
{{
  "verdict": "...",
  "confidence": "...",
  "summary": "...",
  "verified_against": "...",
  "strongest_supporting": "ev-X" or null,
  "strongest_opposing": "ev-Y" or null
}}"""

    raw = _call_llm(prompt, "You are a rigorous financial fact-checking verdict synthesizer. Weight SEC filings highest. Be precise and evidence-based.")
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
    """Run the full 7-step financial verification pipeline, yielding events for SSE streaming."""

    t0 = time.time()

    # --- Step 1: Decomposition ---
    yield VerificationEvent("step_start", {"step": "decomposition", "label": "Decomposing financial claim..."})
    subclaims = decompose_claim(claim_text)
    for sc in subclaims:
        yield VerificationEvent("subclaim", {"id": sc["id"], "text": sc["text"], "type": sc["type"]})
    yield VerificationEvent("step_complete", {"step": "decomposition", "count": len(subclaims), "duration_ms": int((time.time() - t0) * 1000)})

    # --- Step 2: Evidence Retrieval (per sub-claim) ---
    all_evidence: List[Dict] = []
    yield VerificationEvent("step_start", {"step": "evidence_retrieval", "label": "Searching SEC filings, earnings & news..."})

    # Try to extract a company ticker from the claim for XBRL lookup
    ticker_prompt = f'What stock ticker (e.g. AAPL, MSFT, TSLA) does this claim reference? Return ONLY the ticker symbol, or "NONE" if no specific company.\n\nClaim: "{claim_text}"'
    detected_ticker = _call_llm(ticker_prompt, "Return only a stock ticker symbol or NONE.").strip().upper().replace('"', '').replace("'", "")
    if detected_ticker == "NONE" or len(detected_ticker) > 6 or " " in detected_ticker:
        detected_ticker = ""

    for sc in subclaims:
        yield VerificationEvent("search_start", {"subclaim_id": sc["id"], "subclaim": sc["text"]})
        evidence = retrieve_evidence(sc["text"], claim_text, company_ticker=detected_ticker)
        for ev in evidence:
            ev["subclaim_id"] = sc["id"]
            ev_event: Dict[str, Any] = {
                "subclaim_id": sc["id"],
                "id": ev["id"],
                "title": ev.get("title", ""),
                "snippet": ev.get("snippet", "")[:300],
                "tier": ev.get("tier", ""),
                "source": ev.get("source", ""),
                "year": ev.get("year"),
                "citations": ev.get("citations"),
                "filing_type": ev.get("filing_type"),
                "accession_number": ev.get("accession_number"),
                "filing_date": ev.get("filing_date"),
                "company_ticker": ev.get("company_ticker"),
                "verified_against": ev.get("verified_against"),
            }
            # Include XBRL grounding data if present
            if ev.get("xbrl_data"):
                xd = ev["xbrl_data"]
                ev_event["xbrl_match"] = xd.get("match")
                ev_event["xbrl_claimed"] = xd.get("claimed_value")
                ev_event["xbrl_actual"] = xd.get("actual_value")
                ev_event["xbrl_discrepancy"] = xd.get("discrepancy")
                ev_event["xbrl_computation"] = xd.get("computation")
            yield VerificationEvent("evidence_found", ev_event)
        all_evidence.extend(evidence)
        yield VerificationEvent("search_complete", {"subclaim_id": sc["id"], "count": len(evidence)})

    yield VerificationEvent("step_complete", {"step": "evidence_retrieval", "total_sources": len(all_evidence), "duration_ms": int((time.time() - t0) * 1000)})

    # --- Step 3: Evidence Quality Evaluation ---
    yield VerificationEvent("step_start", {"step": "evaluation", "label": "Evaluating source quality..."})
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

    # --- Step 3.5: Contradiction Detection ---
    yield VerificationEvent("step_start", {"step": "contradictions", "label": "Detecting cross-source contradictions..."})
    contradictions = detect_contradictions(claim_text, all_evidence)
    for c in contradictions:
        yield VerificationEvent("contradiction_detected", c)
    yield VerificationEvent("contradictions_complete", {"count": len(contradictions), "duration_ms": int((time.time() - t0) * 1000)})
    yield VerificationEvent("step_complete", {"step": "contradictions", "duration_ms": int((time.time() - t0) * 1000)})

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
            "verified_against": verdict.get("verified_against"),
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
        "contradictions_count": len(contradictions),
    })
