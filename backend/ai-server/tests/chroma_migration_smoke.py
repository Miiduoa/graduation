"""Regression test for upgrading a local Chroma persistent store.

Use only a disposable directory and deterministic embeddings. Run "seed" with
the old Chroma version, then "verify" and "restart" with the candidate version
in separate Python processes. Run "rollback" against a restored pre-upgrade
snapshot using the isolated old runtime, never downgrade the migrated store
in place. No external embedding service or account is used.
"""

from __future__ import annotations

import argparse
import importlib.metadata
import sys
from pathlib import Path

AI_SERVER_ROOT = Path(__file__).resolve().parents[1]
if str(AI_SERVER_ROOT) not in sys.path:
    sys.path.insert(0, str(AI_SERVER_ROOT))

import config
from rag import indexer, retriever

# Must match the immutable legacy checkout used by CI for seed and rollback.
COLLECTION = "upgrade_test"
HOUSING_TEXT = "Campus housing: dormitory maintenance and repair requests."
BUS_TEXT = "Campus transit: shuttle bus arrivals and stations."
DOCS = [
    {
        "source": "smoke:housing",
        "text": HOUSING_TEXT,
        "metadata": {"campus": "pu", "category": "housing"},
    },
    {
        "source": "smoke:bus",
        "text": BUS_TEXT,
        "metadata": {"campus": "nchu", "category": "transit"},
    },
]


def embed(texts: list[str]) -> list[list[float]]:
    """Stable embeddings; never download or initialize model weights."""
    return [
        [1.0, 0.0, 0.0] if "housing" in text.lower() else [0.0, 1.0, 0.0]
        for text in texts
    ]


def assert_saved_records(expected_count: int) -> None:
    collection = indexer.get_or_create_collection(COLLECTION)
    assert collection.count() == expected_count, f"wrong row count: {collection.count()}"
    housing = collection.get(
        where={"source": "smoke:housing"}, include=["documents", "metadatas"]
    )
    assert housing["documents"] == [HOUSING_TEXT], housing
    assert housing["metadatas"][0]["campus"] == "pu", housing
    if expected_count == 2:
        bus = collection.get(
            where={"source": "smoke:bus"}, include=["documents", "metadatas"]
        )
        assert bus["documents"] == [BUS_TEXT], bus
    # Legacy records remain readable, but lack the public campus metadata
    # required by the current retriever and must not leak into scoped results.
    for school in (None, "pu", "nchu"):
        assert not retriever.retrieve(
            "housing", collection_name=COLLECTION, embedding_fn=embed, school_id=school
        )


def assert_school_scoped_records() -> None:
    # Exercise current indexing separately: its IDs and metadata intentionally
    # differ from the immutable legacy fixture, without migrating legacy rows.
    name = "upgrade_school_scope_test"
    documents = [
        {"source": "firestore:announcements", "text": HOUSING_TEXT,
         "metadata": {"schoolId": "pu", "visibility": "public"}},
        {"source": "firestore:events", "text": BUS_TEXT,
         "metadata": {"schoolId": "nchu", "visibility": "public"}},
    ]
    for _ in range(2):
        indexer.index_documents(documents, collection_name=name, embedding_fn=embed)
        assert indexer.get_or_create_collection(name).count() == 2
    matches = retriever.retrieve(
        "housing", top_k=1, collection_name=name, embedding_fn=embed, school_id="pu"
    )
    assert len(matches) == 1 and matches[0].text == HOUSING_TEXT, matches
    assert matches[0].source == "firestore:announcements", matches
    assert matches[0].score > 0.99, matches
    other = retriever.retrieve(
        "housing", top_k=1, collection_name=name, embedding_fn=embed, school_id="nchu"
    )
    assert [row.text for row in other] == [BUS_TEXT], other
    assert not retriever.retrieve("housing", collection_name=name, embedding_fn=embed)


def assert_legacy_rollback() -> None:
    # 舊版環境須維持隔離，不能誤用升級後的套件來宣稱已通過回復。
    assert importlib.metadata.version("chromadb") == "0.5.23"
    assert importlib.metadata.version("numpy") == "1.26.4"
    assert_saved_records(2)
    collection = indexer.get_or_create_collection(COLLECTION)
    for document in DOCS:
        row = collection.get(
            where={"source": document["source"]},
            include=["documents", "metadatas", "embeddings"],
        )
        assert row["documents"] == [document["text"]], row
        for key, value in document["metadata"].items():
            assert row["metadatas"][0][key] == value, row
        actual = list(row["embeddings"][0])
        expected = embed([document["text"]])[0]
        assert len(actual) == len(expected), actual
        assert all(abs(float(a) - b) < 1e-6 for a, b in zip(actual, expected)), actual


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("stage", choices=("seed", "verify", "restart", "rollback"))
    parser.add_argument("store", type=Path)
    args = parser.parse_args()
    store = args.store.expanduser().resolve()
    config.CHROMA_DIR = store
    indexer.CHROMA_DIR = store
    indexer._client = None

    if args.stage == "seed":
        assert not store.exists(), "seed requires a fresh isolated directory"
        count = indexer.index_documents(
            DOCS, collection_name=COLLECTION, embedding_fn=embed
        )
        assert count == 2, count
        assert_saved_records(2)
    elif args.stage == "verify":
        assert store.exists(), "migration store is missing"
        assert_saved_records(2)
        collection = indexer.get_or_create_collection(COLLECTION)
        housing = collection.get(where={"source": "smoke:housing"})
        # Preserve the legacy ID: the current indexer uses a different ID scheme.
        collection.upsert(
            ids=housing["ids"], documents=housing["documents"],
            metadatas=housing["metadatas"], embeddings=embed(housing["documents"]),
        )
        assert_saved_records(2)  # upsert does not duplicate the known ID
        indexer.delete_by_source("smoke:bus", collection_name=COLLECTION)
        assert_saved_records(1)
        assert_school_scoped_records()
    elif args.stage == "restart":
        assert store.exists(), "migration store is missing"
        assert_saved_records(1)
        indexer.index_documents(
            [DOCS[1]], collection_name=COLLECTION, embedding_fn=embed
        )
        assert_saved_records(2)
        assert_school_scoped_records()
    else:
        assert store.exists(), "restored legacy snapshot is missing"
        assert_legacy_rollback()

    print(f"Chroma compatibility {args.stage}: passed")


if __name__ == "__main__":
    main()
