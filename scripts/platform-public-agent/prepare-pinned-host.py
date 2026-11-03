#!/usr/bin/env python3
"""Prepare a disposable b0a10ac checkout for host integration tests, never a release."""
import hashlib
import json
import pathlib
import shutil
import subprocess
import sys

root = pathlib.Path(__file__).resolve().parents[2]
if len(sys.argv) != 2:
    raise SystemExit('usage: prepare-pinned-host.py <disposable-checkout>')
source = pathlib.Path(sys.argv[1]).resolve(strict=True)
expected = 'b0a10ac814cd03fbfb45132566035acce8339f17'
tree = subprocess.check_output(['git', '-C', str(source), 'write-tree'], text=True).strip()
if tree != expected or subprocess.run(['git', '-C', str(source), 'diff-files', '--quiet']).returncode:
    raise SystemExit('source tree differs from pinned b0a10ac')
if not source.is_relative_to(root / 'output'):
    raise SystemExit('source must be inside this worktree output directory')
host = source / 'apps/api/src'
destination = host / 'platform-public-agent'
if destination.exists():
    raise SystemExit('candidate already exists; use a fresh checkout')
shutil.copytree(root / 'deploy/nuni-api/platform-public-agent', destination,
                ignore=shutil.ignore_patterns('*.md', '*.sql'))
shutil.copyfile(root / 'packages/shared/src/providenceCampus.ts', destination / 'providenceCampus.ts')
app = host / 'app.ts'
content = app.read_text()
def replace_once(old, new):
    global content
    if content.count(old) != 1:
        raise SystemExit(f'Expected exactly one host anchor: {old!r}')
    content = content.replace(old, new, 1)

replace_once('export interface AppOptions {', '''import { hostAllowsPublicTask, installPublicTaskHost, type PublicAgentHostOptions } from "./platform-public-agent/production-host";
import { PROVIDENCE_CAMPUS_SOURCE, PROVIDENCE_CAMPUS_PLACES } from "./platform-public-agent/providenceCampus";
import type { FastifyCandidate } from "./platform-public-agent/fastify-candidate";

export interface AppOptions {
  /** Candidate injection only; no runtime flag is wired. */
  publicAgentCandidate?: PublicAgentHostOptions;''')
replace_once('if (pathname && isPublicApiRoute(request.method, pathname)) return;',
             'if (pathname && (isPublicApiRoute(request.method, pathname) || hostAllowsPublicTask(request.method, pathname, options.publicAgentCandidate))) return;')
replace_once('  registerPersonalImportSyncRoutes(app, db, platformAccounts);', '''  registerPersonalImportSyncRoutes(app, db, platformAccounts);
  installPublicTaskHost(app as unknown as FastifyCandidate, db, platformAccounts,
    PROVIDENCE_CAMPUS_SOURCE, PROVIDENCE_CAMPUS_PLACES, options.publicAgentCandidate);''')
app.write_text(content)
migration = host / 'migrations/999_public_agent_isolated_test_only.sql'
if migration.exists():
    raise SystemExit('test-only migration collision')
shutil.copyfile(root / 'deploy/nuni-api/platform-public-agent/schema.candidate.sql', migration)
files = [app, migration, *sorted(destination.glob('*.ts'))]
manifest = {'kind': 'local-test-only', 'baseTree': expected,
            'files': {str(p.relative_to(source)): hashlib.sha256(p.read_bytes()).hexdigest() for p in files},
            'migration': '999_public_agent_isolated_test_only'}
(source / 'public-agent-test-manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
print('Prepared disabled-by-default local test host; test-only migration has not been applied.')
