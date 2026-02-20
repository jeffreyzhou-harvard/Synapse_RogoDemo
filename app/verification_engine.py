"""
Synapse Financial Verification Engine — multi-stage claim verification pipeline.

Stages:
 1. Claim Decomposition → atomic sub-claims
 2. Entity Resolution → disambiguate companies, subsidiaries, products
 3. Normalization → standardize units, periods, accounting definitions, currency
 4. Multi-Source Evidence Retrieval (6 tiers: EDGAR, Earnings, FRED, Market, News, Counter)
 5. Evidence Quality Evaluation
 6. Contradiction Detection (cross-source comparison)
 7. Consistency Analysis (temporal restatements, narrative drift, metric inconsistency)
 8. Plausibility Assessment (forward-looking analysis + peer benchmarking)
 9. Verdict Synthesis (with materiality scoring)
10. Provenance Tracing (with source authority hierarchy)
11. Corrected Claim Generation
12. Risk Signal Extraction (pattern synthesis for deal teams)

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
# FRED API — Macro Economic Data
# ---------------------------------------------------------------------------

_FRED_SERIES_MAP: Dict[str, str] = {
    "gdp": "GDP",
    "gdp growth": "A191RL1Q225SBEA",
    "unemployment": "UNRATE",
    "unemployment rate": "UNRATE",
    "inflation": "CPIAUCSL",
    "cpi": "CPIAUCSL",
    "federal funds rate": "FEDFUNDS",
    "fed funds": "FEDFUNDS",
    "interest rate": "FEDFUNDS",
    "10 year treasury": "DGS10",
    "treasury yield": "DGS10",
    "consumer confidence": "UMCSENT",
    "housing starts": "HOUST",
    "industrial production": "INDPRO",
    "retail sales": "RSXFS",
    "m2 money supply": "M2SL",
    "pce": "PCE",
    "core pce": "PCEPILFE",
}


def _resolve_fred_series(claim_text: str) -> Optional[str]:
    """Use keyword matching to find the best FRED series for a claim."""
    lower = claim_text.lower()
    for keyword, series_id in _FRED_SERIES_MAP.items():
        if keyword in lower:
            return series_id
    return None


def lookup_fred_data(claim_text: str) -> Optional[Dict]:
    """Look up macro economic data from FRED (Federal Reserve Economic Data).

    Uses the free FRED API at api.stlouisfed.org. No API key required for
    basic series observations.
    """
    series_id = _resolve_fred_series(claim_text)
    if not series_id:
        return None

    try:
        # FRED provides free JSON without an API key via this endpoint
        resp = httpx.get(
            f"https://api.stlouisfed.org/fred/series/observations",
            params={
                "series_id": series_id,
                "api_key": os.getenv("FRED_API_KEY", "DEMO_KEY"),
                "file_type": "json",
                "sort_order": "desc",
                "limit": "24",  # last 24 observations
            },
            headers={"User-Agent": "Synapse/1.0"},
            timeout=15,
        )
        if resp.status_code != 200:
            return None

        data = resp.json()
        observations = data.get("observations", [])
        if not observations:
            return None

        # Get most recent non-missing value
        recent = []
        for obs in observations:
            val = obs.get("value", ".")
            if val != ".":
                recent.append({
                    "date": obs.get("date", ""),
                    "value": float(val),
                })
            if len(recent) >= 12:
                break

        if not recent:
            return None

        latest = recent[0]
        # Compute YoY change if we have enough data
        yoy_change = None
        if len(recent) >= 12:
            prior = recent[11]  # ~12 months ago
            if prior["value"] != 0:
                yoy_change = ((latest["value"] - prior["value"]) / abs(prior["value"])) * 100

        return {
            "series_id": series_id,
            "series_name": series_id,
            "latest_date": latest["date"],
            "latest_value": latest["value"],
            "yoy_change_pct": round(yoy_change, 2) if yoy_change is not None else None,
            "observations": recent[:6],  # last 6 for trend
            "data_source": "FRED (Federal Reserve Economic Data)",
        }
    except Exception as e:
        print(f"[FRED] Error: {e}")
    return None


# ---------------------------------------------------------------------------
# Yahoo Finance — Market Data (via free yfinance-style endpoint)
# ---------------------------------------------------------------------------

def lookup_market_data(ticker: str, claim_text: str = "") -> Optional[Dict]:
    """Look up current market data for a stock ticker.

    Uses Yahoo Finance's free query endpoint for real-time price,
    market cap, P/E ratio, and other fundamentals.
    """
    if not ticker:
        return None

    ticker = ticker.upper().strip()
    try:
        # Yahoo Finance v8 quote endpoint (free, no key needed)
        resp = httpx.get(
            f"https://query1.finance.yahoo.com/v8/finance/chart/{ticker}",
            params={"interval": "1d", "range": "1y"},
            headers={
                "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
            },
            timeout=15,
        )
        if resp.status_code != 200:
            return None

        data = resp.json()
        result = data.get("chart", {}).get("result", [])
        if not result:
            return None

        meta = result[0].get("meta", {})
        indicators = result[0].get("indicators", {}).get("quote", [{}])[0]
        timestamps = result[0].get("timestamp", [])

        current_price = meta.get("regularMarketPrice")
        prev_close = meta.get("chartPreviousClose") or meta.get("previousClose")

        # Get price history for trend
        closes = indicators.get("close", [])
        closes = [c for c in closes if c is not None]

        # Compute basic metrics
        price_1y_ago = closes[0] if closes else None
        yoy_return = None
        if price_1y_ago and current_price and price_1y_ago != 0:
            yoy_return = ((current_price - price_1y_ago) / price_1y_ago) * 100

        # 52-week high/low
        high_52w = max(closes) if closes else None
        low_52w = min(closes) if closes else None

        return {
            "ticker": ticker,
            "current_price": current_price,
            "previous_close": prev_close,
            "currency": meta.get("currency", "USD"),
            "exchange": meta.get("exchangeName", ""),
            "yoy_return_pct": round(yoy_return, 2) if yoy_return is not None else None,
            "high_52w": round(high_52w, 2) if high_52w else None,
            "low_52w": round(low_52w, 2) if low_52w else None,
            "data_points": len(closes),
            "data_source": "Yahoo Finance",
        }
    except Exception as e:
        print(f"[Yahoo Finance] Error for {ticker}: {e}")
    return None


# ---------------------------------------------------------------------------
# Cross-Document Consistency Checker
# ---------------------------------------------------------------------------

def check_cross_document_consistency(
    claim_text: str,
    evidence_list: List[Dict],
    company_ticker: str = "",
) -> List[Dict]:
    """Check for consistency issues across multiple evidence sources.

    Goes beyond simple contradiction detection — identifies tension, evolving
    narratives, and subtle inconsistencies between documents even when there's
    no direct numerical contradiction.
    """
    if len(evidence_list) < 2:
        return []

    # Group evidence by tier for structured comparison
    by_tier: Dict[str, List[Dict]] = {}
    for e in evidence_list:
        tier = e.get("tier", "other")
        by_tier.setdefault(tier, []).append(e)

    evidence_summary = "\n".join([
        f"[{e['id']}] Tier: {e.get('tier','?')} | Title: {e.get('title','')} | "
        f"Date: {e.get('filing_date', e.get('year', '?'))} | "
        f"Snippet: {e.get('snippet','')[:300]}"
        for e in evidence_list
    ])

    prompt = f"""Analyze these evidence sources for CONSISTENCY issues related to this claim. Go beyond simple contradictions — look for subtle tensions, evolving narratives, and red flags.

