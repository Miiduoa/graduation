import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../../', import.meta.url));
const sha = (value) => createHash('sha256').update(value).digest('hex');
test('all packaged modules bind shared permissions and trusted public map sources', () => {
  const manifest = JSON.parse(
    readFileSync(new URL('../../deploy/nuni-api/assistant/source.json', import.meta.url)),
  );
  assert.match(manifest.candidateTree, /^[a-f0-9]{40}$/);
  assert.equal(manifest.inputTree, 'add9614a93c65b4587ca5649a83803614c786f28');
  for (const [name, checksum] of Object.entries(manifest.files))
    assert.equal(sha(readFileSync(root + name)), checksum, name);
  assert.ok(manifest.files['packages/shared/src/assistantPermissions.ts']);
  assert.ok(manifest.files['packages/shared/src/campusMapLookup.ts']);
  assert.equal(
    sha(readFileSync(root + 'deploy/nuni-api/security/source.json')),
    manifest.securityManifestSha256,
  );
});
test('builder remains opt-in; guard matches exact actions and refuses drifted anchors', async () => {
  const result = await promisify(execFile)(
    'python3',
    [
      '-c',
      `
import importlib.util
from pathlib import Path
r = Path(${JSON.stringify(root)})
def load(path):
 s=importlib.util.spec_from_file_location('candidate',r/path)
 m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
b=load('deploy/nuni-api/build.py')
assert not b.parse_args([]).assistant_candidate
assert b.parse_args(['--assistant-candidate']).assistant_candidate
assert b.parse_args(['--assistant-candidate','--prepare-only','--output-dir','/tmp/new-assistant-source']).prepare_only
p=load('deploy/nuni-api/assistant/prepare.py')
source='  const normalizedMethod = method.toUpperCase();\\n  app.get("/v1/auth/platform/providers",'
patched=p.patch_app(source)
assert 'registerAssistantRoutes(app, platformAccounts, options.attendanceCodeSecret)' in patched
assert 'CAMPUS_ASSISTANT_ENABLED === "true" && isAssistantRoute(normalizedMethod, pathname)' in patched
for bad in ['',source+source,patched]:
 try: p.patch_app(bad)
 except ValueError: pass
 else: raise AssertionError('anchor drift accepted')
print('ok')
`,
    ],
    { encoding: 'utf8' },
  );
  assert.equal(result.stdout.trim(), 'ok');
});
