#!/usr/bin/env python3
"""Materialize the production-bound nuni-api security candidate tree.

Never deploys, migrates, pushes, or mutates production. Default candidate
overlays under deploy/nuni-api/ are not applied; production is bound by the
checksummed 0000 patch to tree b0a10ac…, then 0001 applies dependency pins.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import subprocess
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
API = HERE.parent


def sha256_file(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def run(cmd, **kwargs):
    return subprocess.run(cmd, check=True, **kwargs)


def load_manifest() -> dict:
    return json.loads((HERE / 'source.json').read_text())


def _is_same_or_nested(a: Path, b: Path) -> bool:
    try:
        a.relative_to(b)
        return True
    except ValueError:
        pass
    try:
        b.relative_to(a)
        return True
    except ValueError:
        return False


def assert_keep_checkout_safe(durable: Path, source_hint: str | None) -> None:
    if durable.exists():
        raise SystemExit(
            f'Refusing to materialize into existing path (fail closed): {durable}.'
        )
    if not durable.parent.exists():
        raise SystemExit(
            f'Refusing to create missing parent for --keep-checkout: {durable.parent}.'
        )
    hint = source_hint or os.environ.get('NUNI_API_SECURITY_SOURCE')
    if hint:
        hint_path = Path(hint).resolve()
        if _is_same_or_nested(durable, hint_path):
            raise SystemExit(
                f'Refusing --keep-checkout that equals or nests with source checkout: '
                f'dest={durable} source={hint_path}'
            )


def materialize(manifest: dict, source_hint: str | None, keep_checkout: str | None = None):
    durable = Path(keep_checkout).resolve() if keep_checkout else None
    scratch = None
    worktree_created = False
    if durable is not None:
        assert_keep_checkout_safe(durable, source_hint)
        checkout = durable
    else:
        scratch = tempfile.TemporaryDirectory(prefix='campus-nuni-api-security-')
        checkout = Path(scratch.name) / 'source'

    hint = source_hint or os.environ.get('NUNI_API_SECURITY_SOURCE')
    worktree_parent = None
    try:
        if hint:
            hint_path = Path(hint).resolve()
            if not (hint_path / '.git').exists():
                raise SystemExit(f'Source checkout missing .git: {hint_path}')
            worktree_parent = hint_path
            run(
                [
                    'git',
                    '-C',
                    str(hint_path),
                    'worktree',
                    'add',
                    '--detach',
                    '--quiet',
                    str(checkout),
                    manifest['baseCommit'],
                ]
            )
            worktree_created = True
        else:
            if durable is not None:
                checkout.mkdir(parents=False)
            run(['git', 'clone', '--quiet', manifest['repository'], str(checkout)])
            run(
                ['git', 'checkout', '--quiet', '--detach', manifest['baseCommit']],
                cwd=checkout,
            )

        for patch in manifest['patches']:
            path = HERE / 'patches' / patch['file']
            if sha256_file(path) != patch['sha256']:
                raise SystemExit(f'Patch checksum mismatch: {patch["file"]}')
            run(['git', 'apply', '--index', str(path)], cwd=checkout)

        tree = subprocess.check_output(['git', 'write-tree'], cwd=checkout, text=True).strip()
        if tree != manifest['candidateTree']:
            raise SystemExit(
                f'Security candidate tree mismatch: got {tree}, '
                f'expected {manifest["candidateTree"]}'
            )
        # Confirm production bind intermediate by re-checking first patch alone is not required
        # at runtime; candidateTree already includes both patches.
        dockerfile = (checkout / 'apps/api/Dockerfile').read_text()
        if manifest['runtimeNodeImage'] not in dockerfile.split(' AS base', 1)[0]:
            raise SystemExit('Dockerfile runtime Node image pin mismatch')
        if "ca-certificates>=20261020-r0" not in dockerfile:
            raise SystemExit('Dockerfile CA hardening pin missing')

        plan = {
            'schema': manifest['schema'],
            'baseCommit': manifest['baseCommit'],
            'productionTree': manifest['productionTree'],
            'candidateTree': tree,
            'imageTag': manifest['imageTag'],
            'platform': manifest['platform'],
            'runtimeNodeImage': manifest['runtimeNodeImage'],
            'rollbackImage': manifest['rollbackImage'],
            'patches': [p['file'] for p in manifest['patches']],
            'patchedVersions': manifest['patchedVersions'],
            'checkout': str(checkout),
            'deploys': False,
            'runsMigrations': False,
            'pushesRegistry': False,
        }
        return plan, checkout, scratch, worktree_parent, worktree_created
    except Exception:
        if worktree_created and worktree_parent is not None:
            subprocess.run(
                ['git', '-C', str(worktree_parent), 'worktree', 'remove', '--force', str(checkout)],
                check=False,
            )
        elif durable is not None and durable.exists():
            shutil.rmtree(durable)
        if scratch is not None:
            scratch.cleanup()
        raise


def build_image(checkout: Path, manifest: dict) -> None:
    run(
        [
            'docker',
            'build',
            '--platform',
            manifest['platform'],
            '-f',
            'apps/api/Dockerfile',
            '--label',
            'org.opencontainers.image.revision=' + manifest['candidateTree'],
            '--label',
            'campus.nuni-api.security.production-tree=' + manifest['productionTree'],
            '--label',
            'campus.nuni-api.security.rollback=' + manifest['rollbackImage'],
            '-t',
            manifest['imageTag'],
            '.',
        ],
        cwd=checkout,
    )


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        '--source',
        help='Local nuni-prod checkout (preferred for archived private repo). '
             'Defaults to NUNI_API_SECURITY_SOURCE or a fresh clone.',
    )
    parser.add_argument('--skip-docker', action='store_true')
    parser.add_argument('--print-plan', action='store_true')
    parser.add_argument(
        '--keep-checkout',
        help='Materialize into this new directory instead of a temp dir.',
    )
    args = parser.parse_args(argv)
    manifest = load_manifest()
    plan, checkout, scratch, worktree_parent, worktree_created = materialize(
        manifest, args.source, args.keep_checkout
    )
    try:
        print(json.dumps(plan, ensure_ascii=False, indent=2))
        if args.print_plan or args.skip_docker:
            return 0
        build_image(checkout, manifest)
        return 0
    finally:
        if args.keep_checkout:
            pass
        else:
            if worktree_created and worktree_parent is not None:
                subprocess.run(
                    [
                        'git',
                        '-C',
                        str(worktree_parent),
                        'worktree',
                        'remove',
                        '--force',
                        str(checkout),
                    ],
                    check=False,
                )
            if scratch is not None:
                scratch.cleanup()


if __name__ == '__main__':
    raise SystemExit(main())
