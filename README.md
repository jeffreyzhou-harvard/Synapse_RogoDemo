# Synapse — Think better, not faster

**[usesynapse.org](https://usesynapse.org)**

Synapse is an AI-enabled research workspace that helps learners draft, challenge, and connect their ideas. Instead of generating answers, Synapse uses AI agents to push you toward deeper, more rigorous thinking.

---

## Features

### Research Document Editor
A distraction-free writing environment with auto-save, section detection, and Word/DOCX export.

### AI Thinking Agents
Select any text in your document to invoke specialized AI agents:
- **🔍 Find Evidence** — Searches for academic sources that support or challenge a claim, with structured citations
- **⚔️ Challenge** — Plays devil's advocate to stress-test your arguments
- **💡 Simplify** — Explains complex passages in plain language
- **🛡️ Steelman** — Strengthens the best version of your argument
- **🤔 Socratic** — Asks probing questions to deepen your reasoning
- **🔗 Connect** — Finds hidden connections between two ideas in your paper

### Citations Panel
Structured evidence results with source titles, findings, verdict (supported/challenged/mixed), and one-click citation insertion in APA/MLA/Chicago formats.

### Claim Tracker
Automatically identifies claims in your document and tracks which are supported, challenged, or unverified.

### Argument Map
Visual D3-based graph showing the logical structure of your argument — claims, evidence, and counterarguments.

### Research Question Wizard
A Socratic conversation that helps you refine a vague topic into a sharp, researchable question before you start writing.

### Audio Transcription
Upload interview or lecture recordings for automatic transcription (via Deepgram) with AI-powered claim extraction and source recommendations.

### Writing Quality Analysis
Per-section metrics for clarity, specificity, and argument strength.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Backend** | Python, FastAPI, Uvicorn |
| **AI** | Anthropic Claude, OpenAI, Google Gemini (multi-provider fallback) |
| **Transcription** | Deepgram |
| **Frontend** | React 18, TypeScript, Vite, TailwindCSS |
| **Visualization** | D3.js |
| **Export** | docx (Word), file-saver |
| **Storage** | localStorage (client-side) |

---

## Project Structure

```
synapse/
├── app/
│   ├── main.py              # FastAPI backend — all AI endpoints
│   ├── agent_service.py     # Agent delegation logic
│   ├── github_service.py    # GitHub integration
│   └── slack_service.py     # Slack integration
├── web/
│   ├── src/
│   │   ├── ui/
│   │   │   ├── DocumentEditor.tsx   # Main editor with agent toolbar
│   │   │   ├── HomePage.tsx         # Dashboard & research wizard
│   │   │   ├── AIChatSidebar.tsx    # AI chat panel
│   │   │   ├── CitationsPanel.tsx   # Evidence & citations
│   │   │   ├── ClaimTracker.tsx     # Claim verification tracker
│   │   │   ├── ArgumentMap.tsx      # Visual argument graph
│   │   │   ├── TranscriptionPanel.tsx
│   │   │   └── SelectionToolbar.tsx # Agent selection on highlight
│   │   └── services/
│   │       └── documentService.ts   # Document CRUD (localStorage)
│   ├── package.json
│   └── vite.config.ts
├── requirements.txt
└── .env
```

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
# Add your API keys:
#   ANTHROPIC_API_KEY=...
#   OPENAI_API_KEY=...       (optional fallback)
#   DEEPGRAM_API_KEY=...     (optional, for transcription)
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

