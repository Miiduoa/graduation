import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  parsePersonalImport,
  PERSONAL_IMPORT_SYNCED,
  PERSONAL_IMPORT_SYNCING,
  PERSONAL_IMPORT_SYNC_NETWORK_FAILURE,
  type PersonalImportRecord,
} from '@campus/shared';
import type { PersonalImportSnapshot } from '@campus/shared/src/imports/sync';
import { browserRequest } from '@/features/nuni/Session';
import {
  changePersonalImport,
  personalImportsStorageKey,
  readPersonalImports,
  readPersonalImportSyncState,
  savePersonalImportBatch,
} from './personalImports';
import {
  cancelPersonalImportSync,
  getPersonalImportSyncStatus,
  setPersonalImportSyncEnabled,
  subscribePersonalImportSync,
  syncPersonalImports,
} from './personalImportSync';
vi.mock('@/features/nuni/Session', () => ({ browserRequest: vi.fn() }));
const scope = { owner: 'platform:one', schoolId: 'pu' };
const identity = { platformAccountId: 'one', context: 'context-one' };
const rows = (title = '資料庫') =>
  parsePersonalImport(`課程名稱,學分,成績\n${title},3,85`, {
    kind: 'grades',
    schoolId: 'pu',
    academicYear: '115',
    semester: '1',
  }).rows;
const now = '2026-10-18T00:00:00.000Z';
let remote: PersonalImportSnapshot;
let accepted: Map<string, Record<string, unknown>>;
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
beforeEach(() => {
  localStorage.clear();
  cancelPersonalImportSync(scope);
  remote = { schoolId: 'pu', records: [], revision: 0, updatedAt: null };
  accepted = new Map();
  vi.mocked(browserRequest)
    .mockReset()
    .mockImplementation(async (path, _context, input) => {
      if (path === 'personal-imports/read') return structuredClone(remote);
      const mutation = String(input!.mutationId);
      if (accepted.has(mutation)) {
        expect(accepted.get(mutation)).toEqual(input);
        return structuredClone(remote);
      }
      if (input!.expectedRevision !== remote.revision)
        throw Object.assign(new Error('conflict'), { code: 'PERSONAL_IMPORT_REVISION_CONFLICT' });
      accepted.set(mutation, structuredClone(input!));
      remote = {
        ...remote,
        records: input!.records as PersonalImportRecord[],
        revision: remote.revision + 1,
        updatedAt: now,
      };
      return structuredClone(remote);
    });
  const queues = new Map<string, Promise<unknown>>();
  Object.defineProperty(navigator, 'locks', {
    configurable: true,
    value: {
      request: (key: string, action: () => unknown) => {
        const next = (queues.get(key) || Promise.resolve()).then(action);
        queues.set(
          key,
          next.catch(() => {}),
        );
        return next;
      },
    },
  });
});

