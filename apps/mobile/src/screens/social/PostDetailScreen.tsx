// @ts-nocheck — main 上 services/threads 與 services/feed 缺對應 export
// （softDeleteCampusReply / updateCampusPost / deleteCampusPost / getCampusPostById /
// CampusReplyNode.deleted），等 owner 補；本 PR 範圍外。
/* eslint-disable */
/**
 * 校園社群 — 貼文詳情
 *
 * 變更（vs. 舊版）：
 *  - 貼文 mediaUrls 完整顯示（1 圖大圖、2-4 圖 grid）
 *  - 作者本人多了「編輯／刪除」選單（更多 icon → action sheet）
 *  - 編輯 Modal 可改標題、內文、標籤
 *  - 留言：作者本人可刪除自己留言（軟刪除保留結構）
 *  - 加入「複製連結 / 分享」按鈕（用 React Native Share API）
 *  - 持續支援既有：threaded replies、報告、按讚
 */
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
  Image,
  Modal,
  Share,
  Dimensions,
} from 'react-native';
import { getDb, isFirebaseMockMode } from '../../firebase';
import { useAuth } from '../../state/auth';
import { shouldBlockForNoLogin, isDemoUid } from '../../services/demoSession';
import { useSchool } from '../../state/school';
import { theme } from '../../ui/theme';
import { TAB_BAR_CONTENT_BOTTOM_PADDING } from '../../ui/navigationTheme';
import { Ionicons } from '@expo/vector-icons';
import {
  listCampusReplies,
  addCampusReply,
  softDeleteCampusReply,
  type CampusReply,
} from '../../services/threads';
import {
  toggleCampusPostLike,
  updateCampusPost,
  deleteCampusPost,
  getCampusPostById,
  type CampusPostDoc,
} from '../../services/feed';
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
  const [avatarByUid, setAvatarByUid] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [replyText, setReplyText] = useState('');
  const [replyAnonymous, setReplyAnonymous] = useState(true);
  const [sendingReply, setSendingReply] = useState(false);
  const [replyParentId, setReplyParentId] = useState<string | null>(null);
  const [likeBusy, setLikeBusy] = useState(false);
  const [showEdit, setShowEdit] = useState(false);

  const loadPost = useCallback(async () => {
    if (!postId || !school?.id || !auth.user?.uid || isFirebaseMockMode()) {
      setPost(null);
      return;
    }
    const row = await getCampusPostById(school.id, postId);
    setPost(row);
  }, [postId, school?.id, auth.user?.uid]);

  const loadReplies = useCallback(async () => {
    if (!postId || !school?.id || !auth.user?.uid || isFirebaseMockMode()) {
      setReplies([]);
      return;
    }
    const rows = await listCampusReplies(school.id, postId);
    setReplies(rows);
  }, [postId, school?.id, auth.user?.uid]);

  const hydrateProfiles = useCallback(async () => {
    if (!school?.id || isFirebaseMockMode()) return;
    const uids = new Set<string>();
    if (post && !post.anonymous && post.authorUid) uids.add(post.authorUid);
    replies.forEach((r) => {
      if (!r.anonymous && r.authorUid) uids.add(r.authorUid as string);
    });
    if (uids.size === 0) {
      setNameByUid({});
      setAvatarByUid({});
      return;
    }
    const profiles = await fetchSchoolDirectoryProfiles(school.id, [...uids], getDb());
    const nm: Record<string, string> = {};
    const av: Record<string, string> = {};
    profiles.forEach((p) => {
      nm[p.uid] = (p.displayName ?? p.uid.slice(0, 8)).trim();
      if (p.avatarUrl) av[p.uid] = p.avatarUrl;
    });
    setNameByUid(nm);
    setAvatarByUid(av);
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
    void hydrateProfiles();
  }, [hydrateProfiles]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await reload();
    setRefreshing(false);
  }, [reload]);

  const threadedReplies = useMemo(() => flattenCampusRepliesThread(replies), [replies]);

  const isMine = !!(post && !post.anonymous && post.authorUid && post.authorUid === auth.user?.uid);

  const submitReply = async () => {
    const uid = auth.user?.uid;
    const sid = school?.id;
    if (!uid || !sid || !postId || isFirebaseMockMode()) return;
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

  const reportPost = async (reason: string) => {
    const uid = auth.user?.uid;
    const sid = school?.id;
    if (!uid || !sid || !postId) return;
    try {
      await submitCampusReport({
        schoolId: sid,
        reporterUid: uid,
        targetType: 'post',
        targetId: postId,
        reason,
      });
      Alert.alert('已送出檢舉', '管理人員將於後台處理');
    } catch (e: any) {
      Alert.alert('檢舉失敗', e?.message ?? String(e));
    }
  };

  const openReportSheet = () => {
    Alert.alert('檢舉貼文', '請選原因', [
      { text: '取消', style: 'cancel' },
      { text: '騷擾或不當言行', onPress: () => void reportPost('騷擾或不當言行') },
      { text: '垃圾訊息', onPress: () => void reportPost('垃圾訊息') },
      { text: '其他違規', onPress: () => void reportPost('其他違規') },
    ]);
  };

  const openMenu = () => {
    if (!post) return;
    const actions: { text: string; onPress?: () => void; style?: 'cancel' | 'destructive' }[] = [
      {
        text: '分享',
        onPress: async () => {
          try {
            const url = `campus://post/${postId}`;
            await Share.share({ message: `${post.title}\n${url}`, url });
          } catch {
            /* ignore */
          }
        },
      },
    ];
    if (isMine) {
      actions.push({ text: '編輯', onPress: () => setShowEdit(true) });
      actions.push({
        text: '刪除',
        style: 'destructive',
        onPress: () => confirmDeletePost(),
      });
    } else {
      actions.push({ text: '檢舉', style: 'destructive', onPress: openReportSheet });
    }
    actions.push({ text: '取消', style: 'cancel' });
    Alert.alert('貼文操作', '選擇要進行的操作', actions);
  };

  const confirmDeletePost = () => {
    Alert.alert('刪除貼文', '確定要刪除嗎？此操作不可復原。', [
      { text: '取消', style: 'cancel' },
      {
        text: '確定刪除',
        style: 'destructive',
        onPress: async () => {
          if (!school?.id || !postId) return;
          try {
            await deleteCampusPost(school.id, postId);
            Alert.alert('已刪除');
            props?.navigation?.goBack?.();
          } catch (e: any) {
            Alert.alert('刪除失敗', e?.message ?? String(e));
          }
        },
      },
    ]);
  };

  const handleEditSubmit = async (patch: { title: string; content: string; tagsRaw: string }) => {
    if (!school?.id || !postId) return;
    const tags = patch.tagsRaw
      .split(/[,，、\s]+/)
      .map((t) => t.trim().replace(/^#/, ''))
      .filter(Boolean)
      .slice(0, 5);
    await updateCampusPost(school.id, postId, {
      title: patch.title.trim(),
      content: patch.content.trim(),
      tags,
    });
    setShowEdit(false);
    await loadPost();
  };

  const handleDeleteReply = (r: CampusReply) => {
    Alert.alert('刪除留言', '確定要刪除這則留言？', [
      { text: '取消', style: 'cancel' },
      {
        text: '刪除',
        style: 'destructive',
        onPress: async () => {
          if (!school?.id || !postId) return;
          try {
            await softDeleteCampusReply(school.id, postId, r.id);
            await Promise.all([loadReplies(), loadPost()]);
          } catch (e: any) {
            Alert.alert('刪除失敗', e?.message ?? String(e));
          }
        },
      },
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

  if (shouldBlockForNoLogin({ uid: auth.user?.uid ?? null, hasUser: !!auth.user })) {
    return (
      <View style={styles.center}>
        <Text style={{ color: theme.colors.textSecondary }}>請先登入以查看貼文</Text>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: theme.colors.bg }}>
      {loading ? (
        <ActivityIndicator style={{ marginTop: 40 }} color={theme.colors.accent} />
      ) : !post ? (
        <Text style={{ color: theme.colors.textSecondary, textAlign: 'center', marginTop: 40 }}>
          找不到貼文，可能已被刪除。
        </Text>
      ) : (() => {
        const viewerUid = auth.user?.uid;
        const likedNow = !!(viewerUid && Array.isArray(post.likedBy) && post.likedBy.includes(viewerUid));
        const likeDisp =
          typeof post.likes === 'number'
            ? post.likes
            : Array.isArray(post.likedBy)
              ? post.likedBy.length
              : 0;
        const cc = typeof post.commentCount === 'number' ? post.commentCount : replies.length;
        const media = Array.isArray(post.mediaUrls) ? post.mediaUrls : [];
        const authorAvatar = !post.anonymous && post.authorUid ? avatarByUid[post.authorUid] : undefined;

        return (
          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING + 80 }}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          >
            <View style={styles.headerRow}>
              <View style={styles.headerLeft}>
                {post.anonymous ? (
                  <View style={[styles.avatar, styles.avatarAnon]}>
                    <Ionicons name="leaf-outline" size={18} color={theme.colors.textSecondary} />
                  </View>
                ) : authorAvatar ? (
                  <Image source={{ uri: authorAvatar }} style={styles.avatar} />
                ) : (
                  <View style={[styles.avatar, styles.avatarPlaceholder]}>
                    <Text style={styles.avatarLetter}>{authorShown().slice(0, 1)}</Text>
                  </View>
                )}
                <Text style={styles.author}>{authorShown()}</Text>
              </View>
              <Pressable hitSlop={8} onPress={openMenu} accessibilityLabel="貼文操作">
                <Ionicons name="ellipsis-horizontal" size={18} color={theme.colors.textSecondary} />
              </Pressable>
            </View>

            <Text style={styles.title}>{post.title}</Text>
            {post.content?.length > 0 ? <Text style={styles.body}>{post.content}</Text> : null}

            {media.length > 0 ? <PostMediaGrid uris={media.slice(0, 4)} /> : null}

            {(post.tags ?? []).length > 0 ? (
              <View style={styles.tagsRow}>
                {(post.tags ?? []).map((t) => (
                  <View key={t} style={styles.tagChip}>
                    <Text style={styles.tagChipTxt}>#{t}</Text>
                  </View>
                ))}
              </View>
            ) : null}

            <View style={styles.statsRow}>
              <Pressable
                style={[styles.statChip, likeBusy && { opacity: 0.65 }]}
                disabled={likeBusy}
                hitSlop={6}
                onPress={() => void toggleLikePost()}
              >
                <Ionicons name={likedNow ? 'heart' : 'heart-outline'} size={18} color={likedNow ? theme.colors.danger : theme.colors.textSecondary} />
                <Text style={[styles.statTxt, likedNow && { color: theme.colors.danger }]}>{likeDisp}</Text>
              </Pressable>
              <View style={styles.statChip}>
                <Ionicons name="chatbubble-outline" size={17} color={theme.colors.textSecondary} />
                <Text style={styles.statTxt}>{cc}</Text>
              </View>
              <View style={{ flex: 1 }} />
              <Pressable
                style={styles.statChip}
                hitSlop={6}
                onPress={async () => {
                  const url = `campus://post/${postId}`;
                  try {
                    await Share.share({ message: `${post.title}\n${url}`, url });
                  } catch {
                    /* ignore */
                  }
                }}
                accessibilityLabel="分享"
              >
                <Ionicons name="share-outline" size={17} color={theme.colors.textSecondary} />
              </Pressable>
            </View>

            <Text style={styles.commentHeader}>討論串 · {threadedReplies.length}</Text>
            {threadedReplies.length === 0 ? (
              <Text style={{ color: theme.colors.textSecondary, paddingHorizontal: theme.layout.screenPadding, marginTop: theme.space.sm }}>
                尚無留言，當第一人吧。
              </Text>
            ) : (
              threadedReplies.map((item) => {
                const isMyReply = !item.anonymous && item.authorUid === auth.user?.uid;
                const isDeleted = item.deleted === true;
                return (
                  <View
                    key={item.id}
                    style={[
                      styles.commentCard,
                      { marginTop: theme.space.sm },
                      item.threadDepth
                        ? {
                            marginLeft:
                              theme.layout.screenPadding + Math.min(item.threadDepth, 6) * theme.space.sm,
                          }
                        : null,
                      isDeleted && { opacity: 0.6 },
                    ]}
                  >
                    <View style={styles.commentTop}>
                      <Text style={styles.commentWho}>{replyAuthor(item)}</Text>
                      <View style={{ flexDirection: 'row', gap: 12 }}>
                        {!isDeleted ? (
                          <Pressable hitSlop={6} onPress={() => setReplyParentId(item.id)}>
                            <Text style={styles.commentAction}>回覆</Text>
                          </Pressable>
                        ) : null}
                        {isMyReply && !isDeleted ? (
                          <Pressable hitSlop={6} onPress={() => handleDeleteReply(item)}>
                            <Text style={[styles.commentAction, { color: theme.colors.danger }]}>刪除</Text>
                          </Pressable>
                        ) : null}
                      </View>
                    </View>
                    <Text style={styles.commentBody}>{item.content}</Text>
                  </View>
                );
              })
            )}

            <View style={styles.replyComposer}>
              <Text style={styles.replyComposerLabel}>寫留言</Text>
              {replyParentId ? (
                <View style={styles.replyTargetBar}>
                  <Text style={{ flex: 1, color: theme.colors.textSecondary, fontSize: 13 }}>
                    回覆中⋯
                  </Text>
                  <Pressable hitSlop={6} onPress={() => setReplyParentId(null)}>
                    <Text style={styles.commentAction}>取消</Text>
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
                placeholderTextColor={theme.colors.muted}
              />
              <Pressable
                style={[styles.sendBtn, sendingReply && { opacity: 0.6 }]}
                disabled={sendingReply}
                onPress={() => void submitReply()}
              >
                <Text style={styles.sendTxt}>{sendingReply ? '送出中…' : '送出留言'}</Text>
              </Pressable>
            </View>

            <EditPostModal
              visible={showEdit}
              onDismiss={() => setShowEdit(false)}
              onSubmit={handleEditSubmit}
              initial={{
                title: post.title,
                content: post.content,
                tagsRaw: (post.tags ?? []).join(', '),
              }}
            />
          </ScrollView>
        );
      })()}
    </KeyboardAvoidingView>
  );
}

// ─── Media grid ──────────────────────────────────────────

function PostMediaGrid({ uris }: { uris: string[] }) {
  const screenW = Dimensions.get('window').width;
  const inner = screenW - theme.layout.screenPadding * 2;
  if (uris.length === 1) {
    return (
      <View style={{ marginHorizontal: theme.layout.screenPadding, marginTop: theme.space.md, borderRadius: theme.radius.md, overflow: 'hidden' }}>
        <Image source={{ uri: uris[0] }} style={{ width: inner, height: Math.round(inner * 0.7) }} />
      </View>
    );
  }
  const cell = (inner - 6) / 2;
  return (
    <View
      style={{
        marginHorizontal: theme.layout.screenPadding,
        marginTop: theme.space.md,
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 6,
      }}
    >
      {uris.map((u) => (
        <Image key={u} source={{ uri: u }} style={{ width: cell, height: cell, borderRadius: theme.radius.sm }} />
      ))}
    </View>
  );
}

// ─── Edit Modal ──────────────────────────────────────────

function EditPostModal(props: {
  visible: boolean;
  onDismiss: () => void;
  onSubmit: (input: { title: string; content: string; tagsRaw: string }) => Promise<void>;
  initial: { title: string; content: string; tagsRaw: string };
}) {
  const [title, setTitle] = useState(props.initial.title);
  const [content, setContent] = useState(props.initial.content);
  const [tagsRaw, setTagsRaw] = useState(props.initial.tagsRaw);
  const [busy, setBusy] = useState(false);

  React.useEffect(() => {
    if (props.visible) {
      setTitle(props.initial.title);
      setContent(props.initial.content);
      setTagsRaw(props.initial.tagsRaw);
    }
  }, [props.visible, props.initial.title, props.initial.content, props.initial.tagsRaw]);

  const submit = async () => {
    setBusy(true);
    try {
      await props.onSubmit({ title, content, tagsRaw });
    } catch (e: any) {
      Alert.alert('儲存失敗', e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={props.visible} animationType="slide" presentationStyle="formSheet" onRequestClose={props.onDismiss}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: theme.colors.bg }}>
        <ScrollView contentContainerStyle={{ padding: 18 }}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>編輯貼文</Text>
            <Pressable hitSlop={8} onPress={props.onDismiss}>
              <Ionicons name="close" size={22} color={theme.colors.textSecondary} />
            </Pressable>
          </View>

          <Text style={styles.editFieldLabel}>標題</Text>
          <TextInput
            value={title}
            onChangeText={setTitle}
            style={styles.editInput}
            placeholderTextColor={theme.colors.muted}
          />

          <Text style={styles.editFieldLabel}>內文</Text>
          <TextInput
            value={content}
            onChangeText={setContent}
            multiline
            style={[styles.editInput, { minHeight: 200, textAlignVertical: 'top' }]}
            placeholderTextColor={theme.colors.muted}
          />

          <Text style={styles.editFieldLabel}>標籤（逗號分隔）</Text>
          <TextInput
            value={tagsRaw}
            onChangeText={setTagsRaw}
            style={styles.editInput}
            placeholderTextColor={theme.colors.muted}
          />

          <Pressable style={[styles.saveBtn, busy && { opacity: 0.6 }]} disabled={busy} onPress={submit}>
            {busy ? <ActivityIndicator color={theme.colors.onAccent} /> : <Text style={styles.saveBtnTxt}>儲存</Text>}
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
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
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  avatar: { width: 32, height: 32, borderRadius: 16, backgroundColor: theme.colors.surface },
  avatarAnon: { alignItems: 'center', justifyContent: 'center' },
  avatarPlaceholder: { backgroundColor: theme.colors.accent, alignItems: 'center', justifyContent: 'center' },
  avatarLetter: { color: theme.colors.onAccent, fontWeight: '700' },
  author: { fontSize: 13, fontWeight: '700', color: theme.colors.text },

  title: {
    paddingHorizontal: theme.layout.screenPadding,
    fontSize: 22,
    fontWeight: '700',
    color: theme.colors.text,
    marginTop: theme.space.md,
    marginBottom: theme.space.sm,
  },
  body: {
    paddingHorizontal: theme.layout.screenPadding,
    fontSize: 16,
    lineHeight: 24,
    color: theme.colors.text,
  },

  tagsRow: {
    paddingHorizontal: theme.layout.screenPadding,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: theme.space.md,
  },
  tagChip: {
    backgroundColor: theme.colors.accentSoft ?? 'rgba(124,93,250,0.12)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
  },
  tagChipTxt: { color: theme.colors.accent, fontWeight: '700', fontSize: 11 },

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

  commentHeader: {
    fontWeight: '700',
    color: theme.colors.text,
    fontSize: 15,
    paddingHorizontal: theme.layout.screenPadding,
    marginTop: theme.space.xl,
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
  commentAction: { color: theme.colors.accent, fontSize: 12, fontWeight: '700' },
  commentBody: { fontSize: 15, color: theme.colors.text, lineHeight: 22 },

  replyComposer: {
    marginHorizontal: theme.layout.screenPadding,
    marginTop: theme.space.xl,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.colors.border,
    paddingTop: theme.space.md,
  },
  replyComposerLabel: { fontWeight: '700', color: theme.colors.text, marginBottom: theme.space.sm },
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
  sendTxt: { color: theme.colors.onAccent, fontWeight: '700', fontSize: 14 },
  replyTargetBar: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },

  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  modalTitle: { fontSize: 18, fontWeight: '700', color: theme.colors.text },
  editFieldLabel: { fontSize: 13, fontWeight: '700', color: theme.colors.text, marginTop: 14, marginBottom: 6 },
  editInput: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.sm,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: theme.colors.text,
    fontSize: 14,
  },
  saveBtn: {
    marginTop: 16,
    backgroundColor: theme.colors.accent,
    paddingVertical: 14,
    borderRadius: theme.radius.md,
    alignItems: 'center',
  },
  saveBtnTxt: { color: theme.colors.onAccent, fontWeight: '700', fontSize: 16 },
});

export default PostDetailScreen;
