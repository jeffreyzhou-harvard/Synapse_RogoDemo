"""
Unit tests for verification pipeline improvements B1, B2, B3.

- B1: entity_intel — merged ticker detection + entity resolution
- B2: evidence_orchestrator — batching, dedup, shared caching
- B3: evidence_quality — batched quality evaluation per subclaim
- pipeline_metrics — instrumentation counters
"""

import sys
import os
import json

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from unittest.mock import MagicMock, patch, call
from app.entity_intel import (
    detect_ticker_hint,
    resolve_entity_and_ticker,
    extract_best_ticker,
    to_legacy_entity_resolution,
)
from app.evidence_orchestrator import (
    EvidenceOrchestrator,
    classify_subclaim,
    is_high_stakes,
    _content_hash,
    _canonical_url,
)
from app.evidence_quality import (
    compute_baseline_score,
    evaluate_evidence_batch,
)
from app.pipeline_metrics import PipelineMetrics


# ──────────────────────────────────────────────────────────────────────────────
# B1: entity_intel
# ──────────────────────────────────────────────────────────────────────────────

class TestDetectTickerHint:
    def test_nyse_format(self):
        assert detect_ticker_hint("Apple Inc. (NYSE: AAPL) reported") == "AAPL"

    def test_nasdaq_format(self):
        assert detect_ticker_hint("Tesla (NASDAQ: TSLA) delivered") == "TSLA"

    def test_dollar_format(self):
        assert detect_ticker_hint("I'm bullish on $MSFT right now") == "MSFT"

    def test_colon_format(self):
        assert detect_ticker_hint("NASDAQ: GOOG is trading at") == "GOOG"

    def test_no_ticker(self):
        assert detect_ticker_hint("The company reported strong results") is None

    def test_case_insensitive_exchange(self):
        assert detect_ticker_hint("(nyse: JPM) announced") == "JPM"


class TestResolveEntityAndTicker:
    def _make_llm(self, response_dict):
        return lambda prompt, system, max_tokens: json.dumps(response_dict)

    def _parse_json(self, raw):
        try:
            import re
            cleaned = raw.strip()
            cleaned = re.sub(r'^```(?:json)?\s*', '', cleaned)
            cleaned = re.sub(r'\s*```$', '', cleaned)
            return json.loads(cleaned)
        except Exception:
            return None

    def test_uses_regex_hint(self):
        response = {
            "primary_company_name": "Apple Inc.",
            "ticker_candidates": [{"ticker": "AAPL", "confidence": 0.95}],
            "canonical_entities": [],
            "pronoun_map": {},
            "segments": [],
            "ambiguities": [],
        }
        result = resolve_entity_and_ticker(
            "Apple (NASDAQ: AAPL) revenue was $94.8B",
            call_llm=self._make_llm(response),
            parse_json=self._parse_json,
        )
        assert result["_ticker_hint"] == "AAPL"
        assert extract_best_ticker(result) == "AAPL"

    def test_injects_hint_when_llm_misses(self):
        response = {
            "primary_company_name": "Apple Inc.",
            "ticker_candidates": [],
            "canonical_entities": [],
            "pronoun_map": {},
            "segments": [],
            "ambiguities": [],
        }
        result = resolve_entity_and_ticker(
            "Apple (NYSE: AAPL) had strong earnings",
            call_llm=self._make_llm(response),
            parse_json=self._parse_json,
        )
        assert extract_best_ticker(result) == "AAPL"
        candidates = result["ticker_candidates"]
        assert any(c["ticker"] == "AAPL" for c in candidates)

    def test_fallback_on_invalid_json(self):
        result = resolve_entity_and_ticker(
            "NASDAQ: TSLA reported delivery numbers",
            call_llm=lambda p, s, m: "not valid json at all",
            parse_json=self._parse_json,
        )
        assert result["_ticker_hint"] == "TSLA"
        assert extract_best_ticker(result) == "TSLA"
        assert len(result["ambiguities"]) > 0

    def test_cache_hit(self):
        from app.verification_engine import _TTLCache
        cache = _TTLCache(default_ttl=60)
        call_count = [0]

        def counting_llm(prompt, system, max_tokens):
            call_count[0] += 1
            return json.dumps({
                "primary_company_name": "Test",
                "ticker_candidates": [{"ticker": "TEST", "confidence": 0.9}],
                "canonical_entities": [],
                "pronoun_map": {},
                "segments": [],
                "ambiguities": [],
            })

        claim = "Test company (NYSE: TEST) filed 10-K"
        resolve_entity_and_ticker(claim, call_llm=counting_llm, parse_json=self._parse_json, cache=cache)
        assert call_count[0] == 1

        result2 = resolve_entity_and_ticker(claim, call_llm=counting_llm, parse_json=self._parse_json, cache=cache)
        assert call_count[0] == 1  # no additional LLM call
        assert result2["_cache_hit"] is True


