"""
URL canonicalization utilities for the ingestion pipeline.

Normalizes URLs to a stable canonical form for caching and dedup:
- Strip tracking parameters (utm_*, fbclid, gclid, etc.)
- Lowercase scheme and host
- Remove trailing slashes where safe
"""

from __future__ import annotations
import re
from urllib.parse import urlparse, urlunparse, parse_qs, urlencode


_STRIP_PARAMS = frozenset({
    "utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term",
    "fbclid", "gclid", "ref", "source", "spm", "mc_cid", "mc_eid",
    "s", "si", "t", "feature", "share", "context",
})


def canonicalize_url(url: str) -> str:
    """Return a normalized, cache-friendly version of *url*."""
    if not url:
        return url
    try:
        p = urlparse(url)
        scheme = (p.scheme or "https").lower()
        host = (p.hostname or "").lower()
        port = f":{p.port}" if p.port and p.port not in (80, 443) else ""
        path = p.path.rstrip("/") or "/"
        qs = parse_qs(p.query, keep_blank_values=False)
        cleaned_qs = {k: v for k, v in qs.items() if k.lower() not in _STRIP_PARAMS}
        query = urlencode(cleaned_qs, doseq=True) if cleaned_qs else ""
        return urlunparse((scheme, host + port, path, "", query, ""))
    except Exception:
        return url