CLAIM: "{claim_text}"
COMPANY: {company_ticker or 'Unknown'}

EVIDENCE SOURCES:
{evidence_summary}

Look for these specific consistency patterns:

1. NARRATIVE DRIFT: Management says one thing in earnings calls but filings tell a different story
   Example: CIM says "95% retention" but 10-K risk factors mention "customer concentration risk" and "churn in Q4"

2. METRIC INCONSISTENCY: Same metric reported differently across documents
   Example: Revenue figure in press release doesn't match 10-K, or growth rate calculated differently

3. TEMPORAL INCONSISTENCY: Claims that were true at one point but may no longer be
   Example: "Market leader" claim based on 2022 data when 2024 data shows different ranking

4. RESTATEMENT DETECTION: Same metric reported differently across time periods BY THE SAME SOURCE
   Example: Q1 earnings call reports Q1 revenue of $50M, but Q2 filing shows restated Q1 revenue of $48M
   This is one of the biggest red flags in diligence — restatements are often buried in footnotes
   Look for: prior period adjustments, restated figures, revised estimates, corrected numbers

5. OMISSION FLAGS: Important context missing from the claim that other sources reveal
   Example: Claim about revenue growth omits that it was driven by a one-time acquisition

6. RISK FACTOR TENSION: Positive claims that are in tension with disclosed risk factors
   Example: "Strong growth trajectory" alongside "going concern" language in filings

Return ONLY a JSON array of consistency issues found (empty array [] if none):
[
  {{
    "id": "consistency-1",
    "type": "narrative_drift|metric_inconsistency|temporal_inconsistency|restatement|omission_flag|risk_factor_tension",
    "severity": "low|medium|high",
    "sources_involved": ["ev-X", "ev-Y"],
    "description": "Clear explanation of the consistency issue",
    "implication": "What this means for the claim's reliability"
  }}
]

Be precise. Only flag genuine issues, not minor differences in wording. Return ONLY valid JSON."""

    raw = _call_llm(
        prompt,
        "You are a forensic financial analyst specializing in cross-document consistency analysis. "
        "You detect subtle tensions between SEC filings, earnings calls, press releases, and CIMs. "
        "Be precise and evidence-based — only flag genuine consistency issues."
    )
    parsed = _parse_json_from_llm(raw)
    if isinstance(parsed, list):
        return parsed
    return []


# ---------------------------------------------------------------------------
# SIC Code Peer Benchmarking
# ---------------------------------------------------------------------------

_SIC_CACHE: Dict[str, Dict] = {}

def _lookup_sic_peers(ticker: str, claim_text: str = "") -> Optional[Dict]:
    """Look up peer companies via SIC code from SEC EDGAR and compute benchmark metrics.

    Finds companies in the same SIC code, pulls their XBRL revenue data,
    and computes growth rates for peer comparison.
    """
    if not ticker:
        return None
    ticker = ticker.upper().strip()

    if ticker in _SIC_CACHE:
        return _SIC_CACHE[ticker]

    try:
        # Get company SIC code from SEC tickers JSON
        resp = httpx.get(
            "https://www.sec.gov/files/company_tickers.json",
            headers={"User-Agent": "Synapse/1.0 (verification@synapse.ai)"},
            timeout=10,
        )
        if resp.status_code != 200:
            return None

        tickers_data = resp.json()
        target_cik = None
        for entry in tickers_data.values():
            if entry.get("ticker", "").upper() == ticker:
                target_cik = str(entry["cik_str"]).zfill(10)
                break

        if not target_cik:
            return None

        # Get SIC code for the target company
        resp2 = httpx.get(
            f"https://data.sec.gov/submissions/CIK{target_cik}.json",
            headers={"User-Agent": "Synapse/1.0 (verification@synapse.ai)"},
            timeout=10,
        )
        if resp2.status_code != 200:
            return None

        company_info = resp2.json()
        sic_code = company_info.get("sic", "")
        industry = company_info.get("sicDescription", "")

        if not sic_code:
            return None

        # Use LLM to identify 3-5 public peer companies for this SIC code
        peer_prompt = f"""Given this company and industry, list 3-5 publicly traded peer companies.

Company: {ticker}
SIC Code: {sic_code}
Industry: {industry}

Return ONLY a JSON array of ticker symbols: ["PEER1", "PEER2", "PEER3"]
Only include well-known public companies. Return ONLY valid JSON."""

        raw = _call_llm(peer_prompt, "Return only a JSON array of stock ticker symbols.")
        peer_tickers = _parse_json_from_llm(raw)
        if not isinstance(peer_tickers, list):
            peer_tickers = []
        peer_tickers = [t.upper().strip() for t in peer_tickers if isinstance(t, str) and t.upper() != ticker][:5]

        # For each peer, try to get a revenue growth figure from XBRL
        peer_growths = []
        for pt in peer_tickers[:3]:  # Limit to 3 to avoid too many API calls
            try:
                xbrl = lookup_xbrl_facts(pt, "revenue growth year over year")
                if xbrl and xbrl.get("actual_value"):
                    peer_growths.append({"ticker": pt, "data": str(xbrl.get("actual_value", ""))})
            except Exception:
                pass

        result = {
            "sic_code": sic_code,
            "industry": industry,
            "peer_tickers": peer_tickers,
            "peer_data": peer_growths,
            "median_growth": "see peer data",
            "best_growth": "see peer data",
            "worst_growth": "see peer data",
        }
        _SIC_CACHE[ticker] = result
        return result

    except Exception as e:
        print(f"[SIC Peers] Error for {ticker}: {e}")
    return None


# ---------------------------------------------------------------------------
# Forward-Looking Plausibility Scorer
# ---------------------------------------------------------------------------

def assess_forward_looking_plausibility(
    claim_text: str,
    evidence_list: List[Dict],
    company_ticker: str = "",
) -> Optional[Dict]:
    """Assess whether a forward-looking claim is plausible given current data.

    For claims like "we expect to reach profitability by Q3 2026", this function:
    1. Identifies the projection and timeline
    2. Pulls current financial trajectory from evidence + XBRL
    3. Evaluates whether the trajectory supports the projection
    """
    # First check if this is actually a forward-looking claim
    fl_keywords = [
        "expect", "project", "forecast", "anticipate", "target", "plan to",
        "will reach", "will achieve", "on track", "guidance", "outlook",
        "by q", "by 20", "by end of", "next year", "going forward",
        "pipeline", "runway", "burn rate", "path to profitability",
    ]
    lower = claim_text.lower()
    if not any(kw in lower for kw in fl_keywords):
        return None

    # Gather financial context
    xbrl_context = ""
    if company_ticker:
        # Try to get recent financials for trajectory analysis
        xbrl_result = lookup_xbrl_facts(company_ticker, claim_text)
        if xbrl_result:
            xbrl_context = f"""
XBRL DATA:
- Metric: {xbrl_result.get('metric_name', 'N/A')}
- Actual Value: {xbrl_result.get('actual_value', 'N/A')}
- Period: {xbrl_result.get('period', 'N/A')}
- Computation: {xbrl_result.get('computation', 'N/A')}
"""

    # Gather market data context
    market_context = ""
    if company_ticker:
        market = lookup_market_data(company_ticker)
        if market:
            market_context = f"""
