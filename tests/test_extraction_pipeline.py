"""
Unit tests for Sprint 1 claim extraction pipeline improvements.

Covers:
- text_chunking: normalize_text, chunk_text, deterministic chunk_ids
- passage_selector: score_paragraph, select_passages (boilerplate scored low)
- deduping: normalize_for_fingerprint, fingerprint, dedupe_claims
- extraction_cache: cache hit returns identical payload
- location validation: original matches span
"""

import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import json
import pytest
from app.text_chunking import normalize_text, chunk_text
from app.passage_selector import score_paragraph, select_passages
from app.deduping import normalize_for_fingerprint, fingerprint, dedupe_claims
from app.extraction_cache import doc_hash, cache_key, get_cached, set_cached


# ──────────────────────────────────────────────────────────────────────────────
# text_chunking
# ──────────────────────────────────────────────────────────────────────────────

class TestNormalizeText:
    def test_collapses_whitespace(self):
        assert normalize_text("hello   world") == "hello world"

    def test_normalizes_newlines(self):
        assert normalize_text("a\r\nb\rc") == "a\nb\nc"

    def test_collapses_excessive_newlines(self):
        result = normalize_text("a\n\n\n\n\nb")
        assert result == "a\n\nb"

    def test_strips(self):
        assert normalize_text("  hello  ") == "hello"


class TestChunkText:
    def test_deterministic_chunk_ids(self):
        text = "Para 1.\n\nPara 2.\n\nPara 3."
        chunks1 = chunk_text(text)
        chunks2 = chunk_text(text)
        assert [c["chunk_id"] for c in chunks1] == [c["chunk_id"] for c in chunks2]
        assert chunks1[0]["chunk_id"] == "c0000"

    def test_single_short_text(self):
        text = "Hello world."
        chunks = chunk_text(text)
        assert len(chunks) == 1
        assert chunks[0]["text"] == text
        assert chunks[0]["start_char_global"] == 0

    def test_splits_long_text(self):
        paragraphs = [f"Paragraph {i}. " + "x" * 200 for i in range(30)]
        text = "\n\n".join(paragraphs)
        chunks = chunk_text(text, max_chunk_chars=500, overlap_chars=50)
        assert len(chunks) > 1
        for c in chunks:
            assert c["chunk_id"].startswith("c")

    def test_empty_text(self):
        chunks = chunk_text("")
        assert len(chunks) == 1
        assert chunks[0]["chunk_id"] == "c0000"

    def test_chunk_ids_sequential(self):
        paragraphs = [f"P{i} " + "a" * 500 for i in range(10)]
        text = "\n\n".join(paragraphs)
        chunks = chunk_text(text, max_chunk_chars=600, overlap_chars=100)
        ids = [c["chunk_id"] for c in chunks]
        expected = [f"c{i:04d}" for i in range(len(ids))]
        assert ids == expected


# ──────────────────────────────────────────────────────────────────────────────
# passage_selector
# ──────────────────────────────────────────────────────────────────────────────

class TestScoreParagraph:
    def test_boilerplate_low(self):
        boilerplate = (
            "This report contains forward-looking statements within the meaning "
            "of the safe harbor provisions."
        )
        assert score_paragraph(boilerplate) < 0

    def test_financial_metric_high(self):
        metric = "Revenue was $94.8 billion in FY2024, representing a 12% increase year-over-year."
        assert score_paragraph(metric) > 3

    def test_short_text_penalized(self):
        assert score_paragraph("ok") < 0

    def test_table_row_bonus(self):
        row = "Revenue  |  $12,345  |  $11,200  |  $9,800  |  10.2%"
        assert score_paragraph(row) > 0

    def test_disclaimer_negative(self):
        disc = "All rights reserved. Copyright 2024. Disclaimer applies."
        assert score_paragraph(disc) < 0


class TestSelectPassages:
    def test_selects_relevant(self):
        chunks = [{
            "chunk_id": "c0000",
            "text": (
                "Revenue was $94.8 billion, up 12% YoY.\n\n"
                "This report contains forward-looking statements and safe harbor provisions.\n\n"
                "EBITDA margin expanded to 42.5% in Q3 2024.\n\n"
                "Net income grew 15% to $5.2 billion compared to prior year.\n\n"
                "All rights reserved. Copyright 2024. Disclaimer."
            ),
            "start_char_global": 0,
            "end_char_global": 300,
        }]
        passages = select_passages(chunks, max_passages=5)
        texts = [p["passage_text"] for p in passages]
        # Financial paragraphs should be selected
        assert any("Revenue" in t or "EBITDA" in t or "Net income" in t for t in texts)
        # Pure boilerplate should score low and likely not be selected as primary
        boilerplate_scores = [score_paragraph(t) for t in texts if "forward-looking" in t or "All rights" in t]
        financial_scores = [score_paragraph(t) for t in texts if "Revenue" in t or "EBITDA" in t]
        if financial_scores and boilerplate_scores:
            assert max(financial_scores) > max(boilerplate_scores)

    def test_empty_chunks(self):
        assert select_passages([], max_passages=5) == []


