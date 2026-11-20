"""在隔離目錄測試啟動腳本；替身不安裝套件、不啟動伺服器或下載模型。"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FAKE_PYTHON = r'''
import json, os, shutil, sys
from pathlib import Path
args = sys.argv[1:]
with open(os.environ['BOOTSTRAP_LOG'], 'a', encoding='utf-8') as log:
    log.write(json.dumps(args) + '\n')
if args == ['-']:
    version = os.environ.get('BOOTSTRAP_VERSION', '3.12')
    major, minor = map(int, version.split('.'))
    sys.version_info = (major, minor, 0, 'final', 0)
    sys.version = version + '.0 (test interpreter)'
    exec(compile(sys.stdin.read(), '<version check>', 'exec'))
elif args == ['-m', 'venv', '.venv']:
    target = Path('.venv/bin')
    target.mkdir(parents=True)
    shutil.copy2(__file__, target / 'python')
    (target / 'activate').write_text('export PATH="' + str(target.resolve()) + ':$PATH"\n')
elif args[:2] == ['-m', 'pip']:
    if os.environ.get('BOOTSTRAP_PIP_FAIL') == '1':
        print('SIMULATED_INSTALL_FAILURE', file=sys.stderr)
        sys.exit(7)
else:
    print('TEST_COMMAND ' + json.dumps(args))
'''


class LocalBootstrapTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='campus-bootstrap-')
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        shutil.copy2(ROOT / 'run.sh', self.root / 'run.sh')
        (self.root / 'requirements.txt').write_text('# no real installation\n')
        self.fake = self.root / 'python with spaces'
        self.fake.write_text('#!' + sys.executable + '\n' + FAKE_PYTHON)
        self.fake.chmod(0o755)
        self.log = self.root / 'calls.jsonl'
        self.env = {**os.environ, 'PYTHON_BIN': str(self.fake), 'LLM_PROVIDER': 'test-offline',
                    'BOOTSTRAP_LOG': str(self.log), 'BOOTSTRAP_VERSION': '3.12',
                    'BOOTSTRAP_PIP_FAIL': '0'}

    def run_script(self, *args):
        return subprocess.run(['bash', str(self.root / 'run.sh'), *args],
                              cwd=self.root, env=self.env, capture_output=True,
                              text=True, timeout=10)

    def calls(self):
        return [json.loads(line) for line in self.log.read_text().splitlines()] if self.log.exists() else []

    def existing_environment(self):
        target = self.root / '.venv/bin'
        target.mkdir(parents=True)
        shutil.copy2(self.fake, target / 'python')
        (target / 'activate').write_text('export PATH="' + str(target) + ':$PATH"\n')
        marker = self.root / '.venv/preserve-me'
        marker.write_text('existing environment')
        return marker

    def test_shell_syntax(self):
        result = subprocess.run(['bash', '-n', str(self.root / 'run.sh')], capture_output=True)
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_old_python_does_not_create_environment(self):
        self.env['BOOTSTRAP_VERSION'] = '3.11'
        result = self.run_script()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('Python 3.12', result.stderr)
        self.assertEqual(self.calls(), [['-']])
        self.assertFalse((self.root / '.venv').exists())

    def test_current_python_uses_selected_interpreter_even_with_spaces(self):
        result = self.run_script()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.calls(), [['-'], ['-m', 'venv', '.venv'],
            ['-m', 'pip', 'install', '-q', '-r', 'requirements.txt'], ['server.py']])

    def test_existing_old_environment_is_preserved_not_rebuilt(self):
        marker = self.existing_environment()
        self.env['BOOTSTRAP_VERSION'] = '3.11'
        result = self.run_script('--train')
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(self.calls(), [['-']])
        self.assertEqual(marker.read_text(), 'existing environment')

    def test_existing_current_environment_is_reused(self):
        marker = self.existing_environment()
        result = self.run_script('--train', '--iters', '2')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertNotIn(['-m', 'venv', '.venv'], self.calls())
        self.assertEqual(self.calls()[-1], ['-m', 'training.finetune', '--iters', '2'])
        self.assertTrue(marker.exists())

    def test_invalid_existing_environment_is_not_overwritten(self):
        target = self.root / '.venv'
        target.write_text('do not replace this')
        result = self.run_script()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('不完整', result.stderr)
        self.assertEqual(target.read_text(), 'do not replace this')
        self.assertEqual(self.calls(), [])

    def test_missing_selected_interpreter_fails_before_creation(self):
        self.env['PYTHON_BIN'] = str(self.root / 'missing-python')
        result = self.run_script()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('找不到 Python', result.stderr)
        self.assertFalse((self.root / '.venv').exists())
        self.assertEqual(self.calls(), [])

    def test_pip_failure_remains_visible_and_does_not_start_training(self):
        marker = self.existing_environment()
        self.env['BOOTSTRAP_PIP_FAIL'] = '1'
        result = self.run_script('--train')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('SIMULATED_INSTALL_FAILURE', result.stderr)
        self.assertIn('未啟動服務或訓練', result.stderr)
        self.assertEqual(self.calls(), [['-'], ['-m', 'pip', 'install', '-q', '-r', 'requirements.txt']])
        self.assertTrue(marker.exists())


if __name__ == '__main__':
    unittest.main()
