/* eslint-disable */
import React, { useCallback, useState } from 'react';
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
import { theme } from '../../ui/theme';
import { useThemeStyleSheet } from '../../ui/useThemeStyleSheet';
import { TAB_BAR_CONTENT_BOTTOM_PADDING } from '../../ui/navigationTheme';
import { useSchool } from '../../state/school';
import { useAuth } from '../../state/auth';
import { shouldBlockForNoLogin, isDemoUid } from '../../services/demoSession';
import { isFirebaseMockMode } from '../../firebase';
import { fetchRecentCampusPosts, rankFeedPosts, type CampusPostDoc } from '../../services/feed';
import {
  getBoardById,
  subscribeToBoard,
  unsubscribeFromBoard,
  isSubscribedToBoard,
  type CampusBoard,
} from '../../services/boards';
import { useCampusSocialStackNav } from './CampusSocialNavContext';

function engagementLine(p: CampusPostDoc) {
  const likes =
    typeof p.likes === 'number' ? p.likes : Array.isArray(p.likedBy) ? p.likedBy.length : 0;
  const cc = typeof p.commentCount === 'number' ? p.commentCount : 0;
  return { likes, cc };
}

export function BoardDetailScreen(props: any) {
  const auth = useAuth();
  const { school } = useSchool();

  // A change of account, school or board must discard the previous board's state.
  if (auth.loading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 }}>
        <ActivityIndicator color={theme.colors.accent} />
        <Text style={{ color: theme.colors.textSecondary }}>正在確認登入狀態…</Text>
      </View>
    );
  }

  return (
    <BoardDetailContent
      key={JSON.stringify([auth.user?.uid ?? null, school?.id ?? null, props?.route?.params?.boardId ?? null])}
      {...props}
    />
  );
}

