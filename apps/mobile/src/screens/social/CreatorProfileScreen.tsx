import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, FlatList, Image, Pressable, RefreshControl, Share,
  StyleSheet, Text, View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../state/auth';
import { useSchool } from '../../state/school';
import { isFirebaseMockMode } from '../../firebase';
import { useThemeStyleSheet } from '../../ui/useThemeStyleSheet';
import { theme } from '../../ui/theme';
import { TAB_BAR_CONTENT_BOTTOM_PADDING } from '../../ui/navigationTheme';
import { loadCampusPostBookmarks } from '../../services/campusPostBookmarks';
import { followUser, listFollowingIds, unfollowUser } from '../../services/follows';
import {
  listCreatorPosts, readCreatorIdentity,
  type CreatorCursor, type CreatorIdentity,
} from '../../services/creatorProfile';
import type { CampusPostDoc } from '../../services/feed';
import { readCreatorPin, saveCreatorPin, type CreatorPin } from '../../services/creatorPin';
import { CreatorCardPanel } from './CreatorCardPanel';
import { CreatorHighlight } from './CreatorHighlight';

type ProfileTab = 'posts' | 'media' | 'saved';
type ReadState<T> =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; value: T };
type PostsPage = { rows: CampusPostDoc[]; cursor: CreatorCursor; hasMore: boolean };
type FollowState = 'loading' | 'following' | 'not-following' | 'pending' | 'error';
type PinState = { status: 'loading' } | { status: 'error' } | { status: 'ready'; value: CreatorPin };
type CreatorListItem = {
  key: string;
  post: CampusPostDoc;
  mediaUrl?: string;
  mediaIndex?: number;
};

type Props = {
  navigation?: { navigate?: (screen: string, params?: Record<string, unknown>) => void };
  route?: { params?: { memberUid?: string; schoolId?: string } };
};

function mediaUrls(post: CampusPostDoc) {
  return Array.isArray(post.mediaUrls)
    ? post.mediaUrls.filter((url): url is string => typeof url === 'string' && /^https:\/\/\S+$/i.test(url))
    : [];
}

function isVideo(url: string) {
  return /\.(mp4|webm|mov)(?:[?#]|$)/i.test(url);
}

function dateOf(value: unknown) {
  let date: Date | null = null;
  if (value instanceof Date) date = value;
  else if (value && typeof (value as { toDate?: unknown }).toDate === 'function') {
    date = (value as { toDate: () => Date }).toDate();
  }
  return date && !Number.isNaN(date.getTime())
    ? new Intl.DateTimeFormat('zh-TW', { month: 'short', day: 'numeric' }).format(date) : '';
}

function Action({
  label, onPress, solid = false, disabled = false,
}: {
  label: string;
  onPress: () => void;
  solid?: boolean;
  disabled?: boolean;
}) {
  const styles = useThemeStyleSheet(createStyles);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.action, solid && styles.actionSolid,
        (pressed || disabled) && { opacity: 0.65 }]}
    >
      <Text style={[styles.actionText, solid && styles.actionTextSolid]}>{label}</Text>
    </Pressable>
  );
}

