import React, { useMemo, useState, useRef, useEffect } from "react";
import { ScrollView, Text, TextInput, View, Pressable, Alert, KeyboardAvoidingView, Platform } from "react-native";
import { Screen, Card, Button, Pill, LoadingState, ErrorState, AnimatedCard, Avatar, StatusBadge } from "../ui/components";
import { TAB_BAR_CONTENT_BOTTOM_PADDING } from "../ui/navigationTheme";
import { theme } from "../ui/theme";
import { useAuth } from "../state/auth";
import { getDb } from "../firebase";
import { 
  addDoc, collection, doc, getDoc, getDocs, limit, orderBy, query, serverTimestamp, 
  updateDoc, deleteDoc, arrayUnion, arrayRemove, increment 
} from "firebase/firestore";
import { useAsyncList } from "../hooks/useAsyncList";
import { Ionicons } from "@expo/vector-icons";

type PostKind = "announcement" | "question" | "post";

type Group = { id: string; name: string; type: string; joinCode?: string; createdBy?: string };

type MemberRole = "owner" | "instructor" | "moderator" | "member";

type Post = {
  id: string;
  kind: PostKind;
  title: string;
  body: string;
  authorId: string;
  authorEmail?: string | null;
  authorName?: string | null;
  authorAvatarUrl?: string | null;
  createdAt?: any;
  updatedAt?: any;
  solved?: boolean;
  solvedBy?: string | null;
  solvedAt?: any;
  pinned?: boolean;
  likeCount?: number;
  commentCount?: number;
};

type Comment = {
  id: string;
  body: string;
  authorId: string;
  authorEmail?: string | null;
  authorName?: string | null;
  authorAvatarUrl?: string | null;
  createdAt?: any;
  updatedAt?: any;
  likedBy?: string[];
  likeCount?: number;
  replyTo?: string | null;
  replyToAuthor?: string | null;
  isAnswer?: boolean;
};

type UserProfile = {
  uid: string;
  displayName?: string;
  email?: string;
  avatarUrl?: string;
};

