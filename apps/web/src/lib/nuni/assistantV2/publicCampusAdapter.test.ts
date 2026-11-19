// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDocsFromServer } from 'firebase/firestore';
import { getDb, isFirebaseConfigured } from '../../firebase';
import { publicCampusFirestore } from '../../server/publicCampusFirestore';
import { createAdapter } from './adapter';
import { withOperationSignal } from './operation';

const state = vi.hoisted(() => ({ anonymousDb: { mode: 'public-anonymous' }, reads: [] as unknown[] }));
vi.mock('../../firebase', () => ({ getDb: vi.fn(() => { throw new Error('Default authenticated app must not be used'); }), isFirebaseConfigured: vi.fn(() => true) }));
vi.mock('../../server/publicCampusFirestore', () => ({ publicCampusFirestore: vi.fn(() => state.anonymousDb) }));
vi.mock('firebase/firestore', () => ({
  collection: (db: unknown, ...path: string[]) => ({ db, path: path.join('/') }),
  query: (ref: object, ...constraints: object[]) => ({ ...ref, constraints }),
  where: (field: string, op: string, value: unknown) => ({ field, op, value }),
  orderBy: (field: unknown, direction?: string) => ({ orderBy: field, direction }),
  documentId: () => '__name__', startAfter: (document: unknown) => ({ after: document }),
  limit: (amount: number) => ({ limit: amount }), getDocsFromServer: vi.fn(), getDocFromServer: vi.fn(), doc: vi.fn(),
}));

