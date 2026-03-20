import React, { useMemo, useState } from "react";
import { ScrollView, Text, TextInput, View, Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Screen, Card, Button, Pill, SectionTitle, LoadingState, ErrorState } from "../ui/components";
import { generateJoinCode, normalizeJoinCode, formatJoinCode, isValidJoinCode } from "../utils/joinCode";
import { TAB_BAR_CONTENT_BOTTOM_PADDING } from "../ui/navigationTheme";
import { theme } from "../ui/theme";
import { useSchool } from "../state/school";
import { useAuth } from "../state/auth";
import { getDb, getFunctionsInstance } from "../firebase";
import {
  collection,
  getDocs,
  limit,
  query,
  where,
  documentId,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { useAsyncList } from "../hooks/useAsyncList";

type Group = {
  id: string;
  schoolId: string;
  type: "course" | "club" | "admin";
  name: string;
  joinCode: string;
  isPublished?: boolean;
  verification?: { status?: "unverified" | "verified_teacher" | "verified_org" };
  createdAt?: any;
  createdBy?: string;
};

type UserGroup = {
  groupId: string;
  schoolId: string;
  type: Group["type"];
  name: string;
  joinCode: string;
  role: "owner" | "moderator" | "member" | "instructor";
  status: "active" | "left";
  joinedAt?: any;
};

// joinCode helpers moved to src/utils/joinCode

const AVATAR_COLORS_G = ["#5E6AD2", "#34C759", "#FF9500", "#007AFF", "#BF5AF2"];
const AVATAR_EMOJIS_G = ["🧑‍💻", "👩‍🎓", "👨‍🎓", "🙋", "👩‍💻"];

function hashCodeG(str: string) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function GroupSocialBadge({ groupId }: { groupId: string }) {
  const seed = hashCodeG(groupId);
  const active = 2 + (seed % 5);
  const avatars = Array.from({ length: Math.min(active, 3) }, (_, i) => ({
    emoji: AVATAR_EMOJIS_G[(seed + i) % AVATAR_EMOJIS_G.length],
    color: AVATAR_COLORS_G[(seed + i) % AVATAR_COLORS_G.length],
  }));
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 8 }}>
      <View style={{ flexDirection: "row" }}>
        {avatars.map((a, i) => (
          <View
            key={i}
            style={{
              width: 20,
              height: 20,
              borderRadius: 10,
              backgroundColor: `${a.color}20`,
              borderWidth: 1.5,
              borderColor: theme.colors.bg,
              alignItems: "center",
              justifyContent: "center",
              marginLeft: i === 0 ? 0 : -4,
            }}
          >
            <Text style={{ fontSize: 9 }}>{a.emoji}</Text>
          </View>
        ))}
      </View>
      <Text style={{ fontSize: 11, color: theme.colors.muted }}>
        {active} 位同學今日活躍
      </Text>
      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: "#34C759" }} />
    </View>
  );
}

