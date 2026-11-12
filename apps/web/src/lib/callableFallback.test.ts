import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { callWithHostedFallback, isCallableMissing } from './callableFallback';
import { FunctionsUnconfiguredError } from './functionsUrl';

const runtime = vi.hoisted(() => ({
  configured: true, uid: 'alice', invoke: vi.fn(), callable: vi.fn(), token: vi.fn(), fetch: vi.fn(),
}));
vi.mock('./cloudFunctions', () => ({ areFunctionsConfigured: () => runtime.configured }));
vi.mock('./firebase', () => ({
  getAuth: () => ({ currentUser: { uid: runtime.uid, getIdToken: runtime.token } }),
  getFunctionsInstance: () => 'functions',
}));
vi.mock('firebase/functions', () => ({ httpsCallable: runtime.callable }));
beforeEach(() => {
  vi.resetAllMocks();
  runtime.configured = true;
  runtime.uid = 'alice';
  runtime.callable.mockReturnValue(runtime.invoke);
  runtime.token.mockResolvedValue('fake-id-token');
  runtime.fetch.mockResolvedValue({ ok: true, json: async () => ({ result: { receipt: true } }) });
  vi.stubGlobal('fetch', runtime.fetch);
});
afterEach(() => vi.unstubAllGlobals());
const names = ['prepareDmConversation', 'sendDmText', 'replyToCampusStory'] as const;
it.each(names)('%s calls only Firebase when deployed', async (name) => {
  runtime.invoke.mockResolvedValue({ data: { receipt: true } });
  await expect(callWithHostedFallback(name, { viewerUid: 'alice' }, 'alice')).resolves.toEqual({ data: { receipt: true } });
  expect(runtime.callable).toHaveBeenCalledWith('functions', name);
  expect(runtime.fetch).not.toHaveBeenCalled();
});
it.each(names)('%s still tries Firebase first without a custom Functions URL, then posts hosted', async (name) => {
  runtime.configured = false;
  runtime.invoke.mockRejectedValueOnce({ code: 'functions/not-found' });
  await expect(callWithHostedFallback(name, { viewerUid: 'alice' }, 'alice')).resolves.toEqual({ data: { receipt: true } });
  expect(runtime.callable).toHaveBeenCalledWith('functions', name);
  expect(runtime.fetch).toHaveBeenCalledWith('/api/fn/' + name, expect.objectContaining({
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer fake-id-token' },
    body: JSON.stringify({ data: { viewerUid: 'alice' } }),
  }));
});
it.each([
  { code: 'functions/not-found' }, { code: 'functions/unconfigured' },
  new FunctionsUnconfiguredError(), { status: 404 }, { code: 'NOT_FOUND' }, { response: { status: 404 } },
])('falls back only on a missing callable: %j', async (error) => {
  runtime.invoke.mockRejectedValue(error);
  await expect(callWithHostedFallback('sendDmText', {}, 'alice')).resolves.toEqual({ data: { receipt: true } });
  expect(runtime.fetch).toHaveBeenCalledTimes(1);
});
it.each([
  'functions/permission-denied', 'functions/unauthenticated', 'functions/already-exists',
  'functions/invalid-argument', 'functions/internal', 'functions/unavailable', 'network-error', 'unconfigured',
])('never falls back for %s', async (code) => {
  const error = { code };
  runtime.invoke.mockRejectedValue(error);
  await expect(callWithHostedFallback('sendDmText', {}, 'alice')).rejects.toBe(error);
  expect(isCallableMissing(error)).toBe(false);
  expect(runtime.fetch).not.toHaveBeenCalled();
});
it('preserves hosted permission error codes', async () => {
  runtime.invoke.mockRejectedValueOnce({ code: 'functions/not-found' });
  runtime.fetch.mockResolvedValue({ ok: false, json: async () => ({ error: { status: 'PERMISSION_DENIED', message: '拒絕' } }) });
  await expect(callWithHostedFallback('sendDmText', {}, 'alice')).rejects.toMatchObject({ code: 'functions/permission-denied', message: '拒絕' });
});
it('checks abort and account again after fetching the token', async () => {
  runtime.invoke.mockRejectedValue({ code: 'functions/not-found' });
  const controller = new AbortController();
  runtime.token.mockImplementationOnce(async () => { controller.abort(); return 'fake'; });
  await expect(callWithHostedFallback('sendDmText', {}, 'alice', controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
  expect(runtime.fetch).not.toHaveBeenCalled();
  runtime.token.mockImplementationOnce(async () => { runtime.uid = 'bob'; return 'fake'; });
  await expect(callWithHostedFallback('sendDmText', {}, 'alice')).rejects.toMatchObject({ code: 'functions/unauthenticated' });
  expect(runtime.fetch).not.toHaveBeenCalled();
});
