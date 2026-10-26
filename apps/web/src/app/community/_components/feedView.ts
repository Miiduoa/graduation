import type { CampusPostDoc } from '@/lib/community/firestore';

export type FeedFilter = 'all' | 'subscribed' | 'media';
export type FeedOrder = 'recommended' | 'latest';

type FeedViewOptions = {
  filter: FeedFilter;
  order: FeedOrder;
  search: string;
  subscribedIds: ReadonlySet<string>;
  boardNames: Record<string, string>;
  authorNames: Record<string, string>;
};

function createdAtMillis(value: unknown): number {
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.getTime() : 0;
  if (value && typeof value === 'object' && 'toMillis' in value) {
    const timestamp = value as { toMillis?: unknown };
    if (typeof timestamp.toMillis === 'function') {
      const millis = timestamp.toMillis() as unknown;
      return typeof millis === 'number' && Number.isFinite(millis) ? millis : 0;
    }
  }
  return 0;
}

/**
 * Search and sorting only apply to already-loaded, school-scoped posts.
 * Do not use an anonymous post's authorUid when building searchable text.
 */
export function selectCampusFeedPosts(
  posts: CampusPostDoc[],
  options: FeedViewOptions,
): CampusPostDoc[] {
  const query = options.search.trim().toLocaleLowerCase();
  const filtered = posts.filter((post) => {
    if (options.filter === 'subscribed' && !options.subscribedIds.has(post.boardId)) return false;
    if (options.filter === 'media' && !((Array.isArray(post.mediaUrls) ? post.mediaUrls : [])).some((url) => typeof url === 'string' && url.length > 0))
      return false;
    if (!query) return true;

    const author = post.anonymous
      ? post.aliasSnapshot ?? '匿名貼文'
      : post.authorUid ? options.authorNames[post.authorUid] ?? '' : '';
    const searchable = [
      post.title,
      post.content,
      ...(Array.isArray(post.tags) ? post.tags : []),
      options.boardNames[post.boardId] ?? '',
      author,
    ].join(' ').toLocaleLowerCase();
    return searchable.includes(query);
  });
  if (options.order === 'latest') {
    return [...filtered].sort(
      (a, b) => createdAtMillis(b.createdAt) - createdAtMillis(a.createdAt),
    );
  }
  // The loaded collection is already ranked by the existing recommendation model.
  return filtered;
}
