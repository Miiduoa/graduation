/* eslint-disable */
import React, { useMemo, useState } from "react";
import { ScrollView, Text, View, Pressable, Alert, TextInput } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Screen, Card, Button, Pill, LoadingState, ErrorState, SectionTitle, AnimatedCard, SearchBar, Avatar, SegmentedControl } from "../ui/components";
import { TAB_BAR_CONTENT_BOTTOM_PADDING } from "../ui/navigationTheme";
import { theme } from "../ui/theme";
import { useAuth } from "../state/auth";
import { useSchool } from "../state/school";
import { getDb } from "../firebase";
import { collection, doc, getDoc, getDocs, query, where, setDoc, deleteDoc, serverTimestamp } from "firebase/firestore";
import { useAsyncList } from "../hooks/useAsyncList";
import { fetchSchoolDirectoryProfiles } from "../services/memberDirectory";

type MemberRole = "owner" | "instructor" | "moderator" | "member";

type Member = {
  uid: string;
  role?: MemberRole;
  status?: string;
  joinedAt?: any;
};

type UserProfile = {
  uid: string;
  displayName?: string | null;
  department?: string | null;
  avatarUrl?: string | null;
};

type Group = {
  id: string;
  type: "course" | "club" | "admin";
  name: string;
  createdBy?: string;
};

function getRoleLabel(role?: string): string {
  switch (role) {
    case "owner":
      return "擁有者";
    case "instructor":
      return "教師";
    case "moderator":
      return "管理員";
    case "member":
    default:
      return "成員";
  }
}

function getRoleIcon(role?: string): string {
  switch (role) {
    case "owner":
      return "star";
    case "instructor":
      return "school";
    case "moderator":
      return "shield-checkmark";
    case "member":
    default:
      return "person";
  }
}

