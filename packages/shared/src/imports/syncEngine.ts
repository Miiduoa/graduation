import { createPersonalImportId } from './records';
import type { PersonalImportRecord } from './types';
import {
  mergePersonalImportRecords,
  parsePersonalImportSnapshot,
  parsePersonalImportSyncState,
  personalImportRecordsEqual,
  validatePersonalImportSyncRecords,
  type PersonalImportAcknowledgement,
  type PersonalImportSnapshot,
  type PersonalImportSyncChoices,
  type PersonalImportSyncConflict,
  type PersonalImportSyncState,
} from './sync';

export type PersonalImportLocalState = {
  records: PersonalImportRecord[];
  sync?: PersonalImportSyncState;
};
export type PersonalImportSyncReview = {
  remoteRevision: number;
  baseRevision: number;
  localRecords: PersonalImportRecord[];
  pendingMutationId?: string;
  acknowledged?: PersonalImportAcknowledgement[];
};
export type PersonalImportSyncResolution = PersonalImportSyncReview & {
  choices: PersonalImportSyncChoices;
};
export type PersonalImportSyncResult = {
  state: PersonalImportLocalState;
  conflicts: PersonalImportSyncConflict[];
  review?: PersonalImportSyncReview;
  detachedCourseLinks: string[];
};
export type PersonalImportSyncTransport = (
  path: string,
  input: Record<string, unknown>,
) => Promise<unknown>;
export type PersonalImportSyncCheckpoint = (state: PersonalImportLocalState) => Promise<void>;

function sameAcknowledgements(
  left: readonly PersonalImportAcknowledgement[] | undefined,
  right: readonly PersonalImportAcknowledgement[] | undefined,
): boolean {
  if (left !== undefined && !Array.isArray(left)) return false;
  const first = left || [];
  const second = right || [];
  if (first.length !== second.length) return false;
  return first.every((item) => {
    const other = second.find((candidate) => candidate.record.id === item?.record?.id);
    return !!other && item.revision === other.revision &&
      personalImportRecordsEqual([item.record], [other.record]);
  });
}

/** A stale/full snapshot cannot contradict a row already read at that exact revision. */
function assertAcknowledgedSnapshot(sync: PersonalImportSyncState, snapshot: PersonalImportSnapshot) {
  for (const item of sync.acknowledged || []) {
    if (snapshot.revision < item.revision)
      throw new Error('帳號同步版本比已核對的行程舊，資料仍保留，請稍後再試。');
    if (
      snapshot.revision === item.revision &&
      !personalImportRecordsEqual(snapshot.records.filter((row) => row.id === item.record.id), [item.record])
    )
      throw new Error('同版本的行程核對結果不一致，資料仍保留，請重新確認帳號資料。');
  }
}

function uncoveredAcknowledgements(sync: PersonalImportSyncState, base: PersonalImportSnapshot) {
  const remaining = (sync.acknowledged || []).filter((item) => {
    if (
      base.revision === item.revision &&
      !personalImportRecordsEqual(base.records.filter((row) => row.id === item.record.id), [item.record])
    )
      throw new Error('同版本的行程核對結果不一致，資料仍保留，請重新確認帳號資料。');
    return item.revision > base.revision;
  });
  return remaining.length ? { acknowledged: remaining } : {};
}

/** Only this merge input overlays single-row evidence; the stored full base stays honest. */
function mergeBase(sync: PersonalImportSyncState) {
  const rows = new Map((sync.base?.records || []).map((row) => [row.id, row]));
  for (const item of sync.acknowledged || []) {
    if (!sync.base || item.revision > sync.base.revision) rows.set(item.record.id, item.record);
  }
  return [...rows.values()];
}

