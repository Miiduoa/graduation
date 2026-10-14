import hashlib
import importlib.util
import json
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location(
    'public_cafeteria_prepare',
    ROOT / 'deploy/nuni-api/public-cafeterias/prepare.py',
)
prepare = importlib.util.module_from_spec(spec)
spec.loader.exec_module(prepare)

class PrepareTests(unittest.TestCase):
    def test_changed_anchor_fails_closed(self):
        for source in ['', 'registerPublicCafeteriaRoutes', '  const normalizedMethod = method.toUpperCase();']:
            with self.assertRaises(ValueError):
                prepare.patch_app(source)

    def test_public_catalog_route_is_registered_without_enabling_writes(self):
        source = '  const normalizedMethod = method.toUpperCase();\n  app.get("/v1/auth/platform/providers", async () => {});'
        result = prepare.patch_app(source)
        self.assertIn('registerPublicCafeteriaRoutes(app, db)', result)
        self.assertIn('isPublicCafeteriaRoute', result)
        self.assertNotIn('ONLINE_ORDERING', result)
        with self.assertRaises(ValueError):
            prepare.patch_app(result)

    def test_candidate_copies_only_reviewed_sources(self):
        paths = prepare.extension_files()
        self.assertEqual(len(paths), 4)
        self.assertTrue(all(path.is_file() for path in paths.values()))
        self.assertNotIn('source.json', paths)
        pinned = json.loads(
            (ROOT / 'deploy/nuni-api/public-cafeterias/packaging-source.json').read_text()
        )
        files = {target: hashlib.sha256(source.read_bytes()).hexdigest() for target, source in paths.items()}
        self.assertEqual(files, pinned)

    def test_source_json_is_v20_four_patches(self):
        manifest = json.loads((ROOT / 'deploy/nuni-api/source.json').read_text())
        self.assertEqual(manifest['candidateTree'], '6776b19a7cea998728469c3091c0ea7c264f6aa3')
        self.assertEqual(manifest['candidateCommit'], 'cb57e78aa5f09155ec045ea4b5c130827cdf4fad')
        self.assertEqual(
            [patch['file'] for patch in manifest['patches']],
            [
                '0001-platform-admin-and-public-social.patch',
                '0002-runtime-grant-inventory.patch',
                '0003-social-schema-installation.patch',
                '0004-existing-platform-personas.patch',
            ],
        )
        self.assertTrue((ROOT / 'deploy/nuni-api/patches/0005-existing-food-order-access.patch').is_file())
        self.assertTrue((ROOT / 'deploy/nuni-api/patches/0006-food-order-realms.patch').is_file())

    def test_prepare_accepts_checkout_matching_source_tree(self):
        manifest = json.loads((ROOT / 'deploy/nuni-api/source.json').read_text())
        pinned = manifest['candidateTree']
        directory = Path(tempfile.mkdtemp())
        (directory / 'apps/api/src').mkdir(parents=True)
        (directory / 'apps/api/src/app.ts').write_text(
            '  const normalizedMethod = method.toUpperCase();\n  app.get("/v1/auth/platform/providers", async () => {});\n'
        )
        subprocess.run(['git', 'init'], cwd=directory, check=True, capture_output=True)
        subprocess.run(['git', 'add', '.'], cwd=directory, check=True)
        with self.assertRaisesRegex(ValueError, 'Base tree is not the reviewed runtime source'):
            prepare.apply_extension(directory, apply=False)
        original = subprocess.check_output

        def fake_check_output(args, **kwargs):
            if list(args)[:2] == ['git', 'write-tree']:
                return pinned + '\n' if kwargs.get('text') else (pinned + '\n').encode()
            return original(args, **kwargs)

        subprocess.check_output = fake_check_output
        try:
            plan = prepare.apply_extension(directory, apply=False)
            self.assertEqual(plan['baseTree'], pinned)
            self.assertEqual(plan['deploys'], False)
            self.assertEqual(plan['runsMigrations'], False)
        finally:
            subprocess.check_output = original

if __name__ == '__main__':
    unittest.main()
