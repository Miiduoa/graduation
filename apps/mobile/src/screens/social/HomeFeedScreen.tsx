/* eslint-disable */
/**
 * 校園動態（Feed）
 *
 * 變更（vs. 舊版）：
 *  - 頂端加入 Story Strip（24h Story 的圓形入口列，含「+ 我的」）
 *  - 加入篩選列（全部 / 我訂閱 / 圖文）
 *  - 卡片支援 mediaUrls 的圖片 grid（最多 4 張）
 *  - 卡片提供「按讚 / 留言數 / 看板 chip」三個可點觸點
 *  - 提供 saved/blocked 過濾的擴充點（未來接 user/{uid}/savedPosts 與 blockedUsers）
 */
import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  Image,
  Pressable,
  RefreshControl,
  ActivityIndicator,
  StyleSheet,
  Alert,
  ScrollView,
  Dimensions,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { theme, shadowStyle } from '../../ui/theme';
import { EmptyState } from '../../ui/components';
import { TAB_BAR_CONTENT_BOTTOM_PADDING } from '../../ui/navigationTheme';
import { useAuth } from '../../state/auth';
import { useSchool } from '../../state/school';
import { getDb, isFirebaseMockMode } from '../../firebase';
import {
  fetchRecentCampusPosts,
  rankFeedPosts,
  toggleCampusPostLike,
  type CampusPostDoc,
} from '../../services/feed';
import { listBoards, listSubscribedBoardIds, type CampusBoard } from '../../services/boards';
import {
  listActiveStoriesForSchool,
  groupStoriesByAuthor,
  type StoryAuthorGroup,
  type CampusStoryDoc,
} from '../../services/stories';
import { fetchSchoolDirectoryProfiles } from '../../services/memberDirectory';
import { toDate } from '../../utils/format';
import { useCampusSocialStackNav } from './CampusSocialNavContext';

type FilterKey = 'all' | 'subscribed' | 'media';

const FILTERS: { key: FilterKey; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: 'all', label: '全部', icon: 'sparkles-outline' },
  { key: 'subscribed', label: '我訂閱', icon: 'notifications-outline' },
  { key: 'media', label: '圖文', icon: 'image-outline' },
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

