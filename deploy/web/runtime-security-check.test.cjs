'use strict';

const assert = require('node:assert/strict');
const { mkdtemp, mkdir, rm, writeFile } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const {
  APPROVED_NEXT_VERSION,
  APPROVED_SHARP_VERSION,
  APPROVED_SOURCE_MAP_JS_VERSION,
  checkRuntimeSecurity,
} = require('./runtime-security-check.cjs');

async function writePkg(dir, name, version) {
  await mkdir(dir, { recursive: true });
  if (version === undefined) return;
  if (version === 'malformed') {
    await writeFile(join(dir, 'package.json'), '{not-json');
    return;
  }
  await writeFile(join(dir, 'package.json'), JSON.stringify({ name, version }));
}

async function installRuntime(root, name, spec = {}) {
  const dir = join(root, name);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'server.js'), "'use strict';\n");
  if (spec.next !== undefined) {
    await writePkg(join(dir, 'node_modules', 'next'), 'next', spec.next);
  }
  if (spec.sharp !== undefined) {
    await writePkg(join(dir, 'node_modules', 'sharp'), 'sharp', spec.sharp);
  }
  if (spec.sourceMapJs !== undefined) {
    await writePkg(
      join(dir, 'node_modules', 'source-map-js'),
      'source-map-js',
      spec.sourceMapJs,
    );
  }
  if (spec.nestedSharp !== undefined) {
    await writePkg(
      join(dir, 'node_modules', 'nested', 'node_modules', 'sharp'),
      'sharp',
      spec.nestedSharp,
    );
  }
  return dir;
}

