"""Sync Firestore collections into the ChromaDB vector store.

Can be run as a standalone script or called periodically by the scheduler.
"""

from __future__ import annotations

import hashlib
import json
import logging
import math
from pathlib import Path

from config import DATA_DIR, FIREBASE_CRED_PATH
from rag.indexer import index_written_ids
from rag.public_documents import PUBLIC_FIELDS, public_document, public_school_id

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
    if documents:
        count, written = index_written_ids(documents, collection_name=collection_name)
        stale = [doc_id for doc_id in old_ids if doc_id not in set(written)]
    else:
        count, written = 0, []
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


SNAPSHOT_FORMAT = "nuni-rag-firestore-snapshot-v1"


def _unique_json_object(pairs: list[tuple[str, object]]) -> dict:
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("Duplicate JSON key in snapshot")
        result[key] = value
    return result


def _reject_json_constant(value: str) -> None:
    raise ValueError("Non-finite JSON number in snapshot")


def _finite_json_float(value: str) -> float:
    number = float(value)
    if not math.isfinite(number):
        raise ValueError("Non-finite JSON number in snapshot")
    return number


def _snapshot_documents(raw: bytes, collection_name: str, trusted_sha256: str) -> list[dict]:
    """Validate caller-approved bytes completely before touching the index."""
    if hashlib.sha256(raw).hexdigest() != trusted_sha256:
        raise ValueError("Snapshot does not match the caller's trusted SHA-256")
    data = json.loads(
        raw.decode("utf-8"), object_pairs_hook=_unique_json_object,
        parse_constant=_reject_json_constant, parse_float=_finite_json_float,
    )
    if (
        not isinstance(data, dict)
        or set(data) != {"format", "collection", "scope", "complete", "documents"}
        or data["format"] != SNAPSHOT_FORMAT
        or data["collection"] != collection_name
        or data["scope"] != "all_schools"
        or data["complete"] is not True
        or not isinstance(data["documents"], list)
    ):
        raise ValueError("Expected a complete all-schools snapshot for this collection")

    documents = []
    seen_ids: set[str] = set()
    for item in data["documents"]:
        if not isinstance(item, dict) or set(item) != {"id", "data"}:
            raise ValueError("Invalid snapshot document")
        document_id, row = item["id"], item["data"]
        if (
            not isinstance(document_id, str) or not document_id.strip()
            or document_id != document_id.strip() or "/" in document_id
            or document_id in seen_ids or not isinstance(row, dict)
        ):
            raise ValueError("Snapshot requires unique, stable Firestore document IDs")
        seen_ids.add(document_id)
        if not public_school_id(row.get("schoolId")):
            raise ValueError("Snapshot document lacks a valid school scope")
        if row.get("visibility") not in (None, "public", "private", "school"):
            raise ValueError("Unknown snapshot document visibility")
        record = public_document(collection_name, row, document_id)
        if record:
            documents.append(record)
        elif row.get("visibility") in (None, "public"):
            raise ValueError("Public snapshot document has no display fields")
    return documents


def sync_from_json_dump(
    dump_dir: str | Path | None = None,
    collections: set[str] | None = None,
    *,
    trusted_snapshot_sha256: dict[str, str] | None = None,
) -> dict[str, int]:
    """Replace sources only from explicitly trusted, complete JSON snapshots.

    Plain development dumps and automatic startup fallback have no replacement
    authority. The caller must independently verify completeness/freshness and
    supply each file's SHA-256; a declaration inside a file cannot grant trust.
    See rag/JSON_SNAPSHOTS.md for the all-schools snapshot contract.
    """
    dump_path = Path(dump_dir) if dump_dir else DATA_DIR / "firestore_dump"
    wanted = set(PUBLIC_FIELDS) if collections is None else set(collections)
    failed = {name: -1 for name in wanted}
    if not wanted:
        return {}
    if (
        not wanted <= set(PUBLIC_FIELDS)
        or not isinstance(trusted_snapshot_sha256, dict)
        or any(not isinstance(trusted_snapshot_sha256.get(name), str) for name in wanted)
    ):
        logger.warning("JSON sync requires trusted complete snapshots for all requested collections")
        return failed

    # Validate every requested file before any source is read, written or deleted.
    # Read bytes once so the digest and parser operate on the same content.
    prepared: dict[str, list[dict]] = {}
    try:
        for name in sorted(wanted):
            prepared[name] = _snapshot_documents(
                (dump_path / f"{name}.json").read_bytes(), name,
                trusted_snapshot_sha256[name],
            )
    except (OSError, ValueError, RecursionError) as exc:
        logger.error("JSON snapshot validation failed; index unchanged: %s", exc)
        return failed

    results: dict[str, int] = {}
    for name, documents in prepared.items():
        try:
            results[name] = replace_source_documents(f"firestore:{name}", documents)
        except Exception as exc:
            logger.error("Failed to sync JSON snapshot %s: %s", name, exc)
            results[name] = -1
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


def migrate_legacy_firestore_index(
    db=None,
    dump_dir: str | Path | None = None,
    collection_name: str = "campus",
    *,
    trusted_snapshot_sha256: dict[str, str] | None = None,
) -> dict:
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
    if need:
        results["json"] = sync_from_json_dump(
            dump_dir, collections=need, trusted_snapshot_sha256=trusted_snapshot_sha256,
        )
        leftover = legacy_unscoped_firestore_ids(collection_name)
    else:
        leftover = leftover or legacy_unscoped_firestore_ids(collection_name)
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
    print("Checking JSON snapshots (no trusted digests configured; index will be preserved)...")
    r = sync_from_json_dump()
    print(f"Results: {r}")