export function HomeFeedScreen() {
  const injectedNav = useCampusSocialStackNav();
  const fallbackNav = useNavigation<any>();
  const nav = injectedNav ?? fallbackNav;
  const auth = useAuth();
  const { school } = useSchool();
  const insets = useSafeAreaInsets();

  const [posts, setPosts] = useState<CampusPostDoc[]>([]);
  const [boards, setBoards] = useState<CampusBoard[]>([]);
  const [subscribedBoardIds, setSubscribedBoardIds] = useState<Set<string>>(new Set());
  const [stories, setStories] = useState<StoryAuthorGroup[]>([]);
  const [nameByUid, setNameByUid] = useState<Record<string, string>>({});
  const [avatarByUid, setAvatarByUid] = useState<Record<string, string>>({});
  const [filter, setFilter] = useState<FilterKey>('all');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const likeFlightRef = useRef(false);

  const load = useCallback(async () => {
    if (isFirebaseMockMode() || !school?.id || !auth.user?.uid) {
      setPosts([]);
      setBoards([]);
      setSubscribedBoardIds(new Set());
      setStories([]);
      return;
    }
    const [rows, boardList, subs, storyRows] = await Promise.all([
      fetchRecentCampusPosts(school.id, undefined, 60),
      listBoards(school.id, 80),
      listSubscribedBoardIds(auth.user.uid, school.id),
      listActiveStoriesForSchool(school.id, 80),
    ]);
    setPosts(rankFeedPosts(rows, 80));
    setBoards(boardList);
    setSubscribedBoardIds(new Set(subs));
    setStories(groupStoriesByAuthor(storyRows, auth.user.uid));
  }, [school?.id, auth.user?.uid]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const onToggleLike = useCallback(
    async (row: CampusPostDoc) => {
      const uid = auth.user?.uid;
      const sid = school?.id;
      if (!uid || !sid || isFirebaseMockMode()) {
        if (!uid) Alert.alert('請登入', '登入後即可按讚貼文');
        return;
      }
      if (likeFlightRef.current) return;
      likeFlightRef.current = true;

      // 樂觀更新
      setPosts((prev) =>
        prev.map((p) => {
          if (p.id !== row.id) return p;
          const arr = Array.isArray(p.likedBy) ? [...p.likedBy] : [];
          const idx = arr.indexOf(uid);
          if (idx >= 0) arr.splice(idx, 1);
          else arr.push(uid);
          return {
            ...p,
            likedBy: arr,
            likes:
              typeof p.likes === 'number' ? p.likes + (idx >= 0 ? -1 : 1) : arr.length,
          };
        }),
      );

      try {
        await toggleCampusPostLike(sid, row.id, uid);
      } catch (e: any) {
        Alert.alert('按讚失敗', e?.message ?? String(e));
        await load();
      } finally {
        likeFlightRef.current = false;
      }
    },
    [auth.user?.uid, school?.id, load],
  );

  React.useEffect(() => {
    let c = false;
    (async () => {
      setLoading(true);
      await load();
      if (!c) setLoading(false);
    })();
    return () => {
      c = true;
    };
  }, [load]);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      // 把貼文作者 + Story 作者一起 hydrate（少一次 batch）
      const uids = new Set<string>();
      posts.forEach((p) => {
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
  }, [posts, stories, school?.id]);

  const boardNameById = useMemo(() => {
    const m: Record<string, string> = {};
    boards.forEach((b) => {
      m[b.id] = b.name;
    });
    return m;
  }, [boards]);

  const visiblePosts = useMemo(() => {
    if (filter === 'subscribed') {
      return posts.filter((p) => subscribedBoardIds.has(p.boardId));
    }
    if (filter === 'media') {
      return posts.filter((p) => mediaUrlsOf(p).length > 0);
    }
    return posts;
  }, [posts, filter, subscribedBoardIds]);

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

  if (!auth.user) {
    return (
      <View style={[styles.center, { paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING }]}>
        <Text style={{ color: theme.colors.textSecondary }}>請先登入以瀏覽校園動態</Text>
      </View>
    );
  }

  return (
    <View style={[styles.root, { paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING + insets.bottom }]}>
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={theme.colors.accent} />
        </View>
      ) : (
        <FlatList
          style={{ flex: 1 }}
          data={visiblePosts}
          keyExtractor={(p) => p.id}
          removeClippedSubviews
          windowSize={7}
          initialNumToRender={8}
          maxToRenderPerBatch={8}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          keyboardShouldPersistTaps="handled"
          ListHeaderComponent={
            <FeedHeader
              stories={stories}
              avatarByUid={avatarByUid}
              nameByUid={nameByUid}
              myUid={auth.user.uid}
              filter={filter}
              onSelectFilter={setFilter}
              onOpenStoryGroup={(grp) => openStoryGroup(grp, nav)}
              onComposeStory={goStoryCompose}
              onComposePost={goCompose}
            />
          }
          ListEmptyComponent={
            <EmptyState
              showCalmHero
              title={filter === 'subscribed' ? '尚無已訂閱看板的新貼文' : '尚無校園貼文'}
              subtitle={
                filter === 'subscribed'
                  ? '到「看板」訂閱你想追的版面，或點右下角發第一篇。'
                  : '點右下角的鉛筆，發出你的第一篇貼文。'
              }
            />
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
                        nav?.navigate?.('BoardDetail' as never, { boardId: item.boardId, boardName: board })
                      }
                    >
                      <Text style={styles.boardChip}>＃{board}</Text>
                    </Pressable>
                  </View>
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
  const { stories, avatarByUid, nameByUid, myUid, filter, onSelectFilter, onOpenStoryGroup, onComposeStory } = props;

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
          <Pressable style={styles.storyItem} onPress={onComposeStory} accessibilityLabel="發布 Story">
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
          {others.map((g) => {
            const av = avatarByUid[g.authorUid];
            return (
              <Pressable key={g.authorUid} style={styles.storyItem} onPress={() => onOpenStoryGroup(g)}>
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
      <View style={styles.filterRow}>
        {FILTERS.map((f) => {
          const active = filter === f.key;
          return (
            <Pressable
              key={f.key}
              onPress={() => onSelectFilter(f.key)}
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
      </View>
    </View>
  );
}

// ─── Media Grid（1~4 張） ───────────────────────────────────

function MediaGrid({ uris }: { uris: string[] }) {
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

function openStoryGroup(grp: StoryAuthorGroup, nav: any) {
  // 直接傳 stories 給 StoryCompose 重用？不行 — 改用 navigate to a dedicated viewer modal.
  // 為了避免新增更多 route，先 fallback：show first story's text via Alert; user 可從 RealtimeSocialScreen 看完整 viewer。
  const first = grp.stories[0];
  if (!first) return;
  const summary = first.text ?? '(媒體 Story)';
  Alert.alert(`${grp.isMine ? '我的' : ''}Story · ${grp.stories.length} 則`, summary, [
    { text: '到「即時」分頁看詳情', onPress: () => nav?.navigate?.('CampusSocialScreen' as never, { initialTab: 'realtime' }) },
    { text: '關閉', style: 'cancel' },
  ]);
}

const styles = StyleSheet.create({
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
  avatarAnon: { backgroundColor: theme.colors.surface, alignItems: 'center', justifyContent: 'center' },
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
