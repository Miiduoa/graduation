import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

HERE = Path(__file__).resolve().parent
SQL_SHA256 = '915ada63acd28f1ddd78d81395d27dffed3ce193064a12b4718afc1a7af102d7'
STALE_DIGEST = 'be815455fbb2ccce844b69f004e416e44465e3421f9da654d0cd5db8379c3dc2'


def module(name, file):
    spec = importlib.util.spec_from_file_location(name, file)
    loaded = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(loaded)
    return loaded


prepare = module('closure_prepare_test', HERE / 'prepare.py')
build = module('closure_build_test', HERE.parent / 'build.py')


class PackagingTests(unittest.TestCase):
    def fixture(self, directory):
        checkout = Path(directory) / 'source'
        checkout.mkdir()
        subprocess.run(['git', 'init', '--quiet', str(checkout)], check=True)
        (checkout / 'apps/api/src/migrations').mkdir(parents=True)
        (checkout / 'apps/api/src/app.ts').write_text('preserved API\n')
        (checkout / 'apps/api/src/migrations/283_platform_assistant_permissions.sql').write_text('preserved migration\n')
        (checkout / '.gitignore').write_text('apps/api/src/ignored/\n')
        subprocess.run(['git', 'add', '.'], cwd=checkout, check=True)
        input_tree = prepare.git(checkout, 'write-tree')
        (checkout / prepare.MIGRATION).write_bytes((HERE / prepare.SQL_FILE).read_bytes())
        subprocess.run(['git', 'add', '.'], cwd=checkout, check=True)
        candidate_tree = prepare.git(checkout, 'write-tree')
        subprocess.run(['git', 'read-tree', input_tree], cwd=checkout, check=True)
        (checkout / prepare.MIGRATION).unlink()
        subprocess.run(['git', 'update-index', '--refresh'], cwd=checkout, check=True)
        return checkout, {**prepare.metadata(), 'inputTree': input_tree, 'candidateTree': candidate_tree}

    def committed_source(self, directory):
        checkout, _manifest = self.fixture(directory)
        subprocess.run(
            ['git', '-c', 'user.email=closure@test', '-c', 'user.name=closure',
             'commit', '--quiet', '-m', 'production-like source'],
            cwd=checkout, check=True)
        return checkout

    def test_manifest_verifies_without_claiming_a_complete_runtime_checkout(self):
        pinned = prepare.verify_sources()
        self.assertEqual(pinned['preservesAssistantPermissionsMigration'], '283_platform_assistant_permissions')
        self.assertEqual(pinned['inputTreePrefix'], '2e7cc189')
        self.assertEqual(pinned['rejectedInputTree'], '2d7a325c5d4cd185d0ba32c6603a1e703684199b')
        self.assertEqual(pinned['sourceFiles'][prepare.MIGRATION]['sha256'], SQL_SHA256)
        with contextlib.redirect_stdout(io.StringIO()) as output:
            prepare.main(['--verify-only'])
        result = json.loads(output.getvalue())
        self.assertTrue(result['sourceChecksumsVerified'])
        self.assertFalse(result['runtimeCheckoutVerified'])
        self.assertFalse(result['runsMigrations'])
        self.assertFalse(result['deploys'])
        self.assertEqual(result['inputTreePrefix'], '2e7cc189')

    def test_sql_bytes_and_001_file_are_canonical(self):
        self.assertEqual(prepare.sha((HERE / prepare.SQL_FILE).read_bytes()), SQL_SHA256)
        self.assertFalse((HERE / f'{prepare.FORBIDDEN_ID}.sql').exists())
        sql = (HERE / prepare.SQL_FILE).read_text()
        self.assertIsNone(re.search(r'(?m)^(BEGIN|COMMIT)\s*;', sql))
        self.assertNotIn('CREATE ROLE', sql)
        self.assertNotIn('GRANT ', sql)
        self.assertNotIn('001_tronclass_account_closure_outbox', sql)
        self.assertEqual(sql.count('CREATE TRIGGER'), 2)
        self.assertIn('CREATE TRIGGER tronclass_account_closed AFTER INSERT OR UPDATE OF state ON platform_accounts', sql)
        self.assertIn('CREATE TRIGGER tronclass_account_deleted AFTER DELETE ON platform_accounts', sql)
        self.assertNotIn('FROM platform_accounts', sql)
        self.assertNotRegex(sql, r'(?im)^(SELECT|INSERT INTO|UPDATE|DELETE FROM)\b')

    def test_source_drift_stops_before_clone_or_build(self):
        changed = {**prepare.metadata(), 'baseManifestSha256': '0' * 64}
        with patch.object(prepare, 'metadata', return_value=changed), patch.object(prepare.subprocess, 'run') as run:
            with self.assertRaisesRegex(ValueError, 'source drift'):
                prepare.prepare('/unused-output', '/unused-source')
            run.assert_not_called()

    def test_prepare_without_source_does_not_rebuild_stale_283(self):
        with patch.object(prepare.subprocess, 'run') as run:
            with self.assertRaisesRegex(ValueError, '2e7cc189'):
                prepare.prepare('/unused-output')
            run.assert_not_called()

    def test_prepare_rejects_non_production_and_stale_283_trees(self):
        with self.assertRaisesRegex(ValueError, '2e7cc189'):
            prepare.assert_production_input('abc123' + '0' * 34)
        with self.assertRaisesRegex(ValueError, '2d7a325c'):
            prepare.assert_production_input('2d7a325c5d4cd185d0ba32c6603a1e703684199b')
        prepare.assert_production_input('2e7cc189' + 'a' * 32)

    def test_prepare_clone_rejects_a_non_production_source_before_overlay(self):
        with tempfile.TemporaryDirectory() as directory:
            source = self.committed_source(directory)
            output = Path(directory) / 'out'
            with self.assertRaisesRegex(ValueError, '2e7cc189'):
                prepare.prepare(output, source)
            self.assertFalse((output / prepare.MIGRATION).exists())

    def test_complete_overlay_keeps_the_api_and_prior_migration_byte_exact(self):
        with tempfile.TemporaryDirectory() as directory:
            checkout, manifest = self.fixture(directory)
            self.assertEqual(prepare.apply_extension(checkout, manifest), manifest['candidateTree'])
            self.assertEqual((checkout / 'apps/api/src/app.ts').read_text(), 'preserved API\n')
            self.assertEqual(
                (checkout / 'apps/api/src/migrations/283_platform_assistant_permissions.sql').read_text(),
                'preserved migration\n')
            self.assertEqual(prepare.sha((checkout / prepare.MIGRATION).read_bytes()), SQL_SHA256)
            self.assertEqual(prepare.verify_checkout(checkout, manifest), manifest['candidateTree'])

    def test_wrong_input_and_untracked_runtime_files_are_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            checkout, manifest = self.fixture(directory)
            with self.assertRaisesRegex(ValueError, 'exact production'):
                prepare.apply_extension(checkout, {**manifest, 'inputTree': '0' * 40})
            (checkout / 'apps/api/src/unexpected.ts').write_text('unexpected')
            with self.assertRaisesRegex(ValueError, 'Untracked'):
                prepare.apply_extension(checkout, manifest)

    def test_ignored_sources_are_not_hidden_from_verification(self):
        with tempfile.TemporaryDirectory() as directory:
            checkout, manifest = self.fixture(directory)
            (checkout / 'apps/api/src/ignored').mkdir()
            (checkout / 'apps/api/src/ignored/extra.ts').write_text('unexpected')
            with self.assertRaisesRegex(ValueError, 'Ignored runtime'):
                prepare.apply_extension(checkout, manifest)

    def test_staged_extra_file_cannot_be_laundered_by_replacing_expected_tree(self):
        with tempfile.TemporaryDirectory() as directory:
            checkout, manifest = self.fixture(directory)
            prepare.apply_extension(checkout, manifest)
            (checkout / 'apps/api/src/unexpected.ts').write_text('unexpected')
            subprocess.run(['git', 'add', '.'], cwd=checkout, check=True)
            manifest['candidateTree'] = prepare.git(checkout, 'write-tree')
            with self.assertRaisesRegex(ValueError, 'unexpected paths'):
                prepare.verify_checkout(checkout, manifest)

    def test_changed_migration_and_executable_mode_are_rejected(self):
        for executable in [False, True]:
            with self.subTest(executable=executable), tempfile.TemporaryDirectory() as directory:
                checkout, manifest = self.fixture(directory)
                prepare.apply_extension(checkout, manifest)
                if executable:
                    (checkout / prepare.MIGRATION).chmod(0o755)
                else:
                    (checkout / prepare.MIGRATION).write_text('unreviewed migration')
                subprocess.run(['git', 'add', '.'], cwd=checkout, check=True)
                manifest['candidateTree'] = prepare.git(checkout, 'write-tree')
                with self.assertRaises(ValueError):
                    prepare.verify_checkout(checkout, manifest)

    def test_001_filename_in_checkout_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            checkout, manifest = self.fixture(directory)
            leftover = checkout / 'apps/api/src/migrations/001_tronclass_account_closure_outbox.sql'
            leftover.write_text('must never reach dist/migrations')
            subprocess.run(['git', 'add', '.'], cwd=checkout, check=True)
            manifest['inputTree'] = prepare.git(checkout, 'write-tree')
            with self.assertRaisesRegex(ValueError, '001 migration id'):
                prepare.apply_extension(checkout, manifest)

    def test_builder_requires_explicit_candidate_and_matching_source_option(self):
        args = build.parse_args([
            '--tronclass-account-closure-candidate', '--prepare-only',
            '--output-dir', '/unused', '--tronclass-account-closure-source', '/archive',
        ])
        self.assertTrue(args.tronclass_account_closure_candidate)
        self.assertEqual(args.tronclass_account_closure_source, Path('/archive'))
        self.assertFalse(build.parse_args([]).tronclass_account_closure_candidate)
        for flags in [
            ['--tronclass-account-closure-source', '/archive'],
            ['--tronclass-account-closure-candidate'],
            ['--tronclass-account-closure-candidate', '--prepare-only', '--output-dir', '/unused'],
            ['--tronclass-account-closure-candidate', '--imports-candidate',
             '--tronclass-account-closure-source', '/archive'],
            ['--tronclass-account-closure-candidate', '--assistant-permissions-candidate',
             '--tronclass-account-closure-source', '/archive'],
            ['--tronclass-account-closure-candidate', '--tronclass-account-closure-compatible-rollback',
             '--tronclass-account-closure-source', '/archive'],
            ['--tronclass-account-closure-compatible-rollback', '--imports-compatible-rollback'],
        ]:
            with contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit):
                build.parse_args(flags)

    def test_prepare_only_never_builds_pushes_or_migrates(self):
        extension = SimpleNamespace(prepare=Mock(return_value='a' * 40))
        spec = SimpleNamespace(loader=SimpleNamespace(exec_module=Mock()))
        with tempfile.TemporaryDirectory() as directory, contextlib.redirect_stdout(io.StringIO()), \
                patch.object(build.importlib.util, 'spec_from_file_location', return_value=spec), \
                patch.object(build.importlib.util, 'module_from_spec', return_value=extension), \
                patch.object(build.subprocess, 'run') as run:
            build.build(build.parse_args([
                '--tronclass-account-closure-candidate', '--prepare-only',
                '--output-dir', str(Path(directory) / 'new'),
                '--tronclass-account-closure-source', '/archive',
            ]))
            extension.prepare.assert_called_once()
            run.assert_not_called()

    def test_rollback_dockerfile_copies_only_284_from_a_live_digest_arg(self):
        dockerfile = (HERE / 'Dockerfile.rollback').read_text()
        rollback = json.loads((HERE / 'rollback-source.json').read_text())
        self.assertNotIn(STALE_DIGEST, dockerfile)
        self.assertNotIn('be815455', dockerfile)
        self.assertNotIn('278_course_access_review.sql', dockerfile)
        self.assertEqual(dockerfile.count('COPY '), 1)
        self.assertIn(
            'COPY deploy/nuni-api/tronclass-account-closure/284_tronclass_account_closure_outbox.sql '
            '/app/apps/api/dist/migrations/284_tronclass_account_closure_outbox.sql',
            dockerfile)
        self.assertIn('ARG NUNI_API_PRODUCTION_DIGEST', dockerfile)
        self.assertEqual(
            rollback['migrations']['deploy/nuni-api/tronclass-account-closure/284_tronclass_account_closure_outbox.sql'],
            SQL_SHA256)
        self.assertIn(f'sha256:{STALE_DIGEST}', rollback['forbiddenBaseDigests'])

    def test_prepare_only_rollback_writes_sql_and_dockerfile_without_docker(self):
        with tempfile.TemporaryDirectory() as scratch, patch.object(build.subprocess, 'run') as run:
            output = Path(scratch) / 'rollback'
            build.build(build.parse_args([
                '--tronclass-account-closure-compatible-rollback',
                '--prepare-only', '--output-dir', str(output),
            ]))
            manifest = json.loads((output / 'release-source.json').read_text())
            self.assertEqual(
                prepare.sha((output / 'deploy/nuni-api/tronclass-account-closure/284_tronclass_account_closure_outbox.sql').read_bytes()),
                SQL_SHA256)
            self.assertEqual((output / 'Dockerfile').read_bytes(), (HERE / 'Dockerfile.rollback').read_bytes())
            self.assertEqual(
                manifest['migrations']['deploy/nuni-api/tronclass-account-closure/284_tronclass_account_closure_outbox.sql'],
                SQL_SHA256)
            self.assertNotIn(STALE_DIGEST, (output / 'Dockerfile').read_text())
            run.assert_not_called()

    def test_rollback_build_refuses_stale_digest_and_missing_env(self):
        with patch.object(build.subprocess, 'run') as run, patch.dict(os.environ, {}, clear=False):
            os.environ.pop('NUNI_API_PRODUCTION_DIGEST', None)
            with self.assertRaisesRegex(SystemExit, 'NUNI_API_PRODUCTION_DIGEST'):
                build.build(build.parse_args(['--tronclass-account-closure-compatible-rollback']))
            run.assert_not_called()
        with patch.object(build.subprocess, 'run') as run, patch.dict(
                os.environ, {'NUNI_API_PRODUCTION_DIGEST': STALE_DIGEST}):
            with self.assertRaisesRegex(SystemExit, 'stale'):
                build.build(build.parse_args(['--tronclass-account-closure-compatible-rollback']))
            run.assert_not_called()


if __name__ == '__main__':
    unittest.main()
