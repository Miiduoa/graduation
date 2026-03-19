import React, { useMemo, useState } from "react";
import { ScrollView, Text, TextInput, View, Pressable, Alert } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Screen, Card, Button, Pill, SectionTitle, LoadingState, ErrorState, AnimatedCard } from "../ui/components";
import { generateJoinCode } from "../utils/joinCode";
import { TAB_BAR_CONTENT_BOTTOM_PADDING } from "../ui/navigationTheme";
import { theme, softShadowStyle } from "../ui/theme";
import { useSchool } from "../state/school";
import { useAuth } from "../state/auth";
import { useAsyncList } from "../hooks/useAsyncList";
import { getDb } from "../firebase";
import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";
import { chatWithAI } from "../services/ai";

type Group = {
  id: string;
  schoolId: string;
  type: "course" | "club" | "admin";
  name: string;
  joinCode: string;
  isPublished?: boolean;
  verification?: { status?: "unverified" | "verified_teacher" | "verified_org" };
};

type PostKind = "announcement" | "question" | "post";

type Post = {
  id: string;
  kind: PostKind;
  title: string;
  body: string;
  createdAt?: any;
  authorId: string;
  authorEmail?: string | null;
  solved?: boolean;
};

type Comment = {
  id: string;
  postId: string;
  body: string;
  authorId: string;
  authorEmail?: string | null;
  createdAt?: any;
  isBestAnswer?: boolean;
  isAI?: boolean;
};

