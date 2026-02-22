"""
Claim deduplication using normalized fingerprints.

Exact dedup via SHA-1 of normalized text, plus optional near-duplicate
detection within (company_ticker, type) buckets.
"""

from __future__ import annotations
import re
import hashlib
from typing import List, Dict, Any
from collections import defaultdict


def normalize_for_fingerprint(s: str) -> str:
    """Lowercase, strip punctuation, collapse whitespace, normalize numbers."""
    s = s.lower()
    s = re.sub(r"[,](\d{3})", r"\1", s)  # 1,000 -> 1000
    s = re.sub(r"[^\w\s\d%$]", " ", s)   # strip periods and other punctuation
    s = re.sub(r"\s+", " ", s)
    return s.strip()


def fingerprint(s: str) -> str:
    """SHA-1 hex of normalized text."""
    norm = normalize_for_fingerprint(s)
    return hashlib.sha1(norm.encode("utf-8")).hexdigest()


def _jaccard_tokens(a: str, b: str) -> float:
    """Jaccard similarity on token sets."""
    sa = set(normalize_for_fingerprint(a).split())
    sb = set(normalize_for_fingerprint(b).split())
    if not sa or not sb:
        return 0.0
    return len(sa & sb) / len(sa | sb)


def _claim_quality(c: Dict[str, Any]) -> float:
    """Heuristic quality score for picking the best among duplicates."""
    score = 0.0
    original = c.get("original", "")
    # Prefer claims with numbers/dates
    if re.search(r"\d", original):
        score += 2
    if re.search(r"\$|%|billion|million|Q[1-4]|FY", original, re.IGNORECASE):
        score += 1
    # Prefer longer (more specific), capped to avoid run-on text
    score += min(len(original) / 100, 2.0)
    # Prefer earlier position
    loc = c.get("location", {})
    if isinstance(loc, dict):
        global_pos = c.get("_global_start", 999999)
        score -= global_pos / 100000
    return score


def dedupe_claims(
    claims: List[Dict[str, Any]],
    near_dup_threshold: float = 0.85,
) -> List[Dict[str, Any]]:
    """Remove exact and near-duplicate claims. Returns deduplicated list."""
    if not claims:
        return claims

    # --- Exact dedup ---
    seen_fps: Dict[str, Dict[str, Any]] = {}
    for c in claims:
        fp = fingerprint(c.get("normalized", c.get("original", "")))
        if fp in seen_fps:
            if _claim_quality(c) > _claim_quality(seen_fps[fp]):
                seen_fps[fp] = c
        else:
            seen_fps[fp] = c

    exact_deduped = list(seen_fps.values())

    # --- Near-duplicate within (company_ticker, type) buckets ---
    buckets: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    for c in exact_deduped:
        key = f"{(c.get('company_ticker') or 'none').lower()}:{c.get('type', 'none')}"
        buckets[key].append(c)

    final: List[Dict[str, Any]] = []
    for bucket_claims in buckets.values():
        keep = []
        for c in bucket_claims:
            is_near_dup = False
            c_norm = c.get("normalized", c.get("original", ""))
            for kept in keep:
                k_norm = kept.get("normalized", kept.get("original", ""))
                if _jaccard_tokens(c_norm, k_norm) >= near_dup_threshold:
                    if _claim_quality(c) > _claim_quality(kept):
                        keep.remove(kept)
                        keep.append(c)
                    is_near_dup = True
                    break
            if not is_near_dup:
                keep.append(c)
        final.extend(keep)

    # Sort by original document order
    final.sort(key=lambda c: c.get("_global_start", 999999))

    return final
