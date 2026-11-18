"""Document indexer – chunks text and upserts into ChromaDB."""

from __future__ import annotations

import hashlib
import json
import logging
from typing import Sequence

import chromadb
from chromadb.config import Settings
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
        _client = chromadb.PersistentClient(
            path=str(CHROMA_DIR),
            settings=Settings(chroma_api_impl="chromadb.api.rust.RustBindingsAPI"),
        )
    return _client


def _validate_embedding_configs(value: object) -> None:
    """Check raw JSON before Chroma reconstructs collection/schema functions."""
    if isinstance(value, dict):
        for key, item in value.items():
            if key == "embedding_function" and item not in (
                None,
                {"type": "legacy"},
                {"type": "unknown"},
                {"type": "known", "name": "default", "config": {}},
            ):
                raise ValueError("Unsupported local RAG embedding configuration")
            _validate_embedding_configs(item)
    elif isinstance(value, list):
        for item in value:
            _validate_embedding_configs(item)


def get_or_create_collection(name: str = "campus") -> chromadb.Collection:
    client = get_chroma_client()
    collection = client.get_or_create_collection(
        name=name,
        metadata={"hnsw:space": "cosine"},
    )
    # configuration/schema properties instantiate stored embedding functions.
    # The raw model keeps legacy/default stores readable without trusting a
    # restored collection to choose a model repository or executable loader.
    model = collection.get_model()
    schema = model.serialized_schema
    if not isinstance(model.configuration_json, dict) or (
        schema is not None and not isinstance(schema, dict)
    ):
        raise ValueError("Unsupported local RAG configuration")
    _validate_embedding_configs(model.configuration_json)
    if schema is not None:
        defaults = schema.get("defaults", {})
        keys = schema.get("keys", {})
        if (
            set(schema) - {"defaults", "keys", "cmek"}
            or schema.get("cmek") is not None
            or not isinstance(defaults, dict)
            or not isinstance(keys, dict)
        ):
            raise ValueError("Unsupported local RAG configuration")
        _validate_embedding_configs(defaults)
        # Names inside schema.keys are document metadata names, not config keys.
        for value_types in keys.values():
            if not isinstance(value_types, dict):
                raise ValueError("Unsupported local RAG configuration")
            _validate_embedding_configs(value_types)
    return collection


def index_written_ids(
    documents: Sequence[dict],
    collection_name: str = "campus",
    embedding_fn=None,
) -> tuple[int, list[str]]:
    """Index a batch of documents and return written chunk IDs.

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
            identity = [source, extra_meta.get("schoolId"), extra_meta.get("firestore_id"), i, chunk]
            doc_id = hashlib.sha256(json.dumps(identity, ensure_ascii=False).encode()).hexdigest()
            all_chunks.append(chunk)
            all_ids.append(doc_id)
            all_metas.append({**extra_meta, "source": source, "chunk_index": i})

    if not all_chunks:
        return 0, []

    batch_size = 256
    written: list[str] = []
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
        written.extend(batch_ids)

    logger.info("Indexed %d chunks from %d documents into '%s'", len(all_chunks), len(documents), collection_name)
    return len(all_chunks), written


def index_documents(
    documents: Sequence[dict],
    collection_name: str = "campus",
    embedding_fn=None,
) -> int:
    count, _ids = index_written_ids(documents, collection_name=collection_name, embedding_fn=embedding_fn)
    return count


def delete_by_source(source: str, collection_name: str = "campus") -> None:
    collection = get_or_create_collection(collection_name)
    collection.delete(where={"source": source})


def get_collection_stats(collection_name: str = "campus") -> dict:
    collection = get_or_create_collection(collection_name)
    return {"name": collection_name, "count": collection.count()}
