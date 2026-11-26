import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { invokeDormWorkflow } from './dormWorkflowClient';

const session = vi.hoisted(() => ({ uid: 'alice', getIdToken: vi.fn() }));
vi.mock('./firebase', () => ({
  getAuth: () => ({ currentUser: session.uid ? { uid: session.uid, getIdToken: session.getIdToken } : null }),
  getCloudFunctionUrl: () => '/api/fn/dormWorkflow',
}));
const request = { action: 'mine', schoolId: 'pu' };
beforeEach(() => {
  session.uid = 'alice';
  session.getIdToken.mockReset().mockResolvedValue('test-token');
  vi.stubGlobal('fetch', vi.fn());
});
afterEach(() => vi.unstubAllGlobals());

it('never dispatches under a new identity while an ID token is pending', async () => {
  let finish!: (value: string) => void;
  session.getIdToken.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  const reading = invokeDormWorkflow(request, 'alice');
  session.uid = 'bob';
  finish('old-token');
  await expect(reading).rejects.toThrow('請重新登入。');
  expect(fetch).not.toHaveBeenCalled();
});

it.each([200, 403])('discards a late HTTP %s response after the account changes', async (status) => {
  let finish!: (value: unknown) => void;
  vi.mocked(fetch).mockResolvedValue({
    ok: status === 200, status, json: () => new Promise((resolve) => { finish = resolve; }),
  } as Response);
  const reading = invokeDormWorkflow(request, 'alice');
  await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
  session.uid = 'bob';
  finish(status === 200 ? { result: { repairs: ['private'] } } : { error: { message: 'previous-account detail' } });
  await expect(reading).rejects.toThrow('請重新登入。');
});

it.each(['bob', undefined, null])('requires a matching screen identity before requesting a token', async (uid) => {
  await expect(invokeDormWorkflow(request, uid)).rejects.toThrow('請先登入。');
  expect(session.getIdToken).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
});
