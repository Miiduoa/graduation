import contextlib
import importlib.util
import io
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]


def module(name, file):
    spec = importlib.util.spec_from_file_location(name, ROOT / file)
    loaded = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(loaded)
    return loaded


prepare = module('lost_found_prepare_test', 'deploy/nuni-api/lost-found/prepare.py')
build = module('lost_found_build_test', 'deploy/nuni-api/build.py')
INPUT_APP = '  const normalizedMethod = method.toUpperCase();\n  app.get("/v1/auth/platform/providers", async () => {});\n'


class PackagingTests(unittest.TestCase):
    def fixture(self, directory):
        checkout = Path(directory) / 'source'
        checkout.mkdir()
        subprocess.run(['git', 'init', '--quiet', str(checkout)], check=True)
        (checkout / 'apps/api/src').mkdir(parents=True)
        (checkout / prepare.APP).write_text(INPUT_APP)
        (checkout / '.gitignore').write_text('node_modules/\napps/api/src/ignored/\n')
        (checkout / 'README.md').write_text('Preserved input\n')
        subprocess.run(['git', 'add', '.'], cwd=checkout, check=True)
        manifest = prepare.current_manifest()
        manifest['inputTree'] = prepare.git(checkout, 'write-tree')
        manifest['inputAppSha256'] = prepare.sha(INPUT_APP.encode())
        return checkout, manifest

    def test_source_checksum_verification_does_not_claim_runtime_acceptance(self):
        result = prepare.verify_sources()
        self.assertFalse(result['enabledByDefault'])
        self.assertNotIn('candidateTree', result)
        with contextlib.redirect_stdout(io.StringIO()) as output:
            prepare.main(['--verify-only'])
        receipt = json.loads(output.getvalue())
        self.assertTrue(receipt['sourceChecksumsVerified'])
        self.assertFalse(receipt['runtimeCheckoutVerified'])
        self.assertFalse(receipt['runsMigrations'])
        self.assertFalse(receipt['enablesService'])

    def test_changed_adapter_or_sources_fail_before_clone(self):
        current = prepare.current_manifest()
        current['inputTree'] = '0' * 40
        with patch.object(prepare, 'current_manifest', return_value=current), patch.object(prepare.subprocess, 'run') as run:
            with self.assertRaisesRegex(ValueError, 'source drift'):
                prepare.prepare('/unused-output')
            run.assert_not_called()

    def test_registration_is_opt_in_and_keeps_existing_routes(self):
        result = prepare.patch_app(INPUT_APP)
        self.assertIn('if (isPlatformLostFoundRoute(normalizedMethod, pathname)) return true;', result)
        self.assertNotIn('CAMPUS_PLATFORM_LOST_FOUND_ENABLED', result)
        self.assertEqual(result.count('registerPlatformLostFoundRoutes(app, db, platformAccounts)'), 1)
        self.assertIn('  app.get("/v1/auth/platform/providers",', result)
        self.assertNotRegex(result, r'process\.env\.CAMPUS_PLATFORM_LOST_FOUND_ENABLED\s*=(?!=)')
        for source in ['', INPUT_APP + INPUT_APP, result, INPUT_APP.replace('const normalizedMethod', 'const other')]:
            with self.assertRaises(ValueError):
                prepare.patch_app(source)

    def test_overlay_has_only_the_declared_new_sources_and_app_change(self):
        with tempfile.TemporaryDirectory() as directory:
            checkout, manifest = self.fixture(directory)
            tree = prepare.apply_extension(checkout, manifest)
            self.assertEqual(tree, prepare.verify_checkout(checkout, manifest))
            self.assertEqual((checkout / 'README.md').read_text(), 'Preserved input\n')
            self.assertEqual((checkout / 'apps/api/src/lost-found/contracts.ts').read_bytes(),
                             (ROOT / 'packages/shared/src/nuniLostFound.ts').read_bytes())
            self.assertEqual((checkout / prepare.APP).read_text(), prepare.patch_app(INPUT_APP))

    def test_compatible_rollback_preserves_parent_routes_and_includes_same_cleanup_migration(self):
        with tempfile.TemporaryDirectory() as directory:
            checkout, manifest = self.fixture(directory)
            tree = prepare.apply_extension(checkout, manifest, compatible_rollback=True)
            self.assertEqual(tree, prepare.verify_checkout(checkout, manifest, compatible_rollback=True))
            self.assertEqual((checkout / prepare.APP).read_text(), prepare.patch_rollback_app(INPUT_APP))
            self.assertNotIn('registerPlatformLostFoundRoutes', (checkout / prepare.APP).read_text())
            self.assertEqual((checkout / prepare.MIGRATION).read_bytes(), (prepare.HERE / '282_platform_lost_found.sql').read_bytes())
            self.assertFalse((checkout / 'apps/api/src/lost-found/routes.ts').exists())
            with self.assertRaises(ValueError):
                prepare.verify_checkout(checkout, manifest)

    def test_rollback_bypasses_campus_auth_only_for_exact_known_post_paths(self):
        source = 'function isPublicApiRoute(method, pathname) {\n  const normalizedMethod = method.toUpperCase();\n  return false;\n}'
        patched = prepare.patch_rollback_app(source)
        checks = '''
const assert = require('node:assert/strict');
for (const action of ['list', 'get', 'create', 'update', 'resolve', 'remove', 'export']) {
  const path = '/v1/auth/platform/lost-found/' + action;
  assert.equal(isPublicApiRoute('POST', path), true);
  for (const method of ['GET', 'HEAD', 'PUT', 'DELETE', 'OPTIONS']) assert.equal(isPublicApiRoute(method, path), false);
  for (const suffix of ['/', '/extra', '?x=1']) assert.equal(isPublicApiRoute('POST', path + suffix), false);
}
assert.equal(isPublicApiRoute('POST', '/v1/auth/platform/lost-found/unknown'), false);
assert.equal(isPublicApiRoute('POST', '/v1/staff/lost-found/list'), false);
'''
        subprocess.run(['node', '-e', patched + checks], check=True)
        for invalid in ['', source + source, patched, prepare.patch_app(INPUT_APP)]:
            with self.assertRaises(ValueError):
                prepare.patch_rollback_app(invalid)

    def test_wrong_input_tree_and_untracked_input_are_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            checkout, manifest = self.fixture(directory)
            with self.assertRaisesRegex(ValueError, 'exact composed input'):
                prepare.apply_extension(checkout, {**manifest, 'inputTree': '0' * 40})
            (checkout / 'unexpected.ts').write_text('untracked')
            with self.assertRaisesRegex(ValueError, 'Untracked'):
                prepare.apply_extension(checkout, manifest)

    def test_staged_source_drift_or_extra_runtime_path_is_rejected(self):
        for extra in [False, True]:
            with self.subTest(extra=extra), tempfile.TemporaryDirectory() as directory:
                checkout, manifest = self.fixture(directory)
                prepare.apply_extension(checkout, manifest)
                target = 'apps/api/src/extra.ts' if extra else 'apps/api/src/lost-found/contracts.ts'
                (checkout / target).write_text('unexpected content')
                subprocess.run(['git', 'add', target], cwd=checkout, check=True)
                with self.assertRaises(ValueError):
                    prepare.verify_checkout(checkout, manifest)

    def test_ignored_runtime_sources_are_not_hidden_from_verification(self):
        with tempfile.TemporaryDirectory() as directory:
            checkout, manifest = self.fixture(directory)
            prepare.apply_extension(checkout, manifest)
            (checkout / 'apps/api/src/ignored').mkdir()
            (checkout / 'apps/api/src/ignored/extra.ts').write_text('unexpected')
            with self.assertRaisesRegex(ValueError, 'Ignored runtime'):
                prepare.verify_checkout(checkout, manifest)

    def test_runtime_modes_cannot_drift(self):
        with tempfile.TemporaryDirectory() as directory:
            checkout, manifest = self.fixture(directory)
            prepare.apply_extension(checkout, manifest)
            target = checkout / 'apps/api/src/lost-found/service.ts'
            target.chmod(0o755)
            subprocess.run(['git', 'add', str(target)], cwd=checkout, check=True)
            with self.assertRaisesRegex(ValueError, 'regular non-executable'):
                prepare.verify_checkout(checkout, manifest)

    def test_builder_requires_explicit_mutually_exclusive_candidate_and_output(self):
        for flag in ['--lost-found-candidate', '--lost-found-compatible-rollback']:
            args = build.parse_args([flag, '--prepare-only', '--output-dir', '/unused-output', '--lost-found-source', '/authorized/source'])
            self.assertTrue(args.prepare_only)
            self.assertEqual(args.lost_found_source, Path('/authorized/source'))
            for conflict in ['--imports-candidate', '--security-candidate', '--food-ordering-candidate', '--assistant-candidate']:
                with contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit):
                    build.parse_args([flag, conflict])
        with contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit):
            build.parse_args(['--lost-found-source', '/authorized/source'])
        args = build.parse_args([])
        self.assertFalse(args.lost_found_candidate)
        self.assertFalse(args.lost_found_compatible_rollback)


if __name__ == '__main__':
    unittest.main()
