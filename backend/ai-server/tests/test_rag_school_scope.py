"""Public RAG tests use disposable records and deterministic offline embeddings."""

import json
import tempfile
import unittest
from importlib.util import find_spec
from pathlib import Path
from unittest.mock import Mock, patch

from rag.public_documents import public_document


def announcement(school, title="午餐時段"):
    return {"title": title, "visibility": "public", "schoolId": school}


class PublicRecordTests(unittest.TestCase):
    def test_requires_public_collection_visibility_and_school(self):
        for school in (None, "", "all", "unknown", "unavailable-campus", {}, "pu/path"):
            self.assertIsNone(public_document("events", announcement(school), "1"))
        for visibility in ("private", "school", True):
            row = {**announcement("pu"), "visibility": visibility}
            self.assertIsNone(public_document("events", row, "1"))
        legacy = {"title": "午餐時段", "schoolId": "pu", "body": "舊公告"}
        self.assertEqual(public_document("announcements", legacy, "1")["metadata"]["visibility"], "public")
        self.assertIsNone(public_document("enrollments", announcement("pu"), "1"))
        self.assertIsNone(public_document("users/1/courses", announcement("pu"), "1"))

    def test_only_public_display_fields_are_serialized(self):
        row = {**announcement("tw-nchu"), "body": {"private": "private body"}, "uid": "private uid"}
        document = public_document("announcements", row, "1")
        self.assertNotIn("private", document["text"])
        self.assertEqual(document["metadata"], {"schoolId": "nchu", "visibility": "public", "firestore_id": "1"})


HAS_RAG = find_spec("chromadb") and find_spec("langchain_text_splitters")


