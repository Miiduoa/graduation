/* eslint-disable */
/** 同校貼文與限時動態，可依訂閱看板或圖片篩選。 */
import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  FlatList,
  Image,
  Pressable,
  RefreshControl,
  ActivityIndicator,
  StyleSheet,
  Alert,
  Share,
  ScrollView,
  Dimensions,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { theme, shadowStyle } from '../../ui/theme';
import { useThemeStyleSheet } from '../../ui/useThemeStyleSheet';
import { EmptyState } from '../../ui/components';
import { TAB_BAR_CONTENT_BOTTOM_PADDING } from '../../ui/navigationTheme';
import { useAuth } from '../../state/auth';
import { shouldBlockForNoLogin, isDemoUid } from '../../services/demoSession';
import { useSchool } from '../../state/school';
import { getDb, isFirebaseMockMode } from '../../firebase';
import {
  fetchRecentCampusPosts,
  rankFeedPosts,
  toggleCampusPostLike,
  type CampusPostDoc,
} from '../../services/feed';
import { listBoards, listSubscribedBoardIds, type CampusBoard } from '../../services/boards';
import { listFollowingIds, followUser, unfollowUser } from '../../services/follows';
import {
  listActiveStoriesForSchool,
  groupStoriesByAuthor,
  type StoryAuthorGroup,
  type CampusStoryDoc,
} from '../../services/stories';
import { fetchSchoolDirectoryProfiles } from '../../services/memberDirectory';
import { toDate } from '../../utils/format';
import { useCampusSocialStackNav } from './CampusSocialNavContext';
import {
  describeMobileFeedSearchRecovery,
  mobileFeedHasMorePages,
  mobileFeedSearchScopeLabel,
  MOBILE_FEED_PAGE_SIZE,
  selectMobileFeedPosts,
  type MobileFeedOrder,
  type MobileFeedRecoveryActionId,
} from './feedDiscoveryModel';
import {
  listCampusPostBookmarkIds,
  loadCampusPostBookmarks,
  saveCampusPostBookmark,
  removeCampusPostBookmark,
} from '../../services/campusPostBookmarks';
import { useNetworkStatus } from '../../hooks/useNetworkStatus';

type FilterKey = 'all' | 'following' | 'subscribed' | 'media' | 'saved';
const EMPTY_SAVED_POSTS: CampusPostDoc[] = [];
const EMPTY_FOLLOWING_IDS: ReadonlySet<string> = new Set();

const FILTERS: { key: FilterKey; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: 'all', label: '全部', icon: 'sparkles-outline' },
  { key: 'following', label: '追蹤', icon: 'people-outline' },
  { key: 'subscribed', label: '我訂閱', icon: 'notifications-outline' },
  { key: 'media', label: '圖文', icon: 'image-outline' },
  { key: 'saved', label: '收藏', icon: 'bookmark-outline' },
];

function formatTs(t: unknown): string {
  const d = toDate(t as any);
  if (!d) return '';
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return '剛剛';
  if (diffMin < 60) return `${diffMin} 分鐘前`;
  if (diffMin < 60 * 24) return `${Math.floor(diffMin / 60)} 小時前`;
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function likesDisplay(p: CampusPostDoc): number {
  if (typeof p.likes === 'number') return p.likes;
  if (Array.isArray(p.likedBy)) return p.likedBy.length;
  return 0;
}

function repliesDisplay(p: CampusPostDoc): number {
  return typeof p.commentCount === 'number' ? p.commentCount : 0;
}

function mediaUrlsOf(p: CampusPostDoc): string[] {
  return Array.isArray(p.mediaUrls) ? p.mediaUrls.filter((u) => typeof u === 'string' && u.length > 0) : [];
}

function isAccessDenied(cause: unknown): boolean {
  const code = (cause as { code?: string })?.code ?? '';
  return code.endsWith('permission-denied') || code.endsWith('unauthenticated');
}

export function HomeFeedScreen() {
  const { user, loading } = useAuth();
  const { school } = useSchool();
  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 }}>
        <ActivityIndicator color={theme.colors.accent} />
        <Text style={{ color: theme.colors.textSecondary }}>正在確認登入狀態…</Text>
      </View>
    );
  }
  return <HomeFeedContent key={JSON.stringify([user?.uid, school?.id])} />;
}

