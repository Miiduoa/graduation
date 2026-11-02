import type { CampusPostDoc } from '../../services/feed';

export type MobileFeedFilter = 'all' | 'following' | 'subscribed' | 'media';
export type MobileFeedOrder = 'recommended' | 'latest';

/** 手機動態每次讀取的貼文上限；滿頁才視為可能還有下一頁。 */
export const MOBILE_FEED_PAGE_SIZE = 60;

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
    // 匿名貼文只用公開暱稱；不得用真實姓名或 authorUid 被搜到。
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
  // 推薦次序沿用載入時的排列，搜尋／篩選只做過濾、不重排。
  return options.order === 'latest'
    ? [...matched].sort((a, b) => timestamp(b.createdAt) - timestamp(a.createdAt))
    : matched;
}

export function mobileFeedHasMorePages(
  loadedCount: number,
  pageSize: number = MOBILE_FEED_PAGE_SIZE,
): boolean {
  return loadedCount > 0 && loadedCount >= pageSize;
}

export function mobileFeedSearchScopeLabel(loadedCount: number): string {
  return `搜尋範圍：已載入的 ${loadedCount} 篇貼文`;
}

export type MobileFeedRecoveryActionId =
  | 'load-more'
  | 'clear-filters'
  | 'open-boards'
  | 'open-realtime';

export type MobileFeedRecoveryAction = {
  id: MobileFeedRecoveryActionId;
  label: string;
};

export type MobileFeedSearchRecovery = {
  title: string;
  subtitle: string;
  keepSearch: boolean;
  actions: MobileFeedRecoveryAction[];
};

/**
 * 查無結果時的可操作下一步。有搜尋且 0 筆才回傳；離線時保留關鍵字並說明限制。
 */
export function describeMobileFeedSearchRecovery(input: {
  search: string;
  filter: MobileFeedFilter | 'saved';
  matchCount: number;
  loadedCount: number;
  hasMore: boolean;
  offline: boolean;
}): MobileFeedSearchRecovery | null {
  const query = input.search.trim();
  if (!query || input.matchCount > 0) return null;

  const hasActiveFilter = input.filter !== 'all';
  const actions: MobileFeedRecoveryAction[] = [];

  if (input.offline) {
    if (hasActiveFilter) actions.push({ id: 'clear-filters', label: '清除篩選' });
    actions.push({ id: 'open-boards', label: '前往看板' });
    actions.push({ id: 'open-realtime', label: '前往即時' });
    return {
      title: '離線中，找不到符合的貼文',
      subtitle:
        `目前只能在已載入的 ${input.loadedCount} 篇貼文裡搜尋；關鍵字已保留，恢復連線後可再載入更多。`,
      keepSearch: true,
      actions,
    };
  }

  if (input.hasMore) {
    actions.push({ id: 'load-more', label: '再載入更多後繼續找' });
  }
  if (hasActiveFilter) {
    actions.push({ id: 'clear-filters', label: '清除篩選' });
  }
  actions.push({ id: 'open-boards', label: '前往看板' });
  actions.push({ id: 'open-realtime', label: '前往即時' });

  return {
    title: '找不到符合的貼文',
    subtitle: input.hasMore
      ? `搜尋範圍是已載入的 ${input.loadedCount} 篇貼文，還可以載入更多後繼續找。`
      : `已在目前載入的 ${input.loadedCount} 篇貼文中找過，可清除篩選或改去看板／即時看看。`,
    keepSearch: true,
    actions,
  };
}
