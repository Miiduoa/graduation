import contextlib
import importlib.util
import io
import json
from pathlib import Path
import subprocess
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

HERE = Path(__file__).resolve().parent


def module(name, file):
    spec = importlib.util.spec_from_file_location(name, file)
    loaded = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(loaded)
    return loaded


prepare = module('permission_prepare_test', HERE / 'prepare.py')
build = module('permission_build_test', HERE.parent / 'build.py')


class PackagingTests(unittest.TestCase):
    def fixture(self, directory):
        checkout = Path(directory) / 'source'
        checkout.mkdir()
        subprocess.run(['git', 'init', '--quiet', str(checkout)], check=True)
        (checkout / 'apps/api/src/migrations').mkdir(parents=True)
        (checkout / 'apps/api/src/app.ts').write_text('preserved API\n')
        (checkout / 'apps/api/src/migrations/282_platform_lost_found.sql').write_text('preserved migration\n')
        (checkout / '.gitignore').write_text('apps/api/src/ignored/\n')
        subprocess.run(['git', 'add', '.'], cwd=checkout, check=True)
        input_tree = prepare.git(checkout, 'write-tree')
        (checkout / prepare.MIGRATION).write_bytes((HERE / '283_platform_assistant_permissions.sql').read_bytes())
        subprocess.run(['git', 'add', '.'], cwd=checkout, check=True)
        candidate_tree = prepare.git(checkout, 'write-tree')
        subprocess.run(['git', 'read-tree', input_tree], cwd=checkout, check=True)
        (checkout / prepare.MIGRATION).unlink()
        subprocess.run(['git', 'update-index', '--refresh'], cwd=checkout, check=True)
        return checkout, {**prepare.metadata(), 'inputTree': input_tree, 'candidateTree': candidate_tree}

    def test_manifest_verifies_without_claiming_a_complete_runtime_checkout(self):
        pinned = prepare.verify_sources()
        self.assertEqual(pinned['preservesLostFoundMigration'], '282_platform_lost_found')
        with contextlib.redirect_stdout(io.StringIO()) as output:
            prepare.main(['--verify-only'])
        result = json.loads(output.getvalue())
        self.assertTrue(result['sourceChecksumsVerified'])
        self.assertFalse(result['runtimeCheckoutVerified'])
        self.assertFalse(result['runsMigrations'])
        self.assertFalse(result['deploys'])

    def test_source_drift_stops_before_clone_or_build(self):
        changed = {**prepare.metadata(), 'baseManifestSha256': '0' * 64}
        with patch.object(prepare, 'metadata', return_value=changed), patch.object(prepare.subprocess, 'run') as run:
            with self.assertRaisesRegex(ValueError, 'source drift'):
                prepare.prepare('/unused-output')
            run.assert_not_called()

    def test_complete_overlay_keeps_the_api_and_prior_migration_byte_exact(self):
        with tempfile.TemporaryDirectory() as directory:
            checkout, manifest = self.fixture(directory)
            self.assertEqual(prepare.apply_extension(checkout, manifest), manifest['candidateTree'])
            self.assertEqual((checkout / 'apps/api/src/app.ts').read_text(), 'preserved API\n')
            self.assertEqual((checkout / 'apps/api/src/migrations/282_platform_lost_found.sql').read_text(), 'preserved migration\n')
            self.assertEqual(prepare.verify_checkout(checkout, manifest), manifest['candidateTree'])

    def test_wrong_input_and_untracked_runtime_files_are_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            checkout, manifest = self.fixture(directory)
            with self.assertRaisesRegex(ValueError, 'exact lost-found'):
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

    def test_builder_requires_explicit_candidate_and_matching_source_option(self):
        args = build.parse_args(['--assistant-permissions-candidate', '--prepare-only', '--output-dir', '/unused', '--assistant-permissions-source', '/archive'])
        self.assertTrue(args.assistant_permissions_candidate)
        self.assertEqual(args.assistant_permissions_source, Path('/archive'))
        self.assertFalse(build.parse_args([]).assistant_permissions_candidate)
        for flags in [
            ['--assistant-permissions-source', '/archive'],
            ['--assistant-permissions-candidate', '--imports-candidate'],
            ['--assistant-permissions-candidate', '--lost-found-candidate'],
            ['--assistant-permissions-candidate', '--assistant-candidate'],
            ['--assistant-permissions-candidate', '--security-candidate'],
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
            build.build(build.parse_args(['--assistant-permissions-candidate', '--prepare-only', '--output-dir', str(Path(directory) / 'new')]))
            extension.prepare.assert_called_once()
            run.assert_not_called()


if __name__ == '__main__':
    unittest.main()
