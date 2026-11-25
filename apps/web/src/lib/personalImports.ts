'use client';

import {
  createPersonalImportId,
  periodProfileForSchool,
  planPersonalImport,
  preparePersonalImportBackupRestore,
  undoPersonalImportBatch,
  validatePersonalImportRow,
  type PersonalImportRecord,
  type PersonalImportRow,
} from '@campus/shared';
import {
  parsePersonalImportSyncState,
  type PersonalImportSyncState,
} from '@campus/shared/src/imports/sync';
import {
  capturePersonalImportBrowserRecovery,
  hasWebPersonalImportCommit,
  serializePersonalImportBrowserCommit,
  unwrapPersonalImportCheckpoint,
} from '@campus/shared/src/imports/browserRecovery';
import type { PersonalImportLocalState } from '@campus/shared/src/imports/syncEngine';

export type PersonalImportScope = { owner: string; schoolId: string };
export const PERSONAL_IMPORT_CHANGE = 'campus-personal-imports-change';
export const PERSONAL_IMPORT_LIMIT = 2000;

export function personalImportsStorageKey(scope: PersonalImportScope) {
  return `campus.personal-imports.v1:${encodeURIComponent(scope.owner)}:${encodeURIComponent(scope.schoolId)}`;
}

function readPersonalImportLedger(scope: PersonalImportScope) {
  const key = personalImportsStorageKey(scope);
  let primary = localStorage.getItem(key);
  const recovery = capturePersonalImportBrowserRecovery(localStorage, key);
  const checkpoint = recovery.checkpoint;
  let raw = primary;
  let adoptedCheckpoint = false;
  if (primary === null && checkpoint !== null) {
    try {
      const candidate = unwrapPersonalImportCheckpoint(checkpoint);
      if (candidate === null || (typeof candidate === 'string' && candidate.trimStart().startsWith('{'))) {
        parsePersonalImportRecords(scope, candidate);
        parseLedgerSyncState(scope, candidate);
        raw = candidate;
        adoptedCheckpoint = true;
      }
    } catch {
      // Leave damaged copies in storage and proceed with the empty ledger.
    }
  }
  const shouldMarkCommit = recovery.hasCopies &&
    (hasWebPersonalImportCommit(primary) || checkpoint === null || adoptedCheckpoint);
  const assertSnapshot = () => recovery.assertSnapshot(primary, primary === null);
  return {
    raw,
    assertSnapshot,
    write(state: PersonalImportLocalState) {
      // Keep a v1 commit marker while legacy recovery data may still exist.
      // Expo owns the undo history. Carry it through Web writes from the same
      // ledger snapshot as the records before retiring an adopted checkpoint.
      const batches: unknown = raw ? JSON.parse(raw).batches : undefined;
      const ledger = { version: 1 as const, ...state, batches };
      const published = shouldMarkCommit
        ? serializePersonalImportBrowserCommit(ledger)
        : JSON.stringify(ledger);
      assertSnapshot();
      localStorage.setItem(key, published);
      if (localStorage.getItem(key) !== published) {
        throw new Error('匯入資料已在另一個分頁更新，請重新載入。');
      }
      // Retire standalone checkpoints only when this write used them.
      if (adoptedCheckpoint) {
        recovery.retire(published, 'checkpoint');
        adoptedCheckpoint = false;
      }
      primary = published;
    },
  };
}

function parsePersonalImportRecords(scope: PersonalImportScope, raw: string | null): PersonalImportRecord[] {
  if (!raw) return [];
  try {
    const data: unknown = JSON.parse(raw);
    if (
      !data ||
      typeof data !== 'object' ||
      !('version' in data) ||
      data.version !== 1 ||
      !('records' in data) ||
      !Array.isArray(data.records) ||
      data.records.length > PERSONAL_IMPORT_LIMIT
    )
      throw new Error();
    const ids = new Set<string>();
    for (const row of data.records as PersonalImportRecord[]) {
      if (
        !row ||
        row.schoolId !== scope.schoolId ||
        typeof row.id !== 'string' ||
        ids.has(row.id) ||
        typeof row.batchId !== 'string' ||
        typeof row.importedAt !== 'string' ||
        !row.source ||
        typeof row.source.rawText !== 'string' ||
        validatePersonalImportRow(row, {
          periodProfile: periodProfileForSchool(scope.schoolId),
        }).some((issue) => issue.severity === 'error')
      )
        throw new Error();
      ids.add(row.id);
    }
    return data.records as PersonalImportRecord[];
  } catch {
    throw new Error('這份匯入紀錄暫時讀不到，原始資料仍保留。請勿清除瀏覽器資料，稍後再試。');
  }
}

function parseLedgerSyncState(scope: PersonalImportScope, raw: string | null): PersonalImportSyncState {
  const value = raw ? JSON.parse(raw).sync : undefined;
  if (value === undefined) return { enabled: false, base: null };
  return parsePersonalImportSyncState(value, scope.schoolId);
}

export function readPersonalImports(scope: PersonalImportScope): PersonalImportRecord[] {
  return parsePersonalImportRecords(scope, readPersonalImportLedger(scope).raw);
}

export function readPersonalImportSyncState(scope: PersonalImportScope): PersonalImportSyncState {
  return parseLedgerSyncState(scope, readPersonalImportLedger(scope).raw);
}

