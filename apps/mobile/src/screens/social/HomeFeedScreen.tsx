/* eslint-disable */
import React, { useCallback, useRef, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  Pressable,
  RefreshControl,
  ActivityIndicator,
  StyleSheet,
  Alert,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { theme } from '../../ui/theme';
import { TAB_BAR_CONTENT_BOTTOM_PADDING } from '../../ui/navigationTheme';
import { useAuth } from '../../state/auth';
import { useSchool } from '../../state/school';
import { getDb, isFirebaseMockMode } from '../../firebase';
import { fetchRecentCampusPosts, rankFeedPosts, toggleCampusPostLike, type CampusPostDoc } from '../../services/feed';
import { fetchSchoolDirectoryProfiles } from '../../services/memberDirectory';
import { toDate } from '../../utils/format';
import { useCampusSocialStackNav } from './CampusSocialNavContext';

function formatTs(t: unknown): string {
  const d = toDate(t as any);
  if (!d) return '';
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

export function HomeFeedScreen() {
  const injectedNav = useCampusSocialStackNav();
  const fallbackNav = useNavigation<any>();
  const nav = injectedNav ?? fallbackNav;
  const auth = useAuth();
  const { school } = useSchool();
  const insets = useSafeAreaInsets();
  const [posts, setPosts] = useState<CampusPostDoc[]>([]);
  const [nameByUid, setNameByUid] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const likeFlightRef = useRef(false);

  const load = useCallback(async () => {
    if (isFirebaseMockMode() || !school?.id) {
      setPosts([]);
      return;
    }
    const rows = await fetchRecentCampusPosts(school.id, undefined, 50);
    setPosts(rankFeedPosts(rows, 60));
  }, [school?.id]);

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
      try {
        await toggleCampusPostLike(sid, row.id, uid);
        await load();
      } catch (e: any) {
        Alert.alert('按讚失敗', e?.message ?? String(e));
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
      const uids = [
        ...new Set(
          posts.filter((p) => !p.anonymous && p.authorUid).map((p) => p.authorUid as string),
        ),
      ];
      if (!school?.id || uids.length === 0) {
        setNameByUid({});
        return;
      }
      const profiles = await fetchSchoolDirectoryProfiles(school.id, uids, getDb());
      if (cancelled) return;
      const map: Record<string, string> = {};
      profiles.forEach((p) => {
        map[p.uid] = (p.displayName ?? p.uid.slice(0, 8)).trim();
      });
      setNameByUid(map);
    })();
    return () => {
      cancelled = true;
    };
  }, [posts, school?.id]);

  const authorLine = (p: CampusPostDoc) => {
    if (p.anonymous) return p.aliasSnapshot ?? '匿名貼文';
    const uid = p.authorUid;
    if (!uid) return '成員';
    return nameByUid[uid] ?? '載入中…';
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
      <View style={styles.headerRow}>
        <Text style={styles.title}>動態精選</Text>
        <Pressable
          accessibilityRole="button"
          hitSlop={8}
          onPress={() => nav?.navigate?.('PostCompose' as never)}
          style={styles.composeFab}
        >
          <Ionicons name="add" size={24} color="#fff" />
        </Pressable>
      </View>
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator />
        </View>
      ) : (
        <FlatList
          style={{ flex: 1 }}
          data={posts}
          keyExtractor={(p) => p.id}
          removeClippedSubviews
          windowSize={7}
          initialNumToRender={12}
          maxToRenderPerBatch={12}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={
            <Text style={{ color: theme.colors.textSecondary, textAlign: 'center', padding: 24 }}>
              尚無校園貼文。點右上角 + 或到「看板」發第一篇吧。
            </Text>
          }
          renderItem={({ item }) => {
            const uid = auth.user?.uid;
            const liked =
              !!(uid && Array.isArray(item.likedBy) && item.likedBy.includes(uid));
            return (
              <View style={styles.card}>
                <Pressable
                  onPress={() => nav?.navigate?.('PostDetail' as never, { postId: item.id })}
                >
                  <View style={styles.cardTop}>
                    <Text style={styles.author} numberOfLines={1}>
                      {authorLine(item)}
                    </Text>
                    <Text style={styles.meta}>{formatTs(item.createdAt)}</Text>
                  </View>
                  <Text numberOfLines={2} style={styles.cardTitle}>
                    {item.title}
                  </Text>
                  <Text numberOfLines={3} style={styles.preview}>
                    {item.content}
                  </Text>
                  <View style={styles.tags}>
                    {(item.tags ?? []).slice(0, 3).map((t) => (
                      <Text key={`${item.id}_${t}`} style={styles.tag}>
                        #{t}
                      </Text>
                    ))}
                  </View>
                </Pressable>
                <View style={styles.cardFooter}>
                  <Pressable
                    style={styles.statHit}
                    hitSlop={{ top: 8, bottom: 8, left: 4, right: 8 }}
                    onPress={() => void onToggleLike(item)}
                  >
                    <Ionicons
                      name={liked ? 'heart' : 'heart-outline'}
                      size={17}
                      color={liked ? theme.colors.danger : theme.colors.textSecondary}
                    />
                    <Text style={[styles.statLabel, liked && { color: theme.colors.danger }]}>
                      {likesDisplay(item)}
                    </Text>
                  </Pressable>
                  <View style={[styles.statHit, { opacity: 1 }]}>
                    <Ionicons name="chatbubble-outline" size={16} color={theme.colors.textSecondary} />
                    <Text style={styles.statLabel}>{repliesDisplay(item)}</Text>
                  </View>
                </View>
              </View>
            );
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.colors.bg, paddingHorizontal: 14 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 4,
    marginBottom: 10,
  },
  title: { fontSize: 18, fontWeight: '800', color: theme.colors.text },
  composeFab: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: theme.colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  card: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.md,
    padding: 14,
    marginBottom: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
  },
  cardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.colors.border,
    gap: 18,
  },
  statHit: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  statLabel: { fontSize: 13, fontWeight: '700', color: theme.colors.textSecondary },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  author: { fontSize: 12, color: theme.colors.accent, fontWeight: '700', flex: 1, marginRight: 8 },
  meta: { fontSize: 12, color: theme.colors.textSecondary },
  cardTitle: { fontSize: 16, fontWeight: '700', color: theme.colors.text, marginBottom: 4 },
  preview: { fontSize: 14, color: theme.colors.textSecondary, lineHeight: 20 },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  tag: { fontSize: 12, color: theme.colors.textSecondary },
});

export default HomeFeedScreen;
