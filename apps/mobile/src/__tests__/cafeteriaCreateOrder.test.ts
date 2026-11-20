import AsyncStorage from '@react-native-async-storage/async-storage';

const mockCallable = jest.fn();
const mockGetDoc = jest.fn();
let mockMockMode = false;
jest.mock('../firebase', () => ({
  getDb: () => ({}),
  getFunctionsInstance: () => ({}),
  getAuthInstance: () => ({ currentUser: { uid: 'alice' } }),
  isFirebaseMockMode: () => mockMockMode,
}));
jest.mock('firebase/functions', () => ({ httpsCallable: () => mockCallable }));
jest.mock('firebase/firestore', () => ({
  collection: jest.fn(),
  doc: jest.fn((_db: unknown, ...path: string[]) => ({ path: path.join('/') })),
  query: jest.fn(),
  where: jest.fn(),
  orderBy: jest.fn(),
  limit: jest.fn(),
  getDocs: jest.fn(),
  getDoc: (...args: unknown[]) => mockGetDoc(...args),
  onSnapshot: jest.fn(),
}));

import {
  createOrder,
  OrderNotSentError,
  setOrderSchoolId,
  ORDER_NOT_SENT_TEXT,
} from '../services/cafeteriaData';

const input = {
  studentUid: 'alice',
  vendorId: 'cafe',
  cafeteriaId: 'cafe' as never,
  items: [
    { menuItemId: 'rice', menuItemName: '雞腿飯', quantity: 1, unitPrice: 95, selectedOptions: [], subtotal: 95 },
  ],
  totalPrice: 100,
  note: '',
  estimatedPickup: null,
};

beforeEach(async () => {
  mockMockMode = false;
  mockCallable.mockReset();
  mockGetDoc.mockReset();
  await AsyncStorage.clear();
  setOrderSchoolId('pu');
});

test('伺服器建單失敗：丟「訂單沒送出去，請再試一次。」，手機上不留任何訂單', async () => {
  mockCallable.mockRejectedValue(new Error('unavailable'));
  await expect(createOrder({ ...input, requestId: 'req-1' })).rejects.toMatchObject({
    name: 'OrderNotSentError',
    message: ORDER_NOT_SENT_TEXT,
    requestId: 'req-1',
  });
  expect(ORDER_NOT_SENT_TEXT).toBe('訂單沒送出去，請再試一次。');
  const stored = JSON.stringify(await AsyncStorage.multiGet(await AsyncStorage.getAllKeys()));
  expect(stored).not.toContain('ord-');
  expect(stored).not.toContain('雞腿飯');
});

test('沒有送出編號：不送也不在手機上建單', async () => {
  await expect(createOrder(input)).rejects.toBeInstanceOf(OrderNotSentError);
  expect(mockCallable).not.toHaveBeenCalled();
});

test('再試一次帶同一個送出編號；伺服器建好後用伺服器的訂單編號和號碼', async () => {
  mockCallable
    .mockRejectedValueOnce(new Error('deadline-exceeded'))
    .mockResolvedValueOnce({ data: { orderId: 'co_same', queueNumber: 9, createdAt: '2026-10-13T04:05:00.000Z' } });
  mockGetDoc.mockResolvedValue({ exists: () => false });
  await expect(createOrder({ ...input, requestId: 'req-2' })).rejects.toBeInstanceOf(OrderNotSentError);
  const order = await createOrder({ ...input, requestId: 'req-2' });
  expect(mockCallable).toHaveBeenCalledTimes(2);
  expect(mockCallable.mock.calls[0][0]).toMatchObject({ schoolId: 'pu', requestId: 'req-2', cafeteriaId: 'cafe' });
  expect(mockCallable.mock.calls[1][0].requestId).toBe('req-2');
  expect(mockCallable.mock.calls[1][0].items).toEqual([{ menuItemId: 'rice', quantity: 1 }]);
  expect(order).toMatchObject({ id: 'co_same', queueNumber: 9, queueStatus: 'assigned' });
  expect(order).not.toHaveProperty('requestId');
});
