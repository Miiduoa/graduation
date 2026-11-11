#!/usr/bin/env python3
"""Apply the reviewed candidate to a pinned disposable source; never deploy or migrate."""
import hashlib
import json
import pathlib
import subprocess
import sys

root = pathlib.Path(__file__).resolve().parents[2]
folder = root / 'deploy/nuni-api/platform-public-agent'
manifest = json.loads((folder / 'production-source-security.json').read_text())
if len(sys.argv) != 2:
    raise SystemExit('usage: prepare-security-source-candidate.py <disposable-checkout>')
source = pathlib.Path(sys.argv[1]).resolve(strict=True)
if not source.is_relative_to(root / 'output'):
    raise SystemExit('source must be inside this worktree output directory')

def git(*args):
    return subprocess.check_output(['git', '-C', str(source), *args], text=True).strip()

if git('write-tree') != manifest['baseTree']:
    raise SystemExit('source index does not match security candidate tree')
if subprocess.run(['git', '-C', str(source), 'diff-files', '--quiet']).returncode:
    raise SystemExit('source has tracked working tree changes')
if git('ls-files', '--others', '--exclude-standard'):
    raise SystemExit('source has untracked files')
patch = folder / manifest['patch']
if hashlib.sha256(patch.read_bytes()).hexdigest() != manifest['sha256']:
    raise SystemExit('patch checksum mismatch')
subprocess.run(['git', '-C', str(source), 'apply', '--check', '--unidiff-zero', str(patch)], check=True)
subprocess.run(['git', '-C', str(source), 'apply', '--index', '--unidiff-zero', str(patch)], check=True)
if git('write-tree') != manifest['resultTree']:
    raise SystemExit('result tree mismatch; preserve the disposable checkout for inspection')
print('Applied review-only disabled candidate to verified isolated source; no migration or deployment.')