function HomeFeedContent() {
  const styles = useThemeStyleSheet(createStyles);
  const injectedNav = useCampusSocialStackNav();
  const fallbackNav = useNavigation<any>();
  const nav = injectedNav ?? fallbackNav;
  const auth = useAuth();
  const { school } = useSchool();
  const insets = useSafeAreaInsets();
  // The parent remounts this content for every account/school change.
  // Native alerts also need fencing: they outlive the unmounted React tree.
  const active = useRef(true);
  React.useLayoutEffect(() => {
    active.current = true;
    return () => { active.current = false; };
  }, []);

  const [posts, setPosts] = useState<CampusPostDoc[]>([]);
  const [boards, setBoards] = useState<CampusBoard[]>([]);
  const [subscribedBoardIds, setSubscribedBoardIds] = useState<Set<string>>(new Set());
  const [stories, setStories] = useState<StoryAuthorGroup[]>([]);
  const [nameByUid, setNameByUid] = useState<Record<string, string>>({});
  const [avatarByUid, setAvatarByUid] = useState<Record<string, string>>({});
  const [filter, setFilter] = useState<FilterKey>('all');
  const [order, setOrder] = useState<MobileFeedOrder>('recommended');
  const [search, setSearch] = useState('');
  const [pageLimit, setPageLimit] = useState(MOBILE_FEED_PAGE_SIZE);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [accessDenied, setAccessDenied] = useState(false);
  const { isOffline } = useNetworkStatus();
  const likeFlightsRef = useRef<Set<string>>(new Set());
  const [pendingLikes, setPendingLikes] = useState<ReadonlySet<string>>(new Set());
  const [bookmarkScope, setBookmarkScope] = useState('');
  const [bookmarkedIds, setBookmarkedIds] = useState<ReadonlySet<string>>(new Set());
  const [bookmarkedPosts, setBookmarkedPosts] = useState<CampusPostDoc[]>([]);
  const [bookmarksLoading, setBookmarksLoading] = useState(false);
  const [bookmarksError, setBookmarksError] = useState('');
  const [bookmarkRevision, setBookmarkRevision] = useState(0);
  const bookmarkFlights = useRef<Set<string>>(new Set());
  const [bookmarksPending, setBookmarksPending] = useState<ReadonlySet<string>>(new Set());
  const savedView = filter === 'saved';
  const currentBookmarkScope = `${auth.user?.uid ?? ''}:${school?.id ?? ''}`;
  const validBookmarks = bookmarkScope === currentBookmarkScope;
  const savedIds = validBookmarks ? bookmarkedIds : new Set<string>();
  const savedPosts = validBookmarks ? bookmarkedPosts : EMPTY_SAVED_POSTS;
  const followingView = filter === 'following';
  const [followingScope, setFollowingScope] = useState('');
  const [followingIds, setFollowingIds] = useState<ReadonlySet<string>>(new Set());
  const [followingLoading, setFollowingLoading] = useState(false);
  const [followingError, setFollowingError] = useState('');
  const [followingRevision, setFollowingRevision] = useState(0);
  const [followingPending, setFollowingPending] = useState<ReadonlySet<string>>(new Set());
  const followFlights = useRef<Set<string>>(new Set());
  const currentFollowingScope = `${auth.user?.uid ?? ''}:${school?.id ?? ''}`;
  const followingScopeRef = useRef(currentFollowingScope);
  followingScopeRef.current = currentFollowingScope;
  const validFollowing = followingScope === currentFollowingScope;
  const followedIds = validFollowing ? followingIds : EMPTY_FOLLOWING_IDS;
  const loadVersion = useRef(0);

  const load = useCallback(async (limit: number = MOBILE_FEED_PAGE_SIZE) => {
    const version = ++loadVersion.current;
    setLoadError('');
    try {
      if (isFirebaseMockMode() || !school?.id || !auth.user?.uid) {
        setPosts([]);
        setBoards([]);
        setSubscribedBoardIds(new Set());
        setStories([]);
        setHasMore(false);
        setPageLimit(MOBILE_FEED_PAGE_SIZE);
        return;
      }
      const [rows, boardList, subs, storyRows] = await Promise.all([
        fetchRecentCampusPosts(school.id, undefined, limit),
        listBoards(school.id, 80),
        listSubscribedBoardIds(auth.user.uid, school.id, { throwOnError: true }),
        listActiveStoriesForSchool(school.id, 80, { throwOnError: true }),
      ]);
      if (loadVersion.current !== version) return;
      setAccessDenied(false);
      setPageLimit(limit);
      setHasMore(mobileFeedHasMorePages(rows.length, MOBILE_FEED_PAGE_SIZE) && rows.length >= limit);
      setPosts(rankFeedPosts(rows, Math.max(80, limit)));
      setBoards(boardList);
      setSubscribedBoardIds(new Set(subs));
      setStories(groupStoriesByAuthor(storyRows, auth.user.uid));
    } catch (cause) {
      if (loadVersion.current !== version) return;
      if (isAccessDenied(cause)) {
        setAccessDenied(true);
        setPosts([]);
        setBoards([]);
        setSubscribedBoardIds(new Set());
        setStories([]);
        setNameByUid({});
        setAvatarByUid({});
        setHasMore(false);
      }
      setLoadError('暫時無法更新校園動態。請確認網路與登入狀態，再試一次。');
    } finally {
      if (loadVersion.current === version) {
        setLoading(false);
        setRefreshing(false);
        setLoadingMore(false);
      }
    }
  }, [school?.id, auth.user?.uid]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    setBookmarkRevision((prev) => prev + 1);
    setFollowingRevision((prev) => prev + 1);
    await load(MOBILE_FEED_PAGE_SIZE);
  }, [load]);

  const onLoadMoreForSearch = useCallback(async () => {
    if (loadingMore || refreshing || loading || isOffline) return;
    setLoadingMore(true);
    await load(pageLimit + MOBILE_FEED_PAGE_SIZE);
  }, [isOffline, load, loading, loadingMore, pageLimit, refreshing]);

  React.useEffect(() => {
    const uid = auth.user?.uid;
    const schoolId = school?.id;
    if (!uid || !schoolId || isFirebaseMockMode()) {
      setBookmarkScope(uid && schoolId ? `${uid}:${schoolId}` : '');
      setBookmarkedIds(new Set());
      setBookmarkedPosts([]);
      setBookmarksLoading(false);
      setBookmarksError(isFirebaseMockMode() && savedView ? '示範模式不會讀取或寫入真實收藏。' : '');
      return;
    }
    let live = true;
    setBookmarksError('');
    if (savedView) setBookmarksLoading(true);
    void (async () => {
      if (savedView) {
        const saved = await loadCampusPostBookmarks(uid, schoolId);
        if (!live) return;
        setBookmarkedIds(new Set(saved.ids));
        setBookmarkedPosts(saved.posts);
      } else {
        const ids = await listCampusPostBookmarkIds(uid, schoolId);
        if (!live) return;
        setBookmarkedIds(new Set(ids));
      }
      setBookmarkScope(`${uid}:${schoolId}`);
    })()
      .catch((cause) => {
        if (!live) return;
        if (isAccessDenied(cause)) {
          setBookmarkScope('');
          setBookmarkedIds(new Set());
          setBookmarkedPosts([]);
        }
        setBookmarksError('收藏無法讀取，請檢查連線與校籍後重試。');
      })
      .finally(() => {
        if (live) setBookmarksLoading(false);
      });
    return () => { live = false; };
  }, [auth.user?.uid, school?.id, savedView, bookmarkRevision]);

  React.useEffect(() => {
    const uid = auth.user?.uid;
    const schoolId = school?.id;
    if (!uid || !schoolId || isFirebaseMockMode()) {
      setFollowingIds(new Set());
      setFollowingScope(uid && schoolId ? `${uid}:${schoolId}` : '');
      setFollowingLoading(false);
      setFollowingError(isFirebaseMockMode() ? '示範模式不會讀取真實追蹤清單。' : '');
      return;
    }
    const scope = `${uid}:${schoolId}`;
    let live = true;
    setFollowingLoading(true);
    setFollowingError('');
    void listFollowingIds(schoolId, uid, 200, { throwOnError: true })
      .then((ids) => {
        if (!live) return;
        setFollowingIds(new Set(ids));
        setFollowingScope(scope);
      })
      .catch((cause) => {
        if (!live) return;
        if (isAccessDenied(cause)) {
          setFollowingScope('');
          setFollowingIds(new Set());
        }
        setFollowingError('追蹤清單暫時無法讀取，請確認連線及校籍後重試。');
      })
      .finally(() => {
        if (live) setFollowingLoading(false);
      });
    return () => { live = false; };
  }, [auth.user?.uid, school?.id, followingRevision]);

  const onToggleFollow = useCallback(async (targetUid: string) => {
    const uid = auth.user?.uid;
    const schoolId = school?.id;
    if (
      !uid || !schoolId || !targetUid || targetUid === uid ||
      !validFollowing || followingLoading || !!followingError || isFirebaseMockMode() ||
      followFlights.current.has(targetUid)
    ) return;
    const scope = currentFollowingScope;
    const removing = followedIds.has(targetUid);
    followFlights.current.add(targetUid);
    setFollowingPending((prev) => new Set([...prev, targetUid]));
    try {
      if (removing) await unfollowUser(schoolId, uid, targetUid);
      else await followUser(schoolId, uid, targetUid);
      if (!active.current || followingScopeRef.current !== scope) return;
      setFollowingIds((prev) => {
        const next = new Set(prev);
        if (removing) next.delete(targetUid);
        else next.add(targetUid);
        return next;
      });
      setFollowingRevision((prev) => prev + 1);
    } catch {
      if (active.current && followingScopeRef.current === scope)
        Alert.alert('追蹤未更新', '請確認網路與對方校籍後重試。');
    } finally {
      followFlights.current.delete(targetUid);
      if (active.current && followingScopeRef.current === scope) {
        setFollowingPending((prev) => {
          const next = new Set(prev);
          next.delete(targetUid);
          return next;
        });
      }
    }
  }, [auth.user?.uid, school?.id, validFollowing, followingLoading, followingError, followedIds, currentFollowingScope]);

  const onToggleBookmark = useCallback(async (post: CampusPostDoc) => {
    const uid = auth.user?.uid;
    const schoolId = school?.id;
    if (!uid || !schoolId || isFirebaseMockMode() || bookmarkFlights.current.has(post.id)) {
      if (isFirebaseMockMode()) Alert.alert('尚未連線', '示範模式不會寫入真實收藏。');
      return;
    }
    const removing = savedIds.has(post.id);
    bookmarkFlights.current.add(post.id);
    setBookmarksPending((prev) => new Set([...prev, post.id]));
    try {
      if (removing) await removeCampusPostBookmark(uid, schoolId, post.id);
      else await saveCampusPostBookmark(uid, schoolId, post.id);
      if (!active.current) return;
      setBookmarkedIds((prev) => {
        const next = new Set(prev);
        if (removing) next.delete(post.id);
        else next.add(post.id);
        return next;
      });
      if (removing) setBookmarkedPosts((prev) => prev.filter((p) => p.id !== post.id));
      setBookmarkScope(`${uid}:${schoolId}`);
      setBookmarkRevision((prev) => prev + 1);
    } catch {
      if (active.current) Alert.alert('收藏未更新', '請確認網路與校籍後重試。');
    } finally {
      bookmarkFlights.current.delete(post.id);
      if (active.current) {
        setBookmarksPending((prev) => {
          const next = new Set(prev);
          next.delete(post.id);
          return next;
        });
      }
    }
  }, [auth.user?.uid, school?.id, savedIds]);

  const onToggleLike = useCallback(
    async (row: CampusPostDoc) => {
      const uid = auth.user?.uid;
      const sid = school?.id;
      if (!uid || !sid || isFirebaseMockMode()) {
        if (!uid) Alert.alert('請登入', '登入後即可按讚貼文');
        return;
      }
      if (likeFlightsRef.current.has(row.id)) return;
      likeFlightsRef.current.add(row.id);
      setPendingLikes((prev) => new Set([...prev, row.id]));

      // The server remains authoritative after optimistic feedback.
      const optimistic = (items: CampusPostDoc[]) =>
        items.map((p) => {
          if (p.id !== row.id) return p;
          const arr = Array.isArray(p.likedBy) ? [...p.likedBy] : [];
          const idx = arr.indexOf(uid);
          if (idx >= 0) arr.splice(idx, 1);
          else arr.push(uid);
          return {
            ...p, likedBy: arr,
            likes: typeof p.likes === 'number' ? Math.max(0, p.likes + (idx >= 0 ? -1 : 1)) : arr.length,
          };
        });
      setPosts(optimistic);
      setBookmarkedPosts(optimistic);

      try {
        await toggleCampusPostLike(sid, row.id, uid);
      } catch (e: any) {
        if (!active.current) return;
        const rollback = (items: CampusPostDoc[]) =>
          items.map((post) =>
            post.id === row.id ? { ...post, likedBy: row.likedBy, likes: row.likes } : post,
          );
        setPosts(rollback);
        setBookmarkedPosts(rollback);
        Alert.alert('按讚失敗', '目前無法更新貼文，請確認連線後再試。');
      } finally {
        likeFlightsRef.current.delete(row.id);
        if (active.current) {
          setPendingLikes((prev) => {
            const next = new Set(prev);
            next.delete(row.id);
            return next;
          });
        }
      }
    },
    [auth.user?.uid, school?.id],
  );

  React.useEffect(() => {
    setLoading(true);
    void load();
    return () => {
      loadVersion.current += 1;
    };
  }, [load]);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      // 把貼文作者 + Story 作者一起 hydrate（少一次 batch）
      const uids = new Set<string>();
      [...posts, ...savedPosts].forEach((p) => {
        if (!p.anonymous && p.authorUid) uids.add(p.authorUid);
      });
      stories.forEach((g) => uids.add(g.authorUid));
      if (!school?.id || uids.size === 0) {
        setNameByUid({});
        setAvatarByUid({});
        return;
      }
      const profiles = await fetchSchoolDirectoryProfiles(school.id, [...uids], getDb());
      if (cancelled) return;
      const nm: Record<string, string> = {};
      const av: Record<string, string> = {};
      profiles.forEach((p) => {
        nm[p.uid] = (p.displayName ?? p.uid.slice(0, 8)).trim();
        if (p.avatarUrl) av[p.uid] = p.avatarUrl;
      });
      setNameByUid(nm);
      setAvatarByUid(av);
    })();
    return () => {
      cancelled = true;
    };
  }, [posts, savedPosts, stories, school?.id]);

  const boardNameById = useMemo(() => {
    const m: Record<string, string> = {};
    boards.forEach((b) => {
      m[b.id] = b.name;
    });
    return m;
  }, [boards]);

  const sourcePosts = savedView ? savedPosts : posts;
  const visiblePosts = useMemo(
    () => selectMobileFeedPosts(sourcePosts, {
      filter: filter === 'saved' ? 'all' : filter,
      order,
      search,
      subscribedIds: subscribedBoardIds,
      followingIds: followedIds,
      boards: boardNameById,
      authors: nameByUid,
    }),
    [sourcePosts, filter, order, search, subscribedBoardIds, followedIds, boardNameById, nameByUid],
  );
  const savedUnavailable = savedView && (bookmarksLoading || !validBookmarks || !!bookmarksError);
  const followingUnavailable = followingView && (followingLoading || !validFollowing || !!followingError);
  const discoveryUnavailable = accessDenied || savedUnavailable || followingUnavailable;
  const searchScopeLabel = mobileFeedSearchScopeLabel(sourcePosts.length);
  const searchRecovery = useMemo(
    () => describeMobileFeedSearchRecovery({
      search,
      filter,
      matchCount: visiblePosts.length,
      loadedCount: sourcePosts.length,
      hasMore: !savedView && hasMore,
      offline: isOffline,
    }),
    [filter, hasMore, isOffline, savedView, search, sourcePosts.length, visiblePosts.length],
  );

  const selectFilter = (next: FilterKey) => {
    if (next === 'saved' && !savedView) setBookmarksLoading(true);
    setFilter(next);
  };

  const clearDiscoveryFilters = () => {
    setFilter('all');
    setSearch('');
  };

  const openCommunityTab = (tab: 'boards' | 'realtime') => {
    nav?.setParams?.({ initialTab: tab });
  };

  const runSearchRecovery = (action: MobileFeedRecoveryActionId) => {
    if (action === 'load-more') {
      void onLoadMoreForSearch();
      return;
    }
    if (action === 'clear-filters') {
      clearDiscoveryFilters();
      return;
    }
    if (action === 'open-boards') {
      openCommunityTab('boards');
      return;
    }
    if (action === 'open-topics') {
      openCommunityTab('realtime');
    }
  };

  const authorLine = (p: CampusPostDoc) => {
    if (p.anonymous) return p.aliasSnapshot ?? '匿名貼文';
    const uid = p.authorUid;
    if (!uid) return '成員';
    return nameByUid[uid] ?? '載入中…';
  };

  const goCompose = () => {
    nav?.navigate?.('PostCompose' as never);
  };

  const goStoryCompose = () => {
    nav?.navigate?.('StoryCompose' as never);
  };

  if (shouldBlockForNoLogin({ uid: auth.user?.uid ?? null, hasUser: !!auth.user })) {
    return (
      <View style={[styles.center, { paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING }]}>
        <Text style={{ color: theme.colors.textSecondary }}>請先登入以瀏覽校園動態</Text>
      </View>
    );
  }

  return (
    <View style={[styles.root, { paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING + insets.bottom }]}>
      {!!loadError && (
        <View style={{ padding: 16, gap: 8 }}>
          <Text accessibilityRole="alert" style={{ color: theme.colors.textSecondary }}>
            {loadError}
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => void onRefresh()}
            style={{ paddingVertical: 10 }}
          >
            <Text style={{ color: theme.colors.accent, fontWeight: '600' }}>重新讀取動態</Text>
          </Pressable>
        </View>
      )}
      {!!followingError && (
        <View style={{ paddingHorizontal: 16, paddingVertical: 9, gap: 6 }}>
          <Text accessibilityRole="alert" style={{ color: theme.colors.danger }}>{followingError}</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="重新載入追蹤"
            onPress={() => setFollowingRevision((prev) => prev + 1)}
          >
            <Text style={{ color: theme.colors.accent, fontWeight: '700' }}>重新載入追蹤</Text>
          </Pressable>
        </View>
      )}
      {savedView && !!bookmarksError && (
        <View style={{ paddingHorizontal: 16, paddingVertical: 9, gap: 8 }}>
          <Text accessibilityRole="alert" style={{ color: theme.colors.danger }}>{bookmarksError}</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="重新載入收藏"
            onPress={() => setBookmarkRevision((prev) => prev + 1)}
          >
            <Text style={{ color: theme.colors.accent, fontWeight: '700' }}>重新載入收藏</Text>
          </Pressable>
        </View>
      )}
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={theme.colors.accent} />
        </View>
      ) : (
        <FlatList
          style={{ flex: 1 }}
          data={discoveryUnavailable ? [] : visiblePosts}
          keyExtractor={(p) => p.id}
          removeClippedSubviews
          windowSize={7}
          initialNumToRender={8}
          maxToRenderPerBatch={8}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          ListHeaderComponent={
            <>
            <FeedHeader
              stories={stories}
              avatarByUid={avatarByUid}
              nameByUid={nameByUid}
              myUid={auth.user.uid}
              filter={filter}
              onSelectFilter={selectFilter}
              onOpenStoryGroup={(grp) => openStoryGroup(grp, nav, school?.id)}
              onComposeStory={goStoryCompose}
              onComposePost={goCompose}
            />
            <View style={{ paddingHorizontal: 14, paddingTop: 8, gap: 9 }}>
              <View style={{
                flexDirection: 'row', alignItems: 'center', minHeight: 44, gap: 9,
                paddingHorizontal: 12, borderWidth: StyleSheet.hairlineWidth,
                borderColor: theme.colors.border, borderRadius: theme.radius.md,
                backgroundColor: theme.colors.surface,
              }}>
                <Ionicons name="search" size={18} color={theme.colors.textSecondary} />
                <TextInput
                  style={{ flex: 1, minWidth: 0, color: theme.colors.text, paddingVertical: 10 }}
                  accessibilityLabel="搜尋本校貼文"
                  value={search}
                  onChangeText={setSearch}
                  placeholder="搜尋貼文、看板、標籤或作者"
                  placeholderTextColor={theme.colors.textSecondary}
                  returnKeyType="search"
                  autoCorrect={false}
                />
                {!!search && (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="清除搜尋"
                    hitSlop={10}
                    onPress={() => setSearch('')}
                  >
                    <Ionicons name="close-circle" size={20} color={theme.colors.textSecondary} />
                  </Pressable>
                )}
              </View>
              {!discoveryUnavailable && (
                <Text
                  accessibilityRole="text"
                  accessibilityLabel={searchScopeLabel}
                  style={{ color: theme.colors.textSecondary, fontSize: 12, fontWeight: '600' }}
                >
                  {searchScopeLabel}
                </Text>
              )}
              {isOffline && !!search.trim() && !discoveryUnavailable && (
                <Text
                  accessibilityRole="text"
                  style={{ color: theme.colors.warning, fontSize: 11, lineHeight: 16 }}
                >
                  目前離線，僅能搜尋已載入的貼文；輸入的關鍵字會保留。
                </Text>
              )}
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                {!discoveryUnavailable && <Text style={{ color: theme.colors.textSecondary, fontSize: 12 }}>
                  {savedView
                    ? `顯示 ${visiblePosts.length} 則收藏`
                    : followingView
                      ? `追蹤作者的貼文 ${visiblePosts.length} 則`
                      : `已載入 ${posts.length} 則 · 顯示 ${visiblePosts.length} 則`}
                </Text>}
                <View style={{ flexDirection: 'row', gap: 6 }}>
                  {([
                    { key: 'recommended', label: savedView ? '收藏順序' : '推薦' },
                    { key: 'latest', label: savedView ? '貼文最新' : '最新' },
                  ] as const).map((item) => (
                    <Pressable
                      key={item.key}
                      accessibilityRole="button"
                      accessibilityLabel={item.label}
                      accessibilityState={{ selected: order === item.key }}
                      onPress={() => setOrder(item.key)}
                      style={{
                        minHeight: 40, minWidth: 56, paddingHorizontal: 12,
                        alignItems: 'center', justifyContent: 'center',
                        borderRadius: theme.radius.md,
                        backgroundColor: order === item.key ? theme.colors.accent : theme.colors.surface,
                        borderWidth: StyleSheet.hairlineWidth, borderColor: theme.colors.border,
                      }}
                    >
                      <Text style={{
                        color: order === item.key ? theme.colors.onAccent : theme.colors.textSecondary,
                        fontSize: 12, fontWeight: '700',
                      }}>{item.label}</Text>
                    </Pressable>
                  ))}
                </View>
              </View>
              {!discoveryUnavailable && <Text style={{ color: theme.colors.textSecondary, fontSize: 11, lineHeight: 16 }}>
                {savedView
                  ? '顯示本校最近最多 40 筆私人收藏，可跨裝置同步'
                  : followingView
                    ? '只顯示目前載入的本校貼文中追蹤的作者'
                    : '搜尋與排序僅適用於本次載入的本校貼文，不是全站搜尋'}
              </Text>}
            </View>
            </>
          }
          ListEmptyComponent={
            loadError || (savedView && !!bookmarksError) || (followingView && !!followingError) ? null : (
              (savedView && (bookmarksLoading || !validBookmarks)) ||
                (followingView && (followingLoading || !validFollowing)) ? (
                <View style={{ alignItems: 'center', paddingVertical: 28, gap: 10 }}>
                  <ActivityIndicator color={theme.colors.accent} />
                  <Text style={{ color: theme.colors.textSecondary }}>
                    {followingView ? '正在讀取追蹤動態…' : '正在讀取收藏…'}
                  </Text>
                </View>
              ) : searchRecovery ? (
                <View style={{ paddingHorizontal: 14, paddingVertical: 20, gap: 12 }}>
                  <EmptyState
                    variant="search"
                    title={searchRecovery.title}
                    subtitle={searchRecovery.subtitle}
                  />
                  {loadingMore ? (
                    <View style={{ alignItems: 'center', paddingVertical: 8 }}>
                      <ActivityIndicator color={theme.colors.accent} />
                    </View>
                  ) : null}
                  <View style={{ gap: 8 }}>
                    {searchRecovery.actions.map((action) => (
                      <Pressable
                        key={action.id}
                        accessibilityRole="button"
                        accessibilityLabel={action.label}
                        disabled={action.id === 'load-more' && (loadingMore || isOffline)}
                        onPress={() => runSearchRecovery(action.id)}
                        style={{
                          minHeight: 44,
                          alignItems: 'center',
                          justifyContent: 'center',
                          borderRadius: theme.radius.md,
                          borderWidth: StyleSheet.hairlineWidth,
                          borderColor: theme.colors.border,
                          backgroundColor:
                            action.id === 'load-more' ? theme.colors.accent : theme.colors.surface,
                          opacity: action.id === 'load-more' && (loadingMore || isOffline) ? 0.55 : 1,
                        }}
                      >
                        <Text style={{
                          color: action.id === 'load-more'
                            ? theme.colors.onAccent
                            : theme.colors.text,
                          fontWeight: '700',
                          fontSize: 14,
                        }}>
                          {action.label}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                </View>
              ) : <EmptyState
                showCalmHero
                title={
                  filter === 'following' ? '追蹤的作者尚未發文'
                    : filter === 'saved' ? '還沒有收藏貼文'
                    : filter === 'subscribed' ? '尚無已訂閱看板的新貼文'
                    : '尚無校園貼文'}
                subtitle={
                  filter === 'following'
                    ? '先到「全部」動態追蹤感興趣的作者；目前只篩選已載入貼文。'
                    : filter === 'saved'
                      ? '到校園動態收藏有用的內容，之後可跨裝置找回。'
                  : filter === 'subscribed'
                    ? '到「看板」訂閱你想追的版面，或點右下角發第一篇。'
                    : '點右下角的鉛筆，發出你的第一篇貼文。'
                }
              />
            )
          }
          renderItem={({ item }) => {
            const uid = auth.user?.uid;
            const liked =
              !!(uid && Array.isArray(item.likedBy) && item.likedBy.includes(uid));
            const media = mediaUrlsOf(item);
            const avatar = !item.anonymous && item.authorUid ? avatarByUid[item.authorUid] : undefined;
            const board = boardNameById[item.boardId] ?? item.boardId;
            return (
              <Pressable
                style={styles.card}
                onPress={() => nav?.navigate?.('PostDetail' as never, { postId: item.id })}
              >
                <View style={styles.cardTop}>
                  {item.anonymous ? (
                    <View style={[styles.avatar, styles.avatarAnon]}>
                      <Ionicons name="leaf-outline" size={16} color={theme.colors.textSecondary} />
                    </View>
                  ) : avatar ? (
                    <Image source={{ uri: avatar }} style={styles.avatar} />
                  ) : (
                    <View style={[styles.avatar, styles.avatarPlaceholder]}>
                      <Text style={styles.avatarLetter}>{authorLine(item).slice(0, 1)}</Text>
                    </View>
                  )}
                  <View style={{ flex: 1 }}>
                    <Text style={styles.authorRow} numberOfLines={1}>
                      <Text style={styles.author}>{authorLine(item)}</Text>
                      <Text style={styles.dot}>  ·  </Text>
                      <Text style={styles.meta}>{formatTs(item.createdAt)}</Text>
                    </Text>
                    <Pressable
                      hitSlop={6}
                      onPress={() =>
                        nav?.navigate?.('BoardDetail' as never, {
                          boardId: item.boardId,
                          boardName: board,
                        })
                      }
                    >
                      <Text style={styles.boardChip}>＃{board}</Text>
                    </Pressable>
                  </View>
                  {!isFirebaseMockMode() &&
                    !item.anonymous &&
                    item.authorUid &&
                    item.authorUid !== uid &&
                    validFollowing && (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={followedIds.has(item.authorUid)
                          ? `取消追蹤 ${authorLine(item)}`
                          : `追蹤 ${authorLine(item)}`}
                        accessibilityState={{
                          selected: followedIds.has(item.authorUid),
                          disabled: followingLoading || !!followingError || followingPending.has(item.authorUid),
                        }}
                        disabled={followingLoading || !!followingError || followingPending.has(item.authorUid)}
                        hitSlop={8}
                        onPress={(event) => {
                          event.stopPropagation?.();
                          void onToggleFollow(item.authorUid!);
                        }}
                        style={[styles.authorFollow, followedIds.has(item.authorUid) && styles.authorFollowActive]}
                      >
                        <Text style={[
                          styles.authorFollowText,
                          followedIds.has(item.authorUid) && styles.authorFollowTextActive,
                        ]}>
                          {followedIds.has(item.authorUid) ? '追蹤中' : '追蹤'}
                        </Text>
                      </Pressable>
                    )}
                </View>

                <Text numberOfLines={2} style={styles.cardTitle}>
                  {item.title}
                </Text>
                <Text numberOfLines={media.length > 0 ? 3 : 5} style={styles.preview}>
                  {item.content}
                </Text>

                {media.length > 0 ? <MediaGrid uris={media.slice(0, 4)} /> : null}

                {(item.tags ?? []).length > 0 ? (
                  <View style={styles.tags}>
                    {(item.tags ?? []).slice(0, 4).map((t) => (
                      <Text key={`${item.id}_${t}`} style={styles.tag}>
                        #{t}
                      </Text>
                    ))}
                  </View>
                ) : null}

                <View style={styles.cardFooter}>
                  <Pressable
                    style={styles.statHit}
                    accessibilityRole="button"
                    accessibilityLabel={liked ? '取消按讚' : '按讚'}
                    accessibilityState={{ selected: liked, disabled: pendingLikes.has(item.id) }}
                    disabled={pendingLikes.has(item.id)}
                    hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}
                    onPress={(e) => {
                      e.stopPropagation?.();
                      void onToggleLike(item);
                    }}
                  >
                    <Ionicons
                      name={liked ? 'heart' : 'heart-outline'}
                      size={18}
                      color={liked ? theme.colors.danger : theme.colors.textSecondary}
                    />
                    <Text style={[styles.statLabel, liked && { color: theme.colors.danger }]}>
                      {likesDisplay(item)}
                    </Text>
                  </Pressable>
                  <View style={styles.statHit}>
                    <Ionicons name="chatbubble-outline" size={16} color={theme.colors.textSecondary} />
                    <Text style={styles.statLabel}>{repliesDisplay(item)}</Text>
                  </View>
                  <View style={{ flex: 1 }} />
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={savedIds.has(item.id) ? '取消收藏貼文' : '收藏貼文'}
                    accessibilityState={{ selected: savedIds.has(item.id), disabled: bookmarksPending.has(item.id) }}
                    disabled={bookmarksPending.has(item.id)}
                    style={styles.statHit}
                    hitSlop={8}
                    onPress={(event) => {
                      event?.stopPropagation?.();
                      void onToggleBookmark(item);
                    }}
                  >
                    <Ionicons
                      name={savedIds.has(item.id) ? 'bookmark' : 'bookmark-outline'}
                      size={18}
                      color={savedIds.has(item.id) ? theme.colors.accent : theme.colors.textSecondary}
                    />
                    <Text style={[styles.statLabel, savedIds.has(item.id) && { color: theme.colors.accent }]}>
                      {savedIds.has(item.id) ? '已收藏' : '收藏'}
                    </Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`分享貼文：${item.title}`}
                    style={styles.statHit}
                    hitSlop={8}
                    onPress={(event) => {
                      event.stopPropagation?.();
                      const url = `https://nuni.tw/community/post/${encodeURIComponent(item.id)}?schoolId=${encodeURIComponent(school?.id ?? '')}`;
                      void Share.share({ title: item.title, message: `${item.title}\n${url}`, url })
                        .catch(() => Alert.alert('暫時無法分享', '請稍後再試或從貼文詳情分享。'));
                    }}
                  >
                    <Ionicons name="share-outline" size={18} color={theme.colors.textSecondary} />
                    <Text style={styles.statLabel}>分享</Text>
                  </Pressable>
                  <Ionicons name="chevron-forward" size={16} color={theme.colors.border} />
                </View>
              </Pressable>
            );
          }}
        />
      )}

      {/* FAB：右下角 + 發文 */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="撰寫新貼文"
        onPress={goCompose}
        style={[
          styles.fab,
          {
            bottom: insets.bottom + TAB_BAR_CONTENT_BOTTOM_PADDING + 16,
          },
        ]}
      >
        <Ionicons name="create" size={22} color={theme.colors.onAccent} />
      </Pressable>
    </View>
  );
}

