"""
Neurosymbolic Reasoning Engine for Synapse.

Adds a formal symbolic layer on top of the neural (LLM) verification pipeline:
1. Parse claims into logical predicates
2. Apply deterministic inference rules
3. Build proof trees with formal derivation chains
4. Propagate confidence via Bayesian-style computation

The symbolic layer does NOT replace the LLM — it augments it with:
- Formal explainability (proof trees)
- Deterministic override rules (numeric mismatches, authority hierarchy)
- Mathematically grounded confidence scores
"""

from __future__ import annotations

import re
import math
import hashlib
from dataclasses import dataclass, field, asdict
from enum import Enum
from typing import List, Dict, Optional, Any, Tuple


# ═══════════════════════════════════════════════════════════════════════
# 1. Predicate System — Formal Claim Representation
# ═══════════════════════════════════════════════════════════════════════

class PredicateType(str, Enum):
    METRIC = "metric"           # METRIC(entity, metric_name, value, period)
    GROWTH = "growth"           # GROWTH(entity, metric, pct, period)
    COMPARISON = "comparison"   # COMPARISON(entity, metric, op, value)
    TEMPORAL = "temporal"       # TEMPORAL(period, tense)
    SOURCE = "source"           # SOURCE(claim, source_type, attribution)
    RELATION = "relation"       # RELATION(entity_a, relation, entity_b)
    EXISTENCE = "existence"     # EXISTENCE(entity, property)
    CAUSAL = "causal"           # CAUSAL(cause, effect)


@dataclass
class Predicate:
    id: str
    type: PredicateType
    subclaim_id: str
    args: Dict[str, Any]
    # Populated after evidence matching
    grounded: bool = False
    grounding_evidence: List[str] = field(default_factory=list)
    grounding_value: Optional[Any] = None  # actual value from evidence

    def to_dict(self) -> Dict:
        d = asdict(self)
        d["type"] = self.type.value
        return d

    def formal_repr(self) -> str:
        """Human-readable formal logic representation."""
        args_str = ", ".join(f"{k}={v}" for k, v in self.args.items())
        status = "✓" if self.grounded else "?"
        return f"{self.type.value.upper()}({args_str}) [{status}]"


# ═══════════════════════════════════════════════════════════════════════
# 2. Inference Rules — Deterministic Logic
# ═══════════════════════════════════════════════════════════════════════

class RuleSeverity(str, Enum):
    INFO = "info"
    WARNING = "warning"
    OVERRIDE = "override"


@dataclass
class RuleFiring:
    rule_id: str
    rule_name: str
    description: str
    severity: RuleSeverity
    inputs: List[str]       # predicate IDs or evidence IDs that triggered this
    conclusion: str         # what the rule concluded
    suggested_verdict: Optional[str] = None
    confidence_delta: float = 0.0  # adjustment to confidence (-1 to +1 scale)

    def to_dict(self) -> Dict:
        d = asdict(self)
        d["severity"] = self.severity.value
        return d


# ═══════════════════════════════════════════════════════════════════════
# 3. Proof Tree — Formal Derivation Structure
# ═══════════════════════════════════════════════════════════════════════

class ProofNodeType(str, Enum):
    CLAIM = "claim"
    PREMISE = "premise"
    EVIDENCE = "evidence"
    RULE = "rule"
    INFERENCE = "inference"
    VERDICT = "verdict"


@dataclass
class ProofNode:
    id: str
    type: ProofNodeType
    label: str
    detail: str = ""
    status: str = "pending"  # verified, refuted, partial, pending
    confidence: float = 0.0
    children: List[str] = field(default_factory=list)  # child node IDs
    evidence_ids: List[str] = field(default_factory=list)
    rule_id: Optional[str] = None
    predicate_id: Optional[str] = None

    def to_dict(self) -> Dict:
        d = asdict(self)
        d["type"] = self.type.value
        return d


# ═══════════════════════════════════════════════════════════════════════
# Predicate Extraction — Parse structured data into formal predicates
# ═══════════════════════════════════════════════════════════════════════

# Regex patterns for numeric extraction
_NUM_PATTERN = re.compile(
    r'[\$€£]?\s*(\d[\d,]*\.?\d*)\s*'
    r'(%|percent|pct|pp|basis\s*points?|bps|'
    r'billion|bn|B|million|mn|M|thousand|K|'
    r'trillion|T)?',
    re.IGNORECASE
)

_GROWTH_WORDS = re.compile(
    r'\b(grew|growth|increase[ds]?|rose|up|gain(?:ed)?|jump(?:ed)?|surge[ds]?|climb(?:ed)?)\b',
    re.IGNORECASE
)
_DECLINE_WORDS = re.compile(
    r'\b(fell|decline[ds]?|decrease[ds]?|drop(?:ped)?|down|lost|shrank|contract(?:ed)?)\b',
    re.IGNORECASE
)
_TEMPORAL_PATTERN = re.compile(
    r'\b(Q[1-4]\s*\d{4}|FY\s*\d{4}|20\d{2}|H[12]\s*\d{4}|'
    r'last\s+(?:year|quarter|month)|year.over.year|YoY|QoQ|'
    r'first\s+(?:quarter|half)|second\s+(?:quarter|half)|'
    r'third\s+quarter|fourth\s+quarter)\b',
    re.IGNORECASE
)
_CAUSAL_PATTERN = re.compile(
    r'\b(because|due\s+to|caused\s+by|driven\s+by|result(?:ing|ed)\s+(?:from|in)|'
    r'led\s+to|attributed\s+to|thanks\s+to|owing\s+to)\b',
    re.IGNORECASE
)


