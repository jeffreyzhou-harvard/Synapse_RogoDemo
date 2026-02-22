"""
Main-content extraction from raw HTML.

Priority chain:
1. trafilatura (best recall for article text + tables)
2. Raw BeautifulSoup with boilerplate element removal (fallback)

Also provides content-quality metrics and smarter truncation
that preserves numeric-dense paragraphs.
"""

from __future__ import annotations
import re
import hashlib
from typing import Dict, Any, Optional, Tuple

# ---------------------------------------------------------------------------
# Content extraction
# ---------------------------------------------------------------------------

def extract_main_content(html: str, url: str = "") -> Dict[str, Any]:
    """Extract main article text from raw HTML.

    Returns
    -------
    {
        "title": str,
        "text": str,
        "extractor_used": "trafilatura" | "raw",
        "quality": { ... content quality metrics ... },
    }
    """
    title = _extract_title(html)
    text = ""
    extractor = "raw"

    # --- Try trafilatura first ---
    try:
        import trafilatura
        result = trafilatura.extract(
            html,
            include_comments=False,
            include_tables=True,
            favor_recall=True,
            url=url or None,
        )
        if result and len(result.split()) >= 30:
            text = result
            extractor = "trafilatura"

            # Try to get metadata for better title
            try:
                meta = trafilatura.extract_metadata(html, default_url=url or None)
                if meta and meta.title and len(meta.title) > len(title):
                    title = meta.title
            except Exception:
                pass
    except Exception:
        pass

    # --- Fallback: raw extraction with boilerplate removal ---
    if not text or len(text.split()) < 30:
        raw_text = _raw_extract(html)
        if len(raw_text.split()) > len((text or "").split()):
            text = raw_text
            extractor = "raw"

    # --- Smart truncation ---
    text = _smart_truncate(text, max_chars=60000)

    quality = _compute_quality(text, extractor)

    return {
        "title": title,
        "text": text,
        "extractor_used": extractor,
        "quality": quality,
    }


def compute_text_hash(text: str) -> str:
    return hashlib.sha256(text.strip().lower().encode("utf-8")).hexdigest()[:24]


# ---------------------------------------------------------------------------
# Title extraction
# ---------------------------------------------------------------------------

_TITLE_RE = re.compile(r"<title[^>]*>(.*?)</title>", re.IGNORECASE | re.DOTALL)


def _extract_title(html: str) -> str:
    m = _TITLE_RE.search(html)
    if m:
        title = re.sub(r"<[^>]+>", "", m.group(1)).strip()
        title = re.sub(r"\s+", " ", title)
        return title[:300]
    return ""


# ---------------------------------------------------------------------------
# Raw fallback extractor
# ---------------------------------------------------------------------------

_BOILERPLATE_TAGS = re.compile(
    r"<(nav|footer|aside|header|noscript|figcaption)\b[^>]*>.*?</\1>",
    re.IGNORECASE | re.DOTALL,
)
_BOILERPLATE_CLASSES = re.compile(
    r'<[^>]+(?:class|id)\s*=\s*["\'][^"\']*'
    r"(?:cookie|subscribe|newsletter|nav|footer|header|menu|banner|sidebar|popup|modal|ad-|advert|social-share)"
    r'[^"\']*["\'][^>]*>.*?</[^>]+>',
    re.IGNORECASE | re.DOTALL,
)


def _raw_extract(html: str) -> str:
    """BeautifulSoup-free raw extraction with boilerplate removal."""
    text = html
    # Remove script/style
    text = re.sub(r"<script[^>]*>.*?</script>", "", text, flags=re.DOTALL | re.IGNORECASE)
    text = re.sub(r"<style[^>]*>.*?</style>", "", text, flags=re.DOTALL | re.IGNORECASE)
    # Remove boilerplate elements
    text = _BOILERPLATE_TAGS.sub("", text)
    text = _BOILERPLATE_CLASSES.sub("", text)
    # Strip remaining tags
    text = re.sub(r"<[^>]+>", " ", text)
    # Collapse whitespace
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    text = text.strip()

    # Remove repeated short lines (nav patterns)
    lines = text.split("\n")
    seen_short: Dict[str, int] = {}
    for line in lines:
        stripped = line.strip()
        if len(stripped) < 40:
            seen_short[stripped] = seen_short.get(stripped, 0) + 1
    cleaned_lines = []
    for line in lines:
        stripped = line.strip()
        if len(stripped) < 40 and seen_short.get(stripped, 0) > 2:
            continue
        cleaned_lines.append(line)

    return "\n".join(cleaned_lines).strip()


# ---------------------------------------------------------------------------
# Smart truncation
# ---------------------------------------------------------------------------

_NUMERIC_PATTERN = re.compile(r"[\d,.]+[%$]|\$[\d,.]+|\d+\s*(bps|basis|million|billion|bn|mm)")


def _smart_truncate(text: str, max_chars: int = 60000) -> str:
    """Truncate text but preserve paragraphs containing numeric data."""
    if len(text) <= max_chars:
        return text

    paragraphs = text.split("\n\n")
    result: list[str] = []
    char_count = 0
    numeric_overflow: list[str] = []

    for p in paragraphs:
        if char_count + len(p) + 2 <= max_chars:
            result.append(p)
            char_count += len(p) + 2
        elif _NUMERIC_PATTERN.search(p) and len("\n\n".join(numeric_overflow)) < 10000:
            numeric_overflow.append(p)

    if numeric_overflow:
        result.append("\n\n[...]\n")
        result.extend(numeric_overflow)

    return "\n\n".join(result)


# ---------------------------------------------------------------------------
# Content quality metrics
# ---------------------------------------------------------------------------

def _compute_quality(text: str, extractor: str) -> Dict[str, Any]:
    total_chars = len(text)
    lines = text.split("\n")
    line_count = len(lines)

    numeric_tokens = len(_NUMERIC_PATTERN.findall(text))
    numeric_density = round(numeric_tokens / max(total_chars / 1000, 0.1), 2)

    short_lines = [l.strip() for l in lines if 0 < len(l.strip()) < 40]
    seen: Dict[str, int] = {}
    for sl in short_lines:
        seen[sl] = seen.get(sl, 0) + 1
    boilerplate_lines = sum(1 for sl in short_lines if seen.get(sl, 0) > 2)
    boilerplate_ratio = round(boilerplate_lines / max(line_count, 1), 3)

    return {
        "total_chars": total_chars,
        "numeric_token_count": numeric_tokens,
        "numeric_density": numeric_density,
        "line_count": line_count,
        "boilerplate_line_ratio": boilerplate_ratio,
        "extractor_used": extractor,
    }


# ---------------------------------------------------------------------------
# Enhanced bot-wall detection
# ---------------------------------------------------------------------------

_BOT_SIGNALS = [
    "enable javascript", "captcha", "cloudflare", "access denied",
    "just a moment", "checking your browser", "ray id",
    "please verify", "are you a robot", "bot protection",
    "security check", "ddos protection",
]


def is_bot_wall(text: str, quality: Optional[Dict[str, Any]] = None) -> bool:
    """Detect bot walls / garbage content with multiple signals."""
    lower = text.lower()
    word_count = len(text.split())

    signal_hits = sum(1 for s in _BOT_SIGNALS if s in lower)
    if signal_hits >= 2:
        return True
    if word_count < 50 and signal_hits >= 1:
        return True

    if quality:
        if quality.get("boilerplate_line_ratio", 0) > 0.5 and word_count < 200:
            return True

    if word_count < 30:
        return True

    return False
