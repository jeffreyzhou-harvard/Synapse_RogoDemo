"""
Tests for the URL ingestion improvements:
- A: URL canonicalization (url_utils)
- B: SQLite ingest cache (ingest_cache)
- C: Main-content extraction (content_extractor)
- D: Sonar fallback parsing (verification_engine._parse_sonar_excerpts)
"""

import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch, MagicMock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

FIXTURES = Path(__file__).resolve().parent / "fixtures"


# ===================================================================
# A: URL canonicalization
# ===================================================================

class TestCanonicalizeUrl(unittest.TestCase):

    def setUp(self):
        from app.url_utils import canonicalize_url
        self.canon = canonicalize_url

    def test_strips_utm_params(self):
        url = "https://example.com/article?utm_source=twitter&utm_medium=social&id=42"
        result = self.canon(url)
        self.assertNotIn("utm_source", result)
        self.assertNotIn("utm_medium", result)
        self.assertIn("id=42", result)

    def test_strips_fbclid(self):
        url = "https://news.site/post?fbclid=ABC123&page=1"
        result = self.canon(url)
        self.assertNotIn("fbclid", result)
        self.assertIn("page=1", result)

    def test_strips_gclid(self):
        url = "https://example.com/page?gclid=xyz789"
        result = self.canon(url)
        self.assertNotIn("gclid", result)
        self.assertEqual(result, "https://example.com/page")

    def test_lowercase_scheme_and_host(self):
        url = "HTTPS://WWW.Example.COM/Path/Page"
        result = self.canon(url)
        self.assertTrue(result.startswith("https://www.example.com/"))

    def test_removes_trailing_slash(self):
        url = "https://example.com/article/"
        result = self.canon(url)
        self.assertEqual(result, "https://example.com/article")

    def test_preserves_root_slash(self):
        url = "https://example.com/"
        result = self.canon(url)
        self.assertEqual(result, "https://example.com/")

    def test_preserves_non_tracking_params(self):
        url = "https://example.com/search?q=earnings&year=2025"
        result = self.canon(url)
        self.assertIn("q=earnings", result)
        self.assertIn("year=2025", result)

    def test_strips_mc_cid_mc_eid(self):
        url = "https://example.com/page?mc_cid=abc&mc_eid=def&important=1"
        result = self.canon(url)
        self.assertNotIn("mc_cid", result)
        self.assertNotIn("mc_eid", result)
        self.assertIn("important=1", result)

    def test_empty_url(self):
        self.assertEqual(self.canon(""), "")

    def test_complex_url(self):
        url = "https://Finance.Yahoo.COM/quote/AAPL/?utm_source=google&utm_campaign=fall&ref=homepage"
        result = self.canon(url)
        self.assertTrue(result.startswith("https://finance.yahoo.com"))
        self.assertNotIn("utm_source", result)
        self.assertNotIn("ref=", result)


# ===================================================================
# B: SQLite ingest cache
# ===================================================================

