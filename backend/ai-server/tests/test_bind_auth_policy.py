"""Bind-host + Firebase auth policy (no real network listen, no secrets)."""

from __future__ import annotations

import asyncio
import importlib
import os
import sys
import unittest
from pathlib import Path
from unittest import mock

AI_SERVER_ROOT = Path(__file__).resolve().parents[1]
if str(AI_SERVER_ROOT) not in sys.path:
    sys.path.insert(0, str(AI_SERVER_ROOT))

from config import (
    assert_bind_allowed,
    bind_host_from_argv,
    is_blank_bind,
    is_loopback_bind,
    is_public_bind,
    resolve_bind_host,
)


def _purge_app_modules() -> None:
    for name in list(sys.modules):
        if name == "config" or name == "server" or name.startswith(
            ("rag.", "self_training.", "tools.", "prompts.", "training.")
        ):
            sys.modules.pop(name, None)
        if name in {
            "rag",
            "self_training",
            "tools",
            "prompts",
            "training",
            "llm_client",
            "tool_planner",
            "reflexion",
            "web_search",
        }:
            sys.modules.pop(name, None)


class BindAuthPolicyTests(unittest.TestCase):
    def test_loopback_helpers(self) -> None:
        self.assertTrue(is_loopback_bind("127.0.0.1"))
        self.assertTrue(is_loopback_bind("localhost"))
        self.assertTrue(is_loopback_bind("::1"))
        self.assertFalse(is_public_bind("127.0.0.1"))
        self.assertTrue(is_public_bind("0.0.0.0"))
        self.assertTrue(is_public_bind("::"))
        # Blank is public/invalid (fail closed); Uvicorn binds "" as wildcard.
        self.assertTrue(is_blank_bind(""))
        self.assertTrue(is_blank_bind("   "))
        self.assertFalse(is_blank_bind(None))
        self.assertTrue(is_public_bind(""))
        self.assertTrue(is_public_bind("   "))

    def test_default_bind_is_loopback(self) -> None:
        host = resolve_bind_host(environ={}, argv=["server.py"])
        self.assertEqual(host, "127.0.0.1")

    def test_explicit_blank_not_fallback_to_loopback(self) -> None:
        """Absent None → loopback; explicit empty/whitespace must stay blank."""
        self.assertEqual(resolve_bind_host(explicit=None, environ={}, argv=["server.py"]), "127.0.0.1")
        self.assertEqual(resolve_bind_host(explicit="", environ={}, argv=["server.py"]), "")
        self.assertEqual(resolve_bind_host(explicit="  ", environ={}, argv=["server.py"]), "")
        self.assertEqual(
            resolve_bind_host(
                environ={},
                argv=["uvicorn", "server:app", "--host="],
            ),
            "",
        )
        self.assertEqual(
            resolve_bind_host(
                environ={},
                argv=["uvicorn", "server:app", "--host", ""],
            ),
            "",
        )
        self.assertEqual(
            resolve_bind_host(
                environ={"AI_SERVER_HOST": "127.0.0.1"},
                argv=["uvicorn", "server:app", "--host", "127.0.0.1", "--host="],
            ),
            "",
        )
        self.assertEqual(
            resolve_bind_host(
                environ={},
                argv=["uvicorn", "server:app", "--host", "   "],
            ),
            "",
        )

    def test_empty_uvicorn_host_env_ignored_like_click(self) -> None:
        """Truly empty UVICORN_HOST is unset (Click); whitespace-only fail-closes."""
        self.assertEqual(
            resolve_bind_host(
                environ={"UVICORN_HOST": ""},
                argv=["uvicorn", "server:app"],
            ),
            "127.0.0.1",
        )
        self.assertEqual(
            resolve_bind_host(
                environ={"UVICORN_HOST": "   "},
                argv=["uvicorn", "server:app"],
            ),
            "",
        )

    def test_blank_bind_always_rejected(self) -> None:
        with self.assertRaises(RuntimeError) as ctx:
            assert_bind_allowed("", require_firebase_auth=False)
        self.assertIn("blank", str(ctx.exception).lower())
        with self.assertRaises(RuntimeError):
            assert_bind_allowed("   ", require_firebase_auth=False)
        # Unsupported even when auth is on — blank is not a valid public host.
        with self.assertRaises(RuntimeError):
            assert_bind_allowed("", require_firebase_auth=True)

    def test_uvicorn_host_env_is_honored(self) -> None:
        """Cloud/external uvicorn CLI reads UVICORN_HOST via Click auto_envvar."""
        self.assertEqual(
            resolve_bind_host(
                environ={"UVICORN_HOST": "0.0.0.0"},
                argv=["uvicorn", "server:app"],
            ),
            "0.0.0.0",
        )

    def test_precedence_explicit_cli_uvicorn_ai_server(self) -> None:
        self.assertEqual(
            resolve_bind_host(
                explicit="127.0.0.1",
                environ={
                    "UVICORN_HOST": "0.0.0.0",
                    "AI_SERVER_HOST": "0.0.0.0",
                },
                argv=["uvicorn", "server:app", "--host", "0.0.0.0"],
            ),
            "127.0.0.1",
        )
        self.assertEqual(
            resolve_bind_host(
                environ={
                    "UVICORN_HOST": "0.0.0.0",
                    "AI_SERVER_HOST": "127.0.0.1",
                },
                argv=["uvicorn", "server:app", "--host", "0.0.0.0"],
            ),
            "0.0.0.0",
        )
        self.assertEqual(
            resolve_bind_host(
                environ={
                    "UVICORN_HOST": "0.0.0.0",
                    "AI_SERVER_HOST": "127.0.0.1",
                },
                argv=["uvicorn", "server:app"],
            ),
            "0.0.0.0",
        )
        self.assertEqual(
            resolve_bind_host(
                environ={"AI_SERVER_HOST": "0.0.0.0"},
                argv=["uvicorn", "server:app"],
            ),
            "0.0.0.0",
        )

    def test_bind_host_from_argv_uses_last_duplicate(self) -> None:
        self.assertEqual(
            bind_host_from_argv(
                ["uvicorn", "--host", "127.0.0.1", "--host", "0.0.0.0", "server:app"]
            ),
            "0.0.0.0",
        )
        self.assertEqual(
            bind_host_from_argv(
                ["uvicorn", "--host=127.0.0.1", "--host=0.0.0.0", "server:app"]
            ),
            "0.0.0.0",
        )
        self.assertEqual(
            resolve_bind_host(
                environ={"AI_SERVER_HOST": "127.0.0.1"},
                argv=[
                    "uvicorn",
                    "server:app",
                    "--host",
                    "127.0.0.1",
                    "--host",
                    "0.0.0.0",
                ],
            ),
            "0.0.0.0",
        )

    def test_public_bind_without_auth_blocked(self) -> None:
        with self.assertRaises(RuntimeError) as ctx:
            assert_bind_allowed("0.0.0.0", require_firebase_auth=False)
        self.assertIn("REQUIRE_FIREBASE_AUTH", str(ctx.exception))

    def test_public_bind_with_auth_allowed(self) -> None:
        assert_bind_allowed("0.0.0.0", require_firebase_auth=True)

    def test_loopback_without_auth_allowed(self) -> None:
        assert_bind_allowed("127.0.0.1", require_firebase_auth=False)
        assert_bind_allowed("localhost", require_firebase_auth=False)


