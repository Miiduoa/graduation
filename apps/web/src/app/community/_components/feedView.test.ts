import { describe, expect, it } from 'vitest';
import type { CampusPostDoc } from '@/lib/community/firestore';
import { selectCampusFeedPosts, type FeedFilter, type FeedOrder } from './feedView';

const posts: CampusPostDoc[] = [
  {
    id: 'older', schoolId: 'pu', boardId: 'study', title: '期中考攻略',
    content: '一起讀書', tags: ['考試'], anonymous: false, authorUid: 'alice',
    createdAt: new Date('2026-10-20T00:00:00Z'), mediaUrls: [],
  },
  {
    id: 'newer', schoolId: 'pu', boardId: 'photo', title: '校園攝影',
    content: '好天氣', tags: ['風景'], anonymous: true,
    aliasSnapshot: '神祕同學', authorUid: 'secret-real-uid',
    createdAt: { toMillis: () => Date.parse('2026-10-25T00:00:00Z') },
    mediaUrls: ['https://example.com/photo.jpg'],
  },
];
function select(patch: Partial<{
  filter: FeedFilter;
  order: FeedOrder;
  search: string;
}> = {}) {
  return selectCampusFeedPosts(posts, {
    filter: 'all', order: 'recommended', search: '',
    subscribedIds: new Set(['study']),
    boardNames: { study: '課業討論', photo: '攝影社' },
    authorNames: { alice: '小明', 'secret-real-uid': '不可公開的真名' },
    ...patch,
  }).map((post) => post.id);
}

describe('school-scoped feed discovery', () => {
  it('preserves the recommendation order and can show the latest loaded posts first', () => {
    expect(select()).toEqual(['older', 'newer']);
    expect(select({ order: 'latest' })).toEqual(['newer', 'older']);
    expect(posts.map((post) => post.id)).toEqual(['older', 'newer']);
  });
  it('filters subscriptions and media without introducing another data source', () => {
    expect(select({ filter: 'subscribed' })).toEqual(['older']);
    expect(select({ filter: 'media' })).toEqual(['newer']);
  });
  it('searches loaded titles, text, tags, board names and visible authors', () => {
    for (const term of ['期中考', '讀書', '考試', '課業討論', '小明']) {
      expect(select({ search: term })).toEqual(['older']);
    }
    expect(select({ search: '  攝影社  ' })).toEqual(['newer']);
    expect(select({ search: '不存在' })).toEqual([]);
  });
  it('never lets search reveal an anonymous author identity', () => {
    expect(select({ search: '神祕同學' })).toEqual(['newer']);
    expect(select({ search: '不可公開的真名' })).toEqual([]);
    expect(select({ search: 'secret-real-uid' })).toEqual([]);
  });
});
