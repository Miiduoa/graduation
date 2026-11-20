import { act, renderHook, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { NuniSessionProvider, useNuniSession } from '../state/nuniSession';
import { NuniDraftProvider, useNuniDraftScope, useNuniDraftState } from '../state/nuniDrafts';
import { nuniPlatformRequest } from '../services/nuniClient';
import {
  beginSavedCampusPlansSignOutCleanup,
  createSavedCampusPlanSession,
  endSavedCampusPlansSignOutCleanup,
  readSavedCampusPlans,
  saveCampusPlan,
  savedCampusPlansStorageKey,
} from '../services/savedCampusPlans';
import type { CampusEvidencePlan } from '../services/offlineCampusPlanner';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(), setItem: jest.fn(), removeItem: jest.fn(),
    getAllKeys: jest.fn(), multiRemove: jest.fn(),
  },
}));
jest.mock('expo-secure-store', () => ({
  isAvailableAsync: jest.fn(async () => true),
  getItemAsync: jest.fn(), setItemAsync: jest.fn(), deleteItemAsync: jest.fn(),
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 'device-only',
}));
jest.mock('../services/nuniClient', () => ({
  ...jest.requireActual('../services/nuniClient'),
  nuniPlatformRequest: jest.fn(),
}));
jest.mock('../services/nuniGoogle', () => ({
  requestGoogleCredential: jest.fn(), clearGoogleCredentialState: jest.fn(async () => {}),
}));
jest.mock('../services/nuniAssignmentReminders', () => ({
  retainNuniAssignmentReminders: jest.fn(async () => {}),
  cancelSubmittedNuniAssignmentReminder: jest.fn(async () => {}),
}));
let mockUuid = 0;
jest.mock('expo-crypto', () => ({
  randomUUID: () => `00000000-0000-4000-8000-${String(++mockUuid).padStart(12, '0')}`,
}));

const account = 'pa_11111111-1111-4111-8111-111111111111';
const handle = `ps_${'a'.repeat(43)}`;
const key = 'campus-one.nuni.native-session.v1';
const scope = { owner: `nuni:${account}`, schoolId: 'pu' };
const planKey = savedCampusPlansStorageKey(scope);
const persisted = new Map<string, string>();
let credential: string | null;
const plan: CampusEvidencePlan = {
  title: '今日課業計畫', overview: '依平台課程與作業整理。',
  checkedAt: '2026-11-06T01:00:00.000Z',
  steps: [{ id: 'assignment-0', title: '資料庫報告', detail: '開啟課程確認繳交狀態。',
    evidence: 'authorized-assignments', priority: 'urgent', route: '/classroom' }],
  limitations: ['尚未連接校務。'], content: '先確認資料庫報告期限。',
};
const request = jest.mocked(nuniPlatformRequest);
const write = jest.mocked(AsyncStorage.setItem);
const remove = jest.mocked(AsyncStorage.multiRemove);

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => { resolve = yes; });
  return { promise, resolve };
}
function restoreRemovals() {
  remove.mockReset().mockImplementation(async (keys) => { for (const item of keys) persisted.delete(item); });
}

beforeEach(() => {
  jest.clearAllMocks();
  persisted.clear();
  mockUuid = 0;
  credential = JSON.stringify({
    sessionHandle: handle, platformAccountId: account,
    expiresAt: Date.now() + 3_600_000, pendingLogout: false,
  });
  jest.mocked(SecureStore.getItemAsync).mockReset().mockImplementation(async () => credential);
  jest.mocked(SecureStore.setItemAsync).mockReset().mockImplementation(async (_key, value) => { credential = value; });
  jest.mocked(SecureStore.deleteItemAsync).mockReset().mockImplementation(async () => { credential = null; });
  jest.mocked(AsyncStorage.getItem).mockReset().mockImplementation(async (item) => persisted.get(item) ?? null);
  write.mockReset().mockImplementation(async (item, value) => { persisted.set(item, value); });
  jest.mocked(AsyncStorage.removeItem).mockReset().mockImplementation(async (item) => { persisted.delete(item); });
  jest.mocked(AsyncStorage.getAllKeys).mockReset().mockImplementation(async () => [...persisted.keys()]);
  restoreRemovals();
  request.mockReset().mockImplementation(async (path) => {
    if (path === 'sessions/current') return { authenticated: true, platformAccountId: account, isPlatformOperator: false };
    if (path === 'logout') return { signedOut: true };
    throw new Error(`Unexpected request: ${path}`);
  });
});

afterEach(async () => {
  restoreRemovals();
  await beginSavedCampusPlansSignOutCleanup();
  endSavedCampusPlansSignOutCleanup();
});

it('the real provider invalidates leases immediately and drains an in-flight saved-plan write before deleting it', async () => {
  const view = renderHook(useNuniSession, { wrapper: NuniSessionProvider });
  await waitFor(() => expect(view.result.current.session?.platformAccountId).toBe(account));
  const lease = createSavedCampusPlanSession(() => true);
  await saveCampusPlan(scope, { question: '安排今天', plan }, lease);
  const started = deferred<void>();
  const finish = deferred<void>();
  const persist = write.getMockImplementation()!;
  write.mockImplementation(async (item, value) => {
    if (item === planKey) {
      started.resolve();
      await finish.promise;
    }
    await persist(item, value);
  });
  const saving = saveCampusPlan(scope, { question: '再安排一次', plan }, lease);
  const rejected = expect(saving).rejects.toMatchObject({ code: 'session-changed' });
  await started.promise;
  let logout!: Promise<void>;
  act(() => {
    logout = view.result.current.logout();
    expect(lease()).toBe(false);
  });
  await waitFor(() => expect(request).toHaveBeenCalledWith('logout', handle, {}, expect.any(AbortSignal)));
  expect(persisted.has(planKey)).toBe(true);
  expect(view.result.current.pendingLogout).toBe(true);
  await act(async () => { finish.resolve(); await logout; await rejected; });
  expect(persisted.has(planKey)).toBe(false);
  expect(credential).toBeNull();
  expect(view.result.current.pendingLogout).toBe(false);
  expect(lease()).toBe(false);
  await expect(saveCampusPlan(scope, { question: '延遲回覆', plan }, lease))
    .rejects.toMatchObject({ code: 'session-changed' });
  expect(await readSavedCampusPlans(scope, createSavedCampusPlanSession(() => true))).toEqual([]);
});

