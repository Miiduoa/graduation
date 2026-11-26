import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

test('the actual full-suite shell runs every flow and preserves any failure', t => {
  const root = mkdtempSync(join(tmpdir(), 'maestro-suite-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, '.maestro/flows'), { recursive: true });
  mkdirSync(join(root, 'bin'));
  const flows = new URL('../../apps/mobile/.maestro/flows/', import.meta.url);
  const names = readdirSync(flows).filter(name => name.endsWith('.yaml')).sort();
  assert.equal(names.length, 13);
  for (const name of names) copyFileSync(new URL(name, flows), join(root, '.maestro/flows', name));
  const workflow = readFileSync(new URL('../../.github/workflows/maestro-e2e.yml', import.meta.url), 'utf8');
  const step = workflow.split('      - name: Run Full Test Suite\n')[1].split('\n      - name:')[0];
  const script = step.split('        run: |\n')[1].replace(/^          /gm, '');
  writeFileSync(join(root, 'bin/maestro'), '#!/usr/bin/env bash\nprintf "%s\\n" "$4" >> "$FLOW_LOG"\n[[ "$4" != "$FAIL_FLOW" ]]\n');
  writeFileSync(join(root, 'bin/sleep'), '#!/usr/bin/env bash\nexit 0\n');
  chmodSync(join(root, 'bin/maestro'), 0o755);
  chmodSync(join(root, 'bin/sleep'), 0o755);
  for (const failure of ['', names[0], names.at(-1)]) {
    const log = join(root, `run-${failure || 'success'}.log`);
    const result = spawnSync('bash', ['-e', '-o', 'pipefail', '-c', script], {
      cwd: root, encoding: 'utf8', env: { ...process.env, PATH: `${join(root, 'bin')}:${process.env.PATH}`,
        SIMULATOR_UDID: 'test-simulator', APP_ID: 'test.app', FLOW_LOG: log,
        FAIL_FLOW: failure ? `.maestro/flows/${failure}` : '' },
    });
    assert.equal(result.status, failure ? 1 : 0, result.stderr);
    assert.deepEqual(readFileSync(log, 'utf8').trim().split('\n'), names.map(name => `.maestro/flows/${name}`));
  }
});