const now = Date.parse('2026-11-16T03:00:00.000Z');
const schoolId = 'fixture-school';
const account = 'pa_11111111-1111-4111-8111-111111111111';
type Query = { db: unknown; path: string; constraints?: { field?: string; value?: unknown; after?: unknown; limit?: number }[] };
function document(id: string, data: Record<string, unknown>, path = `schools/${schoolId}/clubEvents`) {
  return { id, data: () => data, ref: { parent: { path } } };
}
const snapshot = (docs: ReturnType<typeof document>[] = []) => ({ docs, empty: !docs.length });
function notice(patch: Record<string, unknown> = {}) {
  return { title: '校園攝影活動開放參加', body: '<p>在圖書館集合</p>', sourceId: 'source-a', office: '學務處',
    schoolId, publishedAt: '2026-11-15T01:00:00.000Z', ...patch };
}
const sourceHealth = (patch: Record<string, unknown> = {}) => document('source-a', { schoolId, sourceId: 'source-a', status: 'healthy', ...patch });
const event = (index = 0, patch: Record<string, unknown> = {}) => document(`event-${String(index).padStart(3, '0')}`, {
  title: `活動 ${index}`, description: '公開活動摘要', startsAt: '2026-11-17T01:00:00.000Z', schoolId, ...patch,
});
async function adapter(signal = new AbortController().signal, school = schoolId) {
  const source = createAdapter({ sessionHandle: 'ps_' + 'a'.repeat(43), expiresAt: now + 3600000 }, school, signal);
  await source.principal();
  return source;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
  vi.clearAllMocks();
  vi.mocked(isFirebaseConfigured).mockReturnValue(true);
  vi.stubEnv('NEXT_PUBLIC_APP_ENV', 'production');
  vi.stubEnv('NUNI_API_BASE_URL', 'https://api.nuni.tw');
  vi.stubGlobal('fetch', vi.fn(async (input) => {
    if (!String(input).endsWith('/sessions/current')) throw new Error('Unexpected platform or private request');
    return Response.json({ authenticated: true, platformAccountId: account, isPlatformOperator: false });
  }));
  vi.mocked(getDocsFromServer).mockImplementation((async (q: Query) => q.path.endsWith('announcement-sources')
    ? snapshot([sourceHealth()]) : q.path.endsWith('announcements') ? snapshot([document('notice-a', notice())]) : snapshot([event()])) as never);
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe('production anonymous public content adapter', () => {
  it('uses original public readers on a dedicated anonymous app with no private session or default Firebase app', async () => {
    const source = await adapter();
    const read = await source.adapter.publicCampus!('announcements', 5);
    expect(read).toMatchObject({ kind: 'announcements', schoolId, source: 'school-announcements', status: 'ready', partial: false,
      sourcePath: `schools/${schoolId}/announcements`, checkedAt: new Date(now).toISOString(),
      items: [{ title: '校園攝影活動開放參加', summary: '在圖書館集合', office: '學務處', schoolId }] });
    expect(getDb).not.toHaveBeenCalled();
    expect(publicCampusFirestore).toHaveBeenCalledOnce();
    expect(getDocsFromServer).toHaveBeenCalledTimes(2);
    for (const [query] of vi.mocked(getDocsFromServer).mock.calls) expect(query).toMatchObject({ db: state.anonymousDb });
    expect(JSON.stringify(vi.mocked(getDocsFromServer).mock.calls)).not.toMatch(/private|Platform |ps_|pa_|sessionHandle/);
    expect(fetch).toHaveBeenCalledOnce();
    expect(source.apiCalls()).toBe(3);
  });

  it('requires a verified platform principal and validates bounds before any public read', async () => {
    const source = createAdapter({ sessionHandle: 'opaque', expiresAt: now + 1000 }, schoolId, new AbortController().signal);
    await expect(source.adapter.publicCampus!('events', 5)).rejects.toMatchObject({ status: 401 });
    await source.principal();
    await expect(source.adapter.publicCampus!('events', 6)).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    expect(getDocsFromServer).not.toHaveBeenCalled();
    expect(publicCampusFirestore).not.toHaveBeenCalled();
  });

  it('keeps hidden schools and absent or unknown source metadata unavailable, not falsely empty', async () => {
    const hidden = await adapter(undefined, 'tw-demo-uni');
    await expect(hidden.adapter.publicCampus!('announcements', 5)).resolves.toMatchObject({ status: 'unavailable', unavailable: 'HIDDEN_SCHOOL', items: [] });
    expect(getDocsFromServer).not.toHaveBeenCalled();
    vi.mocked(getDocsFromServer).mockResolvedValue(snapshot() as never);
    await expect((await adapter()).adapter.publicCampus!('announcements', 5)).resolves.toMatchObject({ status: 'unavailable', unavailable: 'NOT_CONNECTED' });
    vi.mocked(getDocsFromServer).mockImplementation((async (q: Query) => q.path.endsWith('announcement-sources')
      ? snapshot([sourceHealth({ status: 'broken' })]) : snapshot()) as never);
    await expect((await adapter()).adapter.publicCampus!('announcements', 5)).resolves.toMatchObject({ status: 'unavailable', unavailable: 'SOURCE_UNAVAILABLE' });
  });

  it('keeps missing metadata, source failures, corrupt rows and source query limits visible as partial coverage', async () => {
    vi.mocked(getDocsFromServer).mockImplementation((async (q: Query) => q.path.endsWith('announcement-sources')
      ? snapshot() : snapshot([document('valid', notice()), document('other', notice({ schoolId: 'foreign' }))])) as never);
    const read = await (await adapter()).adapter.publicCampus!('announcements', 5);
    expect(read).toMatchObject({ status: 'ready', partial: true, items: [{ id: 'valid' }] });
    expect(JSON.stringify(read)).not.toContain('foreign');

    vi.mocked(getDocsFromServer).mockImplementation((async (q: Query) => q.path.endsWith('announcement-sources')
      ? snapshot([sourceHealth()]) : snapshot(Array.from({ length: 200 }, (_, i) => document(`n-${i}`, notice({ title: `通知 ${i}` }))))) as never);
    await expect((await adapter()).adapter.publicCampus!('announcements', 5)).resolves.toMatchObject({ partial: true, items: expect.any(Array) });

    vi.mocked(getDocsFromServer).mockImplementation((async (q: Query) => q.path.endsWith('announcement-sources')
      ? snapshot([sourceHealth({ status: 'unavailable' })]) : snapshot([document('cached', notice({ origin: 'public_scrape' }))])) as never);
    await expect((await adapter()).adapter.publicCampus!('announcements', 5)).resolves.toMatchObject({ status: 'unavailable', unavailable: 'SOURCE_UNAVAILABLE', items: [] });
  });

  it('does not mistake invalid publication times filtered by the student feed for a verified empty result', async () => {
    vi.mocked(getDocsFromServer).mockImplementation((async (q: Query) => q.path.endsWith('announcement-sources')
      ? snapshot([sourceHealth()]) : snapshot([document('bad-date', notice({ publishedAt: 'not-a-date' }))])) as never);
    await expect((await adapter()).adapter.publicCampus!('announcements', 5)).resolves.toMatchObject({
      status: 'unavailable', unavailable: 'SOURCE_UNAVAILABLE', items: [], partial: true,
    });
  });

  it('does not fall back to another source or root school when the authoritative event read is denied', async () => {
    vi.mocked(getDocsFromServer).mockRejectedValueOnce(new Error('permission-denied'));
    await expect((await adapter()).adapter.publicCampus!('events', 5)).rejects.toThrow('permission-denied');
    expect(getDocsFromServer).toHaveBeenCalledTimes(1);
    expect(vi.mocked(getDocsFromServer).mock.calls[0][0]).toMatchObject({ path: `schools/${schoolId}/clubEvents` });
  });

  it('uses an exact school filter for legacy events and never reads registrations or members', async () => {
    vi.mocked(getDocsFromServer).mockImplementation((async (q: Query) => q.path === 'events'
      ? snapshot([event()]) : snapshot()) as never);
    await expect((await adapter()).adapter.publicCampus!('events', 5)).resolves.toMatchObject({
      source: 'legacy-events', schoolId, items: [{ schoolId, href: `/events/event-000?schoolId=${schoolId}&source=legacy-events` }],
    });
    expect(vi.mocked(getDocsFromServer).mock.calls.at(-1)?.[0]).toMatchObject({ path: 'events',
      constraints: expect.arrayContaining([{ field: 'schoolId', op: '==', value: schoolId }]) });
    expect(JSON.stringify(vi.mocked(getDocsFromServer).mock.calls)).not.toMatch(/registrations|members|users/);
  });

  it('retains pagination and skipped-row provenance and bounds event scans to three pages', async () => {
    let pages = 0;
    vi.mocked(getDocsFromServer).mockImplementation((async () => {
      const page = pages++;
      return snapshot(Array.from({ length: 26 }, (_, i) => event(page * 25 + i,
        i === 1 ? { schoolId: 'foreign-school' } : {})));
    }) as never);
    const read = await (await adapter()).adapter.publicCampus!('events', 5);
    expect(read).toMatchObject({ status: 'ready', partial: true, items: expect.any(Array) });
    expect(getDocsFromServer).toHaveBeenCalledTimes(3);
    expect(JSON.stringify(read)).not.toContain('foreign-school');
    expect((read as { items: unknown[] }).items).toHaveLength(5);
  });

  it('shares the twelve-call allowance across real underlying source reads', async () => {
    vi.mocked(getDocsFromServer).mockResolvedValue(snapshot() as never);
    const source = await adapter();
    for (let i = 0; i < 3; i++) await source.adapter.publicCampus!('events', 5);
    expect(source.apiCalls()).toBe(10);
    await expect(source.adapter.publicCampus!('events', 5)).rejects.toMatchObject({ code: 'API_BUDGET_EXCEEDED' });
    expect(getDocsFromServer).toHaveBeenCalledTimes(11);
    expect(fetch).toHaveBeenCalledOnce();
    expect(source.adapter.remainingApiCalls!()).toBe(0);
  });
});

describe('public content cancellation', () => {
  it('stops late public records before a follow-on query or result can be delivered', async () => {
    let resolve!: (value: unknown) => void;
    vi.mocked(getDocsFromServer).mockReturnValueOnce(new Promise(done => { resolve = done; }) as never);
    const parent = new AbortController(), operation = new AbortController();
    const source = await adapter(parent.signal);
    const pending = withOperationSignal(operation.signal, () => source.adapter.publicCampus!('announcements', 5));
    const rejected = expect(pending).rejects.toMatchObject({ status: 499, code: 'ABORTED' });
    await vi.waitFor(() => expect(getDocsFromServer).toHaveBeenCalledOnce());
    operation.abort();
    await rejected;
    resolve(snapshot([document('late', notice())]));
    await Promise.resolve();
    await Promise.resolve();
    expect(getDocsFromServer).toHaveBeenCalledOnce();
  });
});
