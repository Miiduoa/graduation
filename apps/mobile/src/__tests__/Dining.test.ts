import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import { getDocFromServer, getDocsFromServer } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { getAuthInstance } from '../firebase';
import {
  loadDiningCatalog,
  loadDiningIntent,
  prepareDiningIntent,
  submitDiningIntent,
  readDiningReceipt,
  diningTotal,
  clearDiningIntent,
} from '../features/dining';
import type { DiningIntent, DiningMenu } from '../features/dining';

jest.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...parts: string[]) => parts.join('/'),
  doc: (_db: unknown, ...parts: string[]) => parts.join('/'),
  getDocFromServer: jest.fn(),
  getDocsFromServer: jest.fn(),
}));
jest.mock('firebase/functions', () => ({ httpsCallable: jest.fn() }));
jest.mock('../firebase', () => ({
  getAuthInstance: jest.fn(),
  getDb: () => 'db',
  getFunctionsInstance: () => 'functions',
  isFirebaseMockMode: () => false,
}));
jest.mock('expo-crypto', () => ({
  randomUUID: jest.fn(() => 'uuid-a'),
  CryptoDigestAlgorithm: { SHA256: 'SHA256' },
  digestStringAsync: jest.fn(async () => 'hash-a'),
}));
const scope = { userId: 'student-a', schoolId: 'pu' };
const menu: DiningMenu = {
  id: 'meal-a',
  cafeteriaId: 'venue-a',
  name: '今日餐點',
  price: 80,
  description: '',
  orderable: true,
};
const intent: DiningIntent = {
  ...scope,
  requestId: 'uuid-a',
  orderId: 'co_hash-a',
  cafeteriaId: 'venue-a',
  items: [{ menuItemId: 'meal-a', quantity: 1 }],
  expectedTotal: 84,
  label: menu.name,
};
const receipt = {
  schemaVersion: 2,
  ...intent,
  items: [{ menuItemId: 'meal-a', name: menu.name, quantity: 1, price: 80 }],
  total: 84,
  paymentMethod: 'onsite',
  paymentStatus: 'pending',
  currency: 'TWD',
  status: 'pending',
};
const call = jest.fn();
const document = (data: Record<string, unknown> | null) => ({
  exists: () => data !== null,
  data: () => data,
});
const rows = (data: Array<[string, Record<string, unknown>]>) => ({
  empty: data.length === 0,
  docs: data.map(([id, value]) => ({ id, data: () => value })),
});
beforeEach(async () => {
  jest.clearAllMocks();
  jest.mocked(Crypto.randomUUID).mockReturnValue('uuid-a');
  await AsyncStorage.clear();
  jest.mocked(getAuthInstance).mockReturnValue({ currentUser: { uid: scope.userId } } as never);
  jest
    .mocked(getDocsFromServer)
    .mockImplementation(
      async (path) =>
        (String(path).endsWith('/cafeterias')
          ? rows([['venue-a', { name: '學校餐廳', pilotStatus: 'live', orderingEnabled: true }]])
          : rows([['meal-a', { ...menu, available: true, orderingEnabled: true }]])) as never,
    );
  jest.mocked(getDocFromServer).mockResolvedValue(document(null) as never);
  jest.mocked(httpsCallable).mockReturnValue(call);
  call.mockImplementation(async () => {
    jest.mocked(getDocFromServer).mockResolvedValue(document(receipt) as never);
    return { data: { success: true, orderId: intent.orderId } };
  });
});
test('loads only school-scoped canonical records without curated/sample fallbacks', async () => {
  const result = await loadDiningCatalog(scope, () => true);
  expect(result.menus[0]).toMatchObject({ name: menu.name, orderable: true });
  expect(getDocsFromServer).toHaveBeenCalledWith('schools/pu/menus');
  expect(getDocsFromServer).toHaveBeenCalledWith('schools/pu/cafeterias');
});
test('source failures remain failures instead of becoming curated menus', async () => {
  jest.mocked(getDocsFromServer).mockRejectedValueOnce(new Error('offline'));
  await expect(loadDiningCatalog(scope, () => true)).rejects.toThrow('offline');
});
test.each([
  { available: false },
  { available: undefined },
  { orderingEnabled: false },
  { soldOut: true },
  { cafeteriaId: 'other' },
  { price: undefined },
])('does not allow ordering a menu missing a real sellable state: %p', async (change) => {
  jest
    .mocked(getDocsFromServer)
    .mockResolvedValueOnce(
      rows([['venue-a', { name: '店家', pilotStatus: 'live', orderingEnabled: true }]]) as never,
    )
    .mockResolvedValueOnce(
      rows([['meal-a', { ...menu, available: true, orderingEnabled: true, ...change }]]) as never,
    );
  expect((await loadDiningCatalog(scope, () => true)).menus[0].orderable).toBe(false);
});
test('a pilot merchant never appears as a live ordering merchant', async () => {
  jest
    .mocked(getDocsFromServer)
    .mockResolvedValueOnce(
      rows([['venue-a', { name: '店家', pilotStatus: 'pilot', orderingEnabled: true }]]) as never,
    );
  expect((await loadDiningCatalog(scope, () => true)).menus[0].orderable).toBe(false);
});
test('an empty canonical menu uses only the scoped alias and preserves empty results', async () => {
  jest.mocked(getDocsFromServer).mockResolvedValue(rows([]) as never);
  await expect(loadDiningCatalog(scope, () => true)).resolves.toEqual({ menus: [], venues: [] });
  expect(getDocsFromServer).toHaveBeenCalledWith('schools/pu/cafeteriaMenus');
});
test('persists one request identifier before sending, and refuses to overwrite an unresolved request', async () => {
  const saved = await prepareDiningIntent(scope, menu, () => true);
  expect(saved).toEqual(intent);
  expect(await loadDiningIntent(scope, () => true)).toEqual(intent);
  expect(call).not.toHaveBeenCalled();
  await expect(prepareDiningIntent(scope, menu, () => true)).rejects.toThrow('上一筆');
});
test('sends the captured owner, menu IDs, quantity and expected total, then requires a matching stored receipt', async () => {
  const saved = await prepareDiningIntent(scope, menu, () => true);
  await expect(submitDiningIntent(saved, () => true)).resolves.toMatchObject({
    id: intent.orderId,
    status: 'pending',
    total: 84,
  });
  expect(call).toHaveBeenCalledWith({
    userId: 'student-a',
    schoolId: 'pu',
    cafeteriaId: 'venue-a',
    requestId: 'uuid-a',
    items: [{ menuItemId: 'meal-a', quantity: 1 }],
    expectedTotal: 84,
    paymentMethod: 'onsite',
  });
  expect(await loadDiningIntent(scope, () => true)).toBeNull();
});
test('a matching existing receipt is returned without another callable write', async () => {
  jest.mocked(getDocFromServer).mockResolvedValue(document(receipt) as never);
  await expect(submitDiningIntent(intent, () => true)).resolves.toMatchObject({ total: 84 });
  expect(call).not.toHaveBeenCalled();
});
test('ambiguous network outcome preserves the request across a remount and retries the same identifier', async () => {
  await prepareDiningIntent(scope, menu, () => true);
  call.mockRejectedValueOnce(new Error('connection lost'));
  await expect(submitDiningIntent(intent, () => true)).rejects.toMatchObject({ kind: 'unknown' });
  const recovered = await loadDiningIntent(scope, () => true);
  expect(recovered?.requestId).toBe(intent.requestId);
  await submitDiningIntent(recovered!, () => true);
  expect(call.mock.calls.map(([input]) => input.requestId)).toEqual(['uuid-a', 'uuid-a']);
});
test('a lost response followed by a stored receipt does not create a second order on retry', async () => {
  await prepareDiningIntent(scope, menu, () => true);
  call.mockImplementationOnce(async () => {
    jest.mocked(getDocFromServer).mockResolvedValue(document(receipt) as never);
    throw new Error('response lost');
  });
  await expect(submitDiningIntent(intent, () => true)).rejects.toMatchObject({ kind: 'unknown' });
  await submitDiningIntent((await loadDiningIntent(scope, () => true))!, () => true);
  expect(call).toHaveBeenCalledTimes(1);
});
test.each([
  { userId: 'other' },
  { requestId: 'other' },
  { total: 1 },
  { paymentMethod: 'online' },
  { currency: 'USD' },
  { items: [{ menuItemId: 'other', quantity: 1 }] },
])('rejects mismatched receipt %p without declaring success', async (change) => {
  jest.mocked(getDocFromServer).mockResolvedValue(document({ ...receipt, ...change }) as never);
  await expect(readDiningReceipt(intent, () => true)).rejects.toMatchObject({ kind: 'unknown' });
});
test('Firestore read permission failure preserves the unresolved request', async () => {
  await prepareDiningIntent(scope, menu, () => true);
  jest.mocked(getDocFromServer).mockRejectedValueOnce({ code: 'permission-denied' });
  await expect(submitDiningIntent(intent, () => true)).rejects.toMatchObject({ kind: 'unknown' });
  expect(await loadDiningIntent(scope, () => true)).toEqual(intent);
  expect(call).not.toHaveBeenCalled();
});
test('server-confirmed price or availability rejection clears the unsent draft for a new review', async () => {
  await prepareDiningIntent(scope, menu, () => true);
  call.mockRejectedValueOnce({
    code: 'functions/failed-precondition',
    details: { orderOutcome: 'not_created' },
  });
  await expect(submitDiningIntent(intent, () => true)).rejects.toMatchObject({ kind: 'not-sent' });
  expect(await loadDiningIntent(scope, () => true)).toBeNull();
});
test('account change during a pending call rejects its reply and leaves the original scope recovery marker', async () => {
  await prepareDiningIntent(scope, menu, () => true);
  call.mockImplementationOnce(async () => {
    jest.mocked(getAuthInstance).mockReturnValue({ currentUser: { uid: 'b' } } as never);
    return { data: {} };
  });
  await expect(submitDiningIntent(intent, () => true)).rejects.toThrow('登入狀態');
});
test('binds the request to the original owner when the callable resolves a different account token', async () => {
  await prepareDiningIntent(scope, menu, () => true);
  const write = jest.fn();
  call.mockImplementationOnce(async (payload) => {
    await Promise.resolve();
    jest.mocked(getAuthInstance).mockReturnValue({ currentUser: { uid: 'student-b' } } as never);
    const authenticatedUid = getAuthInstance().currentUser?.uid;
    if (payload.userId !== authenticatedUid) throw { code: 'functions/permission-denied' };
    write(authenticatedUid, payload);
    return { data: {} };
  });
  await expect(submitDiningIntent(intent, () => true)).rejects.toThrow('登入狀態');
  expect(call).toHaveBeenCalledWith(expect.objectContaining({ userId: 'student-a' }));
  expect(write).not.toHaveBeenCalled();
  jest.mocked(getAuthInstance).mockReturnValue({ currentUser: { uid: scope.userId } } as never);
  expect(await loadDiningIntent(scope, () => true)).toEqual(intent);
});
test('simultaneous screen instances preserve exactly one unresolved intent', async () => {
  const outcomes = await Promise.allSettled([
    prepareDiningIntent(scope, menu, () => true),
    prepareDiningIntent(scope, { ...menu, id: 'meal-b' }, () => true),
  ]);
  expect(outcomes[0]).toEqual({ status: 'fulfilled', value: intent });
  expect(outcomes[1]).toMatchObject({ status: 'rejected', reason: { kind: 'unknown' } });
  expect(await loadDiningIntent(scope, () => true)).toEqual(intent);
  expect(Crypto.randomUUID).toHaveBeenCalledTimes(1);
  expect(AsyncStorage.setItem).toHaveBeenCalledTimes(1);
});
test('a late receipt for an older request does not remove a newer pending intent', async () => {
  const older = await prepareDiningIntent(scope, menu, () => true);
  await clearDiningIntent(older);
  jest.mocked(Crypto.randomUUID).mockReturnValueOnce('uuid-b');
  const newer = await prepareDiningIntent(scope, { ...menu, id: 'meal-b' }, () => true);
  await clearDiningIntent(older);
  expect(await loadDiningIntent(scope, () => true)).toEqual(newer);
  expect(newer.requestId).toBe('uuid-b');
  await clearDiningIntent(newer);
  expect(await loadDiningIntent(scope, () => true)).toBeNull();
});
test('the displayed total matches the backend tax calculation', () => {
  expect(diningTotal(95)).toEqual({ subtotal: 95, tax: 5, total: 100 });
});

test('a failed-precondition without a not-created receipt marker retains the original request', async () => {
  await prepareDiningIntent(scope, menu, () => true);
  call.mockRejectedValueOnce({ code: 'functions/failed-precondition' });
  await expect(submitDiningIntent(intent, () => true)).rejects.toMatchObject({ kind: 'unknown' });
  expect(await loadDiningIntent(scope, () => true)).toEqual(intent);
});

test('receipt identifier uses the same UID NUL request boundary as the backend', async () => {
  await prepareDiningIntent(scope, menu, () => true);
  expect(Crypto.digestStringAsync).toHaveBeenCalledWith('SHA256', 'student-a\u0000uuid-a');
});

test('fractional menu prices keep the same cent calculation as the backend', () => {
  expect(diningTotal(80.13)).toEqual({ subtotal: 80.13, tax: 4, total: 84.13 });
});
