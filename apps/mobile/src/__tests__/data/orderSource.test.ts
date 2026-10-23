import { createOrderThroughServer } from '../../data/orderSource';
import type { CreateOrderInput } from '../../data/source';
let mockUid: string | null = 'alice';
let mockMode = false;
const mockCall = jest.fn(),
  mockRead = jest.fn();
jest.mock('../../firebase', () => ({
  getAuthInstance: () => ({ currentUser: mockUid ? { uid: mockUid } : null }),
  getDb: () => ({}),
  getFunctionsInstance: () => ({}),
  isFirebaseMockMode: () => mockMode,
}));
jest.mock('firebase/firestore', () => ({
  doc: (_: unknown, ...parts: string[]) => parts.join('/'),
  getDocFromServer: (...args: unknown[]) => mockRead(...args),
}));
jest.mock('firebase/functions', () => ({ httpsCallable: () => mockCall }));
const input: CreateOrderInput = {
  userId: 'alice',
  schoolId: 'pu',
  cafeteriaId: 'cafe',
  requestId: 'persisted-intent',
  expectedTotal: 105,
  paymentMethod: 'onsite',
  items: [{ menuItemId: 'rice', name: 'Untrusted name', price: 0, quantity: 1 }],
};
const response = {
  success: true,
  userId: 'alice',
  schoolId: 'pu',
  cafeteriaId: 'cafe',
  requestId: 'persisted-intent',
  orderId: 'co-server-id',
  total: 105,
};
const receipt = () => ({
  ...response,
  schemaVersion: 2,
  currency: 'TWD',
  items: [{ menuItemId: 'rice', name: 'Source rice', price: 100, quantity: 1 }],
  status: 'pending',
  paymentStatus: 'pending',
  createdAt: { toDate: () => new Date('2026-10-08T00:00:00Z') },
});
const resolveSchool = jest.fn();
beforeEach(() => {
  jest.clearAllMocks();
  mockUid = 'alice';
  mockMode = false;
  resolveSchool.mockResolvedValue('pu');
  mockCall.mockResolvedValue({ data: response });
  mockRead.mockResolvedValue({ exists: () => true, data: receipt });
});
test('sends a fixed key with item identifiers and confirmed total, returning the durable owner receipt', async () => {
  const result = await createOrderThroughServer(input, resolveSchool);
  expect(mockCall).toHaveBeenCalledWith({
    userId: 'alice',
    schoolId: 'pu',
    cafeteriaId: 'cafe',
    requestId: 'persisted-intent',
    items: [{ menuItemId: 'rice', quantity: 1 }],
    expectedTotal: 105,
    paymentMethod: 'onsite',
  });
  expect(mockRead).toHaveBeenCalledWith('users/alice/schools/pu/orders/co-server-id');
  expect(result).toMatchObject({
    id: 'co-server-id',
    userId: 'alice',
    items: [{ name: 'Source rice', price: 100 }],
    createdAt: '2026-10-08T00:00:00.000Z',
  });
});
test('rejects missing keys and mock runtime before calling the service', async () => {
  await expect(
    createOrderThroughServer({ ...input, requestId: undefined }, resolveSchool),
  ).rejects.toThrow('送出編號');
  mockMode = true;
  await expect(createOrderThroughServer(input, resolveSchool)).rejects.toThrow('登入狀態');
  expect(mockCall).not.toHaveBeenCalled();
});
test('propagates uncertain failures and keeps the same key for an explicit retry', async () => {
  const failure = new Error('network unknown');
  mockCall.mockRejectedValueOnce(failure);
  await expect(createOrderThroughServer(input, resolveSchool)).rejects.toBe(failure);
  await createOrderThroughServer(input, resolveSchool);
  expect(mockCall.mock.calls.map(([data]) => data.requestId)).toEqual([
    'persisted-intent',
    'persisted-intent',
  ]);
});
test('checks account ownership again after resolving the school', async () => {
  resolveSchool.mockImplementation(async () => {
    mockUid = 'bob';
    return 'pu';
  });
  await expect(createOrderThroughServer(input, resolveSchool)).rejects.toThrow('登入狀態');
  expect(mockCall).not.toHaveBeenCalled();
});
test('does not show a previous account receipt after switching during the callable', async () => {
  mockCall.mockImplementation(async () => {
    mockUid = 'bob';
    return { data: response };
  });
  await expect(createOrderThroughServer(input, resolveSchool)).rejects.toThrow('登入狀態');
  expect(mockRead).not.toHaveBeenCalled();
});
test.each([
  { userId: 'bob' },
  { schoolId: 'other' },
  { requestId: 'another' },
  { total: 1 },
  { createdAt: null },
])('rejects mismatched or incomplete durable receipts: %j', async (patch) => {
  mockRead.mockResolvedValue({ exists: () => true, data: () => ({ ...receipt(), ...patch }) });
  await expect(createOrderThroughServer(input, resolveSchool)).rejects.toThrow();
});
test('a missing or unavailable readback is not treated as a successful order', async () => {
  mockRead.mockResolvedValueOnce({ exists: () => false });
  await expect(createOrderThroughServer(input, resolveSchool)).rejects.toThrow('尚未確認');
  mockRead.mockRejectedValueOnce(new Error('unavailable'));
  await expect(createOrderThroughServer(input, resolveSchool)).rejects.toThrow('unavailable');
});
