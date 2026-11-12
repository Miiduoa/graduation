// @vitest-environment node
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { disableNetwork, enableNetwork, type Firestore } from 'firebase/firestore';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/lib/firebase';
import { confirmCampusPostTitleOpen, resumeCampusPostTitles, searchCampusPostTitles, type TitleSearchCursor } from './titleSearch';
import { fetchCampusPostPage } from './feedPages';

vi.mock('@/lib/firebase', () => ({ getDb: vi.fn() }));
const host = process.env.FIRESTORE_EMULATOR_HOST || '';
const local = /^(127\.0\.0\.1|localhost):[0-9]{1,5}$/.test(host);
if (process.env.REQUIRE_HISTORY_EMULATOR === '1' && !local) {
  throw new Error('History search verification requires a localhost emulator; refusing cloud access.');
}
const suite = local ? describe : describe.skip;

suite('title search using the real SDK and repository authorization rules', () => {
  let environment: RulesTestEnvironment;
  let alice: Firestore;
  beforeAll(async () => {
    const [hostname, port] = host.split(':');
    environment = await initializeTestEnvironment({
      projectId: 'demo-campus-title-search',
      firestore: { host: hostname, port: Number(port),
        rules: readFileSync(new URL('../../../../../backend/firestore/firestore.rules', import.meta.url), 'utf8') },
    });
    await environment.clearFirestore();
    await environment.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      const rows: [string, Record<string, unknown>][] = [
        ['users/alice', { schoolId: 'pu', status: 'active' }],
        ['users/charlie', { schoolId: 'other', status: 'active' }],
        ['schools/pu/members/alice', { status: 'active', role: 'student' }],
        ['schools/other/members/charlie', { status: 'active', role: 'student' }],
      ];
      for (let i = 0; i < 1000; i += 1) rows.push([`schools/pu/campusPosts/recent-${i}`, {
        schoolId: 'pu', boardId: 'public', title: `近期活動 ${i}`, content: '二手書只在內文出現',
        anonymous: false, authorUid: 'alice', createdAt: new Date(1800000000000 + i * 1000),
      }]);
      for (let i = 0; i < 45; i += 1) rows.push([`schools/pu/campusPosts/old-${String(i).padStart(3, '0')}`, {
        schoolId: 'pu', boardId: 'public', title: i === 44 ? '二手書📚' : `二手書 ${Math.floor(i / 3)}`,
        content: '多年前的課本', anonymous: true, authorUid: 'never-render',
        createdAt: new Date(1600000000000),
      }]);
      for (const [id, title] of [['upper', 'AI project'], ['lower', 'ai project'], ['next', '二手曹'], ['before', '二手更']]) {
        rows.push([`schools/pu/campusPosts/${id}`, { schoolId: 'pu', title, content: '', createdAt: new Date(1600000000000) }]);
      }
      rows.push(['schools/other/campusPosts/private', { schoolId: 'other', title: '二手書 他校', content: '不可洩漏' }]);
      for (let offset = 0; offset < rows.length; offset += 400) {
        const batch = db.batch();
        for (const [path, data] of rows.slice(offset, offset + 400)) batch.set(db.doc(path), data);
        await batch.commit();
      }
    });
    alice = environment.authenticatedContext('alice').firestore() as unknown as Firestore;
    vi.mocked(getDb).mockReturnValue(alice);
  }, 45000);
  afterAll(async () => { await environment?.cleanup(); });

  it('finds 45 older matching titles without traversing 1000 newer nonmatches', async () => {
    vi.mocked(getDb).mockReturnValue(alice);
    const feed = await fetchCampusPostPage('pu');
    expect(feed.posts).toHaveLength(60);
    expect(feed.posts.every((row) => row.id.startsWith('recent-'))).toBe(true);
    const ids: string[] = [];
    const sizes: number[] = [];
    let cursor: TitleSearchCursor | null = null;
    for (let i = 0; i < 4; i += 1) {
      const page = await searchCampusPostTitles('pu', '二手書', cursor);
      sizes.push(page.posts.length);
      ids.push(...page.posts.map((row) => row.id));
      expect(page.posts.every((row) => row.title.startsWith('二手書') && row.schoolId === 'pu')).toBe(true);
      expect(page.posts.every((row) => !('authorUid' in row) && !('mediaUrls' in row))).toBe(true);
      cursor = page.nextCursor;
      if (!page.hasMore) break;
    }
    expect(sizes).toEqual([20, 20, 5]);
    expect(new Set(ids).size).toBe(45);
    expect(ids).toContain('old-044');
    console.info('TITLE_HISTORY_EVIDENCE', JSON.stringify({ newerNonmatches: 1000,
      historyMatches: 45, returnedPages: sizes, uniqueIds: new Set(ids).size,
      boundary: 'actual SDK and localhost rules; not production billing, timing or full-text search' }));
  });
  it('matches case-sensitive title prefixes rather than body text or arbitrary substrings', async () => {
    vi.mocked(getDb).mockReturnValue(alice);
    expect((await searchCampusPostTitles('pu', 'AI')).posts.map((row) => row.id)).toEqual(['upper']);
    expect((await searchCampusPostTitles('pu', 'ai')).posts.map((row) => row.id)).toEqual(['lower']);
    expect((await searchCampusPostTitles('pu', '課本')).posts).toEqual([]);
    expect((await searchCampusPostTitles('pu', '手書')).posts).toEqual([]);
  });
  it('rejects offline continuation despite populated cache and retries the same cursor', async () => {
    vi.mocked(getDb).mockReturnValue(alice);
    const first = await searchCampusPostTitles('pu', '二手書');
    const second = await searchCampusPostTitles('pu', '二手書', first.nextCursor);
    await disableNetwork(alice);
    try {
      await expect(searchCampusPostTitles('pu', '二手書', first.nextCursor)).rejects.toMatchObject({ code: 'unavailable' });
    } finally { await enableNetwork(alice); }
    expect((await searchCampusPostTitles('pu', '二手書', first.nextCursor)).posts).toEqual(second.posts);
  });
  it('rejects revoked membership even after caching results and works after restoration', async () => {
    vi.mocked(getDb).mockReturnValue(alice);
    const first = await searchCampusPostTitles('pu', '二手書');
    const membership = 'schools/pu/members/alice';
    await environment.withSecurityRulesDisabled(async (context) => {
      await context.firestore().doc(membership).update({ status: 'inactive' });
    });
    try {
      await expect(searchCampusPostTitles('pu', '二手書', first.nextCursor)).rejects.toMatchObject({ code: 'permission-denied' });
    } finally {
      await environment.withSecurityRulesDisabled(async (context) => {
        await context.firestore().doc(membership).update({ status: 'active' });
      });
    }
    expect((await searchCampusPostTitles('pu', '二手書', first.nextCursor)).posts).toHaveLength(20);
  });
  it.each([['alice', 'other'], ['charlie', 'pu'], [null, 'pu']] as const)
    ('denies unauthorized scope %s → %s', async (uid, school) => {
      const context = uid ? environment.authenticatedContext(uid) : environment.unauthenticatedContext();
      vi.mocked(getDb).mockReturnValue(context.firestore() as unknown as Firestore);
      await expect(searchCampusPostTitles(school, '二手書')).rejects.toMatchObject({ code: 'permission-denied' });
    });
  it('keeps another entitled school usable and rejects cross-school or cross-query cursors', async () => {
    vi.mocked(getDb).mockReturnValue(alice);
    const first = await searchCampusPostTitles('pu', '二手書');
    await expect(searchCampusPostTitles('pu', 'AI', first.nextCursor)).rejects.toMatchObject({ code: 'invalid-argument' });
    vi.mocked(getDb).mockReturnValue(environment.authenticatedContext('charlie').firestore() as unknown as Firestore);
    await expect(searchCampusPostTitles('other', '二手書', first.nextCursor)).rejects.toMatchObject({ code: 'invalid-argument' });
    expect((await searchCampusPostTitles('other', '二手書')).posts.map((row) => row.id)).toEqual(['private']);
  });
  it('resumes at an exact authorized older document using a fresh server cursor', async () => {
    vi.mocked(getDb).mockReturnValue(alice);
    const from = await resumeCampusPostTitles('pu', '二手書', 'old-006');
    expect(from.posts[0].id).toBe('old-006');
    expect(from.posts).toHaveLength(20);
    expect(from.hasMore).toBe(true);
    const next = await searchCampusPostTitles('pu', '二手書', from.nextCursor);
    expect(new Set([...from.posts, ...next.posts].map((post) => post.id)).size)
      .toBe(from.posts.length + next.posts.length);
    expect(next.posts.every((post) => post.schoolId === 'pu')).toBe(true);
  });
  it('rejects deleted, changed-title, revoked and cross-school resume IDs', async () => {
    vi.mocked(getDb).mockReturnValue(alice);
    await environment.withSecurityRulesDisabled(async (context) => {
      await context.firestore().doc('schools/pu/campusPosts/resume-removed').set({
        schoolId: 'pu', title: '二手書 已刪除', authorUid: 'alice',
      });
      await context.firestore().doc('schools/pu/campusPosts/resume-removed').delete();
    });
    await expect(resumeCampusPostTitles('pu', '二手書', 'resume-removed'))
      .rejects.toMatchObject({ code: 'history-position-unavailable' });
    await expect(resumeCampusPostTitles('pu', '二手書', 'upper'))
      .rejects.toMatchObject({ code: 'history-position-unavailable' });
    const membership = 'schools/pu/members/alice';
    await environment.withSecurityRulesDisabled(async (context) => {
      await context.firestore().doc(membership).update({ status: 'inactive' });
    });
    try {
      await expect(resumeCampusPostTitles('pu', '二手書', 'old-006'))
        .rejects.toMatchObject({ code: 'permission-denied' });
    } finally {
      await environment.withSecurityRulesDisabled(async (context) => {
        await context.firestore().doc(membership).update({ status: 'active' });
      });
    }
    vi.mocked(getDb).mockReturnValue(environment.authenticatedContext('charlie').firestore() as unknown as Firestore);
    await expect(resumeCampusPostTitles('pu', '二手書', 'old-006'))
      .rejects.toMatchObject({ code: 'permission-denied' });
    expect((await resumeCampusPostTitles('other', '二手書', 'private')).posts[0].id)
      .toBe('private');
  });
  it('does not return a cached resume page when offline', async () => {
    vi.mocked(getDb).mockReturnValue(alice);
    await resumeCampusPostTitles('pu', '二手書', 'old-006');
    await disableNetwork(alice);
    try {
      await expect(resumeCampusPostTitles('pu', '二手書', 'old-006'))
        .rejects.toMatchObject({ code: 'unavailable' });
    } finally { await enableNetwork(alice); }
  });
  it('rechecks existing, deleted, revoked, offline and cross-campus links with real rules', async () => {
    vi.mocked(getDb).mockReturnValue(alice);
    const path = 'schools/pu/campusPosts/web-check';
    await environment.withSecurityRulesDisabled(async (context) => {
      await context.firestore().doc(path).set({ schoolId: 'pu', boardId: 'public',
        title: '二手書 伺服器確認', content: '仍在校內', authorUid: 'alice' });
    });
    expect(await confirmCampusPostTitleOpen('pu', 'web-check')).toBe(true);
    await disableNetwork(alice);
    try {
      await expect(confirmCampusPostTitleOpen('pu', 'web-check')).rejects.toMatchObject({ code: 'unavailable' });
    } finally { await enableNetwork(alice); }
    const membership = 'schools/pu/members/alice';
    await environment.withSecurityRulesDisabled(async (context) => {
      await context.firestore().doc(membership).update({ status: 'inactive' });
    });
    try {
      await expect(confirmCampusPostTitleOpen('pu', 'web-check')).rejects.toMatchObject({ code: 'permission-denied' });
    } finally {
      await environment.withSecurityRulesDisabled(async (context) => {
        await context.firestore().doc(membership).update({ status: 'active' });
      });
    }
    await expect(confirmCampusPostTitleOpen('other', 'private')).rejects.toMatchObject({ code: 'permission-denied' });
    await environment.withSecurityRulesDisabled(async (context) => {
      await context.firestore().doc(path).delete();
    });
    expect(await confirmCampusPostTitleOpen('pu', 'web-check')).toBe(false);
  });
  it('does not open a server-confirmed old result after its title has moved to another prefix', async () => {
    // The list was already fetched for 二手書. The author now changes the title
    // before this student clicks; a fresh server read must reject this old link.
    vi.mocked(getDb).mockReturnValue(alice);
    const path = 'schools/pu/campusPosts/web-title-moved';
    await environment.withSecurityRulesDisabled(async (context) => {
      await context.firestore().doc(path).set({
        schoolId: 'pu', boardId: 'public', title: '二手書 原標題',
        content: '學生仍可用新標題找到', authorUid: 'alice',
      });
    });
    expect((await searchCampusPostTitles('pu', '二手書')).posts.some((post) => post.id === 'web-title-moved')).toBe(true);
    await environment.withSecurityRulesDisabled(async (context) => {
      await context.firestore().doc(path).update({ title: '租屋 已改標題' });
    });
    expect(await confirmCampusPostTitleOpen('pu', 'web-title-moved', '二手書')).toBe(false);
    expect(await confirmCampusPostTitleOpen('pu', 'web-title-moved', '租屋')).toBe(true);
  });
});
