"""
Instrumentation counters and timing utilities for the verification pipeline.

Provides a lightweight PipelineMetrics context that tracks:
- LLM call counts
- External API call counts (SEC, EDGAR, Perplexity, FRED, Yahoo)
- Evidence counts (pre/post dedupe)
- Stage timings
- Cache hit/miss counts
"""

from __future__ import annotations
import time
import logging
from contextlib import contextmanager
from typing import Dict, Any

log = logging.getLogger("synapse.metrics")


class PipelineMetrics:
    """Mutable counter bag passed through a single verification run."""

    def __init__(self):
        self.llm_calls: int = 0
        self.sec_xbrl_calls: int = 0
        self.edgar_calls: int = 0
        self.perplexity_calls: int = 0
        self.fred_calls: int = 0
        self.yahoo_calls: int = 0
        self.cache_hits: int = 0
        self.cache_misses: int = 0
        self.evidence_pre_dedupe: int = 0
        self.evidence_post_dedupe: int = 0
        self.stage_timings: Dict[str, float] = {}
        self._stage_stack: Dict[str, float] = {}
        self._start = time.time()

    def start_stage(self, name: str) -> None:
        self._stage_stack[name] = time.time()

    def end_stage(self, name: str) -> None:
        t0 = self._stage_stack.pop(name, None)
        if t0 is not None:
            self.stage_timings[name] = (time.time() - t0) * 1000

    @contextmanager
    def stage(self, name: str):
        self.start_stage(name)
        try:
            yield
        finally:
            self.end_stage(name)

    def inc_llm(self, n: int = 1) -> None:
        self.llm_calls += n

    def inc_sec(self, n: int = 1) -> None:
        self.sec_xbrl_calls += n

    def inc_edgar(self, n: int = 1) -> None:
        self.edgar_calls += n

    def inc_perplexity(self, n: int = 1) -> None:
        self.perplexity_calls += n

    def inc_fred(self, n: int = 1) -> None:
        self.fred_calls += n

    def inc_yahoo(self, n: int = 1) -> None:
        self.yahoo_calls += n

    def inc_cache_hit(self) -> None:
        self.cache_hits += 1

    def inc_cache_miss(self) -> None:
        self.cache_misses += 1

    def total_elapsed_ms(self) -> float:
        return (time.time() - self._start) * 1000

    def to_dict(self) -> Dict[str, Any]:
        return {
            "llm_calls": self.llm_calls,
            "sec_xbrl_calls": self.sec_xbrl_calls,
            "edgar_calls": self.edgar_calls,
            "perplexity_calls": self.perplexity_calls,
            "fred_calls": self.fred_calls,
            "yahoo_calls": self.yahoo_calls,
            "cache_hits": self.cache_hits,
            "cache_misses": self.cache_misses,
            "evidence_pre_dedupe": self.evidence_pre_dedupe,
            "evidence_post_dedupe": self.evidence_post_dedupe,
            "stage_timings_ms": self.stage_timings,
            "total_elapsed_ms": self.total_elapsed_ms(),
        }

    def log_summary(self) -> None:
        d = self.to_dict()
        log.info(
            "pipeline_metrics llm=%d sec=%d edgar=%d perplexity=%d fred=%d yahoo=%d "
            "cache_hits=%d cache_misses=%d evidence_pre=%d evidence_post=%d "
            "total_ms=%.0f stages=%s",
            d["llm_calls"], d["sec_xbrl_calls"], d["edgar_calls"],
            d["perplexity_calls"], d["fred_calls"], d["yahoo_calls"],
            d["cache_hits"], d["cache_misses"],
            d["evidence_pre_dedupe"], d["evidence_post_dedupe"],
            d["total_elapsed_ms"],
            {k: f"{v:.0f}ms" for k, v in d["stage_timings_ms"].items()},
        )
