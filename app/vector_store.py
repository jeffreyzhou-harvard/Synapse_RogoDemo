"""
Unified Vector Store for Synapse
================================
In-memory vector store that provides:
- Cross-document semantic search across heterogeneous source types (PDFs, transcripts, web articles)
- Real-time cosine similarity matching on keystroke debounce
- Source-type-aware chunking and embedding pipeline
- Workspace isolation (multiple users/tabs don't collide)

Architecture:
  Source Ingestion → Type-Specific Parser → Chunking → Embedding → Vector Store → Cosine Similarity Search
"""

import math
import os
import time
import hashlib
from typing import List, Dict, Any, Optional, Tuple
from dataclasses import dataclass, field
from pathlib import Path
from dotenv import load_dotenv

# Load .env from project root
_ENV_PATH = Path(__file__).resolve().parents[1] / ".env"
load_dotenv(dotenv_path=_ENV_PATH, override=True)

try:
    from openai import OpenAI
except Exception:
    OpenAI = None

try:
    import google.generativeai as genai
except Exception:
    genai = None


# ── Data Types ────────────────────────────────────────────────────────────────

@dataclass
class Chunk:
    """A single chunk of text with its embedding and metadata."""
    id: str
    text: str
    embedding: Optional[List[float]] = None
    source_id: str = ""
    source_title: str = ""
    source_type: str = ""  # 'pdf' | 'transcript' | 'web' | 'text'
    chunk_index: int = 0
    total_chunks: int = 0
    word_count: int = 0
    created_at: float = 0.0

@dataclass
class SearchResult:
    """A single search result with similarity score."""
    chunk: Chunk
    similarity: float
    rank: int = 0


# ── Embedding Provider ────────────────────────────────────────────────────────

class EmbeddingProvider:
    """Handles embedding generation with fallback support.
    
    Priority: OpenAI text-embedding-3-small (1536d) → Gemini embedding → None
    """
    
    def __init__(self):
        self._openai_client = None
        self._dimension = 0
        self._provider = "none"
        self._init_provider()
    
    def _init_provider(self):
        """Initialize the best available embedding provider."""
        # Try OpenAI first (fastest, best quality for semantic search)
        api_key = os.getenv("OPENAI_API_KEY", "")
        is_placeholder = not api_key or "your_" in api_key.lower() or "placeholder" in api_key.lower() or len(api_key) < 20
        if not is_placeholder and OpenAI is not None:
            try:
                self._openai_client = OpenAI()
                # Quick test to verify key works
                self._openai_client.embeddings.create(model="text-embedding-3-small", input=["test"])
                self._provider = "openai"
                self._dimension = 1536
                print("[VectorStore] Using OpenAI text-embedding-3-small (1536d)")
                return
            except Exception as e:
                print(f"[VectorStore] OpenAI init failed: {e}")
        
        # Try Gemini embedding
        google_key = os.getenv("GOOGLE_API_KEY")
        if google_key and genai is not None:
            try:
                genai.configure(api_key=google_key)
                # Test it works
                test = genai.embed_content(model='models/gemini-embedding-001', content='test', task_type='retrieval_document')
                self._dimension = len(test['embedding'])
                self._provider = "gemini"
                print(f"[VectorStore] Using Gemini gemini-embedding-001 ({self._dimension}d)")
                return
            except Exception as e:
                print(f"[VectorStore] Gemini init failed: {e}")
        
        print("[VectorStore] WARNING: No embedding provider available. Semantic search disabled.")
    
    @property
    def available(self) -> bool:
        return self._provider != "none"
    
    @property
    def provider_name(self) -> str:
        return self._provider
    
    @property
    def dimension(self) -> int:
        return self._dimension
    
    def embed(self, texts: List[str]) -> List[List[float]]:
        """Embed a batch of texts. Returns list of embedding vectors."""
        if not self.available or not texts:
            return []
        
        # Clean texts
        texts = [t.strip()[:8000] for t in texts if t.strip()]
        if not texts:
            return []
        
        try:
            if self._provider == "openai":
                return self._embed_openai(texts)
            elif self._provider == "gemini":
                return self._embed_gemini(texts)
        except Exception as e:
            print(f"[VectorStore] Embedding error ({self._provider}): {e}")
        return []
    
    def _embed_openai(self, texts: List[str]) -> List[List[float]]:
        """Embed using OpenAI text-embedding-3-small."""
        resp = self._openai_client.embeddings.create(
            model="text-embedding-3-small",
            input=texts
        )
        return [item.embedding for item in resp.data]
    
    def _embed_gemini(self, texts: List[str]) -> List[List[float]]:
        """Embed using Gemini gemini-embedding-001."""
        results = []
        for text in texts:
            result = genai.embed_content(
                model="models/gemini-embedding-001",
                content=text,
                task_type="retrieval_document"
            )
            results.append(result['embedding'])
        return results


