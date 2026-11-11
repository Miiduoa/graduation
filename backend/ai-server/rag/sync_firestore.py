"""Sync Firestore collections into the ChromaDB vector store.

Can be run as a standalone script or called periodically by the scheduler.
"""

from __future__ import annotations

import json
import logging
from pathlib import Path

from config import DATA_DIR, FIREBASE_CRED_PATH
from rag.indexer import index_documents
from rag.public_documents import PUBLIC_FIELDS, public_document

logger = logging.getLogger(__name__)

_app: firebase_admin.App | None = None


def _get_firestore_db():
    global _app
    import firebase_admin
    from firebase_admin import credentials, firestore

    if _app is None:
        cred = credentials.Certificate(FIREBASE_CRED_PATH) if FIREBASE_CRED_PATH else credentials.ApplicationDefault()
        _app = firebase_admin.initialize_app(cred)
    return firestore.client()


def source_document_ids(source: str, collection_name: str = "campus") -> list[str]:
    from rag.indexer import get_or_create_collection

    data = get_or_create_collection(collection_name).get(where={"source": source})
    return list(data.get("ids") or [])


def delete_ids(ids: list[str], collection_name: str = "campus") -> None:
    if not ids:
        return
    from rag.indexer import get_or_create_collection

    get_or_create_collection(collection_name).delete(ids=ids)


def replace_source_documents(source: str, documents: list, collection_name: str = "campus") -> int:
    """Write the new rows first; only then drop previous rows for this source."""
    old_ids = source_document_ids(source, collection_name)
    count = index_documents(documents, collection_name=collection_name) if documents else 0
    if documents:
        current = set(source_document_ids(source, collection_name))
        stale = [doc_id for doc_id in old_ids if doc_id not in current]
    else:
        stale = old_ids
    delete_ids(stale, collection_name)
    return count


def sync_ok(result: dict | None) -> bool:
    return isinstance(result, dict) and bool(result) and all(value >= 0 for value in result.values())


def failed_collections(result: dict | None) -> set[str]:
    if not isinstance(result, dict):
        return set(PUBLIC_FIELDS)
    failed = {name for name, value in result.items() if value < 0}
    return failed | (set(PUBLIC_FIELDS) - set(result))


def sync_collection(collection_name: str, db=None) -> int:
    """Sync a single Firestore collection into ChromaDB."""
    if collection_name not in PUBLIC_FIELDS:
        return 0
    if db is None:
        db = _get_firestore_db()

    logger.info("Syncing collection: %s", collection_name)
    page_size = 500
    # Do not filter visibility in Firestore: older public docs omit the field.
    # Read every page first; only replace the old index after the write succeeds.
    query = db.collection(collection_name).limit(page_size)
    documents = []
    while True:
        page = list(query.stream())
        for doc in page:
            record = public_document(collection_name, doc.to_dict(), doc.id)
            if record:
                documents.append(record)
        if len(page) < page_size:
            break
        query = query.start_after(page[-1])

    count = replace_source_documents(f"firestore:{collection_name}", documents)
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


def sync_from_json_dump(
    dump_dir: str | Path | None = None,
    collections: set[str] | None = None,
) -> dict[str, int]:
    """Sync from local JSON dump files (for development without Firebase credentials)."""
    dump_path = Path(dump_dir) if dump_dir else DATA_DIR / "firestore_dump"
    wanted = set(PUBLIC_FIELDS) if collections is None else set(collections) & set(PUBLIC_FIELDS)
    if not dump_path.exists():
        logger.warning("No dump directory at %s, skipping JSON sync", dump_path)
        return {name: -1 for name in wanted}

    results: dict[str, int] = {}
    for json_file in dump_path.glob("*.json"):
        collection_name = json_file.stem
        if collection_name not in wanted:
            continue
        try:
            data = json.loads(json_file.read_text(encoding="utf-8"))
            if not isinstance(data, list):
                data = [data]
            documents = []
            for idx, item in enumerate(data):
                record = public_document(collection_name, item, str(idx))
                if record:
                    documents.append(record)
            results[collection_name] = replace_source_documents(
                f"firestore:{collection_name}", documents
            )
        except Exception as e:
            logger.error("Failed to sync JSON dump %s: %s", json_file, e)
            results[collection_name] = -1
    for name in wanted:
        results.setdefault(name, -1)
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
        return {"legacy": 0, "remaining": 0, "rebuilt": False, "retryable": False}
    results: dict = {"legacy": len(leftover)}
    try:
        results["firestore"] = sync_all(db)
    except Exception as exc:
        logger.warning("Legacy Firestore re-sync from live collections failed: %s", exc)
        results["firestore"] = None
    leftover = legacy_unscoped_firestore_ids(collection_name)
    need = failed_collections(results.get("firestore"))
    if leftover or need:
        results["json"] = sync_from_json_dump(dump_dir, collections=need or None)
        leftover = legacy_unscoped_firestore_ids(collection_name)
    results["remaining"] = len(leftover)
    results["rebuilt"] = results["remaining"] == 0 and (
        sync_ok(results.get("firestore")) or sync_ok(results.get("json"))
    )
    results["retryable"] = not results["rebuilt"]
    if leftover or results["retryable"]:
        logger.error("%s legacy Firestore RAG records still lack school scope", results["remaining"])
    return results


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    print("Syncing from JSON dump (dev mode)...")
    r = sync_from_json_dump()
    print(f"Results: {r}")
