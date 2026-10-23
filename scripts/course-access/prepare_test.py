import importlib.util
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('course_prepare', ROOT / 'deploy/nuni-api/course-access/prepare.py')
prepare = importlib.util.module_from_spec(spec)
spec.loader.exec_module(prepare)

class PrepareTests(unittest.TestCase):
    def test_changed_anchor_fails_closed(self):
        for source in ['', 'registerCourseAccessRoutes', '  const normalizedMethod = method.toUpperCase();']:
            with self.assertRaises(ValueError):
                prepare.patch_app(source)

    def test_exact_platform_route_adapter_is_opt_in(self):
        source = '  const normalizedMethod = method.toUpperCase();\n  app.get("/v1/auth/platform/providers", async () => {});'
        result = prepare.patch_app(source)
        self.assertIn('CAMPUS_COURSE_ACCESS_ENABLED === "true"', result)
        self.assertEqual(result.count('registerCourseAccessRoutes(app, db, platformAccounts)'), 1)
        with self.assertRaises(ValueError):
            prepare.patch_app(result)

    def test_candidate_copies_only_reviewed_sources(self):
        paths = prepare.extension_files()
        self.assertEqual(len(paths), 4)
        self.assertIn('apps/api/src/migrations/278_course_access_review.sql', paths)
        self.assertNotIn('apps/api/migrations/278_course_access_review.sql', paths)
        self.assertTrue(all(path.is_file() for path in paths.values()))
        self.assertNotIn('source.json', paths)

if __name__ == '__main__':
    unittest.main()
