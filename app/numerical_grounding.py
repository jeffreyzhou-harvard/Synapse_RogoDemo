"""
Synapse Numerical Grounding Layer — deterministic financial math engine.

This module provides:
1. Regex-based extraction of all numerical facts from text (no LLM)
2. Structured FinancialFact data model with value, unit, period, context
3. Deterministic arithmetic comparisons (percentage diff, CAGR, margin calc)
4. Intra-document consistency checking (does page 3 math match page 7?)
5. Number dependency graph — trace how base numbers propagate through a document
6. Methodology consistency detection (LTM vs NTM, GAAP vs non-GAAP in same table)

Design principle: LLMs identify WHAT to compare. Python does ALL the math.
"""

from __future__ import annotations
import re
import math
from typing import List, Dict, Optional, Tuple, Any, Set
from dataclasses import dataclass, field, asdict
from enum import Enum


# ---------------------------------------------------------------------------
# Data Models
# ---------------------------------------------------------------------------

class NumericUnit(str, Enum):
    USD = "USD"
    EUR = "EUR"
    GBP = "GBP"
    JPY = "JPY"
    PERCENT = "percent"
    RATIO = "ratio"
    MULTIPLE = "multiple"
    COUNT = "count"
    SHARES = "shares"
    BPS = "basis_points"
    YEARS = "years"
    MONTHS = "months"
    UNKNOWN = "unknown"


class ScaleFactor(str, Enum):
    UNIT = "unit"
    THOUSAND = "thousand"
    MILLION = "million"
    BILLION = "billion"
    TRILLION = "trillion"


SCALE_VALUES = {
    ScaleFactor.UNIT: 1,
    ScaleFactor.THOUSAND: 1_000,
    ScaleFactor.MILLION: 1_000_000,
    ScaleFactor.BILLION: 1_000_000_000,
    ScaleFactor.TRILLION: 1_000_000_000_000,
}


class MetricCategory(str, Enum):
    REVENUE = "revenue"
    GROSS_PROFIT = "gross_profit"
    OPERATING_INCOME = "operating_income"
    NET_INCOME = "net_income"
    EPS = "eps"
    EBITDA = "ebitda"
    MARGIN = "margin"
    GROWTH_RATE = "growth_rate"
    VALUATION_MULTIPLE = "valuation_multiple"
    MARKET_CAP = "market_cap"
    ENTERPRISE_VALUE = "enterprise_value"
    DEBT = "debt"
    CASH = "cash"
    SHARES_OUTSTANDING = "shares_outstanding"
    CUSTOMER_COUNT = "customer_count"
    RETENTION_RATE = "retention_rate"
    CAC = "cac"
    LTV = "ltv"
    ARR = "arr"
    BURN_RATE = "burn_rate"
    RUNWAY = "runway"
    TAM = "tam"
    OTHER = "other"


class PeriodType(str, Enum):
    ANNUAL = "annual"
    QUARTERLY = "quarterly"
    LTM = "ltm"
    NTM = "ntm"
    YTD = "ytd"
    POINT_IN_TIME = "point_in_time"
    UNKNOWN = "unknown"


class AccountingBasis(str, Enum):
    GAAP = "gaap"
    NON_GAAP = "non_gaap"
    IFRS = "ifrs"
    PRO_FORMA = "pro_forma"
    ADJUSTED = "adjusted"
    UNKNOWN = "unknown"


@dataclass
class FinancialFact:
    """A single extracted numerical fact with full context."""
    id: str
    raw_text: str                          # Original text span
    value: float                           # Normalized numeric value
    unit: NumericUnit = NumericUnit.UNKNOWN
    scale: ScaleFactor = ScaleFactor.UNIT
    normalized_value: float = 0.0          # value * scale_factor
    category: MetricCategory = MetricCategory.OTHER
    period_type: PeriodType = PeriodType.UNKNOWN
    period_label: str = ""                 # e.g. "FY2024", "Q3 2025"
    accounting_basis: AccountingBasis = AccountingBasis.UNKNOWN
    entity: str = ""                       # Company or segment name
    location_in_doc: int = 0               # Character offset in source text
    context_sentence: str = ""             # Surrounding sentence
    is_derived: bool = False               # Is this computed from other facts?
    derived_from: List[str] = field(default_factory=list)  # IDs of source facts
    confidence: float = 1.0                # 1.0 = regex-extracted, 0.8 = inferred

    def __post_init__(self):
        # Percentages, ratios, and multiples are not scaled by million/billion
        if self.unit in (NumericUnit.PERCENT, NumericUnit.RATIO, NumericUnit.MULTIPLE, NumericUnit.BPS):
            self.normalized_value = self.value
        else:
            self.normalized_value = self.value * SCALE_VALUES.get(self.scale, 1)

    def to_dict(self) -> Dict:
        d = asdict(self)
        d["unit"] = self.unit.value
        d["scale"] = self.scale.value
        d["category"] = self.category.value
        d["period_type"] = self.period_type.value
        d["accounting_basis"] = self.accounting_basis.value
        return d


@dataclass
class ConsistencyIssue:
    """An internal consistency problem found within a document."""
    id: str
    issue_type: str   # math_error, propagation_error, methodology_mismatch, stale_reference
    severity: str     # critical, high, medium, low
    fact_ids: List[str]
    description: str
    expected_value: Optional[float] = None
    actual_value: Optional[float] = None
    discrepancy_pct: Optional[float] = None
    location: str = ""

    def to_dict(self) -> Dict:
        return asdict(self)


@dataclass
class NumberDependency:
    """An edge in the number propagation graph."""
    source_fact_id: str
    derived_fact_id: str
    relationship: str   # multiplied_by, divided_by, summed, growth_from, margin_of
    description: str

    def to_dict(self) -> Dict:
        return asdict(self)


# ---------------------------------------------------------------------------
# Regex-Based Number Extraction
# ---------------------------------------------------------------------------

# Currency symbols and their units
_CURRENCY_MAP = {
    "$": NumericUnit.USD,
    "€": NumericUnit.EUR,
    "£": NumericUnit.GBP,
    "¥": NumericUnit.JPY,
    "usd": NumericUnit.USD,
    "eur": NumericUnit.EUR,
    "gbp": NumericUnit.GBP,
}

