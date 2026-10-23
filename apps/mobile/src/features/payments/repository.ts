import {
  collection,
  doc,
  getDocFromServer,
  getDocsFromServer,
  limit,
  orderBy,
  query,
} from 'firebase/firestore';
import { getAuthInstance, getDb, isFirebaseMockMode } from '../../firebase';
import { toDate } from '../../utils/format';

export type PaymentScope = { userId: string; schoolId: string };
export type PaymentTransaction = {
  id: string;
  title: string;
  amount: number;
  type: 'expense' | 'topup' | 'refund';
  status: 'pending' | 'completed' | 'failed' | 'cancelled';
  timestamp: Date | null;
  location?: string;
};
export type PaymentDashboard = {
  balance: number | null;
  pending: number;
  transactions: PaymentTransaction[];
};
export const PAYMENT_HISTORY_LIMIT = 100;

function assertSession({ userId, schoolId }: PaymentScope) {
  if (
    !userId ||
    !schoolId ||
    isFirebaseMockMode() ||
    getAuthInstance().currentUser?.uid !== userId
  ) {
    throw new Error('payment-session-unavailable');
  }
}

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function readAmount(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value))
    throw new Error('invalid-payment-amount');
  return value;
}

function readTransaction(id: string, value: unknown, scope: PaymentScope): PaymentTransaction {
  const row = toRecord(value);
  if (
    (row.userId && row.userId !== scope.userId) ||
    (row.schoolId && row.schoolId !== scope.schoolId)
  ) {
    throw new Error('payment-scope-mismatch');
  }
  if (row.currency !== 'TWD') throw new Error('unsupported-payment-currency');
  const isExpense = row.type === 'payment' || row.type === 'expense';
  if (!isExpense && row.type !== 'topup' && row.type !== 'refund')
    throw new Error('invalid-payment-type');
  if (!['pending', 'completed', 'failed', 'cancelled'].includes(String(row.status))) {
    throw new Error('invalid-payment-status');
  }
  const amount = Math.abs(readAmount(row.amount));
  const timestamp = toDate(row.createdAt);
  return {
    id,
    title: readString(row.description) ?? '交易',
    amount: isExpense ? -amount : amount,
    type: isExpense ? 'expense' : (row.type as 'topup' | 'refund'),
    status: row.status as PaymentTransaction['status'],
    timestamp: timestamp && Number.isFinite(timestamp.getTime()) ? timestamp : null,
    location: readString(row.merchantName),
  };
}

export async function loadPaymentDashboardData(scope: PaymentScope): Promise<PaymentDashboard> {
  assertSession(scope);
  const db = getDb();
  // Financial reads use the current school's canonical records and require a server response.
  const path = ['users', scope.userId, 'schools', scope.schoolId] as const;
  const [walletSnapshot, history] = await Promise.all([
    getDocFromServer(doc(db, ...path, 'wallet', 'balance')),
    getDocsFromServer(
      query(
        collection(db, ...path, 'transactions'),
        orderBy('createdAt', 'desc'),
        limit(PAYMENT_HISTORY_LIMIT),
      ),
    ),
  ]);
  assertSession(scope);
  const wallet = toRecord(walletSnapshot.data());
  const balance = walletSnapshot.exists() ? readAmount(wallet.available) : null;
  const pending = walletSnapshot.exists() ? readAmount(wallet.pending ?? 0) : 0;
  if (walletSnapshot.exists() && (wallet.currency !== 'TWD' || balance! < 0 || pending < 0)) {
    throw new Error('invalid-payment-wallet');
  }
  return {
    balance,
    pending,
    transactions: history.docs.map((entry) => readTransaction(entry.id, entry.data(), scope)),
  };
}

export function formatPaymentAmount(amount: number) {
  return `${amount < 0 ? '−' : '+'}NT$${Math.abs(amount).toLocaleString('zh-TW')}`;
}

export function buildPaymentCsv(transactions: PaymentTransaction[]): string {
  const cell = (value: string | number) => {
    const raw = String(value);
    const safe = typeof value === 'string' && /^[\s]*[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
    return `"${safe.replace(/"/g, '""')}"`;
  };
  return (
    '\uFEFF' +
    [
      ['交易編號', '項目', '金額（TWD）', '狀態', '時間', '地點'],
      ...transactions.map((row) => [
        row.id,
        row.title,
        row.amount,
        row.status,
        row.timestamp?.toISOString() ?? '',
        row.location ?? '',
      ]),
    ]
      .map((row) => row.map(cell).join(','))
      .join('\n')
  );
}