export function GroupsScreen(props: any) {
  const nav = props?.navigation;
  const { school } = useSchool();
  const auth = useAuth();

  const [joinCode, setJoinCode] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [isJoining, setIsJoining] = useState(false);
  const [isCreating, setIsCreating] = useState(false);

  const db = getDb();
  const functions = getFunctionsInstance();

  const [newCourseName, setNewCourseName] = useState("");

  const { items: myGroups, loading, error, reload } = useAsyncList<UserGroup>(
    async () => {
      if (!auth.user) return [];
      const ref = collection(db, "users", auth.user.uid, "groups");
      // NOTE: Avoid composite index requirements for MVP by not combining orderBy with multiple where.
      const qy = query(ref, where("schoolId", "==", school.id), where("status", "==", "active"));
      const snap = await getDocs(qy);
      return snap.docs.map((d) => d.data() as any);
    },
    [db, auth.user?.uid, school.id]
  );

  const myCourseGroups = useMemo(() => myGroups.filter((g) => g.type === "course"), [myGroups]);
  const myOtherGroups = useMemo(() => myGroups.filter((g) => g.type !== "course"), [myGroups]);

  const { items: myCourseMeta } = useAsyncList<Group>(
    async () => {
      const ids = myCourseGroups.map((g) => g.groupId).filter(Boolean);
      if (ids.length === 0) return [];

      // Firestore "in" supports up to 10 items; chunk to avoid indexes.
      const out: Group[] = [];
      for (let i = 0; i < ids.length; i += 10) {
        const chunk = ids.slice(i, i + 10);
        const qy = query(collection(db, "groups"), where(documentId(), "in", chunk));
        const snap = await getDocs(qy);
        out.push(...(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as any));
      }
      return out;
    },
    [db, myCourseGroups.map((g) => g.groupId).join(",")]
  );

  const courseMetaById = useMemo(() => {
    const m: Record<string, Group> = {};
    for (const g of myCourseMeta) m[g.id] = g;
    return m;
  }, [myCourseMeta]);

  const { items: publishedCourses, reload: reloadPublishedCourses } = useAsyncList<Group>(
    async () => {
      // NOTE: Avoid composite indexes in MVP: query by isPublished only, then filter by school/type.
      const qy = query(collection(db, "groups"), where("isPublished", "==", true), limit(100));
      const snap = await getDocs(qy);
      return snap.docs
        .map((d) => ({ id: d.id, ...(d.data() as any) }))
        .filter((g: any) => g.schoolId === school.id && g.type === "course") as any;
    },
    [db, school.id]
  );

  const onJoin = async () => {
    setErr(null);
    const code = normalizeJoinCode(joinCode);
    if (code.length !== 8) {
      setErr("加入碼需要 8 碼英數");
      return;
    }
    if (!auth.user) {
      setErr("請先到『我的』登入後再加入群組");
      return;
    }

    setIsJoining(true);
    try {
      const joinGroupByCode = httpsCallable<
        { joinCode: string; schoolId: string },
        { success: boolean; groupId: string; groupName?: string }
      >(functions, "joinGroupByCode");
      const result = await joinGroupByCode({ joinCode: code, schoolId: school.id });

      setJoinCode("");
      reload();
      nav?.navigate?.("GroupDetail", { groupId: result.data.groupId });
    } catch (e: any) {
      setErr(e?.message ?? "加入失敗");
    } finally {
      setIsJoining(false);
    }
  };

  const onLeave = async (groupId: string) => {
    if (!auth.user) return;
    try {
      const leaveGroup = httpsCallable<{ groupId: string }, { success: boolean }>(functions, "leaveGroup");
      await leaveGroup({ groupId });
      reload();
    } catch (e: any) {
      setErr(e?.message ?? "退出失敗");
    }
  };

  const onCreateCourse = async () => {
    setErr(null);
    if (!auth.user) {
      setErr("請先登入");
      return;
    }
    const name = newCourseName.trim();
    if (!name) {
      setErr("請輸入課程名稱");
      return;
    }

    setIsCreating(true);
    try {
      const createGroup = httpsCallable<
        {
          name: string;
          description?: string;
          type: Group["type"];
          schoolId: string;
          isPrivate?: boolean;
          isPublished?: boolean;
          verification?: { status?: "unverified" | "verified_teacher" | "verified_org" };
        },
        { success: boolean; groupId: string; joinCode?: string | null }
      >(functions, "createGroup");
      const result = await createGroup({
        schoolId: school.id,
        name,
        type: "course",
        description: "",
        isPrivate: false,
        isPublished: false,
        verification: { status: "unverified" },
      });

      setNewCourseName("");
      reload();
      reloadPublishedCourses();
      nav?.navigate?.("GroupDetail", { groupId: result.data.groupId });
    } catch (e: any) {
      setErr(e?.message ?? "建立課程失敗");
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <Screen>
      {loading ? (
        <LoadingState title="群組" subtitle="載入中..." rows={3} />
      ) : error ? (
        <ErrorState title="群組" subtitle="讀取群組失敗" hint={error} actionText="重試" onAction={reload} />
      ) : (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ gap: 12, paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING }}>
          <Card title="加入群組" subtitle="輸入加入碼（8 碼英數）。">
            {err ? <Pill text={err} /> : null}

            {auth.isAdmin ? (
              <View style={{ marginBottom: 10 }}>
                <Button text="管理員：課程認證" onPress={() => nav?.navigate?.("AdminCourseVerify")} />
              </View>
            ) : null}

            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
              <Text style={{ color: theme.colors.muted }}>加入碼</Text>
              <Text style={{ color: joinCode.length === 8 ? theme.colors.success : theme.colors.muted, fontSize: 12 }}>
                {joinCode.length}/8
              </Text>
            </View>
            <TextInput
              value={formatJoinCode(joinCode)}
              onChangeText={(t) => setJoinCode(normalizeJoinCode(t))}
              autoCapitalize="characters"
              placeholder="XXXX-XXXX"
              placeholderTextColor="rgba(168,176,194,0.6)"
              maxLength={9}
              style={{
                marginTop: 10,
                paddingVertical: 12,
                paddingHorizontal: 14,
                borderRadius: theme.radius.md,
                borderWidth: 1,
                borderColor: isValidJoinCode(joinCode) ? theme.colors.success : theme.colors.border,
                backgroundColor: theme.colors.surface2,
                color: theme.colors.text,
                letterSpacing: 2,
                fontSize: 16,
                fontWeight: "600",
              }}
            />
            <View style={{ marginTop: 12, flexDirection: "row", gap: 10, flexWrap: "wrap" }}>
              <Button 
                text={isJoining ? "加入中..." : "加入"} 
                kind="primary" 
                onPress={onJoin} 
                disabled={isJoining || !isValidJoinCode(joinCode)}
              />
              <Button text="清除" onPress={() => setJoinCode("")} disabled={isJoining} />
            </View>
            <View style={{ marginTop: 10 }}>
              <Text style={{ color: theme.colors.muted, fontSize: 12 }}>
                提醒：請先到「我的」登入。群組資料目前從 Firestore 讀寫。
              </Text>
            </View>
          </Card>

          {auth.user ? (
            <Card title="建立課程" subtitle="(v1) 建立後會自動產生 8 碼加入碼，預設未發布。">
              {err ? <Pill text={err} /> : null}
              <Text style={{ color: theme.colors.muted }}>課程名稱</Text>
              <TextInput
                value={newCourseName}
                onChangeText={setNewCourseName}
                placeholder="例如 資料庫系統"
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
              <View style={{ marginTop: 12, flexDirection: "row", gap: 10, flexWrap: "wrap" }}>
                <Button 
                  text={isCreating ? "建立中..." : "建立課程"} 
                  kind="primary" 
                  onPress={onCreateCourse}
                  disabled={isCreating || !newCourseName.trim()}
                />
              </View>
              <Text style={{ color: theme.colors.muted, fontSize: 12, lineHeight: 18 }}>
                提醒：發布/重設加入碼等教師管理功能，請進入課程後在「課程管理」調整。
              </Text>
            </Card>
          ) : null}

          <Card title="我加入的課程" subtitle="課程會顯示老師認證/未驗證標示。">
            <SectionTitle text={`數量：${myCourseGroups.length}`} />
            <View style={{ marginTop: 10, gap: 10 }}>
              {myCourseGroups.map((g) => {
                const meta = courseMetaById[g.groupId];
                const v = meta?.verification?.status ?? "unverified";
                return (
                  <Pressable
                    key={g.groupId}
                    onPress={() => nav?.navigate?.("GroupDetail", { groupId: g.groupId })}
                    style={{ borderRadius: theme.radius.lg }}
                    accessible
                    accessibilityRole="button"
                    accessibilityLabel={`進入課程：${g.name}`}
                  >
                    <Card title={g.name} subtitle={`course｜${g.joinCode}`}>
                      <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
                        <Pill text={v === "verified_teacher" ? "老師認證" : "未驗證"} kind={v === "verified_teacher" ? "accent" : "default"} />
                        <Pill text={meta?.isPublished ? "已發布" : "未發布"} />
                      </View>
                      <GroupSocialBadge groupId={g.groupId} />
                      <View style={{ marginTop: 12 }}>
                        <Button text="退出課程" onPress={() => onLeave(g.groupId)} />
                      </View>
                    </Card>
                  </Pressable>
                );
              })}
              {myCourseGroups.length === 0 ? <Text style={{ color: theme.colors.muted }}>你目前尚未加入任何課程。</Text> : null}
            </View>
          </Card>

          <Card title="其他群組" subtitle="社團 / 其他用途群組。">
            <SectionTitle text={`數量：${myOtherGroups.length}`} />
            <View style={{ marginTop: 10, gap: 10 }}>
              {myOtherGroups.map((g) => (
                <Pressable
                  key={g.groupId}
                  onPress={() => nav?.navigate?.("GroupDetail", { groupId: g.groupId })}
                  style={{ borderRadius: theme.radius.lg }}
                  accessible
                  accessibilityRole="button"
                  accessibilityLabel={`進入群組：${g.name}`}
                >
                  <Card title={g.name} subtitle={`${g.type}｜${g.joinCode}`}>
                    <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
                      <Pill text="公告" kind="accent" />
                      <Pill text="Q&A" kind="accent" />
                      <Pressable onPress={() => nav?.navigate?.("收件匣", { screen: "Dms" })}>
                        <Pill text="私訊" kind="accent" />
                      </Pressable>
                    </View>
                    <View style={{ marginTop: 12 }}>
                      <Button text="退出群組" onPress={() => onLeave(g.groupId)} />
                    </View>
                  </Card>
                </Pressable>
              ))}

              {myOtherGroups.length === 0 ? <Text style={{ color: theme.colors.muted }}>你目前尚未加入其他群組。</Text> : null}
            </View>
          </Card>

          <Card title="公開課程（可瀏覽）" subtitle="只顯示已發布課程；加入仍需 8 碼加入碼。">
            <SectionTitle text={`數量：${publishedCourses.length}`} />
            <View style={{ marginTop: 10, gap: 10 }}>
              {publishedCourses.map((g) => (
                <Card key={g.id} title={g.name} subtitle={`course｜${g.id}`}>
                  <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
                    <Pill
                      text={(g.verification?.status ?? "unverified") === "verified_teacher" ? "老師認證" : "未驗證"}
                      kind={(g.verification?.status ?? "unverified") === "verified_teacher" ? "accent" : "default"}
                    />
                    <Pill text="已發布" />
                  </View>
                  <Text style={{ color: theme.colors.muted, fontSize: 12, lineHeight: 18, marginTop: 10 }}>
                    加入方式：請向老師索取加入碼後，在上方輸入加入。
                  </Text>
                </Card>
              ))}
              {publishedCourses.length === 0 ? <Text style={{ color: theme.colors.muted }}>目前沒有公開課程。</Text> : null}
            </View>
          </Card>
        </ScrollView>
      )}
    </Screen>
  );
}
