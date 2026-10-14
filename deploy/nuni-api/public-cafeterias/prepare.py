#!/usr/bin/env python3
"""Prepare the public cafeteria catalog in an isolated, pinned Nuni checkout. Never deploy."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]


def extension_files():
    shared = ROOT / 'packages' / 'shared' / 'src'
    return {
        'apps/api/src/public-cafeterias/cafeteriaCatalog.ts': shared / 'cafeteriaCatalog.ts',
        'apps/api/src/public-cafeterias/merchantMode.ts': shared / 'merchantMode.ts',
        'apps/api/src/public-cafeterias/service.ts': HERE / 'service.ts',
        'apps/api/src/public-cafeterias/routes.ts': HERE / 'routes.ts',
    }


def patch_app(source):
    anchor = '  const normalizedMethod = method.toUpperCase();'
    marker = '  app.get("/v1/auth/platform/providers",'
    if source.count(anchor) != 1 or source.count(marker) != 1 or 'registerPublicCafeteriaRoutes' in source:
        raise ValueError('Pinned Nuni integration anchors changed; review the adapter before building')
    source = 'import { registerPublicCafeteriaRoutes, isPublicCafeteriaRoute } from "./public-cafeterias/routes";\n' + source
    source = source.replace(
        anchor,
        anchor + '\n  if (isPublicCafeteriaRoute(normalizedMethod, pathname)) return true;',
    )
    return source.replace(marker, '  registerPublicCafeteriaRoutes(app, db);\n\n' + marker)


def apply_extension(checkout, apply=False):
    checkout = Path(checkout).resolve()
    manifest = json.loads((HERE.parent / 'source.json').read_text())
    tree = subprocess.check_output(['git', 'write-tree'], cwd=checkout, text=True).strip()
    if tree != manifest['candidateTree']:
        raise ValueError('Base tree is not the reviewed runtime source; no extension applied')
    subprocess.run(['git', 'diff', '--exit-code', '--quiet'], cwd=checkout, check=True)
    if subprocess.check_output(['git', 'ls-files', '--others', '--exclude-standard'], cwd=checkout).strip():
        raise ValueError('Use an isolated checkout without untracked files')
    targets = extension_files()
    for target in targets:
        if (checkout / target).exists():
            raise ValueError(f'Candidate target already exists: {target}')
    files = {target: hashlib.sha256(source.read_bytes()).hexdigest() for target, source in targets.items()}
    pinned = json.loads((HERE / 'packaging-source.json').read_text())
    if files != pinned:
        raise ValueError('Overlay checksum mismatch')
    app = checkout / 'apps/api/src/app.ts'
    patched = patch_app(app.read_text())
    plan = {
        'baseTree': tree,
        'mode': 'candidate-only',
        'files': files,
        'deploys': False,
        'runsMigrations': False,
        'writesProductionDatabase': False,
    }
    if not apply:
        return plan
    for target, source in targets.items():
        destination = checkout / target
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(source.read_bytes())
    app.write_text(patched)
    subprocess.run(['git', 'add', 'apps/api/src/app.ts', *targets.keys()], cwd=checkout, check=True)
    plan['candidateTree'] = subprocess.check_output(['git', 'write-tree'], cwd=checkout, text=True).strip()
    return plan


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--checkout', required=True)
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    print(json.dumps(apply_extension(args.checkout, args.apply), ensure_ascii=False, indent=2))