# ── Text Chunking Pipeline ────────────────────────────────────────────────────

class ChunkingPipeline:
    """Source-type-aware chunking with overlap for semantic coherence."""
    
    @staticmethod
    def chunk_text(text: str, source_type: str = "text",
                   chunk_size: int = 120, overlap: int = 30,
                   min_words: int = 8) -> List[str]:
        """Split text into overlapping chunks. Parameters tuned per source type.
        
        - PDFs: larger chunks (academic paragraphs are dense)
        - Transcripts: smaller chunks (spoken language is less dense)
        - Web/text: medium chunks
        """
        if source_type == "pdf":
            chunk_size, overlap = 150, 40
        elif source_type == "transcript":
            chunk_size, overlap = 80, 20
        
        words = text.split()
        if len(words) < min_words:
            return [text.strip()] if text.strip() else []
        
        chunks = []
        i = 0
        while i < len(words):
            chunk_words = words[i:i + chunk_size]
            chunk = " ".join(chunk_words)
            if len(chunk_words) >= min_words:
                chunks.append(chunk.strip())
            i += max(chunk_size - overlap, 1)
        
        return chunks
    
    @staticmethod
    def chunk_source(source_id: str, title: str, content: str,
                     source_type: str) -> List[Chunk]:
        """Chunk a source document into Chunk objects."""
        raw_chunks = ChunkingPipeline.chunk_text(content, source_type)
        now = time.time()
        chunks = []
        for i, text in enumerate(raw_chunks):
            chunk_id = hashlib.md5(f"{source_id}:{i}:{text[:50]}".encode()).hexdigest()[:12]
            chunks.append(Chunk(
                id=chunk_id,
                text=text,
                source_id=source_id,
                source_title=title,
                source_type=source_type,
                chunk_index=i,
                total_chunks=len(raw_chunks),
                word_count=len(text.split()),
                created_at=now,
            ))
        return chunks


# ── Vector Store ──────────────────────────────────────────────────────────────

