#!/usr/bin/env python3
"""Rebuild the deployed Nuni API from its pinned source and reviewed patches."""
import argparse
import importlib.util
import hashlib
import json
from pathlib import Path
import subprocess
import tempfile

root = Path(__file__).resolve().parent


def parse_args(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    candidates = parser.add_mutually_exclusive_group()
    candidates.add_argument('--course-access-candidate', action='store_true', help='Build the disabled-by-default course review candidate; never deploy or migrate')
    candidates.add_argument('--public-cafeterias-candidate', action='store_true', help='Build the public read-only cafeteria catalog; never deploy or migrate')
    candidates.add_argument('--food-ordering-candidate', action='store_true', help='Build the six-patch ordering candidate; never deploy, migrate or combine other candidates')
    return parser.parse_args(argv)


def build(args):
    manifest_path = root / ('food-ordering/source.json' if args.food_ordering_candidate else 'source.json')
    manifest = json.loads(manifest_path.read_text())
    with tempfile.TemporaryDirectory(prefix='campus-nuni-api-') as scratch:
        checkout = Path(scratch) / 'source'
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
        if args.course_access_candidate:
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
        subprocess.run(['docker', 'build', '--platform', 'linux/amd64', '-f', 'apps/api/Dockerfile',
                        '--label', 'org.opencontainers.image.revision=' + revision,
                        '-t', image, '.'], cwd=checkout, check=True)


if __name__ == '__main__':
    build(parse_args())
