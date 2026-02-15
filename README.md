# Synapse — Every claim, interrogated

Synapse is a **claim-level intelligence engine** that takes any piece of content — a URL, pasted text, or audio — extracts every factual claim, and runs deep multi-step agent-driven verification on each one. It doesn't just tell you "true or false." It shows you the full forensic breakdown: where the evidence comes from, how strong it is, where the claim originated, and how it mutated as it spread.

The verification process itself is the product. The user watches the agent think, search, evaluate, and reason in real time. Every step is visible. The reasoning IS the interface.

---

## How It Works

### 1. Ingest Anything
Paste a URL (article, blog, YouTube), raw text, or upload audio/video. Synapse extracts clean text and feeds it to the claim extraction pipeline.

### 2. Claim Extraction
An LLM identifies every discrete, verifiable factual claim — skipping opinions, rhetoric, and subjective statements. Each claim is tagged by type (quantitative, directional, categorical, provenance).

### 3. 6-Step Verification Pipeline
Each claim runs through a multi-agent pipeline, streamed to the UI in real time via SSE:

- **Step 1 — Decomposition**: Break compound claims into atomic, independently verifiable sub-claims
- **Step 2 — Multi-Source Evidence Retrieval**: Parallel search across Semantic Scholar (academic papers), Perplexity Sonar (institutional + journalism), and deliberate counter-evidence search
- **Step 3 — Evidence Quality Evaluation**: Score each source (0-100) based on study type, recency, citation count, and source authority
- **Step 4 — Verdict Synthesis**: Per-sub-claim verdicts (Supported / Exaggerated / Contradicted / Unsupported) rolled up into an overall verdict with confidence level
- **Step 5 — Provenance Tracing**: Trace the claim's likely origin and mutation path — from original study to the version being checked
- **Step 6 — Corrected Claim**: Generate an evidence-backed corrected version, a steel-manned version, and key caveats

### 4. Live Agent Reasoning Trace
A terminal-style trace panel shows every step the agent takes in real time — searches fired, evidence found, scores assigned, verdicts reached.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Backend** | Python, FastAPI, Uvicorn |
| **AI** | Anthropic Claude (primary), Google Gemini (fallback) |
| **Search** | Semantic Scholar API, Perplexity Sonar API |
| **Transcription** | Deepgram Nova-2 |
| **Frontend** | React 18, TypeScript, Vite |
| **Streaming** | Server-Sent Events (SSE) |

---

## Project Structure

```
synapse/
├── app/
│   ├── main.py                 # FastAPI backend — all endpoints
│   ├── verification_engine.py  # 6-step claim verification pipeline
│   ├── deep_dive_agent.py      # Multi-step research agent
│   └── vector_store.py         # In-memory vector store
├── web/
│   ├── src/ui/
│   │   ├── SynapsePage.tsx     # Main verification UI (dark theme)
│   │   └── NewApp.tsx          # Router
│   ├── package.json
│   └── vite.config.ts
├── requirements.txt
└── .env
```

---

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/ingest` | POST | Ingest URL or raw text, return clean extracted text |
| `/api/ingest-audio` | POST | Upload audio/video, transcribe via Deepgram |
| `/api/extract-claims` | POST | Extract verifiable claims from text via LLM |
| `/api/verify` | POST | Run full 6-step verification pipeline (SSE stream) |

---

## Getting Started

### Prerequisites
- Python 3.10+
- Node.js 18+

### 1. Backend Setup
```bash
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

### 2. Configure Environment
```bash
cp .env_sample .env
# Required:
#   ANTHROPIC_API_KEY=...
#   GOOGLE_API_KEY=...        (Gemini fallback)
#   PERPLEXITY_API_KEY=...    (Sonar search)
# Optional:
#   DEEPGRAM_API_KEY=...      (audio transcription)
```

### 3. Start Backend
```bash
source venv/bin/activate
uvicorn app.main:app --port 4000 --reload
```

### 4. Start Frontend
```bash
cd web
npm install
npm run dev
```

Open **http://localhost:5173** in your browser.

---

## Team
Built at **TreeHacks 2026** at Stanford University.

## License
MIT