MARKET DATA:
- Current Price: ${market.get('current_price', 'N/A')}
- YoY Return: {market.get('yoy_return_pct', 'N/A')}%
- 52-Week Range: ${market.get('low_52w', '?')} - ${market.get('high_52w', '?')}
"""

    evidence_summary = "\n".join([
        f"- [{e.get('tier','?')}] {e.get('title','')}: {e.get('snippet','')[:250]}"
        for e in evidence_list[:8]
    ])

    # Peer benchmarking context
    peer_context = ""
    if company_ticker:
        peer_data = _lookup_sic_peers(company_ticker, claim_text)
        if peer_data:
            peer_context = f"""
PEER BENCHMARKING (same SIC code):
- Industry: {peer_data.get('industry', 'N/A')}
- Peers analyzed: {', '.join(peer_data.get('peer_tickers', []))}
- Industry median growth: {peer_data.get('median_growth', 'N/A')}
- Best performer growth: {peer_data.get('best_growth', 'N/A')}
- Worst performer growth: {peer_data.get('worst_growth', 'N/A')}
"""

    prompt = f"""Assess the PLAUSIBILITY of this forward-looking financial claim given current data AND peer benchmarks.

CLAIM: "{claim_text}"
COMPANY: {company_ticker or 'Unknown'}
{xbrl_context}
{market_context}
{peer_context}
EVIDENCE:
{evidence_summary}

Analyze:
1. What specific projection is being made? (target metric, target value, target date)
2. What is the current trajectory based on available data?
3. What growth rate / improvement rate would be needed to hit the target?
4. Is that rate realistic given historical performance and industry benchmarks?
5. How does this compare to peer companies in the same industry?
6. Is this claim a statistical outlier relative to peers?
7. What are the key risks that could derail the projection?

Return ONLY valid JSON:
{{
  "is_forward_looking": true,
  "projection": {{
    "target_metric": "e.g. profitability, revenue, market share",
    "target_value": "e.g. breakeven, $1B, 20%",
    "target_date": "e.g. Q3 2026, end of 2025",
    "implied_growth_rate": "e.g. 40% CAGR needed"
  }},
  "current_trajectory": {{
    "current_value": "latest known value",
    "trend": "improving|stable|declining|insufficient_data",
    "historical_growth_rate": "e.g. 25% YoY or N/A"
  }},
  "peer_comparison": {{
    "industry_median": "e.g. 8% growth",
    "best_in_class": "e.g. 25% growth",
    "is_outlier": true,
    "outlier_explanation": "Claimed 40% growth vs industry median of 8% — 5x the median, exceeds best performer"
  }},
  "plausibility_score": 0-100,
  "plausibility_level": "highly_plausible|plausible|uncertain|implausible|highly_implausible",
  "assessment": "2-3 sentence assessment of whether the projection is achievable",
  "key_risks": ["risk 1", "risk 2"],
  "key_assumptions": ["assumption 1", "assumption 2"]
}}

Return ONLY valid JSON."""

    raw = _call_llm(
        prompt,
        "You are a financial analyst specializing in forward-looking statement analysis. "
        "Evaluate projections against current financial data, historical trends, and industry benchmarks. "
        "Be rigorous — most forward-looking claims in CIMs and pitch decks are optimistic."
    )
    parsed = _parse_json_from_llm(raw)
    if isinstance(parsed, dict):
        return parsed
    return None


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
    prompt = f"""Extract EVERY discrete, verifiable factual claim from this text. Be thorough — focus on financial and business claims that can be verified against SEC filings, earnings calls, market data, and third-party sources.

INCLUDE these types of claims:
- Financial metrics: revenue, margins, EPS, growth rates, profitability figures ("gross margin was 46.2%", "revenue of $94.8 billion")
- Valuation: multiples, enterprise value, market cap ("trades at 25x earnings", "market cap of $3 trillion")
- Transactions: M&A deals, IPOs, buybacks with parties, values, dates ("acquired Activision for $68.7B")
- Regulatory: compliance statements, filing references, capital ratios ("CET1 ratio was 15.0%", "no material litigation pending")
- Guidance / Forward-looking: projections, targets, timelines ("expects revenue growth of 10-12%", "expects to reach profitability by Q3 2026")
- Operational: delivery numbers, headcount, market share ("delivered 1.81 million vehicles")
- Comparative: year-over-year changes, rankings, superlatives ("grew 409% year-over-year", "#1 player in our market")
- Attribution: claims citing a third-party source ("According to Gartner, the market will grow 15%", "McKinsey estimates 30% cost reduction")
- CIM / Pitch Deck specific: TAM/SAM/SOM figures, customer retention rates, unit economics, LTV/CAC, ARR, NRR, runway, burn rate

EXCLUDE (do NOT extract):
- Opinions, subjective analysis, rhetorical questions
- Vague statements without specific verifiable data points
- Author biographical info or article metadata

Rules:
- Each claim must be a single, atomic, independently verifiable statement
- Provide the original wording and a normalized version optimized for financial search
- Tag type: "financial_metric" | "valuation" | "transaction" | "regulatory" | "guidance" | "attribution" | "comparative" | "operational"
- For attribution claims, include the cited source in the normalized version
- For guidance/forward-looking claims, note the projection date and target date
- Extract company ticker when possible
- Include approximate location in the text (beginning, middle, end, or paragraph number if discernible)

TEXT:
{text[:8000]}

Return ONLY a JSON array:
[
  {{
    "id": "claim-1",
    "original": "exact text from source",
    "normalized": "clean searchable version",
    "type": "financial_metric|valuation|transaction|regulatory|guidance|attribution|comparative|operational",
    "company_ticker": "AAPL or null",
    "location": "beginning|middle|end or paragraph N"
  }}
]

Extract 8-25 claims. Be thorough. Return ONLY valid JSON, no markdown."""

    raw = _call_llm(prompt, "You are a precise financial claim extraction engine specializing in SEC filings, earnings data, CIMs, pitch decks, and market metrics. Extract every verifiable assertion. Return only valid JSON arrays.")
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
# Step 2b: Entity Resolution
# ---------------------------------------------------------------------------

def resolve_entities(claim_text: str, subclaims: List[Dict], company_ticker: str = "") -> Dict:
    """Resolve ambiguous entity references across a claim and its sub-claims.

    Maps pronouns ("the Company", "we"), abbreviations ("AWS"), subsidiaries,
    and product names to canonical entity identifiers so downstream stages
    compare like-for-like.
    """
    subclaim_texts = "\n".join(f"- {sc['text']}" for sc in subclaims)

    prompt = f"""Resolve all entity references in this financial claim and its sub-claims.

CLAIM: "{claim_text}"
COMPANY TICKER (if known): {company_ticker or 'Unknown'}

SUB-CLAIMS:
{subclaim_texts}

Identify every entity reference (companies, subsidiaries, products, segments, people) and map them to canonical names.

Examples of what to resolve:
- "the Company" / "we" / "our" → the actual company name
- "AWS" / "Amazon Web Services segment" → "Amazon Web Services (AMZN subsidiary)"
- "iPhone revenue" / "Products segment" → same segment
- Acquired companies referenced by old vs new names