@unittest.skipUnless(HAS_RAG, "requires local RAG dependencies")
class RetrievalTests(unittest.TestCase):
    def test_filter_on_each_request(self):
        import chromadb
        from rag import indexer, retriever

        client = chromadb.EphemeralClient()
        collection = client.get_or_create_collection("campus_scope_test")
        self.addCleanup(client.delete_collection, collection.name)
        self.enterContext(patch.object(indexer, "get_or_create_collection", return_value=collection))
        self.enterContext(patch.object(retriever, "get_or_create_collection", return_value=collection))

        def embed(texts):
            return [[1.0, 0.0] if "靜宜" in text else [0.0, 1.0] for text in texts]

        documents = [
            public_document("announcements", announcement("tw-pu"), "1"),
            public_document("announcements", announcement("tw-nchu"), "1"),
            public_document("announcements", announcement("pu", "靜宜限定"), "2"),
            {"source": "app:navigation", "text": "課表操作", "metadata": {}},
            {"source": "firestore:announcements", "text": "舊索引", "metadata": {}},
            {"source": "firestore:announcements", "text": "缺標記舊公告", "metadata": {"schoolId": "nchu"}},
            {"source": "firestore:announcements", "text": "內部公告", "metadata": {"visibility": "school", "schoolId": "nchu"}},
            {"source": "firestore:enrollments", "text": "私有課籍", "metadata": {"visibility": "public", "schoolId": "nchu"}},
        ]
        indexer.index_documents(documents, embedding_fn=embed)
        self.assertEqual(collection.count(), len(documents))
        for school, expected in (("tw-pu", "pu"), ("nchu", "nchu"), ("tw-nchu", "nchu"), ("pu", "pu")):
            chunks = retriever.retrieve("靜宜限定", school_id=school, embedding_fn=embed, top_k=10)
            self.assertEqual({c.source for c in chunks}, {"app:navigation", "firestore:announcements"})
            campus = [c for c in chunks if c.source.startswith("firestore:")]
            self.assertEqual({c.metadata["schoolId"] for c in campus}, {expected})
            self.assertTrue(all(c.metadata.get("visibility") in (None, "public") for c in campus))
            self.assertEqual(len(campus), 2)
        # The strongest semantic match belongs to another school. Scoped top-1 still finds this campus.
        first = retriever.retrieve(
            "靜宜限定", top_k=1, school_id="nchu", where={"source": "firestore:announcements"}, embedding_fn=embed,
        )
        self.assertEqual([row.metadata["schoolId"] for row in first], ["nchu"])
        # No school (including self-instruct) sees only the app guide.
        self.assertEqual([c.text for c in retriever.retrieve("靜宜限定", embedding_fn=embed)], ["課表操作"])
        narrowed = retriever.retrieve("靜宜限定", school_id="nchu", where={"schoolId": "pu"}, embedding_fn=embed)
        self.assertEqual(narrowed, [])


    def test_legacy_firestore_index_is_rebuilt_with_school_scope(self):
        import chromadb
        from rag import indexer, retriever, sync_firestore as sync

        client = chromadb.EphemeralClient()
        collection = client.get_or_create_collection("campus_legacy_scope")
        self.addCleanup(client.delete_collection, collection.name)
        self.enterContext(patch.object(indexer, "get_or_create_collection", return_value=collection))
        self.enterContext(patch.object(retriever, "get_or_create_collection", return_value=collection))

        def embed(texts):
            return [[1.0, 0.0] if "午餐" in text else [0.0, 1.0] for text in texts]

        indexer.index_documents(
            [
                {
                    "source": "firestore:announcements",
                    "text": "[announcements]\ntitle: 午餐時段\nbody: 舊公告",
                    "metadata": {"firestore_id": "old-1", "collection": "announcements"},
                },
                {"source": "app:navigation", "text": "課表操作", "metadata": {}},
            ],
            embedding_fn=embed,
        )
        before = retriever.retrieve("午餐時段", school_id="nchu", embedding_fn=embed, top_k=10)
        self.assertEqual([c.text for c in before if c.source.startswith("firestore:")], [])

        with tempfile.TemporaryDirectory() as folder:
            (Path(folder) / "announcements.json").write_text(
                '[{"title": "午餐時段", "body": "舊公告", "schoolId": "nchu"}]',
                encoding="utf-8",
            )
            result = sync.migrate_legacy_firestore_index(dump_dir=folder)
        self.assertGreater(result["legacy"], 0)
        self.assertEqual(result["remaining"], 0)
        self.assertTrue(result["rebuilt"])
        found = retriever.retrieve("午餐時段", school_id="nchu", embedding_fn=embed, top_k=10)
        campus = [c for c in found if c.source.startswith("firestore:")]
        self.assertTrue(campus)
        self.assertEqual({c.metadata["schoolId"] for c in campus}, {"nchu"})
        other = retriever.retrieve("午餐時段", school_id="pu", embedding_fn=embed, top_k=10)
        self.assertEqual([c for c in other if c.source.startswith("firestore:")], [])
        self.assertEqual(
            [c.text for c in retriever.retrieve("午餐時段", embedding_fn=embed)],
            ["課表操作"],
        )


@unittest.skipUnless(HAS_RAG and find_spec("firebase_admin"), "requires Firestore and local RAG dependencies")
class SyncTests(unittest.TestCase):
    def test_firestore_and_json_apply_the_same_policy(self):
        from rag import sync_firestore as sync

        rows = [
            announcement("nchu"),
            {**announcement("nthu"), "visibility": "private"},
            announcement(None),
            {"title": "舊公告", "schoolId": "nchu", "body": "沒有公開標記"},
        ]
        db = Mock()
        db.collection.return_value.limit.return_value.stream.return_value = [
            Mock(id=str(i), to_dict=Mock(return_value=row)) for i, row in enumerate(rows)
        ]
        with tempfile.TemporaryDirectory() as folder, patch.object(sync, "source_document_ids", return_value=[]), patch.object(sync, "delete_ids"), patch.object(sync, "index_written_ids", side_effect=lambda documents, collection_name="campus", embedding_fn=None: (len(documents), [f"new-{i}" for i in range(len(documents))])) as index:
            self.assertEqual(sync.sync_collection("users", db), 0)
            db.collection.assert_not_called()
            self.assertEqual(sync.sync_collection("announcements", db), 2)
            (Path(folder) / "announcements.json").write_text(json.dumps(rows))
            (Path(folder) / "users.json").write_text(json.dumps(rows))
            self.assertEqual(sync.sync_from_json_dump(folder), {"announcements": 2})
            self.assertEqual(index.call_args_list[0], index.call_args_list[1])
            self.assertEqual({item["metadata"]["schoolId"] for item in index.call_args.args[0]}, {"nchu"})

    def test_a_full_first_page_does_not_hide_another_campus(self):
        from rag import sync_firestore as sync

        db = Mock()
        query = db.collection.return_value.limit.return_value
        first = [Mock(id=str(i), to_dict=Mock(return_value=announcement("pu"))) for i in range(500)]
        query.stream.return_value = first
        query.start_after.return_value.stream.return_value = [Mock(id="next", to_dict=Mock(return_value=announcement("nchu")))]
        with patch.object(sync, "source_document_ids", return_value=[]), patch.object(sync, "delete_ids"), patch.object(sync, "index_written_ids", side_effect=lambda documents, collection_name="campus", embedding_fn=None: (len(documents), [f"new-{i}" for i in range(len(documents))])) as index:
            self.assertEqual(sync.sync_collection("announcements", db), 501)
        query.start_after.assert_called_once_with(first[-1])
        self.assertEqual(len(index.call_args.args[0]), 501)
        self.assertEqual(index.call_args.args[0][-1]["metadata"]["schoolId"], "nchu")