class UvicornCliHostContractTests(unittest.TestCase):
    """Prove real Uvicorn/Click host choice (no socket bind)."""

    def test_uvicorn_click_host_matches_env_and_last_cli(self) -> None:
        from click.testing import CliRunner
        from uvicorn.main import main as uvicorn_cli

        captured: dict[str, object] = {}

        def fake_run(*_args, **kwargs):
            captured["host"] = kwargs.get("host")

        runner = CliRunner()
        with mock.patch.dict(uvicorn_cli.callback.__globals__, {"run": fake_run}):
            result = runner.invoke(
                uvicorn_cli,
                ["server:app"],
                env={"UVICORN_HOST": "0.0.0.0"},
            )
            self.assertEqual(result.exit_code, 0, result.output)
            self.assertEqual(captured.get("host"), "0.0.0.0")

            captured.clear()
            result = runner.invoke(
                uvicorn_cli,
                ["server:app", "--host", "127.0.0.1", "--host", "0.0.0.0"],
                env={},
            )
            self.assertEqual(result.exit_code, 0, result.output)
            self.assertEqual(captured.get("host"), "0.0.0.0")

            captured.clear()
            result = runner.invoke(
                uvicorn_cli,
                ["server:app", "--host", "0.0.0.0"],
                env={"UVICORN_HOST": "127.0.0.1"},
            )
            self.assertEqual(result.exit_code, 0, result.output)
            self.assertEqual(captured.get("host"), "0.0.0.0")

    def test_uvicorn_click_captures_blank_host(self) -> None:
        """Real Click accepts --host= / --host \"\" / last duplicate blank."""
        from click.testing import CliRunner
        from uvicorn.main import main as uvicorn_cli

        captured: dict[str, object] = {}

        def fake_run(*_args, **kwargs):
            captured["host"] = kwargs.get("host")

        runner = CliRunner()
        with mock.patch.dict(uvicorn_cli.callback.__globals__, {"run": fake_run}):
            result = runner.invoke(uvicorn_cli, ["server:app", "--host="], env={})
            self.assertEqual(result.exit_code, 0, result.output)
            self.assertEqual(captured.get("host"), "")

            captured.clear()
            result = runner.invoke(uvicorn_cli, ["server:app", "--host", ""], env={})
            self.assertEqual(result.exit_code, 0, result.output)
            self.assertEqual(captured.get("host"), "")

            captured.clear()
            result = runner.invoke(
                uvicorn_cli,
                ["server:app", "--host", "127.0.0.1", "--host="],
                env={},
            )
            self.assertEqual(result.exit_code, 0, result.output)
            self.assertEqual(captured.get("host"), "")

            captured.clear()
            result = runner.invoke(uvicorn_cli, ["server:app", "--host", "   "], env={})
            self.assertEqual(result.exit_code, 0, result.output)
            self.assertEqual(captured.get("host"), "   ")

            # Truly empty UVICORN_HOST is ignored by Click → default loopback.
            captured.clear()
            result = runner.invoke(uvicorn_cli, ["server:app"], env={"UVICORN_HOST": ""})
            self.assertEqual(result.exit_code, 0, result.output)
            self.assertEqual(captured.get("host"), "127.0.0.1")


