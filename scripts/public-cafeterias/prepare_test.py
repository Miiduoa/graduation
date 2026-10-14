import hashlib
import importlib.util
import json
from pathlib import Path
import unittest

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

if __name__ == '__main__':
    unittest.main()
