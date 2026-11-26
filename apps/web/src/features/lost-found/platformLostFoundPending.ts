import {
  validateNuniLostFoundRequest,
  type NuniLostFoundRequests,
} from '@campus/shared/src/nuniLostFound';

export type LostFoundPendingAction = 'create' | 'update' | 'resolve' | 'remove';
export type PlatformLostFoundPending = {
  [A in LostFoundPendingAction]: { action: A; input: NuniLostFoundRequests[A] };
}[LostFoundPendingAction];

const PREFIX = 'campus-one.platform-lost-found.pending.v1:';
const ACCOUNT = /^pa_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ACTIONS = ['create', 'update', 'resolve', 'remove'];
const MAX_LENGTH = 16 * 1024;

export class PlatformLostFoundStorageError extends Error {
  constructor() {
    super('無法安全讀寫這個瀏覽器的待確認紀錄。');
    this.name = 'PlatformLostFoundStorageError';
  }
}

export function platformLostFoundPendingKey(accountId: string, schoolId: string): string {
  if (!ACCOUNT.test(accountId)) throw new PlatformLostFoundStorageError();
  try {
    validateNuniLostFoundRequest('list', { schoolId });
  } catch {
    throw new PlatformLostFoundStorageError();
  }
  return PREFIX + accountId + ':' + schoolId;
}

function storage(): Storage {
  try {
    return window.sessionStorage;
  } catch {
    throw new PlatformLostFoundStorageError();
  }
}

function parse(raw: string, accountId: string, schoolId: string): PlatformLostFoundPending {
  try {
    if (raw.length > MAX_LENGTH) throw new Error();
    const row = JSON.parse(raw);
    if (
      !row ||
      Array.isArray(row) ||
      row.version !== 1 ||
      row.accountId !== accountId ||
      row.schoolId !== schoolId ||
      Object.keys(row).sort().join(',') !== 'accountId,operation,schoolId,version' ||
      !row.operation ||
      Array.isArray(row.operation) ||
      Object.keys(row.operation).sort().join(',') !== 'action,input' ||
      !ACTIONS.includes(row.operation.action)
    )
      throw new Error();
    const action = row.operation.action as LostFoundPendingAction;
    const input = validateNuniLostFoundRequest(action, row.operation.input);
    if (input.schoolId !== schoolId) throw new Error();
    return { action, input } as PlatformLostFoundPending;
  } catch {
    throw new PlatformLostFoundStorageError();
  }
}

export function readPlatformLostFoundPending(
  accountId: string,
  schoolId: string,
): PlatformLostFoundPending | null {
  try {
    const raw = storage().getItem(platformLostFoundPendingKey(accountId, schoolId));
    return raw === null ? null : parse(raw, accountId, schoolId);
  } catch {
    throw new PlatformLostFoundStorageError();
  }
}

/** Record the exact intent before sending it; another unresolved intent is never overwritten. */
export function savePlatformLostFoundPending(
  accountId: string,
  schoolId: string,
  operation: PlatformLostFoundPending,
): PlatformLostFoundPending {
  const key = platformLostFoundPendingKey(accountId, schoolId);
  const raw = JSON.stringify({ version: 1, accountId, schoolId, operation });
  const validated = parse(raw, accountId, schoolId);
  const previous = readPlatformLostFoundPending(accountId, schoolId);
  if (previous && JSON.stringify(previous) !== JSON.stringify(validated))
    throw new PlatformLostFoundStorageError();
  try {
    const target = storage();
    target.setItem(key, raw);
    if (target.getItem(key) !== raw) throw new Error();
    return validated;
  } catch {
    throw new PlatformLostFoundStorageError();
  }
}

/** A late receipt cannot erase a newer operation for the same account and campus. */
export function clearPlatformLostFoundPending(
  accountId: string,
  schoolId: string,
  mutationId: string,
): void {
  const previous = readPlatformLostFoundPending(accountId, schoolId);
  if (!previous) return;
  if (previous.input.mutationId !== mutationId) throw new PlatformLostFoundStorageError();
  discardPlatformLostFoundPending(accountId, schoolId);
}

/** Only call after explicit confirmation, including when the stored intent is damaged. */
export function discardPlatformLostFoundPending(accountId: string, schoolId: string): void {
  try {
    const key = platformLostFoundPendingKey(accountId, schoolId);
    const target = storage();
    target.removeItem(key);
    if (target.getItem(key) !== null) throw new Error();
  } catch {
    throw new PlatformLostFoundStorageError();
  }
}