// ─── Header（Story Strip + 篩選） ──────────────────────────

function FeedHeader(props: {
  stories: StoryAuthorGroup[];
  avatarByUid: Record<string, string>;
  nameByUid: Record<string, string>;
  myUid: string;
  filter: FilterKey;
  onSelectFilter: (k: FilterKey) => void;
  onOpenStoryGroup: (g: StoryAuthorGroup) => void;
  onComposeStory: () => void;
  onComposePost: () => void;
}) {
  const styles = useThemeStyleSheet(createStyles);
  const {
    stories,
    avatarByUid,
    nameByUid,
    myUid,
    filter,
    onSelectFilter,
    onOpenStoryGroup,
    onComposeStory,
  } = props;

  const myGroup = stories.find((g) => g.authorUid === myUid) ?? null;
  const others = stories.filter((g) => g.authorUid !== myUid);

  return (
    <View>
      {/* Story strip */}
      <View style={styles.storyStripWrap}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 14, gap: 14 }}
        >
          <Pressable
            style={styles.storyItem}
            onPress={() => myGroup ? onOpenStoryGroup(myGroup) : onComposeStory()}
            accessibilityRole="button"
            accessibilityLabel={myGroup ? '查看我的 Story' : '發布 Story'}
          >
            <View style={[styles.storyRing, styles.storyAddRing]}>
              {myGroup ? (
                avatarByUid[myUid] ? (
                  <Image source={{ uri: avatarByUid[myUid] }} style={styles.storyImg} />
                ) : (
                  <View style={[styles.storyImg, styles.storyAvatarFallback]}>
                    <Ionicons name="person" size={20} color={theme.colors.onAccent} />
                  </View>
                )
              ) : (
                <View style={[styles.storyImg, styles.storyAddInner]}>
                  <Ionicons name="add" size={26} color={theme.colors.accent} />
                </View>
              )}
            </View>
            <Text numberOfLines={1} style={styles.storyName}>
              {myGroup ? '我的 Story' : '新增'}
            </Text>
          </Pressable>
          {!!myGroup && (
            <Pressable
              style={styles.storyItem}
              onPress={onComposeStory}
              accessibilityRole="button"
              accessibilityLabel="新增 Story"
            >
              <View style={[styles.storyRing, styles.storyAddRing]}>
                <View style={[styles.storyImg, styles.storyAddInner]}>
                  <Ionicons name="add" size={26} color={theme.colors.accent} />
                </View>
              </View>
              <Text style={styles.storyName}>新增</Text>
            </Pressable>
          )}
          {others.map((g) => {
            const av = avatarByUid[g.authorUid];
            return (
              <Pressable
                key={g.authorUid}
                style={styles.storyItem}
                onPress={() => onOpenStoryGroup(g)}
                accessibilityRole="button"
                accessibilityLabel={`查看 ${nameByUid[g.authorUid] ?? '同學'} 的 Story`}
              >
                <View style={styles.storyRing}>
                  {av ? (
                    <Image source={{ uri: av }} style={styles.storyImg} />
                  ) : (
                    <View style={[styles.storyImg, styles.storyAvatarFallback]}>
                      <Text style={styles.storyLetter}>
                        {(nameByUid[g.authorUid] ?? '?').slice(0, 1).toUpperCase()}
                      </Text>
                    </View>
                  )}
                </View>
                <Text numberOfLines={1} style={styles.storyName}>
                  {nameByUid[g.authorUid] ?? g.authorUid.slice(0, 6)}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      {/* Filter chips */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
        {FILTERS.map((f) => {
          const active = filter === f.key;
          return (
            <Pressable
              key={f.key}
              onPress={() => onSelectFilter(f.key)}
              accessibilityRole="tab"
              accessibilityLabel={`${f.label}分類`}
              accessibilityState={{ selected: active }}
              style={[styles.filterChip, active && styles.filterChipActive]}
            >
              <Ionicons
                name={f.icon}
                size={14}
                color={active ? theme.colors.onAccent : theme.colors.textSecondary}
              />
              <Text style={[styles.filterTxt, active && styles.filterTxtActive]}>{f.label}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

// ─── Media Grid（1~4 張） ───────────────────────────────────

function MediaGrid({ uris }: { uris: string[] }) {
  const styles = useThemeStyleSheet(createStyles);
  const w = Dimensions.get('window').width - 28; // root padding 14*2
  const inner = w - 24; // card padding 12*2
  if (uris.length === 1) {
    return (
      <View style={{ marginTop: theme.space.md, borderRadius: theme.radius.md, overflow: 'hidden' }}>
        <Image source={{ uri: uris[0] }} style={{ width: inner, height: Math.round(inner * 0.62) }} />
      </View>
    );
  }
  const cellSize = (inner - 6) / 2;
  return (
    <View style={[styles.mediaGrid, { marginTop: theme.space.md }]}>
      {uris.map((u) => (
        <Image key={u} source={{ uri: u }} style={{ width: cellSize, height: cellSize, borderRadius: theme.radius.sm }} />
      ))}
    </View>
  );
}

// ─── 開啟 Story group → 全螢幕 viewer ─────────────────────

function openStoryGroup(grp: StoryAuthorGroup, nav: any, schoolId?: string) {
  if (!grp.stories.length || !schoolId || !grp.stories.every((story) => story.schoolId === schoolId)) return;
  // Open the existing full-screen story viewer within the same school context.
  nav?.navigate?.('CampusSocialScreen' as never, {
    initialTab: 'realtime',
    storyAuthorUid: grp.authorUid,
    storySchoolId: schoolId,
  });
}

const createStyles = () => StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: theme.colors.bg,
  },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  storyStripWrap: {
    paddingVertical: theme.space.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.colors.border,
    backgroundColor: theme.colors.bg,
  },
  storyItem: { width: 64, alignItems: 'center' },
  storyRing: {
    width: 60,
    height: 60,
    borderRadius: 30,
    borderWidth: 2,
    borderColor: theme.colors.accent,
    padding: 2,
    backgroundColor: theme.colors.surface,
  },
  storyAddRing: { borderColor: theme.colors.border, borderStyle: 'dashed' },
  storyImg: { width: '100%', height: '100%', borderRadius: 26 },
  storyAvatarFallback: {
    backgroundColor: theme.colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  storyAddInner: {
    backgroundColor: theme.colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 26,
  },
  storyLetter: { fontSize: 18, color: theme.colors.onAccent, fontWeight: '700' },
  storyName: {
    marginTop: 4,
    fontSize: 11,
    color: theme.colors.textSecondary,
    textAlign: 'center',
    maxWidth: 64,
  },

  filterRow: {
    flexDirection: 'row',
    paddingHorizontal: 14,
    paddingTop: theme.space.md,
    paddingBottom: theme.space.sm,
    gap: 8,
  },
  filterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
  },
  filterChipActive: {
    backgroundColor: theme.colors.accent,
    borderColor: theme.colors.accent,
  },
  filterTxt: { fontSize: 12, color: theme.colors.textSecondary, fontWeight: '600' },
  filterTxtActive: { color: theme.colors.onAccent },

    card: {
      backgroundColor: theme.colors.surfaceElevated,
      marginHorizontal: 14,
      marginTop: theme.space.md,
      borderRadius: theme.radius.xl,
      padding: 12,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.colors.border,
      ...(theme.mode === 'light' ? shadowStyle(theme.shadows.md) : shadowStyle(theme.shadows.sm)),
    },
    cardTop: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 },
    avatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: theme.colors.surface },
    avatarAnon: {
      backgroundColor: theme.colors.surface,
      alignItems: 'center',
      justifyContent: 'center',
    },
    avatarPlaceholder: {
      backgroundColor: theme.colors.accent,
      alignItems: 'center',
      justifyContent: 'center',
    },
    avatarLetter: { color: theme.colors.onAccent, fontWeight: '700' },
    authorRow: { fontSize: 13, color: theme.colors.text },
    author: { color: theme.colors.text, fontWeight: '700' },
    dot: { color: theme.colors.muted },
    meta: { color: theme.colors.textSecondary, fontWeight: '500', fontSize: 12 },
    boardChip: {
      marginTop: 2,
      color: theme.colors.accent,
      fontWeight: '700',
      fontSize: 12,
    },

  authorFollow: {
    minHeight: 36,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
  },
  authorFollowActive: {
    borderColor: theme.colors.accent,
    backgroundColor: theme.colors.accentSoft,
  },
  authorFollowText: { fontSize: 12, fontWeight: '700', color: theme.colors.text },
  authorFollowTextActive: { color: theme.colors.accent },
  cardTitle: { fontSize: 16, fontWeight: '700', color: theme.colors.text, marginBottom: 4 },
  preview: { fontSize: 14, color: theme.colors.textSecondary, lineHeight: 20 },

  mediaGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    borderRadius: theme.radius.md,
    overflow: 'hidden',
  },

  tags: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: theme.space.sm,
  },
  tag: {
    fontSize: 12,
    color: theme.colors.accent,
    backgroundColor: theme.colors.accentSoft ?? 'rgba(124,93,250,0.12)',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
  },

  cardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: theme.space.md,
    paddingTop: theme.space.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.colors.border,
    gap: 18,
  },
  statHit: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  statLabel: { fontSize: 13, fontWeight: '700', color: theme.colors.textSecondary },

  fab: {
    position: 'absolute',
    right: 16,
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: theme.colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadowStyle(theme.shadows.lg),
  },
});

export default HomeFeedScreen;
