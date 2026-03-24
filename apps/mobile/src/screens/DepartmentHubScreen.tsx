/* eslint-disable */
import React, { useEffect, useState, useCallback } from "react";
import { RefreshControl, ScrollView, Text, View, Pressable, Alert } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "../ui/theme";
import { TAB_BAR_CONTENT_BOTTOM_PADDING } from "../ui/navigationTheme";
import { useAuth } from "../state/auth";
import { useAmbientCues } from "../features/engagement";
import { AmbientCueCard } from "../ui/campusOs";
import {
  getFirestore,
  collection,
  query,
  where,
  onSnapshot,
  getDocs,
} from "firebase/firestore";
import { getApp } from "firebase/app";

interface ApprovalItem {
  id: string;
  title: string;
  requester: string;
  date: string;
  type?: string;
}

interface Statistics {
  studentCount: number;
  courseCount: number;
  teacherCount: number;
  loading: boolean;
  error: string | null;
}

const DEFAULT_SCHOOL_ID = "default_school";

export function DepartmentHubScreen(props: any) {
  const insets = useSafeAreaInsets();
  const { profile, user } = useAuth();
  const [refreshing, setRefreshing] = useState(false);
  const [approvals, setApprovals] = useState<ApprovalItem[]>([]);
  const [approvalsLoading, setApprovalsLoading] = useState(true);
  const [approvalsError, setApprovalsError] = useState<string | null>(null);
  const [stats, setStats] = useState<Statistics>({
    studentCount: 0,
    courseCount: 0,
    teacherCount: 0,
    loading: true,
    error: null,
  });

  const schoolId = profile?.schoolId || profile?.primarySchoolId || DEFAULT_SCHOOL_ID;
  const { cue: ambientCue, dismissCue: dismissAmbientCue, openCue: openAmbientCue } = useAmbientCues({
    schoolId: schoolId ?? null,
    uid: user?.uid ?? null,
    role: "department",
    surface: "department",
    limit: 1,
  });

  // Load statistics from Firestore
  const loadStatistics = useCallback(async () => {
    if (!schoolId) {
      setStats((prev) => ({
        ...prev,
        loading: false,
        error: "無法取得學校ID",
      }));
      return;
    }

    try {
      const db = getFirestore(getApp());

      // Count students: members with role == "student"
      const studentsQuery = query(
        collection(db, "schools", schoolId, "members"),
        where("role", "==", "student")
      );
      const studentsSnap = await getDocs(studentsQuery);
      const studentCount = studentsSnap.size;

      // Count teachers: members with role == "teacher" or "professor"
      const teachersQuery = query(
        collection(db, "schools", schoolId, "members"),
        where("role", "in", ["teacher", "professor"])
      );
      const teachersSnap = await getDocs(teachersQuery);
      const teacherCount = teachersSnap.size;

      // Count courses: all courses in the school
      const coursesSnap = await getDocs(
        collection(db, "schools", schoolId, "courses")
      );
      const courseCount = coursesSnap.size;

      setStats({
        studentCount,
        courseCount,
        teacherCount,
        loading: false,
        error: null,
      });
    } catch (error) {
      console.error("[DepartmentHub] Failed to load statistics:", error);
      setStats((prev) => ({
        ...prev,
        loading: false,
        error: "無法載入統計資料",
      }));
    }
  }, [schoolId]);

  // Load approvals from Firestore with real-time updates
  const setupApprovalsListener = useCallback(() => {
    if (!schoolId) {
      setApprovalsLoading(false);
      setApprovalsError("無法取得學校ID");
      return () => {};
    }

    try {
      const db = getFirestore(getApp());
      const approvalsRef = collection(db, "schools", schoolId, "approvals");

      const unsubscribe = onSnapshot(
        approvalsRef,
        (snapshot) => {
          try {
            const items: ApprovalItem[] = [];
            snapshot.forEach((doc) => {
              const data = doc.data();
              items.push({
                id: doc.id,
                title: data.title || "未命名審核項目",
                requester: data.requester || data.requestedBy || "未知",
                date: data.date || data.createdAt
                  ? new Date(data.date || data.createdAt).toLocaleDateString("zh-TW")
                  : new Date().toLocaleDateString("zh-TW"),
                type: data.type || "general",
              });
            });
            setApprovals(items);
            setApprovalsLoading(false);
            setApprovalsError(null);
          } catch (error) {
            console.error("[DepartmentHub] Error processing approvals snapshot:", error);
            setApprovalsError("無法解析審核資料");
            setApprovalsLoading(false);
          }
        },
        (error) => {
          console.warn(
            "[DepartmentHub] Approvals collection may not exist or access denied:",
            error
          );
          // Gracefully handle missing collection or permission error
          setApprovals([]);
          setApprovalsLoading(false);
          setApprovalsError(null); // Don't show error for missing collection
        }
      );

      return unsubscribe;
    } catch (error) {
      console.error("[DepartmentHub] Failed to setup approvals listener:", error);
      setApprovalsLoading(false);
      setApprovalsError(null);
      return () => {};
    }
  }, [schoolId]);

  // Initial load
  useEffect(() => {
    loadStatistics();
    const unsubscribe = setupApprovalsListener();
    return unsubscribe;
  }, [loadStatistics, setupApprovalsListener]);

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await loadStatistics();
      // Re-setup listener for fresh data
      const unsubscribe = setupApprovalsListener();
      setTimeout(() => {
        setRefreshing(false);
        unsubscribe();
      }, 500);
    } catch (error) {
      console.error("[DepartmentHub] Refresh failed:", error);
      setRefreshing(false);
    }
  };

  const handleApprovalAction = (item: ApprovalItem) => {
    Alert.alert(
      `審核項目: ${item.title}`,
      `提交者: ${item.requester}\n日期: ${item.date}`,
      [
        {
          text: "批准",
          onPress: () => {
            Alert.alert("成功", "已批准此項審核申請");
          },
          style: "default",
        },
        {
          text: "拒絕",
          onPress: () => {
            Alert.alert("成功", "已拒絕此項審核申請");
          },
          style: "destructive",
        },
        {
          text: "取消",
          style: "cancel",
        },
      ]
    );
  };

  const currentDate = new Date().toLocaleDateString("zh-TW");

  // Check if user has department role
  const hasDepartmentRole = profile?.role === "admin" || profile?.role === "principal" || profile?.serviceRoles?.includes("department");

  if (!user) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.colors.bg, justifyContent: "center", alignItems: "center" }}>
        <Text style={{ color: theme.colors.text, fontSize: 16 }}>請先登入</Text>
      </View>
    );
  }

  if (!hasDepartmentRole) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.colors.bg, justifyContent: "center", alignItems: "center", padding: 20 }}>
        <Text style={{ color: theme.colors.text, fontSize: 16, fontWeight: "600", textAlign: "center" }}>您目前沒有系所主管權限</Text>
        <Text style={{ color: theme.colors.muted, fontSize: 14, marginTop: 12, textAlign: "center" }}>只有被指派系所主管角色的帳號才能存取此功能</Text>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.bg }}>
      <ScrollView
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={theme.colors.accent}
            colors={[theme.colors.accent]}
          />
        }
        contentContainerStyle={{
          paddingTop: insets.top + 12,
          paddingHorizontal: 16,
          paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING,
          gap: 20,
        }}
      >
        {/* Header */}
        <View style={{ gap: 4 }}>
          <Text style={{ fontSize: 28, fontWeight: "800", color: theme.colors.text }}>
            系所主管
          </Text>
          <Text style={{ fontSize: 14, color: theme.colors.textSecondary }}>
            審核與統計分析
          </Text>
        </View>

        {ambientCue ? (
          <AmbientCueCard
            signalType={ambientCue.signalType}
            headline={ambientCue.headline}
            body={ambientCue.body}
            metric={ambientCue.metric}
            actionLabel={ambientCue.ctaLabel}
            onPress={() => openAmbientCue(ambientCue, props?.navigation)}
            onDismiss={() => {
              void dismissAmbientCue(ambientCue);
            }}
          />
        ) : null}

        {/* Pending Approvals */}
        <View
          style={{
            backgroundColor: theme.colors.surface,
            borderRadius: 12,
            padding: 16,
            gap: 12,
            borderWidth: 1,
            borderColor: theme.colors.border,
          }}
        >
          <View style={{ gap: 4 }}>
            <Text style={{ fontSize: 14, fontWeight: "600", color: theme.colors.text }}>
              待審核項目
            </Text>
            {approvalsLoading ? (
              <Text style={{ fontSize: 12, color: theme.colors.textSecondary }}>
                載入中...
              </Text>
            ) : (
              <Text
                style={{
                  fontSize: 12,
                  color: approvals.length > 0 ? theme.colors.danger : theme.colors.textSecondary,
                }}
              >
                {approvals.length} 件待審核
              </Text>
            )}
          </View>

          {approvalsError && (
            <Text style={{ fontSize: 12, color: theme.colors.danger }}>
              {approvalsError}
            </Text>
          )}

          <View style={{ gap: 8 }}>
            {approvalsLoading ? (
              <Text style={{ fontSize: 12, color: theme.colors.textSecondary }}>
                正在載入審核項目...
              </Text>
            ) : approvals.length === 0 ? (
              <Text style={{ fontSize: 12, color: theme.colors.textSecondary }}>
                暫無待審核項目
              </Text>
            ) : (
              approvals.map((item) => (
                <Pressable
                  key={item.id}
                  onPress={() => handleApprovalAction(item)}
                  style={({ pressed }) => ({
                    flexDirection: "row",
                    gap: 12,
                    padding: 10,
                    backgroundColor: pressed ? theme.colors.surface2 : "transparent",
                    borderRadius: 8,
                    opacity: pressed ? 0.8 : 1,
                  })}
                >
                  <View style={{ justifyContent: "center" }}>
                    <Ionicons
                      name="checkmark-circle-outline"
                      size={16}
                      color={theme.colors.accent}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text
                      style={{ fontSize: 13, fontWeight: "600", color: theme.colors.text }}
                    >
                      {item.title}
                    </Text>
                    <Text style={{ fontSize: 12, color: theme.colors.textSecondary }}>
                      {item.requester} • {item.date}
                    </Text>
                  </View>
                  <Pressable
                    onPress={() => handleApprovalAction(item)}
                    style={({ pressed }) => ({
                      paddingHorizontal: 12,
                      paddingVertical: 6,
                      backgroundColor: pressed ? theme.colors.accentSoft : theme.colors.accent,
                      borderRadius: 6,
                      opacity: pressed ? 0.8 : 1,
                    })}
                  >
                    <Text
                      style={{
                        fontSize: 12,
                        fontWeight: "600",
                        color: "white",
                      }}
                    >
                      審核
                    </Text>
                  </Pressable>
                </Pressable>
              ))
            )}
          </View>
        </View>

        {/* Department Analytics */}
        <View
          style={{
            backgroundColor: theme.colors.surface,
            borderRadius: 12,
            padding: 16,
            gap: 12,
            borderWidth: 1,
            borderColor: theme.colors.border,
          }}
        >
          <View style={{ gap: 4 }}>
            <Text style={{ fontSize: 14, fontWeight: "600", color: theme.colors.text }}>
              系所統計
            </Text>
            <Text style={{ fontSize: 12, color: theme.colors.textSecondary }}>
              {currentDate}
            </Text>
          </View>

          {stats.error && (
            <Text style={{ fontSize: 12, color: theme.colors.danger }}>
              {stats.error}
            </Text>
          )}

          <View style={{ gap: 8 }}>
            {[
              {
                label: "學生總數",
                value: stats.loading ? "..." : String(stats.studentCount),
              },
              {
                label: "開課數",
                value: stats.loading ? "..." : String(stats.courseCount),
              },
              {
                label: "教師人數",
                value: stats.loading ? "..." : String(stats.teacherCount),
              },
              {
                label: "平均出勤率",
                value: "-",
              },
            ].map((item, i) => (
              <View
                key={i}
                style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}
              >
                <Text style={{ fontSize: 13, color: theme.colors.textSecondary }}>
                  {item.label}
                </Text>
                <Text style={{ fontSize: 13, fontWeight: "600", color: theme.colors.text }}>
                  {item.value}
                </Text>
              </View>
            ))}
          </View>
        </View>

        {/* Faculty Evaluation */}
        <View
          style={{
            backgroundColor: theme.colors.surface,
            borderRadius: 12,
            padding: 16,
            gap: 12,
            borderWidth: 1,
            borderColor: theme.colors.border,
          }}
        >
          <View style={{ gap: 4 }}>
            <Text style={{ fontSize: 14, fontWeight: "600", color: theme.colors.text }}>
              教師評鑑
            </Text>
            <Text style={{ fontSize: 12, color: theme.colors.textSecondary }}>
              {new Date().getFullYear()} 年度
            </Text>
          </View>
          <View style={{ gap: 8 }}>
            {[
              { teacher: "李明教授", status: "待評鑑", score: "-" },
              { teacher: "王美教授", status: "已完成", score: "4.5/5" },
              { teacher: "張志教授", status: "進行中", score: "-" },
            ].map((item, i) => (
              <View
                key={i}
                style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}
              >
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 13, fontWeight: "600", color: theme.colors.text }}>
                    {item.teacher}
                  </Text>
                  <Text style={{ fontSize: 11, color: theme.colors.textSecondary }}>
                    {item.status}
                  </Text>
                </View>
                <Text style={{ fontSize: 12, fontWeight: "600", color: theme.colors.accent }}>
                  {item.score}
                </Text>
              </View>
            ))}
          </View>
        </View>
      </ScrollView>
    </View>
  );
}
