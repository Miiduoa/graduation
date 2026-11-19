import { beforeEach, expect, it, vi } from 'vitest';
import {
  collection,
  doc,
  documentId,
  getDocFromServer,
  getDocsFromServer,
  limit,
  orderBy,
  startAfter,
  where,
} from 'firebase/firestore';
import { getDb, isFirebaseConfigured } from './firebase';
import { loadCampusEvent, loadCampusEventPage } from './campusEvents';
import type { PublicCampusReadGuard } from './publicCampusReadGuard';

vi.mock('firebase/firestore', () => ({
  collection: vi.fn((...args: unknown[]) => args),
  doc: vi.fn((...args: unknown[]) => args),
  documentId: vi.fn(() => '__name__'),
  startAfter: vi.fn((snapshot: unknown) => ({ after: snapshot })),
  getDocFromServer: vi.fn(),
  getDocsFromServer: vi.fn(),
  limit: vi.fn((count: number) => ({ limit: count })),
  orderBy: vi.fn((field: unknown, direction?: string) => ({ orderBy: field, direction })),
  where: vi.fn((field: string, operator: string, value: unknown) => ({
    where: field,
    operator,
    value,
  })),
  query: vi.fn((...args: unknown[]) => args),
}));

vi.mock('./firebase', () => ({
  getDb: vi.fn(() => 'db'),
  isFirebaseConfigured: vi.fn(() => true),
}));

function eventDocument(id: string, path: string, data: Record<string, unknown> = {}) {
  return {
    id,
    ref: { parent: { path } },
    exists: () => true,
    data: () => ({ title: `活動 ${id}`, startsAt: '2026-10-08T00:00:00Z', ...data }),
  };
}

const snapshot = (docs: ReturnType<typeof eventDocument>[]) => ({
  empty: docs.length === 0,
  docs,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isFirebaseConfigured).mockReturnValue(true);
});

it('falls back only after a confirmed empty source and never after a denied read', async () => {
  const docs = [eventDocument('e1', 'schools/pu/events')];
  vi.mocked(getDocsFromServer)
    .mockResolvedValueOnce(snapshot([]) as never)
    .mockResolvedValueOnce(snapshot(docs) as never);
  await expect(loadCampusEventPage('pu')).resolves.toMatchObject({
    source: 'school-events',
    items: [{ id: 'e1', source: 'school-events' }],
  });
  expect(collection).toHaveBeenCalledWith('db', 'schools', 'pu', 'clubEvents');
  expect(collection).toHaveBeenCalledWith('db', 'schools', 'pu', 'events');

  vi.clearAllMocks();
  vi.mocked(getDocsFromServer).mockRejectedValueOnce(new Error('permission-denied'));
  await expect(loadCampusEventPage('pu')).rejects.toThrow('permission-denied');
  expect(getDocsFromServer).toHaveBeenCalledTimes(1);
  expect(collection).toHaveBeenCalledTimes(1);
});

it('pins pagination to the selected school+source and rejects invalid cursors without requesting', async () => {
  const docs = Array.from({ length: 26 }, (_, index) =>
    eventDocument(`e${index}`, 'schools/pu/clubEvents'),
  );
  vi.mocked(getDocsFromServer).mockResolvedValueOnce(snapshot(docs) as never);
  const first = await loadCampusEventPage('pu');
  expect(first.items).toHaveLength(25);
  expect(first.source).toBe('school-club-events');
  expect(orderBy).toHaveBeenCalledWith(documentId(), 'asc');
  expect(limit).toHaveBeenCalledWith(26);

  vi.mocked(getDocsFromServer).mockClear();
  await expect(loadCampusEventPage('other', first.nextCursor)).rejects.toThrow('this school');
  await expect(
    loadCampusEventPage('pu', { ...first.nextCursor!, source: 'legacy-events' }),
  ).rejects.toThrow('this source');
  expect(getDocsFromServer).not.toHaveBeenCalled();

  vi.mocked(getDocsFromServer).mockResolvedValueOnce(snapshot([]) as never);
  const second = await loadCampusEventPage('pu', first.nextCursor);
  expect(startAfter).toHaveBeenCalledWith(docs[24]);
  expect(second).toMatchObject({ items: [], source: 'school-club-events', nextCursor: null });
});

it('keeps detail IDs on the explicit source and rejects unknown sources or wrong-school rows', async () => {
  vi.mocked(getDocFromServer).mockResolvedValueOnce({ exists: () => false } as never);
  await expect(loadCampusEvent('pu', 'same-id', 'school-club-events')).resolves.toBeNull();
  expect(getDocFromServer).toHaveBeenCalledTimes(1);
  expect(doc).toHaveBeenLastCalledWith('db', 'schools', 'pu', 'clubEvents', 'same-id');

  await expect(loadCampusEvent('pu', 'e1', 'mystery')).rejects.toThrow('Invalid event source');
  expect(getDocFromServer).toHaveBeenCalledTimes(1);

  vi.mocked(getDocFromServer).mockResolvedValueOnce(
    eventDocument('e2', 'events', { schoolId: 'other' }) as never,
  );
  await expect(loadCampusEvent('pu', 'e2', 'legacy-events')).rejects.toThrow(
    'Invalid campus content',
  );

  await expect(loadCampusEvent('pu', '../other')).resolves.toBeNull();
});