class TestIngestCache(unittest.TestCase):

    def setUp(self):
        self.tmpdir = tempfile.mkdtemp()
        self.db_path = Path(self.tmpdir) / "test_ingest.db"
        import app.ingest_cache as ic
        ic._conn = None
        ic._DB_PATH = self.db_path
        self.ic = ic

    def tearDown(self):
        if self.ic._conn:
            self.ic._conn.close()
            self.ic._conn = None
        import shutil
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    def test_cache_miss_returns_none(self):
        self.assertIsNone(self.ic.get_cached_ingest("https://example.com/missing"))

    def test_set_and_get(self):
        self.ic.set_cached_ingest(
            url_canonical="https://example.com/article",
            title="Test Article",
            text="Some article content with financial data.",
            source_type="url",
            ingest_method="direct_trafilatura",
            text_hash="abc123",
            quality={"total_chars": 40, "extractor_used": "trafilatura"},
        )
        result = self.ic.get_cached_ingest("https://example.com/article")
        self.assertIsNotNone(result)
        self.assertEqual(result["title"], "Test Article")
        self.assertEqual(result["text"], "Some article content with financial data.")
        self.assertEqual(result["ingest_method"], "cache")
        self.assertEqual(result["content_quality"]["extractor_used"], "trafilatura")

    def test_cache_ttl_expiry(self):
        import time
        self.ic.set_cached_ingest(
            url_canonical="https://example.com/old",
            title="Old",
            text="Old text",
            source_type="url",
            ingest_method="direct_trafilatura",
        )
        # Manually set retrieved_at to 25 hours ago
        self.ic._db().execute(
            "UPDATE ingest_cache SET retrieved_at = ? WHERE url_canonical = ?",
            (time.time() - 25 * 3600, "https://example.com/old"),
        )
        self.ic._db().commit()
        self.assertIsNone(self.ic.get_cached_ingest("https://example.com/old"))

    def test_sec_filing_longer_ttl(self):
        import time
        self.ic.set_cached_ingest(
            url_canonical="https://sec.gov/filing",
            title="10-K",
            text="Filing content",
            source_type="sec_filing",
            ingest_method="direct_trafilatura",
        )
        # Set retrieved_at to 3 days ago — should still be valid for sec_filing (7d TTL)
        self.ic._db().execute(
            "UPDATE ingest_cache SET retrieved_at = ? WHERE url_canonical = ?",
            (time.time() - 3 * 24 * 3600, "https://sec.gov/filing"),
        )
        self.ic._db().commit()
        result = self.ic.get_cached_ingest("https://sec.gov/filing", "sec_filing")
        self.assertIsNotNone(result)

    def test_overwrite(self):
        self.ic.set_cached_ingest(
            url_canonical="https://example.com/x",
            title="V1", text="Old", source_type="url", ingest_method="a",
        )
        self.ic.set_cached_ingest(
            url_canonical="https://example.com/x",
            title="V2", text="New", source_type="url", ingest_method="b",
        )
        result = self.ic.get_cached_ingest("https://example.com/x")
        self.assertEqual(result["title"], "V2")


# ===================================================================
# C: Content extraction
# ===================================================================

class TestContentExtractor(unittest.TestCase):

    def test_article_with_nav_extracts_main_body(self):
        from app.content_extractor import extract_main_content
        html = (FIXTURES / "article_with_nav.html").read_text()
        result = extract_main_content(html, url="https://example.com/earnings")
        text = result["text"]
        # Main body assertions
        self.assertIn("$4.2 billion", text)
        self.assertIn("15%", text)
        self.assertIn("$890 million", text)
        # Navigation/footer junk should be minimal or absent
        self.assertNotIn("Privacy Policy", text)
        self.assertNotIn("Subscribe to our newsletter", text)
        self.assertNotIn("Advertise", text)
        self.assertTrue(result["quality"]["numeric_token_count"] > 0)

    def test_table_preservation(self):
        from app.content_extractor import extract_main_content
        html = (FIXTURES / "article_with_table.html").read_text()
        result = extract_main_content(html, url="https://sec.gov/filing")
        text = result["text"]
        self.assertIn("8,500", text)
        self.assertIn("Cloud Services", text)
        self.assertIn("$16.6 billion", text)

    def test_short_page_returns_something(self):
        from app.content_extractor import extract_main_content
        html = "<html><head><title>Short</title></head><body><p>Just a short note.</p></body></html>"
        result = extract_main_content(html)
        self.assertTrue(len(result["text"]) > 0 or result["extractor_used"] == "raw")

    def test_bot_wall_detection(self):
        from app.content_extractor import extract_main_content, is_bot_wall
        html = (FIXTURES / "short_botwall.html").read_text()
        result = extract_main_content(html)
        self.assertTrue(is_bot_wall(result["text"], result["quality"]))

    def test_quality_metrics_present(self):
        from app.content_extractor import extract_main_content
        html = (FIXTURES / "article_with_nav.html").read_text()
        result = extract_main_content(html)
        q = result["quality"]
        self.assertIn("total_chars", q)
        self.assertIn("numeric_token_count", q)
        self.assertIn("numeric_density", q)
        self.assertIn("line_count", q)
        self.assertIn("boilerplate_line_ratio", q)
        self.assertIn("extractor_used", q)


class TestSmartTruncation(unittest.TestCase):

    def test_preserves_numeric_paragraphs(self):
        from app.content_extractor import _smart_truncate
        filler = "This is filler paragraph without numbers. " * 50
        numeric = "Revenue was $4.2 billion in Q4, up 15% year-over-year."
        text = "\n\n".join([filler] * 20 + [numeric])
        truncated = _smart_truncate(text, max_chars=500)
        self.assertIn("$4.2 billion", truncated)


