// @vitest-environment node
import { afterEach, expect, it } from 'vitest';
import {
  firebaseAdminInitAttemptsForTests,
  getFirebaseAdmin,
  hasServiceAccountJson,
  resetFirebaseAdminForTests,
} from './firebaseAdmin';

const dummyAccount = (projectId: string, privateKey = 'not-a-pem') =>
  JSON.stringify({
    project_id: projectId,
    client_email: 'demo@example.local',
    private_key: privateKey,
  });

afterEach(() => {
  resetFirebaseAdminForTests();
  delete process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
});

it('treats a missing service account as not configured without throwing', async () => {
  delete process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  expect(hasServiceAccountJson()).toBe(false);
  await expect(getFirebaseAdmin()).resolves.toBeNull();
});

it('treats invalid JSON as not configured so the website can still boot', async () => {
  process.env.FIREBASE_SERVICE_ACCOUNT_JSON = '{not-json';
  resetFirebaseAdminForTests();
  expect(hasServiceAccountJson()).toBe(true);
  await expect(getFirebaseAdmin()).resolves.toBeNull();
});

it('rejects incomplete service account objects without initializing Admin', async () => {
  process.env.FIREBASE_SERVICE_ACCOUNT_JSON = JSON.stringify({
    project_id: 'campus-one-tw',
    client_email: 'demo@example.local',
  });
  resetFirebaseAdminForTests();
  await expect(getFirebaseAdmin()).resolves.toBeNull();
});

it('rejects a service account whose project_id is not campus-one-tw', async () => {
  process.env.FIREBASE_SERVICE_ACCOUNT_JSON = dummyAccount('other-project');
  resetFirebaseAdminForTests();
  await expect(getFirebaseAdmin()).resolves.toBeNull();
  expect(firebaseAdminInitAttemptsForTests()).toBe(1);
});

it('treats a broken PEM as unconfigured and does not retry initialization', async () => {
  process.env.FIREBASE_SERVICE_ACCOUNT_JSON = dummyAccount(
    'campus-one-tw',
    '-----BEGIN PRIVATE KEY-----\nnot-a-real-key\n-----END PRIVATE KEY-----\n',
  );
  resetFirebaseAdminForTests();
  await expect(getFirebaseAdmin()).resolves.toBeNull();
  await expect(getFirebaseAdmin()).resolves.toBeNull();
  expect(firebaseAdminInitAttemptsForTests()).toBe(1);
});
