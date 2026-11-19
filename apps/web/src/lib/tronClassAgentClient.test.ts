import { afterEach, expect, it, vi } from 'vitest';
import { createTronClassAgentClient } from './tronClassAgentClient';

const revision = 'a'.repeat(32);
const version = 'b'.repeat(32);
const snapshot = { revision, fetchedAt: '2026-11-13T10:00:00Z', courses: [], homework: [], announcements: [], materials: [], partial: false, errors: [] };
const reply = { source: 'tronclass', requestId: '11111111-1111-4111-8111-111111111111', intent: 'homework', revision,
  grantVersion: version, fetchedAt: snapshot.fetchedAt, answer: '已確認作業清單。', selection: null, snapshot,
  preparation: null, actions: [], steps: [], capabilities: { readCourseData: true, downloadMaterials: false, prepareHomework: false, submitHomework: false, limitations: [] } };
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
afterEach(() => { vi.unstubAllGlobals(); });

it('sends only the current request and scoped auth to the Agent route', async () => {
  const fetch = vi.fn(async () => json(reply)); vi.stubGlobal('fetch', fetch);
  const client = createTronClassAgentClient({ kind: 'platform', context: 'platform-session' });
  expect(await client.ask({ question: 'TronClass 未交作業' })).toEqual(reply);
  const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toBe('/api/tronclass/agent');
  expect(init.headers).toEqual({ 'X-Campus-Session': 'platform-session', 'Content-Type': 'application/json' });
  expect(init).toMatchObject({ method: 'POST', cache: 'no-store', credentials: 'same-origin', redirect: 'error' });
  expect(JSON.parse(String(init.body))).toEqual({ action: 'ask', question: 'TronClass 未交作業' });
});

it.each([
  { snapshot: { ...snapshot, revision: 'c'.repeat(32) } },
  { capabilities: { ...reply.capabilities, submitHomework: true } },
  { actions: [{ kind: 'prepare_homework', id: 'wrong-target', courseId: 99, homeworkId: 88, title: '錯誤來源', revision }] },
])('rejects a mismatched revision, invented target, or expanded writing authority', async changes => {
  vi.stubGlobal('fetch', vi.fn(async () => json({ ...reply, ...changes })));
  const client = createTronClassAgentClient({ kind: 'platform', context: 'platform-session' });
  await expect(client.ask({ question: 'TronClass 作業' })).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
});

it('rejects dependent grants and stale binding responses', async () => {
  const fetch = vi.fn(async () => json({ revision: 'd'.repeat(32), version, updatedAt: null,
    permissions: { readCourseData: true, downloadMaterials: false, prepareHomework: false } }));
  vi.stubGlobal('fetch', fetch);
  const client = createTronClassAgentClient({ kind: 'platform', context: 'platform-session' });
  await expect(client.setGrant({ revision, expectedVersion: null,
    permissions: { readCourseData: false, downloadMaterials: true, prepareHomework: false } })).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  expect(fetch).not.toHaveBeenCalled();
  await expect(client.setGrant({ revision, expectedVersion: null,
    permissions: { readCourseData: true, downloadMaterials: false, prepareHomework: false } })).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
});

it('uses fresh Firebase identity on the guarded download and rejects login HTML', async () => {
  const token = vi.fn(async () => 'fresh-firebase-token');
  const fetch = vi.fn(async () => new Response('<html>Sign in</html>', {
    headers: { 'Content-Type': 'text/html', 'Content-Disposition': "attachment; filename*=UTF-8''lecture.pdf" },
  }));
  vi.stubGlobal('fetch', fetch);
  const client = createTronClassAgentClient({ kind: 'firebase', getIdToken: token });
  await expect(client.downloadMaterial({ courseId: 12, activityId: 71, uploadKey: 'lecture-1', revision })).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  expect(token).toHaveBeenCalledTimes(1);
  expect(fetch.mock.calls[0]).toEqual(['/api/tronclass/agent/download', expect.objectContaining({
    headers: { Authorization: 'Bearer fresh-firebase-token', 'Content-Type': 'application/json' },
  })]);
});

it('discards a late response after cancellation even if fetch ignored the signal', async () => {
  let finish!: (value: Response) => void;
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(resolve => { finish = resolve; })));
  const client = createTronClassAgentClient({ kind: 'platform', context: 'platform-session' });
  const controller = new AbortController();
  const result = client.ask({ question: 'TronClass 作業' }, controller.signal);
  const rejected = expect(result).rejects.toMatchObject({ name: 'AbortError' });
  await Promise.resolve();
  controller.abort();
  finish(json(reply));
  await rejected;
});