export function GroupMembersScreen(props: any) {
  const nav = props?.navigation;
  const groupId: string | undefined = props?.route?.params?.groupId;
  const auth = useAuth();
  const { school } = useSchool();
  const db = getDb();

  const [searchQuery, setSearchQuery] = useState("");
  const [selectedFilter, setSelectedFilter] = useState<"all" | "instructors" | "members">("all");
  const [managingMember, setManagingMember] = useState<string | null>(null);

  const { items: groupMeta, reload: reloadGroup } = useAsyncList<Group>(
    async () => {
      if (!groupId) return [];
      const snap = await getDoc(doc(db, "groups", groupId));
      if (!snap.exists()) return [];
      return [{ id: snap.id, ...(snap.data() as any) }];
    },
    [db, groupId]
  );

  const group = groupMeta[0];

  const { items, loading, error, reload } = useAsyncList<Member>(
    async () => {
      if (!groupId) return [];
      const ref = collection(db, "groups", groupId, "members");
      const qy = query(ref, where("status", "==", "active"));
      const snap = await getDocs(qy);
      return snap.docs.map((d) => ({ uid: d.id, ...(d.data() as any) }));
    },
    [db, groupId]
  );

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
  const canManageMembers = myRole === "owner" || myRole === "instructor" || myRole === "moderator";

  const { items: userProfiles } = useAsyncList<UserProfile>(
    async () => {
      if (items.length === 0) return [];
      return fetchSchoolDirectoryProfiles(
        school.id,
        items.map((member) => member.uid),
        db,
      );
    },
    [db, school.id, items.map((m) => m.uid).join(",")]
  );

  const profilesById = useMemo(() => {
    const map: Record<string, UserProfile> = {};
    for (const p of userProfiles) {
      map[p.uid] = p;
    }
    return map;
  }, [userProfiles]);

  const rows = useMemo(() => {
    let list = [...items];
    const roleOrder: Record<string, number> = { owner: 0, instructor: 1, moderator: 2, member: 3 };
    
    if (selectedFilter === "instructors") {
      list = list.filter((m) => m.role === "owner" || m.role === "instructor" || m.role === "moderator");
    } else if (selectedFilter === "members") {
      list = list.filter((m) => m.role === "member" || !m.role);
    }
    
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter((m) => {
        const profile = profilesById[m.uid];
        const searchStr = `${profile?.displayName ?? ""} ${profile?.department ?? ""} ${m.uid}`.toLowerCase();
        return searchStr.includes(q);
      });
    }
    
    list.sort((a, b) => {
      if (a.uid === auth.user?.uid) return -1;
      if (b.uid === auth.user?.uid) return 1;
      const roleA = roleOrder[a.role ?? "member"] ?? 3;
      const roleB = roleOrder[b.role ?? "member"] ?? 3;
      if (roleA !== roleB) return roleA - roleB;
      return a.uid.localeCompare(b.uid);
    });
    return list;
  }, [items, auth.user?.uid, searchQuery, selectedFilter, profilesById]);

  const memberCount = items.length;
  const instructorCount = items.filter((m) => m.role === "owner" || m.role === "instructor").length;

  const handleChangeRole = async (uid: string, newRole: MemberRole) => {
    if (!groupId || !auth.user || !canManageMembers) return;
    
    const member = items.find((m) => m.uid === uid);
    if (member?.role === "owner" && newRole !== "owner") {
      Alert.alert("無法更改", "無法降級群組擁有者的權限");
      return;
    }
    
    if (newRole === "owner" && myRole !== "owner") {
      Alert.alert("無法更改", "只有擁有者可以轉讓擁有權");
      return;
    }

    Alert.alert(
      "確認更改角色",
      `確定要將此成員的角色更改為「${getRoleLabel(newRole)}」嗎？`,
      [
        { text: "取消", style: "cancel" },
        {
          text: "確認",
          onPress: async () => {
            try {
              await setDoc(
                doc(db, "groups", groupId, "members", uid),
                { role: newRole, updatedAt: serverTimestamp() },
                { merge: true }
              );
              
              await setDoc(
                doc(db, "users", uid, "groups", groupId),
                { role: newRole },
                { merge: true }
              );
              
              reload();
              setManagingMember(null);
              Alert.alert("成功", "已更新成員角色");
            } catch (e: any) {
              Alert.alert("錯誤", e?.message ?? "更新角色失敗");
            }
          },
        },
      ]
    );
  };

  const handleRemoveMember = async (uid: string) => {
    if (!groupId || !auth.user || !canManageMembers) return;
    
    const member = items.find((m) => m.uid === uid);
    if (member?.role === "owner") {
      Alert.alert("無法移除", "無法移除群組擁有者");
      return;
    }

    const profile = profilesById[uid];
    const displayName = profile?.displayName || uid.slice(0, 8);

    Alert.alert(
      "確認移除成員",
      `確定要將「${displayName}」從群組中移除嗎？`,
      [
        { text: "取消", style: "cancel" },
        {
          text: "移除",
          style: "destructive",
          onPress: async () => {
            try {
              await deleteDoc(doc(db, "groups", groupId, "members", uid));
              await deleteDoc(doc(db, "users", uid, "groups", groupId));
              reload();
              setManagingMember(null);
              Alert.alert("成功", "已移除成員");
            } catch (e: any) {
              Alert.alert("錯誤", e?.message ?? "移除成員失敗");
            }
          },
        },
      ]
    );
  };

  return (
    <Screen>
      {loading ? (
        <LoadingState title="成員" subtitle="載入中..." rows={4} />
      ) : error ? (
        <ErrorState title="成員" subtitle="讀取成員失敗" hint={error} actionText="重試" onAction={reload} />
      ) : (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ gap: 12, paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING }}>
          <AnimatedCard title={group?.name ?? "群組成員"} subtitle={`共 ${memberCount} 人${instructorCount > 0 ? ` · 教師 ${instructorCount} 人` : ""}`}>
            <View style={{ flexDirection: "row", gap: 12 }}>
              <View style={{ flex: 1, alignItems: "center", padding: 12, borderRadius: theme.radius.md, backgroundColor: theme.colors.accentSoft }}>
                <Text style={{ color: theme.colors.accent, fontWeight: "900", fontSize: 24 }}>{memberCount}</Text>
                <Text style={{ color: theme.colors.muted, fontSize: 12, marginTop: 4 }}>總人數</Text>
              </View>
              <View style={{ flex: 1, alignItems: "center", padding: 12, borderRadius: theme.radius.md, backgroundColor: `${theme.colors.success}15` }}>
                <Text style={{ color: theme.colors.success, fontWeight: "900", fontSize: 24 }}>{instructorCount}</Text>
                <Text style={{ color: theme.colors.muted, fontSize: 12, marginTop: 4 }}>教師/管理員</Text>
              </View>
              <View style={{ flex: 1, alignItems: "center", padding: 12, borderRadius: theme.radius.md, backgroundColor: theme.colors.surface2 }}>
                <Text style={{ color: theme.colors.text, fontWeight: "900", fontSize: 24 }}>{memberCount - instructorCount}</Text>
                <Text style={{ color: theme.colors.muted, fontSize: 12, marginTop: 4 }}>一般成員</Text>
              </View>
            </View>
            
            {canManageMembers && (
              <View style={{ marginTop: 12, padding: 10, borderRadius: theme.radius.md, backgroundColor: theme.colors.accentSoft }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <Ionicons name="shield-checkmark" size={16} color={theme.colors.accent} />
                  <Text style={{ color: theme.colors.accent, fontWeight: "600", fontSize: 13 }}>
                    你擁有管理成員的權限
                  </Text>
                </View>
              </View>
            )}
          </AnimatedCard>

          <SearchBar
            value={searchQuery}
            onChange={setSearchQuery}
            placeholder="搜尋成員（姓名、系所、UID）"
          />

          <SegmentedControl
            options={[
              { key: "all", label: `全部 (${items.length})` },
              { key: "instructors", label: `教師 (${instructorCount})` },
              { key: "members", label: `成員 (${items.length - instructorCount})` },
            ]}
            selected={selectedFilter}
            onChange={(k) => setSelectedFilter(k as any)}
          />

          {rows.map((m, idx) => {
            const isMe = m.uid === auth.user?.uid;
            const profile = profilesById[m.uid];
            const displayName = profile?.displayName || `${m.uid.slice(0, 8)}…`;
            const subtitle = [profile?.department, m.uid.slice(0, 8)].filter(Boolean).join("｜");
            const isManaging = managingMember === m.uid;

            return (
              <AnimatedCard key={m.uid} delay={idx * 30}>
                <Pressable
                  onPress={() => {
                    if (!auth.user) return;
                    if (canManageMembers && !isMe) {
                      setManagingMember(isManaging ? null : m.uid);
                    } else if (!isMe) {
                      nav?.navigate?.("Chat", { kind: "dm", peerId: m.uid });
                    }
                  }}
                  style={{
                    padding: 14,
                    borderRadius: theme.radius.lg,
                    borderWidth: 1,
                    borderColor: isMe ? "rgba(124,92,255,0.45)" : isManaging ? theme.colors.accent : theme.colors.border,
                    backgroundColor: isMe ? theme.colors.accentSoft : theme.colors.surface,
                  }}
                >
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                    <View style={{ position: "relative" }}>
                      {profile?.avatarUrl ? (
                        <Avatar name={displayName} size={48} imageUrl={profile.avatarUrl} />
                      ) : (
                        <View
                          style={{
                            width: 48,
                            height: 48,
                            borderRadius: 24,
                            backgroundColor: theme.colors.surface2,
                            alignItems: "center",
                            justifyContent: "center",
                          }}
                        >
                          <Text style={{ color: theme.colors.accent, fontWeight: "700", fontSize: 18 }}>
                            {displayName[0]?.toUpperCase() ?? "?"}
                          </Text>
                        </View>
                      )}
                      {(m.role === "owner" || m.role === "instructor") && (
                        <View
                          style={{
                            position: "absolute",
                            bottom: -2,
                            right: -2,
                            width: 20,
                            height: 20,
                            borderRadius: 10,
                            backgroundColor: m.role === "owner" ? "#F59E0B" : theme.colors.accent,
                            alignItems: "center",
                            justifyContent: "center",
                            borderWidth: 2,
                            borderColor: theme.colors.bg,
                          }}
                        >
                          <Ionicons
                            name={m.role === "owner" ? "star" : "school"}
                            size={10}
                            color="#fff"
                          />
                        </View>
                      )}
                    </View>
                    <View style={{ flex: 1 }}>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                        <Text style={{ color: theme.colors.text, fontWeight: "800", fontSize: 16 }}>
                          {displayName}
                        </Text>
                        {isMe && <Pill text="我" kind="accent" />}
                        <Pill 
                          text={getRoleLabel(m.role)} 
                          kind={(m.role === "owner" || m.role === "instructor") ? "accent" : "default"} 
                        />
                      </View>
                      {subtitle && <Text style={{ color: theme.colors.muted, marginTop: 4 }}>{subtitle}</Text>}
                    </View>
                    <Ionicons 
                      name={isManaging ? "chevron-up" : "chevron-forward"} 
                      size={20} 
                      color={theme.colors.muted} 
                    />
                  </View>

                  {isManaging && canManageMembers && !isMe && (
                    <View style={{ marginTop: 14, paddingTop: 14, borderTopWidth: 1, borderTopColor: theme.colors.border }}>
                      <Text style={{ color: theme.colors.muted, fontWeight: "600", marginBottom: 10 }}>
                        管理成員
                      </Text>
                      
                      <View style={{ gap: 8 }}>
                        <Text style={{ color: theme.colors.muted, fontSize: 12 }}>更改角色：</Text>
                        <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
                          {(["member", "moderator", "instructor"] as MemberRole[]).map((role) => (
                            <Pressable
                              key={role}
                              onPress={() => handleChangeRole(m.uid, role)}
                              style={{
                                paddingHorizontal: 14,
                                paddingVertical: 8,
                                borderRadius: theme.radius.md,
                                borderWidth: 1,
                                borderColor: m.role === role ? theme.colors.accent : theme.colors.border,
                                backgroundColor: m.role === role ? theme.colors.accentSoft : theme.colors.surface2,
                              }}
                            >
                              <Text style={{ 
                                color: m.role === role ? theme.colors.accent : theme.colors.text, 
                                fontWeight: "600",
                                fontSize: 13,
                              }}>
                                {getRoleLabel(role)}
                              </Text>
                            </Pressable>
                          ))}
                        </View>
                      </View>

                      <View style={{ marginTop: 14, flexDirection: "row", gap: 10, flexWrap: "wrap" }}>
                        <Button
                          text="私訊"
                          kind="primary"
                          onPress={() => nav?.navigate?.("Chat", { kind: "dm", peerId: m.uid })}
                        />
                        {m.role !== "owner" && (
                          <Pressable
                            onPress={() => handleRemoveMember(m.uid)}
                            style={{
                              paddingVertical: 14,
                              paddingHorizontal: 20,
                              borderRadius: theme.radius.md,
                              borderWidth: 1,
                              borderColor: theme.colors.danger,
                              backgroundColor: `${theme.colors.danger}10`,
                            }}
                          >
                            <Text style={{ color: theme.colors.danger, fontWeight: "700" }}>移除成員</Text>
                          </Pressable>
                        )}
                      </View>
                    </View>
                  )}

                  {!isManaging && !isMe && auth.user && !canManageMembers && (
                    <View style={{ marginTop: 12, flexDirection: "row", gap: 10, flexWrap: "wrap" }}>
                      <Button
                        text="私訊"
                        kind="primary"
                        onPress={() => nav?.navigate?.("Chat", { kind: "dm", peerId: m.uid })}
                      />
                    </View>
                  )}
                </Pressable>
              </AnimatedCard>
            );
          })}

          {rows.length === 0 && (
            <View style={{ alignItems: "center", paddingVertical: 40 }}>
              <Ionicons name="people-outline" size={48} color={theme.colors.muted} />
              <Text style={{ color: theme.colors.muted, marginTop: 12, textAlign: "center" }}>
                {searchQuery ? "找不到符合的成員" : "目前沒有成員"}
              </Text>
            </View>
          )}
        </ScrollView>
      )}
    </Screen>
  );
}
