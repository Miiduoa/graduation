import React, { useMemo, useState } from "react";
import { ScrollView, Text, TextInput, View } from "react-native";
import { Screen, Card, Button, Pill, SectionTitle, LoadingState, ErrorState } from "../ui/components";
import { generateJoinCode } from "../utils/joinCode";
import { TAB_BAR_CONTENT_BOTTOM_PADDING } from "../ui/navigationTheme";
import { theme } from "../ui/theme";
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
  where,
} from "firebase/firestore";

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
      await addDoc(collection(db, "groups", groupId, "posts"), {
        kind: composeKind,
        title: title.trim(),
        body: body.trim(),
        createdAt: serverTimestamp(),
        authorId: auth.user.uid,
        authorEmail: auth.user.email ?? null,
        solved: composeKind === "question" ? false : undefined,
        schoolId: school.id,
      });
      setTitle("");
      setBody("");
      reloadPosts();
    } catch (e: any) {
      setErr(e?.message ?? "發文失敗");
    }
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
              backgroundColor: "rgba(255,255,255,0.04)",
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
              backgroundColor: "rgba(255,255,255,0.04)",
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
              backgroundColor: "rgba(255,255,255,0.04)",
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
              {visiblePosts.map((p) => (
                <Card
                  key={p.id}
                  title={p.title}
                  subtitle={`${p.kind}${p.kind === "question" ? (p.solved ? "｜已解決" : "｜未解決") : ""}｜${p.authorEmail ?? p.authorId}`}
                >
                  <Text style={{ color: theme.colors.text, lineHeight: 20 }}>{p.body}</Text>

                  {lastComments[p.id] ? (
                    <View style={{ marginTop: 10 }}>
                      <Text style={{ color: theme.colors.muted, fontSize: 12 }}>最新留言：{lastComments[p.id]?.authorEmail ?? ""}</Text>
                      <Text style={{ color: theme.colors.muted, lineHeight: 18 }}>{lastComments[p.id]?.body}</Text>
                    </View>
                  ) : null}

                  <View style={{ marginTop: 12, flexDirection: "row", gap: 10, flexWrap: "wrap" }}>
                    <Button text="查看 / 留言" kind="primary" onPress={() => nav?.navigate?.("GroupPost", { groupId, postId: p.id })} />
                    <Button text="成員" onPress={() => nav?.navigate?.("GroupMembers", { groupId })} />
                    <Button text="私訊作者" onPress={() => nav?.navigate?.("Chat", { kind: "dm", peerId: p.authorId, refPostId: p.id })} />
                  </View>
                </Card>
              ))}

              {visiblePosts.length === 0 ? <Text style={{ color: theme.colors.muted }}>目前沒有貼文。</Text> : null}
            </View>
          </Card>
        )}
      </ScrollView>
    </Screen>
  );
}
