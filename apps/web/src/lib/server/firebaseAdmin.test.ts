// @vitest-environment node
import { afterEach, expect, it } from 'vitest';
import {
  getFirebaseAdmin,
  hasServiceAccountJson,
  resetFirebaseAdminForTests,
} from './firebaseAdmin';

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
    project_id: 'demo-campus',
    client_email: 'demo@example.local',
  });
  resetFirebaseAdminForTests();
  await expect(getFirebaseAdmin()).resolves.toBeNull();
});
