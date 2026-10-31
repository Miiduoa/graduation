import importlib.util
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from copy import deepcopy
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('composed_prepare', ROOT / 'deploy/nuni-api/composed/prepare.py')
prepare = importlib.util.module_from_spec(spec)
spec.loader.exec_module(prepare)


class ComposedPrepareTests(unittest.TestCase):
    def test_unreviewed_base_is_rejected_before_writes(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(prepare, 'git', return_value='wrong-tree'):
            with self.assertRaisesRegex(ValueError, 'exact patched base'):
                prepare.plan(Path(directory))
            self.assertEqual(list(Path(directory).iterdir()), [])

    def test_untracked_or_ignored_runtime_is_rejected(self):
        base = json.loads((prepare.API / 'source.json').read_text())['candidateTree']
        for answers in [[base, 'unexpected.sql'], [base, '', 'ignored.sql']]:
            with tempfile.TemporaryDirectory() as directory, patch.object(prepare, 'git', side_effect=answers), patch.object(prepare.subprocess, 'run'):
                with self.assertRaisesRegex(ValueError, 'Untracked runtime source'):
                    prepare.plan(Path(directory))

    def test_pinned_composition_covers_all_adapters_and_multi_school_validation(self):
        manifest = json.loads((prepare.HERE / 'source.json').read_text())
        self.assertEqual(manifest['overlayOrder'], ['public-cafeterias', 'course-access', 'personal-import-sync'])
        targets = manifest['sourceFiles']
        self.assertIn('apps/api/src/personal-import-sync/timetable/schoolPeriods.ts', targets)
        for target, item in targets.items():
            self.assertEqual(hashlib.sha256((ROOT / item['source']).read_bytes()).hexdigest(), item['sha256'], target)
        for name, checksum in manifest['adapters'].items():
            self.assertEqual(hashlib.sha256((prepare.API / name / 'prepare.py').read_bytes()).hexdigest(), checksum)
        self.assertEqual(manifest['afterOverlayPatches'], [
            {
                'source': 'deploy/nuni-api/materials-pagination/0001-stable-material-pages.patch',
                'sha256': '03bd7b3497d39758d52a04fd33603c15abd4cfe9bc606499a7246c70cc0c2a0e',
            },
            {
                'source': 'deploy/nuni-api/assignment-files/0001-authoritative-withdrawal-reads.patch',
                'sha256': '006e9112ea2ef17b6bc22f083e14b413a9c0ecbd9c5749f40228c5f0f6ad48f6',
            },
        ])
        self.assertEqual(
            [str((prepare.API / name).relative_to(ROOT)) for name in prepare.AFTER_OVERLAY_PATCHES],
            [item['source'] for item in manifest['afterOverlayPatches']],
        )
        for item in manifest['afterOverlayPatches']:
            self.assertEqual(hashlib.sha256((ROOT / item['source']).read_bytes()).hexdigest(), item['sha256'])
        self.assertNotEqual(manifest['patchedAppSha256'], manifest['appSha256'])
        self.assertNotEqual(manifest['overlayTree'], manifest['candidateTree'])

    def test_patch_drift_is_rejected_before_any_checkout_write(self):
        expected = deepcopy(json.loads((prepare.HERE / 'source.json').read_text()))
        expected['afterOverlayPatches'][0]['sha256'] = '0' * 64
        with tempfile.TemporaryDirectory() as directory, \
                patch.object(prepare, 'plan', return_value=({}, 'must-not-write', expected)), \
                patch.object(prepare.subprocess, 'run') as command:
            with self.assertRaisesRegex(ValueError, 'Composed source drift: afterOverlayPatches'):
                prepare.apply_extension(Path(directory))
            self.assertEqual(list(Path(directory).iterdir()), [])
            command.assert_not_called()

    def test_rollback_preserves_immutable_production_image_and_only_adds_sql(self):
        manifest = json.loads((prepare.HERE / 'rollback-source.json').read_text())
        text = (prepare.HERE / 'Dockerfile.rollback').read_text()
        self.assertIn('@sha256:', manifest['baseImage'])
        self.assertIn('FROM ' + manifest['baseImage'] + '\n', text)
        self.assertNotIn('RUN ', text)
        self.assertEqual(len(manifest['migrations']), 2)
        for source, checksum in manifest['migrations'].items():
            self.assertEqual(hashlib.sha256((ROOT / source).read_bytes()).hexdigest(), checksum)
            self.assertIn(f'COPY {source} /app/apps/api/dist/migrations/{Path(source).name}', text)


if __name__ == '__main__':
    unittest.main()