class LifespanBindIntegrationTests(unittest.TestCase):
    """ASGI lifespan must reject unauth public binds from real config sources."""

    _BASE_ENV = {
        "ENABLE_RAG": "false",
        "ENABLE_WEB_SEARCH": "false",
        "ENABLE_SELF_TRAIN_LOOP": "false",
        "ENABLE_REFLEXION": "false",
        "LLM_PROVIDER": "groq",
        "REQUIRE_FIREBASE_AUTH": "false",
        "AI_ALLOWED_ORIGINS": "http://127.0.0.1:3000",
        "OPENAI_COMPAT_API_KEY": "",
        "GROQ_API_KEY": "",
        "TOGETHER_API_KEY": "",
    }

    def setUp(self) -> None:
        _purge_app_modules()

    def tearDown(self) -> None:
        _purge_app_modules()

    def _load_server(self, environ: dict[str, str], argv: list[str]):
        merged = dict(self._BASE_ENV)
        merged.update(environ)
        # Drop empty markers so resolve_bind_host skips them like unset.
        for key in ("UVICORN_HOST", "AI_SERVER_HOST"):
            if merged.get(key) == "":
                merged.pop(key, None)

        host_keys = ("UVICORN_HOST", "AI_SERVER_HOST")
        saved_hosts = {key: os.environ.get(key) for key in host_keys}

        def _restore_hosts() -> None:
            for key, value in saved_hosts.items():
                if value is None:
                    os.environ.pop(key, None)
                else:
                    os.environ[key] = value

        self.addCleanup(_restore_hosts)
        for key in host_keys:
            if key not in merged:
                os.environ.pop(key, None)

        env_patch = mock.patch.dict(os.environ, merged, clear=False)
        argv_patch = mock.patch.object(sys, "argv", argv)
        env_patch.start()
        argv_patch.start()
        self.addCleanup(env_patch.stop)
        self.addCleanup(argv_patch.stop)

        import config as config_mod

        importlib.reload(config_mod)
        import server as server_mod

        importlib.reload(server_mod)
        return config_mod, server_mod

    def _run_lifespan_startup(self, server_mod) -> None:
        async def _start() -> None:
            async with server_mod.lifespan(server_mod.app):
                return

        asyncio.run(_start())

    def test_lifespan_rejects_uvicorn_host_public_without_auth(self) -> None:
        _config_mod, server_mod = self._load_server(
            {
                "UVICORN_HOST": "0.0.0.0",
                "AI_SERVER_HOST": "",
                "REQUIRE_FIREBASE_AUTH": "false",
            },
            ["uvicorn", "server:app"],
        )
        with self.assertRaises(RuntimeError) as ctx:
            self._run_lifespan_startup(server_mod)
        self.assertIn("REQUIRE_FIREBASE_AUTH", str(ctx.exception))

    def test_lifespan_rejects_duplicate_cli_last_public_without_auth(self) -> None:
        _config_mod, server_mod = self._load_server(
            {
                "AI_SERVER_HOST": "127.0.0.1",
                "REQUIRE_FIREBASE_AUTH": "false",
            },
            [
                "uvicorn",
                "server:app",
                "--host",
                "127.0.0.1",
                "--host",
                "0.0.0.0",
            ],
        )
        with self.assertRaises(RuntimeError) as ctx:
            self._run_lifespan_startup(server_mod)
        self.assertIn("REQUIRE_FIREBASE_AUTH", str(ctx.exception))

    def test_lifespan_allows_public_bind_with_auth(self) -> None:
        _config_mod, server_mod = self._load_server(
            {
                "UVICORN_HOST": "0.0.0.0",
                "REQUIRE_FIREBASE_AUTH": "true",
            },
            ["uvicorn", "server:app"],
        )
        self._run_lifespan_startup(server_mod)

    def test_lifespan_allows_unauth_loopback(self) -> None:
        _config_mod, server_mod = self._load_server(
            {
                "AI_SERVER_HOST": "127.0.0.1",
                "REQUIRE_FIREBASE_AUTH": "false",
            },
            ["python", "server.py"],
        )
        self._run_lifespan_startup(server_mod)

    def test_lifespan_rejects_cli_empty_host_before_listen(self) -> None:
        _config_mod, server_mod = self._load_server(
            {"REQUIRE_FIREBASE_AUTH": "false"},
            ["uvicorn", "server:app", "--host="],
        )
        with self.assertRaises(RuntimeError) as ctx:
            self._run_lifespan_startup(server_mod)
        self.assertIn("blank", str(ctx.exception).lower())

    def test_lifespan_rejects_cli_empty_string_host(self) -> None:
        _config_mod, server_mod = self._load_server(
            {"REQUIRE_FIREBASE_AUTH": "false"},
            ["uvicorn", "server:app", "--host", ""],
        )
        with self.assertRaises(RuntimeError) as ctx:
            self._run_lifespan_startup(server_mod)
        self.assertIn("blank", str(ctx.exception).lower())

    def test_lifespan_rejects_last_duplicate_cli_empty(self) -> None:
        _config_mod, server_mod = self._load_server(
            {
                "AI_SERVER_HOST": "127.0.0.1",
                "REQUIRE_FIREBASE_AUTH": "false",
            },
            [
                "uvicorn",
                "server:app",
                "--host",
                "127.0.0.1",
                "--host=",
            ],
        )
        with self.assertRaises(RuntimeError) as ctx:
            self._run_lifespan_startup(server_mod)
        self.assertIn("blank", str(ctx.exception).lower())

    def test_lifespan_rejects_cli_whitespace_host(self) -> None:
        _config_mod, server_mod = self._load_server(
            {"REQUIRE_FIREBASE_AUTH": "false"},
            ["uvicorn", "server:app", "--host", "   "],
        )
        with self.assertRaises(RuntimeError) as ctx:
            self._run_lifespan_startup(server_mod)
        self.assertIn("blank", str(ctx.exception).lower())

    def test_lifespan_allows_default_absent_host(self) -> None:
        _config_mod, server_mod = self._load_server(
            {"REQUIRE_FIREBASE_AUTH": "false"},
            ["uvicorn", "server:app"],
        )
        self._run_lifespan_startup(server_mod)


if __name__ == "__main__":
    unittest.main()