def _normalize_number(raw: str, unit: str) -> Optional[float]:
    """Convert a raw number string + unit suffix to a float."""
    try:
        val = float(raw.replace(",", ""))
    except (ValueError, TypeError):
        return None

    if not unit:
        return val

    unit_lower = unit.lower().strip()
    multipliers = {
        "trillion": 1e12, "t": 1e12,
        "billion": 1e9, "bn": 1e9, "b": 1e9,
        "million": 1e9, "mn": 1e6, "m": 1e6,
        "thousand": 1e3, "k": 1e3,
    }
    for key, mult in multipliers.items():
        if unit_lower.startswith(key):
            return val * mult

    return val


def parse_predicates(
    subclaims: List[Dict],
    entity_resolution: Optional[Dict] = None,
    normalization: Optional[Dict] = None,
    numerical_facts: Optional[List[Dict]] = None,
) -> List[Predicate]:
    """Extract formal predicates from decomposed sub-claims and structured data.

    This is a rule-based parser — no LLM calls.
    """
    predicates: List[Predicate] = []
    pid = 0

    # Resolve primary entity
    primary_entity = "Unknown"
    primary_ticker = ""
    if entity_resolution:
        entities = entity_resolution.get("entities", [])
        if entities:
            primary_entity = entities[0].get("canonical_name", "Unknown")
            primary_ticker = entities[0].get("ticker", "")

    for sc in subclaims:
        sc_id = sc.get("id", f"sc-{pid}")
        sc_text = sc.get("text", "")
        sc_type = sc.get("type", "categorical")

        # --- Extract temporal predicates ---
        temporal_matches = _TEMPORAL_PATTERN.findall(sc_text)
        for tm in temporal_matches:
            pid += 1
            predicates.append(Predicate(
                id=f"pred-{pid}",
                type=PredicateType.TEMPORAL,
                subclaim_id=sc_id,
                args={"period": tm, "tense": "past"},  # simplified
            ))

        # --- Extract numeric predicates ---
        numbers = _NUM_PATTERN.findall(sc_text)
        has_growth = bool(_GROWTH_WORDS.search(sc_text))
        has_decline = bool(_DECLINE_WORDS.search(sc_text))

        for raw_num, unit in numbers:
            value = _normalize_number(raw_num, unit)
            if value is None:
                continue

            is_pct = unit and unit.lower() in ("%", "percent", "pct", "pp", "basis points", "bps")
            period = temporal_matches[0] if temporal_matches else "unspecified"

            if is_pct and (has_growth or has_decline):
                pid += 1
                direction = "increase" if has_growth else "decrease"
                predicates.append(Predicate(
                    id=f"pred-{pid}",
                    type=PredicateType.GROWTH,
                    subclaim_id=sc_id,
                    args={
                        "entity": primary_entity,
                        "ticker": primary_ticker,
                        "direction": direction,
                        "value_pct": float(raw_num.replace(",", "")),
                        "period": period,
                    },
                ))
            elif not is_pct:
                pid += 1
                predicates.append(Predicate(
                    id=f"pred-{pid}",
                    type=PredicateType.METRIC,
                    subclaim_id=sc_id,
                    args={
                        "entity": primary_entity,
                        "ticker": primary_ticker,
                        "value": value,
                        "raw": f"{raw_num} {unit}".strip(),
                        "period": period,
                    },
                ))

        # --- Extract causal predicates ---
        if _CAUSAL_PATTERN.search(sc_text):
            pid += 1
            predicates.append(Predicate(
                id=f"pred-{pid}",
                type=PredicateType.CAUSAL,
                subclaim_id=sc_id,
                args={"text": sc_text, "entity": primary_entity},
            ))

        # --- Source/provenance predicates ---
        if sc_type == "provenance":
            pid += 1
            predicates.append(Predicate(
                id=f"pred-{pid}",
                type=PredicateType.SOURCE,
                subclaim_id=sc_id,
                args={"text": sc_text, "entity": primary_entity},
            ))

        # --- Existence predicates (categorical claims) ---
        if sc_type == "categorical" and not numbers:
            pid += 1
            predicates.append(Predicate(
                id=f"pred-{pid}",
                type=PredicateType.EXISTENCE,
                subclaim_id=sc_id,
                args={"text": sc_text, "entity": primary_entity},
            ))

    # --- Enrich from numerical_facts (deterministic extraction) ---
    if numerical_facts:
        for nf in numerical_facts:
            if not nf.get("value"):
                continue
            pid += 1
            predicates.append(Predicate(
                id=f"pred-{pid}",
                type=PredicateType.METRIC,
                subclaim_id=nf.get("subclaim_id", "global"),
                args={
                    "entity": nf.get("entity", primary_entity),
                    "metric": nf.get("metric_key", ""),
                    "value": nf.get("value"),
                    "unit": nf.get("unit", ""),
                    "period": nf.get("period", ""),
                    "source": "numerical_grounding",
                },
                grounded=True,
            ))

    return predicates


# ═══════════════════════════════════════════════════════════════════════
# Evidence Grounding — Match predicates to evidence
# ═══════════════════════════════════════════════════════════════════════