function ScopedCreatorProfile({
  navigation, schoolId, schoolName, memberUid, viewerUid, ownName,
}: {
  navigation?: Props['navigation'];
  schoolId: string; schoolName: string; memberUid: string; viewerUid: string; ownName: string;
}) {
  const styles = useThemeStyleSheet(createStyles);
  const own = viewerUid === memberUid;
  const [tab, setTab] = useState<ProfileTab>('posts');
  const [identity, setIdentity] = useState<ReadState<CreatorIdentity | null>>({ status: 'loading' });
  const [posts, setPosts] = useState<ReadState<PostsPage>>({ status: 'loading' });
  const [saved, setSaved] = useState<ReadState<CampusPostDoc[]>>({ status: 'loading' });
  const [followState, setFollowState] = useState<FollowState>('loading');
  const [followRevision, setFollowRevision] = useState(0);
  const [refreshRevision, setRefreshRevision] = useState(0);
  const [savedRevision, setSavedRevision] = useState(0);
  const [moreBusy, setMoreBusy] = useState(false);
  const [moreError, setMoreError] = useState('');
  const [followError, setFollowError] = useState('');
  const [pin, setPin] = useState<PinState>({ status: 'loading' });
  const [pinRevision, setPinRevision] = useState(0);
  const [pinBusy, setPinBusy] = useState(false);
  const [pinFeedback, setPinFeedback] = useState('');
  const mounted = useRef(false);
  const version = useRef(0);
  const moreFlight = useRef(false);
  const followFlight = useRef(false);
  const pinFlight = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    let live = true;
    const current = ++version.current;
    setPosts({ status: 'loading' });
    setIdentity({ status: 'loading' });
    setMoreError('');
    setMoreBusy(false);
    moreFlight.current = false;
    void readCreatorIdentity(schoolId, memberUid).then((value) => {
      if (live && version.current === current) setIdentity({ status: 'ready', value });
    }).catch(() => {
      if (live && version.current === current) setIdentity({ status: 'error' });
    });
    void listCreatorPosts(schoolId, memberUid).then((page) => {
      if (live && version.current === current) setPosts({
        status: 'ready', value: { rows: page.posts, cursor: page.cursor, hasMore: page.hasMore },
      });
    }).catch(() => {
      if (live && version.current === current) setPosts({ status: 'error' });
    });
    return () => { live = false; };
  }, [schoolId, memberUid, refreshRevision]);

  useEffect(() => {
    if (own) return;
    let live = true;
    setFollowState('loading');
    setFollowError('');
    void listFollowingIds(schoolId, viewerUid, 200, { throwOnError: true }).then((uids) => {
      if (live) setFollowState(uids.includes(memberUid) ? 'following' : 'not-following');
    }).catch(() => { if (live) setFollowState('error'); });
    return () => { live = false; };
  }, [own, schoolId, viewerUid, memberUid, followRevision]);

  useEffect(() => {
    if (!own || tab !== 'saved') return;
    let live = true;
    setSaved({ status: 'loading' });
    void loadCampusPostBookmarks(viewerUid, schoolId, 40).then((result) => {
      if (live) setSaved({ status: 'ready', value: result.posts.filter((p) => p.schoolId === schoolId) });
    }).catch(() => { if (live) setSaved({ status: 'error' }); });
    return () => { live = false; };
  }, [own, tab, viewerUid, schoolId, savedRevision]);

  const onMore = useCallback(async () => {
    if (posts.status !== 'ready' || !posts.value.hasMore || !posts.value.cursor || moreFlight.current) return;
    moreFlight.current = true;
    const current = version.current;
    setMoreBusy(true);
    setMoreError('');
    try {
      const next = await listCreatorPosts(schoolId, memberUid, posts.value.cursor);
      if (!mounted.current || version.current !== current) return;
      setPosts((prior) => {
        if (prior.status !== 'ready') return prior;
        const byId = new Map(prior.value.rows.map((row) => [row.id, row]));
        for (const row of next.posts) byId.set(row.id, row);
        return {
          status: 'ready',
          value: { rows: [...byId.values()], cursor: next.cursor, hasMore: next.hasMore },
        };
      });
    } catch {
      if (mounted.current && version.current === current) setMoreError('無法載入更多貼文，可再試一次。');
    } finally {
      moreFlight.current = false;
      if (mounted.current && version.current === current) setMoreBusy(false);
    }
  }, [posts, schoolId, memberUid]);

  const onFollow = useCallback(async () => {
    if (own || followFlight.current || !['following', 'not-following'].includes(followState)) return;
    const wasFollowing = followState === 'following';
    followFlight.current = true;
    setFollowError('');
    setFollowState('pending');
    try {
      if (wasFollowing) await unfollowUser(schoolId, viewerUid, memberUid);
      else await followUser(schoolId, viewerUid, memberUid);
      if (mounted.current) setFollowState(wasFollowing ? 'not-following' : 'following');
    } catch {
      if (mounted.current) {
        setFollowState('error');
        setFollowError('追蹤沒有更新，請重新確認。');
      }
    } finally { followFlight.current = false; }
  }, [own, followState, schoolId, viewerUid, memberUid]);

  useEffect(() => {
    let live = true;
    setPin({ status: 'loading' });
    setPinFeedback('');
    void readCreatorPin(schoolId, memberUid).then((result) => {
      if (live) setPin({ status: 'ready', value: result });
    }).catch(() => {
      if (live) setPin({ status: 'error' });
    });
    return () => { live = false; };
  }, [schoolId, memberUid, pinRevision]);

  const changePin = useCallback(async (postId: string) => {
    if (!own || pin.status !== 'ready' || pinFlight.current) return;
    pinFlight.current = true;
    setPinBusy(true);
    setPinFeedback('');
    try {
      const confirmed = await saveCreatorPin(schoolId, viewerUid, postId);
      if (!mounted.current) return;
      setPin({ status: 'ready', value: confirmed });
      setPinFeedback(postId ? '已置頂到個人頁。' : '已取消置頂。');
    } catch {
      if (mounted.current) setPinFeedback('尚未確認置頂變更，請檢查連線和貼文狀態後重試。');
    } finally {
      pinFlight.current = false;
      if (mounted.current) setPinBusy(false);
    }
  }, [own, pin.status, schoolId, viewerUid]);

  const onShare = () => {
    const url = `https://nuni.tw/community/member/${encodeURIComponent(memberUid)}?schoolId=${encodeURIComponent(schoolId)}`;
    void Share.share({ message: `校園個人頁（需具備所屬校園權限）\n${url}`, url })
      .catch(() => undefined);
  };
  const displayName = identity.status === 'ready' && identity.value?.displayName
    ? identity.value.displayName : own ? ownName : '校園成員';
  const avatarUrl = identity.status === 'ready' ? identity.value?.avatarUrl : null;
  const postRows = posts.status === 'ready' ? posts.value.rows : [];
  const pinnedPost = pin.status === 'ready' ? pin.value.post : null;
  const visiblePosts = tab === 'saved'
    ? saved.status === 'ready' ? saved.value : []
    : tab === 'posts' && pinnedPost
      ? postRows.filter((post) => post.id !== pinnedPost.id) : postRows;
  const rows: CreatorListItem[] = tab === 'media'
    ? postRows.flatMap((post) => mediaUrls(post).map((url, mediaIndex) => ({
        key: `media:${post.id}:${mediaIndex}`, post, mediaUrl: url, mediaIndex,
      })))
    : visiblePosts.map((post) => ({ key: `post:${post.id}`, post }));
  const reading = tab === 'saved' ? saved.status === 'loading' : posts.status === 'loading' || (tab === 'posts' && pin.status === 'loading');
  const failed = tab === 'saved' ? saved.status === 'error' : posts.status === 'error';

  const retry = () => tab === 'saved'
    ? setSavedRevision((n) => n + 1)
    : setRefreshRevision((n) => n + 1);

  return (
    <FlatList
      key={tab === 'media' ? 'media' : 'list'}
      testID="creator-profile-list"
      style={styles.root}
      contentContainerStyle={styles.listContent}
      data={reading || failed ? [] : rows}
      keyExtractor={(entry) => entry.key}
      numColumns={tab === 'media' ? 3 : 1}
      refreshControl={<RefreshControl refreshing={reading} onRefresh={retry} />}
      ListHeaderComponent={
        <>
          <View style={styles.header}>
            <View style={styles.identity}>
              <View style={styles.avatar}>
                {avatarUrl
                  ? <Image source={{ uri: avatarUrl }} style={styles.avatarImage} />
                  : <Text style={styles.avatarText}>{displayName.slice(0, 1)}</Text>}
              </View>
              <View style={styles.identityText}>
                <Text style={styles.school}>{schoolName}</Text>
                <Text style={styles.displayName}>{displayName}</Text>
                <Text style={styles.scope}>僅所屬校園成員可查看公開貼文</Text>
              </View>
            </View>
            {identity.status === 'error' && (
              <View style={styles.error}>
                <Text accessibilityRole="alert" style={styles.errorText}>名片暫時無法讀取。</Text>
                <Action label="重試名片" onPress={() => setRefreshRevision((n) => n + 1)} />
              </View>
            )}
            <CreatorCardPanel schoolId={schoolId} ownerUid={memberUid} own={own} />
            <CreatorHighlight key={schoolId + ':' + memberUid}
              schoolId={schoolId} memberUid={memberUid} own={own} candidates={postRows}
              openPost={(postId) => navigation?.navigate?.('PostDetail', { postId })} />
            <View style={styles.actions}>
              {own ? (
                <>
                  <Action label="發表貼文" solid onPress={() => navigation?.navigate?.('PostCompose')} />
                  <Action label="發布限動" onPress={() => navigation?.navigate?.('StoryCompose')} />
                </>
              ) : followState === 'error' ? (
                <Action label="重試追蹤" onPress={() => setFollowRevision((n) => n + 1)} />
              ) : (
                <Action
                  label={followState === 'following' ? '追蹤中'
                    : followState === 'pending' ? '更新中…'
                      : followState === 'loading' ? '確認中…' : '追蹤'}
                  solid={followState === 'not-following'}
                  disabled={followState === 'loading' || followState === 'pending'}
                  onPress={() => void onFollow()}
                />
              )}
              <Action label="分享個人頁" onPress={onShare} />
            </View>
            {!!followError && <Text accessibilityRole="alert" style={styles.errorText}>{followError}</Text>}
            <View style={styles.stats}>
              <Text style={styles.statsText}>
                {posts.status === 'ready'
                  ? `已載入 ${postRows.length} 則公開貼文${posts.value.hasMore ? ' · 還有更多' : ''}` : '公開貼文'}
              </Text>
              <Text style={styles.statsText}>{own ? '收藏僅自己可見' : '不顯示私人帳號資料'}</Text>
            </View>
          </View>
          <View style={styles.tabs} accessibilityRole="tablist">
            {([
              { key: 'posts' as const, label: '貼文' },
              { key: 'media' as const, label: '相片與影片' },
              ...(own ? [{ key: 'saved' as const, label: '我的收藏' }] : []),
            ]).map((entry) => (
              <Pressable
                key={entry.key}
                accessibilityRole="tab"
                accessibilityLabel={entry.label}
                accessibilityState={{ selected: tab === entry.key }}
                onPress={() => setTab(entry.key)}
                style={[styles.tab, tab === entry.key && styles.tabActive]}
              >
                <Text style={[styles.tabText, tab === entry.key && styles.tabTextActive]}>{entry.label}</Text>
              </Pressable>
            ))}
          </View>
          {tab === 'posts' && pin.status === 'error' && (
            <View style={styles.pinNotice}>
              <Text accessibilityRole="alert" style={styles.noteText}>置頂內容暫時無法讀取。</Text>
              <Action label="重新讀取置頂" onPress={() => setPinRevision((n) => n + 1)} />
            </View>
          )}
          {tab === 'posts' && pinnedPost && (
            <View style={styles.pinnedBlock}>
              <View style={styles.pinnedHeading}>
                <Text style={styles.pinnedTitle}>置頂貼文</Text>
                {own && <Action label="取消置頂" disabled={pinBusy}
                  onPress={() => void changePin('')} />}
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`閱讀置頂貼文：${pinnedPost.title || '貼文'}`}
                onPress={() => navigation?.navigate?.('PostDetail', { postId: pinnedPost.id })}
                style={styles.pinnedContent}
              >
                <Text style={styles.postTitle} numberOfLines={2}>{pinnedPost.title || '未命名貼文'}</Text>
                <Text style={styles.postExcerpt} numberOfLines={3}>{pinnedPost.content}</Text>
              </Pressable>
            </View>
          )}
          {tab === 'posts' && !!pinFeedback &&
            <Text accessibilityRole="alert" style={styles.pinFeedback}>{pinFeedback}</Text>}
          {tab === 'saved' && <Text style={styles.savedNote}>私人收藏 · 最多顯示最近 40 筆</Text>}
        </>
      }
      renderItem={({ item: tile }) => {
        const item = tile.post;
        const first = tile.mediaUrl ?? mediaUrls(item)[0];
        if (tab === 'media') return (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`查看媒體貼文：${item.title || '貼文'}${mediaUrls(item).length > 1 ? `（第 ${(tile.mediaIndex ?? 0) + 1} 張）` : ''}`}
            onPress={() => navigation?.navigate?.('PostDetail', { postId: item.id })}
            style={styles.mediaTile}
          >
            {first && !isVideo(first)
              ? <Image source={{ uri: first }} style={styles.mediaImage} />
              : <Text style={styles.videoLabel}>影片</Text>}
          </Pressable>
        );
        return (
          <View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`閱讀貼文：${item.title || '貼文'}`}
            onPress={() => navigation?.navigate?.('PostDetail', { postId: item.id })}
            style={styles.postCard}
          >
            <View style={styles.postBody}>
              <Text style={styles.postDate}>{dateOf(item.createdAt) || '發布時間未提供'}</Text>
              <Text style={styles.postTitle} numberOfLines={2}>{item.title || '未命名貼文'}</Text>
              <Text style={styles.postExcerpt} numberOfLines={3}>{item.content}</Text>
              <Text style={styles.postStats}>
                喜歡 {Math.max(0, typeof item.likes === 'number' ? item.likes : 0)} · 回覆 {Math.max(0, typeof item.commentCount === 'number' ? item.commentCount : 0)}
              </Text>
            </View>
            {!!first && (
              <View style={styles.postThumb}>
                {isVideo(first) ? <Ionicons name="play" size={20} color={theme.colors.textSecondary} />
                  : <Image source={{ uri: first }} style={styles.mediaImage} />}
              </View>
            )}
          </Pressable>
          {own && tab === 'posts' && (
            <View style={styles.postPinAction}>
              <Action label="置頂到個人頁"
                disabled={pinBusy || pin.status !== 'ready'}
                onPress={() => void changePin(item.id)} />
            </View>
          )}
          </View>
        );
      }}
      ListEmptyComponent={
        tab === 'posts' && pinnedPost && !reading && !failed ? null : reading
          ? <View style={styles.status}><ActivityIndicator color={theme.colors.accent} /><Text style={styles.emptyText}>正在讀取內容…</Text></View>
          : failed ? (
            <View style={styles.status}>
              <Text accessibilityRole="alert" style={styles.emptyText}>內容暫時無法讀取，請確認連線與校園資格。</Text>
              <Action label="重新讀取" onPress={retry} />
            </View>
          ) : (
            <View style={styles.status}>
              <Text style={styles.emptyText}>
                {tab === 'media' ? '目前載入的貼文沒有相片或影片。'
                  : tab === 'saved' ? '你還沒有收藏貼文。'
                    : own ? '你還沒有用公開身分發表貼文。' : '這位成員還沒有公開貼文。'}
              </Text>
              {own && tab === 'posts' && (
                <Action label="發表第一篇貼文" solid onPress={() => navigation?.navigate?.('PostCompose')} />
              )}
            </View>
          )
      }
      ListFooterComponent={
        tab !== 'saved' && posts.status === 'ready' && posts.value.hasMore
          ? <View style={styles.more}>
              {!!moreError && <Text accessibilityRole="alert" style={styles.errorText}>{moreError}</Text>}
              <Action label={moreBusy ? '正在載入…' : '載入更多貼文'} disabled={moreBusy} onPress={() => void onMore()} />
            </View> : null
      }
    />
  );
}