Return ONLY valid JSON:
{{
  "entities": [
    {{
      "canonical_name": "Apple Inc.",
      "ticker": "AAPL",
      "type": "company|subsidiary|segment|product|person",
      "aliases": ["the Company", "we", "Apple", "AAPL"]
    }}
  ],
  "resolutions": [
    {{
      "original_text": "the Company",
      "resolved_to": "Apple Inc. (AAPL)",
      "context": "which sub-claim or part of claim"
    }}
  ],
  "ambiguities": ["any unresolvable references"]
}}"""

    raw = _call_llm(prompt, "You are a financial entity resolution engine. Disambiguate company names, subsidiaries, segments, and pronouns in financial text.")
    parsed = _parse_json_from_llm(raw)
    if isinstance(parsed, dict):
        return parsed
    return {"entities": [], "resolutions": [], "ambiguities": []}


# ---------------------------------------------------------------------------
# Step 2c: Financial Normalization
# ---------------------------------------------------------------------------

def normalize_financial_claims(claim_text: str, subclaims: List[Dict], company_ticker: str = "") -> Dict:
    """Normalize financial expressions to standard units and definitions.

    Standardizes:
    - Units: millions vs thousands vs billions ($150M → $150,000,000)
    - Time periods: LTM vs fiscal year vs calendar year vs quarterly
    - Accounting definitions: revenue vs net revenue vs gross revenue vs ARR vs bookings
    - Currency: USD vs local currency, nominal vs real
    """
    subclaim_texts = "\n".join(f"- [{sc['id']}] {sc['text']}" for sc in subclaims)

    prompt = f"""Normalize the financial expressions in these claims to standard, comparable forms.

CLAIM: "{claim_text}"
COMPANY: {company_ticker or 'Unknown'}

SUB-CLAIMS:
{subclaim_texts}

For each sub-claim containing a financial figure, normalize:

1. UNITS: Convert all to explicit full numbers or standard abbreviations
   - "revenue of $150M" → "$150,000,000 (millions)"
   - "roughly $150M in top-line" → "$150,000,000 (approximate, millions)"

2. TIME PERIOD: Identify and standardize the reporting period
   - "FY2024 revenue" → "fiscal year ending [date]"
   - "LTM revenue" → "last twelve months ending [date]"
   - "Q4 revenue" → "quarter ending [date]"
   - Flag if period is ambiguous

3. ACCOUNTING DEFINITION: Flag which specific metric is being used
   - "revenue" vs "net revenue" vs "gross revenue"
   - "GAAP" vs "non-GAAP" / "pro-forma" vs "adjusted"
   - "ARR" vs "revenue" vs "bookings" vs "billings"

4. CURRENCY: Note currency and whether nominal or inflation-adjusted

