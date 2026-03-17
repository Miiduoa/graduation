import React, { useMemo, useState } from "react";
import { ScrollView, Text, View, Pressable, Alert, TextInput } from "react-native";
import { collection, getDocs, getDoc, limit, query, serverTimestamp, setDoc, doc, where } from "firebase/firestore";
import { Ionicons } from "@expo/vector-icons";

import { Screen, Card, Button, Pill, LoadingState, ErrorState, SectionTitle, AnimatedCard, StatusBadge, SearchBar, SegmentedControl, Avatar, ProgressRing } from "../ui/components";
import { TAB_BAR_CONTENT_BOTTOM_PADDING } from "../ui/navigationTheme";
import { theme } from "../ui/theme";
import { useSchool } from "../state/school";
import { useAuth } from "../state/auth";
import { getDb } from "../firebase";
import { useAsyncList } from "../hooks/useAsyncList";
import { formatRelativeTime, toDate } from "../utils/format";

type VerificationStatus = "unverified" | "verified_teacher" | "verified_org" | "rejected";

type CourseGroup = {
  id: string;
  schoolId: string;
  type: string;
  name: string;
  description?: string;
  joinCode: string;
  createdBy?: string;
  createdByEmail?: string;
  createdAt?: any;
  memberCount?: number;
  verification?: {
    status?: VerificationStatus;
    verifiedByUid?: string;
    verifiedByEmail?: string;
    verifiedAt?: any;
    note?: string;
    rejectionReason?: string;
  };
};

type UserProfile = {
  uid: string;
  displayName?: string;
  email?: string;
  avatarUrl?: string;
  department?: string;
};