def ground_predicates(
    predicates: List[Predicate],
    evidence_list: List[Dict],
) -> List[Predicate]:
    """Ground predicates against retrieved evidence.

    For METRIC predicates, check if evidence contains matching numbers.
    For GROWTH predicates, check if evidence confirms the growth rate.
    """
    for pred in predicates:
        if pred.type == PredicateType.METRIC:
            claimed_value = pred.args.get("value")
            if claimed_value is None:
                continue

            for ev in evidence_list:
                snippet = ev.get("snippet", "")
                # Check XBRL ground truth first
                xbrl = ev.get("xbrl_data")
                if xbrl and xbrl.get("actual_value"):
                    try:
                        actual_str = re.sub(r'[^\d.\-]', '', str(xbrl["actual_value"]))
                        actual = float(actual_str)
                        pred.grounded = True
                        pred.grounding_evidence.append(ev["id"])
                        pred.grounding_value = actual
                        break
                    except (ValueError, TypeError):
                        pass

                # Check if snippet contains the claimed number (fuzzy)
                snippet_nums = _NUM_PATTERN.findall(snippet)
                for raw, unit in snippet_nums:
                    ev_val = _normalize_number(raw, unit)
                    if ev_val is not None and claimed_value > 0:
                        ratio = ev_val / claimed_value if claimed_value != 0 else 0
                        if 0.9 <= ratio <= 1.1:  # within 10%
                            pred.grounded = True
                            pred.grounding_evidence.append(ev["id"])
                            pred.grounding_value = ev_val
                            break

        elif pred.type == PredicateType.GROWTH:
            # Check if any evidence mentions similar growth figures
            claimed_pct = pred.args.get("value_pct")
            if claimed_pct is None:
                continue

            for ev in evidence_list:
                snippet = ev.get("snippet", "")
                pct_matches = re.findall(r'(\d+\.?\d*)\s*%', snippet)
                for pm in pct_matches:
                    try:
                        ev_pct = float(pm)
                        if abs(ev_pct - claimed_pct) < 3.0:  # within 3pp
                            pred.grounded = True
                            pred.grounding_evidence.append(ev["id"])
                            pred.grounding_value = ev_pct
                            break
                    except ValueError:
                        pass

        elif pred.type in (PredicateType.EXISTENCE, PredicateType.SOURCE, PredicateType.CAUSAL):
            # For non-numeric predicates, check if any supporting evidence exists
            for ev in evidence_list:
                if ev.get("supports_claim") is True:
                    pred.grounded = True
                    pred.grounding_evidence.append(ev["id"])
                    break

    return predicates


# ═══════════════════════════════════════════════════════════════════════
# Inference Rules — Deterministic reasoning over predicates + evidence
# ═══════════════════════════════════════════════════════════════════════

# Tier authority weights for symbolic reasoning
_TIER_AUTHORITY = {
    "sec_filing": 1.0,
    "earnings_transcript": 0.8,
    "market_data": 0.7,
    "press_release": 0.5,
    "analyst_report": 0.5,
    "counter": 0.3,
}


