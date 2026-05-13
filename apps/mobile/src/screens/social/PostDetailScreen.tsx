/* eslint-disable */
import React, { useCallback, useMemo, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  RefreshControl,
  ActivityIndicator,
  StyleSheet,
  Alert,
  Switch,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { doc, getDoc } from 'firebase/firestore';
import { getDb, isFirebaseMockMode } from '../../firebase';
import { useAuth } from '../../state/auth';
import { useSchool } from '../../state/school';
import { theme } from '../../ui/theme';
import { TAB_BAR_CONTENT_BOTTOM_PADDING } from '../../ui/navigationTheme';
import { Ionicons } from '@expo/vector-icons';
import { listCampusReplies, addCampusReply, type CampusReply } from '../../services/threads';
import type { CampusPostDoc } from '../../services/feed';
import { toggleCampusPostLike } from '../../services/feed';
import { getOrCreateBoardAlias } from '../../services/aliasService';
import { fetchSchoolDirectoryProfiles } from '../../services/memberDirectory';
import { submitCampusReport } from '../../services/reportSystem';
import { flattenCampusRepliesThread } from '../../utils/campusReplyThread';

export function PostDetailScreen(props: any) {
  const auth = useAuth();
  const { school } = useSchool();
  const postId = props?.route?.params?.postId as string | undefined;

  const [post, setPost] = useState<CampusPostDoc | null>(null);
  const [replies, setReplies] = useState<CampusReply[]>([]);
  const [nameByUid, setNameByUid] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [replyText, setReplyText] = useState('');
  const [replyAnonymous, setReplyAnonymous] = useState(true);
  const [sendingReply, setSendingReply] = useState(false);
  const [replyParentId, setReplyParentId] = useState<string | null>(null);
  const [likeBusy, setLikeBusy] = useState(false);

  const loadPost = useCallback(async () => {
    if (!postId || !school?.id || !auth.user?.uid || isFirebaseMockMode()) {
      setPost(null);
      return;
    }
    const snap = await getDoc(doc(getDb(), 'schools', school.id, 'campusPosts', postId));
    if (!snap.exists()) {
      setPost(null);
      return;
    }
    setPost({ id: snap.id, ...(snap.data() as Omit<CampusPostDoc, 'id'>) });
  }, [postId, school?.id, auth.user?.uid]);

  const loadReplies = useCallback(async () => {
    if (!postId || !school?.id || !auth.user?.uid || isFirebaseMockMode()) {
      setReplies([]);
      return;
    }
    const rows = await listCampusReplies(school.id, postId);
    setReplies(rows);
  }, [postId, school?.id, auth.user?.uid]);

  const hydrateNames = useCallback(async () => {
    if (!school?.id || isFirebaseMockMode()) return;
    const uids = new Set<string>();
    if (post && !post.anonymous && post.authorUid) uids.add(post.authorUid);
    replies.forEach((r) => {
      if (!r.anonymous && r.authorUid) uids.add(r.authorUid as string);
    });
    const list = [...uids];
    if (list.length === 0) {
      setNameByUid({});
      return;
    }
    const prof = await fetchSchoolDirectoryProfiles(school.id, list, getDb());
    const map: Record<string, string> = {};
    prof.forEach((p) => {
      map[p.uid] = (p.displayName ?? p.uid.slice(0, 8)).trim();
    });
    setNameByUid(map);
  }, [school?.id, post, replies]);

  const reload = useCallback(async () => {
    await Promise.all([loadPost(), loadReplies()]);
  }, [loadPost, loadReplies]);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      await reload();
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [reload]);

  React.useEffect(() => {
    void hydrateNames();
  }, [hydrateNames]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await reload();
    setRefreshing(false);
  }, [reload]);

  const threadedReplies = useMemo(() => flattenCampusRepliesThread(replies), [replies]);

  const submitReply = async () => {
    const uid = auth.user?.uid;
    const sid = school?.id;
    if (!uid || !sid || !postId) return;
    if (!replyText.trim()) return;
    const boardIdForAlias = post?.boardId ?? 'general';

    let aliasSnap: string | undefined;
    if (replyAnonymous) {
      try {
        aliasSnap = await getOrCreateBoardAlias(uid, sid, boardIdForAlias);
      } catch {
        aliasSnap = '匿名';
      }
    }

    setSendingReply(true);
    try {
      let depth = 0;
      if (replyParentId) {
        const parentRow = replies.find((r) => r.id === replyParentId);
        depth = (typeof parentRow?.depth === 'number' ? parentRow.depth : 0) + 1;
      }
      await addCampusReply(sid, postId, {
        anonymous: replyAnonymous,
        ...(replyAnonymous ? { aliasSnapshot: aliasSnap } : { authorUid: uid }),
        content: replyText.trim(),
        parentReplyId: replyParentId,
        depth,
      });
      setReplyText('');
      setReplyParentId(null);
      await Promise.all([loadReplies(), loadPost()]);
    } catch (e: any) {
      Alert.alert('送出失敗', e?.message ?? String(e));
    } finally {
      setSendingReply(false);
    }
  };

  const toggleLikePost = useCallback(async () => {
    const viewer = auth.user?.uid;
    const sid = school?.id;
    if (!viewer || !sid || !postId || !post || isFirebaseMockMode()) {
      if (isFirebaseMockMode()) Alert.alert('模擬模式', '無法寫入');
      else if (!viewer) Alert.alert('請登入後再按讚');
      return;
    }
    setLikeBusy(true);
    try {
      await toggleCampusPostLike(sid, postId, viewer);
      await loadPost();
    } catch (e: any) {
      Alert.alert('按讚失敗', e?.message ?? String(e));
    } finally {
      setLikeBusy(false);
    }
  }, [auth.user?.uid, school?.id, postId, post, loadPost]);

  React.useEffect(() => {
    if (post?.title) props?.navigation?.setOptions?.({ title: post.title.slice(0, 18) });
  }, [post?.title, props?.navigation]);

  const reporterLine = async (reasonLabel: string) => {
    const uid = auth.user?.uid;
    const sid = school?.id;
    if (!uid || !sid || !postId) return;
    try {
      await submitCampusReport({
        schoolId: sid,
        reporterUid: uid,
        targetType: 'post',
        targetId: postId,
        reason: reasonLabel,
      });
      Alert.alert('已送出檢舉', '管理人員將於後台處理。');
    } catch (e: any) {
      Alert.alert('檢舉失敗', e?.message ?? String(e));
    }
  };

  const openReportSheet = () => {
    Alert.alert('檢舉貼文', '請選原因', [
      { text: '取消', style: 'cancel' },
      { text: '騷擾或不當言行', onPress: () => void reporterLine('騷擾或不當言行') },
      { text: '垃圾訊息', onPress: () => void reporterLine('垃圾訊息') },
      { text: '其他違規', onPress: () => void reporterLine('其他違規') },
    ]);
  };

  const authorShown = () => {
    if (!post) return '';
    if (post.anonymous) return post.aliasSnapshot ?? '匿名貼文';
    const u = post.authorUid;
    if (!u) return '成員';
    return nameByUid[u] ?? '載入中…';
  };

  const replyAuthor = (r: CampusReply) => {
    if (r.anonymous) return r.aliasSnapshot ?? '匿名';
    const u = r.authorUid as string | undefined;
    if (!u) return '成員';
    return nameByUid[u] ?? u.slice(0, 8);
  };

  if (!postId) {
    return (
      <View style={styles.center}>
        <Text style={{ color: theme.colors.textSecondary }}>無貼文 ID</Text>
      </View>
    );
  }

  if (!auth.user) {
    return (
      <View style={styles.center}>
        <Text style={{ color: theme.colors.textSecondary }}>請先登入以查看貼文</Text>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={{ flex: 1 }}
    >
      {loading ? (
        <ActivityIndicator style={{ marginTop: 40 }} />
      ) : !post ? (
        <Text style={{ color: theme.colors.textSecondary, textAlign: 'center', marginTop: 40 }}>
          找不到貼文，可能已被刪除。
        </Text>
      ) : (() => {
        const viewerUid = auth.user?.uid;
        const likedNow =
          !!(viewerUid && Array.isArray(post.likedBy) && post.likedBy.includes(viewerUid));
        const likeDisp =
          typeof post.likes === 'number'
            ? post.likes
            : Array.isArray(post.likedBy)
              ? post.likedBy.length
              : 0;
        const cc = typeof post.commentCount === 'number' ? post.commentCount : replies.length;
        return (
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{
            paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING + theme.space.xl,
          }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        >
          <View style={styles.headerRow}>
            <Text style={styles.author}>{authorShown()}</Text>
            <Pressable onPress={openReportSheet} hitSlop={10}>
              <Text style={{ color: theme.colors.danger, fontWeight: '700', fontSize: 13 }}>檢舉</Text>
            </Pressable>
          </View>
          <Text style={styles.title}>{post.title}</Text>
          <Text style={styles.body}>{post.content}</Text>

          <View style={styles.statsRow}>
            <Pressable
              style={[styles.statChip, likeBusy && { opacity: 0.65 }]}
              disabled={likeBusy}
              hitSlop={6}
              onPress={() => void toggleLikePost()}
            >
              <Ionicons
                name={likedNow ? 'heart' : 'heart-outline'}
                size={18}
                color={likedNow ? theme.colors.danger : theme.colors.textSecondary}
              />
              <Text style={[styles.statTxt, likedNow && { color: theme.colors.danger }]}>
                {likeDisp}
              </Text>
            </Pressable>
            <View style={[styles.statChip, { opacity: 1 }]}>
              <Ionicons name="chatbubble-outline" size={17} color={theme.colors.textSecondary} />
              <Text style={styles.statTxt}>{cc}</Text>
            </View>
          </View>

          <Text style={[styles.commentHeader, { marginTop: theme.space.md }]}>討論串 · {threadedReplies.length}</Text>
          {threadedReplies.length === 0 ? (
            <Text style={{ color: theme.colors.textSecondary, marginTop: theme.space.sm }}>尚無留言，當第一人吧。</Text>
          ) : (
            threadedReplies.map((item) => (
              <View
                key={item.id}
                style={[
                  styles.commentCard,
                  { marginTop: theme.space.sm },
                  item.threadDepth
                    ? {
                        marginLeft:
                          theme.layout.screenPadding +
                          Math.min(item.threadDepth, 6) * theme.space.sm,
                      }
                    : null,
                ]}
              >
                <View style={styles.commentTop}>
                  <Text style={styles.commentWho}>{replyAuthor(item)}</Text>
                  <Pressable hitSlop={8} onPress={() => setReplyParentId(item.id)}>
                    <Text style={{ color: theme.colors.accent, fontSize: 12, fontWeight: '700' }}>
                      回覆
                    </Text>
                  </Pressable>
                </View>
                <Text style={styles.commentBody}>{item.content}</Text>
              </View>
            ))
          )}

          <View style={styles.replyComposer}>
            <Text
              style={{
                fontWeight: '700',
                color: theme.colors.text,
                marginBottom: theme.space.sm,
              }}
            >寫留言</Text>
            {replyParentId ? (
              <View style={styles.replyTargetBar}>
                <Text style={{ flex: 1, color: theme.colors.textSecondary, fontSize: 13 }}>
                  正在回覆一則討論⋯
                </Text>
                <Pressable hitSlop={8} onPress={() => setReplyParentId(null)}>
                  <Text style={{ color: theme.colors.accent, fontWeight: '700' }}>取消</Text>
                </Pressable>
              </View>
            ) : null}
            <View style={styles.row}>
              <Text style={{ flex: 1, color: theme.colors.textSecondary }}>匿名留言</Text>
              <Switch value={replyAnonymous} onValueChange={setReplyAnonymous} />
            </View>
            <TextInput
              placeholder="輸入留言⋯"
              value={replyText}
              multiline
              onChangeText={setReplyText}
              style={styles.replyInput}
              placeholderTextColor={theme.colors.textSecondary}
            />
            <Pressable
              style={[styles.sendBtn, sendingReply && { opacity: 0.6 }]}
              disabled={sendingReply}
              onPress={() => void submitReply()}
            >
              <Text style={styles.sendTxt}>{sendingReply ? '送出中…' : '送出留言'}</Text>
            </Pressable>
          </View>
        </ScrollView>
        );
      })()}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: theme.layout.screenPadding,
    paddingTop: theme.space.md,
  },
  author: {
    flex: 1,
    fontSize: 12,
    color: theme.colors.accent,
    fontWeight: '700',
    marginRight: theme.space.md,
  },
  title: {
    paddingHorizontal: theme.layout.screenPadding,
    fontSize: 22,
    fontWeight: '900',
    color: theme.colors.text,
    marginTop: theme.space.sm,
    marginBottom: theme.space.md,
  },
  body: {
    paddingHorizontal: theme.layout.screenPadding,
    fontSize: 16,
    lineHeight: 24,
    color: theme.colors.text,
  },
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: theme.layout.screenPadding,
    marginTop: theme.space.lg,
    gap: theme.layout.sectionGap,
  },
  statChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: theme.colors.surface,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: theme.radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
  },
  statTxt: { fontSize: 14, fontWeight: '700', color: theme.colors.textSecondary },
  replyComposer: {
    marginHorizontal: theme.layout.screenPadding,
    marginTop: theme.space.xl,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.colors.border,
    paddingTop: theme.space.md,
  },
  row: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  replyInput: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.sm,
    padding: theme.space.sm,
    minHeight: 72,
    textAlignVertical: 'top',
    color: theme.colors.text,
    backgroundColor: theme.colors.surface,
  },
  sendBtn: {
    marginTop: 10,
    alignSelf: 'flex-end',
    backgroundColor: theme.colors.accent,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: theme.radius.md,
  },
  sendTxt: { color: '#fff', fontWeight: '700', fontSize: 14 },
  commentHeader: {
    fontWeight: '800',
    color: theme.colors.text,
    fontSize: 15,
    paddingHorizontal: theme.layout.screenPadding,
  },
  commentCard: {
    marginHorizontal: theme.layout.screenPadding,
    marginRight: theme.space.md,
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.sm,
    padding: theme.space.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
  },
  commentTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: theme.space.sm,
  },
  commentWho: {
    fontSize: 12,
    color: theme.colors.textSecondary,
    fontWeight: '700',
    flex: 1,
    marginRight: theme.space.sm,
  },
  commentBody: { fontSize: 15, color: theme.colors.text, lineHeight: 22 },
  replyTargetBar: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
    paddingVertical: 4,
  },
});

export default PostDetailScreen;
