import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { loadSchoolCreditOverview } from './schoolCreditOverview';

const { auth, fetchMock, getIdToken } = vi.hoisted(() => {
  const getIdToken = vi.fn(async () => 'account-token');
  return { getIdToken, fetchMock: vi.fn(), auth: { currentUser: { uid: 'a', getIdToken } as { uid: string; getIdToken: () => Promise<string> } | null } };
});
vi.mock('./firebase', () => ({ getAuth: () => auth, isFirebaseConfigured: () => true,
  getCloudFunctionUrl: (name: string) => `/api/fn/${name}` }));
const overview = () => ({ version: 1, source: 'pu-credit-review',
  totals: { required: 40.5, elective: 20, externalElective: 3, generalOld: 0, generalNew: 8, subtotal: 71.5, totalRequired: 128, minorDouble: null },
  coverage: { status: 'partial', missingFields: ['minorDouble'] } });
const snapshot = () => ({ success: true, ownerUid: 'a', schoolId: 'pu', source: 'pu-campus',
  dataType: 'creditOverview', fetchedAt: '2026-10-28T00:00:00Z', result: { success: true, creditOverview: overview() } });
const reply = (value: unknown = snapshot()) => new Response(JSON.stringify({ result: value }), { status: 200 });
beforeEach(() => { vi.clearAllMocks(); vi.stubGlobal('fetch', fetchMock); auth.currentUser = { uid: 'a', getIdToken };
  getIdToken.mockResolvedValue('account-token'); fetchMock.mockImplementation(async () => reply()); });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

it('reads only the requested school credit overview with a Firebase token and preserves its timestamp', async () => {
  const result = await loadSchoolCreditOverview('a', 'pu');
  expect(result.overview.totals).toEqual(overview().totals);
  expect(result.fetchedAt).toBe('2026-10-28T00:00:00Z');
  expect(fetchMock).toHaveBeenCalledWith('/api/fn/getMyAcademicRecords', expect.objectContaining({
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer account-token' },
    body: JSON.stringify({ data: { dataType: 'creditOverview' } }), cache: 'no-store',
  }));
});
it.each([{ ownerUid: 'b' }, { schoolId: 'other' }, { source: 'cache' }, { dataType: 'grades' }, { fetchedAt: 'invalid' },
  { result: { success: true, creditOverview: { ...overview(), source: 'derived-from-grade-rows' } } }])('rejects mismatched or malformed school data %j', async (change) => {
  fetchMock.mockResolvedValueOnce(reply({ ...snapshot(), ...change }));
  await expect(loadSchoolCreditOverview('a', 'pu')).rejects.toMatchObject({ reason: 'unavailable' });
});
it('does not query another school or a different current account', async () => {
  await expect(loadSchoolCreditOverview('a', 'nthu')).rejects.toMatchObject({ reason: 'unavailable' });
  await expect(loadSchoolCreditOverview('b', 'pu')).rejects.toMatchObject({ reason: 'reconnect' });
  auth.currentUser = null;
  await expect(loadSchoolCreditOverview('a', 'pu')).rejects.toMatchObject({ reason: 'reconnect' });
  expect(fetchMock).not.toHaveBeenCalled();
});
it('rejects a same-UID new principal while the token is pending without sending a request', async () => {
  let finishToken!: (token: string) => void;
  getIdToken.mockImplementationOnce(() => new Promise((resolve) => { finishToken = resolve; }));
  const result = loadSchoolCreditOverview('a', 'pu');
  const rejected = expect(result).rejects.toMatchObject({ reason: 'reconnect' });
  auth.currentUser = { uid: 'a', getIdToken };
  finishToken('previous-login-token');
  await rejected;
  expect(fetchMock).not.toHaveBeenCalled();
});
it('discards data when a same-UID re-login replaced the captured Firebase user', async () => {
  fetchMock.mockImplementationOnce(async () => {
    auth.currentUser = { uid: 'a', getIdToken };
    return reply();
  });
  await expect(loadSchoolCreditOverview('a', 'pu')).rejects.toMatchObject({ reason: 'reconnect' });
});
it('preserves an expired school session as an actionable reconnect error', async () => {
  fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: { status: 'FAILED_PRECONDITION' } }), { status: 400 }));
  await expect(loadSchoolCreditOverview('a', 'pu')).rejects.toMatchObject({ reason: 'reconnect' });
});
it('applies the existing whole-read deadline even before the Firebase token resolves', async () => {
  vi.useFakeTimers();
  getIdToken.mockImplementationOnce(() => new Promise(() => {}));
  const result = loadSchoolCreditOverview('a', 'pu');
  const failed = expect(result).rejects.toMatchObject({ reason: 'unavailable' });
  await vi.advanceTimersByTimeAsync(45_000);
  await failed;
  expect(fetchMock).not.toHaveBeenCalled();
});