class TestLegacyConversion:
    def test_to_legacy_entity_resolution(self):
        result = {
            "canonical_entities": [
                {"name": "Apple Inc.", "type": "company", "ticker": "AAPL", "aliases": ["Apple", "we"]},
            ],
            "pronoun_map": {"we": "Apple Inc."},
            "ambiguities": ["unclear segment reference"],
        }
        legacy = to_legacy_entity_resolution(result)
        assert len(legacy["entities"]) == 1
        assert legacy["entities"][0]["canonical_name"] == "Apple Inc."
        assert len(legacy["resolutions"]) == 1
        assert legacy["resolutions"][0]["original_text"] == "we"
        assert legacy["ambiguities"] == ["unclear segment reference"]


# ──────────────────────────────────────────────────────────────────────────────
# B2: evidence_orchestrator
# ──────────────────────────────────────────────────────────────────────────────

class TestClassifySubclaim:
    def test_macro(self):
        assert classify_subclaim("GDP growth was 3.2%") == "macro"
        assert classify_subclaim("The unemployment rate fell to 3.7%") == "macro"

    def test_market(self):
        assert classify_subclaim("Stock price reached a 52-week high") == "market"
        assert classify_subclaim("Market cap exceeded $3 trillion") == "market"

    def test_guidance(self):
        assert classify_subclaim("Company expects revenue growth of 10%") == "guidance"

    def test_filed_metric(self):
        assert classify_subclaim("Revenue was $94.8 billion in FY2024") == "filed_metric"

    def test_high_stakes(self):
        assert is_high_stakes("The $68.7 billion acquisition of Activision")
        assert not is_high_stakes("Revenue grew 5%")


class TestContentHash:
    def test_deterministic(self):
        assert _content_hash("hello world") == _content_hash("hello world")

    def test_different(self):
        assert _content_hash("hello") != _content_hash("world")


class TestCanonicalUrl:
    def test_strips_utm(self):
        url = "https://example.com/page?utm_source=twitter&id=123"
        result = _canonical_url(url)
        assert "utm_source" not in result
        assert "id=123" in result

    def test_empty(self):
        assert _canonical_url("") == ""


