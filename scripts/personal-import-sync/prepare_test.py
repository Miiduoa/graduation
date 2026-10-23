import importlib.util
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('import_sync_prepare', ROOT / 'deploy/nuni-api/personal-import-sync/prepare.py')
prepare = importlib.util.module_from_spec(spec)
spec.loader.exec_module(prepare)


class PrepareTests(unittest.TestCase):
    def test_changed_or_duplicate_anchor_fails_closed(self):
        for source in ['', 'registerPersonalImportSyncRoutes', '  const normalizedMethod = method.toUpperCase();']:
            with self.assertRaises(ValueError):
                prepare.patch_app(source)

    def test_adapter_keeps_existing_platform_routes_and_is_opt_in(self):
        source = '  const normalizedMethod = method.toUpperCase();\n  app.get("/v1/auth/platform/providers", async () => {});'
        result = prepare.patch_app(source)
        self.assertIn('CAMPUS_PERSONAL_IMPORT_SYNC_ENABLED === "true"', result)
        self.assertEqual(result.count('registerPersonalImportSyncRoutes(app, db, platformAccounts)'), 1)
        self.assertIn('  app.get("/v1/auth/platform/providers",', result)
        with self.assertRaises(ValueError):
            prepare.patch_app(result)

    def test_migration_is_in_runtime_source_migrations(self):
        paths = prepare.extension_files()
        self.assertIn('apps/api/src/migrations/279_personal_import_sync.sql', paths)
        self.assertTrue(all(path.is_file() for path in paths.values()))


if __name__ == '__main__':
    unittest.main()
