"""HTTP／import boundaries for the cloud (no-RAG) dependency set.

Requires only the hashed cloud lock packages. No model weights, no provider
network calls, no production tokens.
"""

from __future__ import annotations

import importlib
import os
import sys
import unittest
from pathlib import Path
from unittest import mock

AI_SERVER_ROOT = Path(__file__).resolve().parents[1]
if str(AI_SERVER_ROOT) not in sys.path:
    sys.path.insert(0, str(AI_SERVER_ROOT))

# Cloud-style process env before importing application modules.
_CLOUD_ENV = {
    "ENABLE_RAG": "false",
    "ENABLE_WEB_SEARCH": "false",
    "ENABLE_SELF_TRAIN_LOOP": "false",
    "ENABLE_REFLEXION": "false",
    "LLM_PROVIDER": "groq",
    "REQUIRE_FIREBASE_AUTH": "true",
    "AI_SERVER_HOST": "127.0.0.1",
    "AI_ALLOWED_ORIGINS": "http://127.0.0.1:3000",
    "OPENAI_COMPAT_API_KEY": "",
    "GROQ_API_KEY": "",
    "TOGETHER_API_KEY": "",
}


def _purge_app_modules() -> None:
    for name in list(sys.modules):
        if name == "config" or name == "server" or name.startswith(
            ("rag.", "self_training.", "tools.", "prompts.", "training.")
        ):
            sys.modules.pop(name, None)
        if name in {"rag", "self_training", "tools", "prompts", "training", "llm_client", "tool_planner", "reflexion", "web_search"}:
            sys.modules.pop(name, None)


class CloudBoundaryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        _purge_app_modules()
        cls._env_patch = mock.patch.dict(os.environ, _CLOUD_ENV, clear=False)
        cls._env_patch.start()
        # Re-import under cloud env so ENABLE_RAG gates heavy imports.
        import config as config_mod

        importlib.reload(config_mod)
        import server as server_mod

        importlib.reload(server_mod)
        cls.config = config_mod
        cls.server = server_mod

        from fastapi.testclient import TestClient

        # Lifespan indexes nothing when RAG is off; no external providers called.
        cls.client_cm = TestClient(server_mod.app)
        cls.client = cls.client_cm.__enter__()

    @classmethod
    def tearDownClass(cls) -> None:
        cls.client_cm.__exit__(None, None, None)
        cls._env_patch.stop()
        _purge_app_modules()

    def test_status_health_without_provider_tokens(self) -> None:
        response = self.client.get("/api/status")
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body.get("status"), "running")
        self.assertTrue(body.get("authRequired"))
        self.assertFalse(body.get("ragEnabled"))

    def test_chat_without_bearer_keeps_401_contract(self) -> None:
        response = self.client.post(
            "/api/chat/sync",
            json={"message": "hello", "stream": False},
        )
        self.assertEqual(response.status_code, 401)
        self.assertIn("Authorization", response.json().get("detail", ""))

    def test_chroma_http_api_not_mounted(self) -> None:
        """Chroma server REST is unsupported; malicious probes must not hit Chroma."""
        probes = [
            "/api/v2/tenants/default_tenant/databases/default_database/collections",
            "/api/v2/collections",
            "/api/v1/collections",
        ]
        for path in probes:
            with self.subTest(path=path):
                response = self.client.get(path)
                self.assertEqual(response.status_code, 404)
                response_post = self.client.post(path, json={"name": "x"})
                self.assertEqual(response_post.status_code, 404)

    def test_cloud_startup_does_not_import_heavy_ml(self) -> None:
        heavy = (
            "chromadb",
            "sentence_transformers",
            "mlx_lm",
            "mlx",
            "torch",
            "langchain_text_splitters",
        )
        loaded = [name for name in heavy if name in sys.modules]
        self.assertEqual(
            loaded,
            [],
            f"cloud no-RAG import pulled heavy modules: {loaded}",
        )

    def test_public_bind_env_without_auth_fails_closed(self) -> None:
        # Direct policy retained; env-only / duplicate-CLI bypasses are covered by
        # lifespan integration in test_bind_auth_policy.py.
        with self.assertRaises(RuntimeError):
            self.config.assert_bind_allowed("0.0.0.0", require_firebase_auth=False)


if __name__ == "__main__":
    unittest.main()