class VectorStore:
    """In-memory vector store with cosine similarity search.
    
    Supports:
    - Cross-document search across heterogeneous source types
    - Real-time query embedding + similarity computation
    - Source-level and chunk-level retrieval
    - Workspace isolation via workspace_id
    """
    
    def __init__(self):
        self.embedder = EmbeddingProvider()
        self.chunker = ChunkingPipeline()
        # workspace_id -> list of chunks
        self._stores: Dict[str, List[Chunk]] = {}
        # workspace_id -> {source_id: source_metadata}
        self._sources: Dict[str, Dict[str, Dict[str, Any]]] = {}
    
    @property
    def provider(self) -> str:
        return self.embedder.provider_name
    
    @property
    def dimension(self) -> int:
        return self.embedder.dimension
    
    def ingest_source(self, workspace_id: str, source_id: str, title: str,
                      content: str, source_type: str) -> Dict[str, Any]:
        """Ingest a single source: chunk → embed → store.
        
        Returns metadata about what was ingested.
        """
        if workspace_id not in self._stores:
            self._stores[workspace_id] = []
            self._sources[workspace_id] = {}
        
        # Remove old chunks for this source (re-ingestion)
        self._stores[workspace_id] = [
            c for c in self._stores[workspace_id] if c.source_id != source_id
        ]
        
        # Chunk the source
        chunks = self.chunker.chunk_source(source_id, title, content, source_type)
        
        if not chunks:
            return {"source_id": source_id, "chunks": 0, "embedded": 0}
        
        # Embed all chunks
        texts = [c.text for c in chunks]
        embeddings = self.embedder.embed(texts)
        
        n_embedded = 0
        if embeddings and len(embeddings) == len(chunks):
            for chunk, emb in zip(chunks, embeddings):
                chunk.embedding = emb
                n_embedded += 1
        
        # Store
        self._stores[workspace_id].extend(chunks)
        self._sources[workspace_id][source_id] = {
            "title": title,
            "type": source_type,
            "chunks": len(chunks),
            "embedded": n_embedded,
            "ingested_at": time.time(),
        }
        
        total = len(self._stores[workspace_id])
        print(f"[VectorStore] Ingested '{title}' ({source_type}): {len(chunks)} chunks, {n_embedded} embedded. Store total: {total}")
        
        return {
            "source_id": source_id,
            "chunks": len(chunks),
            "embedded": n_embedded,
            "total_chunks_in_store": total,
        }
    
    def ingest_chunk_realtime(self, workspace_id: str, source_id: str,
                              title: str, text: str, source_type: str,
                              chunk_index: int) -> Optional[Chunk]:
        """Ingest a single chunk in real-time (for streaming transcription).
        
        This allows embedding text as it arrives from a live audio stream.
        """
        if workspace_id not in self._stores:
            self._stores[workspace_id] = []
            self._sources[workspace_id] = {}
        
        chunk_id = hashlib.md5(f"{source_id}:rt:{chunk_index}:{text[:30]}".encode()).hexdigest()[:12]
        chunk = Chunk(
            id=chunk_id,
            text=text.strip(),
            source_id=source_id,
            source_title=title,
            source_type=source_type,
            chunk_index=chunk_index,
            word_count=len(text.split()),
            created_at=time.time(),
        )
        
        # Embed
        embeddings = self.embedder.embed([text])
        if embeddings:
            chunk.embedding = embeddings[0]
        
        self._stores[workspace_id].append(chunk)
        return chunk
    
    def search(self, workspace_id: str, query: str, top_k: int = 10,
               threshold: float = 0.25, source_types: Optional[List[str]] = None
               ) -> List[SearchResult]:
        """Semantic search: embed query → cosine similarity against all chunks.
        
        This is the core real-time matching pipeline:
        1. Embed the query text
        2. Compute cosine similarity against every chunk in the store
        3. Filter by threshold and optional source type
        4. Return top-k results sorted by similarity
        """
        store = self._stores.get(workspace_id, [])
        if not store:
            return []
        
        # Embed the query
        query_embeddings = self.embedder.embed([query])
        if not query_embeddings:
            return []
        query_emb = query_embeddings[0]
        
        # Compute cosine similarity against all chunks with embeddings
        results: List[SearchResult] = []
        for chunk in store:
            if chunk.embedding is None:
                continue
            if source_types and chunk.source_type not in source_types:
                continue
            
            sim = self._cosine_similarity(query_emb, chunk.embedding)
            if sim >= threshold:
                results.append(SearchResult(chunk=chunk, similarity=sim))
        
        # Sort by similarity descending
        results.sort(key=lambda r: r.similarity, reverse=True)
        
        # Assign ranks and truncate
        for i, r in enumerate(results[:top_k]):
            r.rank = i + 1
        
        return results[:top_k]
    
    def get_store_stats(self, workspace_id: str) -> Dict[str, Any]:
        """Get statistics about the vector store for a workspace."""
        store = self._stores.get(workspace_id, [])
        sources = self._sources.get(workspace_id, {})
        
        n_embedded = sum(1 for c in store if c.embedding is not None)
        by_type: Dict[str, int] = {}
        for c in store:
            by_type[c.source_type] = by_type.get(c.source_type, 0) + 1
        
        return {
            "total_chunks": len(store),
            "embedded_chunks": n_embedded,
            "sources": len(sources),
            "chunks_by_type": by_type,
            "embedding_provider": self.embedder.provider_name,
            "embedding_dimension": self.embedder.dimension,
            "source_details": {
                sid: {
                    "title": meta["title"],
                    "type": meta["type"],
                    "chunks": meta["chunks"],
                    "embedded": meta["embedded"],
                }
                for sid, meta in sources.items()
            },
        }
    
    @staticmethod
    def _cosine_similarity(a: List[float], b: List[float]) -> float:
        """Compute cosine similarity between two vectors."""
        dot = sum(x * y for x, y in zip(a, b))
        na = math.sqrt(sum(x * x for x in a))
        nb = math.sqrt(sum(x * x for x in b))
        if na == 0 or nb == 0:
            return 0.0
        return dot / (na * nb)


# ── Global singleton ──────────────────────────────────────────────────────────

vector_store = VectorStore()
