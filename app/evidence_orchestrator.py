"""
B2: Evidence Orchestrator — batching, dedup, shared caching across subclaims.

Replaces per-subclaim retrieve_evidence() with a single orchestrated pass
that reuses API results, caches aggressively, and deduplicates evidence items.

Uses ThreadPoolExecutor to parallelize independent API calls across subclaims.
"""

from __future__ import annotations
import re
import hashlib
import time
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import List, Dict, Any, Optional, Callable, Tuple
from urllib.parse import urlparse, urlunparse, parse_qs, urlencode
from collections import defaultdict

from app.pipeline_metrics import PipelineMetrics

# ---------------------------------------------------------------------------
# EvidenceItem normalisation
# ---------------------------------------------------------------------------

def _content_hash(text: str) -> str:
    return hashlib.sha256(text.strip().lower().encode("utf-8")).hexdigest()[:24]


def _canonical_url(url: str) -> str:
    """Strip tracking params for dedup."""
    if not url:
        return ""
    try:
        p = urlparse(url)
        qs = parse_qs(p.query, keep_blank_values=False)
        strip_keys = {"utm_source", "utm_medium", "utm_campaign", "utm_content", "ref", "source"}
        cleaned = {k: v for k, v in qs.items() if k not in strip_keys}
        return urlunparse(p._replace(query=urlencode(cleaned, doseq=True), fragment=""))
    except Exception:
        return url


def _stable_evidence_id(source_type: str, url: str, snippet: str) -> str:
    raw = f"{source_type}:{_canonical_url(url)}:{snippet[:200]}"
    return hashlib.sha1(raw.encode("utf-8")).hexdigest()[:16]


# ---------------------------------------------------------------------------
# Subclaim classification for retrieval planning
# ---------------------------------------------------------------------------

_MACRO_KEYWORDS = re.compile(
    r"\b(gdp|cpi|inflation|unemployment|fed\s*funds?|interest\s*rate|"
    r"treasury|pce|retail\s*sales|housing\s*starts|consumer\s*confidence|"
    r"industrial\s*production)\b", re.IGNORECASE
)
_MARKET_KEYWORDS = re.compile(
    r"\b(stock\s*price|share\s*price|52.?week|market\s*cap|"
    r"p/?e\s*ratio|trading\s*at|shares?\s*outstanding)\b", re.IGNORECASE
)
_GUIDANCE_KEYWORDS = re.compile(
    r"\b(expects?|guidance|forecast|outlook|project|target|"
    r"forward.looking|plan(s|ning)?)\b", re.IGNORECASE
)
_HIGH_STAKES = re.compile(
    r"\$\s*[\d,.]+\s*(billion|bn|B\b)|merger|acquisition|covenant|"
    r"material\s*weakness|restatement", re.IGNORECASE
)


def classify_subclaim(text: str) -> str:
    """Classify a subclaim to determine retrieval tier priorities."""
    if _MACRO_KEYWORDS.search(text):
        return "macro"
    if _MARKET_KEYWORDS.search(text):
        return "market"
    if _GUIDANCE_KEYWORDS.search(text):
        return "guidance"
    return "filed_metric"


def is_high_stakes(text: str) -> bool:
    return bool(_HIGH_STAKES.search(text))


# ---------------------------------------------------------------------------
# EvidenceOrchestrator
# ---------------------------------------------------------------------------