/** Hold the local mutation lock throughout. Checkpoint atomically before any remote write. */
export async function performPersonalImportSync(
  schoolId: string,
  current: PersonalImportLocalState,
  transport: PersonalImportSyncTransport,
  active: () => boolean,
  resolution: PersonalImportSyncResolution | undefined,
  checkpoint: PersonalImportSyncCheckpoint,
): Promise<PersonalImportSyncResult> {
  const requireActive = () => {
    if (!active()) throw new Error('帳號或校園已切換，這次同步已停止。');
  };
  const persist = async (state: PersonalImportLocalState) => {
    requireActive();
    await checkpoint(state);
    requireActive();
  };
  const read = async () => {
    const snapshot = parsePersonalImportSnapshot(
      await transport('personal-imports/read', { schoolId }),
      schoolId,
    );
    requireActive();
    return snapshot;
  };
  requireActive();
  if (!current.sync?.enabled) return { state: current, conflicts: [], detachedCourseLinks: [] };
  let local = validatePersonalImportSyncRecords(current.records, schoolId);
  let sync = parsePersonalImportSyncState(current.sync, schoolId);
  let working = current;
  let base = sync.base;
  let remote: PersonalImportSnapshot;
  const pending = sync.pending;
  if (pending) {
    try {
      // The server returns its CURRENT snapshot on a successful replay. The exact
      // pending payload, not that current snapshot, is the acknowledged baseline.
      remote = parsePersonalImportSnapshot(
        await transport('personal-imports/write', { schoolId, ...pending }),
        schoolId,
      );
      requireActive();
      if (remote.revision <= pending.expectedRevision)
        throw new Error('同步回應未確認上次寫入，原有資料仍保留。');
      assertAcknowledgedSnapshot(sync, remote);
      base = {
        schoolId,
        revision: pending.expectedRevision + 1,
        records: pending.records,
        updatedAt: remote.updatedAt,
      };
      sync = { enabled: true, base, ...uncoveredAcknowledgements(sync, base) };
      working = { records: local, sync };
      await persist(working);
      if (resolution?.pendingMutationId)
        throw new Error('核對期間資料又有變更，請重新同步後選擇要保留的內容。');
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error ? error.code : '';
      if (code !== 'PERSONAL_IMPORT_REVISION_CONFLICT') throw error;
      // A forgotten idempotency key and a never-accepted write are indistinguishable.
      // Never turn either into a new upload without an explicit whole-ledger choice.
      remote = await read();
      if (base && remote.revision < base.revision)
        throw new Error('帳號同步版本比這台裝置已確認的版本舊，資料仍保留，請稍後再試。');
      assertAcknowledgedSnapshot(sync, remote);
      const key = `pending:${pending.mutationId}`;
      const review: PersonalImportSyncReview = {
        remoteRevision: remote.revision,
        baseRevision: base?.revision ?? 0,
        localRecords: local,
        pendingMutationId: pending.mutationId,
        ...(sync.acknowledged ? { acknowledged: sync.acknowledged } : {}),
      };
      if (!resolution)
        return {
          state: current,
          conflicts: [
            {
              key,
              reason: 'unconfirmed',
              title: '上次同步尚未確認',
              local,
              remote: remote.records,
            },
          ],
          review,
          detachedCourseLinks: remote.detachedCourseLinks || [],
        };
      if (
        resolution.pendingMutationId !== pending.mutationId ||
        resolution.remoteRevision !== remote.revision ||
        resolution.baseRevision !== (base?.revision ?? 0) ||
        !personalImportRecordsEqual(resolution.localRecords, local) ||
        !sameAcknowledgements(resolution.acknowledged, sync.acknowledged) ||
        !['local', 'remote'].includes(resolution.choices[key])
      ) {
        throw new Error('核對期間資料又有變更，請重新同步後選擇要保留的內容。');
      }
      local = resolution.choices[key] === 'remote' ? remote.records : local;
      base = remote;
      sync = { enabled: true, base };
      working = { records: local, sync };
      // Persist retirement of the old pending request only after explicit review.
      await persist(working);
      resolution = undefined;
    }
  } else {
    remote = await read();
  }
  if (base && remote.revision < base.revision)
    throw new Error('帳號同步版本比這台裝置已確認的版本舊，資料仍保留，請稍後再試。');
  assertAcknowledgedSnapshot(sync, remote);
  if (
    resolution &&
    (resolution.pendingMutationId ||
      resolution.remoteRevision !== remote.revision ||
      resolution.baseRevision !== (base?.revision ?? 0) ||
      !personalImportRecordsEqual(resolution.localRecords, local) ||
      !sameAcknowledgements(resolution.acknowledged, sync.acknowledged))
  ) {
    throw new Error('核對期間資料又有變更，請重新同步後選擇要保留的內容。');
  }
  const merged = mergePersonalImportRecords(
    mergeBase(sync),
    local,
    remote.records,
    resolution?.choices,
  );
  if (merged.conflicts.length)
    return {
      state: working,
      conflicts: merged.conflicts,
      detachedCourseLinks: remote.detachedCourseLinks || [],
      review: {
        remoteRevision: remote.revision,
        baseRevision: base?.revision ?? 0,
        localRecords: local,
        ...(sync.acknowledged ? { acknowledged: sync.acknowledged } : {}),
      },
    };
  const records = validatePersonalImportSyncRecords(merged.records, schoolId);
  requireActive();
  let snapshot = remote;
  if (!personalImportRecordsEqual(records, remote.records)) {
    const mutation = {
      expectedRevision: remote.revision,
      records,
      mutationId: `sync-${createPersonalImportId()}`,
    };
    // Install the merged local view as well: otherwise remote-only rows included in
    // this request would look like local deletions when recovering after a crash.
    await persist({ records, sync: { ...sync, enabled: true, base, pending: mutation } });
    snapshot = parsePersonalImportSnapshot(
      await transport('personal-imports/write', { schoolId, ...mutation }),
      schoolId,
    );
    requireActive();
    if (snapshot.revision <= remote.revision)
      throw new Error('同步回應未確認上次寫入，原有資料仍保留。');
  }
  return {
    state: { records: snapshot.records, sync: { enabled: true, base: snapshot } },
    conflicts: [],
    detachedCourseLinks: snapshot.detachedCourseLinks || [],
  };
}
