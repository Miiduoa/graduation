import {
  performPersonalImportSync,
  type PersonalImportSyncResolution,
  type PersonalImportSyncResult,
  type PersonalImportSyncTransport,
} from '@campus/shared/src/imports/syncEngine';
import { personalImportSyncErrorMessage } from '@campus/shared/src/imports/sync';
import { PERSONAL_IMPORT_SYNCED, PERSONAL_IMPORT_SYNCING } from '@campus/shared';
import {
  mutatePersonalImportLedger,
  personalImportStorageKey,
  type PersonalImportScope,
} from './personalImports';

export type ImportSyncStatus = {
  running: boolean;
  message: string;
  result?: PersonalImportSyncResult;
};
const statuses = new Map<string, ImportSyncStatus>();
const subscribers = new Set<(key: string) => void>();
const pending = new Map<string, Promise<PersonalImportSyncResult>>();
const generations = new Map<string, number>();
export function canSyncPersonalImports(scope: PersonalImportScope) {
  return (
    /^nuni:pa_[0-9a-f-]{36}$/.test(scope.owner) && !!scope.schoolId && scope.schoolId !== 'personal'
  );
}
export function personalImportSyncStatus(scope: PersonalImportScope): ImportSyncStatus {
  return statuses.get(personalImportStorageKey(scope)) || { running: false, message: '' };
}
export function subscribePersonalImportSync(listener: (key: string) => void) {
  subscribers.add(listener);
  return () => {
    subscribers.delete(listener);
  };
}
function publish(key: string, status: ImportSyncStatus) {
  statuses.set(key, status);
  for (const listener of subscribers) {
    try {
      listener(key);
    } catch {
      /* A view must not interrupt persistence. */
    }
  }
}
export function cancelPersonalImportSync(scope: PersonalImportScope) {
  const key = personalImportStorageKey(scope);
  generations.set(key, (generations.get(key) || 0) + 1);
  statuses.delete(key);
  for (const listener of subscribers) {
    try {
      listener(key);
    } catch {
      /* A view must not interrupt persistence. */
    }
  }
}
export async function setPersonalImportSyncEnabled(
  scope: PersonalImportScope,
  enabled: boolean,
  active: () => boolean,
) {
  if (!canSyncPersonalImports(scope))
    throw new Error('請登入平台帳號並選擇校園後再同步；原有資料保留在裝置上。');
  if (!enabled) cancelPersonalImportSync(scope);
  return mutatePersonalImportLedger(scope, active, (current) => {
    const ledger = {
      ...current,
      sync: { ...current.sync, enabled, base: current.sync?.base || null },
    };
    return { ledger, result: ledger };
  });
}
export function syncPersonalImports(
  scope: PersonalImportScope,
  transport: PersonalImportSyncTransport,
  active: () => boolean,
  resolution?: PersonalImportSyncResolution,
): Promise<PersonalImportSyncResult> {
  if (!canSyncPersonalImports(scope))
    return Promise.reject(new Error('目前帳號與校園無法使用同步。'));
  const key = personalImportStorageKey(scope);
  if (pending.has(key)) return pending.get(key)!;
  const generation = generations.get(key) || 0;
  const current = () => active() && generation === (generations.get(key) || 0);
  publish(key, { running: true, message: PERSONAL_IMPORT_SYNCING });
  const task = mutatePersonalImportLedger(
    scope,
    current,
    async (ledger, checkpoint) => {
      const result = await performPersonalImportSync(
        scope.schoolId,
        ledger,
        transport,
        current,
        resolution,
        async (state) => {
          const batchIds = new Set(state.records.map((record) => record.batchId));
          await checkpoint({
            ...ledger,
            ...state,
            batches: ledger.batches.filter((batch) => batchIds.has(batch.id)),
          });
        },
      );
      const batchIds = new Set(result.state.records.map((record) => record.batchId));
      return {
        ledger: {
          ...ledger,
          ...result.state,
          batches: ledger.batches.filter((batch) => batchIds.has(batch.id)),
        },
        result,
      };
    },
    'sync',
  )
    .then((result) => {
      if (current())
        publish(key, {
          running: false,
          result,
          message: result.conflicts.length
            ? '有資料同時在兩台裝置變更，請逐筆選擇要保留的內容。'
            : result.state.sync?.enabled
              ? `${PERSONAL_IMPORT_SYNCED}${result.detachedCourseLinks.length ? '部分課班連結已失效，個人資料仍保留，請重新核對。' : ''}`
              : '同步已暫停。',
        });
      return result;
    })
    .catch((error) => {
      if (current())
        publish(key, { running: false, message: personalImportSyncErrorMessage(error) });
      throw error;
    })
    .finally(() => {
      if (pending.get(key) === task) pending.delete(key);
    });
  pending.set(key, task);
  return task;
}
