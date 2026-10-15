import contextlib
import importlib.util
import io
import json
import unittest
from pathlib import Path
from unittest.mock import patch

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

    def test_course_and_food_candidates_cannot_be_combined(self):
        with contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit) as raised:
            build.parse_args(['--course-access-candidate', '--food-ordering-candidate'])
        self.assertEqual(raised.exception.code, 2)


if __name__ == '__main__':
    unittest.main()
