"""Assemble an opt-in lost-found overlay on the exact composed API; never deploy or migrate."""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess

HERE = Path(__file__).resolve().parent
API = HERE.parent
ROOT = API.parents[1]
APP = 'apps/api/src/app.ts'
MIGRATION = 'apps/api/src/migrations/282_platform_lost_found.sql'
MANIFEST = HERE / 'source.json'


def sha(content):
    return hashlib.sha256(content).hexdigest()


def git(checkout, *arguments):
    return subprocess.check_output(['git', *arguments], cwd=checkout, text=True).strip()


def extension_files():
    return {
        'apps/api/src/lost-found/contracts.ts': ROOT / 'packages/shared/src/nuniLostFound.ts',
        'apps/api/src/lost-found/nuni.ts': ROOT / 'packages/shared/src/nuni.ts',
        'apps/api/src/lost-found/taipeiTime.ts': ROOT / 'packages/shared/src/taipeiTime.ts',
        'apps/api/src/lost-found/lostFoundFields.ts': ROOT / 'packages/shared/src/lostFoundFields.ts',
        'apps/api/src/lost-found/routes.ts': HERE / 'routes.ts',
        'apps/api/src/lost-found/service.ts': HERE / 'service.ts',
        MIGRATION: HERE / '282_platform_lost_found.sql',
    }


def patch_app(source):
    anchor = '  const normalizedMethod = method.toUpperCase();'
    marker = '  app.get("/v1/auth/platform/providers",'
    if source.count(anchor) != 1 or source.count(marker) != 1 or 'registerPlatformLostFoundRoutes' in source:
        raise ValueError('Pinned lost-found integration anchors changed')
    source = 'import { registerPlatformLostFoundRoutes, isPlatformLostFoundRoute } from "./lost-found/routes";\n' + source
    # Known platform endpoints must reach a genuine 404 while registration is
    # disabled; campus authentication would misclassify an unavailable module as
    # an expired Google session. Registered routes still verify Platform handles.
    source = source.replace(anchor, anchor + '\n  if (isPlatformLostFoundRoute(normalizedMethod, pathname)) return true;')
    return source.replace(marker, '  registerPlatformLostFoundRoutes(app, db, platformAccounts);\n\n' + marker)


def patch_rollback_app(source):
    anchor = '  const normalizedMethod = method.toUpperCase();'
    if source.count(anchor) != 1 or 'registerPlatformLostFoundRoutes' in source or '/v1/auth/platform/lost-found/' in source:
        raise ValueError('Pinned lost-found rollback integration anchor changed')
    # Preserve unavailable-feature 404s during rollback without importing or
    # registering the new module. Every other campus-auth rule stays in place.
    guard = '  if (normalizedMethod === "POST" && ["list", "get", "create", "update", "resolve", "remove", "export"].some((action) => pathname === `/v1/auth/platform/lost-found/${action}`)) return true;'
    return source.replace(anchor, anchor + '\n' + guard)


def current_manifest():
    composed = json.loads((API / 'composed/source.json').read_text())
    return {
        'schema': 'campus.platform-lost-found-source/v1',
        'inputTree': composed['candidateTree'],
        'inputAppSha256': composed['patchedAppSha256'],
        'baseManifestSha256': sha((API / 'source.json').read_bytes()),
        'composedManifestSha256': sha((API / 'composed/source.json').read_bytes()),
        'adapterSha256': sha(Path(__file__).read_bytes()),
        'sourceFiles': {target: {'source': str(source.relative_to(ROOT)), 'sha256': sha(source.read_bytes())}
                        for target, source in sorted(extension_files().items())},
        'migration': '282_platform_lost_found',
        'enabledByDefault': False,
        'candidateTreePolicy': 'Derived only after exact input tree, source checksums and allowed path diff are verified; no runtime build receipt is implied.',
    }


def verify_sources():
    expected = current_manifest()
    pinned = json.loads(MANIFEST.read_text())
    if expected != pinned:
        changed = [key for key in set(expected) | set(pinned) if expected.get(key) != pinned.get(key)]
        raise ValueError('Lost-found source drift: ' + ', '.join(sorted(changed)))
    return pinned


