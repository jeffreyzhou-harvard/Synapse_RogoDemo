"""
B1: Merged Ticker Detection + Entity Resolution in a single LLM call.

Provides resolve_entity_and_ticker() which replaces the separate
ticker-detection and entity-resolution stages, saving one LLM round-trip.
"""

from __future__ import annotations
import re
import hashlib
import json
from typing import Dict, Any, Optional, List

ENTITY_PROMPT_VERSION = "v1_merged"

# Regex patterns for explicit ticker mentions
_TICKER_EXCHANGE = re.compile(
    r"\((?:NYSE|NASDAQ|AMEX|TSX|LSE)\s*:\s*([A-Z]{1,6})\)",
    re.IGNORECASE,
)
_TICKER_DOLLAR = re.compile(r"\$([A-Z]{1,6})\b")
_TICKER_COLON = re.compile(
    r"\b(?:NYSE|NASDAQ|AMEX)\s*:\s*([A-Z]{1,6})\b",
    re.IGNORECASE,
)


def detect_ticker_hint(text: str) -> Optional[str]:
    """Deterministic regex pre-pass to find explicitly mentioned tickers."""
    for pattern in (_TICKER_EXCHANGE, _TICKER_COLON, _TICKER_DOLLAR):
        m = pattern.search(text)
        if m:
            ticker = m.group(1).upper()
            if len(ticker) <= 5 and ticker.isalpha():
                return ticker
    return None


def _build_entity_prompt(claim_text: str, ticker_hint: Optional[str]) -> str:
    hint_section = ""
    if ticker_hint:
        hint_section = f"\nDETECTED TICKER HINT (from regex): {ticker_hint}\nUse this as a strong signal for the primary company."

    return f"""Analyze this financial claim and resolve all entity and ticker references in a single pass.
{hint_section}
CLAIM: "{claim_text}"

Tasks:
1. TICKER DETECTION: Identify the primary company's stock ticker. If the claim doesn't reference a specific public company, set ticker_candidates to an empty list.
2. ENTITY RESOLUTION: Map every entity reference (companies, subsidiaries, products, segments, pronouns like "we"/"the Company") to canonical names.

Return ONLY this exact JSON structure (no prose, no markdown fences):
{{
  "primary_company_name": "Apple Inc." or null,
  "ticker_candidates": [
    {{"ticker": "AAPL", "confidence": 0.95}}
  ],
  "canonical_entities": [
    {{"name": "Apple Inc.", "type": "company", "ticker": "AAPL", "aliases": ["Apple", "the Company", "we"]}}
  ],
  "pronoun_map": {{
    "we": "Apple Inc.",
    "the Company": "Apple Inc."
  }},
  "segments": [
    {{"name": "iPhone", "parent": "Apple Inc.", "aliases": ["Products segment"]}}
  ],
  "ambiguities": []
}}

Rules:
- ticker_candidates: list of 0-3 candidates with confidence 0.0-1.0
- canonical_entities: every distinct entity mentioned (company, subsidiary, segment, product, person)
- pronoun_map: map pronouns/references to their canonical entity name
- segments: business segments, product lines, subsidiaries
- ambiguities: list of strings for anything that cannot be resolved

Return ONLY valid JSON."""


SYSTEM_ENTITY_INTEL = (
    "You are a financial entity resolution and ticker detection engine. "
    "Identify companies, resolve ambiguous references, and detect stock tickers. "
    "Return only valid JSON."
)


def _entity_cache_key(claim_text: str) -> str:
    h = hashlib.sha256(claim_text.encode("utf-8")).hexdigest()
    return f"entity_intel:{h}:{ENTITY_PROMPT_VERSION}"


def resolve_entity_and_ticker(
    claim_text: str,
    *,
    call_llm,
    parse_json,
    cache=None,
) -> Dict[str, Any]:
    """Resolve entities and detect tickers in one LLM call.

    Parameters
    ----------
    claim_text : str
    call_llm : callable(prompt, system, max_tokens) -> str
    parse_json : callable(raw_str) -> Any
    cache : _TTLCache or None — if provided, results are cached for 30 min.
    """
    # Check cache
    ck = _entity_cache_key(claim_text)
    if cache is not None:
        cached = cache.get(ck)
        if cached is not None:
            cached["_cache_hit"] = True
            return cached

    # Deterministic pre-pass
    ticker_hint = detect_ticker_hint(claim_text)

    # Single LLM call
    prompt = _build_entity_prompt(claim_text, ticker_hint)
    raw = call_llm(prompt, SYSTEM_ENTITY_INTEL, 2000)
    parsed = parse_json(raw)

    if not isinstance(parsed, dict):
        # Fallback: minimal result
        result: Dict[str, Any] = {
            "primary_company_name": None,
            "ticker_candidates": [],
            "canonical_entities": [],
            "pronoun_map": {},
            "segments": [],
            "ambiguities": ["LLM returned non-JSON; falling back to regex hint"],
        }
        if ticker_hint:
            result["ticker_candidates"] = [{"ticker": ticker_hint, "confidence": 0.7}]
            result["primary_company_name"] = ticker_hint
    else:
        result = parsed

    # Inject regex hint if LLM missed it
    if ticker_hint:
        candidates = result.get("ticker_candidates", [])
        tickers_found = {c.get("ticker", "").upper() for c in candidates}
        if ticker_hint not in tickers_found:
            candidates.insert(0, {"ticker": ticker_hint, "confidence": 0.9})
            result["ticker_candidates"] = candidates

    result["_cache_hit"] = False
    result["_ticker_hint"] = ticker_hint

    # Cache for 30 minutes
    if cache is not None:
        cache.set(ck, result, ttl=1800)

    return result


def extract_best_ticker(result: Dict[str, Any]) -> str:
    """Return the best ticker from entity intel result, or empty string."""
    candidates = result.get("ticker_candidates", [])
    if not candidates:
        return ""
    best = max(candidates, key=lambda c: c.get("confidence", 0))
    ticker = best.get("ticker", "").upper().strip()
    if len(ticker) > 6 or " " in ticker:
        return ""
    return ticker


def to_legacy_entity_resolution(result: Dict[str, Any]) -> Dict[str, Any]:
    """Convert merged result to the old entity_resolution format for backward compat SSE."""
    entities = []
    for ent in result.get("canonical_entities", []):
        entities.append({
            "canonical_name": ent.get("name", ""),
            "ticker": ent.get("ticker", ""),
            "type": ent.get("type", "company"),
            "aliases": ent.get("aliases", []),
        })
    resolutions = []
    for original, resolved in result.get("pronoun_map", {}).items():
        resolutions.append({
            "original_text": original,
            "resolved_to": resolved,
            "context": "claim text",
        })
    return {
        "entities": entities,
        "resolutions": resolutions,
        "ambiguities": result.get("ambiguities", []),
    }
