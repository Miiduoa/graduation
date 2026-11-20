"""Reconstruct the three overlays on the reviewed API tree; never deploy or migrate.

Refresh is an explicit maintainer operation in a disposable source checkout with
frozen dependencies. Normal builds consume only the recorded hashes and tree.
"""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess

HERE = Path(__file__).resolve().parent
API = HERE.parent
ROOT = API.parents[1]
ORDER = ['public-cafeterias', 'course-access', 'personal-import-sync']
AFTER_OVERLAY_PATCHES = ['materials-pagination/0001-stable-material-pages.patch',
                         'assignment-files/0001-authoritative-withdrawal-reads.patch']


def sha(value):
    return hashlib.sha256(value).hexdigest()


def git(checkout, *args):
    return subprocess.check_output(['git', *args], cwd=checkout, text=True).strip()


def overlay(name):
    spec = importlib.util.spec_from_file_location(name.replace('-', '_'), API / name / 'prepare.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def plan(checkout):
    checkout = Path(checkout).resolve()
    base = json.loads((API / 'source.json').read_text())
    if git(checkout, 'write-tree') != base['candidateTree']:
        raise ValueError('Composed API requires the exact patched base tree')
    subprocess.run(['git', 'diff', '--quiet'], cwd=checkout, check=True)
    for args in [('ls-files', '--others', '--exclude-standard'),
                 ('ls-files', '--others', '--ignored', '--exclude-standard', '--', 'apps/api/src', 'packages/contracts/src')]:
        if git(checkout, *args):
            raise ValueError('Untracked runtime source is not permitted in the packaging checkout')
    sources = {}
    app = (checkout / 'apps/api/src/app.ts').read_text()
    adapters = {}
    for name in ORDER:
        module = overlay(name)
        adapters[name] = sha((API / name / 'prepare.py').read_bytes())
        app = module.patch_app(app)
        for target, source in module.extension_files().items():
            if target in sources or (checkout / target).exists():
                raise ValueError('Overlay target collision: ' + target)
            sources[target] = source
    return sources, app, {
        'schema': 'campus.nuni-composed-source/v1',
        'baseTree': base['candidateTree'],
        'overlayOrder': ORDER,
        'adapters': adapters,
        'sourceFiles': {target: {'source': str(source.relative_to(ROOT)), 'sha256': sha(source.read_bytes())}
                        for target, source in sorted(sources.items())},
        'appSha256': sha(app.encode()),
        'afterOverlayPatches': [
            {'source': str((API / name).relative_to(ROOT)), 'sha256': sha((API / name).read_bytes())}
            for name in AFTER_OVERLAY_PATCHES
        ],
    }


def apply_extension(checkout, refresh=False):
    checkout = Path(checkout).resolve()
    sources, app, expected = plan(checkout)
    manifest_path = HERE / 'source.json'
    pinned = json.loads(manifest_path.read_text()) if not refresh else None
    if pinned:
        for key, value in expected.items():
            if pinned.get(key) != value:
                raise ValueError('Composed source drift: ' + key)
    for target, source in sources.items():
        destination = checkout / target
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(source.read_bytes())
    (checkout / 'apps/api/src/app.ts').write_text(app)
    subprocess.run(['git', 'add', 'apps/api/src/app.ts', *sources.keys()], cwd=checkout, check=True)
    expected['overlayTree'] = git(checkout, 'write-tree')
    if pinned and expected['overlayTree'] != pinned['overlayTree']:
        raise ValueError('Composed overlay tree mismatch')
    # Extend the complete composed API, preserving every existing overlay and migration.
    for name in AFTER_OVERLAY_PATCHES:
        subprocess.run(['git', 'apply', '--index', str(API / name)], cwd=checkout, check=True)
    expected['patchedAppSha256'] = sha((checkout / 'apps/api/src/app.ts').read_bytes())
    expected['runtimeInventoryScope'] = 'Pinned base analysis only; not a composed API grant receipt'
    expected['candidateTree'] = git(checkout, 'write-tree')
    if refresh:
        manifest_path.write_text(json.dumps(expected, ensure_ascii=False, indent=2) + '\n')
        pinned = expected
    if expected['patchedAppSha256'] != pinned['patchedAppSha256']:
        raise ValueError('Composed patched app mismatch')
    if git(checkout, 'write-tree') != pinned['candidateTree']:
        raise ValueError('Composed final tree mismatch')
    return {'candidateTree': pinned['candidateTree'], 'baseTree': pinned['baseTree'],
            'overlays': ORDER, 'migrations': ['278_course_access_review', '279_personal_import_sync', '281_assignment_submission_withdrawals'],
            'deploys': False, 'runsMigrations': False, 'enablesService': False}



if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--checkout', required=True)
    parser.add_argument('--refresh-manifest', action='store_true')
    args = parser.parse_args()
    print(json.dumps(apply_extension(args.checkout, args.refresh_manifest), indent=2))