# Scale word patterns
_SCALE_PATTERNS = {
    r'\bthousand\b': ScaleFactor.THOUSAND,
    r'\bk\b': ScaleFactor.THOUSAND,
    r'\bmillion\b': ScaleFactor.MILLION,
    r'\bmm\b': ScaleFactor.MILLION,
    r'\bm\b': ScaleFactor.MILLION,
    r'\bbillion\b': ScaleFactor.BILLION,
    r'\bbn\b': ScaleFactor.BILLION,
    r'\bb\b': ScaleFactor.BILLION,
    r'\btrillion\b': ScaleFactor.TRILLION,
    r'\btn\b': ScaleFactor.TRILLION,
    r'\bt\b': ScaleFactor.TRILLION,
}

# Metric category keywords
_CATEGORY_KEYWORDS: Dict[MetricCategory, List[str]] = {
    MetricCategory.REVENUE: ["revenue", "sales", "top line", "top-line", "net revenue", "gross revenue", "total revenue"],
    MetricCategory.GROSS_PROFIT: ["gross profit", "gross income"],
    MetricCategory.OPERATING_INCOME: ["operating income", "operating profit", "ebit", "operating earnings"],
    MetricCategory.NET_INCOME: ["net income", "net profit", "net earnings", "bottom line", "net loss"],
    MetricCategory.EPS: ["eps", "earnings per share", "diluted eps", "basic eps"],
    MetricCategory.EBITDA: ["ebitda", "adjusted ebitda"],
    MetricCategory.MARGIN: ["margin", "gross margin", "operating margin", "net margin", "ebitda margin", "profit margin"],
    MetricCategory.GROWTH_RATE: ["growth", "grew", "increased", "declined", "yoy", "y/y", "year-over-year", "cagr", "growth rate"],
    MetricCategory.VALUATION_MULTIPLE: ["multiple", "ev/ebitda", "ev/revenue", "p/e", "price-to-earnings", "price/earnings", "p/s", "ev/sales"],
    MetricCategory.MARKET_CAP: ["market cap", "market capitalization", "market value"],
    MetricCategory.ENTERPRISE_VALUE: ["enterprise value", "ev ", "implied valuation", "valuation", "equity value"],
    MetricCategory.DEBT: ["debt", "long-term debt", "total debt", "borrowings", "leverage"],
    MetricCategory.CASH: ["cash", "cash and equivalents", "liquidity", "cash position"],
    MetricCategory.SHARES_OUTSTANDING: ["shares outstanding", "diluted shares", "share count"],
    MetricCategory.CUSTOMER_COUNT: ["customers", "clients", "users", "subscribers", "accounts"],
    MetricCategory.RETENTION_RATE: ["retention", "churn", "nrr", "net revenue retention", "gross retention", "renewal rate"],
    MetricCategory.CAC: ["cac", "customer acquisition cost", "acquisition cost"],
    MetricCategory.LTV: ["ltv", "lifetime value", "customer lifetime value", "clv"],
    MetricCategory.ARR: ["arr", "annual recurring revenue", "mrr", "monthly recurring revenue"],
    MetricCategory.BURN_RATE: ["burn", "burn rate", "cash burn", "monthly burn"],
    MetricCategory.RUNWAY: ["runway", "months of runway"],
    MetricCategory.TAM: ["tam", "total addressable market", "sam", "som", "serviceable"],
}

# Period detection patterns
_PERIOD_PATTERNS = [
    (r'FY\s*20\d{2}', PeriodType.ANNUAL),
    (r'fiscal\s+year\s+20\d{2}', PeriodType.ANNUAL),
    (r'full\s+year\s+20\d{2}', PeriodType.ANNUAL),
    (r'Q[1-4]\s*\'?\d{2,4}', PeriodType.QUARTERLY),
    (r'Q[1-4]\s+20\d{2}', PeriodType.QUARTERLY),
    (r'first\s+quarter|second\s+quarter|third\s+quarter|fourth\s+quarter', PeriodType.QUARTERLY),
    (r'LTM|last\s+twelve\s+months|trailing\s+twelve', PeriodType.LTM),
    (r'NTM|next\s+twelve\s+months|forward', PeriodType.NTM),
    (r'YTD|year[\s-]to[\s-]date', PeriodType.YTD),
    (r'as\s+of\s+\w+\s+\d{1,2},?\s+20\d{2}', PeriodType.POINT_IN_TIME),
]

# Accounting basis patterns
_BASIS_PATTERNS = [
    (r'non[\s-]?GAAP|non[\s-]?gaap|adjusted', AccountingBasis.NON_GAAP),
    (r'GAAP|gaap|US\s+GAAP', AccountingBasis.GAAP),
    (r'IFRS|ifrs', AccountingBasis.IFRS),
    (r'pro[\s-]?forma', AccountingBasis.PRO_FORMA),
]


# Master number extraction regex
# Matches patterns like: $150M, $1.5 billion, 46.2%, 25x, 1,234,567, etc.
_NUMBER_PATTERN = re.compile(
    r'(?P<currency>[$€£¥])?\s*'                      # Optional currency symbol
    r'(?P<negative>[-−]|\()?'                          # Optional negative sign or opening paren
    r'(?P<number>\d{1,3}(?:,\d{3})*(?:\.\d+)?'        # Number with optional commas and decimals
    r'|\.\d+)'                                         # Or just decimal like .5
    r'(?P<close_paren>\))?'                            # Optional closing paren for negative
    r'\s*'
    r'(?P<scale_suffix>[KkMmBbTt](?:n|m|illion|housand|rillion)?)?'  # Scale suffix
    r'\s*'
    r'(?P<unit_suffix>[%xX]|bps|basis\s+points|shares|x\s+(?:revenue|ebitda|earnings))?',  # Unit suffix
    re.IGNORECASE
)


def _parse_number(s: str) -> float:
    """Parse a number string, handling commas and parenthetical negatives."""
    s = s.replace(",", "").strip()
    return float(s)


def _detect_scale(match: re.Match, context: str, has_own_suffix: bool = True) -> ScaleFactor:
    """Detect the scale factor from regex match and surrounding context.

    Only applies context-based scale if the number has a direct suffix OR
    a currency symbol (i.e., $94.8 billion → billion applies to 94.8).
    Standalone numbers without any marker don't inherit scale from context.
    """
    suffix = (match.group("scale_suffix") or "").lower().strip()

    # Direct suffix mapping
    suffix_map = {
        "k": ScaleFactor.THOUSAND, "thousand": ScaleFactor.THOUSAND,
        "m": ScaleFactor.MILLION, "mm": ScaleFactor.MILLION, "mn": ScaleFactor.MILLION, "million": ScaleFactor.MILLION,
        "b": ScaleFactor.BILLION, "bn": ScaleFactor.BILLION, "billion": ScaleFactor.BILLION,
        "t": ScaleFactor.TRILLION, "tn": ScaleFactor.TRILLION, "trillion": ScaleFactor.TRILLION,
    }
    if suffix in suffix_map:
        return suffix_map[suffix]

    # Only check IMMEDIATELY FOLLOWING text for scale words when number has currency
    # e.g., "$94.8 billion" -> billion applies, but "$2.18" with "billion" 50 chars away -> no
    if match.group("currency"):
        start, end = match.span()
        # Look at only the next 15 characters after the number for a scale word
        after_number = context[end - max(0, start - 150):][:15].lower().strip()
        for pattern, scale in _SCALE_PATTERNS.items():
            if re.search(pattern, after_number):
                return scale

    return ScaleFactor.UNIT


