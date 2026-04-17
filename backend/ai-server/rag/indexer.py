"""Document indexer – chunks text and upserts into ChromaDB."""

from __future__ import annotations

import hashlib
import logging
from typing import Sequence

import chromadb
from langchain_text_splitters import RecursiveCharacterTextSplitter

from config import CHROMA_DIR, RAG_CHUNK_SIZE, RAG_CHUNK_OVERLAP

logger = logging.getLogger(__name__)

_client: chromadb.ClientAPI | None = None
_splitter = RecursiveCharacterTextSplitter(
    chunk_size=RAG_CHUNK_SIZE,
    chunk_overlap=RAG_CHUNK_OVERLAP,
    separators=["\n\n", "\n", "。", "，", "、", " ", ""],
)


def get_chroma_client() -> chromadb.ClientAPI:
    global _client
    if _client is None:
        _client = chromadb.PersistentClient(path=str(CHROMA_DIR))
    return _client


def get_or_create_collection(name: str = "campus") -> chromadb.Collection:
    client = get_chroma_client()
    return client.get_or_create_collection(
        name=name,
        metadata={"hnsw:space": "cosine"},
    )


def _doc_id(source: str, idx: int, text: str = "") -> str:
    h = hashlib.md5(f"{source}:{idx}:{text[:80]}".encode()).hexdigest()[:12]
    return f"{source}_{idx}_{h}"


def index_documents(
    documents: Sequence[dict],
    collection_name: str = "campus",
    embedding_fn=None,
) -> int:
    """Index a batch of documents.

    Each document dict must have ``text`` and ``source`` keys,
    and may optionally include ``metadata``.
    """
    collection = get_or_create_collection(collection_name)

    all_chunks: list[str] = []
    all_ids: list[str] = []
    all_metas: list[dict] = []

    for doc in documents:
        text = doc["text"]
        source = doc.get("source", "unknown")
        extra_meta = doc.get("metadata", {})
        chunks = _splitter.split_text(text)

        for i, chunk in enumerate(chunks):
            doc_id = _doc_id(source, i, chunk)
            all_chunks.append(chunk)
            all_ids.append(doc_id)
            all_metas.append({"source": source, "chunk_index": i, **extra_meta})

    if not all_chunks:
        return 0

    batch_size = 256
    for start in range(0, len(all_chunks), batch_size):
        end = start + batch_size
        batch_texts = all_chunks[start:end]
        batch_ids = all_ids[start:end]
        batch_metas = all_metas[start:end]

        kwargs: dict = {
            "ids": batch_ids,
            "documents": batch_texts,
            "metadatas": batch_metas,
        }
        if embedding_fn:
            kwargs["embeddings"] = embedding_fn(batch_texts)

        collection.upsert(**kwargs)

    logger.info("Indexed %d chunks from %d documents into '%s'", len(all_chunks), len(documents), collection_name)
    return len(all_chunks)


def delete_by_source(source: str, collection_name: str = "campus") -> None:
    collection = get_or_create_collection(collection_name)
    collection.delete(where={"source": source})


def get_collection_stats(collection_name: str = "campus") -> dict:
    collection = get_or_create_collection(collection_name)
    return {"name": collection_name, "count": collection.count()}
