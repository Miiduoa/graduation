"""Overlay the TronClass closure migration on the live production API tree; never deploy or migrate."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess

HERE = Path(__file__).resolve().parent
API = HERE.parent
ROOT = API.parents[1]
SQL_FILE = '284_tronclass_account_closure_outbox.sql'
FORBIDDEN_ID = '001_tronclass_account_closure_outbox'
MIGRATION = f'apps/api/src/migrations/{SQL_FILE}'
PREVIOUS_MIGRATION = 'apps/api/src/migrations/283_platform_assistant_permissions.sql'
MANIFEST = HERE / 'source.json'
INPUT_TREE_PREFIX = '2e7cc189'
STALE_283_CANDIDATE_TREE = '2d7a325c5d4cd185d0ba32c6603a1e703684199b'
SQL_SHA256 = '915ada63acd28f1ddd78d81395d27dffed3ce193064a12b4718afc1a7af102d7'


def sha(value):
    return hashlib.sha256(value).hexdigest()


def git(checkout, *arguments):
    return subprocess.check_output(['git', *arguments], cwd=checkout, text=True).strip()


def metadata():
    return {
        'schema': 'campus.tronclass-account-closure-source/v1',
        'baseManifestSha256': sha((API / 'source.json').read_bytes()),
        'composedManifestSha256': sha((API / 'composed/source.json').read_bytes()),
        'lostFoundManifestSha256': sha((API / 'lost-found/source.json').read_bytes()),
        'assistantPermissionsManifestSha256': sha((API / 'assistant-permissions/source.json').read_bytes()),
        'adapterSha256': sha(Path(__file__).read_bytes()),
        'sourceFiles': {MIGRATION: {
            'source': str((HERE / SQL_FILE).relative_to(ROOT)),
            'sha256': sha((HERE / SQL_FILE).read_bytes()),
        }},
        'migration': '284_tronclass_account_closure_outbox',
        'preservesAssistantPermissionsMigration': '283_platform_assistant_permissions',
        'forbiddenMigrationId': FORBIDDEN_ID,
        'inputTreePrefix': INPUT_TREE_PREFIX,
        'rejectedInputTree': STALE_283_CANDIDATE_TREE,
        'candidateTreePolicy': (
            'Derived only after the authorized production API checkout matches '
            'inputTreePrefix 2e7cc189, source checksums and a single-path 284 overlay '
            'are verified; the stale 283 candidate tree 2d7a325c is rejected. '
            'No runtime build receipt is implied.'
        ),
    }


def assert_canonical_sql():
    if sha((HERE / SQL_FILE).read_bytes()) != SQL_SHA256:
        raise ValueError('284 SQL is not the reviewed candidate bytes')
    leftover = HERE / f'{FORBIDDEN_ID}.sql'
    if leftover.exists() or leftover.is_symlink():
        raise ValueError('001 migration id must not remain in the packaging folder')


def verify_sources():
    assert_canonical_sql()
    pinned = json.loads(MANIFEST.read_text())
    expected = metadata()
    if pinned != expected:
        raise ValueError('Closure source drift')
    if pinned['sourceFiles'][MIGRATION]['sha256'] != SQL_SHA256:
        raise ValueError('284 SQL checksum mismatch')
    return pinned


def clean_checkout(checkout):
    subprocess.run(['git', 'diff', '--quiet'], cwd=checkout, check=True)
    if git(checkout, 'ls-files', '--others', '--exclude-standard'):
        raise ValueError('Untracked source is not permitted in the packaging checkout')
    if git(checkout, 'ls-files', '--others', '--ignored', '--exclude-standard', '--', 'apps/api/src', 'packages/contracts/src'):
        raise ValueError('Ignored runtime source is not permitted in the packaging checkout')


def assert_no_forbidden_migration_id(checkout):
    migrations = Path(checkout) / 'apps/api/src/migrations'
    if not migrations.exists():
        return
    leftover = [path.name for path in migrations.iterdir() if path.name.startswith('001_') or path.stem == FORBIDDEN_ID]
    if leftover:
        raise ValueError('001 migration id must not reach dist/migrations')


def assert_production_input(tree):
    if not re.fullmatch('[a-f0-9]{40}', tree):
        raise ValueError('API input tree is not a complete Git tree')
    if tree == STALE_283_CANDIDATE_TREE or tree.startswith('2d7a325c'):
        raise ValueError('Closure migration must not overlay the stale 283 candidate tree 2d7a325c')
    if not tree.startswith(INPUT_TREE_PREFIX):
        raise ValueError('Closure migration requires the current production API tree (2e7cc189…)')


def verify_checkout(checkout, manifest):
    checkout = Path(checkout).resolve()
    clean_checkout(checkout)
    assert_no_forbidden_migration_id(checkout)
    tree = git(checkout, 'write-tree')
    if tree != manifest['candidateTree']:
        raise ValueError('Closure candidate tree mismatch')
    changed = set(git(checkout, 'diff-tree', '--no-commit-id', '--name-only', '-r', manifest['inputTree'], tree).splitlines())
    if changed != {MIGRATION}:
        raise ValueError('Closure candidate changed unexpected paths')
    entry = git(checkout, 'ls-tree', tree, '--', MIGRATION)
    if not entry.startswith('100644 blob ') or (checkout / MIGRATION).is_symlink():
        raise ValueError('Closure migration must remain a regular non-executable file')
    if sha((checkout / MIGRATION).read_bytes()) != manifest['sourceFiles'][MIGRATION]['sha256']:
        raise ValueError('Packaged closure migration mismatch')
    if not (checkout / PREVIOUS_MIGRATION).exists():
        raise ValueError('Closure migration requires 283_platform_assistant_permissions to remain')
    return tree


def apply_extension(checkout, manifest):
    checkout = Path(checkout).resolve()
    clean_checkout(checkout)
    assert_no_forbidden_migration_id(checkout)
    if git(checkout, 'write-tree') != manifest['inputTree']:
        raise ValueError('Closure migration requires the exact production API input tree')
    if not (checkout / PREVIOUS_MIGRATION).exists():
        raise ValueError('Closure migration requires 283_platform_assistant_permissions to remain')
    destination = checkout / MIGRATION
    if destination.exists() or destination.is_symlink():
        raise ValueError('Closure migration target already exists')
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_bytes((HERE / SQL_FILE).read_bytes())
    subprocess.run(['git', 'add', '--', MIGRATION], cwd=checkout, check=True)
    expected = dict(manifest)
    expected['candidateTree'] = manifest.get('candidateTree') or git(checkout, 'write-tree')
    return verify_checkout(checkout, expected)


def prepare(output, source=None):
    manifest = verify_sources()
    if source is None:
        raise ValueError(
            'Closure 284 requires the authorized production API checkout (tree 2e7cc189…); '
            'it must not rebuild the stale 283 candidate'
        )
    output = Path(output).resolve()
    if output.exists():
        raise ValueError('Output directory must not exist')
    subprocess.run(['git', 'clone', '--quiet', str(Path(source).resolve()), str(output)], check=True)
    input_tree = git(output, 'write-tree')
    assert_production_input(input_tree)
    return apply_extension(output, {**manifest, 'inputTree': input_tree})


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument('--verify-only', action='store_true')
    mode.add_argument('--output-dir', type=Path)
    parser.add_argument('--source', type=Path, help='Authorized production API checkout used read-only as the clone source')
    parser.add_argument('--checkout', type=Path, help='Complete assembled candidate to verify without modifying it')
    args = parser.parse_args(argv)
    if args.source and not args.output_dir:
        parser.error('--source requires --output-dir')
    if args.checkout and not args.verify_only:
        parser.error('--checkout requires --verify-only')
    manifest = verify_sources()
    if args.checkout:
        tree = verify_checkout(args.checkout, _checkout_manifest(args.checkout, manifest))
        print(json.dumps({'candidateTree': tree, 'sourceChecksumsVerified': True,
                          'runtimeCheckoutVerified': True, 'buildsImage': False,
                          'deploys': False, 'runsMigrations': False}, indent=2))
        return
    if args.output_dir:
        tree = prepare(args.output_dir, args.source)
        print(json.dumps({'candidateTree': tree, 'inputTreePrefix': INPUT_TREE_PREFIX,
                          'sourceChecksumsVerified': True, 'runtimeCheckoutVerified': True,
                          'buildsImage': False, 'deploys': False, 'runsMigrations': False}, indent=2))
        return
    print(json.dumps({'inputTreePrefix': manifest['inputTreePrefix'],
                      'rejectedInputTree': manifest['rejectedInputTree'],
                      'candidateTreePolicy': manifest['candidateTreePolicy'],
                      'sourceChecksumsVerified': True, 'runtimeCheckoutVerified': False,
                      'buildsImage': False, 'deploys': False, 'runsMigrations': False}, indent=2))


def _checkout_manifest(checkout, manifest):
    checkout = Path(checkout).resolve()
    if not (checkout / MIGRATION).exists():
        raise ValueError('Packaged closure migration is missing')
    subprocess.run(['git', 'rm', '--cached', '--quiet', '--', MIGRATION], cwd=checkout, check=True)
    try:
        input_tree = git(checkout, 'write-tree')
    finally:
        subprocess.run(['git', 'add', '--', MIGRATION], cwd=checkout, check=True)
    return {**manifest, 'inputTree': input_tree, 'candidateTree': git(checkout, 'write-tree')}


if __name__ == '__main__':
    main()