def _detect_unit(match: re.Match, context: str) -> NumericUnit:
    """Detect the unit from regex match and surrounding context."""
    currency = (match.group("currency") or "").strip()
    if currency in _CURRENCY_MAP:
        return _CURRENCY_MAP[currency]

    unit_suffix = (match.group("unit_suffix") or "").lower().strip()
    if unit_suffix == "%" or "percent" in context.lower():
        return NumericUnit.PERCENT
    if unit_suffix in ("x", "times") or re.search(r'\dx\b', context.lower()):
        return NumericUnit.MULTIPLE
    if "bps" in unit_suffix or "basis point" in unit_suffix:
        return NumericUnit.BPS
    if "share" in unit_suffix or "shares" in context.lower():
        return NumericUnit.SHARES

    # Check context for currency words
    ctx_lower = context.lower()
    for word, unit in _CURRENCY_MAP.items():
        if word in ctx_lower:
            return unit

    return NumericUnit.UNKNOWN


def _detect_category(sentence: str, num_position_in_sentence: int = -1) -> MetricCategory:
    """Detect the metric category from the sentence containing the number.

    Position-aware: finds the keyword CLOSEST to the number's position.
    This prevents "$150M" from being tagged as "gross_profit" when
    "revenue" is the nearest keyword.
    """
    s = sentence.lower()

    # Find all keyword matches with their positions
    matches: List[Tuple[int, MetricCategory]] = []
    for category, keywords in _CATEGORY_KEYWORDS.items():
        for kw in keywords:
            idx = s.find(kw)
            while idx != -1:
                matches.append((idx, category))
                idx = s.find(kw, idx + 1)

    if not matches:
        return MetricCategory.OTHER

    if num_position_in_sentence < 0:
        # Fallback: if no position given, use the first match
        # But prefer more specific categories when at same position
        matches.sort(key=lambda x: x[0])
        return matches[0][1]

    # Find the keyword closest to the number
    matches.sort(key=lambda x: abs(x[0] - num_position_in_sentence))
    return matches[0][1]


def _detect_period(context: str) -> Tuple[PeriodType, str]:
    """Detect the time period from surrounding context."""
    for pattern, period_type in _PERIOD_PATTERNS:
        m = re.search(pattern, context, re.IGNORECASE)
        if m:
            return period_type, m.group(0)
    return PeriodType.UNKNOWN, ""


def _detect_basis(context: str) -> AccountingBasis:
    """Detect accounting basis from surrounding context."""
    for pattern, basis in _BASIS_PATTERNS:
        if re.search(pattern, context):
            return basis
    return AccountingBasis.UNKNOWN


def _get_context_window(text: str, start: int, end: int, window: int = 150) -> str:
    """Get surrounding context for a match."""
    ctx_start = max(0, start - window)
    ctx_end = min(len(text), end + window)
    return text[ctx_start:ctx_end]


def _get_sentence(text: str, pos: int) -> str:
    """Extract the sentence containing position `pos`."""
    # Find sentence boundaries
    start = pos
    while start > 0 and text[start - 1] not in '.!?\n':
        start -= 1
    end = pos
    while end < len(text) and text[end] not in '.!?\n':
        end += 1
    return text[start:end].strip()


def extract_financial_facts(text: str, entity_hint: str = "") -> List[FinancialFact]:
    """Extract all numerical financial facts from text using regex.

    No LLM calls. Pure deterministic extraction.

    Returns a list of FinancialFact objects with:
    - Exact numeric value
    - Unit (USD, %, x, etc.)
    - Scale (millions, billions, etc.)
    - Normalized value (value * scale)
    - Category (revenue, margin, growth rate, etc.)
    - Period (FY2024, Q3 2025, LTM, etc.)
    - Accounting basis (GAAP, non-GAAP, etc.)
    - Location in document
    """
    facts: List[FinancialFact] = []
    seen_positions: Set[int] = set()  # Avoid duplicate extractions
    fact_id = 0

    for match in _NUMBER_PATTERN.finditer(text):
        num_str = match.group("number")
        if not num_str:
            continue

        start, end = match.span()
        if start in seen_positions:
            continue

        try:
            value = _parse_number(num_str)
        except (ValueError, TypeError):
            continue

        raw = match.group(0).strip()
        context = _get_context_window(text, start, end)

        has_currency = bool(match.group("currency"))
        has_unit = bool(match.group("unit_suffix"))
        has_scale = bool(match.group("scale_suffix"))
        has_any_marker = has_currency or has_unit or has_scale

        # --- Filter out non-financial numbers ---

        # Skip numbers that are part of date/quarter patterns (Q1, Q2, 2024, FY2024)
        pre_context = text[max(0, start - 5):start]
        post_context = text[end:min(len(text), end + 10)]
        # Skip if preceded by Q (quarter label like Q1, Q4)
        if re.search(r'[Qq]\s*$', pre_context) and not has_any_marker:
            continue
        # Skip if this number is part of a year (1900-2100)
        if not has_any_marker and 1900 <= value <= 2100 and "." not in num_str:
            continue
        # Skip if preceded by FY, CY, or similar fiscal year markers
        if re.search(r'(?:FY|CY|fy|cy)\s*$', pre_context) and not has_any_marker:
            continue
        # Skip numbers that are fragments of a larger number/year in the original text
        # e.g., "2024" might match as "202" + "4" if regex splits it
        if not has_any_marker:
            # Check if this number is part of a longer digit sequence
            char_before = text[start - 1] if start > 0 else ' '
            char_after = text[end] if end < len(text) else ' '
            if char_before.isdigit() or char_after.isdigit():
                continue
        # Skip standalone small integers without any financial marker
        if not has_any_marker and value == int(value) and 0 < value < 100:
            # Only keep if context strongly suggests financial meaning
            ctx_lower = context.lower()
            financial_signal = any(kw in ctx_lower for kws in _CATEGORY_KEYWORDS.values() for kw in kws)
            if not financial_signal:
                continue
        # Skip very tiny numbers without percent sign
        if value > 0 and value < 0.01 and not has_unit:
            continue

        # Check for negative (parenthetical)
        is_negative = bool(match.group("negative")) or bool(match.group("close_paren"))
        if is_negative:
            value = -abs(value)

        # Detect attributes — use sentence for category (not wide context)
        sentence = _get_sentence(text, start)
        # Compute position of the number within the sentence for proximity matching
        sentence_start = start
        while sentence_start > 0 and text[sentence_start - 1] not in '.!?\n':
            sentence_start -= 1
        num_pos_in_sentence = start - sentence_start
        scale = _detect_scale(match, context, has_own_suffix=has_currency)
        unit = _detect_unit(match, context)
        category = _detect_category(sentence, num_pos_in_sentence)
        period_type, period_label = _detect_period(context)
        basis = _detect_basis(context)

        fact_id += 1
        fact = FinancialFact(
            id=f"nf-{fact_id}",
            raw_text=raw,
            value=value,
            unit=unit,
            scale=scale,
            category=category,
            period_type=period_type,
            period_label=period_label,
            accounting_basis=basis,
            entity=entity_hint,
            location_in_doc=start,
            context_sentence=sentence[:300],
        )
        facts.append(fact)
        seen_positions.add(start)

    return facts


