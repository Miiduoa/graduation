import type { CampusPostDoc } from '../../services/feed';

export type MobileFeedFilter = 'all' | 'following' | 'subscribed' | 'media';
export type MobileFeedOrder = 'recommended' | 'latest';

type Options = {
  filter: MobileFeedFilter;
  order: MobileFeedOrder;
  search: string;
  subscribedIds: ReadonlySet<string>;
  followingIds: ReadonlySet<string>;
  boards: Record<string, string>;
  authors: Record<string, string>;
};

function timestamp(value: unknown): number {
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.getTime() : 0;
  if (value && typeof value === 'object' && 'toMillis' in value) {
    const obj = value as { toMillis?: unknown };
    if (typeof obj.toMillis === 'function') {
      const ms = obj.toMillis() as unknown;
      return typeof ms === 'number' && Number.isFinite(ms) ? ms : 0;
    }
  }
  return 0;
}

export function selectMobileFeedPosts(posts: CampusPostDoc[], options: Options): CampusPostDoc[] {
  const query = options.search.trim().toLocaleLowerCase();
  const matched = posts.filter((post) => {
    if (options.filter === 'subscribed' && !options.subscribedIds.has(post.boardId))
      return false;
    if (
      options.filter === 'following' &&
      (post.anonymous || !post.authorUid || !options.followingIds.has(post.authorUid))
    ) return false;
    if (
      options.filter === 'media' &&
      !((Array.isArray(post.mediaUrls) ? post.mediaUrls : [])).some((url) => typeof url === 'string' && url.length > 0)
    ) return false;
    if (!query) return true;
    const author = post.anonymous
      ? post.aliasSnapshot ?? '匿名貼文'
      : post.authorUid ? options.authors[post.authorUid] ?? '' : '';
    return [
      post.title,
      post.content,
      ...(Array.isArray(post.tags) ? post.tags : []),
      options.boards[post.boardId] ?? '',
      author,
    ].join(' ').toLocaleLowerCase().includes(query);
  });
  return options.order === 'latest'
    ? [...matched].sort((a, b) => timestamp(b.createdAt) - timestamp(a.createdAt))
    : matched;
}
