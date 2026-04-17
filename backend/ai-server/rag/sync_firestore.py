"""Sync Firestore collections into the ChromaDB vector store.

Can be run as a standalone script or called periodically by the scheduler.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime
from pathlib import Path

import firebase_admin
from firebase_admin import credentials, firestore

from config import (
    FIREBASE_CRED_PATH,
    FIRESTORE_COLLECTIONS,
    DATA_DIR,
)
from rag.indexer import index_documents, delete_by_source

logger = logging.getLogger(__name__)

_app: firebase_admin.App | None = None


def _get_firestore_db():
    global _app
    if _app is None:
        cred = credentials.Certificate(FIREBASE_CRED_PATH) if FIREBASE_CRED_PATH else credentials.ApplicationDefault()
        _app = firebase_admin.initialize_app(cred)
    return firestore.client()


def _doc_to_text(collection: str, data: dict) -> str:
    """Convert a Firestore document to a searchable text representation."""
    parts: list[str] = [f"[{collection}]"]

    field_order = {
        "announcements": ["title", "body", "source", "category", "publishedAt"],
        "events": ["title", "description", "location", "startsAt", "endsAt", "organizer"],
        "courses": ["name", "code", "teacher", "description", "credits", "department"],
        "cafeterias": ["name", "location", "openingHours", "description"],
        "menuItems": ["name", "description", "price", "category", "cafeteria"],
        "pois": ["name", "category", "description", "address", "openingHours"],
    }

    fields = field_order.get(collection, list(data.keys()))
    for key in fields:
        value = data.get(key)
        if value is None:
            continue
        if isinstance(value, datetime):
            value = value.strftime("%Y/%m/%d %H:%M")
        elif isinstance(value, dict):
            value = json.dumps(value, ensure_ascii=False)
        parts.append(f"{key}: {value}")

    return "\n".join(parts)


def sync_collection(collection_name: str, db=None) -> int:
    """Sync a single Firestore collection into ChromaDB."""
    if db is None:
        db = _get_firestore_db()

    logger.info("Syncing collection: %s", collection_name)
    delete_by_source(f"firestore:{collection_name}")

    docs_ref = db.collection(collection_name).limit(500)
    docs = list(docs_ref.stream())

    documents = []
    for doc in docs:
        data = doc.to_dict()
        text = _doc_to_text(collection_name, data)
        documents.append({
            "text": text,
            "source": f"firestore:{collection_name}",
            "metadata": {
                "firestore_id": doc.id,
                "collection": collection_name,
                "updated_at": datetime.now().isoformat(),
            },
        })

    if documents:
        count = index_documents(documents)
        logger.info("Synced %d documents (%d chunks) from %s", len(documents), count, collection_name)
        return count
    return 0


def sync_all(db=None) -> dict[str, int]:
    """Sync all configured Firestore collections."""
    results: dict[str, int] = {}
    for name in FIRESTORE_COLLECTIONS:
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
        try:
            data = json.loads(json_file.read_text(encoding="utf-8"))
            if not isinstance(data, list):
                data = [data]

            delete_by_source(f"firestore:{collection_name}")
            documents = []
            for item in data:
                text = _doc_to_text(collection_name, item)
                documents.append({
                    "text": text,
                    "source": f"firestore:{collection_name}",
                    "metadata": {"collection": collection_name},
                })
            results[collection_name] = index_documents(documents) if documents else 0
        except Exception as e:
            logger.error("Failed to sync JSON dump %s: %s", json_file, e)
            results[collection_name] = -1

    return results


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    print("Syncing from JSON dump (dev mode)...")
    r = sync_from_json_dump()
    print(f"Results: {r}")
