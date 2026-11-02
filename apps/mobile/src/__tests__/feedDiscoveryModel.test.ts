import {
  describeMobileFeedSearchRecovery,
  mobileFeedHasMorePages,
  mobileFeedSearchScopeLabel,
  MOBILE_FEED_PAGE_SIZE,
  selectMobileFeedPosts,
} from '../screens/social/feedDiscoveryModel';
import type { CampusPostDoc } from '../services/feed';

const posts: CampusPostDoc[] = [
  {
    id: 'one', schoolId: 'pu', boardId: 'courses',
    title: '期末報告', content: '想找同學', tags: ['讀書會'],
    anonymous: false, authorUid: 'alice', createdAt: new Date('2026-10-20T00:00:00Z'),
  },
  {
    id: 'two', schoolId: 'pu', boardId: 'photos',
    title: '校園日落', content: '照片分享', tags: [],
    anonymous: true, aliasSnapshot: '神秘同學', authorUid: 'hidden-uid',
    mediaUrls: ['https://example.com/photo.jpg'],
    createdAt: { toMillis: () => Date.parse('2026-10-25T00:00:00Z') },
  },
];

function pick(patch: Partial<{
  filter: 'all' | 'following' | 'subscribed' | 'media';
  order: 'recommended' | 'latest';
  search: string;
  subscribedIds: ReadonlySet<string>;
}> = {}) {
  return selectMobileFeedPosts(posts, {
    filter: 'all', order: 'recommended', search: '',
    subscribedIds: new Set(['courses']),
    followingIds: new Set(['alice', 'hidden-uid']),
    boards: { courses: '課程討論', photos: '攝影看板' },
    authors: { alice: '小明', 'hidden-uid': '真實姓名' },
    ...patch,
  }).map((item) => item.id);
}

describe('mobile school-scoped feed discovery', () => {
  it('keeps the recommended order and does not reshuffle when searching', () => {
    expect(pick()).toEqual(['one', 'two']);
    expect(pick({ order: 'latest' })).toEqual(['two', 'one']);
    // 搜尋只過濾，不改寫推薦次序；多筆命中時維持載入原次序。
    const shared = [
      { ...posts[0], content: '校園生活筆記' },
      { ...posts[1], content: '校園日落照片' },
    ];
    expect(selectMobileFeedPosts(shared, {
      filter: 'all', order: 'recommended', search: '校園',
      subscribedIds: new Set(['courses']),
      followingIds: new Set(['alice']),
      boards: { courses: '課程討論', photos: '攝影看板' },
      authors: { alice: '小明', 'hidden-uid': '真實姓名' },
    }).map((item) => item.id)).toEqual(['one', 'two']);
    expect(posts[0].id).toBe('one');
  });

  it('applies subscription and media filters to the existing results', () => {
    expect(pick({ filter: 'subscribed' })).toEqual(['one']);
    expect(pick({ filter: 'following' })).toEqual(['one']);
    expect(pick({ filter: 'media' })).toEqual(['two']);
  });

  it('treats an empty subscription set as no subscribed posts', () => {
    expect(pick({ filter: 'subscribed', subscribedIds: new Set() })).toEqual([]);
    expect(pick({
      filter: 'subscribed',
      subscribedIds: new Set(),
      search: '期末',
    })).toEqual([]);
  });

  it('can discover by title, body, tag, board and visible author', () => {
    for (const search of ['期末報告', '找同學', '讀書會', '課程討論', '小明']) {
      expect(pick({ search })).toEqual(['one']);
    }
    expect(pick({ search: ' 攝影看板 ' })).toEqual(['two']);
  });

  it('does not expose an anonymous author when searching', () => {
    expect(pick({ search: '神秘同學' })).toEqual(['two']);
    expect(pick({ search: '真實姓名' })).toEqual([]);
    expect(pick({ search: 'hidden-uid' })).toEqual([]);
  });

  it('labels the search scope with the loaded post count', () => {
    expect(mobileFeedSearchScopeLabel(0)).toBe('搜尋範圍：已載入的 0 篇貼文');
    expect(mobileFeedSearchScopeLabel(60)).toBe('搜尋範圍：已載入的 60 篇貼文');
  });

  it('detects whether another page may still exist', () => {
    expect(mobileFeedHasMorePages(0)).toBe(false);
    expect(mobileFeedHasMorePages(MOBILE_FEED_PAGE_SIZE - 1)).toBe(false);
    expect(mobileFeedHasMorePages(MOBILE_FEED_PAGE_SIZE)).toBe(true);
    expect(mobileFeedHasMorePages(MOBILE_FEED_PAGE_SIZE * 2)).toBe(true);
  });

  it('offers load-more recovery when another page may exist', () => {
    const recovery = describeMobileFeedSearchRecovery({
      search: '不存在的關鍵字',
      filter: 'all',
      matchCount: 0,
      loadedCount: MOBILE_FEED_PAGE_SIZE,
      hasMore: true,
      offline: false,
    });
    expect(recovery?.title).toBe('找不到符合的貼文');
    expect(recovery?.keepSearch).toBe(true);
    expect(recovery?.actions.map((item) => item.id)).toEqual([
      'load-more',
      'open-boards',
      'open-realtime',
    ]);
    expect(recovery?.actions[0]?.label).toBe('再載入更多後繼續找');
    expect(recovery?.actions.find((item) => item.id === 'open-realtime')?.label).toBe('前往即時');
  });

  it('offers clear-filters when a filter is active and keeps search offline', () => {
    const online = describeMobileFeedSearchRecovery({
      search: '期末',
      filter: 'subscribed',
      matchCount: 0,
      loadedCount: 12,
      hasMore: false,
      offline: false,
    });
    expect(online?.actions.map((item) => item.id)).toEqual([
      'clear-filters',
      'open-boards',
      'open-realtime',
    ]);
    expect(online?.actions.find((item) => item.id === 'clear-filters')?.label).toBe('清除篩選');
    expect(online?.subtitle).toMatch(/看板／即時/);

    const offline = describeMobileFeedSearchRecovery({
      search: '期末',
      filter: 'media',
      matchCount: 0,
      loadedCount: 12,
      hasMore: true,
      offline: true,
    });
    expect(offline?.title).toMatch(/離線/);
    expect(offline?.keepSearch).toBe(true);
    expect(offline?.actions.map((item) => item.id)).toEqual([
      'clear-filters',
      'open-boards',
      'open-realtime',
    ]);
    expect(offline?.actions.some((item) => item.id === 'load-more')).toBe(false);
    expect(offline?.subtitle).toMatch(/關鍵字已保留/);
  });

  it('returns null when there is no empty search to recover from', () => {
    expect(describeMobileFeedSearchRecovery({
      search: '',
      filter: 'all',
      matchCount: 0,
      loadedCount: 10,
      hasMore: true,
      offline: false,
    })).toBeNull();
    expect(describeMobileFeedSearchRecovery({
      search: '期末',
      filter: 'all',
      matchCount: 1,
      loadedCount: 10,
      hasMore: false,
      offline: false,
    })).toBeNull();
  });
});