# ──────────────────────────────────────────────────────────────────────────────
# deduping
# ──────────────────────────────────────────────────────────────────────────────

class TestNormalizeForFingerprint:
    def test_lowercase(self):
        assert normalize_for_fingerprint("HELLO") == "hello"

    def test_strip_commas_in_numbers(self):
        assert "1000" in normalize_for_fingerprint("$1,000")

    def test_collapse_whitespace(self):
        assert "  " not in normalize_for_fingerprint("a   b")


class TestFingerprint:
    def test_same_text_same_fp(self):
        assert fingerprint("Revenue was $1,000") == fingerprint("Revenue was $1,000")

    def test_normalized_match(self):
        assert fingerprint("Revenue was $1,000.") == fingerprint("revenue was $1000.")

    def test_different_text_different_fp(self):
        assert fingerprint("Revenue was $1,000") != fingerprint("EBITDA was $500")


class TestDedupeClaims:
    def test_exact_dedup(self):
        claims = [
            {"original": "Revenue was $1,000", "normalized": "revenue was $1000", "type": "financial_metric", "_global_start": 0},
            {"original": "Revenue was $1,000.", "normalized": "revenue was $1000.", "type": "financial_metric", "_global_start": 500},
        ]
        result = dedupe_claims(claims)
        assert len(result) == 1

    def test_near_dup_same_bucket(self):
        claims = [
            {"original": "Apple revenue was $1,000 million in the fiscal year ended September 2024",
             "normalized": "Apple revenue was $1000 million in the fiscal year ended September 2024",
             "type": "financial_metric", "company_ticker": "AAPL", "_global_start": 0},
            {"original": "Apple revenue was $1,000 million in fiscal year ended September 2024",
             "normalized": "Apple revenue was $1000 million in fiscal year ended September 2024",
             "type": "financial_metric", "company_ticker": "AAPL", "_global_start": 500},
        ]
        result = dedupe_claims(claims)
        assert len(result) == 1

    def test_different_claims_kept(self):
        claims = [
            {"original": "Revenue was $1,000", "normalized": "revenue was $1000", "type": "financial_metric", "_global_start": 0},
            {"original": "EBITDA was $500", "normalized": "ebitda was $500", "type": "financial_metric", "_global_start": 100},
        ]
        result = dedupe_claims(claims)
        assert len(result) == 2

    def test_synthetic_overlap_example(self):
        """Claims from overlapping chunks should be deduped."""
        base = {"type": "financial_metric", "company_ticker": "AAPL"}
        claims = [
            {**base, "original": "Revenue grew 12% year-over-year to $94.8B", "normalized": "revenue grew 12% yoy to $94.8b", "_global_start": 100},
            {**base, "original": "Revenue grew 12% year-over-year to $94.8B", "normalized": "revenue grew 12% yoy to $94.8b", "_global_start": 2900},
            {**base, "original": "EBITDA margin was 42.5%", "normalized": "ebitda margin was 42.5%", "_global_start": 200},
        ]
        result = dedupe_claims(claims)
        assert len(result) == 2

    def test_empty_list(self):
        assert dedupe_claims([]) == []


# ──────────────────────────────────────────────────────────────────────────────
# extraction_cache
# ──────────────────────────────────────────────────────────────────────────────

class TestExtractionCache:
    def test_doc_hash_deterministic(self):
        assert doc_hash("hello world") == doc_hash("hello world")

    def test_doc_hash_normalizes(self):
        assert doc_hash("hello   world") == doc_hash("hello world")

    def test_cache_key_includes_version(self):
        key = cache_key("hello", "claude")
        assert "claude" in key
        assert "extract_claims:" in key

    def test_cache_round_trip(self):
        text = "unique test text for cache round trip 12345"
        claims = [{"id": "c1", "original": "test", "normalized": "test"}]
        set_cached(text, claims, model_id="test_model")
        result = get_cached(text, model_id="test_model")
        assert result == claims

    def test_cache_miss(self):
        result = get_cached("text that was never cached xyz abc 999")
        assert result is None


# ──────────────────────────────────────────────────────────────────────────────
# location validation
# ──────────────────────────────────────────────────────────────────────────────

class TestLocationValidation:
    def test_original_matches_span(self):
        """Simulate what extract_claims does: validate claim.original == chunk_text[start:end]."""
        chunk_text = "Revenue was $94.8 billion in FY2024. EBITDA margin was 42.5%."
        original = "Revenue was $94.8 billion in FY2024"
        start = chunk_text.find(original)
        end = start + len(original)
        assert chunk_text[start:end] == original

    def test_mismatch_triggers_fallback(self):
        """If LLM offsets are wrong, fallback to string find."""
        chunk_text = "Revenue was $94.8 billion in FY2024. EBITDA margin was 42.5%."
        original = "EBITDA margin was 42.5%"
        bad_start, bad_end = 0, 10
        span = chunk_text[bad_start:bad_end]
        assert span != original

        # Fallback
        idx = chunk_text.find(original)
        assert idx >= 0
        assert chunk_text[idx:idx + len(original)] == original