class MigrationSafetyTests(unittest.TestCase):
    def _stub_rag_imports(self):
        import sys
        import types
        if "chromadb" not in sys.modules:
            chromadb = types.ModuleType("chromadb")
            chromadb.config = types.ModuleType("chromadb.config")
            chromadb.config.Settings = object
            sys.modules["chromadb"] = chromadb
            sys.modules["chromadb.config"] = chromadb.config
        if "langchain_text_splitters" not in sys.modules:
            langchain = types.ModuleType("langchain_text_splitters")
            class _Splitter:
                def __init__(self, *args, **kwargs):
                    pass
            langchain.RecursiveCharacterTextSplitter = _Splitter
            sys.modules["langchain_text_splitters"] = langchain
        from rag import sync_firestore as sync
        return sync

    def test_failed_firestore_read_keeps_old_index_and_uses_json_fallback(self):
        sync = self._stub_rag_imports()
        db = Mock()
        db.collection.return_value.limit.return_value.stream.side_effect = ConnectionError("temporary Firestore outage")
        leftover = ["old-announcement"]
        deleted = []

        def current_legacy(_name="campus"):
            return leftover.copy()

        def fallback(dump_dir=None, collections=None):
            leftover.clear()
            return {name: 1 for name in (collections or ["announcements"])}

        with patch.object(sync, "delete_ids", side_effect=lambda ids, collection_name="campus": deleted.extend(ids)), patch.object(
            sync, "index_written_ids", side_effect=AssertionError("must not index after a failed read")
        ), patch.object(sync, "source_document_ids", return_value=["old-announcement"]):
            self.assertEqual(sync.sync_all(db)["announcements"], -1)
        self.assertEqual(deleted, [])

        leftover[:] = ["old-announcement"]
        with patch.object(sync, "legacy_unscoped_firestore_ids", side_effect=current_legacy), patch.object(
            sync, "sync_from_json_dump", side_effect=fallback
        ) as json_sync, patch.object(sync, "delete_ids", side_effect=lambda ids, collection_name="campus": deleted.extend(ids)):
            result = sync.migrate_legacy_firestore_index(db=db, dump_dir="/valid-backup")
        self.assertEqual(json_sync.call_args.kwargs.get("collections") or json_sync.call_args[1].get("collections"), set(sync.PUBLIC_FIELDS))
        self.assertEqual(result["firestore"]["announcements"], -1)
        self.assertTrue(result["rebuilt"])
        self.assertFalse(result["retryable"])
        self.assertEqual(result["remaining"], 0)

    def test_failed_index_write_keeps_old_rows_and_empty_backup_is_not_success(self):
        sync = self._stub_rag_imports()
        row = Mock(id="1", to_dict=Mock(return_value=announcement("nchu")))
        db = Mock()
        db.collection.return_value.limit.return_value.stream.return_value = [row]
        leftover = ["old-announcement"]
        deleted = []

        def ids_for(source, collection_name="campus"):
            return ["old-announcement"] if source == "firestore:announcements" else []

        with patch.object(sync, "source_document_ids", side_effect=ids_for), patch.object(
            sync, "index_written_ids", side_effect=RuntimeError("upsert failed")
        ), patch.object(sync, "delete_ids", side_effect=lambda ids, collection_name="campus": deleted.extend(ids)):
            self.assertEqual(sync.sync_all(db)["announcements"], -1)
        self.assertEqual(deleted, [])

        with patch.object(sync, "legacy_unscoped_firestore_ids", side_effect=lambda _name="campus": leftover.copy()), patch.object(
            sync, "sync_from_json_dump", return_value={}
        ) as json_sync, patch.object(sync, "delete_ids", side_effect=lambda ids, collection_name="campus": deleted.extend(ids)), patch.object(
            sync, "index_written_ids", side_effect=RuntimeError("upsert failed")
        ), patch.object(sync, "source_document_ids", side_effect=ids_for):
            result = sync.migrate_legacy_firestore_index(db=db, dump_dir="/empty-backup")
        self.assertTrue(json_sync.called)
        self.assertEqual(deleted, [])
        self.assertEqual(result["remaining"], 1)
        self.assertFalse(result["rebuilt"])
        self.assertTrue(result["retryable"])
        self.assertFalse(sync.sync_ok({}))
        self.assertFalse(sync.sync_ok(result.get("json")))

    def test_json_fallback_only_replaces_failed_collections(self):
        sync = self._stub_rag_imports()
        leftover = ["old-event"]
        requested = {}

        def fallback(dump_dir=None, collections=None):
            requested["collections"] = set(collections or [])
            leftover.clear()
            return {name: 1 for name in collections or []}

        firestore = {name: (2 if name == "announcements" else -1) for name in sync.PUBLIC_FIELDS}
        with patch.object(sync, "legacy_unscoped_firestore_ids", side_effect=lambda _name="campus": leftover.copy()), patch.object(
            sync, "sync_all", return_value=firestore
        ), patch.object(sync, "sync_from_json_dump", side_effect=fallback) as json_sync:
            result = sync.migrate_legacy_firestore_index(db=Mock(), dump_dir="/valid-backup")
        expected = set(sync.PUBLIC_FIELDS) - {"announcements"}
        self.assertEqual(requested["collections"], expected)
        self.assertEqual(json_sync.call_args.kwargs["collections"], expected)
        self.assertTrue(result["rebuilt"])

    def test_successful_write_deletes_only_ids_not_returned_by_indexer(self):
        sync = self._stub_rag_imports()
        deleted = []

        def write(documents, collection_name="campus", embedding_fn=None):
            return 1, ["new-1"]

        with patch.object(sync, "source_document_ids", return_value=["old-1", "new-1"]), patch.object(
            sync, "index_written_ids", side_effect=write
        ), patch.object(sync, "delete_ids", side_effect=lambda ids, collection_name="campus": deleted.extend(ids)):
            count = sync.replace_source_documents("firestore:announcements", [{"text": "x", "source": "firestore:announcements"}])
        self.assertEqual(count, 1)
        self.assertEqual(deleted, ["old-1"])

    def test_live_success_does_not_json_fallback_just_because_legacy_remains(self):
        sync = self._stub_rag_imports()
        leftover = ["old-announcement"]
        firestore = {name: 1 for name in sync.PUBLIC_FIELDS}
        with patch.object(sync, "legacy_unscoped_firestore_ids", side_effect=lambda _name="campus": leftover.copy()), patch.object(
            sync, "sync_all", return_value=firestore
        ), patch.object(sync, "sync_from_json_dump") as json_sync:
            result = sync.migrate_legacy_firestore_index(db=Mock(), dump_dir="/valid-backup")
        json_sync.assert_not_called()
        self.assertFalse(result["rebuilt"])
        self.assertTrue(result["retryable"])
        self.assertEqual(result["remaining"], 1)