it('skips corrupt cross-school page rows with diagnostics and never invents empty on failure', async () => {
  vi.mocked(getDocsFromServer).mockResolvedValueOnce(
    snapshot([
      eventDocument('ok', 'schools/pu/clubEvents'),
      eventDocument('bad', 'schools/pu/clubEvents', { schoolId: 'other' }),
    ]) as never,
  );
  const page = await loadCampusEventPage('pu');
  expect(page.items).toEqual([
    expect.objectContaining({ id: 'ok', schoolId: 'pu', source: 'school-club-events' }),
  ]);
  expect(page.skipped).toEqual([
    expect.objectContaining({ id: 'bad', reason: 'Invalid campus content' }),
  ]);

  vi.mocked(getDocsFromServer).mockRejectedValueOnce(new Error('network'));
  await expect(loadCampusEventPage('pu')).rejects.toThrow('network');
});

it('paginates stably across tied dates and only uses legacy after both school collections are empty', async () => {
  const path = 'schools/pu/clubEvents';
  const docs = Array.from({ length: 35 }, (_, index) =>
    eventDocument(`e${String(index).padStart(3, '0')}`, path),
  );
  vi.mocked(getDocsFromServer)
    .mockResolvedValueOnce(snapshot(docs.slice(0, 26)) as never)
    .mockResolvedValueOnce(snapshot(docs.slice(25)) as never);
  const first = await loadCampusEventPage('pu');
  const second = await loadCampusEventPage('pu', first.nextCursor);
  expect(new Set([...first.items, ...second.items].map((item) => item.id)).size).toBe(35);
  expect(second.nextCursor).toBeNull();

  vi.clearAllMocks();
  vi.mocked(isFirebaseConfigured).mockReturnValue(true);
  vi.mocked(getDocsFromServer)
    .mockResolvedValueOnce(snapshot([]) as never)
    .mockResolvedValueOnce(snapshot([]) as never)
    .mockResolvedValueOnce(
      snapshot([eventDocument('root-event', 'events', { schoolId: 'pu' })]) as never,
    );
  await expect(loadCampusEventPage('pu')).resolves.toMatchObject({
    source: 'legacy-events',
    items: [{ id: 'root-event', source: 'legacy-events' }],
  });
  expect(collection).toHaveBeenLastCalledWith('db', 'events');
  expect(where).toHaveBeenCalledWith('schoolId', '==', 'pu');
});

it('uses the supplied anonymous detail guard and requires one exact source without fallback', async () => {
  const db = { mode: 'anonymous' } as unknown as NonNullable<PublicCampusReadGuard['db']>;
  const guard = { db, beforeRead: vi.fn(), afterRead: vi.fn() };
  vi.mocked(getDocFromServer).mockResolvedValueOnce({ exists: () => false } as never);
  await expect(loadCampusEvent('pu', 'missing', 'school-events', guard)).resolves.toBeNull();
  expect(doc).toHaveBeenCalledWith(db, 'schools', 'pu', 'events', 'missing');
  expect(getDocFromServer).toHaveBeenCalledTimes(1);
  expect(getDb).not.toHaveBeenCalled();
  expect(guard.beforeRead).toHaveBeenCalledOnce();
  expect(guard.afterRead).toHaveBeenCalledOnce();
  await expect(loadCampusEvent('pu', 'missing', undefined, guard)).rejects.toThrow('Invalid event source');
  expect(getDocFromServer).toHaveBeenCalledTimes(1);
});

it('preserves budget and late-cancellation errors around the single detail read', async () => {
  const budget = new Error('budget'), aborted = new Error('aborted');
  const guard = { beforeRead: vi.fn(() => { throw budget; }), afterRead: vi.fn() };
  await expect(loadCampusEvent('pu', 'e1', 'school-events', guard)).rejects.toBe(budget);
  expect(getDocFromServer).not.toHaveBeenCalled();

  vi.mocked(getDocFromServer).mockResolvedValueOnce(eventDocument('e1', 'schools/pu/events') as never);
  await expect(loadCampusEvent('pu', 'e1', 'school-events', {
    beforeRead() {}, afterRead() { throw aborted; },
  })).rejects.toBe(aborted);
  expect(getDocFromServer).toHaveBeenCalledTimes(1);
});

it('rejects a mismatched detail document identity or collection before projecting it', async () => {
  const guard = { beforeRead() {}, afterRead() {} };
  vi.mocked(getDocFromServer).mockResolvedValueOnce(eventDocument('other', 'schools/pu/events') as never);
  await expect(loadCampusEvent('pu', 'e1', 'school-events', guard)).rejects.toThrow('Invalid campus content');
  vi.mocked(getDocFromServer).mockResolvedValueOnce(eventDocument('e1', 'schools/other/events') as never);
  await expect(loadCampusEvent('pu', 'e1', 'school-events', guard)).rejects.toThrow('Invalid campus content');
});

it('rejects ambiguous source clocks for guarded actions while retaining ordinary detail display behavior', async () => {
  const guard = { beforeRead() {}, afterRead() {} };
  const ambiguous = eventDocument('e1', 'schools/pu/events', { startsAt: '2026-10-08', endsAt: '2026-10-08T11:00:00' });
  vi.mocked(getDocFromServer).mockResolvedValue(ambiguous as never);
  await expect(loadCampusEvent('pu', 'e1', 'school-events', guard)).resolves.toMatchObject({ startsAt: '', endsAt: undefined });
  await expect(loadCampusEvent('pu', 'e1', 'school-events')).resolves.toMatchObject({ startsAt: '2026-10-08T00:00:00.000Z' });
});