# ---------------------------------------------------------------------------
# Deterministic Math Comparisons
# ---------------------------------------------------------------------------

def compare_values(claimed: float, actual: float) -> Dict[str, Any]:
    """Compare two numeric values deterministically.

    Returns absolute difference, percentage difference, and a human-readable assessment.
    """
    if actual == 0:
        return {
            "absolute_diff": claimed - actual,
            "pct_diff": None,
            "direction": "overstated" if claimed > 0 else "understated" if claimed < 0 else "match",
            "match": claimed == 0,
            "assessment": "Actual value is zero; percentage comparison undefined.",
        }

    abs_diff = claimed - actual
    pct_diff = ((claimed - actual) / abs(actual)) * 100

    # Determine match tolerance
    # Within 1% = match, 1-5% = close, 5-15% = notable, >15% = significant
    abs_pct = abs(pct_diff)
    if abs_pct <= 1.0:
        match_level = "exact"
        assessment = f"Values match within 1% (diff: {pct_diff:+.2f}%)"
    elif abs_pct <= 5.0:
        match_level = "close"
        assessment = f"Values close — {pct_diff:+.2f}% difference (may be rounding)"
    elif abs_pct <= 15.0:
        match_level = "notable"
        direction = "overstated" if pct_diff > 0 else "understated"
        assessment = f"Notable discrepancy: claimed value {direction} by {abs_pct:.1f}%"
    else:
        match_level = "significant"
        direction = "overstated" if pct_diff > 0 else "understated"
        assessment = f"Significant discrepancy: claimed value {direction} by {abs_pct:.1f}%"

    return {
        "claimed": claimed,
        "actual": actual,
        "absolute_diff": round(abs_diff, 4),
        "pct_diff": round(pct_diff, 4),
        "abs_pct_diff": round(abs_pct, 4),
        "match_level": match_level,
        "direction": "overstated" if pct_diff > 0 else ("understated" if pct_diff < 0 else "match"),
        "assessment": assessment,
    }


def compute_growth_rate(start_value: float, end_value: float) -> Optional[float]:
    """Compute simple growth rate: (end - start) / |start| * 100."""
    if start_value == 0:
        return None
    return ((end_value - start_value) / abs(start_value)) * 100


def compute_cagr(start_value: float, end_value: float, years: float) -> Optional[float]:
    """Compute Compound Annual Growth Rate."""
    if start_value <= 0 or end_value <= 0 or years <= 0:
        return None
    return ((end_value / start_value) ** (1 / years) - 1) * 100


def compute_margin(numerator: float, denominator: float) -> Optional[float]:
    """Compute a margin/ratio as percentage."""
    if denominator == 0:
        return None
    return (numerator / denominator) * 100


def compute_multiple(enterprise_value: float, metric: float) -> Optional[float]:
    """Compute a valuation multiple (EV/EBITDA, P/E, etc.)."""
    if metric == 0:
        return None
    return enterprise_value / metric


def verify_multiplication(factor_a: float, factor_b: float, claimed_product: float, tolerance_pct: float = 2.0) -> Dict:
    """Verify that factor_a * factor_b ≈ claimed_product."""
    expected = factor_a * factor_b
    comparison = compare_values(claimed_product, expected)
    comparison["factor_a"] = factor_a
    comparison["factor_b"] = factor_b
    comparison["expected_product"] = round(expected, 4)
    comparison["passes"] = comparison["abs_pct_diff"] <= tolerance_pct if comparison.get("abs_pct_diff") is not None else False
    return comparison


def verify_division(numerator: float, denominator: float, claimed_quotient: float, tolerance_pct: float = 2.0) -> Dict:
    """Verify that numerator / denominator ≈ claimed_quotient."""
    if denominator == 0:
        return {"passes": False, "assessment": "Division by zero", "expected_quotient": None}
    expected = numerator / denominator
    comparison = compare_values(claimed_quotient, expected)
    comparison["numerator"] = numerator
    comparison["denominator"] = denominator
    comparison["expected_quotient"] = round(expected, 4)
    comparison["passes"] = comparison["abs_pct_diff"] <= tolerance_pct if comparison.get("abs_pct_diff") is not None else False
    return comparison


def verify_sum(addends: List[float], claimed_sum: float, tolerance_pct: float = 1.0) -> Dict:
    """Verify that sum(addends) ≈ claimed_sum."""
    expected = sum(addends)
    comparison = compare_values(claimed_sum, expected)
    comparison["addends"] = addends
    comparison["expected_sum"] = round(expected, 4)
    comparison["passes"] = comparison["abs_pct_diff"] <= tolerance_pct if comparison.get("abs_pct_diff") is not None else False
    return comparison


# ---------------------------------------------------------------------------
# Intra-Document Consistency Checking
# ---------------------------------------------------------------------------