Return ONLY valid JSON:
{{
  "normalizations": [
    {{
      "subclaim_id": "sub-1",
      "original_expression": "revenue of $150M",
      "normalized_value": "$150,000,000",
      "unit": "USD",
      "period": "FY2024 (fiscal year ending Sep 2024)",
      "accounting_basis": "net revenue, GAAP",
      "precision": "exact|approximate|rounded",
      "flags": ["period_ambiguous", "gaap_vs_nongaap_unclear", "pro_forma_not_disclosed"]
    }}
  ],
  "comparison_warnings": [
    "CIM states 'revenue of $150M' but this may refer to gross revenue while 10-K reports net revenue of $148.3M — definitions may not be comparable"
  ]
}}"""

    raw = _call_llm(
        prompt,
        "You are a financial normalization engine. Standardize units, time periods, "
        "accounting definitions, and currency across financial claims. Flag ambiguities. "
        "This is critical for accurate cross-source comparison."
    )
    parsed = _parse_json_from_llm(raw)
    if isinstance(parsed, dict):
        return parsed
    return {"normalizations": [], "comparison_warnings": []}


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

    # Tier 4: FRED Macro Data (if claim references macro indicators)
    fred_result = lookup_fred_data(subclaim)
    if fred_result:
        eid += 1
        fred_snippet_parts = [
            f"Series: {fred_result.get('series_id', '')}",
            f"Latest: {fred_result['latest_value']} ({fred_result['latest_date']})",
        ]
        if fred_result.get("yoy_change_pct") is not None:
            fred_snippet_parts.append(f"YoY Change: {fred_result['yoy_change_pct']}%")
        trend_vals = fred_result.get("observations", [])
        if len(trend_vals) >= 3:
            fred_snippet_parts.append(f"Trend (last 3): {', '.join(str(o['value']) for o in trend_vals[:3])}")
        evidence.append({
            "id": f"ev-{eid}",
            "title": f"FRED Macro Data — {fred_result.get('series_id', '')}",
            "snippet": " | ".join(fred_snippet_parts),
            "source": fred_result.get("data_source", "FRED"),
            "tier": "market_data",
            "filing_date": fred_result.get("latest_date", ""),
            "fred_data": fred_result,
        })

    # Tier 5: Yahoo Finance Market Data (if we have a ticker)
    if company_ticker:
        market_result = lookup_market_data(company_ticker, subclaim)
        if market_result and market_result.get("current_price"):
            eid += 1
            mkt_snippet_parts = [
                f"Price: ${market_result['current_price']:.2f}",
                f"Exchange: {market_result.get('exchange', '')}",
            ]
            if market_result.get("yoy_return_pct") is not None:
                mkt_snippet_parts.append(f"1Y Return: {market_result['yoy_return_pct']}%")
            if market_result.get("high_52w") and market_result.get("low_52w"):
                mkt_snippet_parts.append(f"52W Range: ${market_result['low_52w']} - ${market_result['high_52w']}")
            evidence.append({
                "id": f"ev-{eid}",
                "title": f"Market Data — {company_ticker}",
                "snippet": " | ".join(mkt_snippet_parts),
                "source": market_result.get("data_source", "Yahoo Finance"),
                "tier": "market_data",
                "company_ticker": company_ticker,
                "market_data": market_result,
            })

    # Tier 6: Counter-evidence (deliberate)
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
# Calibrated Confidence Scoring
# ---------------------------------------------------------------------------

# Tier authority weights — higher = more authoritative
_TIER_WEIGHTS = {
    "sec_filing": 1.0,
    "earnings_transcript": 0.8,
    "press_release": 0.5,
    "analyst_report": 0.5,
    "market_data": 0.7,
    "academic": 0.6,
    "institutional": 0.5,
    "journalism": 0.3,
    "counter": 0.3,
}

def compute_calibrated_confidence(evidence_list: List[Dict]) -> Dict:
    """Compute a calibrated confidence score from evidence signals.

    Returns a dict with:
      - score (0-100): overall calibrated confidence
      - level: "high" / "medium" / "low" (derived from score)
      - breakdown: dict of the 4 component scores + weights
    """
    if not evidence_list:
        return {
            "score": 0, "level": "low",
            "breakdown": {
                "source_count": {"value": 0, "score": 0, "weight": 0.20},
                "tier_quality": {"value": 0, "score": 0, "weight": 0.30},
                "agreement_ratio": {"value": 0, "score": 0, "weight": 0.35},
                "recency": {"value": 0, "score": 0, "weight": 0.15},
            },
        }

    # --- Signal 1: Source Count (20% weight) ---
    n = len(evidence_list)
    # 1 source = 20, 3 = 60, 5+ = 90, 8+ = 100
    source_count_score = min(100, 20 + (n - 1) * 15) if n >= 1 else 0

    # --- Signal 2: Tier Quality Distribution (30% weight) ---
    # Weighted average of tier authority across all evidence
    tier_scores = [_TIER_WEIGHTS.get(e.get("tier", ""), 0.2) for e in evidence_list]
    avg_tier = sum(tier_scores) / len(tier_scores) if tier_scores else 0
    tier_quality_score = round(avg_tier * 100)
    # Bonus: if we have SEC filing evidence, boost
    has_sec = any(e.get("tier") == "sec_filing" for e in evidence_list)
    if has_sec:
        tier_quality_score = min(100, tier_quality_score + 15)

    # --- Signal 3: Agreement Ratio (35% weight) ---
    # What % of scored evidence supports the claim?
    scored = [e for e in evidence_list if e.get("supports_claim") is not None]
    if scored:
        supporting = sum(1 for e in scored if e.get("supports_claim") is True or e.get("supports_claim") == "partial")
        opposing = sum(1 for e in scored if e.get("supports_claim") is False)
        total_scored = len(scored)
        support_ratio = supporting / total_scored
        oppose_ratio = opposing / total_scored
        # High agreement (all support) = 100, split = 50, all oppose = still informative (70 — we're confident it's wrong)
        if oppose_ratio > 0.5:
            agreement_score = round(oppose_ratio * 80)  # confident contradiction
        else:
            agreement_score = round(support_ratio * 100)
    else:
        agreement_score = 30  # no scored evidence = low agreement signal

    # --- Signal 4: Source Recency (15% weight) ---
    current_year = 2026
    years = []
    for e in evidence_list:
        y = e.get("year")
        if y and isinstance(y, (int, float)):
            years.append(int(y))
        # Try to parse from filing_date
        fd = e.get("filing_date", "")
        if fd and len(fd) >= 4:
            try:
                years.append(int(fd[:4]))
            except (ValueError, TypeError):
                pass
    if years:
        avg_age = current_year - (sum(years) / len(years))
        # 0 years old = 100, 2 years = 80, 5 years = 50, 10+ = 20
        recency_score = max(10, round(100 - avg_age * 10))
        recency_score = min(100, recency_score)
        newest = max(years)
    else:
        recency_score = 50  # unknown recency
        newest = None

    # --- Weighted combination ---
    weights = {"source_count": 0.20, "tier_quality": 0.30, "agreement_ratio": 0.35, "recency": 0.15}
    raw_score = (
        source_count_score * weights["source_count"]
        + tier_quality_score * weights["tier_quality"]
        + agreement_score * weights["agreement_ratio"]
        + recency_score * weights["recency"]
    )
    final_score = round(min(100, max(0, raw_score)))

    # Derive level
    if final_score >= 70:
        level = "high"
    elif final_score >= 40:
        level = "medium"
    else:
        level = "low"

    return {
        "score": final_score,
        "level": level,
        "breakdown": {
            "source_count": {"value": n, "score": source_count_score, "weight": weights["source_count"]},
            "tier_quality": {"value": round(avg_tier, 2), "score": tier_quality_score, "weight": weights["tier_quality"], "has_sec_filing": has_sec},
            "agreement_ratio": {"value": round(supporting / total_scored, 2) if scored else 0, "score": agreement_score, "weight": weights["agreement_ratio"], "supporting": supporting if scored else 0, "opposing": opposing if scored else 0, "total_scored": len(scored)},
            "recency": {"value": newest, "score": recency_score, "weight": weights["recency"]},
        },
    }


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
    result = parsed if isinstance(parsed, dict) else {"verdict": "unsupported", "confidence": "low", "summary": "Could not synthesize verdict."}

    # Override LLM confidence with calibrated score
    cal = compute_calibrated_confidence(evidence_list)
    result["confidence"] = cal["level"]
    result["confidence_score"] = cal["score"]
    result["confidence_breakdown"] = cal["breakdown"]
    return result


# ---------------------------------------------------------------------------
# Step 6: Overall Verdict
# ---------------------------------------------------------------------------

def synthesize_overall_verdict(claim: str, subclaim_verdicts: List[Dict], all_evidence: List[Dict] = None) -> Dict:
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
    result = parsed if isinstance(parsed, dict) else {"verdict": "unsupported", "confidence": "low", "summary": "Could not determine overall verdict."}

    # Override LLM confidence with calibrated score computed from all evidence
    if all_evidence:
        cal = compute_calibrated_confidence(all_evidence)
    else:
        # Fallback: average sub-claim confidence scores
        sc_scores = [v.get("confidence_score", 50) for v in subclaim_verdicts]
        avg = round(sum(sc_scores) / len(sc_scores)) if sc_scores else 0
        level = "high" if avg >= 70 else ("medium" if avg >= 40 else "low")
        cal = {"score": avg, "level": level, "breakdown": {}}
    result["confidence"] = cal["level"]
    result["confidence_score"] = cal["score"]
    result["confidence_breakdown"] = cal["breakdown"]
    return result


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
# Verdict Reconciliation — "Is the core claim actually true?"
# ---------------------------------------------------------------------------

def reconcile_verdict(
    claim_text: str,
    overall_verdict: Dict,
    corrected_claim: Dict,
    subclaim_verdicts: List[Dict],
    evidence_list: List[Dict],
) -> Dict:
    """Final reconciliation step: assess whether the original claim is fundamentally
    true, even if sub-claims returned mixed/partial verdicts.

    The mechanical verdict pipeline can mark "They IPOed in 2021" as MIXED because
    sub-claims about exact dates or filing details are only partially supported.
    But the core claim is TRUE — a reasonable person would not be misled.

    This step produces a human-readable accuracy assessment and may override
    the mechanical verdict when the core assertion is correct.
    """
    subclaim_summary = "\n".join([
        f"- \"{v.get('text', '')}\": {v.get('verdict', '?')} — {v.get('summary', '')}"
        for v in subclaim_verdicts
    ])

    evidence_summary = "\n".join([
        f"- [{e.get('tier','?')}] {e.get('title','')}: {e.get('snippet','')[:200]}"
        for e in evidence_list[:8]
    ])

    prompt = f"""You are performing a FINAL reconciliation of a fact-check verdict.

The verification pipeline broke this claim into sub-claims and checked each one independently. Sometimes this produces a "mixed" or "partially_supported" verdict even when the CORE CLAIM is fundamentally true — because sub-claims about minor details (exact dates, filing references, precise wording) were only partially confirmed.

Your job: Look at the ORIGINAL CLAIM as a whole and determine whether a reasonable, informed person reading it would be misled.

ORIGINAL CLAIM: "{claim_text}"

MECHANICAL VERDICT: {overall_verdict.get('verdict', '?')} ({overall_verdict.get('confidence', '?')} confidence)
VERDICT SUMMARY: {overall_verdict.get('summary', '')}

SUB-CLAIM VERDICTS:
{subclaim_summary}

CORRECTED VERSION: "{corrected_claim.get('corrected', '')}"

KEY EVIDENCE:
{evidence_summary}

Answer these questions:
1. Is the CORE ASSERTION of the original claim true? (Yes/No/Partially)
2. Would a reasonable person reading the original claim be misled? (Yes/No)
3. Does the corrected version change the meaning, or just add precision/detail?
4. Should the mechanical verdict be overridden?

