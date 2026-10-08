import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { runNuniVerification } from './verify-nuni-integration.mjs';

const binding = {
  firebaseProjectId: 'synthetic-project',
  firebaseUid: 'synthetic-uid',
  schoolId: 'school',
  nuniOrigin: 'https://api.nuni.tw',
  tenantId: 'tenant',
  personId: 'person',
  status: 'active',
  evidenceRef: 'synthetic-proof',
  verifiedAt: '2026-01-01T00:00:00Z',
};
async function fixture(t, bindings = [binding]) {
  const directory = await mkdtemp(join(tmpdir(), 'nuni-identity-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = join(directory, 'bindings.json');
  await writeFile(file, JSON.stringify({ version: 1, bindings }));
  return {
    NUNI_IDENTITY_BINDINGS_FILE: file,
    NUNI_EXPECTED_FIREBASE_PROJECT_ID: binding.firebaseProjectId,
    NUNI_EXPECTED_FIREBASE_UID: binding.firebaseUid,
    NUNI_EXPECTED_SCHOOL_ID: binding.schoolId,
    NUNI_SESSION_AUTHORIZATION: 'Bearer synthetic-secret',
  };
}
const response = (identity = binding) =>
  new Response(JSON.stringify({ tenantId: identity.tenantId, personId: identity.personId }), {
    headers: { 'content-type': 'application/json' },
  });

test('CLI verification executes the real adapter and reports only a read-only match', async (t) => {
  const environment = await fixture(t);
  const requests = [];
  const result = await runNuniVerification(environment, {
    fetchImpl: async (url, init) => {
      requests.push({ url, init });
      return response();
    },
  });
  assert.equal(result.exitCode, 0);
  assert.equal(result.result.status, 'verified');
  assert.equal(result.result.tokenIssued, false);
  assert.equal(result.result.dataModified, false);
  assert.equal(result.result.firebaseAuthenticationVerified, false);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, 'https://api.nuni.tw/v1/auth/session/identity');
  assert.equal(requests[0].init.headers.authorization, environment.NUNI_SESSION_AUTHORIZATION);
  assert.ok(!JSON.stringify(result).includes('synthetic-secret'));
});

test('CLI rejects unknown or revoked bindings before transmitting credentials', async (t) => {
  for (const bindings of [[], [{ ...binding, status: 'revoked' }]]) {
    const environment = await fixture(t, bindings);
    let calls = 0;
    const result = await runNuniVerification(environment, {
      fetchImpl: async () => {
        calls++;
        return response();
      },
    });
    assert.equal(result.exitCode, 1);
    assert.equal(result.result.code, 'mapping_unavailable');
    assert.equal(calls, 0);
  }
});

test('CLI rejects a valid session for a different owner', async (t) => {
  const result = await runNuniVerification(await fixture(t), {
    fetchImpl: async () => response({ ...binding, personId: 'other' }),
  });
  assert.equal(result.exitCode, 1);
  assert.equal(result.result.code, 'identity_mismatch');
});

test('CLI bounds mapping files and never prints their sensitive contents', async (t) => {
  const environment = await fixture(t);
  await writeFile(environment.NUNI_IDENTITY_BINDINGS_FILE, 'private mapping '.repeat(100000));
  const result = await runNuniVerification(environment);
  assert.equal(result.result.code, 'invalid_mapping');
  assert.ok(!JSON.stringify(result).includes('private mapping'));
});

test('CLI error output never includes upstream errors or session values', async (t) => {
  const result = await runNuniVerification(await fixture(t), {
    fetchImpl: async () => {
      throw new Error('synthetic-secret');
    },
  });
  assert.equal(result.exitCode, 1);
  assert.equal(result.result.code, 'upstream_unavailable');
  assert.ok(!JSON.stringify(result).includes('synthetic-secret'));
});

test('actual executable returns a nonzero exit when authoritative configuration is absent', () => {
  const result = spawnSync(
    process.execPath,
    [new URL('./verify-nuni-integration.mjs', import.meta.url).pathname],
    { env: { PATH: process.env.PATH }, encoding: 'utf8' },
  );
  assert.equal(result.status, 1);
  assert.equal(JSON.parse(result.stdout).status, 'blocked');
  assert.equal(JSON.parse(result.stdout).code, 'invalid_config');
  assert.equal(result.stderr, '');
});