function BoardDetailContent(props: any) {
  const styles = useThemeStyleSheet(createStyles);
  const injected = useCampusSocialStackNav();
  const fb = useNavigation<any>();
  const nav = injected ?? fb;
  const auth = useAuth();
  const { school } = useSchool();
  const boardId = props?.route?.params?.boardId as string | undefined;
  const boardName = (props?.route?.params?.boardName as string) ?? '看板';
  const [posts, setPosts] = useState<CampusPostDoc[]>([]);
  const [meta, setMeta] = useState<CampusBoard | null>(null);
  const [subscribed, setSubscribed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [subBusy, setSubBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState('');
  const loadVersion = React.useRef(0);

  const load = useCallback(async () => {
    const version = ++loadVersion.current;
    setLoadError('');
    try {
      if (isFirebaseMockMode() || !school?.id || !boardId || !auth.user?.uid) {
        setPosts([]);
        setMeta(null);
        setSubscribed(false);
        return;
      }

      // Only publish a complete result for the current school/board.
      const [rows, board, subscription] = await Promise.all([
        fetchRecentCampusPosts(school.id, boardId, 45),
        getBoardById(school.id, boardId),
        isSubscribedToBoard(auth.user.uid, school.id, boardId),
      ]);
      if (loadVersion.current !== version) return;
      setPosts(rankFeedPosts(rows, 50));
      setMeta(board);
      setSubscribed(subscription);
    } catch (cause) {
      if (loadVersion.current !== version) return;
      const code = (cause as { code?: string })?.code ?? '';
      // Temporary network errors must not silently turn a populated board into an empty board.
      // A revoked session/school membership must not keep displaying previously read content.
      if (code.endsWith('permission-denied') || code.endsWith('unauthenticated')) {
        setPosts([]);
        setMeta(null);
        setSubscribed(false);
      }
      setLoadError('暫時無法更新看板。請確認網路與登入狀態，再試一次。');
    } finally {
      if (loadVersion.current === version) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [school?.id, boardId, auth.user?.uid]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    void load();
  }, [load]);

  React.useEffect(() => {
    setLoading(true);
    void load();
    return () => {
      loadVersion.current += 1;
    };
  }, [load]);

  React.useEffect(() => {
    props?.navigation?.setOptions?.({ title: meta?.name ?? boardName });
  }, [props?.navigation, meta?.name, boardName]);

  const toggleSub = async () => {
    if (!auth.user?.uid || !school?.id || !boardId) return;
    setSubBusy(true);
    try {
      if (subscribed) await unsubscribeFromBoard(auth.user.uid, school.id, boardId);
      else await subscribeToBoard(auth.user.uid, school.id, boardId);
      setSubscribed(!subscribed);
    } catch (e: any) {
      Alert.alert('訂閱失敗', e?.message ?? String(e));
    } finally {
      setSubBusy(false);
    }
  };

  const defaultAnon =
    props?.route?.params?.defaultAnonymous === true || props?.route?.params?.defaultAnonymous === false
      ? (props.route.params.defaultAnonymous as boolean)
      : !!meta?.defaultAnonymous;

  if (!boardId) {
    return (
      <View style={styles.center}>
        <Text style={{ color: theme.colors.textSecondary }}>無看板 ID</Text>
      </View>
    );
  }

  if (shouldBlockForNoLogin({ uid: auth.user?.uid ?? null, hasUser: !!auth.user })) {
    return (
      <View style={styles.center}>
        <Text style={{ color: theme.colors.textSecondary }}>請先登入以瀏覽看板</Text>
      </View>
    );
  }

  return (
    <View style={[styles.root, { paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING }]}>
      <View style={styles.boardMeta}>
        <View style={styles.composeRow}>
          <Pressable
            style={[styles.subBtn, subscribed && styles.subBtnOn, subBusy && { opacity: 0.65 }]}
            disabled={subBusy}
            onPress={toggleSub}
          >
            <Ionicons
              name={subscribed ? 'notifications' : 'notifications-outline'}
              size={16}
              color={subscribed ? theme.colors.onAccent : theme.colors.accent}
            />
            <Text style={[styles.subTxt, subscribed && { color: theme.colors.onAccent }]}>
              {subscribed ? '已訂閱看板' : '訂閱看板'}
            </Text>
          </Pressable>
          <Pressable
            style={styles.composeBtn}
            onPress={() =>
              nav?.navigate?.('PostCompose' as never, { boardId, defaultAnonymous: defaultAnon })
            }
          >
            <Ionicons name="add-circle" size={20} color={theme.colors.onAccent} />
            <Text style={styles.composeText}>發文</Text>
          </Pressable>
        </View>
        {(meta?.rules || meta?.type) ? (
          <Text style={styles.ruleBlock} numberOfLines={6}>
            {meta?.rules ?? `類型 · ${meta?.type ?? '—'}`}
          </Text>
        ) : (
          <Text style={styles.hint}>編號 · {boardId.slice(0, 10)}{boardId.length > 10 ? '…' : ''}</Text>
        )}
      </View>

      {!!loadError && (
        <View style={{ padding: 16, gap: 8 }}>
          <Text accessibilityRole="alert" style={{ color: theme.colors.textSecondary }}>
            {loadError}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="重新讀取看板"
            onPress={() => {
              if (posts.length === 0) setLoading(true);
              void load();
            }}
            style={{ paddingVertical: 10 }}
          >
            <Text style={{ color: theme.colors.accent, fontWeight: '600' }}>重新讀取看板</Text>
          </Pressable>
        </View>
      )}
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator />
        </View>
      ) : (
        <FlatList
          style={{ flex: 1 }}
          data={posts}
          keyExtractor={(p) => p.id}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          ListEmptyComponent={
            loadError ? null : <Text style={{ color: theme.colors.textSecondary, padding: 20, textAlign: 'center' }}>
              此看板尚未有貼文，成為第一篇吧。
            </Text>
          }
  ItemSeparatorComponent={() => (
    <View style={{ height: theme.layout.listSeparatorGap, backgroundColor: 'transparent' }} />
  )}
          renderItem={({ item }) => {
            const { likes, cc } = engagementLine(item);
            return (
            <Pressable
              style={styles.card}
              onPress={() => nav?.navigate?.('PostDetail' as never, { postId: item.id })}
            >
              <Text style={styles.badge}>{item.anonymous ? item.aliasSnapshot ?? '匿名' : '實名'}</Text>
              <Text style={styles.title}>{item.title}</Text>
              <Text numberOfLines={4} style={styles.preview}>
                {item.content}
              </Text>
              <View style={styles.cardFoot}>
                <View style={styles.miniStatInner}>
                  <Ionicons name="heart-outline" size={14} color={theme.colors.textSecondary} />
                  <Text style={styles.miniStatTxt}>{likes}</Text>
                </View>
                <View style={styles.miniStatInner}>
                  <Ionicons name="chatbubble-outline" size={14} color={theme.colors.textSecondary} />
                  <Text style={styles.miniStatTxt}>{cc}</Text>
                </View>
              </View>
            </Pressable>
            );
          }}
        />
      )}
    </View>
  );
}

const createStyles = () => StyleSheet.create({
  boardMeta: { marginBottom: theme.space.sm },
  root: { flex: 1, backgroundColor: theme.colors.bg, paddingHorizontal: theme.layout.screenPadding },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  composeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginVertical: theme.space.md,
    gap: theme.space.sm,
  },
  hint: { fontSize: 12, color: theme.colors.textSecondary, marginBottom: theme.space.sm },
  subBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.accent,
  },
  subBtnOn: { backgroundColor: theme.colors.accent, borderColor: theme.colors.accent },
  subTxt: { color: theme.colors.accent, fontWeight: '700', fontSize: 13 },
  composeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: theme.colors.accent,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: theme.radius.md,
  },
  composeText: { color: theme.colors.onAccent, fontWeight: '700', fontSize: 14 },
  ruleBlock: {
    fontSize: 13,
    lineHeight: 19,
    color: theme.colors.textSecondary,
    marginBottom: 8,
  },
  card: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.md,
    padding: theme.layout.cardPadding,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
  },
  badge: {
    fontSize: 11,
    color: theme.colors.accent,
    fontWeight: '700',
    marginBottom: theme.space.sm,
  },
  title: { fontSize: 16, fontWeight: '700', color: theme.colors.text },
  preview: {
    marginTop: theme.space.sm,
    fontSize: 14,
    color: theme.colors.textSecondary,
    lineHeight: 20,
  },
  cardFoot: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.space.md,
    marginTop: theme.space.md,
    paddingTop: theme.space.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.colors.border,
  },
  miniStatInner: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  miniStatTxt: { fontSize: 12, fontWeight: '700', color: theme.colors.textSecondary },
});

export default BoardDetailScreen;