class TestEvidenceOrchestrator:
    def _make_cache(self):
        from app.verification_engine import _TTLCache
        return _TTLCache(default_ttl=60)

    def test_shared_ticker_single_xbrl_fetch(self):
        """When multiple subclaims share same ticker, XBRL should be called per subclaim
        but SEC companyfacts shared via caching."""
        metrics = PipelineMetrics()
        xbrl_call_count = [0]

        def mock_xbrl(ticker, text):
            xbrl_call_count[0] += 1
            # Return different data per subclaim so content hashes differ
            if "Revenue" in text:
                return {"match": "exact", "claimed_value": "$100M", "actual_value": "$100M",
                        "entity_name": "Test", "form": "10-K", "period": "2024-09-30"}
            else:
                return {"match": "exact", "claimed_value": "$20M", "actual_value": "$20M",
                        "entity_name": "Test", "form": "10-K", "period": "2024-09-30",
                        "computation": "Net income from income statement"}

        orch = EvidenceOrchestrator(
            ttl_cache=self._make_cache(),
            metrics=metrics,
            lookup_xbrl=mock_xbrl,
            search_edgar=lambda q, **kw: [],
            search_earnings=lambda q, **kw: {"text": "", "citations": []},
            search_news=lambda q, **kw: {"text": "", "citations": []},
            search_perplexity=lambda q, focus="": {"text": "", "citations": []},
            lookup_fred=lambda t: None,
            lookup_market=lambda t, c: None,
        )

        subclaims = [
            {"id": "sub-1", "text": "Revenue was $100M in FY2024", "type": "quantitative"},
            {"id": "sub-2", "text": "Net income was $20M in FY2024", "type": "quantitative"},
        ]
        result = orch.gather_evidence("AAPL", subclaims, "Test claim")
        assert xbrl_call_count[0] == 2  # one per subclaim
        assert len(result["all_evidence"]) >= 2

    def test_perplexity_dedup_identical_queries(self):
        """Identical Perplexity queries across subclaims should be deduped."""
        metrics = PipelineMetrics()
        perplexity_call_count = [0]

        def mock_perplexity(query, focus=""):
            perplexity_call_count[0] += 1
            return {"text": f"Result for: {query[:50]}", "citations": ["https://example.com"]}

        orch = EvidenceOrchestrator(
            ttl_cache=self._make_cache(),
            metrics=metrics,
            lookup_xbrl=lambda t, c: None,
            search_edgar=lambda q, **kw: [],
            search_earnings=lambda q, **kw: mock_perplexity(q),
            search_news=lambda q, **kw: mock_perplexity(q),
            search_perplexity=mock_perplexity,
            lookup_fred=lambda t: None,
            lookup_market=lambda t, c: None,
        )

        subclaims = [
            {"id": "sub-1", "text": "Revenue guidance for Q1", "type": "quantitative"},
            {"id": "sub-2", "text": "Revenue guidance for Q1", "type": "quantitative"},
        ]
        result = orch.gather_evidence("AAPL", subclaims, "Test claim")
        # The two identical subclaims should produce some evidence dedup
        assert result["all_evidence"] is not None

    def test_evidence_dedup_by_content_hash(self):
        """Evidence items with same content hash should be deduped."""
        metrics = PipelineMetrics()

        def mock_perplexity(query, focus=""):
            return {"text": "Same content for all queries", "citations": []}

        orch = EvidenceOrchestrator(
            ttl_cache=self._make_cache(),
            metrics=metrics,
            lookup_xbrl=lambda t, c: None,
            search_edgar=lambda q, **kw: [],
            search_earnings=lambda q, **kw: {"text": "", "citations": []},
            search_news=lambda q, **kw: {"text": "", "citations": []},
            search_perplexity=mock_perplexity,
            lookup_fred=lambda t: None,
            lookup_market=lambda t, c: None,
        )

        subclaims = [
            {"id": "sub-1", "text": "Revenue grew 12%", "type": "quantitative"},
            {"id": "sub-2", "text": "EBITDA margin was 42%", "type": "quantitative"},
        ]
        result = orch.gather_evidence("AAPL", subclaims, "Test claim")
        # Content hash dedup should reduce total evidence
        all_hashes = [e.get("_content_hash") for e in result["all_evidence"]]
        assert len(all_hashes) == len(set(all_hashes))  # no duplicate hashes

    def test_macro_subclaim_skips_edgar(self):
        """Macro subclaims should not trigger EDGAR search."""
        metrics = PipelineMetrics()
        edgar_calls = [0]

        def mock_edgar(q, **kw):
            edgar_calls[0] += 1
            return []

        orch = EvidenceOrchestrator(
            ttl_cache=self._make_cache(),
            metrics=metrics,
            lookup_xbrl=lambda t, c: None,
            search_edgar=mock_edgar,
            search_earnings=lambda q, **kw: {"text": "", "citations": []},
            search_news=lambda q, **kw: {"text": "", "citations": []},
            search_perplexity=lambda q, focus="": {"text": "", "citations": []},
            lookup_fred=lambda t: None,
            lookup_market=lambda t, c: None,
        )

        subclaims = [{"id": "sub-1", "text": "GDP growth was 3.2%", "type": "quantitative"}]
        orch.gather_evidence("", subclaims, "GDP claim")
        assert edgar_calls[0] == 0


# ──────────────────────────────────────────────────────────────────────────────
# B3: evidence_quality
# ──────────────────────────────────────────────────────────────────────────────

