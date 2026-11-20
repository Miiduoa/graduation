import { describe, expect, it, vi } from 'vitest';
import { parsePersonalImport, planPersonalImport, type PersonalImportRecord } from '@campus/shared';
import {
  mergePersonalImportRecords,
  parsePersonalImportSnapshot,
  validatePersonalImportSyncRecords,
  type PersonalImportSnapshot,
} from '@campus/shared/src/imports/sync';
import {
  performPersonalImportSync as runPersonalImportSync,
  type PersonalImportSyncResolution,
  type PersonalImportSyncTransport,
  type PersonalImportLocalState,
} from '@campus/shared/src/imports/syncEngine';
async function performPersonalImportSync(
  school: string,
  current: PersonalImportLocalState,
  transport: PersonalImportSyncTransport,
  active: () => boolean,
  resolution?: PersonalImportSyncResolution,
) {
  const result = await runPersonalImportSync(
    school,
    current,
    transport,
    active,
    resolution,
    async (next) => {
      Object.assign(current, JSON.parse(JSON.stringify(next)));
    },
  );
  Object.assign(current, JSON.parse(JSON.stringify(result.state)));
  return result;
}
const now = '2026-10-15T00:00:00.000Z';
const record = (title = '資料庫', id = 'row1', grade = '85'): PersonalImportRecord => ({
  ...planPersonalImport(
    [],
    parsePersonalImport(`課程名稱,學分,成績\n${title},3,${grade}`, {
      kind: 'grades',
      schoolId: 'pu',
      academicYear: '115',
      semester: '1',
    }).rows,
    { batchId: 'batch1', importedAt: now },
  ).records[0],
  id,
});
const snapshot = (records: PersonalImportRecord[], revision = 1): PersonalImportSnapshot => ({
  schoolId: 'pu',
  records,
  revision,
  updatedAt: revision ? now : null,
});
const state = (
  records: PersonalImportRecord[],
  base: PersonalImportSnapshot | null = null,
): PersonalImportLocalState => ({ records, sync: { enabled: true, base } });
function server(initial: PersonalImportSnapshot) {
  let current = initial;
  const accepted = new Map<string, Record<string, unknown>>();
  const transport = vi.fn(async (path: string, input: Record<string, unknown>) => {
    if (path.endsWith('/read')) return structuredClone(current);
    const mutation = String(input.mutationId);
    const payload = structuredClone(input);
    if (accepted.has(mutation)) {
      expect(accepted.get(mutation)).toEqual(payload);
      return structuredClone(current);
    }
    if (input.expectedRevision !== current.revision)
      throw Object.assign(new Error('revision conflict'), {
        code: 'PERSONAL_IMPORT_REVISION_CONFLICT',
      });
    accepted.set(mutation, payload);
    current = snapshot(input.records as PersonalImportRecord[], current.revision + 1);
    return structuredClone(current);
  });
  return {
    transport,
    current: () => current,
    replace: (next: PersonalImportSnapshot) => {
      current = next;
    },
    prune: () => accepted.clear(),
  };
}
describe('cross-device personal imports', () => {
  it('uploads once, downloads on another device, and merges independent changes', async () => {
    const api = server(snapshot([], 0));
    const first = await performPersonalImportSync(
      'pu',
      state([record()]),
      api.transport,
      () => true,
    );
    const second = await performPersonalImportSync('pu', state([]), api.transport, () => true);
    expect(second.state.records).toEqual(first.state.records);
    const edited = { ...first.state, records: [{ ...first.state.records[0], grade: '88' }] };
    await performPersonalImportSync('pu', edited, api.transport, () => true);
    const appended = {
      ...second.state,
      records: [...second.state.records, record('英文', 'row2')],
    };
    const merged = await performPersonalImportSync('pu', appended, api.transport, () => true);
    expect(merged.state.records.map((row) => [row.title, row.grade])).toEqual([
      ['資料庫', '88'],
      ['英文', '85'],
    ]);
    expect(merged.state.sync?.base?.records).toEqual(merged.state.records);
  });
  it('does not resurrect a remotely deleted row on an unchanged device', async () => {
    const original = record();
    const base = snapshot([original]);
    const api = server(snapshot([], 2));
    const result = await performPersonalImportSync(
      'pu',
      state([original], base),
      api.transport,
      () => true,
    );
    expect(result.state.records).toEqual([]);
    expect(api.transport).toHaveBeenCalledTimes(1);
  });
  it('requires review for edit versus deletion and only applies explicit choices', async () => {
    const original = record();
    const base = snapshot([original]);
    const local = state([{ ...original, grade: '99' }], base);
    const api = server(snapshot([], 2));
    const conflict = await performPersonalImportSync('pu', local, api.transport, () => true);
    expect(conflict.state).toBe(local);
    expect(conflict.conflicts[0].remote).toEqual([]);
    expect(api.current().records).toEqual([]);
    const result = await performPersonalImportSync('pu', local, api.transport, () => true, {
      ...conflict.review!,
      choices: { [conflict.conflicts[0].key]: 'local' },
    });
    expect(result.state.records[0].grade).toBe('99');
  });
  it('deduplicates identical separate imports but asks before replacing a changed grade', () => {
    const local = record('資料庫', 'local');
    const remote = record('資料庫', 'remote');
    expect(mergePersonalImportRecords([], [local], [remote]).records).toEqual([remote]);
    const changed = { ...remote, grade: '60' };
    const conflict = mergePersonalImportRecords([], [local], [changed]);
    expect(conflict.conflicts[0].reason).toBe('duplicate');
    expect(
      mergePersonalImportRecords([], [local], [changed], { [conflict.conflicts[0].key]: 'remote' })
        .records,
    ).toEqual([changed]);
  });
  it('rejects conflict choices when either device changed after review', async () => {
    const original = record();
    const local = state([{ ...original, grade: '90' }], snapshot([original]));
    const api = server(snapshot([{ ...original, grade: '60' }], 2));
    const review = (await performPersonalImportSync('pu', local, api.transport, () => true))
      .review!;
    const resolution = { ...review, choices: { 'record:row1': 'local' as const } };
    await expect(
      performPersonalImportSync(
        'pu',
        { ...local, records: [{ ...original, grade: '95' }] },
        api.transport,
        () => true,
        resolution,
      ),
    ).rejects.toThrow('又有變更');
    const newer = server(snapshot([{ ...original, grade: '70' }], 3));
    await expect(
      performPersonalImportSync('pu', local, newer.transport, () => true, resolution),
    ).rejects.toThrow('又有變更');
  });
  it('keeps the input state on lost acknowledgement and recovers without duplication', async () => {
    const local = state([record()]);
    const api = server(snapshot([], 0));
    const lossy = async (path: string, input: Record<string, unknown>) => {
      const result = await api.transport(path, input);
      if (path.endsWith('/write')) throw new Error('offline');
      return result;
    };
    await expect(performPersonalImportSync('pu', local, lossy, () => true)).rejects.toThrow(
      'offline',
    );
    expect(local.sync?.base).toBeNull();
    const retry = await performPersonalImportSync('pu', local, api.transport, () => true);
    expect(retry.state.records).toHaveLength(1);
    expect(api.current().revision).toBe(1);
  });
  it('replays the durable request after reload without resurrecting a later remote deletion', async () => {
    const local = state([record()]);
    const api = server(snapshot([], 0));
    await expect(
      performPersonalImportSync(
        'pu',
        local,
        async (path, input) => {
          const result = await api.transport(path, input);
          if (path.endsWith('/write')) throw new Error('ack lost');
          return result;
        },
        () => true,
      ),
    ).rejects.toThrow('ack lost');
    const pending = structuredClone(local.sync!.pending!);
    expect(pending.records).toEqual(local.records);
    api.replace(snapshot([], 2));
    const reloaded = JSON.parse(JSON.stringify(local)) as PersonalImportLocalState;
    const result = await performPersonalImportSync('pu', reloaded, api.transport, () => true);
    expect(result.state.records).toEqual([]);
    expect(result.state.sync?.pending).toBeUndefined();
    expect(api.current().revision).toBe(2);
    const writes = api.transport.mock.calls.filter(([path]) => path.endsWith('/write'));
    expect(writes).toHaveLength(2);
    expect(writes[1][1]).toEqual({ schoolId: 'pu', ...pending });
  });
  it('preserves a new local edit after lost ACK and asks before accepting the remote deletion', async () => {
    const local = state([record()]);
    const api = server(snapshot([], 0));
    await expect(
      performPersonalImportSync(
        'pu',
        local,
        async (path, input) => {
          const result = await api.transport(path, input);
          if (path.endsWith('/write')) throw new Error('lost');
          return result;
        },
        () => true,
      ),
    ).rejects.toThrow();
    local.records[0] = { ...local.records[0], grade: '99' };
    api.replace(snapshot([], 2));
    const result = await performPersonalImportSync('pu', local, api.transport, () => true);
    expect(result.conflicts).toHaveLength(1);
    expect(result.state.records[0].grade).toBe('99');
    expect(result.state.sync?.base?.records[0].grade).toBe('85');
    expect(api.current().records).toEqual([]);
  });
  it('does not interpret remote-only records included in a lost write as later local deletions', async () => {
    const remoteOnly = record('英文', 'remote-only');
    const api = server(snapshot([remoteOnly], 1));
    const local = state([record()]);
    await expect(
      performPersonalImportSync(
        'pu',
        local,
        async (path, input) => {
          const result = await api.transport(path, input);
          if (path.endsWith('/write')) throw new Error('lost');
          return result;
        },
        () => true,
      ),
    ).rejects.toThrow();
    expect(local.records).toHaveLength(2);
    const result = await performPersonalImportSync('pu', local, api.transport, () => true);
    expect(result.state.records).toHaveLength(2);
    expect(api.current().revision).toBe(2);
  });
  it('retains an unconfirmable mutation until explicit review and supports adopting current account data', async () => {
    const local = state([record()]);
    const api = server(snapshot([], 0));
    await expect(
      performPersonalImportSync(
        'pu',
        local,
        async (path, input) => {
          const result = await api.transport(path, input);
          if (path.endsWith('/write')) throw new Error('lost');
          return result;
        },
        () => true,
      ),
    ).rejects.toThrow();
    api.replace(snapshot([], 2));
    api.prune();
    const pending = structuredClone(local.sync!.pending);
    const conflict = await performPersonalImportSync('pu', local, api.transport, () => true);
    expect(conflict.conflicts[0].reason).toBe('unconfirmed');
    expect(local.sync?.pending).toEqual(pending);
    expect(local.records).toHaveLength(1);
    const done = await performPersonalImportSync('pu', local, api.transport, () => true, {
      ...conflict.review!,
      choices: { [conflict.conflicts[0].key]: 'remote' },
    });
    expect(done.state.records).toEqual([]);
    expect(done.state.sync?.pending).toBeUndefined();
    expect(api.current().revision).toBe(2);
  });
  it('rejects stale pending review, and only an explicit local choice creates a new mutation', async () => {
    const local = state([record()]);
    const api = server(snapshot([], 0));
    await expect(
      performPersonalImportSync(
        'pu',
        local,
        async (path, input) => {
          const result = await api.transport(path, input);
          if (path.endsWith('/write')) throw new Error('lost');
          return result;
        },
        () => true,
      ),
    ).rejects.toThrow();
    api.replace(snapshot([], 2));
    api.prune();
    const first = await performPersonalImportSync('pu', local, api.transport, () => true);
    api.replace(snapshot([], 3));
    await expect(
      performPersonalImportSync('pu', local, api.transport, () => true, {
        ...first.review!,
        choices: { [first.conflicts[0].key]: 'local' },
      }),
    ).rejects.toThrow('又有變更');
    const fresh = await performPersonalImportSync('pu', local, api.transport, () => true);
    await performPersonalImportSync('pu', local, api.transport, () => true, {
      ...fresh.review!,
      choices: { [fresh.conflicts[0].key]: 'local' },
    });
    expect(api.current().records).toHaveLength(1);
    expect(api.current().revision).toBe(4);
  });
  it('does not send before consent or write after account switch', async () => {
    const api = server(snapshot([], 0));
    await performPersonalImportSync('pu', { records: [record()] }, api.transport, () => true);
    expect(api.transport).not.toHaveBeenCalled();
    let active = true;
    const changing = async (path: string, input: Record<string, unknown>) => {
      const result = await api.transport(path, input);
      active = false;
      return result;
    };
    await expect(
      performPersonalImportSync('pu', state([record()]), changing, () => active),
    ).rejects.toThrow('帳號或校園');
    expect(api.current().revision).toBe(0);
  });
  it('rejects a server snapshot older than the acknowledged base without resurrecting deleted data', async () => {
    const old = record();
    const current = state([], snapshot([], 3));
    const api = server(snapshot([old], 2));
    await expect(
      performPersonalImportSync('pu', current, api.transport, () => true),
    ).rejects.toThrow('已確認的版本舊');
    expect(current.records).toEqual([]);
    expect(api.transport).toHaveBeenCalledTimes(1);
  });
  it('rejects cross-school, injected authority, duplicate IDs, and invalid snapshots', () => {
    const row = record();
    expect(() => validatePersonalImportSyncRecords([{ ...row, schoolId: 'ntu' }], 'pu')).toThrow();
    expect(() => validatePersonalImportSyncRecords([{ ...row, verified: true }], 'pu')).toThrow();
    expect(() => validatePersonalImportSyncRecords([row, row], 'pu')).toThrow();
    expect(() => parsePersonalImportSnapshot(snapshot([row], 0), 'pu')).toThrow();
    expect(() => parsePersonalImportSnapshot(snapshot([row]), 'ntu')).toThrow();
  });
});