def check_intra_document_consistency(facts: List[FinancialFact]) -> List[ConsistencyIssue]:
    """Check for internal mathematical consistency within a document.

    Looks for:
    1. Same metric reported with different values in different places
    2. Derived metrics that don't match their components (margin ≠ profit/revenue)
    3. Growth rates that don't match the underlying values
    4. Valuation multiples that don't match EV and metric
    5. Sums that don't add up
    """
    issues: List[ConsistencyIssue] = []
    issue_id = 0

    # --- Check 1: Duplicate metrics with different values ---
    # Group facts by (category, period, entity, unit, scale) — must match ALL to be "same metric"
    groups: Dict[str, List[FinancialFact]] = {}
    for f in facts:
        if f.category == MetricCategory.OTHER:
            continue
        # Only group facts that have the same unit type (USD with USD, percent with percent)
        key = f"{f.category.value}|{f.period_label}|{f.entity}|{f.unit.value}"
        groups.setdefault(key, []).append(f)

    for key, group in groups.items():
        if len(group) < 2:
            continue
        # Compare all pairs
        for i in range(len(group)):
            for j in range(i + 1, len(group)):
                a, b = group[i], group[j]
                if a.normalized_value == 0 and b.normalized_value == 0:
                    continue
                # Skip if the sentences are clearly about different things
                # (e.g., one says "revenue" and the other says "valuation")
                comp = compare_values(a.normalized_value, b.normalized_value)
                if comp["match_level"] in ("notable", "significant"):
                    issue_id += 1
                    issues.append(ConsistencyIssue(
                        id=f"ci-{issue_id}",
                        issue_type="duplicate_metric_mismatch",
                        severity="high" if comp["match_level"] == "significant" else "medium",
                        fact_ids=[a.id, b.id],
                        description=f"Same metric ({a.category.value}) reported as {a.raw_text} and {b.raw_text} — {comp['assessment']}",
                        expected_value=a.normalized_value,
                        actual_value=b.normalized_value,
                        discrepancy_pct=comp.get("abs_pct_diff"),
                        location=f"Positions {a.location_in_doc} and {b.location_in_doc}",
                    ))

    # --- Check 2: Margin consistency (margin ≈ profit / revenue) ---
    margin_facts = [f for f in facts if f.category == MetricCategory.MARGIN and f.unit == NumericUnit.PERCENT]
    revenue_facts = [f for f in facts if f.category == MetricCategory.REVENUE and f.unit == NumericUnit.USD]
    profit_categories = [MetricCategory.GROSS_PROFIT, MetricCategory.OPERATING_INCOME, MetricCategory.NET_INCOME, MetricCategory.EBITDA]

    for mf in margin_facts:
        # Try to find matching revenue and profit for the same period
        matching_revenue = [r for r in revenue_facts if r.period_label == mf.period_label and r.entity == mf.entity]
        if not matching_revenue:
            continue
        rev = matching_revenue[0]

        for cat in profit_categories:
            profit_facts = [f for f in facts if f.category == cat and f.period_label == mf.period_label and f.entity == mf.entity and f.unit == NumericUnit.USD]
            if not profit_facts:
                continue
            prof = profit_facts[0]

            # Check if margin context matches this profit type
            margin_context = mf.context_sentence.lower()
            cat_name = cat.value.replace("_", " ")
            if cat_name not in margin_context and cat.value not in margin_context:
                continue

            expected_margin = compute_margin(prof.normalized_value, rev.normalized_value)
            if expected_margin is not None:
                comp = compare_values(mf.value, expected_margin)
                if comp["match_level"] in ("notable", "significant"):
                    issue_id += 1
                    issues.append(ConsistencyIssue(
                        id=f"ci-{issue_id}",
                        issue_type="margin_math_error",
                        severity="high",
                        fact_ids=[mf.id, prof.id, rev.id],
                        description=f"Stated {cat_name} margin of {mf.value}% but {prof.raw_text} / {rev.raw_text} = {expected_margin:.1f}%",
                        expected_value=expected_margin,
                        actual_value=mf.value,
                        discrepancy_pct=comp.get("abs_pct_diff"),
                    ))

    # --- Check 3: Valuation multiple consistency ---
    multiple_facts = [f for f in facts if f.category == MetricCategory.VALUATION_MULTIPLE and f.unit == NumericUnit.MULTIPLE]
    ev_facts = [f for f in facts if f.category in (MetricCategory.ENTERPRISE_VALUE, MetricCategory.MARKET_CAP) and f.unit == NumericUnit.USD]

    for mult in multiple_facts:
        ctx = mult.context_sentence.lower()
        # Determine what metric the multiple is based on
        if "revenue" in ctx or "sales" in ctx:
            base_facts = revenue_facts
        elif "ebitda" in ctx:
            base_facts = [f for f in facts if f.category == MetricCategory.EBITDA and f.unit == NumericUnit.USD]
        elif "earnings" in ctx or "p/e" in ctx:
            base_facts = [f for f in facts if f.category == MetricCategory.NET_INCOME and f.unit == NumericUnit.USD]
        else:
            continue

        matching_ev = [e for e in ev_facts if e.entity == mult.entity]
        matching_base = [b for b in base_facts if b.entity == mult.entity]

        if matching_ev and matching_base:
            ev_val = matching_ev[0].normalized_value
            base_val = matching_base[0].normalized_value
            if base_val != 0:
                expected_mult = ev_val / base_val
                comp = compare_values(mult.value, expected_mult)
                if comp["match_level"] in ("notable", "significant"):
                    issue_id += 1
                    issues.append(ConsistencyIssue(
                        id=f"ci-{issue_id}",
                        issue_type="multiple_math_error",
                        severity="high" if comp["match_level"] == "significant" else "medium",
                        fact_ids=[mult.id, matching_ev[0].id, matching_base[0].id],
                        description=f"Stated {mult.value}x multiple but {matching_ev[0].raw_text} / {matching_base[0].raw_text} = {expected_mult:.1f}x",
                        expected_value=expected_mult,
                        actual_value=mult.value,
                        discrepancy_pct=comp.get("abs_pct_diff"),
                    ))

    # --- Check 4: Growth rate consistency ---
    growth_facts = [f for f in facts if f.category == MetricCategory.GROWTH_RATE and f.unit == NumericUnit.PERCENT]
    for gf in growth_facts:
        ctx = gf.context_sentence.lower()
        # Try to find the base metric this growth refers to
        for cat in [MetricCategory.REVENUE, MetricCategory.NET_INCOME, MetricCategory.ARR, MetricCategory.CUSTOMER_COUNT]:
            cat_name = cat.value.replace("_", " ")
            if cat_name not in ctx and cat.value not in ctx:
                continue
            # Find two periods of this metric for the same entity
            cat_facts = [f for f in facts if f.category == cat and f.entity == gf.entity and f.unit != NumericUnit.PERCENT]
            if len(cat_facts) >= 2:
                # Sort by period label (rough chronological)
                sorted_facts = sorted(cat_facts, key=lambda x: x.period_label)
                older, newer = sorted_facts[0], sorted_facts[-1]
                if older.normalized_value != 0:
                    expected_growth = compute_growth_rate(older.normalized_value, newer.normalized_value)
                    if expected_growth is not None:
                        comp = compare_values(gf.value, expected_growth)
                        if comp["match_level"] in ("notable", "significant"):
                            issue_id += 1
                            issues.append(ConsistencyIssue(
                                id=f"ci-{issue_id}",
                                issue_type="growth_rate_math_error",
                                severity="high",
                                fact_ids=[gf.id, older.id, newer.id],
                                description=f"Stated {cat_name} growth of {gf.value}% but {older.raw_text} → {newer.raw_text} = {expected_growth:.1f}%",
                                expected_value=expected_growth,
                                actual_value=gf.value,
                                discrepancy_pct=comp.get("abs_pct_diff"),
                            ))

    return issues