export function CreatorProfileScreen({ route, navigation }: Props) {
  const styles = useThemeStyleSheet(createStyles);
  const auth = useAuth();
  const { school, selectionReady } = useSchool();
  const viewerUid = auth.user?.uid;
  const schoolId = selectionReady ? school?.id : '';
  const memberUid = route?.params?.memberUid || viewerUid;
  const requestedSchoolId = route?.params?.schoolId;
  if (auth.loading || !selectionReady) {
    return <View style={styles.status}><ActivityIndicator /><Text>正在確認登入與校園…</Text></View>;
  }
  if (!viewerUid || !schoolId || !memberUid) {
    return <View style={styles.status}><Text style={styles.emptyText}>請先登入並選擇校園，才能查看個人頁。</Text></View>;
  }
  if (requestedSchoolId && requestedSchoolId !== schoolId) {
    return <View style={styles.status}><Text accessibilityRole="alert" style={styles.emptyText}>這個個人頁屬於另一所校園，請先切換至該校。</Text></View>;
  }
  if (isFirebaseMockMode()) {
    return <View style={styles.status}><Text style={styles.emptyText}>目前示範模式無法讀取真實校園個人頁。</Text></View>;
  }
  return (
    <ScopedCreatorProfile
      key={JSON.stringify([viewerUid, schoolId, memberUid])}
      navigation={navigation}
      viewerUid={viewerUid}
      schoolId={schoolId}
      schoolName={school.name}
      memberUid={memberUid}
      ownName={auth.profile?.uid === viewerUid
        ? auth.profile.displayName || auth.user?.displayName || '我的頁面'
        : auth.user?.displayName || '我的頁面'}
    />
  );
}

