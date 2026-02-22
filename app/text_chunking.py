"""
Text chunking for claim extraction pipeline.

Splits documents into overlapping chunks with stable IDs so the LLM can
process arbitrarily long documents and return character-level offsets.
"""

from __future__ import annotations
import re
from typing import List, TypedDict


class Chunk(TypedDict):
    chunk_id: str
    text: str
    start_char_global: int
    end_char_global: int


def normalize_text(text: str) -> str:
    """Collapse excessive whitespace, normalize newlines, strip leading/trailing."""
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def chunk_text(
    text: str,
    max_chunk_chars: int = 3000,
    overlap_chars: int = 200,
) -> List[Chunk]:
    """Split *normalized* text into overlapping chunks.

    Chunking rules:
    - Split by double-newlines into paragraphs.
    - Accumulate paragraphs until reaching max_chunk_chars.
    - Add overlap of last overlap_chars from previous chunk to next chunk.
    """
    paragraphs = re.split(r"\n\n+", text)
    chunks: List[Chunk] = []
    current_paras: List[str] = []
    current_len = 0
    global_offset = 0
    chunk_idx = 0

    # Map each paragraph to its global start offset
    para_offsets: List[int] = []
    pos = 0
    for p in paragraphs:
        idx = text.find(p, pos)
        para_offsets.append(idx if idx >= 0 else pos)
        pos = (idx if idx >= 0 else pos) + len(p)

    def _flush(paras: List[str], first_para_idx: int) -> None:
        nonlocal chunk_idx
        if not paras:
            return
        chunk_text_joined = "\n\n".join(paras)
        start = para_offsets[first_para_idx]
        end = start + len(chunk_text_joined)
        chunks.append(Chunk(
            chunk_id=f"c{chunk_idx:04d}",
            text=chunk_text_joined,
            start_char_global=start,
            end_char_global=end,
        ))
        chunk_idx += 1

    first_para_idx = 0
    for i, para in enumerate(paragraphs):
        sep_len = 2 if current_paras else 0  # "\n\n" separator
        if current_len + sep_len + len(para) > max_chunk_chars and current_paras:
            _flush(current_paras, first_para_idx)

            # Build overlap: take trailing text from previous chunk
            prev_text = "\n\n".join(current_paras)
            if overlap_chars > 0 and len(prev_text) > overlap_chars:
                overlap_text = prev_text[-overlap_chars:]
                # Start new chunk with overlap + current paragraph
                current_paras = [overlap_text, para]
                current_len = len(overlap_text) + 2 + len(para)
            else:
                current_paras = [para]
                current_len = len(para)
            first_para_idx = i
        else:
            current_paras.append(para)
            current_len += sep_len + len(para)
            if not current_paras[:-1]:
                first_para_idx = i

    _flush(current_paras, first_para_idx)

    # If text was empty, produce one empty chunk
    if not chunks:
        chunks.append(Chunk(
            chunk_id="c0000",
            text="",
            start_char_global=0,
            end_char_global=0,
        ))

    return chunks