# ---------------------------------------------------------------------------
# Number Dependency Graph
# ---------------------------------------------------------------------------

def build_dependency_graph(facts: List[FinancialFact]) -> List[NumberDependency]:
    """Build a dependency graph showing how base numbers propagate through a document.

    Identifies relationships like:
    - Revenue × Multiple = Valuation
    - Profit / Revenue = Margin
    - (Current - Prior) / Prior = Growth Rate
    - Revenue × Margin = Profit
    """
    dependencies: List[NumberDependency] = []

    # Index facts by category for quick lookup
    by_category: Dict[str, List[FinancialFact]] = {}
    for f in facts:
        by_category.setdefault(f.category.value, []).append(f)

    # Revenue → Margin → Profit chain
    for rev in by_category.get("revenue", []):
        for margin in by_category.get("margin", []):
            if margin.entity == rev.entity and margin.period_label == rev.period_label:
                dependencies.append(NumberDependency(
                    source_fact_id=rev.id,
                    derived_fact_id=margin.id,
                    relationship="margin_of",
                    description=f"Margin ({margin.raw_text}) is derived from revenue ({rev.raw_text})",
                ))
                # Check if there's a corresponding profit
                for cat in ["gross_profit", "operating_income", "net_income", "ebitda"]:
                    for prof in by_category.get(cat, []):
                        if prof.entity == rev.entity and prof.period_label == rev.period_label:
                            dependencies.append(NumberDependency(
                                source_fact_id=rev.id,
                                derived_fact_id=prof.id,
                                relationship="multiplied_by",
                                description=f"{cat.replace('_', ' ').title()} ({prof.raw_text}) = Revenue ({rev.raw_text}) × Margin",
                            ))

    # Revenue → Multiple → Valuation chain
    for rev in by_category.get("revenue", []):
        for mult in by_category.get("valuation_multiple", []):
            if mult.entity == rev.entity:
                dependencies.append(NumberDependency(
                    source_fact_id=rev.id,
                    derived_fact_id=mult.id,
                    relationship="denominator_of",
                    description=f"Multiple ({mult.raw_text}) uses revenue ({rev.raw_text}) as denominator",
                ))
                for ev in by_category.get("enterprise_value", []) + by_category.get("market_cap", []):
                    if ev.entity == rev.entity:
                        dependencies.append(NumberDependency(
                            source_fact_id=mult.id,
                            derived_fact_id=ev.id,
                            relationship="multiplied_by",
                            description=f"Valuation ({ev.raw_text}) = Revenue ({rev.raw_text}) × Multiple ({mult.raw_text})",
                        ))

    # Growth rate dependencies
    for gf in by_category.get("growth_rate", []):
        # Find the base metric
        for cat_key, cat_facts in by_category.items():
            if cat_key in ("growth_rate", "margin", "other"):
                continue
            for base_fact in cat_facts:
                if base_fact.entity == gf.entity:
                    ctx = gf.context_sentence.lower()
                    cat_name = cat_key.replace("_", " ")
                    if cat_name in ctx or cat_key in ctx:
                        dependencies.append(NumberDependency(
                            source_fact_id=base_fact.id,
                            derived_fact_id=gf.id,
                            relationship="growth_from",
                            description=f"Growth rate ({gf.raw_text}) derived from {cat_name} ({base_fact.raw_text})",
                        ))

    return dependencies


def trace_downstream_impact(
    dependencies: List[NumberDependency],
    facts: List[FinancialFact],
    error_fact_id: str,
    correction_factor: float,
) -> List[Dict]:
    """Given an error in a base fact, trace all downstream impacts.

    Args:
        dependencies: The dependency graph
        facts: All extracted facts
        error_fact_id: ID of the fact that's wrong
        correction_factor: Ratio of correct/claimed value (e.g., 0.92 if overstated by 8%)

    Returns list of downstream facts that are affected, with corrected values.
    """
    fact_map = {f.id: f for f in facts}
    impacts: List[Dict] = []

    # BFS through dependency graph
    visited: Set[str] = set()
    queue = [(error_fact_id, correction_factor)]

    while queue:
        current_id, current_correction = queue.pop(0)
        if current_id in visited:
            continue
        visited.add(current_id)

        # Find all facts that depend on this one
        for dep in dependencies:
            if dep.source_fact_id == current_id and dep.derived_fact_id not in visited:
                derived = fact_map.get(dep.derived_fact_id)
                if not derived:
                    continue

                # Compute corrected value based on relationship type
                if dep.relationship in ("multiplied_by", "margin_of", "denominator_of"):
                    corrected_value = derived.normalized_value * current_correction
                elif dep.relationship == "growth_from":
                    # Growth rate changes are more complex — recompute
                    corrected_value = derived.value  # Simplified; would need both periods
                else:
                    corrected_value = derived.normalized_value * current_correction

                original_value = derived.normalized_value if derived.unit != NumericUnit.PERCENT else derived.value
                new_value = corrected_value

                impacts.append({
                    "fact_id": derived.id,
                    "raw_text": derived.raw_text,
                    "category": derived.category.value,
                    "original_value": original_value,
                    "corrected_value": round(new_value, 4),
                    "impact_pct": round((1 - current_correction) * 100, 2),
                    "relationship": dep.relationship,
                    "description": dep.description,
                    "context": derived.context_sentence[:200],
                })

                queue.append((dep.derived_fact_id, current_correction))

    return impacts