it('keeps failed local cleanup visible and retryable after reopening the provider', async () => {
  const view = renderHook(useNuniSession, { wrapper: NuniSessionProvider });
  await waitFor(() => expect(view.result.current.session).not.toBeNull());
  const lease = createSavedCampusPlanSession(() => true);
  await saveCampusPlan(scope, { question: '規劃七天', plan }, lease);
  remove.mockRejectedValueOnce(new Error('disk unavailable'));
  await act(async () => { await view.result.current.logout(); });
  expect(view.result.current.error).toBe('手機內的已儲存計畫尚未清除，請重試登出。');
  expect(view.result.current.pendingLogout).toBe(true);
  expect(lease()).toBe(false);
  expect(persisted.has(planKey)).toBe(true);
  expect(persisted.get(`${key}.logout-pending`)).toBe('1');
  expect(JSON.parse(credential!).pendingLogout).toBe(true);
  expect(request).toHaveBeenCalledWith('logout', handle, {}, expect.any(AbortSignal));
  view.unmount();
  request.mockClear();
  const reopened = renderHook(useNuniSession, { wrapper: NuniSessionProvider });
  await waitFor(() => expect(reopened.result.current.loading).toBe(false));
  expect(reopened.result.current.pendingLogout).toBe(true);
  expect(reopened.result.current.session).toBeNull();
  expect(request).not.toHaveBeenCalled();
  await expect(reopened.result.current.signIn()).rejects.toMatchObject({ code: 'SIGN_OUT_REQUIRED' });
  await act(async () => { await reopened.result.current.logout(); });
  expect(reopened.result.current.pendingLogout).toBe(false);
  expect(reopened.result.current.error).toBe('');
  expect(persisted.has(planKey)).toBe(false);
  expect(persisted.has(`${key}.logout-pending`)).toBe(false);
  expect(credential).toBeNull();
});

it('clears saved plans for all stored campus scopes without deleting unrelated local preferences', async () => {
  const view = renderHook(useNuniSession, { wrapper: NuniSessionProvider });
  await waitFor(() => expect(view.result.current.session).not.toBeNull());
  const lease = createSavedCampusPlanSession(() => true);
  await saveCampusPlan(scope, { question: '目前學校', plan }, lease);
  const otherSchool = { ...scope, schoolId: 'nthu' };
  await saveCampusPlan(otherSchool, { question: '其他學校', plan }, lease);
  persisted.set('campus-theme', 'dark');
  await act(async () => { await view.result.current.logout(); });
  expect(persisted.has(planKey)).toBe(false);
  expect(persisted.has(savedCampusPlansStorageKey(otherSchool))).toBe(false);
  expect(persisted.get('campus-theme')).toBe('dark');
  expect(view.result.current.error).toBe('');
});

it('revokes a popped route setter at logout before React renders and without a workspace screen', async () => {
  const owner = renderHook(() => ({ auth: useNuniSession(), drafts: useNuniDraftScope()! }), {
    wrapper: NuniSessionProvider,
  });
  await waitFor(() => expect(owner.result.current.auth.session?.platformAccountId).toBe(account));
  const cache = owner.result.current.drafts.forAccount(account).cache;
  const editor = renderHook(() => useNuniDraftState('assignment:body', ''), {
    wrapper: ({ children }) => <NuniDraftProvider cache={cache}>{children}</NuniDraftProvider>,
  });
  const capturedSetter = editor.result.current[1];
  act(() => capturedSetter('只有此登入保留的內容'));
  let logout!: Promise<void>;
  act(() => {
    logout = owner.result.current.auth.logout();
    capturedSetter('登出後的晚到內容');
    expect(cache.get('assignment:body')).toBeUndefined();
    expect(cache.size).toBe(0);
  });
  await act(async () => logout);
  expect(owner.result.current.auth.session).toBeNull();
  expect([...persisted.values()].join('\n')).not.toContain('只有此登入保留的內容');
});

it('a new app session provider starts with no prior route input even for the same verified account', async () => {
  const useOwner = () => ({ auth: useNuniSession(), drafts: useNuniDraftScope()! });
  const first = renderHook(useOwner, { wrapper: NuniSessionProvider });
  await waitFor(() => expect(first.result.current.auth.session?.platformAccountId).toBe(account));
  const cache = first.result.current.drafts.forAccount(account).cache;
  cache.set('assignment:body', '不寫入裝置儲存空間的內容');
  cache.set('assignment:intent', { key: 'one-request', body: '不寫入裝置儲存空間的內容' });
  first.unmount();
  expect(cache.size).toBe(0);
  const reopened = renderHook(useOwner, { wrapper: NuniSessionProvider });
  await waitFor(() => expect(reopened.result.current.auth.session?.platformAccountId).toBe(account));
  const current = reopened.result.current.drafts.forAccount(account).cache;
  expect(current).not.toBe(cache);
  expect(current.has('assignment:body')).toBe(false);
  expect(current.has('assignment:intent')).toBe(false);
  expect([...persisted.values()].join('\n')).not.toContain('不寫入裝置儲存空間的內容');
});