def apply_inference_rules(
    predicates: List[Predicate],
    evidence_list: List[Dict],
    contradictions: List[Dict],
    subclaim_verdicts: List[Dict],
) -> List[RuleFiring]:
    """Apply deterministic inference rules over grounded predicates."""
    firings: List[RuleFiring] = []
    rid = 0

    # --- Rule 1: Numeric Mismatch Detection ---
    for pred in predicates:
        if pred.type == PredicateType.METRIC and pred.grounded and pred.grounding_value is not None:
            claimed = pred.args.get("value", 0)
            actual = pred.grounding_value
            if claimed and actual and claimed > 0:
                pct_diff = abs(actual - claimed) / claimed * 100
                if pct_diff > 15:
                    rid += 1
                    firings.append(RuleFiring(
                        rule_id=f"rule-{rid}",
                        rule_name="NUMERIC_MISMATCH",
                        description=f"Claimed value ({pred.args.get('raw', claimed)}) differs from evidence ({actual}) by {pct_diff:.1f}%",
                        severity=RuleSeverity.OVERRIDE,
                        inputs=[pred.id] + pred.grounding_evidence,
                        conclusion=f"Numeric discrepancy of {pct_diff:.1f}% exceeds 15% threshold",
                        suggested_verdict="exaggerated" if pct_diff < 50 else "contradicted",
                        confidence_delta=-0.2,
                    ))
                elif pct_diff > 5:
                    rid += 1
                    firings.append(RuleFiring(
                        rule_id=f"rule-{rid}",
                        rule_name="NUMERIC_IMPRECISION",
                        description=f"Claimed value ({pred.args.get('raw', claimed)}) approximately matches evidence ({actual}), Δ={pct_diff:.1f}%",
                        severity=RuleSeverity.WARNING,
                        inputs=[pred.id] + pred.grounding_evidence,
                        conclusion=f"Minor numeric imprecision ({pct_diff:.1f}%) — claim is directionally correct",
                        confidence_delta=-0.05,
                    ))
                else:
                    rid += 1
                    firings.append(RuleFiring(
                        rule_id=f"rule-{rid}",
                        rule_name="NUMERIC_MATCH",
                        description=f"Claimed value ({pred.args.get('raw', claimed)}) confirmed by evidence ({actual})",
                        severity=RuleSeverity.INFO,
                        inputs=[pred.id] + pred.grounding_evidence,
                        conclusion="Exact numeric match confirmed",
                        confidence_delta=0.1,
                    ))

        # --- Rule 1b: Growth Rate Mismatch ---
        if pred.type == PredicateType.GROWTH and pred.grounded and pred.grounding_value is not None:
            claimed_pct = pred.args.get("value_pct", 0)
            actual_pct = pred.grounding_value
            diff = abs(actual_pct - claimed_pct)
            if diff > 5:
                rid += 1
                firings.append(RuleFiring(
                    rule_id=f"rule-{rid}",
                    rule_name="GROWTH_RATE_MISMATCH",
                    description=f"Claimed {claimed_pct}% {pred.args.get('direction', 'change')} vs evidence {actual_pct}% (Δ={diff:.1f}pp)",
                    severity=RuleSeverity.OVERRIDE,
                    inputs=[pred.id] + pred.grounding_evidence,
                    conclusion=f"Growth rate discrepancy of {diff:.1f} percentage points",
                    suggested_verdict="exaggerated",
                    confidence_delta=-0.15,
                ))
            elif diff > 2:
                rid += 1
                firings.append(RuleFiring(
                    rule_id=f"rule-{rid}",
                    rule_name="GROWTH_RATE_APPROXIMATE",
                    description=f"Claimed {claimed_pct}% ≈ evidence {actual_pct}% (Δ={diff:.1f}pp)",
                    severity=RuleSeverity.WARNING,
                    inputs=[pred.id] + pred.grounding_evidence,
                    conclusion="Growth rate approximately correct",
                    confidence_delta=-0.05,
                ))

    # --- Rule 2: Authority Hierarchy ---
    # If high-authority source (SEC) supports but low-authority (news) contradicts → trust SEC
    sec_evidence = [e for e in evidence_list if e.get("tier") == "sec_filing"]
    counter_evidence = [e for e in evidence_list if e.get("tier") == "counter"]

    if sec_evidence and counter_evidence:
        sec_supports = any(e.get("supports_claim") is True for e in sec_evidence)
        counter_opposes = any(e.get("supports_claim") is False for e in counter_evidence)

        if sec_supports and counter_opposes:
            rid += 1
            firings.append(RuleFiring(
                rule_id=f"rule-{rid}",
                rule_name="AUTHORITY_HIERARCHY",
                description="SEC filing supports claim while lower-authority counter-evidence opposes it",
                severity=RuleSeverity.INFO,
                inputs=[e["id"] for e in sec_evidence[:2]] + [e["id"] for e in counter_evidence[:2]],
                conclusion="SEC filing (highest authority) takes precedence over counter-evidence",
                confidence_delta=0.1,
            ))

    # --- Rule 3: Ungrounded Predicates ---
    ungrounded = [p for p in predicates if not p.grounded and p.type in (PredicateType.METRIC, PredicateType.GROWTH)]
    if ungrounded:
        rid += 1
        firings.append(RuleFiring(
            rule_id=f"rule-{rid}",
            rule_name="UNGROUNDED_CLAIMS",
            description=f"{len(ungrounded)} numeric claim(s) could not be verified against any evidence source",
            severity=RuleSeverity.WARNING,
            inputs=[p.id for p in ungrounded],
            conclusion="Some quantitative assertions lack evidence grounding",
            confidence_delta=-0.1 * len(ungrounded),
        ))

    # --- Rule 4: Contradiction Severity Escalation ---
    high_contradictions = [c for c in contradictions if c.get("severity") == "high"]
    if high_contradictions:
        rid += 1
        firings.append(RuleFiring(
            rule_id=f"rule-{rid}",
            rule_name="HIGH_SEVERITY_CONTRADICTION",
            description=f"{len(high_contradictions)} high-severity contradiction(s) between sources",
            severity=RuleSeverity.OVERRIDE,
            inputs=[c.get("id", "") for c in high_contradictions],
            conclusion="High-severity contradictions detected — verdict reliability reduced",
            suggested_verdict="contradicted" if len(high_contradictions) >= 2 else "mixed",
            confidence_delta=-0.2,
        ))

    # --- Rule 5: Unanimous Evidence Agreement ---
    scored = [e for e in evidence_list if e.get("supports_claim") is not None]
    if len(scored) >= 3:
        all_support = all(e.get("supports_claim") is True for e in scored)
        all_oppose = all(e.get("supports_claim") is False for e in scored)
        if all_support:
            rid += 1
            firings.append(RuleFiring(
                rule_id=f"rule-{rid}",
                rule_name="UNANIMOUS_SUPPORT",
                description=f"All {len(scored)} scored evidence sources support the claim",
                severity=RuleSeverity.INFO,
                inputs=[e["id"] for e in scored],
                conclusion="Strong consensus across all evidence tiers",
                confidence_delta=0.15,
            ))
        elif all_oppose:
            rid += 1
            firings.append(RuleFiring(
                rule_id=f"rule-{rid}",
                rule_name="UNANIMOUS_OPPOSITION",
                description=f"All {len(scored)} scored evidence sources oppose the claim",
                severity=RuleSeverity.OVERRIDE,
                inputs=[e["id"] for e in scored],
                conclusion="No evidence supports the claim",
                suggested_verdict="contradicted",
                confidence_delta=-0.3,
            ))

    # --- Rule 6: Temporal Validity ---
    for pred in predicates:
        if pred.type == PredicateType.TEMPORAL:
            period = pred.args.get("period", "")
            # Check for future-looking claims without guidance evidence
            if re.search(r'202[7-9]|203\d', period):
                has_guidance = any(
                    "guidance" in e.get("snippet", "").lower() or
                    "forecast" in e.get("snippet", "").lower() or
                    "outlook" in e.get("snippet", "").lower()
                    for e in evidence_list
                )
                if not has_guidance:
                    rid += 1
                    firings.append(RuleFiring(
                        rule_id=f"rule-{rid}",
                        rule_name="FUTURE_CLAIM_NO_GUIDANCE",
                        description=f"Claim references future period ({period}) but no guidance/forecast evidence found",
                        severity=RuleSeverity.WARNING,
                        inputs=[pred.id],
                        conclusion="Future-looking claim cannot be verified without forward guidance",
                        confidence_delta=-0.15,
                    ))

    # --- Rule 7: Sub-claim Verdict Consistency ---
    if subclaim_verdicts:
        verdict_set = set(v.get("verdict", "") for v in subclaim_verdicts)
        if "supported" in verdict_set and "contradicted" in verdict_set:
            rid += 1
            firings.append(RuleFiring(
                rule_id=f"rule-{rid}",
                rule_name="MIXED_SUBCLAIM_VERDICTS",
                description="Some sub-claims are supported while others are contradicted",
                severity=RuleSeverity.WARNING,
                inputs=[v.get("subclaim_id", "") for v in subclaim_verdicts],
                conclusion="Internal inconsistency: claim is partially true and partially false",
                suggested_verdict="mixed",
                confidence_delta=-0.1,
            ))

    return firings


# ═══════════════════════════════════════════════════════════════════════
# Proof Tree Construction
# ═══════════════════════════════════════════════════════════════════════

