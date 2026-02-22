"""
SQLite cache for claim extraction results.

Keyed by doc_hash + model_id + prompt_version + selector_version so
cache auto-invalidates when any of those change.
"""

from __future__ import annotations
import json
import sqlite3
import time
import hashlib
import threading
from pathlib import Path
from typing import Optional, List, Dict, Any

from app.text_chunking import normalize_text

# Version bumped whenever prompt or pipeline logic changes
PROMPT_VERSION = "v2_chunked"
SELECTOR_VERSION = "v1"

_DB_PATH = Path(__file__).resolve().parent.parent / "data" / "extraction_cache.db"
_lock = threading.Lock()


def _get_conn() -> sqlite3.Connection:
    _DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(_DB_PATH), check_same_thread=False)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS extracted_claims_cache (
            cache_key TEXT PRIMARY KEY,
            doc_hash TEXT NOT NULL,
            created_at REAL NOT NULL,
            payload_json TEXT NOT NULL
        )
    """)
    conn.execute("""
        CREATE INDEX IF NOT EXISTS idx_cache_doc_hash
        ON extracted_claims_cache(doc_hash)
    """)
    conn.commit()
    return conn


_conn: Optional[sqlite3.Connection] = None


def _db() -> sqlite3.Connection:
    global _conn
    if _conn is None:
        with _lock:
            if _conn is None:
                _conn = _get_conn()
    return _conn


def doc_hash(text: str) -> str:
    """SHA-256 of normalized full text."""
    norm = normalize_text(text)
    return hashlib.sha256(norm.encode("utf-8")).hexdigest()


def cache_key(text: str, model_id: str = "default") -> str:
    """Build a versioned cache key."""
    dh = doc_hash(text)
    return f"extract_claims:{dh}:{model_id}:{PROMPT_VERSION}:{SELECTOR_VERSION}"


def get_cached(text: str, model_id: str = "default", ttl_seconds: int = 7 * 86400) -> Optional[List[Dict[str, Any]]]:
    """Return cached claims if they exist and haven't expired."""
    key = cache_key(text, model_id)
    try:
        row = _db().execute(
            "SELECT payload_json, created_at FROM extracted_claims_cache WHERE cache_key = ?",
            (key,)
        ).fetchone()
        if row:
            payload_json, created_at = row
            if time.time() - created_at < ttl_seconds:
                return json.loads(payload_json)
            # Expired — delete
            _db().execute("DELETE FROM extracted_claims_cache WHERE cache_key = ?", (key,))
            _db().commit()
    except Exception:
        pass
    return None


def set_cached(text: str, claims: List[Dict[str, Any]], model_id: str = "default") -> None:
    """Store extraction results in cache."""
    key = cache_key(text, model_id)
    dh = doc_hash(text)
    try:
        _db().execute(
            "INSERT OR REPLACE INTO extracted_claims_cache (cache_key, doc_hash, created_at, payload_json) VALUES (?, ?, ?, ?)",
            (key, dh, time.time(), json.dumps(claims)),
        )
        _db().commit()
    except Exception:
        pass
