'use client';

import { parseAccountDemoSnapshot, type AccountDemoSnapshot } from '@campus/shared/src/accountDemo';
import { browserRequest } from '@/features/nuni/Session';

export function parseOwnedAccountDemo(
  value: unknown,
  accountId: string,
): AccountDemoSnapshot | null {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('展示資料格式不正確。');
  const envelope = value as Record<string, unknown>;
  if (Object.keys(envelope).length !== 1 || !Object.hasOwn(envelope, 'demo'))
    throw new Error('展示資料格式不正確。');
  if (envelope.demo === null) return null;
  const demo = parseAccountDemoSnapshot(envelope.demo);
  if (demo.accountId !== accountId) throw new Error('帳號已變更，請重新載入。');
  if (Date.parse(demo.expiresAt) <= Date.now()) return null;
  return demo;
}

export async function readAccountDemo(context: string, accountId: string) {
  return parseOwnedAccountDemo(await browserRequest('account-demo', context), accountId);
}
