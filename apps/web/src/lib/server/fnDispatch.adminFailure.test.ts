// @vitest-environment node
import { afterEach, beforeEach, expect, it } from 'vitest';
import { dispatchFnRequest } from './fnDispatch';
import { firebaseAdminInitAttemptsForTests, resetFirebaseAdminForTests } from './firebaseAdmin';
import { resetUidRateLimitForTests } from './uidRateLimit';

function request(name: string): Request {
  return new Request(`https://nuni.tw/api/fn/${name}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer nope',
    },
    body: JSON.stringify({ data: { schoolId: 'pu', joinCode: 'ABCD1234' } }),
  });
}

beforeEach(() => {
  resetFirebaseAdminForTests();
  resetUidRateLimitForTests();
});

afterEach(() => {
  resetFirebaseAdminForTests();
  resetUidRateLimitForTests();
  delete process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
});

it('returns 503 尚未啟用 when Admin initialization fails, without key material', async () => {
  const privateKey = '-----BEGIN PRIVATE KEY-----\nnot-a-real-key\n-----END PRIVATE KEY-----\n';
  process.env.FIREBASE_SERVICE_ACCOUNT_JSON = JSON.stringify({
    project_id: 'campus-one-tw',
    client_email: 'demo@example.local',
    private_key: privateKey,
  });
  const res = await dispatchFnRequest('joinGroupByCode', request('joinGroupByCode'));
  expect(res.status).toBe(503);
  const text = await res.text();
  expect(text).toBe(JSON.stringify({ error: { status: 'UNAVAILABLE', message: '尚未啟用' } }));
  expect(text).not.toContain('BEGIN PRIVATE KEY');
  expect(text).not.toContain('not-a-real-key');
  expect(text).not.toContain('private_key');
  expect(text).not.toContain('FIREBASE_SERVICE_ACCOUNT_JSON');
  const again = await dispatchFnRequest('joinGroupByCode', request('joinGroupByCode'));
  expect(again.status).toBe(503);
  expect(firebaseAdminInitAttemptsForTests()).toBe(1);
});

it('returns 503 尚未啟用 when the service account project_id is not campus-one-tw', async () => {
  process.env.FIREBASE_SERVICE_ACCOUNT_JSON = JSON.stringify({
    project_id: 'some-other-project',
    client_email: 'demo@example.local',
    private_key: 'not-a-pem',
  });
  const res = await dispatchFnRequest(
    'leaveGroup',
    new Request('https://nuni.tw/api/fn/leaveGroup', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer nope',
      },
      body: JSON.stringify({ data: { groupId: 'one' } }),
    }),
  );
  expect(res.status).toBe(503);
  expect(await res.json()).toEqual({
    error: { status: 'UNAVAILABLE', message: '尚未啟用' },
  });
});
