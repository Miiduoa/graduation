import hashlib
import importlib.util
import json
import subprocess
import tempfile
import unittest
from contextlib import contextmanager
from unittest.mock import patch
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

    def test_overlay_routes_keep_online_ordering_write_switch(self):
        source = (ROOT / 'deploy/nuni-api/public-cafeterias/routes.ts').read_text()
        self.assertIn('ONLINE_ORDERING_ENABLED', source)
        self.assertIn('ONLINE_ORDERING_DISABLED', source)
        self.assertIn('isOrderingWrite', source)
        self.assertIn("process.env.ONLINE_ORDERING_ENABLED === 'true'", source)

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

    def test_packaged_inventory_is_bound_to_current_sources_and_patch(self):
        overlay = ROOT / 'deploy/nuni-api/public-cafeterias'
        binding = json.loads((overlay / 'packaging-inventory.json').read_text())
        self.assertEqual(binding['sourceFiles'], json.loads((overlay / 'packaging-source.json').read_text()))
        self.assertEqual(
            binding['patchSha256'],
            hashlib.sha256((overlay / 'runtime-inventory.patch').read_bytes()).hexdigest(),
        )

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

    @contextmanager
    def inventory_fixture(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            checkout = directory / 'checkout'
            source_root = directory / 'package'
            overlay = source_root / 'deploy/nuni-api/public-cafeterias'
            overlay.mkdir(parents=True)
            for target, source in prepare.extension_files().items():
                name = Path(target).name
                destination = (
                    source_root / 'packages/shared/src' / name
                    if name in ('cafeteriaCatalog.ts', 'merchantMode.ts')
                    else overlay / name
                )
                destination.parent.mkdir(parents=True, exist_ok=True)
                destination.write_bytes(source.read_bytes())
            (checkout / 'apps/api/src').mkdir(parents=True)
            original_app = (
                '  const normalizedMethod = method.toUpperCase();\n'
                '  app.get("/v1/auth/platform/providers", async () => {});\n'
            )
            (checkout / 'apps/api/src/app.ts').write_text(original_app)
            inventory_file = checkout / 'runtime-grant-matrix.json'
            initial_inventory = '{"baseline":true}\n'
            final_inventory = '{"baseline":true,"catalog":true}\n'
            inventory_file.write_text(initial_inventory)
            subprocess.run(['git', 'init', '--quiet'], cwd=checkout, check=True)
            subprocess.run(['git', 'add', '.'], cwd=checkout, check=True)
            base_tree = subprocess.check_output(
                ['git', 'write-tree'], cwd=checkout, text=True,
            ).strip()
            inventory_file.write_text(final_inventory)
            inventory_patch = subprocess.check_output(
                ['git', 'diff', '--binary', '--', 'runtime-grant-matrix.json'], cwd=checkout,
            )
            inventory_file.write_text(initial_inventory)
            (overlay / 'runtime-inventory.patch').write_bytes(inventory_patch)
            (overlay.parent / 'source.json').write_text(json.dumps({'candidateTree': base_tree}))
            with patch.object(prepare, 'HERE', overlay), patch.object(prepare, 'ROOT', source_root):
                source_hashes = {
                    target: hashlib.sha256(source.read_bytes()).hexdigest()
                    for target, source in prepare.extension_files().items()
                }
                (overlay / 'packaging-source.json').write_text(json.dumps(source_hashes))
                binding = {
                    'sourceFiles': source_hashes,
                    'appSha256': hashlib.sha256(prepare.patch_app(original_app).encode()).hexdigest(),
                    'patchSha256': hashlib.sha256(inventory_patch).hexdigest(),
                    'inventorySha256': hashlib.sha256(final_inventory.encode()).hexdigest(),
                }
                (overlay / 'packaging-inventory.json').write_text(json.dumps(binding))
                yield {
                    'checkout': checkout,
                    'overlay': overlay,
                    'baseTree': base_tree,
                    'app': original_app,
                    'initialInventory': initial_inventory,
                    'finalInventory': final_inventory,
                    'binding': binding,
                }

    def assert_candidate_untouched(self, fixture):
        checkout = fixture['checkout']
        self.assertEqual((checkout / 'apps/api/src/app.ts').read_text(), fixture['app'])
        self.assertEqual(
            (checkout / 'runtime-grant-matrix.json').read_text(), fixture['initialInventory'],
        )
        self.assertFalse((checkout / 'apps/api/src/public-cafeterias').exists())
        self.assertEqual(
            subprocess.check_output(['git', 'write-tree'], cwd=checkout, text=True).strip(),
            fixture['baseTree'],
        )

    def test_inventory_bound_plan_and_apply_use_real_git_patch(self):
        with self.inventory_fixture() as fixture:
            plan = prepare.apply_extension(fixture['checkout'], apply=False)
            self.assertEqual(plan['baseTree'], fixture['baseTree'])
            self.assertEqual(plan['runtimeInventorySha256'], fixture['binding']['inventorySha256'])
            for flag in ('deploys', 'runsMigrations', 'writesProductionDatabase'):
                self.assertFalse(plan[flag])
            self.assert_candidate_untouched(fixture)
            applied = prepare.apply_extension(fixture['checkout'], apply=True)
            self.assertNotEqual(applied['candidateTree'], fixture['baseTree'])
            self.assertEqual(
                (fixture['checkout'] / 'runtime-grant-matrix.json').read_text(),
                fixture['finalInventory'],
            )
            self.assertEqual(
                (fixture['checkout'] / 'apps/api/src/app.ts').read_text(),
                prepare.patch_app(fixture['app']),
            )
            for target, source in prepare.extension_files().items():
                self.assertEqual((fixture['checkout'] / target).read_bytes(), source.read_bytes())
            self.assertEqual(
                subprocess.check_output(['git', 'write-tree'], cwd=fixture['checkout'], text=True).strip(),
                applied['candidateTree'],
            )
            subprocess.run(['git', 'diff', '--exit-code', '--quiet'], cwd=fixture['checkout'], check=True)

    def test_changed_base_tree_fails_before_copying(self):
        with self.inventory_fixture() as fixture:
            (fixture['overlay'].parent / 'source.json').write_text(
                json.dumps({'candidateTree': '0' * 40}),
            )
            with self.assertRaisesRegex(ValueError, 'Base tree is not the reviewed runtime source'):
                prepare.apply_extension(fixture['checkout'], apply=True)
            self.assert_candidate_untouched(fixture)

    def test_changed_source_requires_matching_inventory_not_only_overlay_checksum(self):
        for update_overlay_hash in (False, True):
            with self.subTest(update_overlay_hash=update_overlay_hash), self.inventory_fixture() as fixture:
                source = fixture['overlay'] / 'service.ts'
                source.write_text(source.read_text() + '\n// changed candidate\n')
                if update_overlay_hash:
                    manifest = fixture['overlay'] / 'packaging-source.json'
                    hashes = json.loads(manifest.read_text())
                    hashes['apps/api/src/public-cafeterias/service.ts'] = hashlib.sha256(source.read_bytes()).hexdigest()
                    manifest.write_text(json.dumps(hashes))
                expected = 'Runtime inventory does not match' if update_overlay_hash else 'Overlay checksum mismatch'
                with self.assertRaisesRegex(ValueError, expected):
                    prepare.apply_extension(fixture['checkout'], apply=True)
                self.assert_candidate_untouched(fixture)

    def test_changed_inventory_patch_or_app_binding_fails_before_copying(self):
        for change in ('patch', 'app'):
            with self.subTest(change=change), self.inventory_fixture() as fixture:
                if change == 'patch':
                    path = fixture['overlay'] / 'runtime-inventory.patch'
                    path.write_bytes(path.read_bytes() + b'\nchanged patch\n')
                else:
                    binding = fixture['binding'] | {'appSha256': '0' * 64}
                    (fixture['overlay'] / 'packaging-inventory.json').write_text(json.dumps(binding))
                with self.assertRaisesRegex(ValueError, 'Runtime inventory does not match'):
                    prepare.apply_extension(fixture['checkout'], apply=True)
                self.assert_candidate_untouched(fixture)

if __name__ == '__main__':
    unittest.main()
