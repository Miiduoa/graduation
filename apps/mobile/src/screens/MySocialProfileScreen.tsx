import React, { useEffect, useRef, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { AIDetailScreen } from '../ui/aiFirst';
import { useThemeStyleSheet } from '../ui/useThemeStyleSheet';
import { theme } from '../ui/theme';
import { useAuth } from '../state/auth';
import { useSchool } from '../state/school';
import { rootNavigateNested } from '../app/rootNavigation';
import { loadOwnCampusPosts, type OwnPostCursor } from '../services/myPosts';
import type { CampusPostDoc } from '../services/feed';

type Timeline = {
  status: 'loading' | 'ready' | 'error';
  posts: CampusPostDoc[];
  cursor: OwnPostCursor | null;
  hasMore: boolean;
};
const initial: Timeline = { status: 'loading', posts: [], cursor: null, hasMore: false };

function postDate(value: unknown) {
  const timestamp = value as { toDate?: () => Date } | null;
  const date = timestamp && typeof timestamp.toDate === 'function'
    ? timestamp.toDate()
    : value instanceof Date ? value : null;
  return date && Number.isFinite(date.getTime()) ? date.toLocaleDateString('zh-TW') : '日期未提供';
}

function OwnPosts({ uid, schoolId, schoolName, displayName, bio }: {
  uid: string;
  schoolId: string;
  schoolName: string;
  displayName: string;
  bio?: string | null;
}) {
  const styles = useThemeStyleSheet(createStyles);
  const [timeline, setTimeline] = useState<Timeline>(initial);
  const [filter, setFilter] = useState<'all' | 'media'>('all');
  const [revision, setRevision] = useState(0);
  const [moreBusy, setMoreBusy] = useState(false);
  const [moreError, setMoreError] = useState(false);
  const mounted = useRef(false);
  const moreLock = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    let live = true;
    setTimeline(initial);
    setMoreError(false);
    void loadOwnCampusPosts(schoolId, uid).then(
      (page) => {
        if (live) setTimeline({ status: 'ready', posts: page.items, cursor: page.cursor, hasMore: page.hasMore });
      },
      () => {
        if (live) setTimeline({ ...initial, status: 'error' });
      },
    );
    return () => { live = false; };
  }, [schoolId, uid, revision]);

  async function loadMore() {
    if (moreLock.current || !timeline.hasMore || !timeline.cursor || timeline.status !== 'ready') return;
    moreLock.current = true;
    const cursor = timeline.cursor;
    setMoreBusy(true);
    setMoreError(false);
    try {
      const result = await loadOwnCampusPosts(schoolId, uid, cursor);
      if (mounted.current) setTimeline((previous) => {
        if (previous.status !== 'ready' || previous.cursor !== cursor) return previous;
        const existing = new Set(previous.posts.map((post) => post.id));
        return {
          status: 'ready',
          posts: [...previous.posts, ...result.items.filter((post) => !existing.has(post.id))],
          cursor: result.cursor,
          hasMore: result.hasMore,
        };
      });
    } catch {
      if (mounted.current) setMoreError(true);
    } finally {
      moreLock.current = false;
      if (mounted.current) setMoreBusy(false);
    }
  }

  const posts = filter === 'media'
    ? timeline.posts.filter((post) => Array.isArray(post.mediaUrls) && post.mediaUrls.length > 0)
    : timeline.posts;
  return (
    <View style={styles.container}>
      <View style={styles.identity}>
        <View style={styles.avatar}>
          <Text style={styles.initial}>{Array.from(displayName)[0] || '我'}</Text>
        </View>
        <View style={styles.identityCopy}>
          <Text style={styles.name}>{displayName}</Text>
          <Text style={styles.school}>{schoolName} · 署名貼文</Text>
          {bio?.trim() ? <Text style={styles.bio}>{bio.trim()}</Text> : null}
        </View>
      </View>
      <View style={styles.actions}>
        <Pressable accessibilityRole="button" style={styles.primary}
          onPress={() => { rootNavigateNested('Today', 'PostCompose', { profileCompose: true }); }}>
          <Text style={styles.primaryText}>發表貼文</Text>
        </Pressable>
        <Pressable accessibilityRole="button" style={styles.secondary}
          onPress={() => { rootNavigateNested('Today', 'CampusSocialScreen'); }}>
          <Text style={styles.secondaryText}>探索動態</Text>
        </Pressable>
      </View>
      <View style={styles.heading}>
        <Text style={styles.headingTitle}>我的作品</Text>
        {timeline.status === 'ready' ? <Text style={styles.count}>已載入 {timeline.posts.length} 則</Text> : null}
      </View>
      <View style={styles.tabs}>
        {([
          { key: 'all', label: '全部貼文' },
          { key: 'media', label: '圖文作品' },
        ] as const).map((option) => (
          <Pressable key={option.key} accessibilityRole="tab"
            accessibilityState={{ selected: filter === option.key }}
            style={[styles.tab, filter === option.key && styles.activeTab]}
            onPress={() => setFilter(option.key)}>
            <Text style={[styles.tabLabel, filter === option.key && styles.activeLabel]}>{option.label}</Text>
          </Pressable>
        ))}
      </View>
      {timeline.status === 'loading' ? <Text accessibilityRole="text" style={styles.notice}>正在整理你的貼文…</Text> : null}
      {timeline.status === 'error' ? (
        <View style={styles.empty}>
          <Text style={styles.notice}>暫時無法讀取這個校園的貼文。</Text>
          <Pressable accessibilityRole="button" style={styles.secondary} onPress={() => setRevision((n) => n + 1)}>
            <Text style={styles.secondaryText}>重新讀取</Text>
          </Pressable>
        </View>
      ) : null}
      {timeline.status === 'ready' && posts.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>{filter === 'media' ? '目前載入的貼文還沒有照片' : '還沒有署名貼文'}</Text>
          <Text style={styles.notice}>匿名貼文不會出現在個人作品中。從第一則分享開始吧。</Text>
        </View>
      ) : null}
      {timeline.status === 'ready' && posts.map((post) => {
        const cover = post.mediaUrls?.find((url) => typeof url === 'string' && url.startsWith('https://'));
        const likes = typeof post.likes === 'number' && post.likes >= 0 ? post.likes : 0;
        const replies = typeof post.commentCount === 'number' && post.commentCount >= 0 ? post.commentCount : 0;
        return (
          <Pressable key={post.id} accessibilityRole="button"
            accessibilityLabel={'查看貼文：' + (post.title || '未命名貼文')}
            style={({ pressed }) => [styles.post, pressed && styles.pressed]}
            onPress={() => { rootNavigateNested('Today', 'PostDetail', { postId: post.id }); }}>
            {cover ? <Image source={{ uri: cover }} style={styles.cover} resizeMode="cover" accessibilityLabel="貼文附圖" /> : null}
            <Text style={styles.date}>{postDate(post.createdAt)}</Text>
            <Text style={styles.postTitle} numberOfLines={2}>{post.title || '未命名貼文'}</Text>
            <Text style={styles.postBody} numberOfLines={3}>{post.content || '照片分享'}</Text>
            <Text style={styles.stats}>{likes} 讚  ·  {replies} 回覆</Text>
          </Pressable>
        );
      })}
      {moreError ? <Text accessibilityRole="alert" style={styles.notice}>較早貼文暫時無法載入，已讀內容仍保留。</Text> : null}
      {timeline.status === 'ready' && timeline.hasMore ? (
        <Pressable accessibilityRole="button" accessibilityState={{ disabled: moreBusy }}
          style={styles.more} disabled={moreBusy} onPress={() => void loadMore()}>
          <Text style={styles.secondaryText}>{moreBusy ? '載入中…' : '載入較早的貼文'}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export default function MySocialProfileScreen() {
  const navigation = useNavigation();
  const styles = useThemeStyleSheet(createStyles);
  const auth = useAuth();
  const { selectionReady, school, schoolId } = useSchool();
  const uid = auth.user?.uid;
  const profile = auth.profile?.uid === uid ? auth.profile : null;
  const name = profile?.displayName?.trim() || auth.user?.displayName?.trim() || '我的帳號';
  return (
    <AIDetailScreen title="我的社群" onBack={() => navigation.goBack()}>
      {!uid ? (
        <Text style={styles.pageNotice}>連線校園帳號後，就能整理自己在校內發表的內容。</Text>
      ) : !selectionReady || !schoolId ? (
        <Text style={styles.pageNotice}>選擇校園後，就能查看在該校發表的內容。</Text>
      ) : (
        <OwnPosts key={uid + ':' + schoolId} uid={uid} schoolId={schoolId}
          schoolName={school.name} displayName={name} bio={profile?.bio} />
      )}
    </AIDetailScreen>
  );
}

const createStyles = () => StyleSheet.create({
  container: { paddingHorizontal: 20, paddingTop: 20, paddingBottom: 24 },
  identity: { flexDirection: 'row', gap: 16, alignItems: 'center', paddingBottom: 22, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.colors.border },
  avatar: { width: 64, height: 64, borderRadius: 32, backgroundColor: theme.colors.accentSoft, alignItems: 'center', justifyContent: 'center' },
  initial: { fontSize: 28, fontWeight: '700', color: theme.colors.accent },
  identityCopy: { flex: 1 },
  name: { fontSize: 23, fontWeight: '700', color: theme.colors.text },
  school: { fontSize: 13, color: theme.colors.textSecondary, marginTop: 5 },
  bio: { fontSize: 14, color: theme.colors.text, marginTop: 9, lineHeight: 21 },
  actions: { flexDirection: 'row', gap: 10, marginTop: 18 },
  primary: { minHeight: 46, flex: 1, backgroundColor: theme.colors.accent, borderRadius: 10, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
  primaryText: { color: theme.colors.onAccent, fontWeight: '700', fontSize: 14 },
  secondary: { minHeight: 46, flex: 1, backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border, borderRadius: 10, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
  secondaryText: { color: theme.colors.text, fontSize: 14, fontWeight: '600' },
  heading: { marginTop: 28, flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 },
  headingTitle: { fontSize: 19, fontWeight: '700', color: theme.colors.text },
  count: { fontSize: 12, color: theme.colors.textSecondary },
  tabs: { marginTop: 16, flexDirection: 'row', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.colors.border, gap: 24 },
  tab: { minHeight: 48, paddingVertical: 12, justifyContent: 'center', borderBottomWidth: 2, borderBottomColor: 'transparent' },
  activeTab: { borderBottomColor: theme.colors.accent },
  tabLabel: { color: theme.colors.textSecondary, fontSize: 14 },
  activeLabel: { color: theme.colors.text, fontWeight: '700' },
  notice: { fontSize: 14, lineHeight: 22, color: theme.colors.textSecondary },
  pageNotice: { margin: 24, fontSize: 14, lineHeight: 22, color: theme.colors.textSecondary },
  empty: { paddingVertical: 30, gap: 12, alignItems: 'flex-start' },
  emptyTitle: { color: theme.colors.text, fontSize: 16, fontWeight: '700' },
  post: { paddingVertical: 18, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.colors.border, gap: 8 },
  pressed: { opacity: 0.68 },
  cover: { width: '100%', height: 176, borderRadius: 12, marginBottom: 4, backgroundColor: theme.colors.surface2 },
  date: { fontSize: 12, color: theme.colors.textSecondary },
  postTitle: { fontSize: 17, fontWeight: '700', color: theme.colors.text, lineHeight: 24 },
  postBody: { fontSize: 14, color: theme.colors.textSecondary, lineHeight: 21 },
  stats: { fontSize: 12, marginTop: 3, color: theme.colors.textSecondary },
  more: { minHeight: 48, marginTop: 22, borderWidth: 1, borderColor: theme.colors.border, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
});
