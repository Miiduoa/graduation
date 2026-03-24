import { collection, doc, getDoc, getDocs, limit, query } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';

import type { DataSource } from '../../data';
import type { Transaction as DataTransaction } from '../../data/types';
import { getDb, getFunctionsInstance } from '../../firebase';
import { toDate } from '../../utils/format';

export type PaymentTransaction = {
  id: string;
  title: string;
  amount: number;
  type: 'expense' | 'topup' | 'refund';
  category: 'meal' | 'print' | 'laundry' | 'vending' | 'parking' | 'other';
  timestamp: Date;
  location?: string;
};

export type TransferTarget = {
  id: string;
  name: string;
  account: string;
};

type PaymentDataSource = Pick<DataSource, 'getUser' | 'listTransactions'>;

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function readCategory(value: unknown): PaymentTransaction['category'] {
  switch (value) {
    case 'meal':
    case 'print':
    case 'laundry':
    case 'vending':
    case 'parking':
      return value;
    default:
      return 'other';
  }
}

export async function loadPaymentDashboardData(params: {
  userId: string | null;
  schoolId: string;
  dataSource: PaymentDataSource;
  fallbackTransactions: PaymentTransaction[];
  fallbackBalance: number;
}): Promise<{
  transactions: PaymentTransaction[];
  balance: number;
}> {
  if (!params.userId) {
    return {
      transactions: params.fallbackTransactions,
      balance: params.fallbackBalance,
    };
  }

  try {
    const [transactions, user, walletResponse] = await Promise.all([
      params.dataSource.listTransactions(params.userId, undefined, params.schoolId),
      params.dataSource.getUser(params.userId),
      httpsCallable(getFunctionsInstance(), 'getWalletBalance')({ schoolId: params.schoolId }).catch(() => null),
    ]);

    const mappedTransactions =
      transactions.length > 0
        ? transactions.map((transaction: DataTransaction) => {
            const record = toRecord(transaction);
            return {
              id: transaction.id,
              title: readString(record.description) ?? '交易',
              amount: transaction.type === 'expense' ? -transaction.amount : transaction.amount,
              type: transaction.type as PaymentTransaction['type'],
              category: readCategory(record.category),
              timestamp: toDate(transaction.createdAt) ?? new Date(),
              location: readString(record.location),
            };
          })
        : params.fallbackTransactions;

    const walletData = toRecord((walletResponse as { data?: unknown } | null)?.data);
    const nextBalance =
      typeof walletData.balance === 'number'
        ? walletData.balance
        : typeof user?.balance === 'number'
          ? user.balance
          : params.fallbackBalance;

    return {
      transactions: mappedTransactions,
      balance: nextBalance,
    };
  } catch (error) {
    console.warn('Failed to load payment data:', error);
    return {
      transactions: params.fallbackTransactions,
      balance: params.fallbackBalance,
    };
  }
}

export async function loadTransferTargets(params: {
  currentUserId: string | null;
  schoolId: string;
  fallbackTargets: TransferTarget[];
}): Promise<TransferTarget[]> {
  if (!params.schoolId) {
    return params.fallbackTargets;
  }

  try {
    const db = getDb();
    const membersSnapshot = await getDocs(query(collection(db, 'schools', params.schoolId, 'members'), limit(20)));
    const targets = (
      await Promise.all(
        membersSnapshot.docs.map(async (memberSnapshot) => {
          if (memberSnapshot.id === params.currentUserId) {
            return null;
          }

          const userSnapshot = await getDoc(doc(db, 'users', memberSnapshot.id)).catch(() => null);
          const userData = toRecord(userSnapshot?.data());
          const email = readString(userData.email);
          const displayName = readString(userData.displayName);

          return {
            id: memberSnapshot.id,
            name: displayName ?? email ?? `使用者-${memberSnapshot.id.slice(0, 6)}`,
            account: email?.split('@')[0] ?? memberSnapshot.id.slice(0, 8),
          };
        })
      )
    ).filter((target): target is TransferTarget => target != null);

    return targets.length > 0 ? targets : params.fallbackTargets;
  } catch (error) {
    console.warn('Failed to load transfer targets:', error);
    return params.fallbackTargets;
  }
}