Return ONLY valid JSON:
{{
  "core_claim_true": true or false,
  "misleading": false or true,
  "accuracy_level": "true|essentially_true|misleading|false",
  "reconciled_verdict": "supported|partially_supported|exaggerated|contradicted|unsupported|mixed",
  "override_mechanical": true or false,
  "explanation": "1-2 sentence plain-language assessment. E.g. 'This statement is true. GitLab did IPO in 2021. The correction adds the exact date (October 14) and filing details, but the original claim is not misleading.'",
  "detail_added": "What the correction adds beyond the original claim, if anything"
}}"""

    raw = _call_llm(
        prompt,
        "You are a senior fact-checker performing final verdict reconciliation. "
        "Your job is to determine whether the CORE CLAIM is true, even if sub-claims "
        "about minor details were only partially confirmed. Be practical — if the claim "
        "would not mislead a reasonable reader, it should be marked as true or essentially true."
    )
    parsed = _parse_json_from_llm(raw)
    if isinstance(parsed, dict):
        return parsed
    return {
        "core_claim_true": None,
        "misleading": None,
        "accuracy_level": "unknown",
        "reconciled_verdict": overall_verdict.get("verdict", "unsupported"),
        "override_mechanical": False,
        "explanation": "Could not reconcile verdict.",
        "detail_added": "",
    }


# ---------------------------------------------------------------------------
# Materiality Scoring
# ---------------------------------------------------------------------------

def score_materiality(claim_text: str, verdict: Dict, subclaim_verdicts: List[Dict]) -> Dict:
    """Score the materiality of a claim error — not all wrong claims matter equally.

    A CIM that exaggerates revenue growth from 31% to 40% is material (affects valuation).
    A CIM that says "founded in 2015" when it was 2014 is immaterial.

    Categories:
    - CRITICAL: Financial performance, valuation drivers, deal terms
    - HIGH: Risk factors, regulatory status, material contracts
    - MEDIUM: Operational metrics, market position, competitive claims
    - LOW: Historical facts, biographical info, immaterial details
    """
    verdict_str = verdict.get("verdict", "unsupported")
    confidence_str = verdict.get("confidence", "low")
    summary = verdict.get("summary", "")

    subclaim_summary = "\n".join([
        f"- {v.get('text', '')}: {v.get('verdict', '?')} — {v.get('summary', '')}"
        for v in subclaim_verdicts
    ])

    prompt = f"""Assess the MATERIALITY of any errors or issues found in this financial claim.

CLAIM: "{claim_text}"
VERDICT: {verdict_str} ({confidence_str} confidence)
VERDICT SUMMARY: {summary}

SUB-CLAIM DETAILS:
{subclaim_summary}

Materiality determines whether an error actually matters for investment decisions, deal valuation, or risk assessment.

Score materiality based on:
1. Does this claim relate to financial performance (revenue, margins, growth)? → HIGH materiality
2. Does it affect valuation (multiples, DCF inputs, comparable analysis)? → CRITICAL materiality
3. Does it relate to risk factors (litigation, regulatory, going concern)? → HIGH materiality
4. Does it relate to deal terms (purchase price, earnouts, representations)? → CRITICAL materiality
5. Is it an operational metric (headcount, customers, market share)? → MEDIUM materiality
6. Is it historical/biographical (founding date, HQ location)? → LOW materiality

Also assess the MAGNITUDE of the error:
- Revenue overstated by 25% → CRITICAL
- Revenue overstated by 2% → LOW (within rounding)
- Growth rate of 40% vs actual 31% → HIGH (9 percentage point gap)

Return ONLY valid JSON:
{{
  "materiality_level": "critical|high|medium|low",
  "materiality_score": 0-100,
  "category": "financial_performance|valuation_driver|risk_factor|deal_terms|operational|market_position|historical",
  "error_magnitude": "description of how big the error is, or 'N/A' if claim is supported",
  "impact_assessment": "1-2 sentences on how this error would affect an investment decision or deal",
  "attention_flag": true or false
}}"""

    raw = _call_llm(
        prompt,
        "You are a financial materiality assessor for M&A due diligence. "
        "Determine whether claim errors are material to investment decisions. "
        "Be calibrated — not every error matters."
    )
    parsed = _parse_json_from_llm(raw)
    if isinstance(parsed, dict):
        return parsed
    return {
        "materiality_level": "medium",
        "materiality_score": 50,
        "category": "operational",
        "error_magnitude": "N/A",
        "impact_assessment": "Could not assess materiality.",
        "attention_flag": False,
    }


# ---------------------------------------------------------------------------
# Source Authority Hierarchy (for Provenance)
# ---------------------------------------------------------------------------

_SOURCE_AUTHORITY = {
    "sec_filing": {"rank": 1, "label": "SEC Filing (legally binding)", "weight": 1.0},
    "audited_financial": {"rank": 2, "label": "Audited Financials", "weight": 0.95},
    "earnings_transcript": {"rank": 3, "label": "Earnings Call (management statement)", "weight": 0.80},
    "press_release": {"rank": 4, "label": "Press Release (company-issued)", "weight": 0.60},
    "market_data": {"rank": 5, "label": "Market Data Feed", "weight": 0.70},
    "news_coverage": {"rank": 6, "label": "News Coverage (secondary)", "weight": 0.40},
    "analyst_report": {"rank": 7, "label": "Analyst Estimate (opinion)", "weight": 0.35},
    "counter": {"rank": 8, "label": "Counter-Evidence Search", "weight": 0.30},
    "management_materials": {"rank": 9, "label": "Management Pitch Materials (lowest)", "weight": 0.20},
}

def compute_source_authority_conflicts(evidence_list: List[Dict]) -> List[Dict]:
    """Identify cases where lower-authority sources contradict higher-authority sources.

    When a CIM claim contradicts an SEC filing, that's a five-alarm fire.
    When it contradicts an analyst estimate, that's just a difference of opinion.
    """
    conflicts = []
    # Group evidence by support/oppose
    supporting = [e for e in evidence_list if e.get("supports_claim") is True]
    opposing = [e for e in evidence_list if e.get("supports_claim") is False]

    for opp in opposing:
        opp_tier = opp.get("tier", "")
        opp_auth = _SOURCE_AUTHORITY.get(opp_tier, {})
        opp_rank = opp_auth.get("rank", 99)

        for sup in supporting:
            sup_tier = sup.get("tier", "")
            sup_auth = _SOURCE_AUTHORITY.get(sup_tier, {})
            sup_rank = sup_auth.get("rank", 99)

            # Flag when a high-authority source opposes and a lower one supports
            if opp_rank < sup_rank:
                severity = "critical" if opp_rank <= 2 else ("high" if opp_rank <= 4 else "medium")
                conflicts.append({
                    "id": f"auth-conflict-{len(conflicts)+1}",
                    "higher_authority": {
                        "id": opp["id"],
                        "tier": opp_tier,
                        "authority_label": opp_auth.get("label", opp_tier),
                        "rank": opp_rank,
                        "position": "opposes claim",
                    },
                    "lower_authority": {
                        "id": sup["id"],
                        "tier": sup_tier,
                        "authority_label": sup_auth.get("label", sup_tier),
                        "rank": sup_rank,
                        "position": "supports claim",
                    },
                    "severity": severity,
                    "implication": f"Claim is supported by {sup_auth.get('label', sup_tier)} but contradicted by {opp_auth.get('label', opp_tier)} — higher authority source disagrees.",
                })

    return conflicts


# ---------------------------------------------------------------------------
# Risk Signal Extraction (Stage 12)
# ---------------------------------------------------------------------------

def extract_risk_signals(
    claim_text: str,
    overall_verdict: Dict,
    subclaim_verdicts: List[Dict],
    contradictions: List[Dict],
    consistency_issues: List[Dict],
    materiality: Dict,
    authority_conflicts: List[Dict],
    plausibility: Optional[Dict] = None,
    normalization: Optional[Dict] = None,
) -> Dict:
    """Synthesize all verification findings into actionable risk signals for the deal team.

    Not just "these claims are wrong" but "based on the pattern of issues,
    here's what we think is happening and what you should do about it."
    """
    # Build context from all prior stages
    verdict_summary = f"Overall: {overall_verdict.get('verdict', '?')} ({overall_verdict.get('confidence', '?')} confidence)"
    subclaim_lines = "\n".join([
        f"- {v.get('text', '')}: {v.get('verdict', '?')}"
        for v in subclaim_verdicts
    ])
    contradiction_lines = "\n".join([
        f"- [{c.get('severity', '?')}] {c.get('explanation', '')}"
        for c in contradictions
    ]) or "None detected"
    consistency_lines = "\n".join([
        f"- [{c.get('severity', '?')} {c.get('type', '')}] {c.get('description', '')}"
        for c in consistency_issues
    ]) or "None detected"
    authority_lines = "\n".join([
        f"- [{c.get('severity', '?')}] {c.get('implication', '')}"
        for c in authority_conflicts
    ]) or "None detected"

    materiality_str = f"Level: {materiality.get('materiality_level', '?')}, Category: {materiality.get('category', '?')}, Impact: {materiality.get('impact_assessment', '?')}"

    plausibility_str = ""
    if plausibility:
        plausibility_str = f"\nPlausibility: {plausibility.get('plausibility_level', '?')} (score: {plausibility.get('plausibility_score', '?')})"
        peer = plausibility.get("peer_comparison", {})
        if peer.get("is_outlier"):
            plausibility_str += f"\nPeer outlier: {peer.get('outlier_explanation', '')}"

    normalization_str = ""
    if normalization and normalization.get("comparison_warnings"):
        normalization_str = "\nNormalization warnings:\n" + "\n".join(f"- {w}" for w in normalization["comparison_warnings"])

    prompt = f"""Based on the COMPLETE verification analysis below, synthesize actionable risk signals for a deal team or investment committee.