def build_proof_tree(
    claim_text: str,
    predicates: List[Predicate],
    rule_firings: List[RuleFiring],
    subclaim_verdicts: List[Dict],
    evidence_list: List[Dict],
    overall_verdict: Optional[Dict] = None,
) -> List[ProofNode]:
    """Build a proof tree showing the formal derivation chain."""
    nodes: List[ProofNode] = []
    nid = 0

    # Root: the claim itself
    nid += 1
    root_id = f"pn-{nid}"
    root = ProofNode(
        id=root_id,
        type=ProofNodeType.CLAIM,
        label=claim_text[:120] + ("..." if len(claim_text) > 120 else ""),
        detail=claim_text,
        status=overall_verdict.get("verdict", "pending") if overall_verdict else "pending",
        confidence=overall_verdict.get("confidence_score", 0) / 100 if overall_verdict else 0,
    )

    # Premise nodes: one per sub-claim
    subclaim_node_ids = []
    for sv in subclaim_verdicts:
        nid += 1
        sc_node_id = f"pn-{nid}"
        subclaim_node_ids.append(sc_node_id)

        # Find predicates for this sub-claim
        sc_predicates = [p for p in predicates if p.subclaim_id == sv.get("subclaim_id", "")]
        # Find evidence for this sub-claim
        sc_evidence = [e for e in evidence_list if e.get("subclaim_id") == sv.get("subclaim_id", "")]

        sc_node = ProofNode(
            id=sc_node_id,
            type=ProofNodeType.PREMISE,
            label=sv.get("text", "")[:100],
            detail=sv.get("summary", ""),
            status=sv.get("verdict", "pending"),
            confidence=sv.get("confidence_score", 50) / 100,
            evidence_ids=[e["id"] for e in sc_evidence],
        )

        # Evidence child nodes
        ev_child_ids = []
        for ev in sc_evidence[:5]:  # cap at 5 per sub-claim
            nid += 1
            ev_node_id = f"pn-{nid}"
            ev_child_ids.append(ev_node_id)

            tier = ev.get("tier", "unknown")
            supports = ev.get("supports_claim")
            status = "verified" if supports is True else ("refuted" if supports is False else "partial")
            quality = ev.get("quality_score", 50)

            ev_node = ProofNode(
                id=ev_node_id,
                type=ProofNodeType.EVIDENCE,
                label=f"[{tier}] {ev.get('title', '')[:60]}",
                detail=ev.get("snippet", "")[:200],
                status=status,
                confidence=quality / 100,
                evidence_ids=[ev["id"]],
            )
            nodes.append(ev_node)

        # Predicate child nodes
        pred_child_ids = []
        for pred in sc_predicates:
            nid += 1
            pred_node_id = f"pn-{nid}"
            pred_child_ids.append(pred_node_id)

            pred_node = ProofNode(
                id=pred_node_id,
                type=ProofNodeType.INFERENCE,
                label=pred.formal_repr(),
                detail=f"Grounded: {pred.grounded}" + (f" (actual: {pred.grounding_value})" if pred.grounding_value else ""),
                status="verified" if pred.grounded else "pending",
                confidence=0.9 if pred.grounded else 0.3,
                predicate_id=pred.id,
                evidence_ids=pred.grounding_evidence,
            )
            nodes.append(pred_node)

        sc_node.children = ev_child_ids + pred_child_ids
        nodes.append(sc_node)

    # Rule firing nodes
    rule_child_ids = []
    for rf in rule_firings:
        nid += 1
        rule_node_id = f"pn-{nid}"
        rule_child_ids.append(rule_node_id)

        status = "verified" if rf.severity == RuleSeverity.INFO else (
            "refuted" if rf.severity == RuleSeverity.OVERRIDE and rf.suggested_verdict in ("contradicted",) else "partial"
        )

        rule_node = ProofNode(
            id=rule_node_id,
            type=ProofNodeType.RULE,
            label=f"RULE: {rf.rule_name}",
            detail=rf.description,
            status=status,
            confidence=max(0, min(1, 0.5 + rf.confidence_delta)),
            rule_id=rf.rule_id,
        )
        nodes.append(rule_node)

    # Verdict node
    nid += 1
    verdict_node_id = f"pn-{nid}"
    verdict_node = ProofNode(
        id=verdict_node_id,
        type=ProofNodeType.VERDICT,
        label=f"VERDICT: {overall_verdict.get('verdict', 'pending').upper()}" if overall_verdict else "VERDICT: PENDING",
        detail=overall_verdict.get("summary", "") if overall_verdict else "",
        status=overall_verdict.get("verdict", "pending") if overall_verdict else "pending",
        confidence=overall_verdict.get("confidence_score", 0) / 100 if overall_verdict else 0,
        children=subclaim_node_ids + rule_child_ids,
    )
    nodes.append(verdict_node)

    # Wire root
    root.children = [verdict_node_id]
    nodes.insert(0, root)

    return nodes


# ═══════════════════════════════════════════════════════════════════════
# Bayesian Confidence Propagation
# ═══════════════════════════════════════════════════════════════════════

