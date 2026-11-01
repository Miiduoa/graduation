import { beforeEach, expect, it, vi } from 'vitest';
import { getCloudNavigationPreview, runCloudNavigationTask } from './cloudNavigationClient';

const state = vi.hoisted(() => ({
  uid: 'alice' as string | null,
  configured: true,
  callable: vi.fn(),
}));
vi.mock('./firebase', () => ({
  getAuth: () => ({ currentUser: state.uid ? { uid: state.uid } : null }),
  getFunctionsInstance: () => ({}),
  isFirebaseConfigured: () => state.configured,
}));
vi.mock('./functionsUrl', () => ({ areFunctionsConfigured: () => state.configured }));
vi.mock('firebase/functions', () => ({ httpsCallable: () => state.callable }));
const input = { userId: 'alice', schoolId: 'pu', query: '從圖書館到活動中心' };
const execute = {
  ...input,
  requestId: 'request-one',
  consent: {
    provider: 'groq' as const,
    version: 1 as const,
    schoolId: 'pu',
    query: input.query,
    fingerprint: 'a'.repeat(64),
  },
};
const common = {
  provider: 'groq',
  model: 'openai/gpt-oss-120b',
  schoolId: 'pu',
  checkedAt: '2026-11-01T15:00:00.000Z',
  sourceUpdatedAt: null,
};
const preview = {
  ...common,
  status: 'preview',
  query: input.query,
  fingerprint: 'a'.repeat(64),
  cloudReady: true,
  places: [
    { ref: 'p0', name: '圖書館', category: '圖書館', aliases: ['總圖'] },
    { ref: 'p1', name: '活動中心', category: '', aliases: [] },
  ],
};
const completed = {
  ...common,
  status: 'completed',
  route: {
    from: { id: 'library', schoolId: 'pu', name: '圖書館', lat: 24, lng: 120 },
    to: { id: 'hall', schoolId: 'pu', name: '活動中心', lat: 24.1, lng: 120.1 },
    navigationUrl:
      'https://www.google.com/maps/dir/?api=1&origin=24%2C120&destination=24.1%2C120.1&travelmode=walking',
  },
};
beforeEach(() => {
  state.uid = 'alice';
  state.configured = true;
  state.callable.mockReset();
});

it('sends only the public preview request, never uid, history or profile', async () => {
  state.callable.mockResolvedValue({ data: { ...preview, privateProfile: 'discarded' } });
  await expect(getCloudNavigationPreview(input)).resolves.toEqual(preview);
  expect(state.callable).toHaveBeenCalledWith({
    task: 'public-campus-navigation',
    phase: 'preview',
    schoolId: 'pu',
    query: input.query,
  });
});
it('sends exact consent and accepts a verified route only', async () => {
  state.callable.mockResolvedValue({ data: completed });
  await expect(runCloudNavigationTask(execute)).resolves.toEqual(completed);
  expect(state.callable).toHaveBeenCalledWith({
    task: 'public-campus-navigation',
    phase: 'execute',
    schoolId: 'pu',
    query: input.query,
    requestId: execute.requestId,
    consent: execute.consent,
  });
});
it.each([
  { ...execute, consent: { ...execute.consent, schoolId: 'other' } },
  { ...execute, consent: { ...execute.consent, query: '其他問題' } },
  { ...execute, consent: { ...execute.consent, fingerprint: 'not-a-digest' } },
  { ...execute, requestId: '' },
])('rejects changed or missing consent before invoking the server %#', async (request) => {
  await expect(runCloudNavigationTask(request)).rejects.toMatchObject({ code: 'invalid-response' });
  expect(state.callable).not.toHaveBeenCalled();
});
it.each([
  { ...preview, provider: 'ollama' },
  { ...preview, model: 'paid-model' },
  { ...preview, schoolId: 'other' },
  { ...preview, query: '其他輸入' },
  { ...preview, sourceUpdatedAt: 'unknown' },
  { ...preview, checkedAt: 'today' },
  { ...preview, fingerprint: '' },
  { ...preview, places: [] },
  { ...preview, places: [preview.places[0], preview.places[0]] },
  { ...preview, places: [{ ...preview.places[0], aliases: ['x'.repeat(61)] }, preview.places[1]] },
])('rejects an untrusted preview %#', async (data) => {
  state.callable.mockResolvedValue({ data });
  await expect(getCloudNavigationPreview(input)).rejects.toMatchObject({
    code: 'invalid-response',
  });
});
it.each([
  { ...completed, provider: 'gemini' },
  { ...completed, route: { ...completed.route, navigationUrl: 'https://evil.test' } },
  {
    ...completed,
    route: { ...completed.route, navigationUrl: `${completed.route.navigationUrl}&origin=25,121` },
  },
  {
    ...completed,
    route: { ...completed.route, from: { ...completed.route.from, schoolId: 'other' } },
  },
  { ...completed, route: { ...completed.route, from: { ...completed.route.from, lat: 95 } } },
  preview,
])('rejects malformed or cross-scope execution receipts %#', async (data) => {
  state.callable.mockResolvedValue({ data });
  await expect(runCloudNavigationTask(execute)).rejects.toMatchObject({ code: 'invalid-response' });
});
it('retains quota failure without manufacturing a route', async () => {
  const failure = {
    status: 'unavailable',
    provider: 'groq',
    schoolId: 'pu',
    checkedAt: common.checkedAt,
    reason: 'rate_limited',
    retryAfterSeconds: 60,
  };
  state.callable.mockResolvedValue({ data: failure });
  await expect(runCloudNavigationTask(execute)).resolves.toEqual(failure);
});
it.each([
  { uid: 'bob', configured: true, code: 'session-changed' },
  { uid: 'alice', configured: false, code: 'unconfigured' },
])('rejects invalid account/config before reading anything %#', async (values) => {
  Object.assign(state, values);
  await expect(getCloudNavigationPreview(input)).rejects.toMatchObject({ code: values.code });
  expect(state.callable).not.toHaveBeenCalled();
});
it('rejects a late result after the signed-in account changes', async () => {
  let finish!: (value: { data: unknown }) => void;
  state.callable.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const result = runCloudNavigationTask(execute);
  state.uid = 'bob';
  finish({ data: completed });
  await expect(result).rejects.toMatchObject({ code: 'session-changed' });
});
it('stops waiting promptly on cancel and ignores a late receipt', async () => {
  let finish!: (value: { data: unknown }) => void;
  state.callable.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const controller = new AbortController();
  const result = runCloudNavigationTask(execute, controller.signal);
  controller.abort();
  await expect(result).rejects.toMatchObject({ name: 'AbortError' });
  finish({ data: completed });
  await Promise.resolve();
});
it('does not invoke the server when canceled before dispatch', async () => {
  const controller = new AbortController();
  controller.abort();
  await expect(getCloudNavigationPreview(input, controller.signal)).rejects.toMatchObject({
    name: 'AbortError',
  });
  expect(state.callable).not.toHaveBeenCalled();
});
