"""
SQLite persistent cache for URL ingestion results.

Avoids re-fetching the same URL within the TTL window.
"""

from __future__ import annotations
import json
import sqlite3
import time
import threading
from pathlib import Path
from typing import Optional, Dict, Any

_DB_PATH = Path(__file__).resolve().parent.parent / "data" / "ingest_cache.db"
_lock = threading.Lock()
_conn: Optional[sqlite3.Connection] = None

_DEFAULT_TTL = 24 * 3600        # 24h for articles/news
_STATIC_TTL = 7 * 24 * 3600    # 7 days for SEC filings and static docs
_STATIC_TYPES = frozenset({"sec_filing", "earnings_transcript", "financial_document"})


def _get_conn() -> sqlite3.Connection:
    _DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(_DB_PATH), check_same_thread=False)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS ingest_cache (
            url_canonical   TEXT PRIMARY KEY,
            retrieved_at    REAL NOT NULL,
            title           TEXT NOT NULL DEFAULT '',
            text            TEXT NOT NULL DEFAULT '',
            text_hash       TEXT NOT NULL DEFAULT '',
            source_type     TEXT NOT NULL DEFAULT 'url',
            ingest_method   TEXT NOT NULL DEFAULT '',
            quality_json    TEXT NOT NULL DEFAULT '{}'
        )
    """)
    conn.commit()
    return conn


def _db() -> sqlite3.Connection:
    global _conn
    if _conn is None:
        with _lock:
            if _conn is None:
                _conn = _get_conn()
    return _conn


def get_cached_ingest(url_canonical: str, source_type: str = "url") -> Optional[Dict[str, Any]]:
    """Return cached ingest result if still fresh, else None."""
    try:
        row = _db().execute(
            "SELECT title, text, source_type, ingest_method, quality_json, retrieved_at "
            "FROM ingest_cache WHERE url_canonical = ?",
            (url_canonical,),
        ).fetchone()
        if not row:
            return None
        title, text, st, method, quality_json, retrieved_at = row
        ttl = _STATIC_TTL if st in _STATIC_TYPES else _DEFAULT_TTL
        if time.time() - retrieved_at > ttl:
            _db().execute("DELETE FROM ingest_cache WHERE url_canonical = ?", (url_canonical,))
            _db().commit()
            return None
        return {
            "title": title,
            "text": text,
            "source_type": st,
            "ingest_method": "cache",
            "url_canonical": url_canonical,
            "content_quality": json.loads(quality_json) if quality_json else {},
        }
    except Exception:
        return None


def set_cached_ingest(
    url_canonical: str,
    title: str,
    text: str,
    source_type: str,
    ingest_method: str,
    text_hash: str = "",
    quality: Optional[Dict[str, Any]] = None,
) -> None:
    """Store an ingest result in the cache."""
    try:
        _db().execute(
            "INSERT OR REPLACE INTO ingest_cache "
            "(url_canonical, retrieved_at, title, text, text_hash, source_type, ingest_method, quality_json) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (url_canonical, time.time(), title, text, text_hash,
             source_type, ingest_method, json.dumps(quality or {})),
        )
        _db().commit()
    except Exception:
        pass