def propagate_confidence(
    predicates: List[Predicate],
    rule_firings: List[RuleFiring],
    evidence_list: List[Dict],
    subclaim_verdicts: List[Dict],
) -> Dict[str, Any]:
    """Compute Bayesian-style confidence propagation.

    Instead of LLM-estimated confidence, compute it formally:
    - P(evidence_correct) based on tier authority + quality score
    - P(subclaim) = combined probability from evidence
    - P(claim) = product of required sub-claim probabilities
    - Apply rule firing adjustments
    - Compute symbolic_reliability: how much we trust our own analysis
    """

    # Step 1: Evidence-level confidence
    evidence_probs: Dict[str, float] = {}
    for ev in evidence_list:
        tier = ev.get("tier", "")
        quality = ev.get("quality_score", 50) / 100
        authority = _TIER_AUTHORITY.get(tier, 0.3)
        supports = ev.get("supports_claim")

        # P(evidence is reliable) = authority * quality
        reliability = authority * quality

        # If evidence supports, it contributes positively; if opposes, negatively
        if supports is True:
            evidence_probs[ev["id"]] = reliability
        elif supports is False:
            evidence_probs[ev["id"]] = -reliability  # negative = opposing
        else:
            evidence_probs[ev["id"]] = reliability * 0.3  # neutral/unknown

    # Step 2: Sub-claim confidence via Noisy-OR combination
    subclaim_probs: Dict[str, float] = {}
    for sv in subclaim_verdicts:
        sc_id = sv.get("subclaim_id", "")
        sc_evidence = [e for e in evidence_list if e.get("subclaim_id") == sc_id]

        if not sc_evidence:
            subclaim_probs[sc_id] = 0.3  # prior with no evidence
            continue

        # Noisy-OR: P(subclaim) = 1 - Π(1 - P(ev_i)) for supporting evidence
        supporting = [evidence_probs.get(e["id"], 0) for e in sc_evidence if evidence_probs.get(e["id"], 0) > 0]
        opposing = [abs(evidence_probs.get(e["id"], 0)) for e in sc_evidence if evidence_probs.get(e["id"], 0) < 0]

        if supporting:
            p_support = 1.0 - math.prod(1.0 - p for p in supporting)
        else:
            p_support = 0.2  # weak prior

        if opposing:
            p_oppose = 1.0 - math.prod(1.0 - p for p in opposing)
        else:
            p_oppose = 0.0

        # Net probability: support minus opposition
        p_net = max(0.0, min(1.0, p_support - p_oppose * 0.7))
        subclaim_probs[sc_id] = p_net

    # Step 3: Overall claim confidence (AND combination — all sub-claims needed)
    if subclaim_probs:
        # Geometric mean (softer than pure product)
        probs = list(subclaim_probs.values())
        if probs:
            log_sum = sum(math.log(max(p, 0.01)) for p in probs)
            p_claim = math.exp(log_sum / len(probs))
        else:
            p_claim = 0.3
    else:
        p_claim = 0.3

    # Step 4: Apply rule firing adjustments
    total_delta = sum(rf.confidence_delta for rf in rule_firings)
    p_adjusted = max(0.0, min(1.0, p_claim + total_delta))

    # Convert to 0-100 score
    score = round(p_adjusted * 100)
    level = "high" if score >= 70 else ("medium" if score >= 40 else "low")

    n_grounded = sum(1 for p in predicates if p.grounded)
    n_total = len(predicates)
    n_override = sum(1 for rf in rule_firings if rf.severity == RuleSeverity.OVERRIDE)

    # Step 5: Symbolic self-assessment — how reliable is our OWN analysis?
    symbolic_reliability = _compute_symbolic_reliability(
        predicates, rule_firings, evidence_list, subclaim_verdicts,
    )

    return {
        "bayesian_score": score,
        "bayesian_level": level,
        "claim_probability": round(p_claim, 4),
        "adjusted_probability": round(p_adjusted, 4),
        "rule_adjustment": round(total_delta, 4),
        "subclaim_probabilities": {k: round(v, 4) for k, v in subclaim_probs.items()},
        "evidence_reliabilities": {k: round(v, 4) for k, v in evidence_probs.items()},
        "grounded_predicates": n_grounded,
        "total_predicates": n_total,
        "rules_fired": len(rule_firings),
        "override_rules": n_override,
        "symbolic_reliability": symbolic_reliability,
    }