export function GroupDetailScreen(props: any) {
  const nav = props?.navigation;
  const groupId: string | undefined = props?.route?.params?.groupId;
  const { school } = useSchool();
  const auth = useAuth();
  const db = getDb();

  const [q, setQ] = useState("");
  const [composeKind, setComposeKind] = useState<PostKind>("question");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const { items: groupMeta, loading: groupLoading, error: groupError, reload: reloadGroup } = useAsyncList<Group>(
    async () => {
      if (!groupId) return [];
      const snap = await getDoc(doc(db, "groups", groupId));
      if (!snap.exists()) return [];
      const g = { id: snap.id, ...(snap.data() as any) } as Group;
      return [g];
    },
    [db, groupId]
  );

  const group = groupMeta[0];

  const { items: myMemberRows, reload: reloadMember } = useAsyncList<{ role?: string }>(
    async () => {
      if (!groupId) return [];
      if (!auth.user) return [];
      const snap = await getDoc(doc(db, "groups", groupId, "members", auth.user.uid));
      if (!snap.exists()) return [];
      return [snap.data() as any];
    },
    [db, groupId, auth.user?.uid]
  );

  const myRole = myMemberRows[0]?.role as any;
  const canManageCourse = group?.type === "course" && (myRole === "owner" || myRole === "instructor");

  const { items: posts, loading: postsLoading, error: postsError, reload: reloadPosts } = useAsyncList<Post>(
    async () => {
      if (!groupId) return [];
      const ref = collection(db, "groups", groupId, "posts");
      const qy = query(ref, orderBy("createdAt", "desc"), limit(50));
      const snap = await getDocs(qy);
      const rows = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as any[];
      return rows as Post[];
    },
    [db, groupId]
  );

  // Load last comment for each post using batch queries
  const { items: lastCommentRows, reload: reloadComments } = useAsyncList<{ postId: string; comment: Comment | null }>(
    async () => {
      if (!groupId || posts.length === 0) return [];
      
      // Batch fetch: limit concurrent requests to avoid overwhelming Firestore
      const batchSize = 10;
      const out: Array<{ postId: string; comment: Comment | null }> = [];
      
      for (let i = 0; i < posts.length; i += batchSize) {
        const batch = posts.slice(i, i + batchSize);
        const promises = batch.map(async (p) => {
          try {
            const cref = collection(db, "groups", groupId, "posts", p.id, "comments");
            const cq = query(cref, orderBy("createdAt", "desc"), limit(1));
            const cs = await getDocs(cq);
            const c = cs.empty ? null : ({ id: cs.docs[0].id, postId: p.id, ...(cs.docs[0].data() as any) } as Comment);
            return { postId: p.id, comment: c };
          } catch (e) {
            console.warn(`[GroupDetail] Failed to fetch comments for post ${p.id}:`, e);
            return { postId: p.id, comment: null };
          }
        });
        
        const results = await Promise.all(promises);
        out.push(...results);
      }
      
      return out;
    },
    [db, groupId, posts.length > 0 ? posts[0].id : ""]
  );

  const lastComments = useMemo(() => {
    const m: Record<string, Comment | null> = {};
    for (const row of lastCommentRows) m[row.postId] = row.comment;
    return m;
  }, [lastCommentRows]);

  const visiblePosts = useMemo(() => {
    const base = posts;
    if (!q.trim()) return base;
    const needle = q.trim().toLowerCase();
    return base.filter((p) => {
      const hay = `${p.title}\n${p.body}\n${p.authorEmail ?? ""}`.toLowerCase();
      return hay.includes(needle);
    });
  }, [posts, q]);

  const setPublished = async (next: boolean) => {
    setErr(null);
    if (!groupId) return;
    if (!auth.user) {
      setErr("請先登入");
      return;
    }
    if (!canManageCourse) {
      setErr("你沒有權限管理此課程");
      return;
    }
    try {
      await setDoc(doc(db, "groups", groupId), { isPublished: next }, { merge: true });
      reloadGroup();
    } catch (e: any) {
      setErr(e?.message ?? "更新發布狀態失敗");
    }
  };

  const resetJoinCode = async () => {
    setErr(null);
    if (!groupId) return;
    if (!auth.user) {
      setErr("請先登入");
      return;
    }
    if (!canManageCourse) {
      setErr("你沒有權限重設加入碼");
      return;
    }

    try {
      let code = generateJoinCode(8);
      for (let i = 0; i < 8; i++) {
        const qy = query(collection(db, "groups"), where("joinCode", "==", code), limit(1));
        const snap = await getDocs(qy);
        if (snap.empty) break;
        code = generateJoinCode(8);
      }

      await setDoc(doc(db, "groups", groupId), { joinCode: code }, { merge: true });
      reloadGroup();

      // Keep denormalized users/{uid}/groups/{groupId}.joinCode in sync for all members (MVP, small classes)
      const mSnap = await getDocs(collection(db, "groups", groupId, "members"));
      for (const m of mSnap.docs) {
        const uid = (m.data() as any)?.uid ?? m.id;
        if (!uid) continue;
        await setDoc(doc(db, "users", uid, "groups", groupId), { joinCode: code }, { merge: true });
      }

      reloadMember();
    } catch (e: any) {
      setErr(e?.message ?? "重設加入碼失敗");
    }
  };

  const onCreatePost = async () => {
    setErr(null);
    if (!auth.user) {
      setErr("請先到『我的』登入後再發文");
      return;
    }
    if (!groupId) {
      setErr("缺少 groupId");
      return;
    }
    if (!title.trim() || !body.trim()) {
      setErr("請輸入標題與內容");
      return;
    }

    try {
      const postRef = await addDoc(collection(db, "groups", groupId, "posts"), {
        kind: composeKind,
        title: title.trim(),
        body: body.trim(),
        createdAt: serverTimestamp(),
        authorId: auth.user.uid,
        authorEmail: auth.user.email ?? null,
        solved: composeKind === "question" ? false : undefined,
        schoolId: school.id,
      });

      // 如果是問題，觸發 AI 初步回答
      if (composeKind === "question") {
        const postBody = body.trim();
        const postTitle = title.trim();
        // 非同步生成 AI 回答（不阻擋 UI）
        (async () => {
          try {
            const aiResponse = await chatWithAI(
              [{ role: "user", content: `課程問題：${postTitle}\n\n詳細說明：${postBody}` }],
              { schoolId: school.id, userId: "ai-assistant" }
            );
            if (aiResponse.content && !aiResponse.error) {
              await addDoc(collection(db, "groups", groupId, "posts", postRef.id, "comments"), {
                body: `**AI 初步回答（供參考）：**\n\n${aiResponse.content}\n\n_此回答由 AI 自動生成，請以教師和同學的回答為準。_`,
                createdAt: serverTimestamp(),
                authorId: "ai-assistant",
                authorEmail: "AI 助理",
                isAI: true,
              });
            }
          } catch {}
        })();
      }

      setTitle("");
      setBody("");
      reloadPosts();
    } catch (e: any) {
      setErr(e?.message ?? "發文失敗");
    }
  };

  const onMarkBestAnswer = async (postId: string, commentId: string) => {
    if (!groupId || !auth.user) return;
    try {
      await updateDoc(doc(db, "groups", groupId, "posts", postId, "comments", commentId), {
        isBestAnswer: true,
      });
      await updateDoc(doc(db, "groups", groupId, "posts", postId), {
        solved: true,
        bestAnswerCommentId: commentId,
      });
      reloadPosts();
    } catch {}
  };

  const onArchiveToKnowledgeBase = async (postId: string, postTitle: string, postBody: string) => {
    if (!groupId || !auth.user) return;
    Alert.alert(
      "歸入知識庫",
      `將「${postTitle}」歸入此課程的知識庫，讓未來的同學更容易找到？`,
      [
        { text: "取消", style: "cancel" },
        {
          text: "確認歸入",
          onPress: async () => {
            try {
              await setDoc(
                doc(db, "groups", groupId, "knowledgeBase", postId),
                {
                  postId,
                  title: postTitle,
                  summary: postBody.slice(0, 200),
                  archivedAt: serverTimestamp(),
                  archivedBy: auth.user!.uid,
                },
                { merge: true }
              );
              await updateDoc(doc(db, "groups", groupId, "posts", postId), { archivedToKnowledge: true });
              Alert.alert("已歸入知識庫！", "其他同學搜尋時將能找到這則問答。");
            } catch {}
          },
        },
      ]
    );
  };

  const onAddComment = async (postId: string) => {
    setErr(null);
    if (!auth.user) {
      setErr("請先登入後再留言");
      return;
    }
    if (!groupId) return;
    const text = body.trim();
    if (!text) {
      setErr("留言內容不可空白");
      return;
    }
    try {
      await addDoc(collection(db, "groups", groupId, "posts", postId, "comments"), {
        body: text,
        createdAt: serverTimestamp(),
        authorId: auth.user.uid,
        authorEmail: auth.user.email ?? null,
      });
      setBody("");
      reloadComments();
    } catch (e: any) {
      setErr(e?.message ?? "留言失敗");
    }
  };

  if (groupLoading) return <LoadingState title="群組" subtitle="載入中..." rows={2} />;
  if (groupError) return <ErrorState title="群組" subtitle="讀取群組失敗" hint={groupError} />;

  return (
    <Screen>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ gap: 12, paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING }}>
        <Card title="群組資訊" subtitle={`${group?.type ?? "group"}｜${group?.name ?? ""}`}>
          <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
            {group?.type === "course" ? (
              <Pill
                text={(group?.verification?.status ?? "unverified") === "verified_teacher" ? "老師認證" : "未驗證"}
                kind={(group?.verification?.status ?? "unverified") === "verified_teacher" ? "accent" : "default"}
              />
            ) : null}
            {group?.type === "course" ? <Pill text={group?.isPublished ? "已發布" : "未發布"} /> : null}
          </View>

          <Text style={{ color: theme.colors.muted, marginTop: 6 }}>加入碼：{group?.joinCode ?? "-"}</Text>

          <View style={{ marginTop: 10, flexDirection: "row", gap: 10, flexWrap: "wrap" }}>
            <Button text="成員" kind="primary" onPress={() => nav?.navigate?.("GroupMembers", { groupId })} />
            {group?.type === "course" ? (
              <Button text="作業 / 成績" onPress={() => nav?.navigate?.("GroupAssignments", { groupId })} />
            ) : null}
          </View>

          <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
            <Pill text="公告 / Q&A / 貼文" kind="accent" />
            <Pill text="私訊老師（Sprint 2）" />
          </View>

          {err ? (
            <View style={{ marginTop: 10 }}>
              <Pill text={err} />
            </View>
          ) : null}
        </Card>

        {canManageCourse ? (
          <Card title="課程管理（教師）" subtitle={`你的角色：${String(myRole ?? "-")}`}> 
            <View style={{ flexDirection: "row", gap: 10, flexWrap: "wrap" }}>
              <Button
                text={group?.isPublished ? "設為未發布" : "設為已發布"}
                kind="primary"
                onPress={() => setPublished(!group?.isPublished)}
              />
              <Button text="重設加入碼" onPress={resetJoinCode} />
            </View>
            <Text style={{ color: theme.colors.muted, fontSize: 12, lineHeight: 18 }}>
              已發布的課程會出現在「公開課程」列表，但加入仍需要加入碼。
            </Text>
          </Card>
        ) : null}

        <Card title="搜尋" subtitle="群組內搜尋貼文/公告。">
          <TextInput
            value={q}
            onChangeText={setQ}
            placeholder="搜尋（標題/內容/作者）"
            placeholderTextColor="rgba(168,176,194,0.6)"
            style={{
              marginTop: 10,
              paddingVertical: 12,
              paddingHorizontal: 14,
              borderRadius: theme.radius.md,
              borderWidth: 1,
              borderColor: theme.colors.border,
              backgroundColor: theme.colors.surface2,
              color: theme.colors.text,
            }}
          />
        </Card>

        <Card title="發文 / 發問題" subtitle="(MVP) 先做文字貼文，之後加公告置頂與已解決。">
          <View style={{ flexDirection: "row", gap: 10, flexWrap: "wrap" }}>
            <Button text={composeKind === "question" ? "✓ 問題" : "問題"} onPress={() => setComposeKind("question")} />
            <Button text={composeKind === "post" ? "✓ 貼文" : "貼文"} onPress={() => setComposeKind("post")} />
            <Button text={composeKind === "announcement" ? "✓ 公告" : "公告"} onPress={() => setComposeKind("announcement")} />
          </View>

          <TextInput
            value={title}
            onChangeText={setTitle}
            placeholder="標題"
            placeholderTextColor="rgba(168,176,194,0.6)"
            style={{
              marginTop: 10,
              paddingVertical: 12,
              paddingHorizontal: 14,
              borderRadius: theme.radius.md,
              borderWidth: 1,
              borderColor: theme.colors.border,
              backgroundColor: theme.colors.surface2,
              color: theme.colors.text,
            }}
          />
          <TextInput
            value={body}
            onChangeText={setBody}
            placeholder={composeKind === "announcement" ? "公告內容" : "內容"}
            placeholderTextColor="rgba(168,176,194,0.6)"
            multiline
            style={{
              marginTop: 10,
              minHeight: 90,
              paddingVertical: 12,
              paddingHorizontal: 14,
              borderRadius: theme.radius.md,
              borderWidth: 1,
              borderColor: theme.colors.border,
              backgroundColor: theme.colors.surface2,
              color: theme.colors.text,
              textAlignVertical: "top",
            }}
          />
          <View style={{ marginTop: 12, flexDirection: "row", gap: 10, flexWrap: "wrap" }}>
            <Button text={auth.user ? "送出" : "請先登入"} kind="primary" disabled={!auth.user} onPress={onCreatePost} />
            <Button text="重新整理" onPress={() => { reloadPosts(); reloadComments(); }} />
          </View>
        </Card>

        {postsLoading ? (
          <LoadingState title="貼文" subtitle="載入中..." rows={3} />
        ) : postsError ? (
          <ErrorState title="貼文" subtitle="讀取貼文失敗" hint={postsError} actionText="重試" onAction={reloadPosts} />
        ) : (
          <Card title="公告 / Q&A" subtitle="最新 50 則">
            <SectionTitle text={`結果：${visiblePosts.length}`} />
            <View style={{ marginTop: 10, gap: 10 }}>
              {visiblePosts.map((p) => {
                const lastComment = lastComments[p.id];
                const isQuestion = p.kind === "question";
                const isOwnerOrTeacher = canManageCourse || p.authorId === auth.user?.uid;

                return (
                  <View
                    key={p.id}
                    style={{
                      borderRadius: theme.radius.lg,
                      backgroundColor: theme.colors.surface,
                      borderWidth: 1,
                      borderColor: isQuestion && p.solved ? theme.colors.success : theme.colors.border,
                      padding: 16,
                      gap: 10,
                      ...softShadowStyle(theme.shadows.soft),
                    }}
                  >
                    {/* 標頭 */}
                    <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 10 }}>
                      <View style={{ flex: 1 }}>
                        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 6 }}>
                          <Pill
                            text={isQuestion ? (p.solved ? "✓ 已解決" : "問題") : p.kind === "announcement" ? "公告" : "貼文"}
                            kind={isQuestion && p.solved ? "success" : isQuestion ? "accent" : "default"}
                            size="sm"
                          />
                          {(p as any).archivedToKnowledge && (
                            <Pill text="📚 知識庫" kind="accent" size="sm" />
                          )}
                        </View>
                        <Text style={{ color: theme.colors.text, fontWeight: "700", fontSize: 15 }}>{p.title}</Text>
                        <Text style={{ color: theme.colors.muted, fontSize: 12, marginTop: 2 }}>
                          {p.authorEmail ?? p.authorId}
                        </Text>
                      </View>
                    </View>

                    <Text style={{ color: theme.colors.text, lineHeight: 20 }} numberOfLines={3}>{p.body}</Text>

                    {/* AI 初步回答或最新留言 */}
                    {lastComment ? (
                      <View
                        style={{
                          padding: 10,
                          borderRadius: theme.radius.md,
                          backgroundColor: lastComment.isAI
                            ? "rgba(139,92,246,0.08)"
                            : lastComment.isBestAnswer
                            ? theme.colors.successSoft
                            : theme.colors.surface2,
                          borderWidth: 1,
                          borderColor: lastComment.isBestAnswer
                            ? theme.colors.success
                            : lastComment.isAI
                            ? "#8B5CF6"
                            : theme.colors.border,
                        }}
                      >
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 4 }}>
                          {lastComment.isAI && <Ionicons name="sparkles" size={12} color="#8B5CF6" />}
                          {lastComment.isBestAnswer && <Ionicons name="checkmark-circle" size={12} color={theme.colors.success} />}
                          <Text style={{ color: lastComment.isAI ? "#8B5CF6" : theme.colors.muted, fontSize: 11, fontWeight: "700" }}>
                            {lastComment.isBestAnswer ? "最佳解答" : lastComment.isAI ? "AI 初步回答" : `留言：${lastComment.authorEmail ?? ""}`}
                          </Text>
                        </View>
                        <Text style={{ color: theme.colors.text, fontSize: 13, lineHeight: 18 }} numberOfLines={2}>
                          {lastComment.body}
                        </Text>
                      </View>
                    ) : null}

                    {/* 操作按鈕 */}
                    <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
                      <Pressable
                        onPress={() => nav?.navigate?.("GroupPost", { groupId, postId: p.id })}
                        style={({ pressed }) => ({
                          paddingHorizontal: 14,
                          paddingVertical: 8,
                          borderRadius: theme.radius.full,
                          backgroundColor: pressed ? theme.colors.accentSoft : theme.colors.accent,
                        })}
                      >
                        <Text style={{ color: "#fff", fontWeight: "700", fontSize: 13 }}>查看 / 留言</Text>
                      </Pressable>

                      {p.authorId !== "ai-assistant" && (
                        <Pressable
                          onPress={() => nav?.navigate?.("Chat", { kind: "dm", peerId: p.authorId, refPostId: p.id })}
                          style={({ pressed }) => ({
                            paddingHorizontal: 14,
                            paddingVertical: 8,
                            borderRadius: theme.radius.full,
                            backgroundColor: theme.colors.surface2,
                            borderWidth: 1,
                            borderColor: theme.colors.border,
                            opacity: pressed ? 0.7 : 1,
                          })}
                        >
                          <Text style={{ color: theme.colors.text, fontSize: 13 }}>私訊</Text>
                        </Pressable>
                      )}

                      {isOwnerOrTeacher && isQuestion && !p.solved && (
                        <Pressable
                          onPress={() => nav?.navigate?.("GroupPost", { groupId, postId: p.id, markBestMode: true })}
                          style={({ pressed }) => ({
                            paddingHorizontal: 14,
                            paddingVertical: 8,
                            borderRadius: theme.radius.full,
                            backgroundColor: pressed ? theme.colors.successSoft : theme.colors.successSoft,
                            borderWidth: 1,
                            borderColor: theme.colors.success,
                          })}
                        >
                          <Text style={{ color: theme.colors.success, fontSize: 13, fontWeight: "700" }}>標記最佳解答</Text>
                        </Pressable>
                      )}

                      {isOwnerOrTeacher && isQuestion && p.solved && !(p as any).archivedToKnowledge && (
                        <Pressable
                          onPress={() => onArchiveToKnowledgeBase(p.id, p.title, p.body)}
                          style={({ pressed }) => ({
                            paddingHorizontal: 14,
                            paddingVertical: 8,
                            borderRadius: theme.radius.full,
                            backgroundColor: "rgba(99,102,241,0.1)",
                            borderWidth: 1,
                            borderColor: "#6366F1",
                            opacity: pressed ? 0.7 : 1,
                          })}
                        >
                          <Text style={{ color: "#6366F1", fontSize: 13, fontWeight: "700" }}>📚 歸入知識庫</Text>
                        </Pressable>
                      )}
                    </View>
                  </View>
                );
              })}

              {visiblePosts.length === 0 ? <Text style={{ color: theme.colors.muted }}>目前沒有貼文。</Text> : null}
            </View>
          </Card>
        )}
      </ScrollView>
    </Screen>
  );
}