class TestBotWallDetection(unittest.TestCase):

    def test_multiple_signals(self):
        from app.content_extractor import is_bot_wall
        text = "Checking your browser Cloudflare enable javascript captcha"
        self.assertTrue(is_bot_wall(text))

    def test_normal_article(self):
        from app.content_extractor import is_bot_wall
        text = "Revenue was $4.2 billion. " * 20
        self.assertFalse(is_bot_wall(text))


# ===================================================================
# D: Sonar fallback parsing
# ===================================================================

class TestSonarExcerptParsing(unittest.TestCase):

    def test_parses_valid_json(self):
        from app.verification_engine import _parse_sonar_excerpts
        raw = json.dumps({
            "title": "Test Article",
            "publisher": "Test News",
            "published_at": "2025-01-15",
            "excerpts": [
                {"quote": "Revenue was $4.2B", "reason": "numeric claim", "approx_location": "beginning"},
                {"quote": "EPS grew 23%", "reason": "growth metric", "approx_location": "middle"},
            ],
            "notes": "",
        })
        result = _parse_sonar_excerpts(raw, "https://example.com")
        self.assertIsNotNone(result)
        self.assertEqual(result["title"], "Test Article")
        self.assertIn("Revenue was $4.2B", result["text"])
        self.assertIn("EPS grew 23%", result["text"])
        self.assertEqual(result["ingest_method"], "sonar_excerpts")

    def test_handles_markdown_fences(self):
        from app.verification_engine import _parse_sonar_excerpts
        raw = '```json\n' + json.dumps({
            "title": "Fenced",
            "publisher": "Pub",
            "published_at": None,
            "excerpts": [{"quote": "Data point 1", "reason": "r", "approx_location": "start"}],
            "notes": "paywall",
        }) + '\n```'
        result = _parse_sonar_excerpts(raw, "https://example.com")
        self.assertIsNotNone(result)
        self.assertIn("paywall", result["text"])

    def test_returns_none_on_invalid(self):
        from app.verification_engine import _parse_sonar_excerpts
        self.assertIsNone(_parse_sonar_excerpts("not json", "https://example.com"))

    def test_returns_none_on_empty_excerpts(self):
        from app.verification_engine import _parse_sonar_excerpts
        raw = json.dumps({
            "title": "T",
            "publisher": "",
            "published_at": None,
            "excerpts": [],
            "notes": "",
        })
        result = _parse_sonar_excerpts(raw, "https://example.com")
        self.assertIsNone(result)


# ===================================================================
# E: Integration smoke test (extract_url_content with mocked httpx)
# ===================================================================

class TestExtractUrlContentIntegration(unittest.TestCase):

    @patch("app.verification_engine.httpx")
    def test_uses_trafilatura_for_good_html(self, mock_httpx):
        html = (FIXTURES / "article_with_nav.html").read_text()
        mock_resp = MagicMock()
        mock_resp.text = html
        mock_resp.status_code = 200
        mock_httpx.get.return_value = mock_resp

        from app.verification_engine import extract_url_content
        result = extract_url_content("https://example.com/earnings")
        self.assertIn("$4.2 billion", result["text"])
        self.assertIn("content_quality", result)
        self.assertIn("ingest_method", result)
        self.assertTrue(result["ingest_method"].startswith("direct_"))

    @patch("app.verification_engine.httpx")
    def test_bot_wall_triggers_sonar_fallback(self, mock_httpx):
        html = (FIXTURES / "short_botwall.html").read_text()
        mock_resp = MagicMock()
        mock_resp.text = html
        mock_resp.status_code = 200
        mock_httpx.get.return_value = mock_resp

        # Mock Sonar to avoid actual API call
        mock_sonar_resp = MagicMock()
        mock_sonar_resp.status_code = 200
        mock_sonar_resp.json.return_value = {
            "choices": [{
                "message": {
                    "content": json.dumps({
                        "title": "Blocked Article",
                        "publisher": "News Site",
                        "published_at": "2025-03-01",
                        "excerpts": [
                            {"quote": "Revenue hit $5B", "reason": "numeric", "approx_location": "start"}
                        ],
                        "notes": "botwall",
                    })
                }
            }]
        }
        mock_httpx.post.return_value = mock_sonar_resp

        from app.verification_engine import extract_url_content
        with patch.dict(os.environ, {"PERPLEXITY_API_KEY": "test-key"}):
            result = extract_url_content("https://blocked.com/page")
        self.assertIn("Revenue hit $5B", result.get("text", ""))


if __name__ == "__main__":
    unittest.main()
