import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateTarget, validateFirebase, summarizeMachines, requireStable, inspectPublic, getJson, EXPECTED_MACHINES } from './release-check.mjs';
const sha = 'a'.repeat(40);
const target = { GITHUB_REPOSITORY: 'Miiduoa/graduation', GITHUB_REF: 'refs/heads/main', CONFIRM_APP: 'nuni-web', EXPECTED_RELEASE_SHA: sha, GITHUB_SHA: sha };
const config = { projectId: 'campus-one-tw', apiKey: `AIza${'a'.repeat(35)}`, authDomain: 'campus-one-tw.firebaseapp.com', storageBucket: 'campus-one-tw.firebasestorage.app', messagingSenderId: '123456789', appId: '1:123456789:web:abcdef' };
const machine = (id) => ({ id, region: 'nrt', state: 'started', config: { image: `registry.fly.io/nuni-web@sha256:${'b'.repeat(64)}`, guest: { cpu_kind: 'shared', cpus: 1, memory_mb: 512 }, env: { SECRET_VALUE: 'never-copy-this' } } });
const machines = () => EXPECTED_MACHINES.map(machine);

test('requires the exact main revision and approved app', () => {
  assert.equal(validateTarget(target), sha);
  for (const change of [{ CONFIRM_APP: 'nuni-api' }, { GITHUB_REPOSITORY: 'other/repo' }, { GITHUB_REF: 'refs/heads/feature' }, { EXPECTED_RELEASE_SHA: 'main' }, { GITHUB_SHA: 'b'.repeat(40) }]) assert.throws(() => validateTarget({ ...target, ...change }));
});
test('accepts only complete public browser configuration for the approved Firebase project', () => {
  const values = validateFirebase(config);
  assert.equal(Object.keys(values).length, 6);
  assert.equal(values.NEXT_PUBLIC_FIREBASE_PROJECT_ID, 'campus-one-tw');
  for (const key of Object.keys(config)) assert.throws(() => validateFirebase({ ...config, [key]: '' }));
});
test('rejects placeholders, cross-project config, newlines and mismatched app IDs', () => {
  for (const change of [{ apiKey: 'mock-api-key' }, { projectId: 'other' }, { authDomain: 'attacker.example' }, { storageBucket: 'other.appspot.com' }, { appId: '1:111:web:abcdef' }, { messagingSenderId: '123\nEVIL=1' }]) assert.throws(() => validateFirebase({ ...config, ...change }));
});
test('snapshot contains only the two previously identified public machine facts', () => {
  const result = summarizeMachines(machines());
  assert.equal(result.length, 2);
  assert.ok(!JSON.stringify(result).includes('never-copy-this'));
  assert.ok(!JSON.stringify(result).includes('SECRET_VALUE'));
});
test('does not accept changes in machine count, identity, sizing, health or region', () => {
  for (const rows of [[], [machine(EXPECTED_MACHINES[0])], [...machines(), machine('extra')], [machine('other'), machine(EXPECTED_MACHINES[1])], [machine(EXPECTED_MACHINES[0]), machine(EXPECTED_MACHINES[0])]]) assert.throws(() => summarizeMachines(rows));
  for (const change of [{ state: 'stopped' }, { region: 'sin' }, { config: { guest: { cpu_kind: 'shared', cpus: 1, memory_mb: 1024 } } }]) assert.throws(() => summarizeMachines([{ ...machines()[0], ...change }, machines()[1]]));
});
test('accepts an immutable image_ref but rejects mutable and cross-app images', () => {
  const row = machine(EXPECTED_MACHINES[0]);
  row.config.image = 'registry.fly.io/nuni-web:some-tag';
  row.image_ref = { registry: 'registry.fly.io', repository: 'nuni-web', digest: `sha256:${'b'.repeat(64)}` };
  assert.equal(summarizeMachines([row, machines()[1]]).length, 2);
  row.image_ref.repository = 'nuni-api';
  assert.throws(() => summarizeMachines([row, machines()[1]]));
});
test('blocks an existing mixed-image rollout and another deployment during build', () => {
  const before = summarizeMachines(machines());
  requireStable(before, summarizeMachines(machines()));
  const changed = machines();
  changed[0].config.image = `registry.fly.io/nuni-web@sha256:${'c'.repeat(64)}`;
  assert.throws(() => summarizeMachines(changed));
  changed[1].config.image = changed[0].config.image;
  assert.throws(() => requireStable(before, summarizeMachines(changed)));
});
function fakeFetch(health = {}, transit = { status: 'unavailable', reason: 'not-configured' }, pageStatus = 200, policy = 'geolocation=(self)') {
  return async (url, init) => {
    assert.equal(init.redirect, 'error'); assert.equal(init.credentials, 'omit');
    if (url.endsWith('/health/ready')) return Response.json({ service: 'campus-one-web', status: 'ready', legacy: 'ready', revision: sha, ...health });
    if (url.endsWith('/api/transit')) {
      assert.deepEqual(JSON.parse(init.body), { action: 'campus', schoolId: 'pu' });
      return Response.json(transit, { status: transit.status === 'ready' ? 200 : 503 });
    }
    return new Response('<html>學校站牌 找我附近 搜尋站名 常用站牌</html>', { status: pageStatus, headers: { 'Content-Type': 'text/html', 'Permissions-Policy': policy } });
  };
}
test('distinguishes Web deployment from missing TDX and unverified browser interaction', async () => {
  const report = await inspectPublic(sha, fakeFetch());
  assert.equal(report.webDeployed, true);
  assert.equal(report.transit.status, 'not-configured');
  assert.equal(report.browserControlsVerified, false);
  assert.equal(report.liveArrivalsVerified, false);
});
test('a healthy old revision, missing legacy or invalid public page cannot pass', async () => {
  for (const health of [{ revision: 'b'.repeat(40) }, { service: 'other' }, { status: 'unavailable' }, { legacy: 'disabled' }]) assert.equal((await inspectPublic(sha, fakeFetch(health))).webDeployed, false);
  assert.equal((await inspectPublic(sha, fakeFetch({}, undefined, 404))).webDeployed, false);
  assert.equal((await inspectPublic(sha, fakeFetch({}, undefined, 200, 'geolocation=()'))).webDeployed, false);
});
test('station data alone is never reported as verified real-time arrival data', async () => {
  const report = await inspectPublic(sha, fakeFetch({}, { status: 'ready', kind: 'stops', stops: [{ id: 'public-stop' }] }));
  assert.equal(report.transit.status, 'stations-received');
  assert.equal(report.liveArrivalsVerified, false);
});
test('never copies unknown provider errors into public reports', async () => {
  const report = await inspectPublic(sha, fakeFetch({}, { status: 'unavailable', reason: 'sensitive-provider-detail' }));
  assert.equal(report.transit.status, 'invalid-response');
  assert.ok(!JSON.stringify(report).includes('sensitive-provider-detail'));
});
test('rejects a non-JSON API response rather than assuming successful connectivity', async () => {
  await assert.rejects(getJson('https://example.invalid/', { fetcher: async () => new Response('login') }));
});

test('a healthy Web revision without the new bus controls cannot pass', async () => {
  const healthy = fakeFetch();
  const fetcher = (url, init) => url.endsWith('/bus')
    ? Promise.resolve(new Response('<html>Old bus page</html>', {headers:{'Content-Type':'text/html','Permissions-Policy':'geolocation=(self)'}}))
    : healthy(url, init);
  assert.equal((await inspectPublic(sha, fetcher)).webDeployed, false);
});
