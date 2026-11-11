"""Sync Firestore collections into the ChromaDB vector store.

Can be run as a standalone script or called periodically by the scheduler.
"""

from __future__ import annotations

import json
import logging
from pathlib import Path

import firebase_admin
from firebase_admin import credentials, firestore

from config import DATA_DIR, FIREBASE_CRED_PATH
from rag.indexer import index_documents, delete_by_source
from rag.public_documents import PUBLIC_FIELDS, public_document

logger = logging.getLogger(__name__)

_app: firebase_admin.App | None = None


def _get_firestore_db():
    global _app
    if _app is None:
        cred = credentials.Certificate(FIREBASE_CRED_PATH) if FIREBASE_CRED_PATH else credentials.ApplicationDefault()
        _app = firebase_admin.initialize_app(cred)
    return firestore.client()


def sync_collection(collection_name: str, db=None) -> int:
    """Sync a single Firestore collection into ChromaDB."""
    if collection_name not in PUBLIC_FIELDS:
        return 0
    if db is None:
        db = _get_firestore_db()

    logger.info("Syncing collection: %s", collection_name)
    delete_by_source(f"firestore:{collection_name}")

    page_size = 500
    # Do not filter visibility in Firestore: older public docs omit the field.
    query = db.collection(collection_name).limit(page_size)
    count = 0
    while True:
        page = list(query.stream())
        documents = []
        for doc in page:
            record = public_document(collection_name, doc.to_dict(), doc.id)
            if record:
                documents.append(record)
        if documents:
            count += index_documents(documents)
        if len(page) < page_size:
            break
        query = query.start_after(page[-1])

    logger.info("Synced %d public chunks from %s", count, collection_name)
    return count


def sync_all(db=None) -> dict[str, int]:
    """Sync all configured Firestore collections."""
    results: dict[str, int] = {}
    for name in PUBLIC_FIELDS:
        try:
            results[name] = sync_collection(name, db)
        except Exception as e:
            logger.error("Failed to sync %s: %s", name, e)
            results[name] = -1
    return results


def sync_from_json_dump(dump_dir: str | Path | None = None) -> dict[str, int]:
    """Sync from local JSON dump files (for development without Firebase credentials)."""
    dump_path = Path(dump_dir) if dump_dir else DATA_DIR / "firestore_dump"
    if not dump_path.exists():
        logger.warning("No dump directory at %s, skipping JSON sync", dump_path)
        return {}

    results: dict[str, int] = {}
    for json_file in dump_path.glob("*.json"):
        collection_name = json_file.stem
        if collection_name not in PUBLIC_FIELDS:
            continue
        try:
            data = json.loads(json_file.read_text(encoding="utf-8"))
            if not isinstance(data, list):
                data = [data]

            delete_by_source(f"firestore:{collection_name}")
            documents = []
            for idx, item in enumerate(data):
                record = public_document(collection_name, item, str(idx))
                if record:
                    documents.append(record)
            results[collection_name] = index_documents(documents) if documents else 0
        except Exception as e:
            logger.error("Failed to sync JSON dump %s: %s", json_file, e)
            results[collection_name] = -1

    return results


def legacy_unscoped_firestore_ids(collection_name: str = "campus") -> list[str]:
    """Legacy sync wrote firestore chunks without schoolId; those cannot be scoped."""
    from rag.indexer import get_or_create_collection

    collection = get_or_create_collection(collection_name)
    data = collection.get(include=["metadatas"])
    leftover: list[str] = []
    for doc_id, meta in zip(data.get("ids") or [], data.get("metadatas") or []):
        meta = meta or {}
        source = str(meta.get("source") or "")
        if source.startswith("firestore:") and not meta.get("schoolId"):
            leftover.append(doc_id)
    return leftover


def migrate_legacy_firestore_index(db=None, dump_dir: str | Path | None = None, collection_name: str = "campus") -> dict:
    """Rebuild unscoped Firestore RAG rows from source before school filters apply.

    Unscoped rows are never opened to every campus. If source data is unavailable,
    they stay unscoped and remain invisible to school-filtered retrieval.
    """
    leftover = legacy_unscoped_firestore_ids(collection_name)
    if not leftover:
        return {"legacy": 0, "remaining": 0, "rebuilt": False}
    results = {"legacy": len(leftover)}
    try:
        results["firestore"] = sync_all(db)
    except Exception as exc:
        logger.warning("Legacy Firestore re-sync from live collections failed: %s", exc)
        results["firestore"] = None
    leftover = legacy_unscoped_firestore_ids(collection_name)
    if leftover:
        results["json"] = sync_from_json_dump(dump_dir)
        leftover = legacy_unscoped_firestore_ids(collection_name)
    results["remaining"] = len(leftover)
    results["rebuilt"] = results["remaining"] < results["legacy"]
    if leftover:
        logger.error("%s legacy Firestore RAG records still lack school scope", len(leftover))
    return results


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    print("Syncing from JSON dump (dev mode)...")
    r = sync_from_json_dump()
    print(f"Results: {r}")
