import { createPersonalImportId, periodProfileForSchool, planPersonalImport, PERSONAL_IMPORT_BACKUP_MAX_RECORDS, type PersonalImportRow, type PersonalImportRecord } from '@campus/shared';
import { planPortalReimport, resolvePortalReimport, type PortalReimportPlan, type ReimportChoice } from '@campus/shared/src/imports/portalReimport';
import { mutatePersonalImportLedger, snapshotPersonalImports, type PersonalImportLedger, type PersonalImportScope } from './personalImports';

type Content = Pick<PersonalImportLedger, 'records' | 'batches'>;
export type PortalReimportPreview = {
  scope: PersonalImportScope;
  before: Content;
  rows: PersonalImportRow[];
  plan: PortalReimportPlan;
};
export type PortalReimportReceipt = {
  scope: PersonalImportScope;
  before: Content;
  after: Content;
  added: number;
  updated: number;
  duplicates: number;
  kept: number;
  batchId: string | null;
};
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const content = (ledger: Content): Content => ({ records: ledger.records, batches: ledger.batches });
const sameScope = (a: PersonalImportScope, b: PersonalImportScope) => a.owner === b.owner && a.schoolId === b.schoolId;
function assertCurrent(scope: PersonalImportScope, expected: PersonalImportScope, current: Content, before: Content) {
  if (!sameScope(scope, expected)) throw new Error('帳號或學校已切換，請重新核對。');
  if (JSON.stringify(content(current)) !== JSON.stringify(before)) throw new Error('原有紀錄已變更，這次沒有寫入。請重新比對並確認，不會覆蓋較新的資料。');
}

/** Local ledger read only. Snapshot is isolated from subsequent view edits and pending writes. */
export async function previewPortalReimport(scope: PersonalImportScope, rows: readonly PersonalImportRow[], active = () => true): Promise<PortalReimportPreview> {
  const draft = clone(rows) as PersonalImportRow[];
  const ledger = await snapshotPersonalImports(scope, active);
  const before = clone(content(ledger));
  const plan = planPortalReimport(before.records, draft, scope.schoolId, { periodProfile: periodProfileForSchool(scope.schoolId) });
  return { scope: { ...scope }, before, rows: draft, plan };
}

/** Recompute under the existing per-owner ledger lock; one checkpoint, never a partially applied batch. */
export function commitPortalReimport(scope: PersonalImportScope, preview: PortalReimportPreview, choices: Readonly<Record<string, ReimportChoice>>, active = () => true) {
  const input = clone(preview), decisions = { ...choices };
  return mutatePersonalImportLedger(scope, active, (current) => {
    assertCurrent(scope, input.scope, current, input.before);
    const profile = periodProfileForSchool(scope.schoolId);
    const plan = planPortalReimport(current.records, input.rows, scope.schoolId, { periodProfile: profile });
    const resolved = resolvePortalReimport(plan, decisions);
    const id = createPersonalImportId(), createdAt = new Date().toISOString();
    const replacementMap = new Map(resolved.replacements.map(({ before, next }) => [before.id, {
      ...next, id: before.id, linkedCourseId: before.linkedCourseId,
      importedAt: before.importedAt, batchId: `revision:${id}`, source: { ...next.source },
    } satisfies PersonalImportRecord]));
    const records = current.records.map((row) => replacementMap.get(row.id) ?? row);
    const planned = planPersonalImport(records, resolved.added, { batchId: id, importedAt: createdAt, periodProfile: profile });
    const error = planned.issues.find((issue) => issue.severity === 'error' || issue.code === 'duplicate-metadata-conflict');
    if (error) throw new Error(`這次沒有寫入。${error.message}`);
    if (planned.records.length > PERSONAL_IMPORT_BACKUP_MAX_RECORDS) throw new Error('已達個人紀錄上限，請先備份並整理舊紀錄。');
    const activeBatches = new Set(planned.records.map((row) => row.batchId));
    const batches = current.batches.filter((batch) => activeBatches.has(batch.id));
    if (planned.added.length) batches.push({ id, createdAt, count: planned.added.length });
    const changed = planned.added.length + replacementMap.size;
    const ledger: PersonalImportLedger = changed ? { ...current, records: planned.records, batches } : current;
    const receipt: PortalReimportReceipt = {
      scope: { ...scope }, before: clone(content(current)), after: clone(content(ledger)),
      added: planned.added.length, updated: replacementMap.size,
      duplicates: resolved.duplicates + planned.duplicates.length, kept: resolved.kept,
      batchId: changed ? id : null,
    };
    return { ledger, result: receipt };
  });
}

/** Session-only rollback. Never undo a newer edit, sync result or another account's records. */
export function undoPortalReimport(scope: PersonalImportScope, receipt: PortalReimportReceipt, active = () => true) {
  const input = clone(receipt);
  return mutatePersonalImportLedger(scope, active, (current) => {
    if (!input.batchId || !input.added && !input.updated) throw new Error('這次沒有新增或更新可撤回。');
    assertCurrent(scope, input.scope, current, input.after);
    // Sync metadata belongs to the latest ledger; only this session's unchanged content is restored.
    const ledger: PersonalImportLedger = { ...current, ...clone(input.before) };
    return { ledger, result: { removed: input.added, restored: input.updated } };
  });
}