def _compute_symbolic_reliability(
    predicates: List[Predicate],
    rule_firings: List[RuleFiring],
    evidence_list: List[Dict],
    subclaim_verdicts: List[Dict],
) -> Dict[str, Any]:
    """Self-assessment: how reliable is the symbolic analysis itself?

    This answers the meta-question: "Should we trust the Bayesian score?"
    A low reliability means the symbolic engine doesn't have enough
    structured data to produce a meaningful confidence score, so it
    should NOT override the neural verdict.

    Factors:
    1. Predicate coverage: did we extract meaningful predicates?
    2. Grounding ratio: what % of predicates matched evidence?
    3. Evidence coverage: does the evidence have structured data (tiers, scores)?
    4. Claim type suitability: is this a quantitative claim we can reason about?
    5. Neural agreement: do the sub-claim verdicts from the LLM agree with each other?
    """
    scores = {}
    reasons = []

    # --- Factor 1: Predicate Coverage (0-100) ---
    n_predicates = len(predicates)
    n_quantitative = sum(1 for p in predicates if p.type in (PredicateType.METRIC, PredicateType.GROWTH, PredicateType.COMPARISON))
    if n_predicates == 0:
        scores["predicate_coverage"] = 10
        reasons.append("No formal predicates extracted — claim may be qualitative/policy-based")
    elif n_quantitative == 0:
        scores["predicate_coverage"] = 30
        reasons.append("No quantitative predicates — symbolic analysis has limited applicability")
    else:
        scores["predicate_coverage"] = min(100, 40 + n_quantitative * 20)

    # --- Factor 2: Grounding Ratio (0-100) ---
    n_grounded = sum(1 for p in predicates if p.grounded)
    if n_predicates > 0:
        grounding_ratio = n_grounded / n_predicates
        scores["grounding_ratio"] = round(grounding_ratio * 100)
        if grounding_ratio < 0.3:
            reasons.append(f"Only {n_grounded}/{n_predicates} predicates grounded — evidence may not contain verifiable numbers")
    else:
        scores["grounding_ratio"] = 0

    # --- Factor 3: Evidence Structure (0-100) ---
    scored_evidence = [e for e in evidence_list if e.get("quality_score") is not None]
    tiered_evidence = [e for e in evidence_list if e.get("tier") and e["tier"] != "unknown"]
    stance_evidence = [e for e in evidence_list if e.get("supports_claim") is not None]
    if not evidence_list:
        scores["evidence_structure"] = 0
        reasons.append("No evidence available")
    else:
        n = len(evidence_list)
        pct_scored = len(scored_evidence) / n
        pct_tiered = len(tiered_evidence) / n
        pct_stance = len(stance_evidence) / n
        scores["evidence_structure"] = round((pct_scored * 40 + pct_tiered * 30 + pct_stance * 30) * 100 / 100)

    # --- Factor 4: Claim Type Suitability (0-100) ---
    # Symbolic reasoning is best for quantitative financial claims,
    # weakest for policy, opinion, or categorical claims
    has_numbers = any(p.type in (PredicateType.METRIC, PredicateType.GROWTH) for p in predicates)
    has_only_existence = all(p.type in (PredicateType.EXISTENCE, PredicateType.CAUSAL, PredicateType.SOURCE) for p in predicates) if predicates else True
    if has_numbers:
        scores["claim_type_suitability"] = 85
    elif has_only_existence:
        scores["claim_type_suitability"] = 25
        reasons.append("Claim is categorical/qualitative — symbolic reasoning has low applicability")
    else:
        scores["claim_type_suitability"] = 50

    # --- Factor 5: Neural Verdict Agreement (0-100) ---
    # If all sub-claim verdicts from the LLM agree, the neural side is consistent
    # and we should be more cautious about overriding
    if subclaim_verdicts:
        verdict_set = set(sv.get("verdict", "") for sv in subclaim_verdicts)
        if len(verdict_set) == 1:
            scores["neural_consistency"] = 90  # LLM is very consistent — be cautious overriding
        elif len(verdict_set) == 2:
            scores["neural_consistency"] = 60
        else:
            scores["neural_consistency"] = 30  # LLM is confused — symbolic override more justified
            reasons.append("Neural sub-claim verdicts are inconsistent — symbolic analysis may be more reliable")
    else:
        scores["neural_consistency"] = 50

    # --- Weighted combination ---
    weights = {
        "predicate_coverage": 0.25,
        "grounding_ratio": 0.25,
        "evidence_structure": 0.15,
        "claim_type_suitability": 0.25,
        "neural_consistency": 0.10,
    }
    # For override decisions, we INVERT neural_consistency:
    # high neural consistency = we should NOT override = low override_confidence
    override_weights = {
        "predicate_coverage": 0.25,
        "grounding_ratio": 0.25,
        "evidence_structure": 0.15,
        "claim_type_suitability": 0.25,
        "neural_consistency": -0.10,  # penalize overriding when neural is consistent
    }

    reliability_score = round(sum(scores.get(k, 0) * w for k, w in weights.items()))
    reliability_score = max(0, min(100, reliability_score))

    override_confidence = round(sum(scores.get(k, 0) * abs(w) * (1 if w > 0 else -1) for k, w in override_weights.items()) + 10)  # +10 base
    override_confidence = max(0, min(100, override_confidence))

    reliability_level = "high" if reliability_score >= 65 else ("medium" if reliability_score >= 40 else "low")

    return {
        "score": reliability_score,
        "level": reliability_level,
        "override_confidence": override_confidence,
        "factors": scores,
        "reasons": reasons,
        "can_override": reliability_score >= 50 and override_confidence >= 40,
    }


# ═══════════════════════════════════════════════════════════════════════
# Top-Level Orchestrator — Called from verification pipeline
# ═══════════════════════════════════════════════════════════════════════

@dataclass
class SymbolicResult:
    predicates: List[Predicate]
    rule_firings: List[RuleFiring]
    proof_tree: List[ProofNode]
    confidence: Dict[str, Any]
    verdict_override: Optional[Dict[str, Any]] = None

    def to_dict(self) -> Dict:
        d = {
            "predicates": [p.to_dict() for p in self.predicates],
            "rule_firings": [r.to_dict() for r in self.rule_firings],
            "proof_tree": [n.to_dict() for n in self.proof_tree],
            "confidence": self.confidence,
        }
        if self.verdict_override:
            d["verdict_override"] = self.verdict_override
        return d