const createStyles = () => StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.colors.bg },
  listContent: { paddingHorizontal: 16, paddingTop: 14, paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING + 36, flexGrow: 1 },
  header: {
    borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, borderColor: theme.colors.border,
    padding: 18, backgroundColor: theme.colors.surface, marginBottom: 14,
  },
  identity: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  avatar: {
    width: 72, height: 72, borderRadius: 36, backgroundColor: theme.colors.surface2,
    alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
  },
  avatarImage: { width: '100%', height: '100%', resizeMode: 'cover' },
  avatarText: { fontSize: 25, fontWeight: '700', color: theme.colors.text },
  identityText: { flex: 1 },
  school: { color: theme.colors.textSecondary, fontSize: 12, marginBottom: 4 },
  displayName: { color: theme.colors.text, fontWeight: '700', fontSize: 23, lineHeight: 30 },
  scope: { color: theme.colors.textSecondary, fontSize: 12, marginTop: 5, lineHeight: 17 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 22 },
  action: {
    minHeight: 44, minWidth: 96, paddingHorizontal: 15, paddingVertical: 11,
    justifyContent: 'center', alignItems: 'center', borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth, borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
  },
  actionSolid: { backgroundColor: theme.colors.accent, borderColor: theme.colors.accent },
  actionText: { color: theme.colors.text, fontSize: 14, fontWeight: '600' },
  actionTextSolid: { color: theme.colors.onAccent },
  stats: {
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.colors.border,
    paddingTop: 14, marginTop: 20, flexDirection: 'row', flexWrap: 'wrap', gap: 16,
  },
  statsText: { color: theme.colors.textSecondary, fontSize: 12 },
  tabs: {
    flexDirection: 'row', borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.colors.border, marginBottom: 8,
  },
  tab: {
    minHeight: 48, flex: 1, alignItems: 'center', justifyContent: 'center',
    borderBottomWidth: 2, borderBottomColor: 'transparent',
  },
  tabActive: { borderBottomColor: theme.colors.text },
  tabText: { color: theme.colors.textSecondary, fontSize: 13, fontWeight: '600' },
  tabTextActive: { color: theme.colors.text },
  savedNote: { color: theme.colors.textSecondary, fontSize: 12, marginTop: 8, marginBottom: 5 },
  status: { padding: 28, gap: 14, alignItems: 'center', justifyContent: 'center' },
  emptyText: { textAlign: 'center', color: theme.colors.textSecondary, fontSize: 14, lineHeight: 22 },
  error: { marginTop: 14, gap: 8 },
  errorText: { color: theme.colors.danger, fontSize: 13, lineHeight: 19 },
  postCard: {
    minHeight: 108, paddingVertical: 16, flexDirection: 'row', gap: 14,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.colors.border,
  },
  postBody: { flex: 1 },
  postDate: { color: theme.colors.textSecondary, fontSize: 11, marginBottom: 7 },
  postTitle: { color: theme.colors.text, fontSize: 16, fontWeight: '700', lineHeight: 24 },
  postExcerpt: { color: theme.colors.textSecondary, fontSize: 14, lineHeight: 21, marginTop: 5 },
  postStats: { color: theme.colors.textSecondary, fontSize: 11, marginTop: 11 },
  postThumb: {
    height: 90, width: 90, borderRadius: 10, overflow: 'hidden',
    justifyContent: 'center', alignItems: 'center', backgroundColor: theme.colors.surface2,
  },
  mediaTile: {
    flex: 1, maxWidth: '32%', aspectRatio: 1, margin: 2, backgroundColor: theme.colors.surface2,
    justifyContent: 'center', alignItems: 'center', overflow: 'hidden',
  },
  mediaImage: { width: '100%', height: '100%', resizeMode: 'cover' },
  videoLabel: { color: theme.colors.textSecondary, fontSize: 12 },
  pinnedBlock: {
    marginTop: 12, paddingHorizontal: 14, paddingTop: 9,
    borderWidth: StyleSheet.hairlineWidth, borderColor: theme.colors.border,
    borderRadius: 12, backgroundColor: theme.colors.surface,
  },
  pinnedHeading: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    minHeight: 42, gap: 12,
  },
  pinnedTitle: { color: theme.colors.text, fontSize: 13, fontWeight: '700' },
  pinnedContent: {
    minHeight: 68, paddingVertical: 12, justifyContent: 'center',
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.colors.border,
  },
  pinNotice: { padding: 12, gap: 9, alignItems: 'flex-start' },
  noteText: { color: theme.colors.textSecondary, fontSize: 13 },
  pinFeedback: { color: theme.colors.textSecondary, fontSize: 12, paddingVertical: 10 },
  postPinAction: { alignItems: 'flex-end', paddingBottom: 10 },
  more: { paddingVertical: 22, alignItems: 'center', gap: 8 },
});
