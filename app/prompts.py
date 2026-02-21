"""
Synapse Verification Engine — Prompt Registry

All LLM prompts used by the verification pipeline, centralized for tuning.
Each prompt is a function that takes context variables and returns (user_prompt, system_prompt).
"""


# ---------------------------------------------------------------------------
# System Prompts (reusable across multiple calls)
# ---------------------------------------------------------------------------

SYSTEM_CLAIM_EXTRACTION = (
    "You are a precise financial claim extraction engine specializing in SEC filings, "
    "earnings data, CIMs, pitch decks, and market metrics. Extract every verifiable "
    "assertion. Return only valid JSON arrays."
)

SYSTEM_DECOMPOSITION = "You are a claim decomposition engine. Break claims into atomic verifiable parts."

SYSTEM_ENTITY_RESOLUTION = (
    "You are a financial entity resolution engine. Disambiguate company names, "
    "subsidiaries, segments, and pronouns in financial text."
)

SYSTEM_NORMALIZATION = (
    "You are a financial normalization engine. Standardize units, time periods, "
    "accounting definitions, and currency across financial claims. Flag ambiguities. "
    "This is critical for accurate cross-source comparison."
)

SYSTEM_EVIDENCE_EVALUATION = "You are an evidence quality evaluator. Be rigorous and precise."

SYSTEM_CONTRADICTION_DETECTION = (
    "You are a financial contradiction detection engine. Identify discrepancies "
    "between evidence sources with precision."
)

SYSTEM_CONSISTENCY_ANALYSIS = (
    "You are a forensic financial analyst specializing in cross-document consistency analysis. "
    "You detect subtle tensions between SEC filings, earnings calls, press releases, and CIMs. "
    "Focus on factual discrepancies, not stylistic differences."
)

SYSTEM_PLAUSIBILITY = (
    "You are a financial analyst specializing in forward-looking statement analysis. "
    "Evaluate projections against current financial data, historical trends, and industry benchmarks. "
    "Be rigorous \u2014 most forward-looking claims in CIMs and pitch decks are optimistic."
)

SYSTEM_VERDICT_SYNTHESIS = (
    "You are a rigorous financial fact-checking verdict synthesizer. "
    "Weight SEC filings highest. Be precise and evidence-based."
)

SYSTEM_VERDICT_OVERALL = "You are a fact-checking verdict synthesizer."

SYSTEM_PROVENANCE = "You are a misinformation provenance tracer. Reconstruct likely propagation paths."

SYSTEM_CORRECTION = "You are a precise fact-checking editor. Generate accurate corrected claims."

SYSTEM_RECONCILIATION = (
    "You are a senior fact-checker performing final verdict reconciliation. "
    "Your job is to determine whether the CORE CLAIM is true, even if sub-claims "
    "about minor details were only partially confirmed. Be practical \u2014 if the claim "
    "would not mislead a reasonable reader, it should be marked as true or essentially true."
)

SYSTEM_MATERIALITY = (
    "You are a financial materiality assessor for M&A due diligence. "
    "Determine whether claim errors are material to investment decisions. "
    "Be calibrated \u2014 not every error matters."
)

SYSTEM_RISK_SIGNALS = (
    "You are a senior due diligence analyst synthesizing verification findings into "
    "actionable risk signals for an M&A deal team or investment committee. "
    "Be direct, specific, and actionable. Focus on patterns, not individual errors."
)

SYSTEM_XBRL_LOOKUP = (
    "You are a financial data analyst. Identify exactly which XBRL metrics and "
    "periods to look up. Be precise with metric key names — use exactly the names "
    "shown in the available list."
)

SYSTEM_TICKER_DETECTION = "Return only a stock ticker symbol or NONE."

SYSTEM_PEER_LOOKUP = "Return only a JSON array of stock ticker symbols."

SYSTEM_CITATION_EXTRACTION = (
    "You are a citation extraction engine. Identify every source attribution "
    "in financial text. Be precise."
)

SYSTEM_CITATION_VERIFICATION = (
    "You are a citation verification engine. Compare cited claims against "
    "actual source evidence."
)


# ---------------------------------------------------------------------------
# Prompt Templates
# ---------------------------------------------------------------------------

def ticker_detection(claim_text: str) -> str:
    """Detect stock ticker from claim text."""
    return (
        f'What stock ticker (e.g. AAPL, MSFT, TSLA) does this claim reference? '
        f'Return ONLY the ticker symbol, or "NONE" if no specific company.\n\n'
        f'Claim: "{claim_text}"'
    )


def claim_extraction(text: str) -> str:
    """Extract verifiable financial claims from text."""
    return f"""Extract EVERY discrete, verifiable factual claim from this text. Be thorough — focus on financial and business claims that can be verified against SEC filings, earnings calls, market data, and third-party sources.

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


def decomposition(claim: str) -> str:
    """Break a claim into atomic sub-claims."""
    return f"""Break this claim into independently verifiable atomic sub-claims:

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


def xbrl_metric_identification(entity_name: str, claim_text: str, periods_str: str) -> str:
    """Identify which XBRL metrics and periods to look up for a claim."""
    return f"""Given this financial claim about {entity_name}, identify what to look up in SEC XBRL data.

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


def peer_lookup(ticker: str) -> str:
    """Find peer companies for benchmarking."""
    return f"""What are the 3-5 closest public company peers/competitors to {ticker}?
Consider: same industry, similar market cap range, similar business model.

Return ONLY a JSON array of ticker symbols: ["PEER1", "PEER2", "PEER3"]
Only include well-known public companies. Return ONLY valid JSON."""