describe('browser personal import synchronization', () => {
  it('requires per-account and per-school consent before any network request', async () => {
    await savePersonalImportBatch(scope, rows());
    await syncPersonalImports(scope, identity, () => true);
    expect(browserRequest).not.toHaveBeenCalled();
    expect(getPersonalImportSyncStatus(scope)).toBeNull();
    await setPersonalImportSyncEnabled(scope, true, () => true);
    await syncPersonalImports(scope, { ...identity, platformAccountId: 'two' }, () => true);
    await syncPersonalImports({ ...scope, schoolId: 'personal' }, identity, () => true);
    await syncPersonalImports({ ...scope, schoolId: 'ntu' }, identity, () => true);
    expect(browserRequest).not.toHaveBeenCalled();
    await syncPersonalImports(scope, identity, () => true);
    expect(remote.records).toEqual(readPersonalImports(scope));
    expect(readPersonalImportSyncState(scope).base).toEqual(remote);
    expect(vi.mocked(browserRequest).mock.calls.every((call) => call[1] === 'context-one')).toBe(
      true,
    );
  });

  it('keeps local data and consent after a failed request and retries successfully', async () => {
    await savePersonalImportBatch(scope, rows());
    await setPersonalImportSyncEnabled(scope, true, () => true);
    const before = localStorage.getItem(personalImportsStorageKey(scope));
    vi.mocked(browserRequest).mockRejectedValueOnce(new Error('network unavailable'));
    await syncPersonalImports(scope, identity, () => true);
    expect(getPersonalImportSyncStatus(scope)).toMatchObject({
      phase: 'error',
      message: PERSONAL_IMPORT_SYNC_NETWORK_FAILURE,
    });
    expect(localStorage.getItem(personalImportsStorageKey(scope))).toBe(before);
    expect(remote.revision).toBe(0);
    await syncPersonalImports(scope, identity, () => true);
    expect(getPersonalImportSyncStatus(scope)).toMatchObject({
      phase: 'synced',
      message: PERSONAL_IMPORT_SYNCED,
    });
    expect(remote.records).toHaveLength(1);
  });

  it('serializes a local import behind a cloud write without losing either record', async () => {
    await savePersonalImportBatch(scope, rows());
    await setPersonalImportSyncEnabled(scope, true, () => true);
    const reading = deferred<unknown>();
    vi.mocked(browserRequest).mockImplementationOnce(() => reading.promise);
    const sync = syncPersonalImports(scope, identity, () => true);
    await vi.waitFor(() => expect(browserRequest).toHaveBeenCalledTimes(1));
    expect(getPersonalImportSyncStatus(scope)).toMatchObject({
      phase: 'syncing',
      message: PERSONAL_IMPORT_SYNCING,
    });
    const saved = savePersonalImportBatch(scope, rows('英文'));
    expect(readPersonalImports(scope)).toHaveLength(1);
    reading.resolve(structuredClone(remote));
    await Promise.all([sync, saved]);
    expect(getPersonalImportSyncStatus(scope)).toMatchObject({
      phase: 'synced',
      message: PERSONAL_IMPORT_SYNCED,
    });
    expect(readPersonalImports(scope).map((row) => row.title)).toEqual(['資料庫', '英文']);
    expect(remote.records.map((row) => row.title)).toEqual(['資料庫']);
    await syncPersonalImports(scope, identity, () => true);
    expect(remote.records.map((row) => row.title)).toEqual(['資料庫', '英文']);
  });

  it('pauses a pending read before it uploads, while preserving the local ledger', async () => {
    await savePersonalImportBatch(scope, rows());
    await setPersonalImportSyncEnabled(scope, true, () => true);
    const reading = deferred<unknown>();
    vi.mocked(browserRequest).mockImplementationOnce(() => reading.promise);
    const sync = syncPersonalImports(scope, identity, () => true);
    await vi.waitFor(() => expect(browserRequest).toHaveBeenCalledTimes(1));
    const paused = setPersonalImportSyncEnabled(scope, false, () => true);
    reading.resolve(structuredClone(remote));
    await Promise.all([sync, paused]);
    expect(browserRequest).toHaveBeenCalledTimes(1);
    expect(readPersonalImportSyncState(scope).enabled).toBe(false);
    expect(readPersonalImports(scope)).toHaveLength(1);
    expect(remote.records).toEqual([]);
    expect(getPersonalImportSyncStatus(scope)).toBeNull();
    await syncPersonalImports(scope, identity, () => true);
    expect(browserRequest).toHaveBeenCalledTimes(1);
  });

  it('does not apply a response after identity changes and does not cancel the new context', async () => {
    await savePersonalImportBatch(scope, rows());
    await setPersonalImportSyncEnabled(scope, true, () => true);
    const reading = deferred<unknown>();
    vi.mocked(browserRequest).mockImplementationOnce(() => reading.promise);
    let active = true;
    const stale = syncPersonalImports(scope, identity, () => active);
    await vi.waitFor(() => expect(browserRequest).toHaveBeenCalledTimes(1));
    active = false;
    cancelPersonalImportSync(scope);
    const next = syncPersonalImports(scope, { ...identity, context: 'context-two' }, () => true);
    reading.resolve(structuredClone(remote));
    await Promise.all([stale, next]);
    expect(
      vi
        .mocked(browserRequest)
        .mock.calls.filter((call) => call[0].endsWith('/write'))
        .map((call) => call[1]),
    ).toEqual(['context-two']);
    expect(getPersonalImportSyncStatus(scope)).toMatchObject({ phase: 'synced' });
    expect(remote.records).toHaveLength(1);
  });

  it('preserves both versions in a conflict, rejects stale review, and applies a fresh choice', async () => {
    await savePersonalImportBatch(scope, rows());
    await setPersonalImportSyncEnabled(scope, true, () => true);
    await syncPersonalImports(scope, identity, () => true);
    const original = readPersonalImports(scope)[0];
    await changePersonalImport(scope, original, { ...original, grade: '90' });
    remote = { ...remote, revision: 2, records: [{ ...remote.records[0], grade: '60' }] };
    await syncPersonalImports(scope, identity, () => true);
    const conflict = getPersonalImportSyncStatus(scope)!.result!;
    expect(getPersonalImportSyncStatus(scope)?.phase).toBe('conflict');
    expect(readPersonalImports(scope)[0].grade).toBe('90');
    expect(remote.records[0].grade).toBe('60');
    const resolution = {
      ...conflict.review!,
      choices: { [conflict.conflicts[0].key]: 'remote' as const },
    };
    remote = { ...remote, revision: 3, records: [{ ...remote.records[0], grade: '70' }] };
    await syncPersonalImports(scope, identity, () => true, resolution);
    expect(getPersonalImportSyncStatus(scope)).toMatchObject({
      phase: 'error',
      message: expect.stringContaining('又有變更'),
    });
    expect(readPersonalImports(scope)[0].grade).toBe('90');
    await syncPersonalImports(scope, identity, () => true);
    const fresh = getPersonalImportSyncStatus(scope)!.result!;
    await syncPersonalImports(scope, identity, () => true, {
      ...fresh.review!,
      choices: { [fresh.conflicts[0].key]: 'remote' },
    });
    expect(readPersonalImports(scope)[0].grade).toBe('70');
    expect(getPersonalImportSyncStatus(scope)?.phase).toBe('synced');
  });

  it('recovers a server acknowledgement after local storage fails without duplicating the record', async () => {
    await savePersonalImportBatch(scope, rows());
    await setPersonalImportSyncEnabled(scope, true, () => true);
    const before = readPersonalImports(scope);
    const originalWrite = Storage.prototype.setItem;
    const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (
      this: Storage,
      key,
      value,
    ) {
      if (JSON.parse(value).sync?.base && !JSON.parse(value).sync?.pending)
        throw new Error('quota');
      originalWrite.call(this, key, value);
    });
    try {
      await syncPersonalImports(scope, identity, () => true);
      expect(getPersonalImportSyncStatus(scope)).toMatchObject({
        phase: 'error',
        message: expect.stringContaining('空間不足'),
      });
      expect(readPersonalImports(scope)).toEqual(before);
      expect(readPersonalImportSyncState(scope).pending).toBeDefined();
      expect(remote.records).toHaveLength(1);
      expect(remote.revision).toBe(1);
    } finally {
      write.mockRestore();
    }
    await syncPersonalImports(scope, identity, () => true);
    expect(readPersonalImports(scope)).toEqual(remote.records);
    expect(readPersonalImportSyncState(scope).base?.revision).toBe(1);
    expect(remote.revision).toBe(1);
    expect(getPersonalImportSyncStatus(scope)?.phase).toBe('synced');
  });

  it('persists the exact pending request across reload, pause and later remote deletion', async () => {
    await savePersonalImportBatch(scope, rows());
    await setPersonalImportSyncEnabled(scope, true, () => true);
    const send = vi.mocked(browserRequest).getMockImplementation()!;
    vi.mocked(browserRequest).mockImplementation(async (path, context, input) => {
      const result = await send(path, context, input);
      if (path.endsWith('/write')) throw new Error('ack lost');
      return result;
    });
    await syncPersonalImports(scope, identity, () => true);
    const stored = localStorage.getItem(personalImportsStorageKey(scope))!;
    const originalPending = JSON.parse(stored).sync.pending;
    expect(originalPending).toBeDefined();
    remote = { ...remote, revision: 2, records: [] };
    cancelPersonalImportSync(scope);
    localStorage.clear();
    localStorage.setItem(personalImportsStorageKey(scope), stored);
    await setPersonalImportSyncEnabled(scope, false, () => true);
    expect(readPersonalImportSyncState(scope).pending).toEqual(originalPending);
    await setPersonalImportSyncEnabled(scope, true, () => true);
    vi.mocked(browserRequest).mockImplementation(send).mockClear();
    await syncPersonalImports(scope, identity, () => true);
    expect(vi.mocked(browserRequest).mock.calls[0]).toEqual([
      'personal-imports/write',
      identity.context,
      { schoolId: 'pu', ...originalPending },
    ]);
    expect(readPersonalImports(scope)).toEqual([]);
    expect(remote.revision).toBe(2);
    expect(readPersonalImportSyncState(scope).pending).toBeUndefined();
  });

  it('keeps a post-send local edit during pending replay and requests review against remote deletion', async () => {
    await savePersonalImportBatch(scope, rows());
    await setPersonalImportSyncEnabled(scope, true, () => true);
    const send = vi.mocked(browserRequest).getMockImplementation()!;
    vi.mocked(browserRequest).mockImplementation(async (path, context, input) => {
      const result = await send(path, context, input);
      if (path.endsWith('/write')) throw new Error('ack lost');
      return result;
    });
    await syncPersonalImports(scope, identity, () => true);
    const original = readPersonalImports(scope)[0];
    await changePersonalImport(scope, original, { ...original, grade: '99' });
    remote = { ...remote, revision: 2, records: [] };
    vi.mocked(browserRequest).mockImplementation(send);
    await syncPersonalImports(scope, identity, () => true);
    expect(getPersonalImportSyncStatus(scope)?.phase).toBe('conflict');
    expect(readPersonalImports(scope)[0].grade).toBe('99');
    expect(readPersonalImportSyncState(scope).base?.records[0].grade).toBe('85');
    expect(remote.records).toEqual([]);
  });

  it('does not send a write when the durable pending checkpoint cannot be saved', async () => {
    await savePersonalImportBatch(scope, rows());
    await setPersonalImportSyncEnabled(scope, true, () => true);
    const before = localStorage.getItem(personalImportsStorageKey(scope));
    const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => {
      throw new Error('quota');
    });
    try {
      await syncPersonalImports(scope, identity, () => true);
    } finally {
      write.mockRestore();
    }
    expect(browserRequest).toHaveBeenCalledTimes(1);
    expect(remote.revision).toBe(0);
    expect(localStorage.getItem(personalImportsStorageKey(scope))).toBe(before);
  });

  it('shares one in-flight run across triggers and isolates view subscriber failures', async () => {
    await savePersonalImportBatch(scope, rows());
    await setPersonalImportSyncEnabled(scope, true, () => true);
    const stop = subscribePersonalImportSync(() => {
      throw new Error('broken view');
    });
    try {
      const first = syncPersonalImports(scope, identity, () => true);
      expect(syncPersonalImports(scope, identity, () => true)).toBe(first);
      await first;
      expect(remote.revision).toBe(1);
      expect(browserRequest).toHaveBeenCalledTimes(2);
      expect(getPersonalImportSyncStatus(scope)?.phase).toBe('synced');
    } finally {
      stop();
    }
  });
});