class EvidenceOrchestrator:
    """Coordinate evidence retrieval across subclaims with batching and dedup.

    Constructor args are the existing retrieval functions so we don't
    break the current module structure.
    """

    def __init__(
        self,
        ttl_cache,
        metrics: PipelineMetrics,
        *,
        lookup_xbrl: Callable,
        search_edgar: Callable,
        search_earnings: Callable,
        search_news: Callable,
        search_perplexity: Callable,
        lookup_fred: Callable,
        lookup_market: Callable,
    ):
        self._cache = ttl_cache
        self._m = metrics
        self._lookup_xbrl = lookup_xbrl
        self._search_edgar = search_edgar
        self._search_earnings = search_earnings
        self._search_news = search_news
        self._search_perplexity = search_perplexity
        self._lookup_fred = lookup_fred
        self._lookup_market = lookup_market

        # Track Perplexity queries to avoid duplicates
        self._perplexity_results: Dict[str, Dict] = {}

    # --- internal helpers ---

    def _cached_perplexity(self, query: str, focus: str, cache_ttl: int = 600) -> Dict:
        """Dedupe + cache Perplexity calls."""
        cache_key = f"perplexity:{hashlib.sha256((query + '|' + focus).encode()).hexdigest()[:32]}"

        # In-run dedup
        if cache_key in self._perplexity_results:
            self._m.inc_cache_hit()
            return self._perplexity_results[cache_key]

        # TTL cache
        cached = self._cache.get(cache_key)
        if cached is not None:
            self._m.inc_cache_hit()
            self._perplexity_results[cache_key] = cached
            return cached

        self._m.inc_cache_miss()
        self._m.inc_perplexity()
        result = self._search_perplexity(query, focus)
        if result.get("text"):
            self._cache.set(cache_key, result, ttl=cache_ttl)
        self._perplexity_results[cache_key] = result
        return result

    def _cached_edgar(self, query: str, company: str, filing_type: str = "") -> List[Dict]:
        cache_key = f"edgar_orch:{company}:{query}:{filing_type}"
        cached = self._cache.get(cache_key)
        if cached is not None:
            self._m.inc_cache_hit()
            return cached
        self._m.inc_cache_miss()
        self._m.inc_edgar()
        result = self._search_edgar(query, company=company, filing_type=filing_type)
        if result:
            self._cache.set(cache_key, result, ttl=900)
        return result

    def _cached_fred(self, claim_text: str) -> Optional[Dict]:
        cache_key = f"fred_orch:{hashlib.sha256(claim_text.encode()).hexdigest()[:24]}"
        cached = self._cache.get(cache_key)
        if cached is not None:
            self._m.inc_cache_hit()
            return cached
        self._m.inc_cache_miss()
        self._m.inc_fred()
        result = self._lookup_fred(claim_text)
        if result:
            self._cache.set(cache_key, result, ttl=86400)
        return result

    def _cached_market(self, ticker: str, claim_text: str) -> Optional[Dict]:
        cache_key = f"yahoo_orch:{ticker}"
        cached = self._cache.get(cache_key)
        if cached is not None:
            self._m.inc_cache_hit()
            return cached
        self._m.inc_cache_miss()
        self._m.inc_yahoo()
        result = self._lookup_market(ticker, claim_text)
        if result:
            self._cache.set(cache_key, result, ttl=900)
        return result

    # --- main entry ---

    def gather_evidence(
        self,
        ticker: str,
        subclaims: List[Dict],
        claim_context: str = "",
        *,
        on_evidence=None,
    ) -> Dict[str, Any]:
        """Gather evidence for all subclaims with shared caching and dedup.

        Uses ThreadPoolExecutor to parallelize independent API calls.
        """
        per_subclaim: Dict[str, List[Dict]] = defaultdict(list)
        seen_hashes: set = set()
        all_evidence: List[Dict] = []
        eid_counter = [0]
        _lock = threading.Lock()

        def _next_eid():
            with _lock:
                eid_counter[0] += 1
                return f"ev-{eid_counter[0]}"

        def _add(sc_id: str, ev: Dict):
            ch = ev.get("_content_hash", _content_hash(ev.get("snippet", "")))
            with _lock:
                if ch in seen_hashes:
                    return
                seen_hashes.add(ch)
                ev["subclaim_id"] = sc_id
                per_subclaim[sc_id].append(ev)
                all_evidence.append(ev)
            if on_evidence:
                on_evidence(sc_id, ev)

        # --- XBRL: one fetch per ticker (shared across subclaims) ---
        if ticker:
            for sc in subclaims:
                sc_class = classify_subclaim(sc["text"])
                if sc_class in ("filed_metric", "guidance"):
                    self._m.inc_sec()
                    xbrl_result = self._lookup_xbrl(ticker, sc["text"])
                    if xbrl_result and xbrl_result.get("match") != "unverifiable":
                        ev = self._xbrl_to_evidence(_next_eid(), xbrl_result, ticker)
                        _add(sc["id"], ev)

        # --- Per-subclaim retrieval (parallelized across sources) ---
        def _retrieve_for_subclaim(sc: Dict):
            """Retrieve all evidence for a single subclaim — runs in thread."""
            sc_text = sc["text"]
            sc_id = sc["id"]
            sc_class = classify_subclaim(sc_text)
            sc_stakes = is_high_stakes(sc_text)
            local_results: List[Tuple[str, Dict]] = []

            def _fetch_edgar():
                if sc_class in ("filed_metric", "guidance") and ticker:
                    for r in self._cached_edgar(sc_text, company=ticker):
                        local_results.append((sc_id, {
                            "id": _next_eid(),
                            "title": f"{r.get('filing_type', 'SEC Filing')} — {r.get('company', 'Unknown')}",
                            "snippet": r.get("snippet", "")[:400],
                            "source": r.get("url", "SEC EDGAR"),
                            "tier": "sec_filing",
                            "filing_type": r.get("filing_type", ""),
                            "accession_number": r.get("accession_number", ""),
                            "filing_date": r.get("filing_date", ""),
                            "company_ticker": r.get("company", ""),
                            "_content_hash": _content_hash(r.get("snippet", "")),
                        }))

            def _fetch_earnings():
                if sc_class != "macro":
                    query = f"earnings call transcript {ticker} {sc_text}. Include exact quotes from management with speaker name, quarter, and year."
                    focus = "earnings call transcripts, quarterly earnings, management commentary, guidance, analyst Q&A"
                    earnings = self._cached_perplexity(query, focus)
                    if earnings.get("text"):
                        local_results.append((sc_id, {
                            "id": _next_eid(),
                            "title": "Earnings Call Transcript",
                            "snippet": earnings["text"][:500],
                            "source": "Perplexity Sonar (Earnings)",
                            "tier": "earnings_transcript",
                            "citations_urls": earnings.get("citations", []),
                            "_content_hash": _content_hash(earnings["text"]),
                        }))

            def _fetch_news():
                if sc_class != "macro":
                    query = f"financial news press release {ticker} {sc_text}"
                    focus = "financial news, press releases, deal announcements, market data, analyst reports"
                    news = self._cached_perplexity(query, focus)
                    if news.get("text"):
                        local_results.append((sc_id, {
                            "id": _next_eid(),
                            "title": "Financial News / Press Release",
                            "snippet": news["text"][:500],
                            "source": "Perplexity Sonar (Financial News)",
                            "tier": "press_release",
                            "citations_urls": news.get("citations", []),
                            "_content_hash": _content_hash(news["text"]),
                        }))

            def _fetch_fred():
                if sc_class == "macro":
                    fred_result = self._cached_fred(sc_text)
                    if fred_result:
                        snippet_parts = [
                            f"Series: {fred_result.get('series_id', '')}",
                            f"Latest: {fred_result['latest_value']} ({fred_result['latest_date']})",
                        ]
                        if fred_result.get("yoy_change_pct") is not None:
                            snippet_parts.append(f"YoY Change: {fred_result['yoy_change_pct']}%")
                        local_results.append((sc_id, {
                            "id": _next_eid(),
                            "title": f"FRED Macro Data — {fred_result.get('series_id', '')}",
                            "snippet": " | ".join(snippet_parts),
                            "source": fred_result.get("data_source", "FRED"),
                            "tier": "market_data",
                            "filing_date": fred_result.get("latest_date", ""),
                            "fred_data": fred_result,
                            "_content_hash": _content_hash(" ".join(snippet_parts)),
                        }))

            def _fetch_market():
                if ticker and sc_class in ("market", "filed_metric"):
                    market_result = self._cached_market(ticker, sc_text)
                    if market_result and market_result.get("current_price"):
                        mkt_parts = [
                            f"Price: ${market_result['current_price']:.2f}",
                            f"Exchange: {market_result.get('exchange', '')}",
                        ]
                        if market_result.get("yoy_return_pct") is not None:
                            mkt_parts.append(f"1Y Return: {market_result['yoy_return_pct']}%")
                        if market_result.get("high_52w") and market_result.get("low_52w"):
                            mkt_parts.append(f"52W Range: ${market_result['low_52w']} - ${market_result['high_52w']}")
                        local_results.append((sc_id, {
                            "id": _next_eid(),
                            "title": f"Market Data — {ticker}",
                            "snippet": " | ".join(mkt_parts),
                            "source": market_result.get("data_source", "Yahoo Finance"),
                            "tier": "market_data",
                            "company_ticker": ticker,
                            "market_data": market_result,
                            "_content_hash": _content_hash(" ".join(mkt_parts)),
                        }))

            # Run all source fetches in parallel within this subclaim
            source_fns = [_fetch_edgar, _fetch_earnings, _fetch_news, _fetch_fred, _fetch_market]
            with ThreadPoolExecutor(max_workers=5) as inner_pool:
                list(inner_pool.map(lambda fn: fn(), source_fns))

            # Add results (thread-safe via _add)
            for sid, ev in local_results:
                _add(sid, ev)

            # Counter-evidence (runs after supporting evidence so we can count)
            with _lock:
                supporting_count = len(per_subclaim.get(sc_id, []))
            run_counter = sc_stakes or supporting_count >= 2
            if run_counter:
                query = (
                    f"Find evidence AGAINST or contradicting: {sc_text}. "
                    "Are there any discrepancies, restatements, corrections, or conflicting data?"
                )
                focus = "counter-evidence, financial restatements, corrections, contradictions"
                counter = self._cached_perplexity(query, focus)
                if counter.get("text"):
                    _add(sc_id, {
                        "id": _next_eid(),
                        "title": "Counter-Evidence Search",
                        "snippet": counter["text"][:500],
                        "source": "Perplexity Sonar (counter-search)",
                        "tier": "counter",
                        "citations_urls": counter.get("citations", []),
                        "_content_hash": _content_hash(counter["text"]),
                    })

        # Run subclaim retrieval in parallel (capped at 4 threads)
        with ThreadPoolExecutor(max_workers=min(4, len(subclaims) or 1)) as pool:
            list(pool.map(_retrieve_for_subclaim, subclaims))

        self._m.evidence_pre_dedupe = eid_counter[0]
        self._m.evidence_post_dedupe = len(all_evidence)

        # Sort deterministically: tier priority, then recency
        _TIER_ORDER = {
            "sec_filing": 0, "earnings_transcript": 1, "press_release": 2,
            "market_data": 3, "counter": 4,
        }
        all_evidence.sort(key=lambda e: (
            _TIER_ORDER.get(e.get("tier", ""), 5),
            -(len(e.get("filing_date", "") or "")),
        ))

        return {
            "per_subclaim": dict(per_subclaim),
            "all_evidence": all_evidence,
            "stats": {
                "total_evidence": len(all_evidence),
                "deduped_count": eid_counter[0] - len(all_evidence),
                "subclaims_processed": len(subclaims),
            },
        }

    @staticmethod
    def _xbrl_to_evidence(eid: str, xbrl_result: Dict, ticker: str) -> Dict:
        snippet_parts = []
        if xbrl_result.get("claimed_value"):
            snippet_parts.append(f"Claimed: {xbrl_result['claimed_value']}")
        if xbrl_result.get("actual_value"):
            snippet_parts.append(f"Actual (SEC filing): {xbrl_result['actual_value']}")
        if xbrl_result.get("computation"):
            snippet_parts.append(f"Computation: {xbrl_result['computation']}")
        if xbrl_result.get("discrepancy"):
            snippet_parts.append(f"Discrepancy: {xbrl_result['discrepancy']}")
        return {
            "id": eid,
            "title": f"XBRL Ground Truth — {xbrl_result.get('entity_name', ticker)}",
            "snippet": " | ".join(snippet_parts),
            "source": f"SEC XBRL ({xbrl_result.get('form', 'Filing')} ending {xbrl_result.get('period', 'N/A')})",
            "tier": "sec_filing",
            "filing_type": xbrl_result.get("form", ""),
            "filing_date": xbrl_result.get("period", ""),
            "company_ticker": ticker,
            "verified_against": f"{xbrl_result.get('form', '')} ending {xbrl_result.get('period', '')}",
            "xbrl_match": xbrl_result.get("match"),
            "xbrl_data": xbrl_result,
            "_content_hash": _content_hash(" ".join(snippet_parts)),
        }
