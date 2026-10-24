#!/usr/bin/env python3
"""Rebuild the deployed legacy Nuni Web from pinned archived source + reviewed patches."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import subprocess
import tempfile
from pathlib import Path

root = Path(__file__).resolve().parent


def parse_args(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        '--source',
        help='Existing local nuni-prod checkout (preferred for the archived private repo). '
             'Defaults to NUNI_WEB_LEGACY_SOURCE or a fresh clone of source.json repository.',
    )
    parser.add_argument(
        '--skip-docker',
        action='store_true',
        help='Materialize and verify the patched tree only; do not build the image.',
    )
    parser.add_argument(
        '--print-plan',
        action='store_true',
        help='Print the resolved build plan JSON and exit before Docker.',
    )
    parser.add_argument(
        '--keep-checkout',
        help='Materialize the patched source into this durable directory instead of a temp dir '
             '(recommended for long amd64 Docker builds). Destination must not already exist.',
    )
    return parser.parse_args(argv)


def sha256_file(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def run(cmd, **kwargs):
    return subprocess.run(cmd, check=True, **kwargs)


def _is_same_or_nested(a: Path, b: Path) -> bool:
    """True when paths are equal or one path is nested under the other."""
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
    """Fail closed before any filesystem mutation for --keep-checkout."""
    hint = source_hint or os.environ.get('NUNI_WEB_LEGACY_SOURCE')
    if hint:
        hint_path = Path(hint).resolve()
        if _is_same_or_nested(durable, hint_path):
            raise SystemExit(
                f'Refusing --keep-checkout that equals or nests with source checkout: '
                f'dest={durable} source={hint_path}'
            )
    if durable.exists():
        raise SystemExit(
            f'Refusing to materialize into existing path (fail closed): {durable}. '
            'Pass a new empty destination; this helper never deletes an unrelated checkout.'
        )
    if durable.parent.exists() and not durable.parent.is_dir():
        raise SystemExit(f'--keep-checkout parent is not a directory: {durable.parent}')
    # Parent must exist so we do not mkdir -p across an unexpected tree; callers create it.
    if not durable.parent.exists():
        raise SystemExit(
            f'Refusing to create missing parent for --keep-checkout: {durable.parent}. '
            'Create the parent directory explicitly, then re-run with a non-existent child path.'
        )


def materialize(manifest: dict, source_hint: str | None, keep_checkout: str | None = None):
    durable = Path(keep_checkout).resolve() if keep_checkout else None
    scratch = None
    worktree_created = False
    if durable is not None:
        assert_keep_checkout_safe(durable, source_hint)
        checkout = durable
    else:
        scratch = tempfile.TemporaryDirectory(prefix='campus-nuni-web-legacy-')
        checkout = Path(scratch.name) / 'source'
    hint = source_hint or os.environ.get('NUNI_WEB_LEGACY_SOURCE')
    worktree_parent = None
    try:
        if hint:
            hint_path = Path(hint).resolve()
            if not (hint_path / '.git').exists():
                raise SystemExit(f'Source checkout missing .git: {hint_path}')
            worktree_parent = hint_path
            # Prefer an isolated worktree so partial local clones still share objects.
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
            run(['git', 'clone', '--quiet', manifest['repository'], str(checkout)])
            run(['git', 'checkout', '--quiet', '--detach', manifest['baseCommit']], cwd=checkout)
            worktree_created = True
        base_web_tree = subprocess.check_output(
            ['git', 'rev-parse', f"{manifest['baseCommit']}:apps/web"], cwd=checkout, text=True
        ).strip()
        if base_web_tree != manifest['appsWebTreeAtBase']:
            raise SystemExit(
                f"Base apps/web tree mismatch: got {base_web_tree}, expected {manifest['appsWebTreeAtBase']}"
            )
        for patch in manifest['patches']:
            path = root / 'patches' / patch['file']
            digest = sha256_file(path)
            if digest != patch['sha256']:
                raise SystemExit(f"Patch checksum mismatch for {patch['file']}: {digest}")
            run(['git', 'apply', '--index', str(path)], cwd=checkout)
        tree = subprocess.check_output(['git', 'write-tree'], cwd=checkout, text=True).strip()
        if tree != manifest['candidateTree']:
            raise SystemExit(
                f"Candidate source tree mismatch: got {tree}, expected {manifest['candidateTree']}"
            )
        web_pkg = json.loads((checkout / 'apps/web/package.json').read_text())
        if web_pkg.get('dependencies', {}).get('next') != manifest['targetNextVersion']:
            raise SystemExit('Patched apps/web package.json does not pin target Next version')
        root_pkg = json.loads((checkout / 'package.json').read_text())
        overrides = (root_pkg.get('pnpm') or {}).get('overrides') or {}
        expected_overrides = manifest.get('expectedRootOverrides') or {}
        for key, value in expected_overrides.items():
            if overrides.get(key) != value:
                raise SystemExit(
                    f'Patched root override {key!r} is {overrides.get(key)!r}, expected {value!r}'
                )
        return checkout, scratch, worktree_parent, durable is not None, worktree_created
    except Exception:
        # Cleanup may remove only a worktree/checkout this invocation created.
        if worktree_created and worktree_parent is not None and checkout.exists():
            subprocess.run(
                ['git', '-C', str(worktree_parent), 'worktree', 'remove', '--force', str(checkout)],
                check=False,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
        elif worktree_created and durable is not None and checkout.exists():
            # Fresh clone into a new durable path we created this run.
            shutil.rmtree(checkout, ignore_errors=True)
        if scratch is not None:
            scratch.cleanup()
        raise


def cleanup_materialized(scratch, worktree_parent, checkout: Path, keep: bool):
    if keep:
        return
    if worktree_parent is not None and checkout.exists():
        subprocess.run(
            ['git', '-C', str(worktree_parent), 'worktree', 'remove', '--force', str(checkout)],
            check=False,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
    if scratch is not None:
        scratch.cleanup()


def docker_build(checkout: Path, manifest: dict) -> None:
    dockerfile = root / 'Dockerfile'
    expected_from = f"FROM {manifest['runtimeNodeImage']} AS base"
    if expected_from not in dockerfile.read_text():
        raise SystemExit('Dockerfile runtime Node image pin mismatch')
    # Copy helper Dockerfile into the private checkout context without publishing source.
    staged = checkout / '.campus-nuni-web-legacy.Dockerfile'
    shutil.copyfile(dockerfile, staged)
    build_args = []
    for key, value in manifest['publicBuildArgs'].items():
        build_args.extend(['--build-arg', f'{key}={value}'])
    run(
        [
            'docker',
            'build',
            '--platform',
            manifest['platform'],
            '-f',
            str(staged),
            '--label',
            f"org.opencontainers.image.revision={manifest['candidateTree']}",
            '--label',
            f"campus.legacy.base_commit={manifest['baseCommit']}",
            '--label',
            f"campus.legacy.rollback_image={manifest['rollbackLegacyImage']}",
            '-t',
            manifest['imageTag'],
            *build_args,
            '.',
        ],
        cwd=checkout,
    )


def build(args):
    manifest = json.loads((root / 'source.json').read_text())
    checkout, scratch, worktree_parent, keep, _created = materialize(
        manifest, args.source, keep_checkout=args.keep_checkout
    )
    try:
        plan = {
            'baseCommit': manifest['baseCommit'],
            'candidateTree': manifest['candidateTree'],
            'imageTag': manifest['imageTag'],
            'platform': manifest['platform'],
            'targetNextVersion': manifest['targetNextVersion'],
            'rollbackLegacyImage': manifest['rollbackLegacyImage'],
            'patches': [p['file'] for p in manifest['patches']],
            'checkout': str(checkout),
            'sourceBindingCertainty': manifest['sourceBinding']['certainty'],
            'keptCheckout': keep,
        }
        print(json.dumps(plan, ensure_ascii=False, indent=2))
        if args.print_plan or args.skip_docker:
            return plan
        docker_build(checkout, manifest)
        return plan
    finally:
        cleanup_materialized(scratch, worktree_parent, checkout, keep)


if __name__ == '__main__':
    build(parse_args())
