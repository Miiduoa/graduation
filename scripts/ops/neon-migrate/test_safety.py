"""Offline regression tests. No PostgreSQL server or external service is used."""
import contextlib
import io
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

from safety import SafetyError, database_url, ensure_web_role, postgres, postgres_env, validate_fly_secrets
import replay_delta
from qa_cleanup import PREFIX, Storage, execute, validate_objects

ROOT = Path(__file__).resolve().parent
URL = "postgresql://owner:private-pass@ep-example.ap-southeast-1.aws.neon.tech/neondb?sslmode=require"


class UrlTests(unittest.TestCase):
    def test_invalid_urls_fail_before_connecting(self):
        invalid = ["", " ", "not-a-url?sslmode=require", "https://owner:pw@example.com/db?sslmode=require",
                   "postgresql:///db?sslmode=require", "postgresql://owner:pw@example.com/?sslmode=require",
                   "postgresql://owner:pw@example.com:0/db?sslmode=require", "postgresql://owner@example.com/db?sslmode=require",
                   "postgresql://owner:pw@example.com/db", "postgresql://owner:pw@ep-a-pooler.neon.tech/db?sslmode=require",
                   "postgresql://owner:pw@aws-0.pooler.supabase.com/db?sslmode=require",
                   URL + "&sslmode=disable", URL + "&host=other.example", URL + "#fragment", URL + "%XX",
                   "postgresql://owner:pw@127.0.0.1/db?sslmode=invalid", URL + "\n", URL.replace("private-pass", "p%00w")]
        for value in invalid:
            with self.subTest(value=value), self.assertRaises(SafetyError):
                database_url(value)

    def test_valid_remote_and_local_urls(self):
        self.assertEqual(database_url(URL)["host"], "ep-example.ap-southeast-1.aws.neon.tech")
        self.assertEqual(database_url("postgresql://user:p%40%27%24%24%5C@localhost:5433/db")["password"], "p@'$$\\")
        self.assertEqual(database_url("postgres://user:pw@[::1]/db")["port"], 5432)

    def test_inherited_pg_settings_cannot_redirect_connection(self):
        with patch.dict(os.environ, {"PGHOSTADDR": "10.0.0.1", "PGSERVICE": "production", "PGOPTIONS": "unsafe"}):
            env = postgres_env(URL)
        self.assertNotIn("PGHOSTADDR", env)
        self.assertNotIn("PGSERVICE", env)
        self.assertNotIn("PGOPTIONS", env)
        self.assertEqual(env["PGSSLMODE"], "require")

    def test_fly_rejects_empty_duplicate_default_and_local_apply(self):
        for contents in ["DATABASE_URL=\n", "DATABASE_URL=not-a-url?sslmode=require\n",
                         "DATABASE_URL=" + URL + "\nDATABASE_URL=" + URL,
                         "DATABASE_URL=" + URL.replace("private-pass", "password"),
                         "DATABASE_URL=postgresql://owner:pw@127.0.0.1/db", "OTHER=" + URL]:
            with self.subTest(contents=contents), self.assertRaises(SafetyError):
                validate_fly_secrets(contents, "nuni-api", True)
        self.assertEqual(validate_fly_secrets("DATABASE_URL=" + URL, "nuni-api", True), "DATABASE_URL")

    def test_psql_failure_redacts_url_and_password(self):
        result = subprocess.CompletedProcess([], 2, "", "failed: " + URL + " private-pass role-secret")
        with patch("safety.subprocess.run", return_value=result) as run:
            with self.assertRaises(SafetyError) as error:
                postgres(URL, [], secrets=("role-secret",))
        self.assertNotIn(URL, str(error.exception))
        self.assertNotIn("private-pass", str(error.exception))
        self.assertNotIn("role-secret", str(error.exception))
        self.assertNotIn(URL, run.call_args.args[0])

    def test_missing_role_uses_correct_sql_format_and_stdin(self):
        lookup = subprocess.CompletedProcess([], 0, "0\n", "")
        created = subprocess.CompletedProcess([], 0, "", "")
        password = "secret'$$\\end"
        with patch("safety.subprocess.run", side_effect=[lookup, created]) as run:
            self.assertTrue(ensure_web_role(URL, "nuni_web_files", password))
        sql = run.call_args.kwargs["input"]
        self.assertIn("CREATE ROLE %I LOGIN PASSWORD %L", sql)
        self.assertNotIn("%%I", sql)
        self.assertIn("secret''$$\\end", sql)
        self.assertNotIn(password, " ".join(run.call_args.args[0]))

    def test_sql_escaped_password_is_redacted_on_failure(self):
        secret = "sensitive'$$\\end"
        with patch("safety.subprocess.run", return_value=subprocess.CompletedProcess([], 1, "", "LINE: " + secret.replace("'", "''"))):
            with self.assertRaises(SafetyError) as error:
                postgres(URL, [], secrets=(secret,))
        self.assertNotIn("sensitive", str(error.exception))

    def test_existing_role_does_not_reset_password(self):
        with patch("safety.subprocess.run", return_value=subprocess.CompletedProcess([], 0, "1\n", "")) as run:
            self.assertFalse(ensure_web_role(URL, "nuni_web_files", "new-password"))
        self.assertEqual(run.call_count, 1)

    def test_new_role_error_does_not_leak_credentials(self):
        with patch("safety.subprocess.run", side_effect=[subprocess.CompletedProcess([], 0, "0\n", ""),
                subprocess.CompletedProcess([], 1, "", "permission denied private-pass new-role-password")]):
            with self.assertRaises(SafetyError) as error:
                ensure_web_role(URL, "new_role", "new-role-password")
        self.assertNotIn("private-pass", str(error.exception))
        self.assertNotIn("new-role-password", str(error.exception))

    def test_fly_shell_never_invokes_mutation_for_invalid_input(self):
        with tempfile.TemporaryDirectory() as directory:
            fake = Path(directory) / "flyctl"
            marker = Path(directory) / "called"
            fake.write_text('#!/usr/bin/env python3\nimport os,sys\nopen(os.environ["CALL_MARKER"],"w").write(" ".join(sys.argv[1:]))\n')
            fake.chmod(0o755)
            env = {**os.environ, "PATH": directory + ":" + os.environ["PATH"], "CALL_MARKER": str(marker),
                   "APP": "nuni-api", "APPLY_SECRETS": "yes"}
            for value in ["", "not-a-url?sslmode=require", "postgresql://u:p@127.0.0.1/db"]:
                result = subprocess.run(["bash", str(ROOT / "04-switch-fly-secrets.sh")], input="DATABASE_URL=" + value + "\n",
                                        env=env, capture_output=True, text=True)
                self.assertNotEqual(result.returncode, 0)
                self.assertFalse(marker.exists())
            result = subprocess.run(["bash", str(ROOT / "04-switch-fly-secrets.sh")], input="DATABASE_URL=" + URL + "\n",
                                    env=env, capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(marker.read_text(), "secrets import --app nuni-api --stage")
            self.assertNotIn("private-pass", result.stdout + result.stderr)

    def test_existing_elevated_or_nologin_role_rejected(self):
        with patch("safety.subprocess.run", return_value=subprocess.CompletedProcess([], 0, "2\n", "")):
            with self.assertRaises(SafetyError):
                ensure_web_role(URL, "nuni_web_files", "new-password")

    def test_fly_modes_and_coordinated_rollback_guard(self):
        with tempfile.TemporaryDirectory() as directory:
            marker = Path(directory) / "called"
            fake = Path(directory) / "flyctl"
            fake.write_text('#!/usr/bin/env python3\nimport os\nopen(os.environ["CALL_MARKER"],"w").write("called")\n')
            fake.chmod(0o755)
            env = {**os.environ, "PATH": directory + ":" + os.environ["PATH"], "CALL_MARKER": str(marker),
                   "APP": "nuni-api", "APPLY_SECRETS": "yes", "STAGE": "yes", "CONFIRM_WRITES_STOPPED": "no"}
            for script, overrides in [("04-switch-fly-secrets.sh", {"STAGE": "typo"}),
                                      ("04-switch-fly-secrets.sh", {"APPLY_SECRETS": "typo"}),
                                      ("05-rollback-fly-secrets.sh", {})]:
                result = subprocess.run(["bash", str(ROOT / script)], input="DATABASE_URL=" + URL + "\n",
                                        env={**env, **overrides}, capture_output=True, text=True)
                self.assertNotEqual(result.returncode, 0)
                self.assertFalse(marker.exists())


class DeltaTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.env = {"NEW_DATABASE_URL": URL, "OLD_DATABASE_URL": URL.replace("/neondb", "/old"),
                    "CUTOVER_TS": "2026-10-22T00:00:00Z", "WORKDIR": self.tmp.name, "APPLY_DELTA": "no",
                    "SKIP_TABLES": ""}
        self.patch_env = patch.dict(os.environ, self.env)
        self.patch_env.start()
        self.addCleanup(self.patch_env.stop)
        self.calls = []
        self.mock_pg = patch("replay_delta.postgres", side_effect=self.pg)
        self.mock_pg.start()
        self.addCleanup(self.mock_pg.stop)
        self.output = contextlib.redirect_stdout(io.StringIO())
        self.output.__enter__()
        self.addCleanup(self.output.__exit__, None, None, None)

    def pg(self, url, args, **kwargs):
        sql = args[-1]
        self.calls.append(sql)
        if "pg_index" in sql:
            value = b"people\t{id}\nschema_migrations\t{id}\n"
        elif "pg_attribute" in sql:
            value = b"people\t{id,updated_at}\nschema_migrations\t{id,applied_at}\n"
        else:
            value = b"0\n"
        return subprocess.CompletedProcess([], 0, value, b"")

    def test_schema_migrations_cannot_be_unskipped(self):
        replay_delta.main()
        report = json.loads((Path(self.tmp.name) / "delta-report.json").read_text())
        self.assertEqual(report["skipped"], ["schema_migrations"])
        self.assertFalse(any("INSERT INTO" in sql for sql in self.calls))

    def test_different_target_and_partial_report_block_apply(self):
        replay_delta.main()
        path = Path(self.tmp.name) / "delta-report.json"
        with patch.dict(os.environ, {"APPLY_DELTA": "yes", "OLD_DATABASE_URL": URL.replace("/neondb", "/different")}):
            with self.assertRaises(SafetyError):
                replay_delta.main()
        report = json.loads(path.read_text())
        report["partially_applied"] = True
        path.write_text(json.dumps(report))
        with patch.dict(os.environ, {"APPLY_DELTA": "yes"}):
            with self.assertRaises(SafetyError):
                replay_delta.main()
        report["partially_applied"] = False
        report["failures"] = ["missing primary key"]
        path.write_text(json.dumps(report))
        with patch.dict(os.environ, {"APPLY_DELTA": "yes"}):
            with self.assertRaises(SafetyError):
                replay_delta.main()
        self.assertFalse(any("INSERT INTO" in sql for sql in self.calls))

    def test_same_database_with_different_role_and_invalid_timestamp_rejected(self):
        for values in [{"OLD_DATABASE_URL": URL.replace("owner:", "other:")},
                       {"CUTOVER_TS": "2026-99-99T00:00:00Z"}, {"CUTOVER_TS": "2026-10-22T00:00:00"}]:
            with self.subTest(values=values), patch.dict(os.environ, values), self.assertRaises(SafetyError):
                replay_delta.main()
        self.assertEqual(self.calls, [])


class FakeStorage:
    def __init__(self, count=102):
        self.files = {PREFIX + f"nested/file-{i:03}.jpg": {"path": PREFIX + f"nested/file-{i:03}.jpg", "id": str(i),
                      "updated_at": "2026-10-22T00:00:00Z", "metadata": {"size": i}} for i in range(count)}
        self.deletes = []
        self.calls = []
        self.fail_delete = False
        self.keep_delete = False

    def request(self, method, action, payload):
        self.calls.append((method, action, payload))
        if method == "DELETE":
            self.deletes += payload["prefixes"]
            if self.fail_delete:
                self.fail_delete = False
                self.files.pop(payload["prefixes"][0], None)
                raise SafetyError("simulated partial failure")
            for path in payload["prefixes"]:
                if not self.keep_delete:
                    self.files.pop(path, None)
            return [{"name": path} for path in payload["prefixes"]]
        prefix = payload["prefix"].rstrip("/") + "/"
        items = {}
        for path, record in self.files.items():
            if not path.startswith(prefix):
                continue
            relative = path[len(prefix):]
            name, _, rest = relative.partition("/")
            items[name] = {"name": name, "id": None, "metadata": None} if rest else {**record, "name": name}
        ordered = [items[name] for name in sorted(items)]
        return ordered[payload["offset"]:payload["offset"] + payload["limit"]]

    def client(self):
        return Storage("https://storage.example.test", "test-only-key", self.request)


class StorageTests(unittest.TestCase):
    def test_nested_pagination_and_exact_delete_paths(self):
        fake = FakeStorage()
        client = fake.client()
        objects = client.list()
        self.assertEqual(len(objects), 102)
        self.assertTrue(any(call[2].get("offset") == 100 for call in fake.calls))
        client.remove([item["path"] for item in objects])
        self.assertEqual(client.list(), [])
        self.assertEqual(len(fake.deletes), 102)
        self.assertNotIn(PREFIX, fake.deletes)

    def test_folder_and_out_of_scope_delete_rejected(self):
        client = FakeStorage().client()
        for paths in [[PREFIX], ["other/file"], [PREFIX + "nested/"]]:
            with self.assertRaises(SafetyError):
                client.remove(paths)

    def test_invalid_storage_base_and_malformed_response_rejected(self):
        for base in ["", "http://remote.example", "https://key@remote.example", "https://remote.example/other"]:
            with self.assertRaises(SafetyError):
                Storage(base, "secret")
        for payload in [{"error": "failed"}, [{"name": "../escape", "id": "1"}], [{"name": "file", "metadata": {}}]]:
            with self.subTest(payload=payload), self.assertRaises(SafetyError):
                Storage("https://example.test", "secret", lambda *args: payload).list()

    def test_changed_and_new_files_rejected(self):
        objects = FakeStorage(1).client().list()
        with self.assertRaises(SafetyError):
            validate_objects([{**objects[0], "updated_at": "changed"}], objects)
        with self.assertRaises(SafetyError):
            validate_objects(FakeStorage(2).client().list(), objects, allow_missing=True)
        validate_objects([], objects, allow_missing=True)


class ReceiptTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.directory = Path(self.tmp.name)
        self.path = self.directory / "receipt.json"
        self.fake = FakeStorage(2)
        self.client = self.fake.client()
        self.sql = patch("qa_cleanup.run_sql", return_value=("a" * 64, "preview"))
        self.run_sql = self.sql.start()
        self.output = contextlib.redirect_stdout(io.StringIO())
        self.output.__enter__()
        self.addCleanup(self.output.__exit__, None, None, None)
        self.addCleanup(self.sql.stop)
        self.addCleanup(self.tmp.cleanup)

    def run_mode(self, mode, **kwargs):
        return execute(mode, URL, self.directory, self.path, self.client, **kwargs)

    def test_receipt_binding_and_private_permissions(self):
        receipt = self.run_mode("list")
        self.assertEqual(self.path.stat().st_mode & 0o777, 0o600)
        self.assertNotIn("private-pass", self.path.read_text())
        self.assertEqual(receipt["database"]["database"], "neondb")
        with self.assertRaises(SafetyError):
            execute("apply", URL.replace("/neondb", "/otherdb"), self.directory, self.path, self.client,
                    confirmed=True, writes_stopped=True)
        self.assertFalse(self.fake.deletes)

    def test_missing_confirmation_and_stale_scope_block_mutation(self):
        self.run_mode("list")
        with self.assertRaises(SafetyError):
            self.run_mode("apply", confirmed=True)
        self.fake.files[next(iter(self.fake.files))]["updated_at"] = "changed"
        with self.assertRaises(SafetyError):
            self.run_mode("apply", confirmed=True, writes_stopped=True)
        self.assertEqual(self.run_sql.call_count, 1)
        self.assertFalse(self.fake.deletes)

    def test_sql_failure_never_deletes_storage(self):
        self.run_mode("list")
        self.run_sql.side_effect = SafetyError("stale SQL receipt")
        with self.assertRaises(SafetyError):
            self.run_mode("apply", confirmed=True, writes_stopped=True)
        self.assertFalse(self.fake.deletes)
        self.assertEqual(json.loads(self.path.read_text())["stage"], "reviewed")

    def test_partial_delete_resumes_only_reviewed_files(self):
        self.run_mode("list")
        self.fake.fail_delete = True
        with self.assertRaises(SafetyError):
            self.run_mode("apply", confirmed=True, writes_stopped=True)
        self.assertEqual(json.loads(self.path.read_text())["stage"], "sql_applied")
        receipt = self.run_mode("apply", confirmed=True, writes_stopped=True)
        self.assertEqual(receipt["stage"], "completed")
        self.assertFalse(self.fake.files)
        self.assertEqual(self.run_sql.call_count, 2)  # list + one SQL apply; no replay after commit.

    def test_false_success_delete_response_is_detected(self):
        self.run_mode("list")
        self.fake.keep_delete = True
        with self.assertRaises(SafetyError):
            self.run_mode("apply", confirmed=True, writes_stopped=True)
        self.assertEqual(json.loads(self.path.read_text())["stage"], "sql_applied")

    def test_modified_sql_binding_rejected(self):
        self.run_mode("list")
        receipt = json.loads(self.path.read_text())
        receipt["sql_sha256"] = "0" * 64
        self.path.write_text(json.dumps(receipt))
        with self.assertRaises(SafetyError):
            self.run_mode("apply", confirmed=True, writes_stopped=True)
        self.assertFalse(self.fake.deletes)


if __name__ == "__main__":
    unittest.main()
