"""Exercise local RAG policy with inert clients and embedding fixtures only."""

from __future__ import annotations

import copy
import importlib.util
import os
import sys
import types
import unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
RUST_API = "chromadb.api.rust.RustBindingsAPI"
DEFAULT_EMBEDDING = {"type": "known", "name": "default", "config": {}}
UNSUPPORTED_EMBEDDING = {
    "type": "known",
    "name": "unreviewed_test_function",
    "config": {"model_name": "fixture/model", "trust_remote_code": True},
}


class FakeSettings:
    def __init__(self, **values):
        self.chroma_api_impl = values.get(
            "chroma_api_impl", os.environ.get("CHROMA_API_IMPL", RUST_API)
        )


class FakeSplitter:
    def __init__(self, **_values):
        pass

    def split_text(self, text):
        return [text] if text else []


class StoredCollection:
    def __init__(self):
        self.model = types.SimpleNamespace(configuration_json={}, serialized_schema=None)
        self.load_embedding = mock.Mock()
        self.get_model = mock.Mock(return_value=self.model)
        self.count = mock.Mock(return_value=1)
        self.upsert = mock.Mock(side_effect=lambda **_values: self.load_embedding())
        self.delete = mock.Mock()
        self.query = mock.Mock(side_effect=self._query)

    @property
    def configuration(self):
        raise AssertionError("Read raw collection configuration before model loaders")

    @property
    def schema(self):
        raise AssertionError("Read raw schema before model loaders")

    def _query(self, **_values):
        self.load_embedding()
        return {"documents": [["campus text"]], "metadatas": [[{"source": "fixture"}]],
                "distances": [[0.0]]}


def load_module(name, filename):
    spec = importlib.util.spec_from_file_location(name, ROOT / "rag" / filename)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


