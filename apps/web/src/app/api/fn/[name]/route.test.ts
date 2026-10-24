// @vitest-environment node
import { expect, it } from 'vitest';
import { GET, OPTIONS, POST } from './route';

it('only exposes GET, POST, and OPTIONS through the Next.js route', () => {
  expect(typeof POST).toBe('function');
  expect(typeof GET).toBe('function');
  expect(typeof OPTIONS).toBe('function');
});

it('returns 404 for names outside the allowlist without requiring a service account', async () => {
  const response = await POST(
    new Request('https://nuni.tw/api/fn/askCampusAssistant', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: {} }),
    }),
    { params: Promise.resolve({ name: 'askCampusAssistant' }) },
  );
  expect(response.status).toBe(404);
  expect(await response.json()).toMatchObject({
    error: { status: 'NOT_FOUND' },
  });
});

it('returns 503 尚未啟用 when no service account is configured', async () => {
  delete process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  const response = await POST(
    new Request('https://nuni.tw/api/fn/joinGroupByCode', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer nope' },
      body: JSON.stringify({ data: {} }),
    }),
    { params: Promise.resolve({ name: 'joinGroupByCode' }) },
  );
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({
    error: { status: 'UNAVAILABLE', message: '尚未啟用' },
  });
  const share = await POST(
    new Request('https://nuni.tw/api/fn/createTimetableShare', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer nope' },
      body: JSON.stringify({ data: { schoolId: 'pu' } }),
    }),
    { params: Promise.resolve({ name: 'createTimetableShare' }) },
  );
  expect(share.status).toBe(503);
  expect(await share.json()).toEqual({
    error: { status: 'UNAVAILABLE', message: '尚未啟用' },
  });
});

it('returns 404 for createGroup even though the handler still exists', async () => {
  const response = await POST(
    new Request('https://nuni.tw/api/fn/createGroup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: {} }),
    }),
    { params: Promise.resolve({ name: 'createGroup' }) },
  );
  expect(response.status).toBe(404);
  expect(await response.json()).toMatchObject({
    error: { status: 'NOT_FOUND', message: 'Unknown function: createGroup' },
  });
});
