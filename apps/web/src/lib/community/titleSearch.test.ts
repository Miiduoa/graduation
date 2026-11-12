import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ server: vi.fn(), cache: vi.fn(), open: vi.fn(), db: {} }));
vi.mock('@/lib/firebase', () => ({ getDb: () => mocks.db }));
vi.mock('firebase/firestore', async (importOriginal) => ({
  ...await importOriginal<typeof import('firebase/firestore')>(),
  collection: (_db: unknown, path: string) => ({ path }),
  doc: (_db: unknown, ...parts: string[]) => ({ path: parts.join('/') }),
  documentId: () => '__name__',
  query: (source: unknown, ...constraints: unknown[]) => ({ source, constraints }),
  orderBy: (field: string, direction: string) => ({ orderBy: [field, direction] }),
  startAt: (value: unknown) => ({ startAt: value }),
  startAfter: (value: unknown) => ({ startAfter: value }),
  endBefore: (value: unknown) => ({ endBefore: value }),
  limit: (value: number) => ({ limit: value }),
  getDocsFromServer: mocks.server,
  getDocFromServer: mocks.open,
  getDocs: mocks.cache,
}));

import { confirmCampusPostTitleOpen, parseTitlePrefix, searchCampusPostTitles, titlePrefixUpperBound } from './titleSearch';

function document(id: string, fields: Record<string, unknown> = {}) {
  return {
    id, ref: { parent: { path: 'schools/pu/campusPosts' } },
    metadata: { fromCache: false, hasPendingWrites: false },
    data: () => ({ schoolId: 'pu', title: '二手書 ' + id, content: '書況良好', anonymous: true,
      authorUid: 'do-not-disclose', mediaUrls: ['do-not-load'], ...fields }),
  };
}
function snapshot(count = 20) {
  return { docs: Array.from({ length: count }, (_, i) => document(`post-${i}`)),
    metadata: { fromCache: false, hasPendingWrites: false } };
}
beforeEach(() => { vi.resetAllMocks(); mocks.server.mockResolvedValue(snapshot()); });

describe('literal title prefix input', () => {
  it('trims only outside whitespace and preserves case, punctuation and emoji', () => {
    expect(parseTitlePrefix('  AI：二手書 📚  ')).toBe('AI：二手書 📚');
    expect(parseTitlePrefix('📚'.repeat(80))).toHaveLength(160);
  });
  it.each(['', '   ', 'a'.repeat(81), 'a\nb', 'a\u0000b', '\ud800', '\udfff'])
    ('rejects invalid query %j', (value) => {
      expect(() => parseTitlePrefix(value)).toThrow();
    });
  it('computes a scalar upper bound without excluding supplementary-plane suffixes', () => {
    expect(titlePrefixUpperBound('abc')).toBe('abd');
    expect(titlePrefixUpperBound('a\ud7ff')).toBe('a\ue000');
    expect(titlePrefixUpperBound('a' + String.fromCodePoint(0x10ffff))).toBe('b');
    expect(titlePrefixUpperBound(String.fromCodePoint(0x10ffff))).toBeNull();
    expect(Buffer.compare(Buffer.from('二手書📚'), Buffer.from(titlePrefixUpperBound('二手書')!))).toBeLessThan(0);
  });
});