CLAIM ANALYZED: "{claim_text}"

VERIFICATION RESULTS:
{verdict_summary}

SUB-CLAIM VERDICTS:
{subclaim_lines}

CONTRADICTIONS:
{contradiction_lines}

CONSISTENCY ISSUES:
{consistency_lines}

SOURCE AUTHORITY CONFLICTS:
{authority_lines}

MATERIALITY: {materiality_str}
{plausibility_str}
{normalization_str}

Synthesize these findings into a risk assessment. Look for PATTERNS:
- Does management consistently overstate growth metrics?
- Are pro-forma numbers used without disclosure?
- Do forward-looking projections have historical misses?
- Are there authority conflicts (SEC filings vs management claims)?
- Are there restatement or temporal consistency red flags?

Return ONLY valid JSON:
{{
  "risk_level": "critical|high|medium|low|minimal",
  "risk_score": 0-100,
  "headline": "One-line risk summary for the deal team",
  "patterns_detected": [
    {{
      "pattern": "e.g. Systematic growth overstatement",
      "evidence": "e.g. Revenue growth claimed at 40% vs actual 31%, margin claimed at 46% vs actual 43%",
      "frequency": "e.g. 3 of 5 financial claims exaggerated"
    }}
  ],
  "red_flags": ["specific red flag 1", "specific red flag 2"],
  "recommended_actions": [
    "e.g. Request audited financials for independent verification of revenue figures",
    "e.g. Clarify whether reported metrics are GAAP or pro-forma"
  ],
  "risk_narrative": "2-4 sentence narrative explaining the overall risk picture for the deal team"
}}"""

    raw = _call_llm(
        prompt,
        "You are a senior due diligence analyst synthesizing verification findings into "
        "actionable risk signals for an M&A deal team or investment committee. "
        "Be direct, specific, and actionable. Focus on patterns, not individual errors."
    )
    parsed = _parse_json_from_llm(raw)
    if isinstance(parsed, dict):
        return parsed
    return {
        "risk_level": "medium",
        "risk_score": 50,
        "headline": "Verification complete — review findings",
        "patterns_detected": [],
        "red_flags": [],
        "recommended_actions": [],
        "risk_narrative": "Could not synthesize risk signals.",
    }


# ---------------------------------------------------------------------------
# Full Pipeline (Generator for SSE streaming)
# ---------------------------------------------------------------------------

def run_verification_pipeline(claim_text: str) -> Generator[VerificationEvent, None, None]:
    """Run the full multi-stage financial verification pipeline, yielding events for SSE streaming."""

    t0 = time.time()

    # --- Detect company ticker early (used by many stages) ---
    ticker_prompt = f'What stock ticker (e.g. AAPL, MSFT, TSLA) does this claim reference? Return ONLY the ticker symbol, or "NONE" if no specific company.\n\nClaim: "{claim_text}"'
    detected_ticker = _call_llm(ticker_prompt, "Return only a stock ticker symbol or NONE.").strip().upper().replace('"', '').replace("'", "")
    if detected_ticker == "NONE" or len(detected_ticker) > 6 or " " in detected_ticker:
        detected_ticker = ""

    # --- Stage 1: Decomposition ---
    yield VerificationEvent("step_start", {"step": "decomposition", "label": "Decomposing financial claim..."})
    subclaims = decompose_claim(claim_text)
    for sc in subclaims:
        yield VerificationEvent("subclaim", {"id": sc["id"], "text": sc["text"], "type": sc["type"]})
    yield VerificationEvent("step_complete", {"step": "decomposition", "count": len(subclaims), "duration_ms": int((time.time() - t0) * 1000)})

    # --- Stage 2: Entity Resolution ---
    yield VerificationEvent("step_start", {"step": "entity_resolution", "label": "Resolving entity references..."})
    entity_resolution = resolve_entities(claim_text, subclaims, company_ticker=detected_ticker)
    yield VerificationEvent("entity_resolution", {
        "entities": entity_resolution.get("entities", []),
        "resolutions": entity_resolution.get("resolutions", []),
        "ambiguities": entity_resolution.get("ambiguities", []),
    })
    # If entity resolution found a ticker we didn't have, use it
    if not detected_ticker:
        for ent in entity_resolution.get("entities", []):
            if ent.get("ticker") and ent.get("type") == "company":
                detected_ticker = ent["ticker"].upper().strip()
                break
    yield VerificationEvent("step_complete", {"step": "entity_resolution", "duration_ms": int((time.time() - t0) * 1000)})

    # --- Stage 3: Financial Normalization ---
    yield VerificationEvent("step_start", {"step": "normalization", "label": "Normalizing financial expressions..."})
    normalization = normalize_financial_claims(claim_text, subclaims, company_ticker=detected_ticker)
    yield VerificationEvent("normalization", {
        "normalizations": normalization.get("normalizations", []),
        "comparison_warnings": normalization.get("comparison_warnings", []),
    })
    yield VerificationEvent("step_complete", {"step": "normalization", "duration_ms": int((time.time() - t0) * 1000)})

    # --- Stage 4: Evidence Retrieval (per sub-claim) ---
    all_evidence: List[Dict] = []
    yield VerificationEvent("step_start", {"step": "evidence_retrieval", "label": "Searching SEC filings, earnings & news..."})

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

    # --- Stage 5: Evidence Quality Evaluation ---
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

    # --- Stage 6: Contradiction Detection ---
    yield VerificationEvent("step_start", {"step": "contradictions", "label": "Detecting cross-source contradictions..."})
    contradictions = detect_contradictions(claim_text, all_evidence)
    for c in contradictions:
        yield VerificationEvent("contradiction_detected", c)
    yield VerificationEvent("contradictions_complete", {"count": len(contradictions), "duration_ms": int((time.time() - t0) * 1000)})
    yield VerificationEvent("step_complete", {"step": "contradictions", "duration_ms": int((time.time() - t0) * 1000)})

    # --- Stage 7: Consistency Analysis (with temporal restatement detection) ---
    yield VerificationEvent("step_start", {"step": "consistency", "label": "Analyzing cross-document consistency..."})
    consistency_issues = check_cross_document_consistency(claim_text, all_evidence, company_ticker=detected_ticker)
    for ci in consistency_issues:
        yield VerificationEvent("consistency_issue", ci)
    yield VerificationEvent("step_complete", {"step": "consistency", "count": len(consistency_issues), "duration_ms": int((time.time() - t0) * 1000)})

    # --- Stage 8: Plausibility Assessment (with peer benchmarking) ---
    yield VerificationEvent("step_start", {"step": "plausibility", "label": "Assessing plausibility & peer benchmarks..."})
    plausibility = assess_forward_looking_plausibility(claim_text, all_evidence, company_ticker=detected_ticker)
    if plausibility:
        yield VerificationEvent("plausibility_assessment", plausibility)
    yield VerificationEvent("step_complete", {"step": "plausibility", "duration_ms": int((time.time() - t0) * 1000)})

    # --- Stage 9: Verdict Synthesis (with materiality) ---
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
            "confidence_score": verdict.get("confidence_score"),
            "confidence_breakdown": verdict.get("confidence_breakdown"),
            "summary": verdict.get("summary", ""),
            "verified_against": verdict.get("verified_against"),
        })

    overall = synthesize_overall_verdict(claim_text, subclaim_verdicts, all_evidence=all_evidence)
    yield VerificationEvent("overall_verdict", {
        "verdict": overall.get("verdict", "unsupported"),
        "confidence": overall.get("confidence", "low"),
        "confidence_score": overall.get("confidence_score"),
        "confidence_breakdown": overall.get("confidence_breakdown"),
        "summary": overall.get("summary", ""),
        "detail": overall.get("detail", ""),
    })

    # Materiality scoring
    materiality = score_materiality(claim_text, overall, subclaim_verdicts)
    yield VerificationEvent("materiality", materiality)

    yield VerificationEvent("step_complete", {"step": "synthesis", "duration_ms": int((time.time() - t0) * 1000)})

    # --- Stage 10: Provenance Tracing (with source authority hierarchy) ---
    yield VerificationEvent("step_start", {"step": "provenance", "label": "Tracing claim origins & source authority..."})
    provenance = trace_provenance(claim_text, all_evidence)
    for node in provenance.get("nodes", []):
        yield VerificationEvent("provenance_node", node)
    for edge in provenance.get("edges", []):
        yield VerificationEvent("provenance_edge", edge)
    yield VerificationEvent("provenance_complete", {"analysis": provenance.get("analysis", ""), "duration_ms": int((time.time() - t0) * 1000)})

    # Source authority conflict detection
    authority_conflicts = compute_source_authority_conflicts(all_evidence)
    for ac in authority_conflicts:
        yield VerificationEvent("authority_conflict", ac)

    yield VerificationEvent("step_complete", {"step": "provenance", "duration_ms": int((time.time() - t0) * 1000)})

    # --- Stage 11: Corrected Claim ---
    yield VerificationEvent("step_start", {"step": "correction", "label": "Generating corrected claim..."})
    corrected = generate_corrected_claim(claim_text, overall, all_evidence)
    yield VerificationEvent("corrected_claim", {
        "original": claim_text,
        "corrected": corrected.get("corrected", ""),
        "steelmanned": corrected.get("steelmanned", ""),
        "one_sentence": corrected.get("one_sentence", ""),
        "caveats": corrected.get("caveats", []),
    })

    # --- Stage 11b: Verdict Reconciliation ---
    yield VerificationEvent("step_start", {"step": "reconciliation", "label": "Reconciling final verdict..."})
    reconciliation = reconcile_verdict(claim_text, overall, corrected, subclaim_verdicts, all_evidence)
    yield VerificationEvent("reconciliation", reconciliation)

    # If reconciliation overrides the mechanical verdict, update overall
    if reconciliation.get("override_mechanical") and reconciliation.get("reconciled_verdict"):
        overall["verdict"] = reconciliation["reconciled_verdict"]
        overall["reconciled"] = True
        overall["reconciliation_explanation"] = reconciliation.get("explanation", "")
        yield VerificationEvent("overall_verdict", {
            "verdict": overall.get("verdict", "unsupported"),
            "confidence": overall.get("confidence", "low"),
            "confidence_score": overall.get("confidence_score"),
            "confidence_breakdown": overall.get("confidence_breakdown"),
            "summary": reconciliation.get("explanation", overall.get("summary", "")),
            "detail": overall.get("detail", ""),
            "reconciled": True,
        })

    yield VerificationEvent("step_complete", {"step": "correction", "duration_ms": int((time.time() - t0) * 1000)})

    # --- Stage 12: Risk Signal Extraction ---
    yield VerificationEvent("step_start", {"step": "risk_signals", "label": "Extracting risk signals..."})
    risk_signals = extract_risk_signals(
        claim_text=claim_text,
        overall_verdict=overall,
        subclaim_verdicts=subclaim_verdicts,
        contradictions=contradictions,
        consistency_issues=consistency_issues,
        materiality=materiality,
        authority_conflicts=authority_conflicts,
        plausibility=plausibility,
        normalization=normalization,
    )
    yield VerificationEvent("risk_signals", risk_signals)
    yield VerificationEvent("step_complete", {"step": "risk_signals", "duration_ms": int((time.time() - t0) * 1000)})

    # --- Done ---
    total_ms = int((time.time() - t0) * 1000)
    yield VerificationEvent("verification_complete", {
        "total_duration_ms": total_ms,
        "total_sources": len(all_evidence),
        "subclaims_count": len(subclaims),
        "overall_verdict": overall.get("verdict", "unsupported"),
        "contradictions_count": len(contradictions),
        "consistency_issues_count": len(consistency_issues),
        "has_plausibility": plausibility is not None,
        "materiality_level": materiality.get("materiality_level", "medium"),
        "risk_level": risk_signals.get("risk_level", "medium"),
        "authority_conflicts_count": len(authority_conflicts),
    })
