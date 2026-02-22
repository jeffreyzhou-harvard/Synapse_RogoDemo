"""
Paragraph scoring selector for claim extraction pipeline.

Scores paragraphs by claim-density heuristics and selects the top passages
so the LLM only processes relevant text, skipping boilerplate.
"""

from __future__ import annotations
import re
from typing import List, TypedDict
from app.text_chunking import Chunk


class SelectedPassage(TypedDict):
    chunk_id: str
    passage_text: str
    passage_start_char: int  # within chunk
    passage_end_char: int    # within chunk


# ---------------------------------------------------------------------------
# Scoring patterns (compiled once)
# ---------------------------------------------------------------------------

_CURRENCY_NUMBER = re.compile(
    r"\$[\d,.]+|[\d,.]+\s*[%]|[\d,.]+\s*(million|billion|trillion|mn|mm|bn|bps|basis points)",
    re.IGNORECASE,
)
_FINANCE_KEYWORDS = re.compile(
    r"\b(revenue|ebitda|eps|arr|nrr|guidance|margin|multiple|acquisition|merger|"
    r"covenant|leverage|free cash flow|capex|market cap|valuation|gross profit|"
    r"operating income|net income|diluted|cash flow|burn rate|ltv|cac|tam|sam|som|"
    r"retention|churn|ipo|buyback|dividend|debt|equity|enterprise value)\b",
    re.IGNORECASE,
)
_DATE_PERIOD = re.compile(
    r"\b(Q[1-4]|FY\s*20\d{2}|CY\s*20\d{2}|year ended|as of|quarter ended|"
    r"fiscal year|first half|second half|H[12]\s*20\d{2}|20[12]\d)\b",
    re.IGNORECASE,
)
_COMPARATIVE = re.compile(
    r"\b(YoY|QoQ|year-over-year|quarter-over-quarter|increased|decreased|"
    r"grew|declined|up\s+\d|down\s+\d|compared to|versus|vs\.?)\b",
    re.IGNORECASE,
)
_BOILERPLATE = re.compile(
    r"\b(forward-looking statements?|safe harbor|disclaimer|copyright|"
    r"all rights reserved|this (report|document|presentation) (contains|includes)|"
    r"not an offer|risk factors may|past performance)\b",
    re.IGNORECASE,
)
_NUMBER_HEAVY = re.compile(r"[\d]+[,.]?[\d]*")


def score_paragraph(p: str) -> float:
    """Score a single paragraph for claim density. Higher = more likely to contain claims."""
    score = 0.0

    if len(_CURRENCY_NUMBER.findall(p)) > 0:
        score += 3
    if _FINANCE_KEYWORDS.search(p):
        score += 2
    if _DATE_PERIOD.search(p):
        score += 2
    if _COMPARATIVE.search(p):
        score += 1
    if _BOILERPLATE.search(p):
        score -= 3

    stripped = p.strip()
    alnum = sum(1 for c in stripped if c.isalnum())
    if len(stripped) < 80 or (len(stripped) > 0 and alnum / len(stripped) < 0.4):
        score -= 2

    # Table-like rows (many numbers)
    if len(_NUMBER_HEAVY.findall(p)) >= 3:
        score += 2

    return score


def select_passages(
    chunks: List[Chunk],
    max_passages: int = 30,
) -> List[SelectedPassage]:
    """Score all paragraphs across chunks; return top passages with context neighbors."""

    # Gather all paragraphs with their chunk and offset info
    all_paras: List[dict] = []
    for chunk in chunks:
        paras = re.split(r"\n\n+", chunk["text"])
        pos = 0
        for i, p in enumerate(paras):
            idx = chunk["text"].find(p, pos)
            if idx < 0:
                idx = pos
            all_paras.append({
                "chunk_id": chunk["chunk_id"],
                "para_idx": i,
                "text": p,
                "start": idx,
                "end": idx + len(p),
                "score": score_paragraph(p),
                "total_paras_in_chunk": len(paras),
            })
            pos = idx + len(p)

    if not all_paras:
        return []

    # Sort by score descending, take top passages
    ranked = sorted(all_paras, key=lambda x: x["score"], reverse=True)
    selected_keys = set()
    selected_indices = []

    for para in ranked:
        if len(selected_indices) >= max_passages:
            break
        key = (para["chunk_id"], para["para_idx"])
        if key not in selected_keys and para["score"] > 0:
            selected_keys.add(key)
            selected_indices.append(para)
            # Add neighbors for context
            for offset in (-1, 1):
                neighbor_idx = para["para_idx"] + offset
                neighbor_key = (para["chunk_id"], neighbor_idx)
                if (
                    0 <= neighbor_idx < para["total_paras_in_chunk"]
                    and neighbor_key not in selected_keys
                    and len(selected_indices) + len(selected_keys) < max_passages * 1.5
                ):
                    # Find the neighbor in all_paras
                    for ap in all_paras:
                        if ap["chunk_id"] == para["chunk_id"] and ap["para_idx"] == neighbor_idx:
                            selected_keys.add(neighbor_key)
                            selected_indices.append(ap)
                            break

    # Build SelectedPassage objects, sorted by document order
    selected_indices.sort(key=lambda x: (x["chunk_id"], x["start"]))

    return [
        SelectedPassage(
            chunk_id=p["chunk_id"],
            passage_text=p["text"],
            passage_start_char=p["start"],
            passage_end_char=p["end"],
        )
        for p in selected_indices
    ]