async function fixture(t, spec) {
  const root = await mkdtemp(join(tmpdir(), 'runtime-security-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const roots = {};
  for (const name of ['current', 'legacy']) {
    if (!(name in spec)) continue;
    roots[name] = await installRuntime(root, name, spec[name]);
  }
  return roots;
}

function patched(extra = {}) {
  return {
    next: APPROVED_NEXT_VERSION,
    sharp: APPROVED_SHARP_VERSION,
    ...extra,
  };
}

test('approved next+sharp on both pass; source-map-js optional on current', async (t) => {
  const roots = await fixture(t, {
    current: patched(),
    legacy: patched({ sourceMapJs: APPROVED_SOURCE_MAP_JS_VERSION }),
  });
  const report = checkRuntimeSecurity({ roots });
  assert.equal(report.ok, true);
  assert.equal(report.expectedVersion, APPROVED_NEXT_VERSION);
  assert.equal(report.expectedPackages.next, APPROVED_NEXT_VERSION);
  assert.equal(report.expectedPackages.sharp, APPROVED_SHARP_VERSION);
  assert.equal(report.expectedPackages['source-map-js'], APPROVED_SOURCE_MAP_JS_VERSION);
  assert.equal(report.runtimes.current.version, APPROVED_NEXT_VERSION);
  assert.equal(report.runtimes.legacy.version, APPROVED_NEXT_VERSION);
  assert.deepEqual(
    report.runtimes.current.packages.sharp.map((p) => p.version),
    [APPROVED_SHARP_VERSION],
  );
  assert.deepEqual(report.runtimes.current.packages['source-map-js'], []);
  assert.deepEqual(
    report.runtimes.legacy.packages['source-map-js'].map((p) => p.version),
    [APPROVED_SOURCE_MAP_JS_VERSION],
  );
});

test('legacy 16.2.11 is rejected even when current is approved', async (t) => {
  const roots = await fixture(t, {
    current: patched(),
    legacy: patched({ next: '16.2.11' }),
  });
  const report = checkRuntimeSecurity({ roots });
  assert.equal(report.ok, false);
  assert.equal(report.error, 'version-mismatch');
  assert.equal(report.runtimes.legacy.version, '16.2.11');
});

test('old sharp is rejected even when next is approved on both', async (t) => {
  const roots = await fixture(t, {
    current: patched(),
    legacy: patched({ sharp: '0.35.0' }),
  });
  const report = checkRuntimeSecurity({ roots });
  assert.equal(report.ok, false);
  assert.equal(report.error, 'version-mismatch');
  assert.equal(report.runtimes.legacy.version, APPROVED_NEXT_VERSION);
  assert.deepEqual(
    report.runtimes.legacy.packages.sharp.map((p) => p.version),
    ['0.35.0'],
  );
});

test('old source-map-js is rejected even when next+sharp are approved', async (t) => {
  const roots = await fixture(t, {
    current: patched(),
    legacy: patched({ sourceMapJs: '1.2.1' }),
  });
  const report = checkRuntimeSecurity({ roots });
  assert.equal(report.ok, false);
  assert.equal(report.error, 'version-mismatch');
  assert.deepEqual(
    report.runtimes.legacy.packages['source-map-js'].map((p) => p.version),
    ['1.2.1'],
  );
});

test('second nested vulnerable sharp copy fails alongside safe top-level', async (t) => {
  const roots = await fixture(t, {
    current: patched(),
    legacy: patched({ nestedSharp: '0.35.0' }),
  });
  const report = checkRuntimeSecurity({ roots });
  assert.equal(report.ok, false);
  assert.equal(report.error, 'version-mismatch');
  const versions = report.runtimes.legacy.packages.sharp.map((p) => p.version).sort();
  assert.deepEqual(versions, ['0.35.0', APPROVED_SHARP_VERSION].sort());
});

test('missing legacy runtime fails', async (t) => {
  const roots = await fixture(t, { current: patched() });
  const report = checkRuntimeSecurity({
    roots: { current: roots.current, legacy: join(roots.current, '..', 'missing-legacy') },
  });
  assert.equal(report.ok, false);
  assert.equal(report.error, 'absent-next-runtime');
});

test('malformed next package.json fails', async (t) => {
  const roots = await fixture(t, {
    current: patched(),
    legacy: patched({ next: 'malformed' }),
  });
  const report = checkRuntimeSecurity({ roots });
  assert.equal(report.ok, false);
  assert.equal(report.error, 'malformed-next-package');
});

test('malformed sharp package.json fails', async (t) => {
  const roots = await fixture(t, {
    current: patched(),
    legacy: patched({ sharp: 'malformed' }),
  });
  const report = checkRuntimeSecurity({ roots });
  assert.equal(report.ok, false);
  assert.equal(report.error, 'malformed-package');
});

test('missing next package fails', async (t) => {
  const roots = await fixture(t, {
    current: patched(),
    legacy: { sharp: APPROVED_SHARP_VERSION },
  });
  const report = checkRuntimeSecurity({ roots });
  assert.equal(report.ok, false);
  assert.equal(report.error, 'absent-next-runtime');
});

test('missing sharp package fails even when next is approved', async (t) => {
  const roots = await fixture(t, {
    current: patched(),
    legacy: { next: APPROVED_NEXT_VERSION },
  });
  const report = checkRuntimeSecurity({ roots });
  assert.equal(report.ok, false);
  assert.equal(report.error, 'absent-required-package');
});

test('node - stdin entry runs main and emits sanitized JSON', () => {
  const source = require('node:fs').readFileSync(join(__dirname, 'runtime-security-check.cjs'));
  // Same launcher as release: `docker exec -i … node - < runtime-security-check.cjs`
  const run = spawnSync(process.execPath, ['-'], { input: source, encoding: 'utf8' });
  assert.notEqual(run.status, 0);
  const report = JSON.parse(run.stdout);
  assert.equal(report.ok, false);
  assert.equal(typeof report.error, 'string');
  assert.equal(report.expectedVersion, APPROVED_NEXT_VERSION);
  assert.equal(report.expectedPackages.next, APPROVED_NEXT_VERSION);
  assert.equal(report.expectedPackages.sharp, APPROVED_SHARP_VERSION);
});
