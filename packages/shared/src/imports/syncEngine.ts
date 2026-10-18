import { createPersonalImportId } from './records';
import type { PersonalImportRecord } from './types';
import {
  mergePersonalImportRecords, parsePersonalImportSnapshot, personalImportRecordsEqual,
  validatePersonalImportSyncRecords, type PersonalImportSyncChoices,
  type PersonalImportSyncConflict, type PersonalImportSyncState,
} from './sync';

export type PersonalImportLocalState = { records: PersonalImportRecord[]; sync?: PersonalImportSyncState };
export type PersonalImportSyncReview = {
  remoteRevision: number;
  baseRevision: number;
  localRecords: PersonalImportRecord[];
};
export type PersonalImportSyncResolution = PersonalImportSyncReview & { choices: PersonalImportSyncChoices };
export type PersonalImportSyncResult = {
  state: PersonalImportLocalState;
  conflicts: PersonalImportSyncConflict[];
  review?: PersonalImportSyncReview;
  detachedCourseLinks: string[];
};
export type PersonalImportSyncTransport = (path: string, input: Record<string, unknown>) => Promise<unknown>;

/** Call under the same per-scope lock as local mutations; persist state as one atomic envelope. */
export async function performPersonalImportSync(
  schoolId: string, current: PersonalImportLocalState, transport: PersonalImportSyncTransport,
  active: () => boolean, resolution?: PersonalImportSyncResolution,
): Promise<PersonalImportSyncResult> {
  const requireActive = () => { if (!active()) throw new Error('帳號或校園已切換，這次同步已停止。'); };
  requireActive();
  if (!current.sync?.enabled) return { state: current, conflicts: [], detachedCourseLinks: [] };
  const local = validatePersonalImportSyncRecords(current.records, schoolId);
  const base = current.sync.base ? parsePersonalImportSnapshot(current.sync.base, schoolId) : null;
  const remote = parsePersonalImportSnapshot(await transport('personal-imports/read', { schoolId }), schoolId);
  requireActive();
  if (resolution && (resolution.remoteRevision !== remote.revision || resolution.baseRevision !== (base?.revision ?? 0) ||
    !personalImportRecordsEqual(resolution.localRecords, local))) {
    throw new Error('核對期間資料又有變更，請重新同步後選擇要保留的內容。');
  }
  const merged = mergePersonalImportRecords(base?.records || [], local, remote.records, resolution?.choices);
  if (merged.conflicts.length) return {
    state: current, conflicts: merged.conflicts, detachedCourseLinks: remote.detachedCourseLinks || [],
    review: { remoteRevision: remote.revision, baseRevision: base?.revision ?? 0, localRecords: local },
  };
  const records = validatePersonalImportSyncRecords(merged.records, schoolId);
  requireActive();
  const snapshot = personalImportRecordsEqual(records, remote.records) ? remote : parsePersonalImportSnapshot(
    await transport('personal-imports/write', {
      schoolId, expectedRevision: remote.revision, records, mutationId: `sync-${createPersonalImportId()}`,
    }), schoolId);
  requireActive();
  if (snapshot.revision < remote.revision) throw new Error('同步版本過舊，這台裝置的資料仍保留。');
  return {
    state: { records: snapshot.records, sync: { enabled: true, base: snapshot } }, conflicts: [],
    detachedCourseLinks: snapshot.detachedCourseLinks || [],
  };
}
