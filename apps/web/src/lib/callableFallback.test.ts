import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { callWithHostedFallback, isCallableMissing } from './callableFallback';
import { FunctionsUnconfiguredError } from './functionsUrl';

const runtime = vi.hoisted(() => ({
  uid: 'alice', token: vi.fn(), fetch: vi.fn(),
}));
vi.mock('./firebase', () => ({
  getAuth: () => ({ currentUser: { uid: runtime.uid, getIdToken: runtime.token } }),
}));
beforeEach(() => {
  vi.resetAllMocks();
  runtime.uid = 'alice';
  runtime.token.mockResolvedValue('fake-id-token');
  runtime.fetch.mockResolvedValue({ ok: true, json: async () => ({ result: { receipt: true } }) });
  vi.stubGlobal('fetch', runtime.fetch);
});
afterEach(() => vi.unstubAllGlobals());
const names = ['prepareDmConversation', 'sendDmText', 'replyToCampusStory'] as const;
it.each(names)('%s posts only to same-origin /api/fn', async (name) => {
  await expect(callWithHostedFallback(name, { viewerUid: 'alice' }, 'alice')).resolves.toEqual({ data: { receipt: true } });
  expect(runtime.fetch).toHaveBeenCalledTimes(1);
  expect(runtime.fetch).toHaveBeenCalledWith('/api/fn/' + name, expect.objectContaining({
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer fake-id-token' },
    body: JSON.stringify({ data: { viewerUid: 'alice' } }),
  }));
});
it('preserves hosted permission error codes', async () => {
  runtime.fetch.mockResolvedValue({ ok: false, json: async () => ({ error: { status: 'PERMISSION_DENIED', message: '拒絕' } }) });
  await expect(callWithHostedFallback('sendDmText', {}, 'alice')).rejects.toMatchObject({
    code: 'functions/permission-denied',
    message: '拒絕',
  });
});
it('checks abort and account again after fetching the token', async () => {
  const controller = new AbortController();
  runtime.token.mockImplementationOnce(async () => { controller.abort(); return 'fake'; });
  await expect(callWithHostedFallback('sendDmText', {}, 'alice', controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
  expect(runtime.fetch).not.toHaveBeenCalled();
  runtime.token.mockImplementationOnce(async () => { runtime.uid = 'bob'; return 'fake'; });
  await expect(callWithHostedFallback('sendDmText', {}, 'alice')).rejects.toMatchObject({ code: 'functions/unauthenticated' });
  expect(runtime.fetch).not.toHaveBeenCalled();
});
it.each([
  new FunctionsUnconfiguredError(),
  { code: 'functions/not-found' },
  { status: 404 },
])('recognizes a missing callable: %j', (error) => {
  expect(isCallableMissing(error)).toBe(true);
});
it.each([
  'functions/permission-denied', 'functions/unauthenticated', 'functions/already-exists',
  'functions/invalid-argument', 'functions/internal', 'functions/unavailable', 'network-error', 'unconfigured',
])('does not treat %s as a missing callable', (code) => {
  expect(isCallableMissing({ code })).toBe(false);
});
