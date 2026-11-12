"""Add the permission migration to the verified lost-found API; never deploy or migrate."""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import subprocess

HERE = Path(__file__).resolve().parent
API = HERE.parent
ROOT = API.parents[1]
MIGRATION = 'apps/api/src/migrations/283_platform_assistant_permissions.sql'
MANIFEST = HERE / 'source.json'


def sha(value):
    return hashlib.sha256(value).hexdigest()


def git(checkout, *arguments):
    return subprocess.check_output(['git', *arguments], cwd=checkout, text=True).strip()


def metadata():
    return {
        'schema': 'campus.platform-assistant-permissions-source/v1',
        'baseManifestSha256': sha((API / 'source.json').read_bytes()),
        'composedManifestSha256': sha((API / 'composed/source.json').read_bytes()),
        'lostFoundManifestSha256': sha((API / 'lost-found/source.json').read_bytes()),
        'adapterSha256': sha(Path(__file__).read_bytes()),
        'sourceFiles': {MIGRATION: {
            'source': str((HERE / '283_platform_assistant_permissions.sql').relative_to(ROOT)),
            'sha256': sha((HERE / '283_platform_assistant_permissions.sql').read_bytes()),
        }},
        'migration': '283_platform_assistant_permissions',
        'preservesLostFoundMigration': '282_platform_lost_found',
    }


def verify_sources():
    pinned = json.loads(MANIFEST.read_text())
    expected = metadata()
    for key in ['inputTree', 'candidateTree']:
        if not isinstance(pinned.get(key), str) or not re.fullmatch('[a-f0-9]{40}', pinned[key]):
            raise ValueError('Permission candidate tree is not pinned')
    if {key: value for key, value in pinned.items() if key not in ['inputTree', 'candidateTree']} != expected:
        raise ValueError('Permission source drift')
    return pinned


def clean_checkout(checkout):
    subprocess.run(['git', 'diff', '--quiet'], cwd=checkout, check=True)
    if git(checkout, 'ls-files', '--others', '--exclude-standard'):
        raise ValueError('Untracked source is not permitted in the packaging checkout')
    if git(checkout, 'ls-files', '--others', '--ignored', '--exclude-standard', '--', 'apps/api/src', 'packages/contracts/src'):
        raise ValueError('Ignored runtime source is not permitted in the packaging checkout')


def verify_checkout(checkout, manifest):
    checkout = Path(checkout).resolve()
    clean_checkout(checkout)
    tree = git(checkout, 'write-tree')
    if tree != manifest['candidateTree']:
        raise ValueError('Permission candidate tree mismatch')
    changed = set(git(checkout, 'diff-tree', '--no-commit-id', '--name-only', '-r', manifest['inputTree'], tree).splitlines())
    if changed != {MIGRATION}:
        raise ValueError('Permission candidate changed unexpected paths')
    entry = git(checkout, 'ls-tree', tree, '--', MIGRATION)
    if not entry.startswith('100644 blob ') or (checkout / MIGRATION).is_symlink():
        raise ValueError('Permission migration must remain a regular non-executable file')
    if sha((checkout / MIGRATION).read_bytes()) != manifest['sourceFiles'][MIGRATION]['sha256']:
        raise ValueError('Packaged permission migration mismatch')
    return tree


def apply_extension(checkout, manifest):
    checkout = Path(checkout).resolve()
    clean_checkout(checkout)
    if git(checkout, 'write-tree') != manifest['inputTree']:
        raise ValueError('Permission migration requires the exact lost-found API input tree')
    destination = checkout / MIGRATION
    if destination.exists() or destination.is_symlink():
        raise ValueError('Permission migration target already exists')
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_bytes((HERE / '283_platform_assistant_permissions.sql').read_bytes())
    subprocess.run(['git', 'add', '--', MIGRATION], cwd=checkout, check=True)
    return verify_checkout(checkout, manifest)


def prepare(output, source=None):
    manifest = verify_sources()
    output = Path(output).resolve()
    if output.exists():
        raise ValueError('Output directory must not exist')
    spec = importlib.util.spec_from_file_location('permission_lost_found_input', API / 'lost-found/prepare.py')
    previous = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(previous)
    # The preceding builder verifies the base, composition, complete lost-found
    # sources and migration 282 before the additive permission migration is copied.
    previous.prepare(output, source)
    return apply_extension(output, manifest)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument('--verify-only', action='store_true')
    mode.add_argument('--output-dir', type=Path)
    parser.add_argument('--source', type=Path, help='Authorized archived repository used read-only as the clone source')
    parser.add_argument('--checkout', type=Path, help='Complete assembled candidate to verify without modifying it')
    args = parser.parse_args(argv)
    if args.source and not args.output_dir:
        parser.error('--source requires --output-dir')
    if args.checkout and not args.verify_only:
        parser.error('--checkout requires --verify-only')
    manifest = verify_sources()
    tree = verify_checkout(args.checkout, manifest) if args.checkout else (
        prepare(args.output_dir, args.source) if args.output_dir else manifest['candidateTree'])
    print(json.dumps({'candidateTree': tree, 'sourceChecksumsVerified': True,
                      'runtimeCheckoutVerified': bool(args.checkout or args.output_dir),
                      'buildsImage': False, 'deploys': False, 'runsMigrations': False}, indent=2))


if __name__ == '__main__':
    main()
