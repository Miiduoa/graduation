// @vitest-environment node
import { deleteApp, getApps } from 'firebase-admin/app';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { getFirebaseAdmin, resetFirebaseAdminForTests } from './firebaseAdmin';
import { firebaseEmulatorRewrites } from './firebaseEmulatorConfig';
import { getPathMatch } from 'next/dist/shared/lib/router/utils/path-match';
import { prepareDestination } from 'next/dist/shared/lib/router/utils/prepare-destination';

const local: NodeJS.ProcessEnv = {
  NODE_ENV: 'development',
  NEXT_PUBLIC_USE_FIREBASE_EMULATOR: '1',
  NEXT_PUBLIC_FIREBASE_PROJECT_ID: 'demo-campus-one',
  NEXT_PUBLIC_FIREBASE_EMULATOR_HOST: '127.0.0.1',
  NEXT_PUBLIC_FIREBASE_EMULATOR_AUTH_PORT: '19291',
  NEXT_PUBLIC_FIREBASE_EMULATOR_FIRESTORE_PORT: '18291',
  FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:19291',
  FIRESTORE_EMULATOR_HOST: '127.0.0.1:18291',
  GCLOUD_PROJECT: 'demo-campus-one',
};

beforeEach(() => {
  resetFirebaseAdminForTests();
  for (const [name, value] of Object.entries(local)) vi.stubEnv(name, value);
  vi.stubEnv('GOOGLE_CLOUD_PROJECT', undefined);
  vi.stubEnv('FIREBASE_SERVICE_ACCOUNT_JSON', undefined);
  vi.stubEnv('NEXT_PUBLIC_FIREBASE_EMULATOR_SAME_ORIGIN', undefined);
});

afterEach(async () => {
  resetFirebaseAdminForTests();
  await Promise.all(getApps().filter((app) => app.name === 'campus-one-web-emulator').map(deleteApp));
  vi.unstubAllEnvs();
});

it('uses the actual Admin SDK for an isolated local project without reading a service account', async () => {
  const env: NodeJS.ProcessEnv = { ...local };
  Object.defineProperty(env, 'FIREBASE_SERVICE_ACCOUNT_JSON', {
    get() { throw new Error('The emulator must not read a production credential.'); },
  });
  const admin = await getFirebaseAdmin(env);
  expect(getApps().find((app) => app.name === 'campus-one-web-emulator')?.options.projectId).toBe('demo-campus-one');
  if (!admin) throw new Error('Local Admin runtime was not initialized.');
  expect(admin.messaging).toBeUndefined();
  await expect(admin.verifyIdToken('not-an-issued-token', true)).rejects.toThrow();
});

it.each([
  ['NODE_ENV', 'production'],
  ['NODE_ENV', undefined],
  ['NEXT_PUBLIC_USE_FIREBASE_EMULATOR', 'false'],
  ['NEXT_PUBLIC_FIREBASE_PROJECT_ID', 'campus-one-tw'],
  ['GCLOUD_PROJECT', 'campus-one-tw'],
  ['GOOGLE_CLOUD_PROJECT', 'campus-one-tw'],
  ['NEXT_PUBLIC_FIREBASE_EMULATOR_HOST', 'localhost'],
  ['FIREBASE_AUTH_EMULATOR_HOST', undefined],
  ['FIRESTORE_EMULATOR_HOST', undefined],
  ['FIREBASE_AUTH_EMULATOR_HOST', '127.0.0.1.example.test:19291'],
  ['FIRESTORE_EMULATOR_HOST', '0.0.0.0:18291'],
  ['FIRESTORE_EMULATOR_HOST', '127.0.0.1:65536'],
  ['NEXT_PUBLIC_FIREBASE_EMULATOR_AUTH_PORT', '9099'],
])('refuses incomplete or unsafe emulator configuration: %s=%s', async (name, value) => {
  vi.stubEnv(name, value);
  await expect(getFirebaseAdmin()).resolves.toBeNull();
  expect(getApps().some((app) => app.name === 'campus-one-web-emulator')).toBe(false);
  expect(firebaseEmulatorRewrites()).toEqual([]);
});

it('does not trust an injected emulator config when the SDK environment points elsewhere', async () => {
  vi.stubEnv('FIREBASE_AUTH_EMULATOR_HOST', undefined);
  await expect(getFirebaseAdmin({ ...local })).resolves.toBeNull();
});

it('proxies only local browser SDK endpoints in an explicit emulator preview', () => {
  vi.stubEnv('NEXT_PUBLIC_FIREBASE_EMULATOR_SAME_ORIGIN', 'true');
  const rewrites = firebaseEmulatorRewrites();
  expect(rewrites).toHaveLength(3);
  expect(rewrites.every((rule) => /^http:\/\/127\.0\.0\.1:(19291|18291)\//.test(rule.destination))).toBe(true);
  expect(rewrites.some((rule) => rule.source.includes('/projects/'))).toBe(false);
  for (const action of ['signInWithPassword', 'lookup']) {
    const pathname = `/identitytoolkit.googleapis.com/v1/accounts:${action}`;
    const params = getPathMatch(rewrites[0].source)(pathname);
    expect(params).toEqual({ operation: `accounts:${action}` });
    if (!params) throw new Error('Missing emulator SDK route');
    expect(prepareDestination({ destination: rewrites[0].destination, params, query: {},
      appendParamsToQuery: false }).parsedDestination.pathname).toBe(pathname);
  }
  expect(getPathMatch(rewrites[0].source)('/identitytoolkit.googleapis.com/v1/projects/demo-campus-one/accounts:update')).toBe(false);
  vi.stubEnv('NODE_ENV', 'production');
  expect(firebaseEmulatorRewrites()).toEqual([]);
});
