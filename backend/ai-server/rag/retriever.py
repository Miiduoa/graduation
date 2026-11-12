"""Retriever – queries ChromaDB and returns relevant chunks."""

from __future__ import annotations

import logging
from dataclasses import dataclass

from rag.indexer import get_or_create_collection
from config import RAG_TOP_K
from rag.public_documents import is_public_visibility, retrieval_filter

logger = logging.getLogger(__name__)


@dataclass
class RetrievedChunk:
    text: str
    source: str
    score: float
    metadata: dict


def retrieve(
    query: str,
    top_k: int = RAG_TOP_K,
    collection_name: str = "campus",
    where: dict | None = None,
    embedding_fn=None,
    *,
    school_id: str | None = None,
) -> list[RetrievedChunk]:
    """Rank app help and public material from only the selected campus."""
    collection = get_or_create_collection(collection_name)

    if collection.count() == 0:
        return []

    query_kwargs: dict = {
        "query_texts": [query],
        "n_results": min(top_k, collection.count()),
        "include": ["documents", "metadatas", "distances"],
    }
    scope = retrieval_filter(school_id)
    query_kwargs["where"] = {"$and": [scope, where]} if where else scope
    if embedding_fn:
        query_kwargs.pop("query_texts")
        query_kwargs["query_embeddings"] = embedding_fn([query])

    results = collection.query(**query_kwargs)

    chunks: list[RetrievedChunk] = []
    docs = results.get("documents", [[]])[0]
    metas = results.get("metadatas", [[]])[0]
    dists = results.get("distances", [[]])[0]

    for text, meta, dist in zip(docs, metas, dists):
        meta = meta or {}
        if not is_public_visibility(meta.get("visibility")):
            continue
        chunks.append(RetrievedChunk(
            text=text,
            source=meta.get("source", "unknown"),
            score=1.0 - dist,
            metadata=meta,
        ))

    return chunks


def format_context(chunks: list[RetrievedChunk]) -> str:
    """Format retrieved chunks into a string suitable for a system prompt."""
    if not chunks:
        return ""
    lines: list[str] = []
    for i, c in enumerate(chunks, 1):
        lines.append(f"[{i}] ({c.source}, 相關度 {c.score:.0%})\n{c.text}")
    return "\n\n".join(lines)
