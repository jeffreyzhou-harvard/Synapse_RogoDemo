"""
B3: Batched evidence quality evaluation — one LLM call per subclaim.

Replaces the per-evidence-item evaluation with:
1. Rule-based baseline scoring (tier weight + recency + numeric match)
2. Single LLM call per subclaim batch to adjust scores within ±20
3. Cached results
"""

from __future__ import annotations
import re
import hashlib
import time
from typing import List, Dict, Any, Optional, Callable

from app.pipeline_metrics import PipelineMetrics

QUALITY_PROMPT_VERSION = "v1_batched"

# Tier authority weights (0-100 scale baseline)
_TIER_BASELINES: Dict[str, int] = {
    "sec_filing": 85,
    "earnings_transcript": 70,
    "press_release": 50,
    "analyst_report": 55,
    "market_data": 65,
    "academic": 60,
    "institutional": 55,
    "journalism": 35,
    "counter": 40,
}

_NUMBER_PATTERN = re.compile(r"[\d,.]+[%$]?|\$[\d,.]+")


def compute_baseline_score(evidence: Dict, claim_text: str) -> int:
    """Rule-based quality baseline before LLM adjustment."""
    tier = evidence.get("tier", "")
    score = _TIER_BASELINES.get(tier, 40)

    # Recency bonus
    filing_date = evidence.get("filing_date", "")
    if filing_date:
        try:
            year = int(filing_date[:4])
            current_year = int(time.strftime("%Y"))
            age = current_year - year
            if age <= 1:
                score += 10
            elif age <= 2:
                score += 5
            elif age >= 5:
                score -= 10
        except (ValueError, IndexError):
            pass

    # Numeric match bonus: if evidence snippet contains same numbers as claim
    claim_numbers = set(_NUMBER_PATTERN.findall(claim_text))
    snippet = evidence.get("snippet", "")
    snippet_numbers = set(_NUMBER_PATTERN.findall(snippet))
    shared = claim_numbers & snippet_numbers
    if shared:
        score += min(len(shared) * 3, 10)

    # XBRL ground truth gets highest baseline
    if evidence.get("xbrl_data"):
        score = max(score, 90)

    return max(0, min(100, score))


def _quality_cache_key(subclaim_text: str, evidence_ids: List[str]) -> str:
    raw = subclaim_text + "|" + ",".join(sorted(evidence_ids))
    h = hashlib.sha256(raw.encode("utf-8")).hexdigest()[:32]
    return f"quality_eval:{h}:{QUALITY_PROMPT_VERSION}"


def evaluate_evidence_batch(
    subclaim_text: str,
    evidence_list: List[Dict],
    *,
    call_llm: Callable,
    parse_json: Callable,
    cache=None,
    metrics: Optional[PipelineMetrics] = None,
    max_evidence_per_call: int = 12,
) -> List[Dict]:
    """Score all evidence for a single subclaim in one LLM call.

    Returns the same evidence_list with quality_score, supports_claim,
    study_type, and assessment fields added/updated.
    """
    if not evidence_list:
        return evidence_list

    # Compute baselines first (deterministic, no LLM)
    baselines = {}
    for ev in evidence_list:
        baselines[ev["id"]] = compute_baseline_score(ev, subclaim_text)

    # Check cache
    ev_ids = [ev["id"] for ev in evidence_list]
    ck = _quality_cache_key(subclaim_text, ev_ids)
    if cache is not None:
        cached = cache.get(ck)
        if cached is not None:
            if metrics:
                metrics.inc_cache_hit()
            _apply_scores(evidence_list, cached, baselines)
            return evidence_list

    if metrics:
        metrics.inc_cache_miss()

    # Build evidence summary for LLM (cap at max_evidence_per_call)
    batch = evidence_list[:max_evidence_per_call]
    evidence_lines = []
    for ev in batch:
        base = baselines.get(ev["id"], 50)
        evidence_lines.append(
            f'[{ev["id"]}] tier={ev.get("tier","?")} | '
            f'baseline_score={base} | '
            f'source={ev.get("source","?")} | '
            f'snippet: {ev.get("snippet","")[:200]}'
        )

    prompt = f"""Evaluate each evidence source for verifying this claim. A rule-based baseline score is provided for each — adjust it within ±20 unless you have strong reasons to go further.

CLAIM: "{subclaim_text}"

EVIDENCE:
{chr(10).join(evidence_lines)}

For EACH evidence ID return:
- quality_score (0-100): adjusted from baseline
- stance: "support" | "oppose" | "neutral"
- rationale_short (1 sentence max)

Return ONLY a JSON array:
[
  {{
    "id": "ev-1",
    "quality_score": 85,
    "stance": "support",
    "rationale_short": "SEC filing directly confirms the claimed revenue figure"
  }}
]

Return ONLY valid JSON, no markdown."""

    if metrics:
        metrics.inc_llm()

    raw = call_llm(prompt, "You are an evidence quality evaluator. Be rigorous and precise.", 2000)
    parsed = parse_json(raw)

    scores: Dict[str, Dict] = {}
    if isinstance(parsed, list):
        for item in parsed:
            if isinstance(item, dict) and "id" in item:
                scores[item["id"]] = item

    # Cache the LLM scores
    if cache is not None and scores:
        cache.set(ck, scores, ttl=1800)

    _apply_scores(evidence_list, scores, baselines)
    return evidence_list


def _apply_scores(
    evidence_list: List[Dict],
    llm_scores: Dict[str, Dict],
    baselines: Dict[str, int],
) -> None:
    """Merge LLM scores onto evidence items, falling back to baselines."""
    for ev in evidence_list:
        scored = llm_scores.get(ev["id"])
        base = baselines.get(ev["id"], 50)
        if scored:
            ev["quality_score"] = scored.get("quality_score", base)
            stance = scored.get("stance", "neutral")
            ev["supports_claim"] = (
                True if stance == "support"
                else False if stance == "oppose"
                else None
            )
            ev["study_type"] = ev.get("study_type", scored.get("study_type"))
            ev["assessment"] = scored.get("rationale_short", "")
        else:
            ev.setdefault("quality_score", base)
            ev.setdefault("supports_claim", None)
            ev.setdefault("assessment", "")
