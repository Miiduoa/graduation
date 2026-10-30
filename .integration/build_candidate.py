"""Reproduce a reviewed tree on a NEW candidate branch only. Never move main or a PR head.

The source SHA leases, every resolution's before/after blob, the decoded patch hash,
and the complete target tree must match before publication. The feature PR is updated
separately through its normal connector after this candidate has been inspected.
"""
import gzip
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile

ROOT = Path.cwd()
DATA = ROOT / '.integration/pr318'
spec = json.loads((DATA / 'spec.json').read_text())
for key in ['feature_sha', 'incoming_sha', 'main_sha', 'merge_base', 'expected_tree']:
    if not re.fullmatch(r'[0-9a-f]{40}', spec[key]):
        raise SystemExit('Invalid fixed Git object')
if spec['feature_ref'] != 'fix/school-credit-overview-20261028' or spec['incoming_ref'] != 'fix/pause-ecampus-fetch-20261030':
    raise SystemExit('Unexpected source branch')
if spec['candidate_branch'] != 'integration/credit-overview-paused-20261030':
    raise SystemExit('Publication is restricted to the one new candidate branch')

def git(*args, data=None, cwd=ROOT):
    return subprocess.check_output(['git', *args], input=data, cwd=cwd)

def remote_ref(name):
    rows = git('ls-remote', '--heads', 'origin', 'refs/heads/' + name).decode().splitlines()
    return rows[0].split()[0] if rows else None

def assert_leases():
    for ref, sha in [('main', spec['main_sha']), (spec['feature_ref'], spec['feature_sha']), (spec['incoming_ref'], spec['incoming_sha'])]:
        if remote_ref(ref) != sha:
            raise SystemExit('Source changed; refuse stale integration: ' + ref)

assert_leases()
if remote_ref(spec['candidate_branch']) is not None:
    raise SystemExit('Candidate branch already exists; it will not be overwritten')
if git('merge-base', spec['feature_sha'], spec['incoming_sha']).decode().strip() != spec['merge_base']:
    raise SystemExit('Unexpected merge base')

def entries(sha):
    out = {}
    for row in git('ls-tree', '-r', '-z', sha).split(b'\0'):
        if not row:
            continue
        header, raw_path = row.split(b'\t', 1)
        mode, kind, oid = header.decode().split()
        path = raw_path.decode()
        if path.startswith('/') or '..' in Path(path).parts:
            raise SystemExit('Unsafe tracked path')
        out[path] = {'path': path, 'mode': mode, 'type': kind, 'sha': oid}
    return out

def read_blob(entry):
    return git('cat-file', 'blob', entry['sha']) if entry else b''

def put_blob(path, data, mode='100644'):
    sha = git('hash-object', '-w', '--stdin', data=data).decode().strip()
    return {'path': path, 'mode': mode, 'type': 'blob', 'sha': sha}

base = entries(spec['merge_base'])
left = entries(spec['feature_sha'])
right = entries(spec['incoming_sha'])
result = {}
conflicts = set()
for path in sorted(set(base) | set(left) | set(right)):
    b, l, r = base.get(path), left.get(path), right.get(path)
    if l == r:
        chosen = l
    elif l == b:
        chosen = r
    elif r == b:
        chosen = l
    elif b and l and r and all(e['type'] == 'blob' and e['mode'] != '120000' for e in [b, l, r]):
        with tempfile.TemporaryDirectory() as temp:
            folder = Path(temp)
            for name, entry in [('base', b), ('left', l), ('right', r)]:
                (folder / name).write_bytes(read_blob(entry))
            merged = subprocess.run(['git', 'merge-file', '-p', '--diff3', '-L', 'FEATURE', '-L', 'BASE', '-L', 'INCOMING', str(folder / 'left'), str(folder / 'base'), str(folder / 'right')], capture_output=True)
            if merged.returncode < 0 or merged.returncode > 127:
                raise SystemExit('Git file merge failed: ' + path)
            if merged.returncode:
                conflicts.add(path)
            chosen = put_blob(path, merged.stdout, l['mode'])
    else:
        raise SystemExit('Unreviewed add/delete/mode conflict: ' + path)
    if chosen:
        result[path] = chosen

if not conflicts.issubset(spec['resolutions']):
    raise SystemExit('There are conflicts without an exact reviewed resolution')
