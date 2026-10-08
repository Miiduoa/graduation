import { collection, doc, getDocFromServer, getDocsFromServer } from 'firebase/firestore';
import { getAuthInstance, isFirebaseMockMode } from '../firebase';
import {
  loadPaymentDashboardData,
  buildPaymentCsv,
  formatPaymentAmount,
} from '../features/payments';

jest.mock('firebase/firestore', () => ({
  collection: jest.fn((...args) => args),
  doc: jest.fn((...args) => args),
  getDocFromServer: jest.fn(),
  getDocsFromServer: jest.fn(),
  limit: jest.fn(),
  orderBy: jest.fn(),
  query: jest.fn((...args) => args),
}));
jest.mock('../firebase', () => ({
  getDb: jest.fn(() => 'db'),
  getAuthInstance: jest.fn(),
  isFirebaseMockMode: jest.fn(() => false),
}));
const scope = { userId: 'student-a', schoolId: 'school-a' };
const row = {
  userId: scope.userId,
  schoolId: scope.schoolId,
  amount: 75,
  currency: 'TWD',
  type: 'payment',
  status: 'completed',
  description: '午餐',
  createdAt: '2026-10-08T01:00:00Z',
};
function history(records: Record<string, unknown>[]) {
  jest.mocked(getDocsFromServer).mockResolvedValue({
    docs: records.map((data, index) => ({ id: `row-${index}`, data: () => data })),
  } as never);
}
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(getAuthInstance).mockReturnValue({ currentUser: { uid: scope.userId } } as never);
  jest.mocked(isFirebaseMockMode).mockReturnValue(false);
  jest.mocked(getDocFromServer).mockResolvedValue({
    exists: () => true,
    data: () => ({ available: 500, pending: 20, currency: 'TWD' }),
  } as never);
  history([]);
});

test('reads only the current user and school, and keeps an empty ledger empty', async () => {
  await expect(loadPaymentDashboardData(scope)).resolves.toEqual({
    balance: 500,
    pending: 20,
    transactions: [],
  });
  expect(doc).toHaveBeenCalledWith(
    'db',
    'users',
    'student-a',
    'schools',
    'school-a',
    'wallet',
    'balance',
  );
  expect(collection).toHaveBeenCalledWith(
    'db',
    'users',
    'student-a',
    'schools',
    'school-a',
    'transactions',
  );
});

test('a missing wallet remains unknown rather than showing a sample or zero balance', async () => {
  jest
    .mocked(getDocFromServer)
    .mockResolvedValue({ exists: () => false, data: () => undefined } as never);
  await expect(loadPaymentDashboardData(scope)).resolves.toMatchObject({
    balance: null,
    transactions: [],
  });
});

test('read errors remain errors without a legacy wallet or invented transaction fallback', async () => {
  jest.mocked(getDocsFromServer).mockRejectedValueOnce(new Error('permission-denied'));
  await expect(loadPaymentDashboardData(scope)).rejects.toThrow('permission-denied');
});

test('canonical payments and expenses are debits, while refunds are credits', async () => {
  history([row, { ...row, type: 'expense', amount: -20 }, { ...row, type: 'refund', amount: 10 }]);
  const result = await loadPaymentDashboardData(scope);
  expect(result.transactions.map((entry) => entry.amount)).toEqual([-75, -20, 10]);
  expect(formatPaymentAmount(result.transactions[0].amount)).toBe('−NT$75');
});

test('unknown dates are not replaced by today and pending payments stay pending', async () => {
  history([{ ...row, createdAt: 'bad-date', status: 'pending' }]);
  const result = await loadPaymentDashboardData(scope);
  expect(result.transactions[0]).toMatchObject({ timestamp: null, status: 'pending' });
});

test.each([
  { schoolId: 'another-school' },
  { userId: 'another-user' },
  { amount: Number.NaN },
  { currency: 'USD' },
  { type: 'unknown' },
  { status: 'unknown' },
])('rejects inconsistent financial rows: %j', async (patch) => {
  history([{ ...row, ...patch }]);
  await expect(loadPaymentDashboardData(scope)).rejects.toThrow();
});

test('refuses demo data and a changed authenticated user', async () => {
  jest.mocked(isFirebaseMockMode).mockReturnValueOnce(true);
  await expect(loadPaymentDashboardData(scope)).rejects.toThrow('payment-session-unavailable');
  expect(getDocFromServer).not.toHaveBeenCalled();
  jest.mocked(getAuthInstance).mockReturnValueOnce({ currentUser: { uid: 'student-b' } } as never);
  await expect(loadPaymentDashboardData(scope)).rejects.toThrow('payment-session-unavailable');
});

test('an auth change during a read invalidates the response', async () => {
  jest
    .mocked(getAuthInstance)
    .mockReturnValueOnce({ currentUser: { uid: scope.userId } } as never)
    .mockReturnValueOnce({ currentUser: null } as never);
  await expect(loadPaymentDashboardData(scope)).rejects.toThrow('payment-session-unavailable');
});

test('CSV preserves signed numeric amounts and neutralizes formula text', async () => {
  history([{ ...row, description: '=HYPERLINK("https://example.test")' }]);
  const { transactions } = await loadPaymentDashboardData(scope);
  const csv = buildPaymentCsv(transactions);
  expect(csv).toContain('"\'=HYPERLINK(""https://example.test"")"');
  expect(csv).toContain('"-75"');
  expect(csv).toContain('"completed"');
});
