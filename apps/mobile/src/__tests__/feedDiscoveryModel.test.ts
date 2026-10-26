import { selectMobileFeedPosts } from '../screens/social/feedDiscoveryModel';
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
function pick(patch: Partial<{ filter: 'all' | 'following' | 'subscribed' | 'media'; order: 'recommended' | 'latest'; search: string }> = {}) {
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
  it('keeps the recommended order and can sort the loaded results by time', () => {
    expect(pick()).toEqual(['one', 'two']);
    expect(pick({ order: 'latest' })).toEqual(['two', 'one']);
    expect(posts[0].id).toBe('one');
  });
  it('applies subscription and media filters to the existing results', () => {
    expect(pick({ filter: 'subscribed' })).toEqual(['one']);
    expect(pick({ filter: 'following' })).toEqual(['one']);
    expect(pick({ filter: 'media' })).toEqual(['two']);
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
});
