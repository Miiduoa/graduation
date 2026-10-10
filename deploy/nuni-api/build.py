#!/usr/bin/env python3
"""Rebuild the deployed Nuni API from its pinned source and reviewed patches."""
import hashlib
import json
from pathlib import Path
import subprocess
import tempfile

root = Path(__file__).resolve().parent
manifest = json.loads((root / 'source.json').read_text())
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
    subprocess.run(['docker', 'build', '--platform', 'linux/amd64', '-f', 'apps/api/Dockerfile',
                    '--label', 'org.opencontainers.image.revision=' + manifest['candidateCommit'],
                    '-t', 'nuni-api:campus-platform', '.'], cwd=checkout, check=True)
