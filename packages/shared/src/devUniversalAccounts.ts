import type { AuthRole } from './auth';

export type UniversalDevAccount = {
  uid: string;
  email: string;
  displayName: string;
  role: AuthRole;
};

type UniversalDevAccountRecord = UniversalDevAccount;

const UNIVERSAL_DEV_ACCOUNT_RECORDS: readonly UniversalDevAccountRecord[] = [
  {
    uid: 'dev-universal-student',
    email: 'demohan513@gmail.com',
    displayName: '跨校測試學生',
    role: 'student',
  },
  {
    uid: 'dev-universal-teacher',
    email: 'miiduoa@icloud.com',
    displayName: '跨校測試教師',
    role: 'teacher',
  },
] as const;

function normalizeEmail(email?: string | null): string {
  return (email ?? '').trim().toLowerCase();
}

function toPublicAccount(record: UniversalDevAccountRecord): UniversalDevAccount {
  return {
    uid: record.uid,
    email: record.email,
    displayName: record.displayName,
    role: record.role,
  };
}

export function listUniversalDevAccounts(): UniversalDevAccount[] {
  return UNIVERSAL_DEV_ACCOUNT_RECORDS.map(toPublicAccount);
}

export function findUniversalDevAccountByEmail(email?: string | null): UniversalDevAccount | null {
  const normalizedEmail = normalizeEmail(email);
  const match = UNIVERSAL_DEV_ACCOUNT_RECORDS.find((account) => account.email === normalizedEmail);
  return match ? toPublicAccount(match) : null;
}

export function authenticateUniversalDevAccount(
  email?: string | null,
  _password?: string | null,
): UniversalDevAccount | null {
  return findUniversalDevAccountByEmail(email);
}

export function isUniversalDevAccountEmail(email?: string | null): boolean {
  return findUniversalDevAccountByEmail(email) !== null;
}