export async function withPersonalImportSyncLock<T>(
  scope: PersonalImportScope,
  action: (
    state: PersonalImportLocalState,
    checkpoint: (state: PersonalImportLocalState) => Promise<void>,
    assertSnapshot: () => void,
  ) => Promise<{ state: PersonalImportLocalState; result: T }>,
  active = () => true,
): Promise<T> {
  if (!navigator.locks) throw new Error('目前瀏覽器無法安全同步，請使用最新版瀏覽器。');
  return navigator.locks.request(personalImportsStorageKey(scope), async () => {
    if (!active()) throw new Error('帳號或校園已切換，這次同步已停止。');
    const ledger = readPersonalImportLedger(scope);
    let persisted: PersonalImportLocalState = {
      records: parsePersonalImportRecords(scope, ledger.raw),
      sync: parseLedgerSyncState(scope, ledger.raw),
    };
    const checkpoint = async (state: PersonalImportLocalState) => {
      if (!active()) throw new Error('帳號或校園已切換，這次同步已停止。');
      if (JSON.stringify(persisted) === JSON.stringify(state)) return;
      try {
        ledger.write(state);
      } catch {
        throw new Error('裝置空間不足，這次同步未能保存；原資料仍保留，請先下載備份。');
      }
      persisted = state;
      window.dispatchEvent(new Event(PERSONAL_IMPORT_CHANGE));
    };
    const { state, result } = await action(persisted, checkpoint, ledger.assertSnapshot);
    await checkpoint(state);
    return result;
  });
}

async function mutate<T>(
  scope: PersonalImportScope,
  action: (rows: PersonalImportRecord[]) => { rows: PersonalImportRecord[]; result: T },
  active = () => true,
): Promise<T> {
  // A Web Lock covers the whole read/modify/write, including other open tabs.
  if (!navigator.locks)
    throw new Error('目前瀏覽器無法安全儲存。請用最新版瀏覽器開啟 HTTPS 網站後重試；草稿還在。');
  return navigator.locks.request(personalImportsStorageKey(scope), () => {
    if (!active()) throw new Error('帳號或校園已切換，請重新開啟匯入。');
    const ledger = readPersonalImportLedger(scope);
    const { rows, result } = action(parsePersonalImportRecords(scope, ledger.raw));
    if (rows.length > PERSONAL_IMPORT_LIMIT)
      throw new Error('這台裝置已存滿 2,000 筆，請先匯出備份並移除不再需要的紀錄。');
    try {
      ledger.write({ records: rows, sync: parseLedgerSyncState(scope, ledger.raw) });
    } catch {
      throw new Error('這次沒有存成，可能是裝置空間不足或瀏覽器禁止儲存。草稿還在，請稍後再試。');
    }
    window.dispatchEvent(new Event(PERSONAL_IMPORT_CHANGE));
    return result;
  });
}

export async function savePersonalImportBatch(
  scope: PersonalImportScope,
  rows: PersonalImportRow[],
  active = () => true,
  options: { restoreBackup?: boolean } = {},
) {
  if (!rows.length || rows.some((row) => row.schoolId !== scope.schoolId))
    throw new Error('請確認校園與要匯入的資料。');
  return mutate(
    scope,
    (existing) => {
      const batchId = createPersonalImportId();
      const drafts = options.restoreBackup
        ? preparePersonalImportBackupRestore(rows, existing)
        : rows;
      const plan = planPersonalImport(existing, drafts, {
        batchId,
        importedAt: new Date().toISOString(),
        periodProfile: periodProfileForSchool(scope.schoolId),
      });
      const error = plan.issues.find(
        (issue) => issue.severity === 'error' || issue.code === 'duplicate-metadata-conflict',
      );
      if (error) throw new Error(error.message);
      return {
        rows: plan.records,
        result: { batchId, added: plan.added.length, duplicates: plan.duplicates.length },
      };
    },
    active,
  );
}

export async function undoPersonalImports(
  scope: PersonalImportScope,
  batchId: string,
  active = () => true,
) {
  return mutate(
    scope,
    (rows) => {
      const next = undoPersonalImportBatch(rows, batchId);
      return { rows: next, result: rows.length - next.length };
    },
    active,
  );
}

export async function changePersonalImport(
  scope: PersonalImportScope,
  original: PersonalImportRecord,
  revised: PersonalImportRow | null,
  active = () => true,
) {
  return mutate(
    scope,
    (rows) => {
      const current = rows.find((row) => row.id === original.id);
      if (JSON.stringify(current) !== JSON.stringify(original))
        throw new Error('這筆資料已在另一個頁面變更，請重新開啟再編輯。');
      const rest = rows.filter((row) => row.id !== original.id);
      if (!revised) return { rows: rest, result: undefined };
      if (revised.schoolId !== scope.schoolId) throw new Error('校園已變更，請重新開啟這筆資料。');
      const plan = planPersonalImport(rest, [{ ...revised, id: original.id }], {
        batchId: createPersonalImportId(),
        importedAt: new Date().toISOString(),
        periodProfile: periodProfileForSchool(scope.schoolId),
      });
      const error = plan.issues.find(
        (issue) => issue.severity === 'error' || issue.code === 'duplicate-metadata-conflict',
      );
      if (error) throw new Error(error.message);
      if (!plan.added.length) throw new Error('已有相同紀錄，請確認後再修改。');
      return { rows: plan.records, result: undefined };
    },
    active,
  );
}
