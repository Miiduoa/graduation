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
                'sha256': 'b1b7b72c863236b327997921380c4d99ca6c48d8990da43a29714fca110a7648',
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

    def test_281_patch_and_rollback_share_runner_owned_transaction_sql(self):
        source = 'deploy/nuni-api/assignment-files/281_assignment_submission_withdrawals.sql'
        sql = (ROOT / source).read_text()
        patch_text = (prepare.API / 'assignment-files/0001-authoritative-withdrawal-reads.patch').read_text()
        section = patch_text.split('+++ b/apps/api/src/migrations/281_assignment_submission_withdrawals.sql\n', 1)[1]
        patch_sql = ''.join(line[1:] + '\n' for line in section.splitlines() if line.startswith('+'))
        self.assertEqual(sql, patch_sql)
        for line in sql.splitlines():
            self.assertNotIn(line.strip().upper(), ['BEGIN;', 'COMMIT;', 'ROLLBACK;'])
        rollback = json.loads((prepare.HERE / 'rollback-source.json').read_text())
        self.assertEqual(hashlib.sha256(sql.encode()).hexdigest(), rollback['migrations'][source])
        # Existing registered SQL is immutable across this release.
        self.assertEqual(rollback['migrations']['deploy/nuni-api/course-access/278_course_access_review.sql'],
                         'c382b69b63e10dff4cbe1a8f1b34b0980ed9a85b2d0aea402cb25bc81b91e103')
        self.assertEqual(rollback['migrations']['deploy/nuni-api/personal-import-sync/279_personal_import_sync.sql'],
                         '0d825aa890c240ae4a0f496116d4507b3e014878402642bd54bed2046a44118c')

    def test_rollback_preserves_immutable_production_image_and_only_adds_sql(self):
        manifest = json.loads((prepare.HERE / 'rollback-source.json').read_text())
        text = (prepare.HERE / 'Dockerfile.rollback').read_text()
        self.assertEqual(manifest['baseImage'], 'registry.fly.io/nuni-api@sha256:be815455fbb2ccce844b69f004e416e44465e3421f9da654d0cd5db8379c3dc2')
        self.assertEqual(manifest['baseRevision'], 'b0a10ac814cd03fbfb45132566035acce8339f17')
        self.assertIn('FROM ' + manifest['baseImage'] + '\n', text)
        self.assertNotIn('RUN ', text)
        self.assertEqual(len(manifest['migrations']), 3)
        for source, checksum in manifest['migrations'].items():
            self.assertEqual(hashlib.sha256((ROOT / source).read_bytes()).hexdigest(), checksum)
            self.assertIn(f'COPY {source} /app/apps/api/dist/migrations/{Path(source).name}', text)


if __name__ == '__main__':
    unittest.main()