export function AdminCourseVerifyScreen() {
  const { school } = useSchool();
  const auth = useAuth();
  const db = getDb();

  const [err, setErr] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterStatus, setFilterStatus] = useState<"all" | "pending" | "verified" | "rejected">("pending");
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [selectedForBatch, setSelectedForBatch] = useState<string[]>([]);
  const [showBatchMode, setShowBatchMode] = useState(false);

  const { items, loading, error, reload } = useAsyncList<CourseGroup>(
    async () => {
      if (!auth.isAdmin) return [];
      const qy = query(collection(db, "groups"), where("type", "==", "course"), limit(200));
      const snap = await getDocs(qy);
      const rows = snap.docs
        .map((d) => ({ id: d.id, ...(d.data() as any) }))
        .filter((g: any) => g.schoolId === school.id);
      return rows as CourseGroup[];
    },
    [db, auth.isAdmin, school.id]
  );

  // Fetch user profiles for course creators
  const { items: userProfiles } = useAsyncList<UserProfile>(
    async () => {
      const uids = new Set(items.map(g => g.createdBy).filter(Boolean) as string[]);
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
    [db, items.map(g => g.createdBy).join(",")]
  );

  const profilesById = useMemo(() => {
    const map: Record<string, UserProfile> = {};
    for (const p of userProfiles) map[p.uid] = p;
    return map;
  }, [userProfiles]);

  // Calculate stats
  const stats = useMemo(() => {
    const total = items.length;
    const pending = items.filter(g => !g.verification?.status || g.verification.status === "unverified").length;
    const verified = items.filter(g => g.verification?.status === "verified_teacher" || g.verification?.status === "verified_org").length;
    const rejected = items.filter(g => g.verification?.status === "rejected").length;
    return { total, pending, verified, rejected };
  }, [items]);

  // Filtered items
  const filteredItems = useMemo(() => {
    let list = items;

    // Filter by status
    if (filterStatus === "pending") {
      list = list.filter(g => !g.verification?.status || g.verification.status === "unverified");
    } else if (filterStatus === "verified") {
      list = list.filter(g => g.verification?.status === "verified_teacher" || g.verification?.status === "verified_org");
    } else if (filterStatus === "rejected") {
      list = list.filter(g => g.verification?.status === "rejected");
    }

    // Filter by search
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(g => 
        g.name?.toLowerCase().includes(q) ||
        g.joinCode?.toLowerCase().includes(q) ||
        g.createdByEmail?.toLowerCase().includes(q) ||
        profilesById[g.createdBy ?? ""]?.displayName?.toLowerCase().includes(q)
      );
    }

    return list;
  }, [items, filterStatus, searchQuery, profilesById]);

  const verifyTeacher = async (g: CourseGroup, note?: string) => {
    setErr(null);
    setSuccessMsg(null);
    setProcessingId(g.id);
    try {
      if (!auth.user) throw new Error("請先登入");
      await setDoc(
        doc(db, "groups", g.id),
        {
          verification: {
            status: "verified_teacher",
            verifiedByUid: auth.user.uid,
            verifiedByEmail: auth.user.email ?? null,
            verifiedAt: serverTimestamp(),
            note: note ?? null,
          },
        },
        { merge: true }
      );
      reload();
      setSuccessMsg(`「${g.name}」已認證為老師課程`);
    } catch (e: any) {
      setErr(e?.message ?? "認證失敗");
    } finally {
      setProcessingId(null);
    }
  };

  const rejectCourse = async (g: CourseGroup) => {
    Alert.prompt?.(
      "拒絕認證",
      "請輸入拒絕原因（選填）",
      [
        { text: "取消", style: "cancel" },
        {
          text: "確認拒絕",
          style: "destructive",
          onPress: async (reason) => {
            setErr(null);
            setSuccessMsg(null);
            setProcessingId(g.id);
            try {
              if (!auth.user) throw new Error("請先登入");
              await setDoc(
                doc(db, "groups", g.id),
                {
                  verification: {
                    status: "rejected",
                    verifiedByUid: auth.user.uid,
                    verifiedByEmail: auth.user.email ?? null,
                    verifiedAt: serverTimestamp(),
                    rejectionReason: reason || null,
                  },
                },
                { merge: true }
              );
              reload();
              setSuccessMsg(`「${g.name}」已拒絕認證`);
            } catch (e: any) {
              setErr(e?.message ?? "操作失敗");
            } finally {
              setProcessingId(null);
            }
          },
        },
      ],
      "plain-text",
      ""
    ) ?? Alert.alert(
      "拒絕認證",
      `確定要拒絕「${g.name}」的認證申請嗎？`,
      [
        { text: "取消", style: "cancel" },
        {
          text: "確認拒絕",
          style: "destructive",
          onPress: async () => {
            setErr(null);
            setSuccessMsg(null);
            setProcessingId(g.id);
            try {
              if (!auth.user) throw new Error("請先登入");
              await setDoc(
                doc(db, "groups", g.id),
                {
                  verification: {
                    status: "rejected",
                    verifiedByUid: auth.user.uid,
                    verifiedByEmail: auth.user.email ?? null,
                    verifiedAt: serverTimestamp(),
                  },
                },
                { merge: true }
              );
              reload();
              setSuccessMsg(`「${g.name}」已拒絕認證`);
            } catch (e: any) {
              setErr(e?.message ?? "操作失敗");
            } finally {
              setProcessingId(null);
            }
          },
        },
      ]
    );
  };

  // Batch verify
  const handleBatchVerify = async () => {
    if (selectedForBatch.length === 0) {
      Alert.alert("提示", "請先選擇要認證的課程");
      return;
    }
    Alert.alert(
      "批量認證",
      `確定要認證 ${selectedForBatch.length} 個課程嗎？`,
      [
        { text: "取消", style: "cancel" },
        {
          text: "確認認證",
          onPress: async () => {
            setErr(null);
            setSuccessMsg(null);
            try {
              for (const gid of selectedForBatch) {
                await setDoc(
                  doc(db, "groups", gid),
                  {
                    verification: {
                      status: "verified_teacher",
                      verifiedByUid: auth.user!.uid,
                      verifiedByEmail: auth.user!.email ?? null,
                      verifiedAt: serverTimestamp(),
                      note: "批量認證",
                    },
                  },
                  { merge: true }
                );
              }
              setSelectedForBatch([]);
              setShowBatchMode(false);
              reload();
              setSuccessMsg(`已成功認證 ${selectedForBatch.length} 個課程`);
            } catch (e: any) {
              setErr(e?.message ?? "批量認證失敗");
            }
          },
        },
      ]
    );
  };

  const toggleSelection = (gid: string) => {
    setSelectedForBatch(prev => 
      prev.includes(gid) ? prev.filter(id => id !== gid) : [...prev, gid]
    );
  };

  const getStatusLabel = (status?: VerificationStatus) => {
    switch (status) {
      case "verified_teacher": return "老師認證";
      case "verified_org": return "官方認證";
      case "rejected": return "已拒絕";
      default: return "待審核";
    }
  };

  const getStatusColor = (status?: VerificationStatus) => {
    switch (status) {
      case "verified_teacher":
      case "verified_org": return theme.colors.success;
      case "rejected": return theme.colors.danger;
      default: return "#F59E0B";
    }
  };

  if (!auth.isAdmin) {
    return (
      <Screen>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ gap: 12, paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING }}>
          <AnimatedCard>
            <View style={{ alignItems: "center", paddingVertical: 30 }}>
              <View style={{ width: 80, height: 80, borderRadius: 40, backgroundColor: `${theme.colors.danger}20`, alignItems: "center", justifyContent: "center", marginBottom: 16 }}>
                <Ionicons name="shield-outline" size={40} color={theme.colors.danger} />
              </View>
              <Text style={{ color: theme.colors.text, fontWeight: "800", fontSize: 18, marginBottom: 8 }}>管理員專區</Text>
              <Text style={{ color: theme.colors.muted, textAlign: "center", lineHeight: 20 }}>
                此功能僅限管理員帳號使用。{"\n"}若你確定是管理員，請用 admin email 登入後重試。
              </Text>
            </View>
          </AnimatedCard>
        </ScrollView>
      </Screen>
    );
  }

  return (
    <Screen>
      {loading ? (
        <LoadingState title="課程認證" subtitle="載入中..." rows={3} />
      ) : error ? (
        <ErrorState title="課程認證" subtitle="讀取失敗" hint={error} actionText="重試" onAction={reload} />
      ) : (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ gap: 12, paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING }}>
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

          {/* Admin Header */}
          <AnimatedCard title="課程認證管理" subtitle={`${school.name} · ${auth.user?.email ?? ""}`}>
            {/* Stats */}
            <View style={{ flexDirection: "row", gap: 10, marginBottom: 14 }}>
              <View style={{ flex: 1, alignItems: "center", padding: 12, borderRadius: theme.radius.md, backgroundColor: theme.colors.surface2 }}>
                <Text style={{ color: theme.colors.text, fontWeight: "900", fontSize: 24 }}>{stats.total}</Text>
                <Text style={{ color: theme.colors.muted, fontSize: 11 }}>總課程數</Text>
              </View>
              <View style={{ flex: 1, alignItems: "center", padding: 12, borderRadius: theme.radius.md, backgroundColor: `#F59E0B15` }}>
                <Text style={{ color: "#F59E0B", fontWeight: "900", fontSize: 24 }}>{stats.pending}</Text>
                <Text style={{ color: theme.colors.muted, fontSize: 11 }}>待審核</Text>
              </View>
              <View style={{ flex: 1, alignItems: "center", padding: 12, borderRadius: theme.radius.md, backgroundColor: `${theme.colors.success}15` }}>
                <Text style={{ color: theme.colors.success, fontWeight: "900", fontSize: 24 }}>{stats.verified}</Text>
                <Text style={{ color: theme.colors.muted, fontSize: 11 }}>已認證</Text>
              </View>
              <View style={{ flex: 1, alignItems: "center", padding: 12, borderRadius: theme.radius.md, backgroundColor: `${theme.colors.danger}15` }}>
                <Text style={{ color: theme.colors.danger, fontWeight: "900", fontSize: 24 }}>{stats.rejected}</Text>
                <Text style={{ color: theme.colors.muted, fontSize: 11 }}>已拒絕</Text>
              </View>
            </View>

            {/* Actions */}
            <View style={{ flexDirection: "row", gap: 10, flexWrap: "wrap" }}>
              <Button text="重新整理" onPress={reload} />
              <Button 
                text={showBatchMode ? "取消批量" : "批量認證"} 
                kind={showBatchMode ? "secondary" : "primary"}
                onPress={() => { setShowBatchMode(!showBatchMode); setSelectedForBatch([]); }} 
              />
            </View>

            {showBatchMode && selectedForBatch.length > 0 && (
              <View style={{ marginTop: 12 }}>
                <Button 
                  text={`認證已選 (${selectedForBatch.length})`} 
                  kind="primary" 
                  onPress={handleBatchVerify} 
                />
              </View>
            )}
          </AnimatedCard>

          {/* Search & Filter */}
          <AnimatedCard delay={50}>
            <SearchBar
              value={searchQuery}
              onChange={setSearchQuery}
              placeholder="搜尋課程名稱、代碼、建立者..."
            />
            <View style={{ marginTop: 10 }}>
              <SegmentedControl
                options={[
                  { key: "pending", label: `待審核 (${stats.pending})` },
                  { key: "verified", label: `已認證 (${stats.verified})` },
                  { key: "rejected", label: `已拒絕 (${stats.rejected})` },
                  { key: "all", label: `全部 (${stats.total})` },
                ]}
                selected={filterStatus}
                onChange={(k) => setFilterStatus(k as any)}
              />
            </View>
          </AnimatedCard>

          {/* Course List */}
          <AnimatedCard title={`${getStatusLabel(filterStatus === "all" ? undefined : filterStatus === "pending" ? "unverified" : filterStatus === "verified" ? "verified_teacher" : "rejected")}課程`} subtitle={`共 ${filteredItems.length} 個`} delay={100}>
            <View style={{ gap: 12 }}>
              {filteredItems.map((g, idx) => {
                const creator = profilesById[g.createdBy ?? ""];
                const creatorName = creator?.displayName || g.createdByEmail || g.createdBy?.slice(0, 8) || "未知";
                const isProcessing = processingId === g.id;
                const isSelected = selectedForBatch.includes(g.id);
                const isPending = !g.verification?.status || g.verification.status === "unverified";

                return (
                  <AnimatedCard key={g.id} delay={idx * 20}>
                    <Pressable
                      onPress={() => showBatchMode && isPending ? toggleSelection(g.id) : null}
                      style={{
                        padding: 14,
                        borderRadius: theme.radius.lg,
                        borderWidth: 1,
                        borderColor: isSelected ? theme.colors.accent : theme.colors.border,
                        backgroundColor: isSelected ? theme.colors.accentSoft : theme.colors.surface2,
                      }}
                    >
                      {/* Header */}
                      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 12 }}>
                        {showBatchMode && isPending && (
                          <View style={{ 
                            width: 24, height: 24, borderRadius: 12, 
                            borderWidth: 2, 
                            borderColor: isSelected ? theme.colors.accent : theme.colors.border,
                            backgroundColor: isSelected ? theme.colors.accent : "transparent",
                            alignItems: "center", justifyContent: "center",
                          }}>
                            {isSelected && <Ionicons name="checkmark" size={16} color="#fff" />}
                          </View>
                        )}
                        <View style={{ flex: 1 }}>
                          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                            <Text style={{ color: theme.colors.text, fontWeight: "800", fontSize: 16 }}>{g.name}</Text>
                            <View style={{ 
                              paddingHorizontal: 8, paddingVertical: 2, 
                              borderRadius: 8, 
                              backgroundColor: `${getStatusColor(g.verification?.status)}15` 
                            }}>
                              <Text style={{ color: getStatusColor(g.verification?.status), fontSize: 11, fontWeight: "600" }}>
                                {getStatusLabel(g.verification?.status)}
                              </Text>
                            </View>
                          </View>

                          {g.description && (
                            <Text style={{ color: theme.colors.muted, fontSize: 13, marginTop: 4 }} numberOfLines={2}>
                              {g.description}
                            </Text>
                          )}
                        </View>
                      </View>

                      {/* Info */}
                      <View style={{ marginTop: 12, gap: 6 }}>
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                          <Ionicons name="key-outline" size={14} color={theme.colors.muted} />
                          <Text style={{ color: theme.colors.muted, fontSize: 12 }}>加入代碼：</Text>
                          <Text style={{ color: theme.colors.text, fontWeight: "600", fontSize: 12 }}>{g.joinCode}</Text>
                        </View>

                        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                          <Ionicons name="person-outline" size={14} color={theme.colors.muted} />
                          <Text style={{ color: theme.colors.muted, fontSize: 12 }}>建立者：</Text>
                          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                            {creator?.avatarUrl ? (
                              <Avatar name={creatorName} size={20} imageUrl={creator.avatarUrl} />
                            ) : null}
                            <Text style={{ color: theme.colors.text, fontSize: 12 }}>{creatorName}</Text>
                            {creator?.department && (
                              <Text style={{ color: theme.colors.muted, fontSize: 11 }}>({creator.department})</Text>
                            )}
                          </View>
                        </View>

                        {g.createdAt && (
                          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                            <Ionicons name="time-outline" size={14} color={theme.colors.muted} />
                            <Text style={{ color: theme.colors.muted, fontSize: 12 }}>
                              建立於 {formatRelativeTime(toDate(g.createdAt))}
                            </Text>
                          </View>
                        )}

                        {g.memberCount !== undefined && (
                          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                            <Ionicons name="people-outline" size={14} color={theme.colors.muted} />
                            <Text style={{ color: theme.colors.muted, fontSize: 12 }}>{g.memberCount} 位成員</Text>
                          </View>
                        )}
                      </View>

                      {/* Verification Info */}
                      {g.verification?.verifiedAt && (
                        <View style={{ 
                          marginTop: 12, 
                          padding: 10, 
                          borderRadius: theme.radius.sm, 
                          backgroundColor: `${getStatusColor(g.verification.status)}10`,
                          borderLeftWidth: 3,
                          borderLeftColor: getStatusColor(g.verification.status),
                        }}>
                          <Text style={{ color: theme.colors.muted, fontSize: 11 }}>
                            {g.verification.status === "rejected" ? "拒絕" : "認證"}於 {formatRelativeTime(toDate(g.verification.verifiedAt))}
                            {g.verification.verifiedByEmail ? ` · ${g.verification.verifiedByEmail}` : ""}
                          </Text>
                          {g.verification.rejectionReason && (
                            <Text style={{ color: theme.colors.danger, fontSize: 12, marginTop: 4 }}>
                              原因：{g.verification.rejectionReason}
                            </Text>
                          )}
                          {g.verification.note && (
                            <Text style={{ color: theme.colors.muted, fontSize: 12, marginTop: 4 }}>
                              備註：{g.verification.note}
                            </Text>
                          )}
                        </View>
                      )}

                      {/* Actions */}
                      {!showBatchMode && isPending && (
                        <View style={{ marginTop: 14, flexDirection: "row", gap: 10, flexWrap: "wrap" }}>
                          <Button 
                            text={isProcessing ? "處理中..." : "認證為老師課程"} 
                            kind="primary" 
                            disabled={isProcessing}
                            onPress={() => verifyTeacher(g)} 
                          />
                          <Pressable
                            onPress={() => rejectCourse(g)}
                            disabled={isProcessing}
                            style={{
                              paddingVertical: 12,
                              paddingHorizontal: 16,
                              borderRadius: theme.radius.md,
                              borderWidth: 1,
                              borderColor: theme.colors.danger,
                              backgroundColor: `${theme.colors.danger}10`,
                            }}
                          >
                            <Text style={{ color: theme.colors.danger, fontWeight: "600" }}>拒絕</Text>
                          </Pressable>
                        </View>
                      )}

                      {/* Re-verify rejected */}
                      {g.verification?.status === "rejected" && (
                        <View style={{ marginTop: 14 }}>
                          <Button 
                            text={isProcessing ? "處理中..." : "重新認證"} 
                            kind="primary" 
                            disabled={isProcessing}
                            onPress={() => verifyTeacher(g, "重新認證")} 
                          />
                        </View>
                      )}
                    </Pressable>
                  </AnimatedCard>
                );
              })}

              {filteredItems.length === 0 && (
                <View style={{ alignItems: "center", paddingVertical: 30 }}>
                  <Ionicons name="school-outline" size={40} color={theme.colors.muted} />
                  <Text style={{ color: theme.colors.muted, marginTop: 10 }}>
                    {searchQuery ? "找不到符合的課程" : "目前沒有課程"}
                  </Text>
                </View>
              )}
            </View>
          </AnimatedCard>
        </ScrollView>
      )}
    </Screen>
  );
}
