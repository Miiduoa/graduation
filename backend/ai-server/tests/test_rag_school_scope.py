"""Public RAG tests use disposable records and deterministic offline embeddings."""

import hashlib
import json
from copy import deepcopy
import tempfile
import unittest
from importlib.util import find_spec
from pathlib import Path
from unittest.mock import Mock, patch

from rag.public_documents import public_document


def announcement(school, title="午餐時段"):
    return {"title": title, "visibility": "public", "schoolId": school}


def snapshot(collection, documents):
    return {
        "format": "nuni-rag-firestore-snapshot-v1",
        "collection": collection,
        "scope": "all_schools",
        "complete": True,
        "documents": documents,
    }


def write_snapshot(folder, collection, payload):
    raw = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    (Path(folder) / f"{collection}.json").write_bytes(raw)
    return {collection: hashlib.sha256(raw).hexdigest()}


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
            {"source": "firestore:announcements", "text": "靜宜內部公告", "metadata": {"visibility": "school", "schoolId": "nchu"}},
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

        write_ids = indexer.index_written_ids
        self.enterContext(patch.object(
            sync, "index_written_ids",
            side_effect=lambda documents, collection_name="campus": write_ids(
                documents, collection_name=collection_name, embedding_fn=embed
            ),
        ))
        self.enterContext(patch.object(
            sync, "sync_all", return_value={name: -1 for name in sync.PUBLIC_FIELDS}
        ))
        with tempfile.TemporaryDirectory() as folder:
            trusted = {}
            for name in sync.PUBLIC_FIELDS:
                rows = [{"id": "old-1", "data": {
                    "title": "午餐時段", "body": "舊公告", "schoolId": "nchu",
                }}] if name == "announcements" else []
                trusted.update(write_snapshot(folder, name, snapshot(name, rows)))
            result = sync.migrate_legacy_firestore_index(
                dump_dir=folder, trusted_snapshot_sha256=trusted,
            )
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
    def test_firestore_and_valid_snapshot_apply_the_same_public_projection(self):
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
            # Live reads filter unscoped records; snapshots reject them entirely.
            # Preserve the original source IDs when comparing the valid projection.
            scoped = [{"id": str(i), "data": row} for i, row in enumerate(rows) if row["schoolId"]]
            trusted = write_snapshot(folder, "announcements", snapshot("announcements", scoped))
            (Path(folder) / "users.json").write_text(json.dumps(rows))
            self.assertEqual(sync.sync_from_json_dump(
                folder, collections={"announcements"}, trusted_snapshot_sha256=trusted,
            ), {"announcements": 2})
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
        if HAS_RAG:
            # Load installed dependencies before considering offline stand-ins.
            # Otherwise these tests pollute the later real Chroma tests.
            import chromadb
            import langchain_text_splitters
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

        def fallback(dump_dir=None, collections=None, *, trusted_snapshot_sha256=None):
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

        def fallback(dump_dir=None, collections=None, *, trusted_snapshot_sha256=None):
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

    def test_json_dump_missing_requested_collection_returns_minus_one(self):
        sync = self._stub_rag_imports()
        with tempfile.TemporaryDirectory() as folder:
            result = sync.sync_from_json_dump(folder, collections={"announcements"})
        self.assertEqual(result, {"announcements": -1})


    def _fake_snapshot_index(self):
        """Disposable store; exercising real replacement code cannot reach Chroma."""
        sync = self._stub_rag_imports()
        self.snapshot_store = {
            "old-pu": public_document("announcements", announcement("pu", "PU old"), "pu-old"),
            "old-nchu": public_document("announcements", announcement("nchu", "NCHU old"), "nchu-old"),
            "old-legacy": {"text": "legacy", "source": "firestore:announcements", "metadata": {}},
            "old-event": public_document("events", announcement("nchu", "Event old"), "event-old"),
            "app-help": {"text": "App help", "source": "app:navigation", "metadata": {}},
        }
        self.snapshot_before = deepcopy(self.snapshot_store)
        self.snapshot_calls = []

        def source_ids(source, collection_name="campus"):
            self.snapshot_calls.append(("read", source))
            return [key for key, row in self.snapshot_store.items() if row["source"] == source]

        def write(documents, collection_name="campus"):
            self.snapshot_calls.append(("write", len(documents)))
            ids = []
            for row in documents:
                key = f'{row["source"]}/{row["metadata"]["schoolId"]}/{row["metadata"]["firestore_id"]}'
                self.snapshot_store[key] = deepcopy(row)
                ids.append(key)
            return len(documents), ids

        def delete(ids, collection_name="campus"):
            self.snapshot_calls.append(("delete", list(ids)))
            for key in ids:
                self.snapshot_store.pop(key, None)

        def legacy(collection_name="campus"):
            return [key for key, row in self.snapshot_store.items()
                    if row["source"].startswith("firestore:") and not row["metadata"].get("schoolId")]

        self.enterContext(patch.object(sync, "source_document_ids", side_effect=source_ids))
        self.enterContext(patch.object(sync, "index_written_ids", side_effect=write))
        self.enterContext(patch.object(sync, "delete_ids", side_effect=delete))
        self.enterContext(patch.object(sync, "legacy_unscoped_firestore_ids", side_effect=legacy))
        return sync

    def _assert_snapshot_preserved(self):
        self.assertEqual(self.snapshot_store, self.snapshot_before)
        self.assertEqual(self.snapshot_calls, [])

    def test_empty_and_partial_development_dumps_never_change_existing_index(self):
        sync = self._fake_snapshot_index()
        dumps = [[], [announcement("pu", "Partial replacement")], announcement("pu", "Single record")]
        with tempfile.TemporaryDirectory() as folder:
            for payload in dumps:
                for approved in (False, True):
                    with self.subTest(payload=payload, digest_supplied=approved):
                        trusted = write_snapshot(folder, "announcements", payload)
                        result = sync.sync_from_json_dump(
                            folder, collections={"announcements"},
                            trusted_snapshot_sha256=trusted if approved else None,
                        )
                        self.assertEqual(result, {"announcements": -1})
                        self._assert_snapshot_preserved()

    def test_snapshot_declaration_cannot_grant_itself_trust(self):
        sync = self._fake_snapshot_index()
        with tempfile.TemporaryDirectory() as folder:
            trusted = write_snapshot(folder, "announcements", snapshot("announcements", []))
            for approval in (None, {}, {"announcements": "0" * 64}, {"announcements": True}):
                with self.subTest(approval=approval):
                    result = sync.sync_from_json_dump(
                        folder, collections={"announcements"}, trusted_snapshot_sha256=approval,
                    )
                    self.assertEqual(result, {"announcements": -1})
                    self._assert_snapshot_preserved()
            # A file changed after independent approval must not use the old digest.
            write_snapshot(folder, "announcements", snapshot("announcements", [
                {"id": "changed", "data": announcement("pu", "Changed after approval")},
            ]))
            self.assertEqual(sync.sync_from_json_dump(
                folder, collections={"announcements"}, trusted_snapshot_sha256=trusted,
            ), {"announcements": -1})
            self._assert_snapshot_preserved()

    def test_invalid_snapshot_contract_preserves_all_old_rows(self):
        sync = self._fake_snapshot_index()
        valid = snapshot("announcements", [{"id": "new", "data": announcement("pu")}])
        invalid = [
            {**valid, "format": "unsupported-v2"},
            {**valid, "collection": "events"},
            {**valid, "scope": "pu"},
            {**valid, "scope": "unknown"},
            {**valid, "scope": ["pu", "nchu"]},
            {**valid, "complete": False},
            {**valid, "complete": 1},
            {key: value for key, value in valid.items() if key != "scope"},
            {**valid, "partial": True},
            {**valid, "documents": {}},
        ]
        with tempfile.TemporaryDirectory() as folder:
            for payload in invalid:
                with self.subTest(payload=payload):
                    trusted = write_snapshot(folder, "announcements", payload)
                    self.assertEqual(sync.sync_from_json_dump(
                        folder, collections={"announcements"}, trusted_snapshot_sha256=trusted,
                    ), {"announcements": -1})
                    self._assert_snapshot_preserved()

    def test_every_snapshot_row_is_validated_before_any_write(self):
        sync = self._fake_snapshot_index()
        good = {"id": "valid-first", "data": announcement("pu", "Must not be written")}
        invalid = [
            None,
            {"id": "missing-data"},
            {"id": "new", "data": []},
            {"id": "valid-first", "data": announcement("nchu")},
            *[{"id": bad_id, "data": announcement("nchu")} for bad_id in (None, 3, "", " ", " padded ", "a/b")],
            *[{"id": "new", "data": announcement(school)} for school in (None, "", "all", "unknown", "unavailable-campus", "pu/path", {})],
            {"id": "new", "data": {**announcement("pu"), "visibility": "unlisted"}},
            {"id": "new", "data": {**announcement("pu"), "visibility": True}},
            {"id": "new", "data": {"schoolId": "pu", "body": {"private": "secret"}}},
            {"id": "new", "data": {"schoolId": "pu", "title": True}},
            {"id": "new", "data": {"schoolId": "unknown", "visibility": "private"}},
        ]
        with tempfile.TemporaryDirectory() as folder:
            for bad in invalid:
                with self.subTest(bad=bad):
                    trusted = write_snapshot(folder, "announcements", snapshot("announcements", [good, bad]))
                    self.assertEqual(sync.sync_from_json_dump(
                        folder, collections={"announcements"}, trusted_snapshot_sha256=trusted,
                    ), {"announcements": -1})
                    self._assert_snapshot_preserved()

    def test_broken_json_duplicate_keys_and_nonfinite_values_preserve_index(self):
        sync = self._fake_snapshot_index()
        valid = json.dumps(snapshot("announcements", [
            {"id": "new", "data": announcement("pu")},
        ])).encode()
        invalid = [
            valid[:-1], b"\xff", b"null", b"[" * 10000 + b"0" + b"]" * 10000,
            valid.replace(b'"complete": true', b'"complete": false, "complete": true'),
            valid.replace(b'"schoolId": "pu"', b'"schoolId": "unknown", "schoolId": "pu"'),
            *[valid.replace(b'"schoolId": "pu"', b'"schoolId": "pu", "body": ' + value)
              for value in (b"NaN", b"Infinity", b"-Infinity", b"1e309")],
        ]
        with tempfile.TemporaryDirectory() as folder:
            for raw in invalid:
                with self.subTest(raw=raw):
                    (Path(folder) / "announcements.json").write_bytes(raw)
                    self.assertEqual(sync.sync_from_json_dump(
                        folder, collections={"announcements"},
                        trusted_snapshot_sha256={"announcements": hashlib.sha256(raw).hexdigest()},
                    ), {"announcements": -1})
                    self._assert_snapshot_preserved()

    def test_all_requested_files_are_preflighted_before_any_source_changes(self):
        sync = self._fake_snapshot_index()
        wanted = {"announcements", "events"}
        with tempfile.TemporaryDirectory() as folder:
            trusted = write_snapshot(folder, "announcements", snapshot("announcements", []))
            for fault in ("missing approval", "missing file", "partial scope", "unknown collection"):
                with self.subTest(fault=fault):
                    approvals = dict(trusted)
                    requested = set(wanted)
                    if fault == "missing file":
                        approvals["events"] = "0" * 64
                    elif fault == "partial scope":
                        approvals.update(write_snapshot(folder, "events", {
                            **snapshot("events", []), "scope": "pu",
                        }))
                    elif fault == "unknown collection":
                        requested = {"announcements", "users"}
                        approvals["users"] = "0" * 64
                    self.assertEqual(sync.sync_from_json_dump(
                        folder, collections=requested, trusted_snapshot_sha256=approvals,
                    ), {name: -1 for name in requested})
                    self._assert_snapshot_preserved()
            missing_dir = Path(folder) / "absent"
            self.assertEqual(sync.sync_from_json_dump(
                missing_dir, collections={"announcements"}, trusted_snapshot_sha256=trusted,
            ), {"announcements": -1})
            self._assert_snapshot_preserved()

    def test_trusted_full_snapshot_preserves_public_projection_ids_and_other_sources(self):
        sync = self._fake_snapshot_index()
        rows = [
            {"id": "pu-source-id", "data": {
                **announcement("tw-pu", "PU current"), "uid": "private uid", "body": {"secret": "private body"},
            }},
            {"id": "nchu-source-id", "data": {"schoolId": "tw-nchu", "title": "NCHU current"}},
            {"id": "private-source", "data": {**announcement("pu", "Private"), "visibility": "private"}},
            {"id": "school-source", "data": {**announcement("nchu", "School only"), "visibility": "school"}},
        ]
        with tempfile.TemporaryDirectory() as folder:
            trusted = write_snapshot(folder, "announcements", snapshot("announcements", rows))
            self.assertEqual(sync.sync_from_json_dump(
                folder, collections={"announcements"}, trusted_snapshot_sha256=trusted,
            ), {"announcements": 2})
        expected = {key: value for key, value in self.snapshot_before.items()
                    if value["source"] != "firestore:announcements"}
        expected.update({
            "firestore:announcements/pu/pu-source-id": {
                "text": "[announcements]\ntitle: PU current", "source": "firestore:announcements",
                "metadata": {"schoolId": "pu", "visibility": "public", "firestore_id": "pu-source-id"},
            },
            "firestore:announcements/nchu/nchu-source-id": {
                "text": "[announcements]\ntitle: NCHU current", "source": "firestore:announcements",
                "metadata": {"schoolId": "nchu", "visibility": "public", "firestore_id": "nchu-source-id"},
            },
        })
        self.assertEqual(self.snapshot_store, expected)
        self.assertEqual([call[0] for call in self.snapshot_calls], ["read", "write", "delete"])

    def test_trusted_empty_snapshot_can_clear_only_its_declared_source(self):
        sync = self._fake_snapshot_index()
        with tempfile.TemporaryDirectory() as folder:
            trusted = write_snapshot(folder, "announcements", snapshot("announcements", []))
            self.assertEqual(sync.sync_from_json_dump(
                folder, collections={"announcements"}, trusted_snapshot_sha256=trusted,
            ), {"announcements": 0})
        self.assertEqual(self.snapshot_store, {
            key: value for key, value in self.snapshot_before.items()
            if value["source"] != "firestore:announcements"
        })
        self.assertEqual([call[0] for call in self.snapshot_calls], ["read", "delete"])

    def test_trusted_snapshot_upsert_failure_does_not_delete_old_rows(self):
        sync = self._fake_snapshot_index()
        with tempfile.TemporaryDirectory() as folder, patch.object(
            sync, "index_written_ids", side_effect=RuntimeError("synthetic upsert failure"),
        ):
            trusted = write_snapshot(folder, "announcements", snapshot("announcements", [
                {"id": "new", "data": announcement("pu")},
            ]))
            self.assertEqual(sync.sync_from_json_dump(
                folder, collections={"announcements"}, trusted_snapshot_sha256=trusted,
            ), {"announcements": -1})
        self.assertEqual(self.snapshot_store, self.snapshot_before)
        self.assertEqual(self.snapshot_calls, [("read", "firestore:announcements")])

    def test_migration_default_preserves_index_and_explicit_trust_rebuilds_failed_source(self):
        sync = self._fake_snapshot_index()
        live = {name: (-1 if name == "announcements" else 0) for name in sync.PUBLIC_FIELDS}
        with tempfile.TemporaryDirectory() as folder, patch.object(sync, "sync_all", return_value=live):
            trusted = write_snapshot(folder, "announcements", snapshot("announcements", [
                {"id": "pu-new", "data": announcement("pu")},
                {"id": "nchu-new", "data": announcement("nchu")},
            ]))
            result = sync.migrate_legacy_firestore_index(db=Mock(), dump_dir=folder)
            self.assertEqual(result["json"], {"announcements": -1})
            self.assertEqual(result["remaining"], 1)
            self.assertFalse(result["rebuilt"])
            self.assertTrue(result["retryable"])
            self._assert_snapshot_preserved()
            result = sync.migrate_legacy_firestore_index(
                db=Mock(), dump_dir=folder, trusted_snapshot_sha256=trusted,
            )
        self.assertEqual(result["json"], {"announcements": 2})
        self.assertEqual(result["remaining"], 0)
        self.assertTrue(result["rebuilt"])
        self.assertFalse(result["retryable"])
        self.assertEqual(self.snapshot_store["old-event"], self.snapshot_before["old-event"])
        self.assertEqual(self.snapshot_store["app-help"], self.snapshot_before["app-help"])
        self.assertEqual({row["metadata"]["schoolId"] for row in self.snapshot_store.values()
                          if row["source"] == "firestore:announcements"}, {"pu", "nchu"})


    def test_live_recovery_retries_migration_without_approving_a_dump(self):
        sync = self._fake_snapshot_index()
        db = Mock()
        db.collection.return_value.limit.return_value.stream.side_effect = ConnectionError("offline fixture")
        with tempfile.TemporaryDirectory() as folder:
            # No trusted producer: even an existing dump must not change the store.
            (Path(folder) / "announcements.json").write_text("[]", encoding="utf-8")
            failed = sync.migrate_legacy_firestore_index(db=db, dump_dir=folder)
            self.assertEqual(failed["remaining"], 1)
            self.assertFalse(failed["rebuilt"])
            self.assertTrue(failed["retryable"])
            self.assertEqual(failed["json"], {name: -1 for name in sync.PUBLIC_FIELDS})
            self._assert_snapshot_preserved()

            def recovered_collection(name):
                rows = [
                    Mock(id="pu-live", to_dict=Mock(return_value=announcement("pu", "PU recovered"))),
                    Mock(id="nchu-live", to_dict=Mock(return_value=announcement("nchu", "NCHU recovered"))),
                ] if name == "announcements" else []
                query = Mock()
                query.limit.return_value.stream.return_value = rows
                return query

            db.collection.side_effect = recovered_collection
            # This second call models an explicit operator retry, not a timer.
            recovered = sync.migrate_legacy_firestore_index(db=db, dump_dir=folder)
        self.assertNotIn("json", recovered)
        self.assertEqual(recovered["firestore"]["announcements"], 2)
        self.assertEqual(recovered["remaining"], 0)
        self.assertTrue(recovered["rebuilt"])
        self.assertFalse(recovered["retryable"])
        self.assertEqual(self.snapshot_store["app-help"], self.snapshot_before["app-help"])
        self.assertEqual({row["metadata"]["schoolId"] for row in self.snapshot_store.values()
                          if row["source"] == "firestore:announcements"}, {"pu", "nchu"})
        self.assertNotIn("old-legacy", self.snapshot_store)