def verify_checkout(checkout, manifest, compatible_rollback=False):
    checkout = Path(checkout).resolve()
    subprocess.run(['git', 'diff', '--quiet'], cwd=checkout, check=True)
    if git(checkout, 'ls-files', '--others', '--exclude-standard'):
        raise ValueError('Untracked files are not permitted in the packaging checkout')
    for arguments in [('ls-files', '--others', '--ignored', '--exclude-standard', '--', 'apps/api/src', 'packages/contracts/src')]:
        if git(checkout, *arguments):
            raise ValueError('Ignored runtime source is not permitted in the packaging checkout')
    tree = git(checkout, 'write-tree')
    changed = set(git(checkout, 'diff-tree', '--no-commit-id', '--name-only', '-r', manifest['inputTree'], tree).splitlines())
    targets = {MIGRATION, APP} if compatible_rollback else set(extension_files()) | {APP}
    if changed != targets:
        raise ValueError('Lost-found candidate changed unexpected paths')
    for entry in git(checkout, 'ls-tree', '-r', tree, '--', APP, *targets).splitlines():
        mode, remainder = entry.split(' ', 1)
        if mode != '100644':
            raise ValueError('Packaged runtime source must remain a regular non-executable file')
        target = remainder.split('\t', 1)[1]
        if (checkout / target).is_symlink():
            raise ValueError('Packaged runtime source must not be a symlink')
    for target, record in manifest['sourceFiles'].items():
        if compatible_rollback and target != MIGRATION:
            continue
        if sha((checkout / target).read_bytes()) != record['sha256']:
            raise ValueError('Lost-found packaged source mismatch: ' + target)
    original_app = subprocess.check_output(['git', 'show', manifest['inputTree'] + ':' + APP], cwd=checkout)
    if sha(original_app) != manifest['inputAppSha256']:
        raise ValueError('Lost-found input app checksum mismatch')
    expected_app = (patch_rollback_app if compatible_rollback else patch_app)(original_app.decode()).encode()
    if (checkout / APP).read_bytes() != expected_app:
        raise ValueError('Lost-found app integration mismatch')
    return tree


def apply_extension(checkout, manifest, compatible_rollback=False):
    checkout = Path(checkout).resolve()
    if git(checkout, 'write-tree') != manifest['inputTree']:
        raise ValueError('Lost-found requires the exact composed input tree')
    subprocess.run(['git', 'diff', '--quiet'], cwd=checkout, check=True)
    if git(checkout, 'ls-files', '--others', '--exclude-standard'):
        raise ValueError('Untracked files are not permitted in the packaging checkout')
    if sha((checkout / APP).read_bytes()) != manifest['inputAppSha256']:
        raise ValueError('Lost-found input app checksum mismatch')
    targets = {}
    for target, source in extension_files().items():
        if compatible_rollback and target != MIGRATION:
            continue
        destination = checkout / target
        if destination.exists():
            raise ValueError('Lost-found overlay target already exists: ' + target)
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(source.read_bytes())
        targets[target] = source
    app = checkout / APP
    app.write_text((patch_rollback_app if compatible_rollback else patch_app)(app.read_text()))
    subprocess.run(['git', 'add', '--', APP, *targets], cwd=checkout, check=True)
    return verify_checkout(checkout, manifest, compatible_rollback)


def prepare(output, source=None, compatible_rollback=False):
    manifest = verify_sources()
    output = Path(output).resolve()
    if output.exists():
        raise ValueError('Output directory must not exist')
    base = json.loads((API / 'source.json').read_text())
    subprocess.run(['git', 'clone', '--quiet', '--no-hardlinks', str(source or base['repository']), str(output)], check=True)
    subprocess.run(['git', 'checkout', '--quiet', '--detach', base['baseCommit']], cwd=output, check=True)
    for entry in base['patches']:
        patch = API / 'patches' / entry['file']
        if sha(patch.read_bytes()) != entry['sha256']:
            raise ValueError('Base patch checksum mismatch')
        subprocess.run(['git', 'apply', '--index', str(patch)], cwd=output, check=True)
    spec = importlib.util.spec_from_file_location('lost_found_composed_input', API / 'composed/prepare.py')
    composed = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(composed)
    composed.apply_extension(output)
    return apply_extension(output, manifest, compatible_rollback)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument('--verify-only', action='store_true', help='Verify pinned inputs, optionally an already assembled checkout')
    mode.add_argument('--output-dir', type=Path, help='New directory for a complete authorized source reconstruction')
    mode.add_argument('--refresh-manifest', action='store_true', help='Explicitly bind reviewed source changes; does not assert a runtime build')
    parser.add_argument('--source', type=Path, help='Existing authorized archived repository, used read-only as the clone source')
    parser.add_argument('--checkout', type=Path, help='Existing assembled candidate to verify; never edited')
    parser.add_argument('--compatible-rollback', action='store_true')
    args = parser.parse_args(argv)
    if args.source and not args.output_dir:
        parser.error('--source requires --output-dir')
    if args.checkout and not args.verify_only:
        parser.error('--checkout requires --verify-only')
    if args.refresh_manifest:
        MANIFEST.write_text(json.dumps(current_manifest(), indent=2) + '\n')
        result = {'sourceManifestRefreshed': True, 'runtimeCheckoutVerified': False}
    elif args.verify_only:
        manifest = verify_sources()
        result = {'sourceChecksumsVerified': True, 'inputTree': manifest['inputTree'], 'runtimeCheckoutVerified': bool(args.checkout)}
        if args.checkout:
            result['candidateTree'] = verify_checkout(args.checkout, manifest, args.compatible_rollback)
    else:
        result = {'candidateTree': prepare(args.output_dir, args.source, args.compatible_rollback), 'runtimeCheckoutVerified': True}
    print(json.dumps({**result, 'compatibleRollback': args.compatible_rollback,
                      'buildsImage': False, 'deploys': False, 'runsMigrations': False, 'enablesService': False}, indent=2))


if __name__ == '__main__':
    main()
