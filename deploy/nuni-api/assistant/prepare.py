"""Prepare an opt-in, checksummed public assistant source. No runtime actions."""
import argparse
import hashlib
import json
import shutil
import importlib.util
import io
import tarfile
import tempfile
import subprocess
from pathlib import Path
HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
def run(args, cwd=None):
    return subprocess.check_output(args, cwd=cwd, text=True).strip()
def patch_app(source):
    anchor = '  const normalizedMethod = method.toUpperCase();'
    marker = '  app.get("/v1/auth/platform/providers",'
    if source.count(anchor) != 1 or source.count(marker) != 1 or 'registerAssistantRoutes' in source:
        raise ValueError('Assistant integration anchors changed')
    source = 'import { registerAssistantRoutes, isAssistantRoute } from "./assistant/routes";\n' + source
    source = source.replace(anchor, anchor + '\n  if (process.env.CAMPUS_ASSISTANT_ENABLED === "true" && isAssistantRoute(normalizedMethod, pathname)) return true;')
    return source.replace(marker, '  registerAssistantRoutes(app, platformAccounts, options.attendanceCodeSecret);\n\n' + marker)
def prepare(output, source=None):
    manifest = json.loads((HERE / 'source.json').read_text())
    if output.exists():
        raise ValueError('Output must be a new directory')
    # Reconstruct the release from its historical manifests, never current overlays.
    revision = manifest['releaseSourceCommit']
    with tempfile.TemporaryDirectory(prefix='nuni-release-source-') as scratch:
        archived = Path(scratch)
        data = subprocess.check_output(['git', 'archive', revision,
                                       'deploy/nuni-api', 'packages/shared/src'], cwd=ROOT)
        with tarfile.open(fileobj=io.BytesIO(data)) as archive:
            archive.extractall(archived, filter='data')
        api = archived / 'deploy/nuni-api'
        if hashlib.sha256((api / 'composed/source.json').read_bytes()).hexdigest() != manifest['composedManifestSha256']:
            raise ValueError('Release composed manifest changed')
        base = json.loads((api / 'source.json').read_text())
        run(['git', 'clone', '--quiet', '--no-hardlinks', str(source or base['repository']), str(output)])
        run(['git', 'checkout', '--quiet', '--detach', base['baseCommit']], output)
        for patch in base['patches']:
            path = api / 'patches' / patch['file']
            if hashlib.sha256(path.read_bytes()).hexdigest() != patch['sha256']:
                raise ValueError('Release patch checksum mismatch')
            run(['git', 'apply', '--index', str(path)], output)
        spec = importlib.util.spec_from_file_location('release_composed', api / 'composed/prepare.py')
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        module.apply_extension(output)
    if run(['git', 'write-tree'], output) != manifest['inputTree']:
        raise ValueError('Input tree mismatch')
    for name, checksum in manifest['files'].items():
        path = ROOT / name
        if hashlib.sha256(path.read_bytes()).hexdigest() != checksum:
            raise ValueError('Assistant file checksum mismatch: ' + name)
        target = output / 'apps/api/src/assistant' / ({'assistantPermissions.ts': 'sharedPermissions.ts', 'campusMapLookup.ts': 'sharedMapLookup.ts'}.get(path.name, path.name))
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(path, target)
    app = output / 'apps/api/src/app.ts'
    app.write_text(patch_app(app.read_text()))
    run(['git', 'add', 'apps/api/src/app.ts', 'apps/api/src/assistant'], output)
    tree = run(['git', 'write-tree'], output)
    changed = run(['git', 'diff-tree', '--no-commit-id', '--name-only', '-r', manifest['inputTree'], tree], output).splitlines()
    if any(name != 'apps/api/src/app.ts' and not name.startswith('apps/api/src/assistant/') for name in changed):
        raise ValueError('Assistant candidate changes files outside its overlay')
    if tree != manifest['candidateTree']:
        raise ValueError('Assistant candidate tree mismatch: ' + tree)
    return tree
def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, help='Local archived repository; read only')
    parser.add_argument('--output-dir', type=Path, required=True)
    args = parser.parse_args(argv)
    print(json.dumps({'candidateTree': prepare(args.output_dir.resolve(), args.source), 'buildsImage': False}))
if __name__ == '__main__':
    main()
