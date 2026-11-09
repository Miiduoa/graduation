// @vitest-environment node
import { expect, it } from 'vitest';
import { OPTIONS, POST } from './route';

it('only exposes POST and OPTIONS through the Next.js route', () => {
  expect(typeof POST).toBe('function');
  expect(typeof OPTIONS).toBe('function');
});

it('returns 503 尚未啟用 when R2 and Admin are not configured', async () => {
  delete process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  delete process.env.FILE_STORAGE_BACKEND;
  const response = await POST(
    new Request('https://nuni.tw/api/files/private', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer nope' },
      body: JSON.stringify({ action: 'download', path: 'groups/course/posts/one/notes.pdf' }),
    }),
  );
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ error: '尚未啟用' });
});