describe('authorized historical title index', () => {
  it('reads a bounded server title range and omits author/media data from the card model', async () => {
    const page = await searchCampusPostTitles('pu', ' 二手書 ');
    expect(page.posts).toHaveLength(20);
    expect(page.hasMore).toBe(true);
    expect(page.posts[0]).toEqual({ id: 'post-0', schoolId: 'pu', title: '二手書 post-0', excerpt: '書況良好', anonymous: true });
    expect(mocks.server).toHaveBeenCalledExactlyOnceWith({
      source: { path: 'schools/pu/campusPosts' },
      constraints: [{ orderBy: ['title', 'asc'] }, { orderBy: ['__name__', 'asc'] },
        { startAt: '二手書' }, { endBefore: titlePrefixUpperBound('二手書') }, { limit: 20 }],
    });
    expect(mocks.cache).not.toHaveBeenCalled();
  });
  it('continues with the exact server snapshot and the original upper boundary', async () => {
    const first = await searchCampusPostTitles('pu', '二手書');
    await searchCampusPostTitles('pu', '二手書', first.nextCursor);
    expect(mocks.server.mock.calls[1][0].constraints).toEqual([
      { orderBy: ['title', 'asc'] }, { orderBy: ['__name__', 'asc'] },
      { startAfter: first.nextCursor!.document }, { endBefore: titlePrefixUpperBound('二手書') }, { limit: 20 },
    ]);
  });
  it.each([0, 1, 19])('ends a %i-result page without a paid lookahead', async (count) => {
    mocks.server.mockResolvedValueOnce(snapshot(count));
    const page = await searchCampusPostTitles('pu', '二手書');
    expect(page.hasMore).toBe(false);
    expect(page.posts).toHaveLength(count);
    expect(page.nextCursor === null).toBe(count === 0);
    expect(mocks.server).toHaveBeenCalledTimes(1);
  });
  it.each(['', 'pu/posts'])('rejects invalid school %j before a request', async (school) => {
    await expect(searchCampusPostTitles(school, '二手書')).rejects.toMatchObject({ code: 'invalid-argument' });
    expect(mocks.server).not.toHaveBeenCalled();
  });
  it.each(['school', 'prefix', 'path', 'fromCache', 'hasPendingWrites', 'title'])
    ('rejects a cursor with invalid %s before issuing another read', async (field) => {
      const first = await searchCampusPostTitles('pu', '二手書');
      const cursor = first.nextCursor!;
      const mutated = { ...cursor };
      if (field === 'school') mutated.schoolId = 'other';
      if (field === 'prefix') mutated.prefix = '其他';
      if (field === 'path') Object.assign(mutated.document.ref.parent, { path: 'schools/other/campusPosts' });
      if (field === 'fromCache' || field === 'hasPendingWrites') Object.assign(mutated.document.metadata, { [field]: true });
      if (field === 'title') Object.assign(mutated.document, { data: () => ({ title: '不符標題' }) });
      mocks.server.mockClear();
      await expect(searchCampusPostTitles('pu', '二手書', mutated)).rejects.toMatchObject({ code: 'invalid-argument' });
      expect(mocks.server).not.toHaveBeenCalled();
    });
  it.each(['permission-denied', 'unauthenticated', 'unavailable', 'failed-precondition'])
    ('propagates %s without cached or unordered fallback', async (code) => {
      const cause = Object.assign(new Error(code), { code });
      mocks.server.mockRejectedValueOnce(cause);
      await expect(searchCampusPostTitles('pu', '二手書')).rejects.toBe(cause);
      expect(mocks.cache).not.toHaveBeenCalled();
    });
  it.each(['fromCache', 'hasPendingWrites'])('rejects %s results', async (flag) => {
    const rows = snapshot();
    Object.assign(rows.metadata, { [flag]: true });
    mocks.server.mockResolvedValueOnce(rows);
    await expect(searchCampusPostTitles('pu', '二手書')).rejects.toMatchObject({ code: 'unavailable' });
  });
  it('uses the actual ID, clips excerpts by characters and excludes malformed rows', async () => {
    const rows = snapshot(4);
    rows.docs[0] = document('actual', { id: 'forged', content: '📚'.repeat(161) });
    rows.docs[1] = document('wrong-school', { schoolId: 'other' });
    rows.docs[2] = document('wrong-title', { title: '租屋' });
    rows.docs[3] = document('missing-title', { title: null });
    mocks.server.mockResolvedValueOnce(rows);
    const page = await searchCampusPostTitles('pu', '二手書');
    expect(page.posts).toHaveLength(1);
    expect(page.posts[0].id).toBe('actual');
    expect(Array.from(page.posts[0].excerpt)).toHaveLength(160);
    expect(page.nextCursor?.document.id).toBe('missing-title');
  });
});

describe('fresh server check before opening an older Web result', () => {
  beforeEach(() => {
    mocks.open.mockResolvedValue({ id: 'old-1001', exists: () => true,
      metadata: { fromCache: false, hasPendingWrites: false },
      data: () => ({ schoolId: 'pu', title: '二手書 old-1001', content: '可閱讀' }) });
  });
  it('reads the exact campus post document without a cached fallback', async () => {
    await expect(confirmCampusPostTitleOpen('pu', 'old-1001', '二手書')).resolves.toBe(true);
    expect(mocks.open).toHaveBeenCalledExactlyOnceWith({ path: 'schools/pu/campusPosts/old-1001' });
    expect(mocks.cache).not.toHaveBeenCalled();
  });
  it('rejects a deleted or wrong-campus result', async () => {
    mocks.open.mockResolvedValueOnce({ exists: () => false, metadata: { fromCache: false, hasPendingWrites: false } });
    await expect(confirmCampusPostTitleOpen('pu', 'old-1001', '二手書')).resolves.toBe(false);
    mocks.open.mockResolvedValueOnce({ id: 'old-1001', exists: () => true,
      metadata: { fromCache: false, hasPendingWrites: false }, data: () => ({ schoolId: 'other' }) });
    await expect(confirmCampusPostTitleOpen('pu', 'old-1001', '二手書')).resolves.toBe(false);
  });
  it('will not accept stale cache or optimistic writes', async () => {
    for (const field of ['fromCache', 'hasPendingWrites']) {
      mocks.open.mockResolvedValueOnce({ id: 'old-1001', exists: () => true,
        metadata: { fromCache: false, hasPendingWrites: false, [field]: true },
        data: () => ({ schoolId: 'pu' }) });
      await expect(confirmCampusPostTitleOpen('pu', 'old-1001', '二手書')).rejects.toMatchObject({ code: 'unavailable' });
    }
  });
  it('propagates a permission denial or an offline read', async () => {
    for (const code of ['permission-denied', 'unavailable']) {
      const failure = Object.assign(new Error(code), { code });
      mocks.open.mockRejectedValueOnce(failure);
      await expect(confirmCampusPostTitleOpen('pu', 'old-1001', '二手書')).rejects.toBe(failure);
    }
  });
  it.each([['', 'ok'], ['pu/other', 'ok'], ['pu', ''], ['pu', 'post/id']])
    ('rejects an unsafe document path (%s, %s) before fetching', async (school, id) => {
      await expect(confirmCampusPostTitleOpen(school, id, '二手書')).rejects.toMatchObject({ code: 'invalid-argument' });
      expect(mocks.open).not.toHaveBeenCalled();
    });
});