# ---------------------------------------------------------------------------
# Methodology Consistency Detection
# ---------------------------------------------------------------------------

def detect_methodology_inconsistencies(facts: List[FinancialFact]) -> List[ConsistencyIssue]:
    """Detect methodology inconsistencies within a document.

    Catches:
    1. Mixing LTM and NTM in the same comparison table
    2. Mixing GAAP and non-GAAP for different entities in the same analysis
    3. Using different fiscal year ends without adjustment
    4. Comparing annual figures with quarterly figures
    """
    issues: List[ConsistencyIssue] = []
    issue_id = 0

    # --- Check 1: Mixed period types for same metric across entities ---
    # Group by (category, unit) — these are likely in the same table/comparison
    comparison_groups: Dict[str, List[FinancialFact]] = {}
    for f in facts:
        if f.category == MetricCategory.OTHER or f.period_type == PeriodType.UNKNOWN:
            continue
        key = f"{f.category.value}|{f.unit.value}"
        comparison_groups.setdefault(key, []).append(f)

    for key, group in comparison_groups.items():
        if len(group) < 2:
            continue

        # Check for mixed period types
        period_types = set(f.period_type for f in group if f.period_type != PeriodType.UNKNOWN)
        if len(period_types) > 1:
            # This is a real issue — e.g., LTM for one company, NTM for another
            entities_by_period: Dict[str, List[str]] = {}
            for f in group:
                entities_by_period.setdefault(f.period_type.value, []).append(f.entity or f.raw_text)

            if PeriodType.LTM in period_types and PeriodType.NTM in period_types:
                severity = "high"
            elif PeriodType.ANNUAL in period_types and PeriodType.QUARTERLY in period_types:
                severity = "high"
            else:
                severity = "medium"

            issue_id += 1
            period_str = ", ".join(f"{pt}: {', '.join(ents[:2])}" for pt, ents in entities_by_period.items())
            issues.append(ConsistencyIssue(
                id=f"mi-{issue_id}",
                issue_type="mixed_period_types",
                severity=severity,
                fact_ids=[f.id for f in group],
                description=f"Mixed period types in {key.split('|')[0].replace('_', ' ')} comparison: {period_str}. Comparing LTM with NTM or annual with quarterly invalidates the analysis.",
            ))

        # Check for mixed accounting basis
        bases = set(f.accounting_basis for f in group if f.accounting_basis != AccountingBasis.UNKNOWN)
        if len(bases) > 1:
            entities_by_basis: Dict[str, List[str]] = {}
            for f in group:
                if f.accounting_basis != AccountingBasis.UNKNOWN:
                    entities_by_basis.setdefault(f.accounting_basis.value, []).append(f.entity or f.raw_text)

            issue_id += 1
            basis_str = ", ".join(f"{b}: {', '.join(ents[:2])}" for b, ents in entities_by_basis.items())
            issues.append(ConsistencyIssue(
                id=f"mi-{issue_id}",
                issue_type="mixed_accounting_basis",
                severity="high",
                fact_ids=[f.id for f in group],
                description=f"Mixed accounting basis in {key.split('|')[0].replace('_', ' ')} comparison: {basis_str}. Comparing GAAP with non-GAAP figures across entities is methodologically invalid.",
            ))

    return issues


# ---------------------------------------------------------------------------
# Multi-Period XBRL Temporal Series
# ---------------------------------------------------------------------------

@dataclass
class XBRLDataPoint:
    """A single XBRL observation for a metric."""
    metric_key: str
    value: float
    period_end: str       # YYYY-MM-DD
    period_start: str     # YYYY-MM-DD
    form: str             # 10-K, 10-Q
    filed: str            # Filing date
    is_quarterly: bool
    accession: str = ""

    def duration_days(self) -> int:
        from datetime import datetime
        try:
            start = datetime.strptime(self.period_start, "%Y-%m-%d")
            end = datetime.strptime(self.period_end, "%Y-%m-%d")
            return (end - start).days
        except (ValueError, TypeError):
            return 0


@dataclass
class TemporalSeries:
    """A time series of XBRL data points for a single metric."""
    metric_key: str
    entity_name: str
    ticker: str
    data_points: List[XBRLDataPoint] = field(default_factory=list)

    def annual_points(self) -> List[XBRLDataPoint]:
        return sorted([dp for dp in self.data_points if not dp.is_quarterly], key=lambda x: x.period_end)

    def quarterly_points(self) -> List[XBRLDataPoint]:
        return sorted([dp for dp in self.data_points if dp.is_quarterly], key=lambda x: x.period_end)

    def latest(self) -> Optional[XBRLDataPoint]:
        if not self.data_points:
            return None
        return sorted(self.data_points, key=lambda x: x.period_end)[-1]

    def compute_yoy_growth(self) -> List[Dict]:
        """Compute year-over-year growth rates from annual data points."""
        annual = self.annual_points()
        growths = []
        for i in range(1, len(annual)):
            prev, curr = annual[i - 1], annual[i]
            if prev.value != 0:
                growth = ((curr.value - prev.value) / abs(prev.value)) * 100
                growths.append({
                    "period": curr.period_end,
                    "prior_period": prev.period_end,
                    "current_value": curr.value,
                    "prior_value": prev.value,
                    "growth_pct": round(growth, 2),
                })
        return growths

    def compute_qoq_growth(self) -> List[Dict]:
        """Compute quarter-over-quarter growth rates."""
        quarterly = self.quarterly_points()
        growths = []
        for i in range(1, len(quarterly)):
            prev, curr = quarterly[i - 1], quarterly[i]
            if prev.value != 0:
                growth = ((curr.value - prev.value) / abs(prev.value)) * 100
                growths.append({
                    "period": curr.period_end,
                    "prior_period": prev.period_end,
                    "current_value": curr.value,
                    "prior_value": prev.value,
                    "growth_pct": round(growth, 2),
                })
        return growths

    def compute_cagr(self, years: Optional[int] = None) -> Optional[float]:
        """Compute CAGR over the full series or specified years."""
        annual = self.annual_points()
        if len(annual) < 2:
            return None
        if years:
            # Use last N+1 points
            annual = annual[-(years + 1):]
        start_val = annual[0].value
        end_val = annual[-1].value
        n_years = len(annual) - 1
        return compute_cagr(start_val, end_val, n_years)

    def detect_restatements(self) -> List[Dict]:
        """Detect restatements: same period reported differently across filings.

        A restatement occurs when the same metric for the same period end date
        appears with different values in different filings (e.g., Q1 revenue
        in the Q1 10-Q vs. the annual 10-K).
        """
        restatements = []
        # Group by period_end
        by_period: Dict[str, List[XBRLDataPoint]] = {}
        for dp in self.data_points:
            by_period.setdefault(dp.period_end, []).append(dp)

        for period, points in by_period.items():
            if len(points) < 2:
                continue
            # Compare values across different filings
            for i in range(len(points)):
                for j in range(i + 1, len(points)):
                    a, b = points[i], points[j]
                    if a.form == b.form and a.accession == b.accession:
                        continue  # Same filing, skip
                    if a.value == b.value:
                        continue  # Same value, no restatement
                    comp = compare_values(a.value, b.value)
                    if comp["match_level"] in ("notable", "significant"):
                        restatements.append({
                            "period": period,
                            "metric": self.metric_key,
                            "filing_a": {"form": a.form, "filed": a.filed, "value": a.value, "accession": a.accession},
                            "filing_b": {"form": b.form, "filed": b.filed, "value": b.value, "accession": b.accession},
                            "discrepancy_pct": comp.get("abs_pct_diff"),
                            "assessment": comp["assessment"],
                            "severity": "critical" if comp["match_level"] == "significant" else "high",
                        })

        return restatements

    def to_dict(self) -> Dict:
        return {
            "metric_key": self.metric_key,
            "entity_name": self.entity_name,
            "ticker": self.ticker,
            "data_points": [asdict(dp) for dp in self.data_points],
            "annual_count": len(self.annual_points()),
            "quarterly_count": len(self.quarterly_points()),
        }


