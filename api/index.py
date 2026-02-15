"""
Vercel serverless entry point — slim FastAPI app with ONLY the Synapse
verification endpoints. Does NOT import app/main.py (4000+ lines, heavy deps).
"""
import sys, os, json, uuid, datetime

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), '.env'))

from fastapi import FastAPI, HTTPException, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import Optional, List

from app.verification_engine import (
    extract_claims, extract_url_content, run_verification_pipeline,
    trace_provenance, generate_corrected_claim, VerificationEvent,
)

app = FastAPI(title="Synapse API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─── Models ───────────────────────────────────────────────────────────────

class IngestRequest(BaseModel):
    url: Optional[str] = None
    text: Optional[str] = None

class IngestResponse(BaseModel):
    title: str
    text: str
    source_type: str
    url: Optional[str] = None

class ExtractClaimsRequest(BaseModel):
    text: str

class ClaimItem(BaseModel):
    id: str
    original: str
    normalized: str
    type: str

class ExtractClaimsResponse(BaseModel):
    claims: List[ClaimItem]

class VerifyRequest(BaseModel):
    claim: str

class SaveReportRequest(BaseModel):
    title: str
    url: Optional[str] = None
    source_type: str = "url"
    claims: list
    analyzed_at: Optional[str] = None

# ─── In-memory report store ──────────────────────────────────────────────

_reports_store = {}

# ─── Endpoints ────────────────────────────────────────────────────────────

@app.get("/api/health")
def health():
    import os
    akey = os.getenv("ANTHROPIC_API_KEY", "")
    pkey = os.getenv("PERPLEXITY_API_KEY", "")
    return {
        "status": "ok",
        "service": "synapse",
        "anthropic_key_len": len(akey),
        "anthropic_key_preview": f"{akey[:8]}...{akey[-4:]}" if len(akey) > 12 else "(too short or missing)",
        "perplexity_key_len": len(pkey),
        "default_model": os.getenv("DEFAULT_MODEL", "(not set)"),
        "env_keys": [k for k in os.environ.keys() if "KEY" in k or "MODEL" in k or "ANTHROPIC" in k],
    }

@app.get("/api/test-llm")
def test_llm():
    """Quick test: call Claude with a trivial prompt and return timing."""
    import time
    t0 = time.time()
    try:
        from anthropic import Anthropic
        key = os.getenv("ANTHROPIC_API_KEY")
        if not key:
            return {"error": "ANTHROPIC_API_KEY not set", "duration_ms": 0}
        client = Anthropic(api_key=key)
        model = os.getenv("DEFAULT_MODEL", "claude-sonnet-4-20250514")
        resp = client.messages.create(
            model=model,
            max_tokens=50,
            messages=[{"role": "user", "content": "Say 'hello' in one word."}],
        )
        text = resp.content[0].text
        ms = int((time.time() - t0) * 1000)
        return {"status": "ok", "model": model, "response": text, "duration_ms": ms}
    except Exception as e:
        ms = int((time.time() - t0) * 1000)
        return {"status": "error", "error": str(e), "duration_ms": ms}

@app.post("/api/ingest", response_model=IngestResponse)
def api_ingest(req: IngestRequest):
    if req.url:
        result = extract_url_content(req.url)
        return IngestResponse(
            title=result.get("title", req.url),
            text=result.get("text", ""),
            source_type="url",
            url=req.url,
        )
    elif req.text:
        title = req.text[:60].strip().replace("\n", " ")
        return IngestResponse(title=title, text=req.text, source_type="text")
    else:
        raise HTTPException(status_code=400, detail="Provide either 'url' or 'text'")

@app.post("/api/extract-claims", response_model=ExtractClaimsResponse)
def api_extract_claims(req: ExtractClaimsRequest):
    if not req.text.strip():
        raise HTTPException(status_code=400, detail="Text is empty")
    try:
        raw_claims = extract_claims(req.text)
    except Exception as e:
        print(f"[Vercel] extract_claims error: {e}")
        raise HTTPException(status_code=500, detail=f"Claim extraction failed: {str(e)}")
    claims = []
    for i, c in enumerate(raw_claims):
        claims.append(ClaimItem(
            id=c.get("id", f"claim-{i+1}"),
            original=c.get("original", ""),
            normalized=c.get("normalized", c.get("original", "")),
            type=c.get("type", "categorical"),
        ))
    return ExtractClaimsResponse(claims=claims)

@app.post("/api/verify")
def api_verify(req: VerifyRequest):
    if not req.claim.strip():
        raise HTTPException(status_code=400, detail="Claim is empty")

    def event_stream():
        try:
            for event in run_verification_pipeline(req.claim):
                print(f"[Vercel SSE] {event.type}")
                yield event.to_sse()
        except Exception as e:
            import traceback
            print(f"[Vercel SSE ERROR] {e}\n{traceback.format_exc()}")
            error_event = VerificationEvent("error", {"message": str(e)})
            yield error_event.to_sse()

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "X-Accel-Buffering": "no",
        },
    )

@app.post("/api/reports")
def api_save_report(req: SaveReportRequest):
    report_id = str(uuid.uuid4())[:8]
    _reports_store[report_id] = {
        "id": report_id,
        "title": req.title,
        "url": req.url,
        "source_type": req.source_type,
        "claims": req.claims,
        "analyzed_at": req.analyzed_at or "",
        "created_at": datetime.datetime.utcnow().isoformat(),
    }
    return {"id": report_id}

@app.get("/api/reports/{report_id}")
def api_get_report(report_id: str):
    report = _reports_store.get(report_id)
    if not report:
        raise HTTPException(status_code=404, detail="Report not found")
    return report