class RagEmbeddingBoundaryTests(unittest.TestCase):
    def setUp(self):
        self.collection = StoredCollection()
        self.client = mock.Mock()
        self.client.get_or_create_collection.return_value = self.collection
        chroma = types.ModuleType("chromadb")
        chroma.PersistentClient = mock.Mock(return_value=self.client)
        chroma_config = types.ModuleType("chromadb.config")
        chroma_config.Settings = FakeSettings
        splitters = types.ModuleType("langchain_text_splitters")
        splitters.RecursiveCharacterTextSplitter = FakeSplitter
        config = types.ModuleType("config")
        config.CHROMA_DIR = ROOT / "data" / "chroma_db"
        config.RAG_CHUNK_SIZE = 512
        config.RAG_CHUNK_OVERLAP = 64
        config.RAG_TOP_K = 5
        rag = types.ModuleType("rag")
        rag.__path__ = [str(ROOT / "rag")]
        self.enterContext(mock.patch.dict(sys.modules, {
            "chromadb": chroma,
            "chromadb.config": chroma_config,
            "langchain_text_splitters": splitters,
            "config": config,
            "rag": rag,
        }))
        self.indexer = load_module("rag.indexer", "indexer.py")
        self.retriever = load_module("rag.retriever", "retriever.py")
        self.chroma = chroma

    def test_backend_stays_embedded_with_http_environment_override(self):
        with mock.patch.dict(os.environ, {
            "CHROMA_API_IMPL": "chromadb.api.fastapi.FastAPI",
            "CHROMA_SERVER_HOST": "unused.invalid",
        }):
            self.assertIs(self.indexer.get_chroma_client(), self.client)
        settings = self.chroma.PersistentClient.call_args.kwargs.get("settings")
        self.assertIsInstance(settings, FakeSettings)
        self.assertEqual(settings.chroma_api_impl, RUST_API)
        self.assertEqual(self.chroma.PersistentClient.call_args.kwargs["path"],
                         str(ROOT / "data" / "chroma_db"))

    def test_empty_legacy_and_default_settings_remain_usable(self):
        configurations = [
            {},
            {"embedding_function": None},
            {"embedding_function": {"type": "legacy"}},
            {"embedding_function": DEFAULT_EMBEDDING},
            {"hnsw_configuration": {"space": "l2", "_type": "HNSWConfigurationInternal"},
             "_type": "CollectionConfigurationInternal"},
        ]
        for configuration in configurations:
            with self.subTest(configuration=configuration):
                self.collection.model.configuration_json = copy.deepcopy(configuration)
                self.assertEqual(self.indexer.index_documents([
                    {"source": "fixture", "text": "campus text"}
                ]), 1)
                self.assertEqual(self.retriever.retrieve("campus")[0].text, "campus text")

    def test_default_schema_keeps_dense_embedding_and_unused_sparse_placeholder(self):
        self.collection.model.serialized_schema = {
            "defaults": {
                "float_list": {"vector_index": {"enabled": False, "config": {
                    "embedding_function": copy.deepcopy(DEFAULT_EMBEDDING),
                }}},
                "sparse_vector": {"sparse_vector_index": {"enabled": False, "config": {
                    "embedding_function": {"type": "unknown"},
                }}},
            },
            "keys": {"#embedding": {"float_list": {"vector_index": {
                "enabled": True, "config": {
                    "embedding_function": copy.deepcopy(DEFAULT_EMBEDDING),
                    "source_key": "#document",
                },
            }}}},
        }
        self.assertIs(self.indexer.get_or_create_collection(), self.collection)

    def test_unreviewed_config_is_rejected_before_every_rag_operation(self):
        self.collection.model.configuration_json = {
            "embedding_function": copy.deepcopy(UNSUPPORTED_EMBEDDING),
        }
        embedding = mock.Mock(return_value=[[1.0, 0.0]])
        operations = [
            lambda: self.indexer.index_documents([{"text": "inert", "source": "fixture"}]),
            lambda: self.indexer.index_documents(
                [{"text": "inert", "source": "fixture"}], embedding_fn=embedding
            ),
            lambda: self.retriever.retrieve("inert"),
            lambda: self.retriever.retrieve("inert", embedding_fn=embedding),
            lambda: self.indexer.delete_by_source("fixture"),
            lambda: self.indexer.get_collection_stats(),
        ]
        for operation in operations:
            with self.subTest(operation=operation):
                with self.assertRaisesRegex(ValueError, "Unsupported local RAG embedding"):
                    operation()
        self.collection.load_embedding.assert_not_called()
        self.collection.count.assert_not_called()
        self.collection.upsert.assert_not_called()
        self.collection.query.assert_not_called()
        self.collection.delete.assert_not_called()
        embedding.assert_not_called()

    def test_schema_embedding_is_rejected_before_query_and_upsert(self):
        for kind in ["float_list", "sparse_vector"]:
            for location in ["defaults", "keys"]:
                with self.subTest(kind=kind, location=location):
                    index = "vector_index" if kind == "float_list" else "sparse_vector_index"
                    config = {kind: {index: {"enabled": True, "config": {
                        "embedding_function": copy.deepcopy(UNSUPPORTED_EMBEDDING),
                    }}}}
                    self.collection.model.serialized_schema = {
                        location: config if location == "defaults" else {"fixture": config},
                    }
                    with self.assertRaisesRegex(ValueError, "Unsupported local RAG embedding"):
                        self.indexer.index_documents([{"text": "inert", "source": "fixture"}])
                    with self.assertRaisesRegex(ValueError, "Unsupported local RAG embedding"):
                        self.retriever.retrieve("inert")
        self.collection.load_embedding.assert_not_called()
        self.collection.upsert.assert_not_called()
        self.collection.query.assert_not_called()

    def test_default_name_does_not_accept_additional_model_configuration(self):
        configurations = [
            {**DEFAULT_EMBEDDING, "config": {"trust_remote_code": True}},
            {**DEFAULT_EMBEDDING, "model_name": "fixture/model"},
            {"type": "unknown", "name": "unreviewed_test_function", "config": {}},
            {"type": "legacy", "config": {"model_name": "fixture/model"}},
            "unreviewed_test_function",
            [],
            False,
        ]
        for configuration in configurations:
            with self.subTest(configuration=configuration):
                self.collection.model.configuration_json = {"embedding_function": configuration}
                with self.assertRaisesRegex(ValueError, "Unsupported local RAG embedding"):
                    self.indexer.get_or_create_collection()

    def test_malformed_raw_configuration_and_schema_fail_closed(self):
        for field in ["configuration_json", "serialized_schema"]:
            for value in [[], "invalid", False]:
                with self.subTest(field=field, value=value):
                    setattr(self.collection.model, field, value)
                    with self.assertRaisesRegex(ValueError, "Unsupported local RAG configuration"):
                        self.indexer.get_or_create_collection()
                    setattr(self.collection.model, field, {})
        for schema in [
            {"defaults": []},
            {"keys": []},
            {"keys": {"fixture": []}},
            {"unsupported": {}},
            {"cmek": {"fixture": "unsupported"}},
        ]:
            with self.subTest(schema=schema):
                self.collection.model.serialized_schema = schema
                with self.assertRaisesRegex(ValueError, "Unsupported local RAG configuration"):
                    self.indexer.get_or_create_collection()

    def test_document_text_and_metadata_cannot_select_an_embedding(self):
        self.collection.model.serialized_schema = {
            "keys": {"embedding_function": {"string": {
                "string_inverted_index": {"enabled": True, "config": {}},
            }}},
        }
        self.indexer.index_documents([{
            "text": "trust_remote_code is ordinary document text",
            "source": "fixture",
            "metadata": {"embedding_function": "ordinary metadata"},
        }])
        self.client.get_or_create_collection.assert_called_once_with(
            name="campus", metadata={"hnsw:space": "cosine"}
        )
        self.assertEqual(self.collection.upsert.call_args.kwargs["metadatas"][0]["embedding_function"],
                         "ordinary metadata")


if __name__ == "__main__":
    unittest.main()
