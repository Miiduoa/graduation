#!/usr/bin/env python3
"""Build only a local rollback-manifest candidate; never apply a migration."""
import hashlib
import json
import pathlib
import shutil
import subprocess
import sys

root = pathlib.Path(__file__).resolve().parents[2]
if len(sys.argv) != 2:
    raise SystemExit('usage: prepare-pinned-rollback.py <disposable-checkout>')
source = pathlib.Path(sys.argv[1]).resolve(strict=True)
if not source.is_relative_to(root / 'output'):
    raise SystemExit('source must be inside this worktree output directory')
expected = 'b0a10ac814cd03fbfb45132566035acce8339f17'
tree = subprocess.check_output(['git', '-C', str(source), 'write-tree'], text=True).strip()
if tree != expected or subprocess.run(['git', '-C', str(source), 'diff-files', '--quiet']).returncode:
    raise SystemExit('source tree differs from pinned b0a10ac')
target = source / 'apps/api/src/migrations/999_public_agent_isolated_test_only.sql'
manifest_path = source / 'public-agent-rollback-test-manifest.json'
if target.exists() or manifest_path.exists():
    raise SystemExit('test-only migration or manifest already exists')
shutil.copyfile(root / 'deploy/nuni-api/platform-public-agent/schema.candidate.sql', target)
manifest_path.write_text(json.dumps({
    'kind': 'local-rollback-test-only', 'baseTree': expected,
    'migration': target.name, 'checksum': hashlib.sha256(target.read_bytes()).hexdigest(),
}, indent=2) + '\n')
print('Prepared test-only rollback manifest; no migration or deployment was performed.')
