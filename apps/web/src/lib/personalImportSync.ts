'use client';
import {
  performPersonalImportSync,
  type PersonalImportSyncResolution,
  type PersonalImportSyncResult,
} from '@campus/shared/src/imports/syncEngine';
import { personalImportSyncErrorMessage } from '@campus/shared/src/imports/sync';
import { browserRequest } from '@/features/nuni/Session';
import {
  personalImportsStorageKey,
  withPersonalImportSyncLock,
  type PersonalImportScope,
} from './personalImports';

export type ImportSyncIdentity = { platformAccountId: string; context: string };
export type ImportSyncStatus = {
  phase: 'syncing' | 'synced' | 'conflict' | 'error';
  message: string;
  result?: PersonalImportSyncResult;
};
const statuses = new Map<string, ImportSyncStatus>();
const listeners = new Set<() => void>();
const running = new Map<string, Promise<void>>();
const generations = new Map<string, number>();
export const subscribePersonalImportSync = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
export const getPersonalImportSyncStatus = (scope: PersonalImportScope) =>
  statuses.get(personalImportsStorageKey(scope)) || null;
function notify() {
  for (const listener of listeners) {
    try {
      listener();
    } catch {
      /* A view cannot interrupt persistence. */
    }
  }
}
const publish = (scope: PersonalImportScope, status: ImportSyncStatus) => {
  statuses.set(personalImportsStorageKey(scope), status);
  notify();
};
export function cancelPersonalImportSync(scope: PersonalImportScope) {
  const key = personalImportsStorageKey(scope);
  generations.set(key, (generations.get(key) || 0) + 1);
  statuses.delete(key);
  notify();
}

export async function setPersonalImportSyncEnabled(
  scope: PersonalImportScope,
  enabled: boolean,
  active: () => boolean,
) {
  if (!scope.owner.startsWith('platform:') || scope.schoolId === 'personal')
    throw new Error('請登入平台帳號並選擇校園後再同步。');
  if (!active()) throw new Error('帳號或校園已切換，這次同步已停止。');
  // Invalidate a request still reading before it can upload. A write already sent may
  // finish on the server; the next opt-in reconciles that acknowledgement safely.
  if (!enabled) cancelPersonalImportSync(scope);
  await withPersonalImportSyncLock(
    scope,
    async (state) => ({
      state: { ...state, sync: { ...state.sync, enabled, base: state.sync?.base || null } },
      result: undefined,
    }),
    active,
  );
}

export function syncPersonalImports(
  scope: PersonalImportScope,
  identity: ImportSyncIdentity,
  active: () => boolean,
  resolution?: PersonalImportSyncResolution,
): Promise<void> {
  if (
    scope.owner !== `platform:${identity.platformAccountId}` ||
    scope.schoolId === 'personal' ||
    !active()
  )
    return Promise.resolve();
  const storageKey = personalImportsStorageKey(scope);
  const generation = generations.get(storageKey) || 0;
  const current = () => active() && generation === (generations.get(storageKey) || 0);
  const key = `${storageKey}:${identity.context}:${generation}`;
  const pending = running.get(key);
  if (pending) return pending;
  const progress: ImportSyncStatus = { phase: 'syncing', message: '正在同步…' };
  const task = (async () => {
    publish(scope, progress);
    try {
      const result = await withPersonalImportSyncLock(
        scope,
        async (state, checkpoint) => {
          const result = await performPersonalImportSync(
            scope.schoolId,
            state,
            (path, input) => browserRequest(path, identity.context, input),
            current,
            resolution,
            checkpoint,
          );
          return { state: result.state, result };
        },
        current,
      );
      if (!current()) return;
      if (!result.state.sync?.enabled) {
        statuses.delete(storageKey);
        notify();
        return;
      }
      publish(
        scope,
        result.conflicts.length
          ? {
              phase: 'conflict',
              message: '兩台裝置修改了同一筆資料，請選擇要保留的內容。尚未覆蓋任何一方。',
              result,
            }
          : {
              phase: 'synced',
              message: result.detachedCourseLinks.length
                ? `已同步。有 ${result.detachedCourseLinks.length} 筆課班已無法存取，個人資料仍保留，請重新選擇課班。`
                : '已同步到帳號，其他裝置登入同帳號並開啟同步後即可讀取。',
              result,
            },
      );
    } catch (error) {
      if (current())
        publish(scope, { phase: 'error', message: personalImportSyncErrorMessage(error) });
    }
  })();
  running.set(key, task);
  void task.finally(() => {
    if (running.get(key) === task) running.delete(key);
    if (!current() && statuses.get(storageKey) === progress) {
      statuses.delete(storageKey);
      notify();
    }
  });
  return task;
}
