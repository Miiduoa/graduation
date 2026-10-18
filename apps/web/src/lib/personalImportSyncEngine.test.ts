import { describe, expect, it, vi } from 'vitest';
import { parsePersonalImport, planPersonalImport, type PersonalImportRecord } from '@campus/shared';
import { mergePersonalImportRecords, parsePersonalImportSnapshot, validatePersonalImportSyncRecords, type PersonalImportSnapshot } from '@campus/shared/src/imports/sync';
import { performPersonalImportSync, type PersonalImportLocalState } from '@campus/shared/src/imports/syncEngine';
const now = '2026-10-15T00:00:00.000Z';
const record = (title = '資料庫', id = 'row1', grade = '85'): PersonalImportRecord => ({ ...planPersonalImport([], parsePersonalImport(`課程名稱,學分,成績\n${title},3,${grade}`, { kind: 'grades', schoolId: 'pu', academicYear: '115', semester: '1' }).rows, { batchId: 'batch1', importedAt: now }).records[0], id });
const snapshot = (records: PersonalImportRecord[], revision = 1): PersonalImportSnapshot => ({ schoolId: 'pu', records, revision, updatedAt: revision ? now : null });
const state = (records: PersonalImportRecord[], base: PersonalImportSnapshot | null = null): PersonalImportLocalState => ({ records, sync: { enabled: true, base } });
function server(initial: PersonalImportSnapshot) {
  let current = initial;
  const transport = vi.fn(async (path: string, input: Record<string, unknown>) => {
    if (path.endsWith('/read')) return structuredClone(current);
    if (input.expectedRevision !== current.revision) throw new Error('revision conflict');
    current = snapshot(input.records as PersonalImportRecord[], current.revision + 1);
    return structuredClone(current);
  });
  return { transport, current: () => current };
}
describe('cross-device personal imports', () => {
  it('uploads once, downloads on another device, and merges independent changes', async () => {
    const api = server(snapshot([], 0));
    const first = await performPersonalImportSync('pu', state([record()]), api.transport, () => true);
    const second = await performPersonalImportSync('pu', state([]), api.transport, () => true);
    expect(second.state.records).toEqual(first.state.records);
    const edited = { ...first.state, records: [{ ...first.state.records[0], grade: '88' }] };
    await performPersonalImportSync('pu', edited, api.transport, () => true);
    const appended = { ...second.state, records: [...second.state.records, record('英文', 'row2')] };
    const merged = await performPersonalImportSync('pu', appended, api.transport, () => true);
    expect(merged.state.records.map((row) => [row.title, row.grade])).toEqual([['資料庫', '88'], ['英文', '85']]);
    expect(merged.state.sync?.base?.records).toEqual(merged.state.records);
  });
  it('does not resurrect a remotely deleted row on an unchanged device', async () => {
    const original = record(); const base = snapshot([original]);
    const api = server(snapshot([], 2));
    const result = await performPersonalImportSync('pu', state([original], base), api.transport, () => true);
    expect(result.state.records).toEqual([]); expect(api.transport).toHaveBeenCalledTimes(1);
  });
  it('requires review for edit versus deletion and only applies explicit choices', async () => {
    const original = record(); const base = snapshot([original]); const local = state([{ ...original, grade: '99' }], base);
    const api = server(snapshot([], 2));
    const conflict = await performPersonalImportSync('pu', local, api.transport, () => true);
    expect(conflict.state).toBe(local); expect(conflict.conflicts[0].remote).toEqual([]);
    expect(api.current().records).toEqual([]);
    const result = await performPersonalImportSync('pu', local, api.transport, () => true, { ...conflict.review!, choices: { [conflict.conflicts[0].key]: 'local' } });
    expect(result.state.records[0].grade).toBe('99');
  });
  it('deduplicates identical separate imports but asks before replacing a changed grade', () => {
    const local = record('資料庫', 'local'); const remote = record('資料庫', 'remote');
    expect(mergePersonalImportRecords([], [local], [remote]).records).toEqual([remote]);
    const changed = { ...remote, grade: '60' };
    const conflict = mergePersonalImportRecords([], [local], [changed]);
    expect(conflict.conflicts[0].reason).toBe('duplicate');
    expect(mergePersonalImportRecords([], [local], [changed], { [conflict.conflicts[0].key]: 'remote' }).records).toEqual([changed]);
  });
  it('rejects conflict choices when either device changed after review', async () => {
    const original = record(); const local = state([{ ...original, grade: '90' }], snapshot([original]));
    const api = server(snapshot([{ ...original, grade: '60' }], 2));
    const review = (await performPersonalImportSync('pu', local, api.transport, () => true)).review!;
    const resolution = { ...review, choices: { 'record:row1': 'local' as const } };
    await expect(performPersonalImportSync('pu', { ...local, records: [{ ...original, grade: '95' }] }, api.transport, () => true, resolution)).rejects.toThrow('又有變更');
    const newer = server(snapshot([{ ...original, grade: '70' }], 3));
    await expect(performPersonalImportSync('pu', local, newer.transport, () => true, resolution)).rejects.toThrow('又有變更');
  });
  it('keeps the input state on lost acknowledgement and recovers without duplication', async () => {
    const local = state([record()]); const api = server(snapshot([], 0));
    const lossy = async (path: string, input: Record<string, unknown>) => { const result = await api.transport(path, input); if (path.endsWith('/write')) throw new Error('offline'); return result; };
    await expect(performPersonalImportSync('pu', local, lossy, () => true)).rejects.toThrow('offline');
    expect(local.sync?.base).toBeNull();
    const retry = await performPersonalImportSync('pu', local, api.transport, () => true);
    expect(retry.state.records).toHaveLength(1); expect(api.current().revision).toBe(1);
  });
  it('does not send before consent or write after account switch', async () => {
    const api = server(snapshot([], 0));
    await performPersonalImportSync('pu', { records: [record()] }, api.transport, () => true);
    expect(api.transport).not.toHaveBeenCalled();
    let active = true;
    const changing = async (path: string, input: Record<string, unknown>) => { const result = await api.transport(path, input); active = false; return result; };
    await expect(performPersonalImportSync('pu', state([record()]), changing, () => active)).rejects.toThrow('帳號或校園');
    expect(api.current().revision).toBe(0);
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