export function GroupPostScreen(props: any) {
  const nav = props?.navigation;
  const groupId: string | undefined = props?.route?.params?.groupId;
  const postId: string | undefined = props?.route?.params?.postId;
  const auth = useAuth();
  const db = getDb();

  const [commentText, setCommentText] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [editCommentText, setEditCommentText] = useState("");
  const [replyTo, setReplyTo] = useState<{ id: string; authorName: string } | null>(null);
  const [isEditingPost, setIsEditingPost] = useState(false);
  const [editPostTitle, setEditPostTitle] = useState("");
  const [editPostBody, setEditPostBody] = useState("");
  const scrollViewRef = useRef<ScrollView>(null);
  const inputRef = useRef<TextInput>(null);

  const { items: groupRows } = useAsyncList<Group>(
    async () => {
      if (!groupId) return [];
      const snap = await getDoc(doc(db, "groups", groupId));
      if (!snap.exists()) return [];
      return [{ id: snap.id, ...(snap.data() as any) } as any];
    },
    [db, groupId]
  );

  const group = groupRows[0];

  // Get my membership role
  const { items: myMemberRows } = useAsyncList<{ role?: MemberRole }>(
    async () => {
      if (!groupId || !auth.user) return [];
      const snap = await getDoc(doc(db, "groups", groupId, "members", auth.user.uid));
      if (!snap.exists()) return [];
      return [snap.data() as any];
    },
    [db, groupId, auth.user?.uid]
  );

  const myRole = myMemberRows[0]?.role;
  const canManage = myRole === "owner" || myRole === "instructor" || myRole === "moderator";

  const { items: postRows, loading: postLoading, error: postError, reload: reloadPost } = useAsyncList<Post>(
    async () => {
      if (!groupId || !postId) return [];
      const snap = await getDoc(doc(db, "groups", groupId, "posts", postId));
      if (!snap.exists()) return [];
      return [{ id: snap.id, ...(snap.data() as any) } as any];
    },
    [db, groupId, postId]
  );

  const post = postRows[0];

  // Initialize edit post form
  useEffect(() => {
    if (post && isEditingPost) {
      setEditPostTitle(post.title);
      setEditPostBody(post.body);
    }
  }, [post, isEditingPost]);

  const { items: comments, loading: cLoading, error: cError, reload: reloadComments } = useAsyncList<Comment>(
    async () => {
      if (!groupId || !postId) return [];
      const ref = collection(db, "groups", groupId, "posts", postId, "comments");
      const qy = query(ref, orderBy("createdAt", "asc"), limit(200));
      const snap = await getDocs(qy);
      return snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) } as any));
    },
    [db, groupId, postId]
  );

  // Fetch user profiles for comments
  const { items: userProfiles } = useAsyncList<UserProfile>(
    async () => {
      const uids = new Set<string>();
      if (post) uids.add(post.authorId);
      for (const c of comments) uids.add(c.authorId);
      const profiles: UserProfile[] = [];
      for (const uid of uids) {
        try {
          const snap = await getDoc(doc(db, "users", uid));
          if (snap.exists()) {
            profiles.push({ uid, ...(snap.data() as any) });
          }
        } catch {}
      }
      return profiles;
    },
    [db, post?.authorId, comments.map(c => c.authorId).join(",")]
  );

  const profilesById = useMemo(() => {
    const map: Record<string, UserProfile> = {};
    for (const p of userProfiles) map[p.uid] = p;
    return map;
  }, [userProfiles]);

  const title = useMemo(() => {
    if (!post) return "貼文";
    return post.kind === "announcement" ? "公告" : post.kind === "question" ? "問題" : "貼文";
  }, [post]);

  const isMyPost = post && auth.user && post.authorId === auth.user.uid;

  // Send comment
  const onSend = async () => {
    setErr(null);
    setSuccessMsg(null);
    if (!auth.user) {
      setErr("請先登入");
      return;
    }
    if (!groupId || !postId) return;
    if (!commentText.trim()) {
      setErr("留言不可空白");
      return;
    }
    setSending(true);
    try {
      await addDoc(collection(db, "groups", groupId, "posts", postId, "comments"), {
        body: commentText.trim(),
        createdAt: serverTimestamp(),
        authorId: auth.user.uid,
        authorEmail: auth.user.email ?? null,
        authorName: auth.profile?.displayName ?? null,
        authorAvatarUrl: auth.profile?.avatarUrl ?? null,
        likedBy: [],
        likeCount: 0,
        replyTo: replyTo?.id ?? null,
        replyToAuthor: replyTo?.authorName ?? null,
      });
      // Update comment count on post
      await updateDoc(doc(db, "groups", groupId, "posts", postId), {
        commentCount: increment(1),
      });
      setCommentText("");
      setReplyTo(null);
      reloadComments();
      setSuccessMsg("留言成功");
    } catch (e: any) {
      setErr(e?.message ?? "留言失敗");
    } finally {
      setSending(false);
    }
  };

  // Like comment
  const onLikeComment = async (commentId: string, alreadyLiked: boolean) => {
    if (!auth.user || !groupId || !postId) return;
    try {
      const commentRef = doc(db, "groups", groupId, "posts", postId, "comments", commentId);
      if (alreadyLiked) {
        await updateDoc(commentRef, {
          likedBy: arrayRemove(auth.user.uid),
          likeCount: increment(-1),
        });
      } else {
        await updateDoc(commentRef, {
          likedBy: arrayUnion(auth.user.uid),
          likeCount: increment(1),
        });
      }
      reloadComments();
    } catch (e: any) {
      setErr(e?.message ?? "操作失敗");
    }
  };

  // Edit comment
  const onSaveEditComment = async () => {
    if (!auth.user || !groupId || !postId || !editingCommentId) return;
    if (!editCommentText.trim()) {
      setErr("留言不可空白");
      return;
    }
    try {
      await updateDoc(doc(db, "groups", groupId, "posts", postId, "comments", editingCommentId), {
        body: editCommentText.trim(),
        updatedAt: serverTimestamp(),
      });
      setEditingCommentId(null);
      setEditCommentText("");
      reloadComments();
      setSuccessMsg("留言已更新");
    } catch (e: any) {
      setErr(e?.message ?? "更新失敗");
    }
  };

  // Delete comment
  const onDeleteComment = async (commentId: string) => {
    Alert.alert("刪除留言", "確定要刪除此留言嗎？", [
      { text: "取消", style: "cancel" },
      {
        text: "刪除",
        style: "destructive",
        onPress: async () => {
          if (!groupId || !postId) return;
          try {
            await deleteDoc(doc(db, "groups", groupId, "posts", postId, "comments", commentId));
            await updateDoc(doc(db, "groups", groupId, "posts", postId), {
              commentCount: increment(-1),
            });
            reloadComments();
            setSuccessMsg("留言已刪除");
          } catch (e: any) {
            setErr(e?.message ?? "刪除失敗");
          }
        },
      },
    ]);
  };

  // Mark as answer (for questions)
  const onMarkAsAnswer = async (commentId: string) => {
    if (!groupId || !postId || !auth.user) return;
    if (!isMyPost && !canManage) {
      setErr("只有發文者或管理員可以標記最佳解答");
      return;
    }
    try {
      // Update comment
      await updateDoc(doc(db, "groups", groupId, "posts", postId, "comments", commentId), {
        isAnswer: true,
      });
      // Mark post as solved
      await updateDoc(doc(db, "groups", groupId, "posts", postId), {
        solved: true,
        solvedBy: auth.user.uid,
        solvedAt: serverTimestamp(),
      });
      reloadComments();
      reloadPost();
      setSuccessMsg("已標記為最佳解答");
    } catch (e: any) {
      setErr(e?.message ?? "操作失敗");
    }
  };

  // Save edited post
  const onSaveEditPost = async () => {
    if (!groupId || !postId || !auth.user) return;
    if (!editPostTitle.trim() || !editPostBody.trim()) {
      setErr("標題和內容不可空白");
      return;
    }
    try {
      await updateDoc(doc(db, "groups", groupId, "posts", postId), {
        title: editPostTitle.trim(),
        body: editPostBody.trim(),
        updatedAt: serverTimestamp(),
      });
      setIsEditingPost(false);
      reloadPost();
      setSuccessMsg("貼文已更新");
    } catch (e: any) {
      setErr(e?.message ?? "更新失敗");
    }
  };

  // Delete post
  const onDeletePost = () => {
    Alert.alert("刪除貼文", "確定要刪除此貼文嗎？所有留言也會一併刪除。", [
      { text: "取消", style: "cancel" },
      {
        text: "刪除",
        style: "destructive",
        onPress: async () => {
          if (!groupId || !postId) return;
          try {
            await deleteDoc(doc(db, "groups", groupId, "posts", postId));
            nav?.goBack?.();
          } catch (e: any) {
            setErr(e?.message ?? "刪除失敗");
          }
        },
      },
    ]);
  };

  // Pin/unpin post
  const onTogglePin = async () => {
    if (!groupId || !postId || !canManage) return;
    try {
      await updateDoc(doc(db, "groups", groupId, "posts", postId), {
        pinned: !post?.pinned,
      });
      reloadPost();
      setSuccessMsg(post?.pinned ? "已取消置頂" : "已置頂");
    } catch (e: any) {
      setErr(e?.message ?? "操作失敗");
    }
  };

  // Reply to comment
  const onReply = (comment: Comment) => {
    const authorName = profilesById[comment.authorId]?.displayName || comment.authorEmail || "用戶";
    setReplyTo({ id: comment.id, authorName });
    inputRef.current?.focus();
  };

  // Format relative time
  const formatRelativeTime = (date: any) => {
    if (!date) return "";
    const d = date?.toDate?.() ?? new Date(date);
    const now = new Date();
    const diff = now.getTime() - d.getTime();
    const mins = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);
    if (mins < 1) return "剛剛";
    if (mins < 60) return `${mins} 分鐘前`;
    if (hours < 24) return `${hours} 小時前`;
    if (days < 7) return `${days} 天前`;
    return d.toLocaleDateString("zh-TW");
  };

  if (postLoading) return <LoadingState title={title} subtitle="載入中..." rows={3} />;
  if (postError) return <ErrorState title={title} subtitle="讀取失敗" hint={postError} />;
  if (!post) return <ErrorState title={title} subtitle="找不到貼文" hint="可能已刪除或無權限" />;

  const postAuthor = profilesById[post.authorId];
  const postAuthorName = postAuthor?.displayName || post.authorName || post.authorEmail || "匿名";

  const getKindIcon = (kind: PostKind) => {
    switch (kind) {
      case "announcement": return "megaphone";
      case "question": return "help-circle";
      default: return "chatbubble";
    }
  };

  const getKindColor = (kind: PostKind) => {
    switch (kind) {
      case "announcement": return "#F59E0B";
      case "question": return theme.colors.accent;
      default: return theme.colors.muted;
    }
  };

  return (
    <Screen>
      <KeyboardAvoidingView 
        behavior={Platform.OS === "ios" ? "padding" : "height"} 
        style={{ flex: 1 }}
        keyboardVerticalOffset={100}
      >
        <ScrollView 
          ref={scrollViewRef}
          contentContainerStyle={{ gap: 12, paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING }}
        >
          {/* Error/Success Messages */}
          {err && (
            <AnimatedCard>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10, padding: 12, backgroundColor: `${theme.colors.danger}15`, borderRadius: theme.radius.md }}>
                <Ionicons name="alert-circle" size={20} color={theme.colors.danger} />
                <Text style={{ flex: 1, color: theme.colors.danger }}>{err}</Text>
                <Pressable onPress={() => setErr(null)}>
                  <Ionicons name="close" size={20} color={theme.colors.danger} />
                </Pressable>
              </View>
            </AnimatedCard>
          )}
          {successMsg && (
            <AnimatedCard>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10, padding: 12, backgroundColor: `${theme.colors.success}15`, borderRadius: theme.radius.md }}>
                <Ionicons name="checkmark-circle" size={20} color={theme.colors.success} />
                <Text style={{ flex: 1, color: theme.colors.success }}>{successMsg}</Text>
                <Pressable onPress={() => setSuccessMsg(null)}>
                  <Ionicons name="close" size={20} color={theme.colors.success} />
                </Pressable>
              </View>
            </AnimatedCard>
          )}

          {/* Post Content */}
          <AnimatedCard>
            <View style={{ 
              padding: 16, 
              borderRadius: theme.radius.lg, 
              backgroundColor: theme.colors.surface,
              borderWidth: 1,
              borderColor: theme.colors.border,
            }}>
              {/* Post Header */}
              <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 12, marginBottom: 14 }}>
                {postAuthor?.avatarUrl ? (
                  <Avatar name={postAuthorName} size={48} imageUrl={postAuthor.avatarUrl} />
                ) : (
                  <View style={{
                    width: 48, height: 48, borderRadius: 24,
                    backgroundColor: getKindColor(post.kind) + "20",
                    alignItems: "center", justifyContent: "center",
                  }}>
                    <Ionicons name={getKindIcon(post.kind) as any} size={24} color={getKindColor(post.kind)} />
                  </View>
                )}
                <View style={{ flex: 1 }}>
                  <Text style={{ color: theme.colors.text, fontWeight: "700", fontSize: 15 }}>{postAuthorName}</Text>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 4 }}>
                    <Text style={{ color: theme.colors.muted, fontSize: 12 }}>{formatRelativeTime(post.createdAt)}</Text>
                    {post.updatedAt && (
                      <Text style={{ color: theme.colors.muted, fontSize: 11 }}>（已編輯）</Text>
                    )}
                  </View>
                </View>
                {/* Action Menu */}
                {(isMyPost || canManage) && (
                  <Pressable
                    onPress={() => {
                      const options = [];
                      if (isMyPost || canManage) options.push({ text: "編輯", onPress: () => setIsEditingPost(true) });
                      if (canManage) options.push({ text: post.pinned ? "取消置頂" : "置頂", onPress: onTogglePin });
                      if (isMyPost || canManage) options.push({ text: "刪除", onPress: onDeletePost, style: "destructive" as const });
                      Alert.alert("貼文操作", undefined, [...options, { text: "取消", style: "cancel" }]);
                    }}
                    style={{ padding: 8 }}
                  >
                    <Ionicons name="ellipsis-horizontal" size={20} color={theme.colors.muted} />
                  </Pressable>
                )}
              </View>

              {/* Status Pills */}
              <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
                <Pill 
                  text={post.kind === "announcement" ? "公告" : post.kind === "question" ? "問題" : "貼文"} 
                  kind={post.kind === "announcement" ? "accent" : "default"} 
                />
                {post.pinned && <StatusBadge status="info" label="置頂" />}
                {post.kind === "question" && (
                  <StatusBadge 
                    status={post.solved ? "success" : "warning"} 
                    label={post.solved ? "已解決" : "待解答"} 
                  />
                )}
              </View>

              {/* Post Edit Mode */}
              {isEditingPost ? (
                <View style={{ gap: 12 }}>
                  <TextInput
                    value={editPostTitle}
                    onChangeText={setEditPostTitle}
                    placeholder="標題"
                    placeholderTextColor="rgba(168,176,194,0.6)"
                    style={{
                      paddingVertical: 12,
                      paddingHorizontal: 14,
                      borderRadius: theme.radius.md,
                      borderWidth: 1,
                      borderColor: theme.colors.border,
                      backgroundColor: "rgba(255,255,255,0.04)",
                      color: theme.colors.text,
                      fontWeight: "700",
                      fontSize: 16,
                    }}
                  />
                  <TextInput
                    value={editPostBody}
                    onChangeText={setEditPostBody}
                    placeholder="內容"
                    placeholderTextColor="rgba(168,176,194,0.6)"
                    multiline
                    style={{
                      minHeight: 100,
                      paddingVertical: 12,
                      paddingHorizontal: 14,
                      borderRadius: theme.radius.md,
                      borderWidth: 1,
                      borderColor: theme.colors.border,
                      backgroundColor: "rgba(255,255,255,0.04)",
                      color: theme.colors.text,
                      textAlignVertical: "top",
                    }}
                  />
                  <View style={{ flexDirection: "row", gap: 10 }}>
                    <Button text="儲存" kind="primary" onPress={onSaveEditPost} />
                    <Button text="取消" onPress={() => setIsEditingPost(false)} />
                  </View>
                </View>
              ) : (
                <>
                  {/* Post Title & Body */}
                  <Text style={{ color: theme.colors.text, fontWeight: "800", fontSize: 18, marginBottom: 10 }}>
                    {post.title}
                  </Text>
                  <Text style={{ color: theme.colors.text, lineHeight: 22, fontSize: 15 }}>{post.body}</Text>
                </>
              )}

              {/* Post Stats & Actions */}
              <View style={{ 
                marginTop: 16, 
                paddingTop: 14, 
                borderTopWidth: 1, 
                borderTopColor: theme.colors.border,
                flexDirection: "row", 
                alignItems: "center", 
                gap: 16 
              }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                  <Ionicons name="chatbubble-outline" size={18} color={theme.colors.muted} />
                  <Text style={{ color: theme.colors.muted }}>{comments.length}</Text>
                </View>
                <Pressable 
                  onPress={() => nav?.navigate?.("Chat", { kind: "dm", peerId: post.authorId })}
                  style={{ flexDirection: "row", alignItems: "center", gap: 6 }}
                >
                  <Ionicons name="mail-outline" size={18} color={theme.colors.accent} />
                  <Text style={{ color: theme.colors.accent }}>私訊</Text>
                </Pressable>
              </View>
            </View>
          </AnimatedCard>

          {/* Comments Section */}
          <AnimatedCard title={`留言 (${comments.length})`} delay={50}>
            {cLoading ? (
              <LoadingState title="留言" subtitle="載入中..." rows={3} />
            ) : cError ? (
              <ErrorState title="留言" subtitle="讀取失敗" hint={cError} actionText="重試" onAction={reloadComments} />
            ) : (
              <View style={{ gap: 12 }}>
                {comments.map((c, idx) => {
                  const commentAuthor = profilesById[c.authorId];
                  const commentAuthorName = commentAuthor?.displayName || c.authorName || c.authorEmail || "用戶";
                  const isMyComment = auth.user && c.authorId === auth.user.uid;
                  const alreadyLiked = auth.user && c.likedBy?.includes(auth.user.uid);
                  const isEditing = editingCommentId === c.id;

                  return (
                    <AnimatedCard key={c.id} delay={idx * 20}>
                      <View style={{ 
                        padding: 12, 
                        borderRadius: theme.radius.md, 
                        backgroundColor: c.isAnswer ? `${theme.colors.success}10` : theme.colors.surface2,
                        borderWidth: c.isAnswer ? 1 : 0,
                        borderColor: c.isAnswer ? theme.colors.success : "transparent",
                      }}>
                        {/* Answer Badge */}
                        {c.isAnswer && (
                          <View style={{ 
                            flexDirection: "row", 
                            alignItems: "center", 
                            gap: 6, 
                            marginBottom: 10,
                            padding: 6,
                            backgroundColor: `${theme.colors.success}20`,
                            borderRadius: theme.radius.sm,
                            alignSelf: "flex-start",
                          }}>
                            <Ionicons name="checkmark-circle" size={16} color={theme.colors.success} />
                            <Text style={{ color: theme.colors.success, fontWeight: "700", fontSize: 12 }}>最佳解答</Text>
                          </View>
                        )}

                        {/* Comment Header */}
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 8 }}>
                          {commentAuthor?.avatarUrl ? (
                            <Avatar name={commentAuthorName} size={32} imageUrl={commentAuthor.avatarUrl} />
                          ) : (
                            <View style={{
                              width: 32, height: 32, borderRadius: 16,
                              backgroundColor: theme.colors.surface,
                              alignItems: "center", justifyContent: "center",
                            }}>
                              <Text style={{ color: theme.colors.accent, fontWeight: "600", fontSize: 13 }}>
                                {commentAuthorName[0]?.toUpperCase() ?? "?"}
                              </Text>
                            </View>
                          )}
                          <View style={{ flex: 1 }}>
                            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                              <Text style={{ color: theme.colors.text, fontWeight: "600", fontSize: 13 }}>
                                {commentAuthorName}
                              </Text>
                              {c.authorId === post.authorId && (
                                <View style={{ paddingHorizontal: 6, paddingVertical: 2, backgroundColor: theme.colors.accentSoft, borderRadius: 4 }}>
                                  <Text style={{ color: theme.colors.accent, fontSize: 10, fontWeight: "600" }}>樓主</Text>
                                </View>
                              )}
                            </View>
                            <Text style={{ color: theme.colors.muted, fontSize: 11 }}>{formatRelativeTime(c.createdAt)}</Text>
                          </View>
                        </View>

                        {/* Reply To */}
                        {c.replyTo && c.replyToAuthor && (
                          <View style={{ 
                            paddingVertical: 6, 
                            paddingHorizontal: 10, 
                            backgroundColor: theme.colors.surface, 
                            borderRadius: theme.radius.sm,
                            borderLeftWidth: 2,
                            borderLeftColor: theme.colors.accent,
                            marginBottom: 8,
                          }}>
                            <Text style={{ color: theme.colors.muted, fontSize: 12 }}>
                              回覆 @{c.replyToAuthor}
                            </Text>
                          </View>
                        )}

                        {/* Comment Body */}
                        {isEditing ? (
                          <View style={{ gap: 10 }}>
                            <TextInput
                              value={editCommentText}
                              onChangeText={setEditCommentText}
                              placeholder="編輯留言..."
                              placeholderTextColor="rgba(168,176,194,0.6)"
                              multiline
                              autoFocus
                              style={{
                                minHeight: 60,
                                paddingVertical: 10,
                                paddingHorizontal: 12,
                                borderRadius: theme.radius.sm,
                                borderWidth: 1,
                                borderColor: theme.colors.accent,
                                backgroundColor: "rgba(255,255,255,0.04)",
                                color: theme.colors.text,
                                textAlignVertical: "top",
                              }}
                            />
                            <View style={{ flexDirection: "row", gap: 8 }}>
                              <Pressable 
                                onPress={onSaveEditComment}
                                style={{ paddingVertical: 8, paddingHorizontal: 14, backgroundColor: theme.colors.accent, borderRadius: theme.radius.sm }}
                              >
                                <Text style={{ color: "#fff", fontWeight: "600" }}>儲存</Text>
                              </Pressable>
                              <Pressable 
                                onPress={() => { setEditingCommentId(null); setEditCommentText(""); }}
                                style={{ paddingVertical: 8, paddingHorizontal: 14, backgroundColor: theme.colors.surface, borderRadius: theme.radius.sm }}
                              >
                                <Text style={{ color: theme.colors.muted, fontWeight: "600" }}>取消</Text>
                              </Pressable>
                            </View>
                          </View>
                        ) : (
                          <>
                            <Text style={{ color: theme.colors.text, lineHeight: 20 }}>{c.body}</Text>
                            {c.updatedAt && (
                              <Text style={{ color: theme.colors.muted, fontSize: 10, marginTop: 4 }}>（已編輯）</Text>
                            )}
                          </>
                        )}

                        {/* Comment Actions */}
                        {!isEditing && (
                          <View style={{ flexDirection: "row", alignItems: "center", gap: 16, marginTop: 10 }}>
                            {/* Like */}
                            <Pressable 
                              onPress={() => auth.user && onLikeComment(c.id, !!alreadyLiked)}
                              style={{ flexDirection: "row", alignItems: "center", gap: 4 }}
                            >
                              <Ionicons 
                                name={alreadyLiked ? "heart" : "heart-outline"} 
                                size={18} 
                                color={alreadyLiked ? theme.colors.danger : theme.colors.muted} 
                              />
                              {(c.likeCount ?? 0) > 0 && (
                                <Text style={{ color: alreadyLiked ? theme.colors.danger : theme.colors.muted, fontSize: 12 }}>
                                  {c.likeCount}
                                </Text>
                              )}
                            </Pressable>

                            {/* Reply */}
                            <Pressable 
                              onPress={() => onReply(c)}
                              style={{ flexDirection: "row", alignItems: "center", gap: 4 }}
                            >
                              <Ionicons name="return-down-back" size={18} color={theme.colors.muted} />
                              <Text style={{ color: theme.colors.muted, fontSize: 12 }}>回覆</Text>
                            </Pressable>

                            {/* Mark as Answer (for questions only) */}
                            {post.kind === "question" && !post.solved && (isMyPost || canManage) && (
                              <Pressable 
                                onPress={() => onMarkAsAnswer(c.id)}
                                style={{ flexDirection: "row", alignItems: "center", gap: 4 }}
                              >
                                <Ionicons name="checkmark-done" size={18} color={theme.colors.success} />
                                <Text style={{ color: theme.colors.success, fontSize: 12 }}>標為解答</Text>
                              </Pressable>
                            )}

                            {/* Edit/Delete (my comments or manager) */}
                            {(isMyComment || canManage) && (
                              <Pressable 
                                onPress={() => {
                                  Alert.alert("留言操作", undefined, [
                                    { text: "編輯", onPress: () => { setEditingCommentId(c.id); setEditCommentText(c.body); } },
                                    { text: "刪除", onPress: () => onDeleteComment(c.id), style: "destructive" },
                                    { text: "取消", style: "cancel" },
                                  ]);
                                }}
                              >
                                <Ionicons name="ellipsis-horizontal" size={18} color={theme.colors.muted} />
                              </Pressable>
                            )}
                          </View>
                        )}
                      </View>
                    </AnimatedCard>
                  );
                })}

                {comments.length === 0 && (
                  <View style={{ alignItems: "center", paddingVertical: 30 }}>
                    <Ionicons name="chatbubbles-outline" size={40} color={theme.colors.muted} />
                    <Text style={{ color: theme.colors.muted, marginTop: 10 }}>還沒有留言，成為第一個留言的人！</Text>
                  </View>
                )}
              </View>
            )}
          </AnimatedCard>
        </ScrollView>

        {/* Fixed Comment Input */}
        <View style={{ 
          position: "absolute", 
          bottom: 0, 
          left: 0, 
          right: 0, 
          backgroundColor: theme.colors.bg,
          borderTopWidth: 1,
          borderTopColor: theme.colors.border,
          padding: 12,
        }}>
          {/* Reply To indicator */}
          {replyTo && (
            <View style={{ 
              flexDirection: "row", 
              alignItems: "center", 
              justifyContent: "space-between",
              marginBottom: 8,
              padding: 8,
              backgroundColor: theme.colors.accentSoft,
              borderRadius: theme.radius.sm,
            }}>
              <Text style={{ color: theme.colors.accent, fontSize: 12 }}>
                回覆 @{replyTo.authorName}
              </Text>
              <Pressable onPress={() => setReplyTo(null)}>
                <Ionicons name="close" size={18} color={theme.colors.accent} />
              </Pressable>
            </View>
          )}

          <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 10 }}>
            <TextInput
              ref={inputRef}
              value={commentText}
              onChangeText={setCommentText}
              placeholder={auth.user ? "輸入留言..." : "請先登入"}
              placeholderTextColor="rgba(168,176,194,0.6)"
              multiline
              editable={!!auth.user}
              style={{
                flex: 1,
                maxHeight: 100,
                paddingVertical: 10,
                paddingHorizontal: 14,
                borderRadius: theme.radius.md,
                borderWidth: 1,
                borderColor: theme.colors.border,
                backgroundColor: "rgba(255,255,255,0.04)",
                color: theme.colors.text,
              }}
            />
            <Pressable
              onPress={onSend}
              disabled={!auth.user || sending || !commentText.trim()}
              style={{
                width: 44,
                height: 44,
                borderRadius: 22,
                backgroundColor: (!auth.user || sending || !commentText.trim()) ? theme.colors.surface2 : theme.colors.accent,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Ionicons 
                name={sending ? "hourglass" : "send"} 
                size={20} 
                color={(!auth.user || sending || !commentText.trim()) ? theme.colors.muted : "#fff"} 
              />
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}