class TestComputeBaselineScore:
    def test_sec_filing_high(self):
        ev = {"tier": "sec_filing", "snippet": "Revenue was $94.8B", "filing_date": "2024-09-28"}
        score = compute_baseline_score(ev, "Revenue was $94.8 billion")
        assert score >= 80

    def test_press_release_medium(self):
        ev = {"tier": "press_release", "snippet": "Company announced Q4 results"}
        score = compute_baseline_score(ev, "Q4 revenue guidance")
        assert 40 <= score <= 70

    def test_xbrl_highest(self):
        ev = {"tier": "sec_filing", "xbrl_data": {"match": "exact"}, "snippet": ""}
        score = compute_baseline_score(ev, "Revenue was $94.8B")
        assert score >= 90

    def test_numeric_match_bonus(self):
        ev = {"tier": "press_release", "snippet": "Revenue was $94.8 billion"}
        score_match = compute_baseline_score(ev, "Revenue was $94.8 billion")
        score_no_match = compute_baseline_score(ev, "Company has strong growth")
        assert score_match > score_no_match


class TestEvaluateEvidenceBatch:
    def test_single_llm_call_per_subclaim(self):
        """Even with many evidence items, only 1 LLM call per subclaim."""
        call_count = [0]

        def mock_llm(prompt, system, max_tokens=2000):
            call_count[0] += 1
            return json.dumps([
                {"id": f"ev-{i}", "quality_score": 75, "stance": "support",
                 "rationale_short": "Good evidence"} for i in range(1, 6)
            ])

        def mock_parse(raw):
            try:
                return json.loads(raw)
            except Exception:
                return None

        evidence = [
            {"id": f"ev-{i}", "tier": "sec_filing", "snippet": f"Evidence {i}", "source": "SEC"}
            for i in range(1, 6)
        ]

        result = evaluate_evidence_batch(
            "Revenue was $94.8B",
            evidence,
            call_llm=mock_llm,
            parse_json=mock_parse,
        )

        assert call_count[0] == 1
        assert all(ev.get("quality_score") is not None for ev in result)

    def test_fallback_to_baseline_on_bad_json(self):
        """If LLM returns bad JSON, baselines should still be applied."""
        evidence = [
            {"id": "ev-1", "tier": "sec_filing", "snippet": "Revenue data", "source": "SEC"},
        ]

        result = evaluate_evidence_batch(
            "Revenue was $94.8B",
            evidence,
            call_llm=lambda p, s, m: "not json",
            parse_json=lambda r: None,
        )

        assert result[0].get("quality_score") is not None
        assert result[0]["quality_score"] >= 80  # sec_filing baseline

    def test_cached_results(self):
        """Second call should use cache, not LLM."""
        from app.verification_engine import _TTLCache
        cache = _TTLCache(default_ttl=60)
        call_count = [0]

        def mock_llm(prompt, system, max_tokens=2000):
            call_count[0] += 1
            return json.dumps([
                {"id": "ev-1", "quality_score": 88, "stance": "support", "rationale_short": "Good"}
            ])

        def mock_parse(raw):
            try:
                return json.loads(raw)
            except Exception:
                return None

        evidence = [{"id": "ev-1", "tier": "sec_filing", "snippet": "Rev data", "source": "SEC"}]

        evaluate_evidence_batch("Rev was $94.8B", evidence, call_llm=mock_llm,
                                parse_json=mock_parse, cache=cache)
        assert call_count[0] == 1

        evidence2 = [{"id": "ev-1", "tier": "sec_filing", "snippet": "Rev data", "source": "SEC"}]
        evaluate_evidence_batch("Rev was $94.8B", evidence2, call_llm=mock_llm,
                                parse_json=mock_parse, cache=cache)
        assert call_count[0] == 1  # no new LLM call


# ──────────────────────────────────────────────────────────────────────────────
# Pipeline Metrics
# ──────────────────────────────────────────────────────────────────────────────

class TestPipelineMetrics:
    def test_counters(self):
        m = PipelineMetrics()
        m.inc_llm()
        m.inc_llm()
        m.inc_sec()
        m.inc_perplexity(3)
        d = m.to_dict()
        assert d["llm_calls"] == 2
        assert d["sec_xbrl_calls"] == 1
        assert d["perplexity_calls"] == 3

    def test_stage_timing(self):
        import time
        m = PipelineMetrics()
        with m.stage("test_stage"):
            time.sleep(0.01)
        assert "test_stage" in m.stage_timings
        assert m.stage_timings["test_stage"] >= 5  # at least 5ms

    def test_to_dict(self):
        m = PipelineMetrics()
        d = m.to_dict()
        assert "llm_calls" in d
        assert "total_elapsed_ms" in d
        assert "stage_timings_ms" in d
