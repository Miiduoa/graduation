#!/usr/bin/env python3
"""Rebuild the deployed Nuni API from its pinned source and reviewed patches."""
import argparse
import contextlib
import shutil
import importlib.util
import hashlib
import json
from pathlib import Path
import subprocess
import tempfile

root = Path(__file__).resolve().parent


def parse_args(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    extensions = parser.add_mutually_exclusive_group()
    extensions.add_argument('--imports-compatible-rollback', action='store_true', help='Build the existing catalog code plus new SQL manifests, without data rollback')
    extensions.add_argument('--imports-candidate', action='store_true', help='Build the pinned cafeteria, reviewed course and personal import sync composition; never deploy or migrate')
    extensions.add_argument('--course-access-candidate', action='store_true', help='Build the disabled-by-default course review candidate; never deploy or migrate')
    extensions.add_argument('--public-cafeterias-candidate', action='store_true', help='Build the public read-only cafeteria catalog; never deploy or migrate')
    extensions.add_argument('--food-ordering-candidate', action='store_true', help='Build the six-patch ordering candidate; never deploy, migrate or combine other candidates')
    extensions.add_argument('--security-candidate', action='store_true', help='Build the production-bound runtime dependency security image (deploy/nuni-api/security); never deploy, migrate, or alter default overlays')
    parser.add_argument('--prepare-only', action='store_true', help='Write verified build context without building, pushing, deploying or migrating')
    parser.add_argument('--output-dir', type=Path, help='New directory for --prepare-only build context')
    args = parser.parse_args(argv)
    if args.prepare_only != bool(args.output_dir):
        parser.error('--prepare-only and --output-dir must be used together')
    if args.prepare_only and not (args.imports_candidate or args.imports_compatible_rollback):
        parser.error('--prepare-only requires an imports candidate or compatible rollback')
    return args


def build(args):
    if args.prepare_only:
        args.output_dir = args.output_dir.resolve()
        if args.output_dir.exists():
            raise SystemExit('Output directory must not exist')
    if args.security_candidate:
        spec = importlib.util.spec_from_file_location('nuni_api_security_prepare', root / 'security' / 'prepare.py')
        extension = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(extension)
        raise SystemExit(extension.main([]))
    if args.imports_compatible_rollback:
        rollback = json.loads((root / 'composed/rollback-source.json').read_text())
        project = root.parents[1]
        for name, checksum in rollback['migrations'].items():
            if hashlib.sha256((project / name).read_bytes()).hexdigest() != checksum:
                raise SystemExit('Rollback migration checksum mismatch')
        dockerfile = root / 'composed/Dockerfile.rollback'
        if ('FROM ' + rollback['baseImage'] + '\n') not in dockerfile.read_text():
            raise SystemExit('Rollback image base mismatch')
        if args.prepare_only:
            args.output_dir.mkdir(parents=True)
            for name in rollback['migrations']:
                destination = args.output_dir / name
                destination.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(project / name, destination)
            shutil.copyfile(dockerfile, args.output_dir / 'Dockerfile')
            (args.output_dir / 'release-source.json').write_text(json.dumps(rollback, indent=2) + '\n')
            return
        subprocess.run(['docker', 'build', '--platform', 'linux/amd64', '-f', str(dockerfile),
                        '--label', 'org.opencontainers.image.base.digest=' + rollback['baseImage'].split('@')[1],
                        '-t', 'nuni-api:imports-compatible-rollback', str(project)], check=True)
        return
    manifest_path = root / ('food-ordering/source.json' if args.food_ordering_candidate else 'source.json')
    manifest = json.loads(manifest_path.read_text())
    context = contextlib.nullcontext(None) if args.prepare_only else tempfile.TemporaryDirectory(prefix='campus-nuni-api-')
    with context as scratch:
        checkout = args.output_dir if args.prepare_only else Path(scratch) / 'source'
        subprocess.run(['git', 'clone', '--quiet', manifest['repository'], str(checkout)], check=True)
        subprocess.run(['git', 'checkout', '--quiet', '--detach', manifest['baseCommit']], cwd=checkout, check=True)
        for patch in manifest['patches']:
            path = root / 'patches' / patch['file']
            if hashlib.sha256(path.read_bytes()).hexdigest() != patch['sha256']:
                raise SystemExit('Patch checksum mismatch')
            subprocess.run(['git', 'apply', '--index', str(path)], cwd=checkout, check=True)
        tree = subprocess.check_output(['git', 'write-tree'], cwd=checkout, text=True).strip()
        if tree != manifest['candidateTree']:
            raise SystemExit('Candidate source tree mismatch')
        image = 'nuni-api:food-ordering-candidate' if args.food_ordering_candidate else 'nuni-api:campus-platform'
        revision = manifest['candidateCommit']
        if args.imports_candidate:
            spec = importlib.util.spec_from_file_location('composed_prepare', root / 'composed' / 'prepare.py')
            extension = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(extension)
            plan = extension.apply_extension(checkout)
            print(json.dumps(plan, ensure_ascii=False, indent=2))
            image = 'nuni-api:imports-candidate'
            revision = plan['candidateTree']
        elif args.course_access_candidate:
            spec = importlib.util.spec_from_file_location('course_access_prepare', root / 'course-access' / 'prepare.py')
            extension = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(extension)
            plan = extension.apply_extension(checkout, apply=True)
            print(json.dumps(plan, ensure_ascii=False, indent=2))
            image = 'nuni-api:course-access-candidate'
            revision = plan['candidateTree']
        elif args.public_cafeterias_candidate:
            spec = importlib.util.spec_from_file_location('public_cafeterias_prepare', root / 'public-cafeterias' / 'prepare.py')
            extension = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(extension)
            plan = extension.apply_extension(checkout, apply=True)
            print(json.dumps(plan, ensure_ascii=False, indent=2))
            image = 'nuni-api:public-cafeterias-candidate'
            revision = plan['candidateTree']
        if args.prepare_only:
            # Keep the verified Git tree unchanged; remote builder receives the
            # revision label through its image label, recorded in the runbook.
            print(json.dumps({'context': str(checkout), 'revision': revision, 'buildsImage': False}))
            return
        subprocess.run(['docker', 'build', '--platform', 'linux/amd64', '-f', 'apps/api/Dockerfile',
                        '--label', 'org.opencontainers.image.revision=' + revision,
                        '-t', image, '.'], cwd=checkout, check=True)


if __name__ == '__main__':
    build(parse_args())
