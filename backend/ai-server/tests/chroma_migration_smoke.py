"""Regression test for upgrading a local Chroma persistent store.

Use only a disposable directory and deterministic embeddings. Run "seed" with
the old Chroma version, then "verify" and "restart" with the candidate version
in separate Python processes. No external embedding service or account is used.
"""

from __future__ import annotations

import argparse
from pathlib import Path

import config
from rag import indexer, retriever

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
        matches = retriever.retrieve(
            "housing", top_k=1, collection_name=COLLECTION, embedding_fn=embed
        )
        assert len(matches) == 1 and matches[0].source == "smoke:housing", matches
        assert matches[0].score > 0.99, matches


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("stage", choices=("seed", "verify", "restart"))
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
        indexer.index_documents(
            [DOCS[0]], collection_name=COLLECTION, embedding_fn=embed
        )
        assert_saved_records(2)  # upsert does not duplicate the known ID
        indexer.delete_by_source("smoke:bus", collection_name=COLLECTION)
        assert_saved_records(1)
    else:
        assert store.exists(), "migration store is missing"
        assert_saved_records(1)
        indexer.index_documents(
            [DOCS[1]], collection_name=COLLECTION, embedding_fn=embed
        )
        assert_saved_records(2)

    print(f"Chroma compatibility {args.stage}: passed")


if __name__ == "__main__":
    main()