compressed = b''.join((DATA / ('patch.' + str(i) + '.gzpart')).read_bytes() for i in range(4))
patch = gzip.decompress(compressed)
if hashlib.sha256(patch).hexdigest() != spec['patch_sha256']:
    raise SystemExit('Resolution patch hash mismatch')
with tempfile.TemporaryDirectory() as temp:
    folder = Path(temp)
    subprocess.run(['git', 'init', '-q', str(folder)], check=True)
    for path, expected in spec['resolutions'].items():
        current = result.get(path)
        if (current['sha'] if current else None) != expected['before']:
            raise SystemExit('Resolution input differs: ' + path)
        if current:
            target = folder / path
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(read_blob(current))
    patch_path = folder / 'reviewed.patch'
    patch_path.write_bytes(patch)
    subprocess.run(['git', 'apply', '--unidiff-zero', '--check', str(patch_path)], cwd=folder, check=True)
    subprocess.run(['git', 'apply', '--unidiff-zero', str(patch_path)], cwd=folder, check=True)
    for path, expected in spec['resolutions'].items():
        target = folder / path
        if expected['after'] is None:
            if target.exists():
                raise SystemExit('Expected deletion did not occur')
            result.pop(path, None)
            continue
        updated = put_blob(path, target.read_bytes(), expected['mode'])
        if updated['sha'] != expected['after']:
            raise SystemExit('Resolution output differs: ' + path)
        result[path] = updated

policy = 'packages/shared/src/puEcampusDataPolicy.ts'
if result[policy] != right[policy]:
    raise SystemExit('Default pause policy changed')
for path in set(result) - set(right):
    if path.startswith('.integration/') or path == '.github/workflows/verified-integration-candidate.yml':
        raise SystemExit('Build scaffolding must not enter the product tree')

nested = {}
for path, entry in result.items():
    node = nested
    parts = path.split('/')
    for name in parts[:-1]:
        node = node.setdefault(name, {})
    node[parts[-1]] = entry

def write_tree(node):
    rows = []
    for name, item in node.items():
        if 'sha' in item and 'type' in item:
            mode, kind, sha = item['mode'], item['type'], item['sha']
        else:
            mode, kind, sha = '040000', 'tree', write_tree(item)
        rows.append((mode + ' ' + kind + ' ' + sha + '\t' + name).encode() + b'\0')
    return git('mktree', '-z', data=b''.join(rows)).decode().strip()

tree = write_tree(nested)
if tree != spec['expected_tree']:
    raise SystemExit('Complete candidate tree differs from the locally verified tree')
message = ('Merge main and default E-campus pause into school credit overview\n\n'
           'Resolve source and packaging conflicts; preserve pause codes, stop both clients before token/network access, retain prior totals and disable retry while paused.\n'
           'Candidate only: no main merge, deployment, rule change or school request.\n')
commit = git('-c', 'user.name=github-actions[bot]', '-c', 'user.email=41898282+github-actions[bot]@users.noreply.github.com', 'commit-tree', tree, '-p', spec['feature_sha'], '-p', spec['incoming_sha'], data=message.encode()).decode().strip()
subprocess.run(['git', 'diff-tree', '--check', spec['feature_sha'], commit], check=True)
with tempfile.TemporaryDirectory() as temp:
    checkout = str(Path(temp) / 'candidate')
    subprocess.run(['git', 'worktree', 'add', '--detach', checkout, commit], check=True)
    try:
        subprocess.run(['node', '--check', 'backend/functions/puScraper.js'], cwd=checkout, check=True)
        subprocess.run(['node', '--test', 'deploy/web/release-safety.test.mjs'], cwd=checkout, check=True)
    finally:
        subprocess.run(['git', 'worktree', 'remove', checkout], check=True)
assert_leases()
if remote_ref(spec['candidate_branch']) is not None:
    raise SystemExit('Candidate ref appeared during verification; refuse overwrite')
subprocess.run(['git', 'push', '--porcelain', 'origin', commit + ':refs/heads/' + spec['candidate_branch']], check=True)
receipt = {'status': 'candidate_only', 'commit': commit, 'tree': tree, 'parents': [spec['feature_sha'], spec['incoming_sha']], 'branch': spec['candidate_branch'], 'main_unchanged': remote_ref('main') == spec['main_sha'], 'full_ci': 'not_run_by_this_job', 'school_requests': 'none'}
(ROOT / 'candidate-receipt.json').write_text(json.dumps(receipt, indent=2) + '\n')
print(json.dumps(receipt, indent=2))