def build_temporal_series_from_xbrl(
    us_gaap: Dict,
    metric_key: str,
    entity_name: str = "",
    ticker: str = "",
    max_points: int = 20,
) -> TemporalSeries:
    """Build a TemporalSeries from raw XBRL us-gaap data.

    Pulls all available data points for a metric, classifies them as
    annual or quarterly based on duration, and returns a structured series.
    """
    series = TemporalSeries(metric_key=metric_key, entity_name=entity_name, ticker=ticker)

    if metric_key not in us_gaap:
        return series

    entries = us_gaap[metric_key].get("units", {}).get("USD", [])
    if not entries:
        # Try shares or pure number
        entries = us_gaap[metric_key].get("units", {}).get("shares", [])
    if not entries:
        entries = us_gaap[metric_key].get("units", {}).get("pure", [])
    if not entries:
        return series

    # Filter to entries with both start and end dates
    valid_entries = [
        e for e in entries
        if isinstance(e, dict) and e.get("val") is not None and e.get("end") and e.get("start")
    ]

    # Sort by end date descending, take most recent
    valid_entries.sort(key=lambda x: x.get("end", ""), reverse=True)
    valid_entries = valid_entries[:max_points]

    for e in valid_entries:
        start = e.get("start", "")
        end = e.get("end", "")
        form = e.get("form", "")
        filed = e.get("filed", "")
        accn = e.get("accn", "")
        val = e["val"]

        # Classify as quarterly or annual based on duration
        try:
            from datetime import datetime
            start_dt = datetime.strptime(start, "%Y-%m-%d")
            end_dt = datetime.strptime(end, "%Y-%m-%d")
            duration = (end_dt - start_dt).days
            is_quarterly = duration < 120  # Less than ~4 months
        except (ValueError, TypeError):
            is_quarterly = "Q" in form.upper()

        series.data_points.append(XBRLDataPoint(
            metric_key=metric_key,
            value=float(val),
            period_end=end,
            period_start=start,
            form=form,
            filed=filed,
            is_quarterly=is_quarterly,
            accession=accn,
        ))

    return series


def build_multi_metric_series(
    us_gaap: Dict,
    entity_name: str = "",
    ticker: str = "",
) -> Dict[str, TemporalSeries]:
    """Build temporal series for all key financial metrics from XBRL data."""
    key_metrics = [
        "Revenues", "RevenueFromContractWithCustomerExcludingAssessedTax",
        "GrossProfit", "NetIncomeLoss", "OperatingIncomeLoss",
        "EarningsPerShareBasic", "EarningsPerShareDiluted",
        "Assets", "StockholdersEquity", "CostOfGoodsAndServicesSold",
        "CommonStockSharesOutstanding", "LongTermDebt",
        "CashAndCashEquivalentsAtCarryingValue",
        "OperatingExpenses", "ResearchAndDevelopmentExpense",
        "SellingGeneralAndAdministrativeExpense",
    ]

    series_map: Dict[str, TemporalSeries] = {}
    for mk in key_metrics:
        ts = build_temporal_series_from_xbrl(us_gaap, mk, entity_name, ticker)
        if ts.data_points:
            series_map[mk] = ts

    return series_map


def verify_growth_claim_against_xbrl(
    claimed_growth_pct: float,
    series: TemporalSeries,
    period_label: str = "",
) -> Dict:
    """Verify a claimed growth rate against actual XBRL multi-period data.

    Returns deterministic comparison — no LLM involved.
    """
    yoy_growths = series.compute_yoy_growth()
    if not yoy_growths:
        return {
            "verified": False,
            "reason": "Insufficient XBRL data points to compute growth rate",
            "data_points_available": len(series.data_points),
        }

    # Find the most relevant growth period
    # If period_label specified, try to match
    best_match = None
    if period_label:
        for g in yoy_growths:
            if period_label in g["period"] or period_label in g.get("prior_period", ""):
                best_match = g
                break

    if not best_match:
        best_match = yoy_growths[-1]  # Most recent

    actual_growth = best_match["growth_pct"]
    comparison = compare_values(claimed_growth_pct, actual_growth)

    return {
        "verified": True,
        "claimed_growth_pct": claimed_growth_pct,
        "actual_growth_pct": actual_growth,
        "period": best_match["period"],
        "prior_period": best_match["prior_period"],
        "current_value": best_match["current_value"],
        "prior_value": best_match["prior_value"],
        "comparison": comparison,
        "all_growth_rates": yoy_growths,
        "cagr_3yr": series.compute_cagr(3),
        "cagr_5yr": series.compute_cagr(5),
    }


def detect_all_restatements(series_map: Dict[str, TemporalSeries]) -> List[Dict]:
    """Scan all metric series for restatements."""
    all_restatements = []
    for metric_key, series in series_map.items():
        restatements = series.detect_restatements()
        for r in restatements:
            r["metric_key"] = metric_key
            r["entity"] = series.entity_name
            r["ticker"] = series.ticker
        all_restatements.extend(restatements)
    return all_restatements
