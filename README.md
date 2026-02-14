## Vision: Notion for engineering teams

Build a living technical knowledge system that deeply understands both code and docs, powering code-native documentation, intelligent technical specs, automated runbooks, and a dynamic team knowledge graph.

### I. Vision Statement
- **A living technical knowledge system**: Docs that stay current with code, capture decisions, and automate operational knowledge.
- **Deep understanding of both code and docs**: Index and model code, APIs, infra, and narratives together.

### II. Architectural Pillars

#### Code-Native Documentation
- **Live code blocks**: Execute sandboxed code blocks and persist outputs alongside docs.
- **Auto-generated API docs**: Support OpenAPI, GraphQL, and protobuf sources.
- **Automatic versioning**: Track docs next to code via Git and surface drift.
- **Bidirectional sync**: Keep docs and config/code in sync.

#### Intelligent Technical Specs
- **AI-powered RFC generation**: Analyze codebase, suggest patterns, and scaffold specs.
- **Technical-debt tracking**: Link docs to hotspots (complexity, churn, coverage gaps).
- **Design decision records (ADRs)**: Connect decisions to implementation and detect drift.
- **Dependency visualization**: Real-time graphs of services, libraries, and data flows.

#### Runbook Automation Platform
- **Executable playbooks**: One-click remediation with guarded execution.
- **Incident timeline reconstruction**: Pull logs, metrics, and chats to create timelines.
- **Blameless postmortems**: Auto-drafts from observability tools and chat.
- **Chaos integration**: Validate runbooks proactively.

#### Team Knowledge Graph
- **Semantic model of the org**: People, code, systems, tools, events, and docs in one graph.

---

## Monorepo Structure (MVP)

```
MidLayer-Exp/
  apps/
    api/        # TypeScript Express API (sandbox, RFCs, indexing, docs)
    web/        # Vite + React UI (Docs, Specs, Runbooks, Graph)
  packages/
    shared/     # Shared types and small utilities
  .env.example
  package.json  # npm workspaces
```

### MVP Capabilities
- Run sandboxed JavaScript code blocks and capture outputs.
- Generate RFC drafts via OpenAI (optional; degrades gracefully when not configured).
- Serve OpenAPI files through Swagger UI.
- Index a local repo path to build a lightweight knowledge graph in SQLite.
- Simple React UI to interact with the API (execute code, generate RFCs, view OpenAPI docs link).

### Roadmap to Full Vision
- Add GraphQL/protobuf ingestion and doc gen.
- Add dependency graph via static analysis (tree-sitter, TS/Go/Python analyzers).
- Enrich knowledge graph with entities (Services, Modules, APIs, Teams, Incidents).
- Build drift detection between ADRs/specs and implementation.
- Add Runbooks DSL with guarded execution and environment policies.
- Observability connectors (Datadog, Grafana, CloudWatch) and chat (Slack).
- Vector search and embeddings for code + docs.

---

## Getting Started

1) Prerequisites
- Node.js 18+

2) Setup
```bash
npm install
```

3) Run dev servers (API + Web)
```bash
npm run dev
```

4) Configure OpenAI (optional for RFC generation)
```bash
cp .env.example .env
# edit .env and set OPENAI_API_KEY
```

---

## Security Notes
- The code sandbox executes only JavaScript via `vm2` with strict timeouts and memory caps; treat outputs as untrusted. Do not elevate privileges or pass host access.
- Runbook execution is disabled by default for safety and should be enabled only in controlled environments.

---

## License
Apache-2.0 (placeholder, update as needed)

