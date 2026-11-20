import contextlib
import importlib.util
import io
import json
from itertools import combinations
import unittest
import tempfile
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('nuni_api_build', ROOT / 'build.py')
build = importlib.util.module_from_spec(spec)
spec.loader.exec_module(build)


class BuildTests(unittest.TestCase):
    def test_default_still_builds_v20_without_food_patches(self):
        manifest = json.loads((ROOT / 'source.json').read_text())
        with patch.object(build.subprocess, 'run') as run, patch.object(
            build.subprocess, 'check_output', return_value=manifest['candidateTree'] + '\n'
        ):
            build.build(build.parse_args([]))
        commands = [call.args[0] for call in run.call_args_list]
        applied = [Path(command[-1]).name for command in commands if command[:3] == ['git', 'apply', '--index']]
        self.assertEqual(applied, [item['file'] for item in manifest['patches']])
        self.assertEqual(len(applied), 4)
        self.assertIn('nuni-api:campus-platform', commands[-1])

    def test_food_build_uses_six_patches_and_a_distinct_image(self):
        manifest = json.loads((ROOT / 'food-ordering/source.json').read_text())
        with patch.object(build.subprocess, 'run') as run, patch.object(
            build.subprocess, 'check_output', return_value=manifest['candidateTree'] + '\n'
        ):
            build.build(build.parse_args(['--food-ordering-candidate']))
        commands = [call.args[0] for call in run.call_args_list]
        applied = [Path(command[-1]).name for command in commands if command[:3] == ['git', 'apply', '--index']]
        self.assertEqual(applied, [item['file'] for item in manifest['patches']])
        self.assertEqual(len(applied), 6)
        self.assertIn('nuni-api:food-ordering-candidate', commands[-1])
        self.assertIn('org.opencontainers.image.revision=' + manifest['candidateCommit'], commands[-1])

    def test_food_build_refuses_the_four_patch_tree_before_docker(self):
        deployed = json.loads((ROOT / 'source.json').read_text())
        with patch.object(build.subprocess, 'run') as run, patch.object(
            build.subprocess, 'check_output', return_value=deployed['candidateTree'] + '\n'
        ):
            with self.assertRaisesRegex(SystemExit, 'Candidate source tree mismatch'):
                build.build(build.parse_args(['--food-ordering-candidate']))
        self.assertFalse(any(call.args[0][0] == 'docker' for call in run.call_args_list))

    def assert_extension_build(self, option, folder, module_name, image, apply_flag=True):
        manifest = json.loads((ROOT / 'source.json').read_text())
        candidate_tree = 'f' * 40
        extension = SimpleNamespace(apply_extension=Mock(return_value={'candidateTree': candidate_tree}))
        extension_spec = SimpleNamespace(loader=SimpleNamespace(exec_module=Mock()))
        with contextlib.redirect_stdout(io.StringIO()), patch.object(build.subprocess, 'run') as run, patch.object(
            build.subprocess, 'check_output', return_value=manifest['candidateTree'] + '\n'
        ), patch.object(build.importlib.util, 'spec_from_file_location', return_value=extension_spec) as load_spec, patch.object(
            build.importlib.util, 'module_from_spec', return_value=extension
        ):
            build.build(build.parse_args([option]))
        load_spec.assert_called_once_with(module_name, ROOT / folder / 'prepare.py')
        extension_spec.loader.exec_module.assert_called_once_with(extension)
        extension.apply_extension.assert_called_once()
        self.assertEqual(extension.apply_extension.call_args.kwargs, {'apply': True} if apply_flag else {})
        commands = [call.args[0] for call in run.call_args_list]
        applied = [Path(command[-1]).name for command in commands if command[:3] == ['git', 'apply', '--index']]
        self.assertEqual(applied, [item['file'] for item in manifest['patches']])
        self.assertEqual(len(applied), 4)
        self.assertIn(image, commands[-1])
        self.assertIn('org.opencontainers.image.revision=' + candidate_tree, commands[-1])

    def test_course_candidate_preserves_its_extension_and_image(self):
        self.assert_extension_build(
            '--course-access-candidate', 'course-access', 'course_access_prepare',
            'nuni-api:course-access-candidate',
        )

    def test_public_cafeterias_candidate_preserves_its_extension_and_image(self):
        self.assert_extension_build(
            '--public-cafeterias-candidate', 'public-cafeterias', 'public_cafeterias_prepare',
            'nuni-api:public-cafeterias-candidate',
        )

    def test_imports_candidate_preserves_the_composed_extension_contract(self):
        self.assert_extension_build(
            '--imports-candidate', 'composed', 'composed_prepare',
            'nuni-api:imports-candidate', apply_flag=False,
        )

    def test_compatible_rollback_preserves_the_pinned_image_without_cloning(self):
        rollback = json.loads((ROOT / 'composed/rollback-source.json').read_text())
        with patch.object(build.subprocess, 'run') as run, patch.object(
            build.subprocess, 'check_output'
        ) as read:
            build.build(build.parse_args(['--imports-compatible-rollback']))
        run.assert_called_once()
        read.assert_not_called()
        command = run.call_args.args[0]
        self.assertEqual(command[:2], ['docker', 'build'])
        self.assertIn('nuni-api:imports-compatible-rollback', command)
        self.assertIn('org.opencontainers.image.base.digest=' + rollback['baseImage'].split('@')[1], command)

    def test_compatible_rollback_rejects_changed_migrations_before_docker(self):
        with patch.object(build.hashlib, 'sha256', return_value=Mock(hexdigest=Mock(return_value='0' * 64))), patch.object(
            build.subprocess, 'run'
        ) as run:
            with self.assertRaisesRegex(SystemExit, 'Rollback migration checksum mismatch'):
                build.build(build.parse_args(['--imports-compatible-rollback']))
        run.assert_not_called()

    def test_prepare_only_rollback_writes_a_minimal_context_without_commands(self):
        with tempfile.TemporaryDirectory() as scratch, patch.object(build.subprocess, 'run') as run:
            output = Path(scratch) / 'rollback'
            build.build(build.parse_args(['--imports-compatible-rollback', '--prepare-only', '--output-dir', str(output)]))
            manifest = json.loads((output / 'release-source.json').read_text())
            for name in manifest['migrations']:
                self.assertEqual((output / name).read_bytes(), (ROOT.parents[1] / name).read_bytes())
            self.assertEqual((output / 'Dockerfile').read_bytes(), (ROOT / 'composed/Dockerfile.rollback').read_bytes())
            run.assert_not_called()

    def test_prepare_only_candidate_verifies_composition_without_building(self):
        manifest = json.loads((ROOT / 'source.json').read_text())
        extension = SimpleNamespace(apply_extension=Mock(return_value={'candidateTree': 'f' * 40}))
        extension_spec = SimpleNamespace(loader=SimpleNamespace(exec_module=Mock()))
        with tempfile.TemporaryDirectory() as scratch, contextlib.redirect_stdout(io.StringIO()), \
                patch.object(build.subprocess, 'run') as run, \
                patch.object(build.subprocess, 'check_output', return_value=manifest['candidateTree']), \
                patch.object(build.importlib.util, 'spec_from_file_location', return_value=extension_spec), \
                patch.object(build.importlib.util, 'module_from_spec', return_value=extension):
            output = Path(scratch) / 'candidate'
            build.build(build.parse_args(['--imports-candidate', '--prepare-only', '--output-dir', str(output)]))
            extension.apply_extension.assert_called_once_with(output)
            self.assertFalse(any(call.args[0][0] in ['docker', 'fly'] for call in run.call_args_list))

    def test_prepare_only_rejects_existing_output_before_commands(self):
        with tempfile.TemporaryDirectory() as scratch, patch.object(build.subprocess, 'run') as run:
            with self.assertRaisesRegex(SystemExit, 'must not exist'):
                build.build(build.parse_args(['--imports-candidate', '--prepare-only', '--output-dir', scratch]))
            run.assert_not_called()

    def test_prepare_options_must_be_paired_and_explicitly_scoped(self):
        for flags in [['--prepare-only'], ['--output-dir', '/unused'],
                      ['--security-candidate', '--prepare-only', '--output-dir', '/unused']]:
            with self.subTest(flags=flags), contextlib.redirect_stderr(io.StringIO()):
                with self.assertRaises(SystemExit):
                    build.parse_args(flags)

    def test_all_candidate_combinations_fail_before_git_or_docker(self):
        flags = ['--course-access-candidate', '--public-cafeterias-candidate', '--food-ordering-candidate',
                 '--imports-candidate', '--imports-compatible-rollback']
        for selected in [*combinations(flags, 2), tuple(flags)]:
            with self.subTest(selected=selected), patch.object(build.subprocess, 'run') as run, patch.object(
                build.subprocess, 'check_output'
            ) as read, contextlib.redirect_stderr(io.StringIO()):
                with self.assertRaises(SystemExit) as raised:
                    build.build(build.parse_args(list(selected)))
                self.assertEqual(raised.exception.code, 2)
                run.assert_not_called()
                read.assert_not_called()


if __name__ == '__main__':
    unittest.main()