def _compute_verdict_override(
    confidence: Dict[str, Any],
    rule_firings: List[RuleFiring],
    overall_verdict: Optional[Dict] = None,
) -> Optional[Dict[str, Any]]:
    """Determine if the symbolic layer should override the neural verdict.

    KEY PRINCIPLE: Only override when the symbolic engine has HIGH RELIABILITY
    (i.e., it has enough structured data to be confident in its own analysis).
    A low Bayesian score with low reliability just means "we don't know" —
    NOT "the claim is wrong".
    """
    if not overall_verdict:
        return None

    bay_score = confidence.get("bayesian_score", 50)
    neural_verdict = overall_verdict.get("verdict", "").lower()
    neural_score = overall_verdict.get("confidence_score", 50) or 50
    reliability = confidence.get("symbolic_reliability", {})
    rel_score = reliability.get("score", 0)
    can_override = reliability.get("can_override", False)
    override_conf = reliability.get("override_confidence", 0)
    rel_reasons = reliability.get("reasons", [])

    override_rules = [rf for rf in rule_firings if rf.severity == RuleSeverity.OVERRIDE]
    suggested_verdicts = [rf.suggested_verdict for rf in override_rules if rf.suggested_verdict]

    delta = abs(bay_score - neural_score)

    # --- Gate: If symbolic reliability is too low, NEVER override ---
    if not can_override:
        if delta > 25:
            return {
                "should_override": False,
                "original_verdict": neural_verdict,
                "new_verdict": neural_verdict,
                "original_confidence": neural_score,
                "new_confidence_score": bay_score,
                "new_confidence_level": confidence.get("bayesian_level", "medium"),
                "symbolic_reliability": rel_score,
                "reason": f"Neural-symbolic divergence of {delta} points detected, but symbolic reliability is too low "
                          f"({rel_score}/100) to justify an override. "
                          + (f"Reasons: {'; '.join(rel_reasons)}. " if rel_reasons else "")
                          + f"Deferring to neural verdict.",
            }
        return None

    # --- Case 1: High-reliability override with concrete numeric evidence ---
    # Only override "supported" when we have GROUNDED numeric predicates that disagree
    if (bay_score < 30
            and neural_verdict in ("supported", "partially_supported")
            and rel_score >= 60
            and suggested_verdicts):
        severity_order = ["contradicted", "unsupported", "exaggerated", "mixed", "partially_supported"]
        best = next((sv for sv in severity_order if sv in suggested_verdicts), "mixed")
        return {
            "should_override": True,
            "original_verdict": neural_verdict,
            "new_verdict": best,
            "original_confidence": neural_score,
            "new_confidence_score": bay_score,
            "new_confidence_level": confidence.get("bayesian_level", "low"),
            "symbolic_reliability": rel_score,
            "reason": f"Symbolic analysis (reliability: {rel_score}/100) found concrete evidence contradicting "
                      f"the neural verdict of '{neural_verdict}'. Bayesian confidence: {bay_score}/100. "
                      f"Override rules: {', '.join(rf.rule_name + ' (' + rf.conclusion[:60] + ')' for rf in override_rules[:3])}. "
                      f"Downgrading to '{best}'.",
        }

    # --- Case 2: Multiple override rules with high reliability ---
    if (neural_verdict in ("supported", "partially_supported")
            and "contradicted" in suggested_verdicts
            and len(override_rules) >= 2
            and rel_score >= 55):
        return {
            "should_override": True,
            "original_verdict": neural_verdict,
            "new_verdict": "contradicted",
            "original_confidence": neural_score,
            "new_confidence_score": min(bay_score, 40),
            "new_confidence_level": "low" if bay_score < 40 else "medium",
            "symbolic_reliability": rel_score,
            "reason": f"Multiple formal rules ({len(override_rules)}) with high reliability ({rel_score}/100) "
                      f"indicate contradiction despite neural verdict of '{neural_verdict}'. "
                      f"Findings: {'; '.join(rf.conclusion for rf in override_rules[:3])}.",
        }

    # --- Case 3: High Bayesian + high reliability but neural says contradicted ---
    if (bay_score > 70
            and neural_verdict in ("contradicted", "unsupported")
            and rel_score >= 55):
        return {
            "should_override": True,
            "original_verdict": neural_verdict,
            "new_verdict": "partially_supported",
            "original_confidence": neural_score,
            "new_confidence_score": bay_score,
            "new_confidence_level": confidence.get("bayesian_level", "medium"),
            "symbolic_reliability": rel_score,
            "reason": f"Bayesian confidence ({bay_score}/100) with high reliability ({rel_score}/100) "
                      f"suggests substantial evidence support despite neural verdict of '{neural_verdict}'. "
                      f"Upgrading to 'partially_supported'.",
        }

    # --- Case 4: Divergence flagging (no override) ---
    if delta > 20:
        return {
            "should_override": False,
            "original_verdict": neural_verdict,
            "new_verdict": neural_verdict,
            "original_confidence": neural_score,
            "new_confidence_score": bay_score,
            "new_confidence_level": confidence.get("bayesian_level", "medium"),
            "symbolic_reliability": rel_score,
            "reason": f"Neural-symbolic divergence of {delta} points. "
                      f"Neural: {neural_score}/100, Symbolic: {bay_score}/100 (reliability: {rel_score}/100). "
                      + (f"Low reliability prevents override. " if rel_score < 50 else "")
                      + (f"Factors: {'; '.join(rel_reasons)}. " if rel_reasons else "")
                      + f"Verdict retained — treat confidence with caution.",
        }

    return None


def run_symbolic_reasoning(
    claim_text: str,
    subclaims: List[Dict],
    subclaim_verdicts: List[Dict],
    evidence_list: List[Dict],
    contradictions: List[Dict],
    overall_verdict: Optional[Dict] = None,
    entity_resolution: Optional[Dict] = None,
    normalization: Optional[Dict] = None,
    numerical_facts: Optional[List[Dict]] = None,
) -> SymbolicResult:
    """Run the full symbolic reasoning pipeline.

    Called once after the neural pipeline has produced all its outputs.
    No LLM calls — entirely deterministic.
    """
    # 1. Parse predicates from structured data
    predicates = parse_predicates(
        subclaims,
        entity_resolution=entity_resolution,
        normalization=normalization,
        numerical_facts=numerical_facts,
    )

    # 2. Ground predicates against evidence
    predicates = ground_predicates(predicates, evidence_list)

    # 3. Apply inference rules
    rule_firings = apply_inference_rules(
        predicates, evidence_list, contradictions, subclaim_verdicts,
    )

    # 4. Build proof tree
    proof_tree = build_proof_tree(
        claim_text, predicates, rule_firings,
        subclaim_verdicts, evidence_list, overall_verdict,
    )

    # 5. Propagate confidence
    confidence = propagate_confidence(
        predicates, rule_firings, evidence_list, subclaim_verdicts,
    )

    # 6. Determine if symbolic reasoning should override the neural verdict
    verdict_override = _compute_verdict_override(
        confidence, rule_firings, overall_verdict,
    )

    return SymbolicResult(
        predicates=predicates,
        rule_firings=rule_firings,
        proof_tree=proof_tree,
        confidence=confidence,
        verdict_override=verdict_override,
    )
