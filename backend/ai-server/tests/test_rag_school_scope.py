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
        with tempfile.TemporaryDirectory() as folder, patch.object(sync, "delete_by_source"), patch.object(sync, "index_documents", side_effect=len) as index:
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
        with patch.object(sync, "delete_by_source"), patch.object(sync, "index_documents", side_effect=len) as index:
            self.assertEqual(sync.sync_collection("announcements", db), 501)
        query.start_after.assert_called_once_with(first[-1])
        self.assertEqual(index.call_args.args[0][0]["metadata"]["schoolId"], "nchu")
