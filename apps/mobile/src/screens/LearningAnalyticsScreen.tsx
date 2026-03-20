import React, { useEffect, useState, useMemo } from "react";
import {
  ScrollView,
  Text,
  View,
  Pressable,
  RefreshControl,
  TextInput,
  Alert,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { buildUserSchoolCollectionPath } from "@campus/shared/src";
import { Screen, Card, AnimatedCard, Button, Pill, LoadingState, ProgressRing } from "../ui/components";
import { TAB_BAR_CONTENT_BOTTOM_PADDING } from "../ui/navigationTheme";
import { theme, softShadowStyle } from "../ui/theme";
import { useAuth } from "../state/auth";
import { useSchool } from "../state/school";
import { useSchedule } from "../state/schedule";
import { getDb } from "../firebase";
import {
  collection,
  getDocs,
  getDoc,
  query,
  orderBy,
  limit,
  collectionGroup,
  where,
  doc,
  setDoc,
  serverTimestamp,
} from "firebase/firestore";
import { collectionFromSegments } from "../data/firestorePath";

type SubmissionRecord = {
  id: string;
  groupId: string;
  assignmentTitle: string;
  isLate: boolean;
  grade?: number;
  submittedAt?: any;
};

type SemesterGrade = {
  id: string;
  courseName: string;
  credits: number;
  grade: number;
  semester: string;
};

type WeeklyReport = {
  weekId: string;
  summary: string;
  stats: {
    onTimeRate: number;
    totalSubmissions: number;
    newAchievements: number;
  };
  generatedAt?: any;
};

// ── 簡易折線圖元件（用純 View 實作，不依賴外部套件）──
function SimpleLineChart({
  data,
  labels,
  color,
  height = 80,
}: {
  data: number[];
  labels: string[];
  color: string;
  height?: number;
}) {
  if (data.length < 2) return null;
  const max = Math.max(...data, 1);
  const min = Math.min(...data);
  const range = max - min || 1;
  const width = 280;
  const pts = data.map((v, i) => ({
    x: (i / (data.length - 1)) * width,
    y: height - ((v - min) / range) * height,
  }));

  return (
    <View style={{ height: height + 30, width, marginVertical: 8 }}>
      {/* 折線用View疊出來 */}
      <View style={{ position: "absolute", width, height }}>
        {pts.slice(0, -1).map((pt, i) => {
          const next = pts[i + 1];
          const dx = next.x - pt.x;
          const dy = next.y - pt.y;
          const lineLength = Math.sqrt(dx * dx + dy * dy);
          const angle = Math.atan2(dy, dx) * (180 / Math.PI);
          return (
            <View
              key={i}
              style={{
                position: "absolute",
                left: pt.x,
                top: pt.y,
                width: lineLength,
                height: 2,
                backgroundColor: color,
                transformOrigin: "left center",
                transform: [{ rotate: `${angle}deg` }],
              }}
            />
          );
        })}
        {/* 資料點 */}
        {pts.map((pt, i) => (
          <View
            key={`dot-${i}`}
            style={{
              position: "absolute",
              left: pt.x - 5,
              top: pt.y - 5,
              width: 10,
              height: 10,
              borderRadius: 5,
              backgroundColor: color,
              borderWidth: 2,
              borderColor: theme.colors.bg,
            }}
          />
        ))}
      </View>
      {/* 標籤 */}
      <View style={{ position: "absolute", top: height + 6, width, flexDirection: "row", justifyContent: "space-between" }}>
        {labels.map((label, i) => (
          <Text key={i} style={{ color: theme.colors.muted, fontSize: 10 }}>
            {label}
          </Text>
        ))}
      </View>
    </View>
  );
}

// ── 雷達圖（簡易 Polygon View）──
function RadarChart({ axes, values, color }: { axes: string[]; values: number[]; color: string }) {
  const size = 140;
  const center = size / 2;
  const r = center - 20;
  const n = axes.length;

  function getCoord(i: number, val: number) {
    const angle = (i / n) * 2 * Math.PI - Math.PI / 2;
    const radius = (val / 100) * r;
    return {
      x: center + radius * Math.cos(angle),
      y: center + radius * Math.sin(angle),
    };
  }

  return (
    <View style={{ width: size, height: size + 20, alignItems: "center" }}>
      {/* 背景網格（60% 和 100%） */}
      {[0.6, 1.0].map((scale, si) => (
        <View key={si} style={{ position: "absolute", top: 0, left: 0, width: size, height: size }}>
          {axes.map((_, i) => {
            const pt = getCoord(i, scale * 100);
            const next = getCoord((i + 1) % n, scale * 100);
            const dx = next.x - pt.x;
            const dy = next.y - pt.y;
            const len = Math.sqrt(dx * dx + dy * dy);
            const angle = Math.atan2(dy, dx) * (180 / Math.PI);
            return (
              <View
                key={i}
                style={{
                  position: "absolute",
                  left: pt.x,
                  top: pt.y,
                  width: len,
                  height: 1,
                  backgroundColor: `${theme.colors.border}80`,
                  transformOrigin: "left center",
                  transform: [{ rotate: `${angle}deg` }],
                }}
              />
            );
          })}
        </View>
      ))}
      {/* 資料多邊形 */}
      <View style={{ position: "absolute", top: 0, left: 0, width: size, height: size }}>
        {axes.map((_, i) => {
          const pt = getCoord(i, values[i]);
          const next = getCoord((i + 1) % n, values[(i + 1) % n]);
          const dx = next.x - pt.x;
          const dy = next.y - pt.y;
          const len = Math.sqrt(dx * dx + dy * dy);
          const angle = Math.atan2(dy, dx) * (180 / Math.PI);
          return (
            <View
              key={i}
              style={{
                position: "absolute",
                left: pt.x,
                top: pt.y,
                width: len,
                height: 2,
                backgroundColor: color,
                transformOrigin: "left center",
                transform: [{ rotate: `${angle}deg` }],
              }}
            />
          );
        })}
        {axes.map((label, i) => {
          const pt = getCoord(i, 100);
          const dotPt = getCoord(i, values[i]);
          return (
            <React.Fragment key={i}>
              <View
                style={{
                  position: "absolute",
                  left: dotPt.x - 5,
                  top: dotPt.y - 5,
                  width: 10,
                  height: 10,
                  borderRadius: 5,
                  backgroundColor: color,
                }}
              />
              <Text
                style={{
                  position: "absolute",
                  left: pt.x - 18,
                  top: pt.y - 8,
                  width: 36,
                  color: theme.colors.text,
                  fontSize: 10,
                  fontWeight: "700",
                  textAlign: "center",
                }}
              >
                {label}
              </Text>
            </React.Fragment>
          );
        })}
      </View>
    </View>
  );
}

// ── 熱圖元件 ──
function HeatmapGrid({ title, data }: { title: string; data: number[][] }) {
  const hours = [8, 10, 12, 14, 16, 18, 20, 22];
  const days = ["日", "一", "二", "三", "四", "五", "六"];
  const max = Math.max(...data.flat(), 1);

  return (
    <View>
      <Text style={{ color: theme.colors.textSecondary, fontSize: 12, marginBottom: 8 }}>{title}</Text>
      <View style={{ flexDirection: "row", gap: 4 }}>
        <View style={{ gap: 4, justifyContent: "space-around" }}>
          {hours.map((h) => (
            <Text key={h} style={{ color: theme.colors.muted, fontSize: 9, width: 20, textAlign: "right" }}>{h}</Text>
          ))}
        </View>
        <View style={{ gap: 4 }}>
          {hours.map((_, hi) => (
            <View key={hi} style={{ flexDirection: "row", gap: 4 }}>
              {days.map((_, di) => {
                const val = data[hi]?.[di] ?? 0;
                const intensity = val / max;
                return (
                  <View
                    key={di}
                    style={{
                      width: 30,
                      height: 14,
                      borderRadius: 3,
                      backgroundColor: intensity > 0
                        ? `rgba(99,102,241,${0.1 + intensity * 0.9})`
                        : theme.colors.surface2,
                    }}
                  />
                );
              })}
            </View>
          ))}
          <View style={{ flexDirection: "row", gap: 4 }}>
            {days.map((d, di) => (
              <Text key={di} style={{ color: theme.colors.muted, fontSize: 9, width: 30, textAlign: "center" }}>{d}</Text>
            ))}
          </View>
        </View>
      </View>
    </View>
  );
}

export function LearningAnalyticsScreen(props: any) {
  const nav = props?.navigation;
  const auth = useAuth();
  const { school } = useSchool();
  const { courses } = useSchedule();
  const db = getDb();

  const [submissions, setSubmissions] = useState<SubmissionRecord[]>([]);
  const [semesterGrades, setSemesterGrades] = useState<SemesterGrade[]>([]);
  const [weeklyReports, setWeeklyReports] = useState<WeeklyReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [editingGrade, setEditingGrade] = useState(false);
  const [gradeInputs, setGradeInputs] = useState<Record<string, string>>({});

  // 學期選擇：動態生成最近 4 個學期
  const availableSemesters = useMemo(() => {
    const now = new Date();
    const year = now.getFullYear() - 1911; // 民國年
    const month = now.getMonth() + 1;
    const currentSemester = month >= 2 && month <= 7 ? 2 : 1;
    const sems: string[] = [];
    let y = year;
    let s = currentSemester;
    for (let i = 0; i < 4; i++) {
      sems.push(`${y}-${s}`);
      s--;
      if (s < 1) { s = 2; y--; }
    }
    return sems;
  }, []);
  const [selectedSemester, setSelectedSemester] = useState<string>(() => {
    const now = new Date();
    const year = now.getFullYear() - 1911;
    const month = now.getMonth() + 1;
    const s = month >= 2 && month <= 7 ? 2 : 1;
    return `${year}-${s}`;
  });

  const loadData = async () => {
    if (!auth.user) { setLoading(false); return; }
    const uid = auth.user.uid;

    try {
      // 讀取作業繳交紀錄（透過 collectionGroup）
      const submissionsSnap = await getDocs(
        query(collectionGroup(db, "submissions"), where("uid", "==", uid), orderBy("submittedAt", "desc"), limit(50))
      ).catch(() => ({ docs: [] as any[] }));

      const subs: SubmissionRecord[] = await Promise.all(
        submissionsSnap.docs.map(async (d) => {
          const data = d.data();
          const assignmentRef = d.ref.parent.parent;
          const assignSnap = assignmentRef ? await getDoc(assignmentRef).catch(() => null) : null;
          const groupId = assignmentRef?.parent?.parent?.id ?? "";
          const groupSnap = groupId ? await getDoc(doc(db, "groups", groupId)).catch(() => null) : null;
          const groupSchoolId = groupSnap?.data()?.schoolId as string | undefined;
          if (groupSchoolId && groupSchoolId !== school.id) {
            return null;
          }
          return {
            id: d.id,
            groupId,
            assignmentTitle: assignSnap?.data()?.title ?? "作業",
            isLate: data.isLate ?? false,
            grade: data.grade,
            submittedAt: data.submittedAt,
          };
        })
      );
      setSubmissions(subs.filter(Boolean) as SubmissionRecord[]);

      // 讀取成績資料
      const canonicalGradesSnap = await getDocs(
        query(
          collectionFromSegments(db, buildUserSchoolCollectionPath(uid, school.id, "grades")),
          orderBy("semester", "desc"),
          limit(30)
        )
      ).catch(() => ({ empty: true, docs: [] as any[] }));
      const gradesSnap = canonicalGradesSnap.empty
        ? await getDocs(query(collection(db, "users", uid, "grades"), orderBy("semester", "desc"), limit(30))).catch(() => ({ docs: [] as any[] }))
        : canonicalGradesSnap;
      setSemesterGrades(gradesSnap.docs.map((d) => ({ id: d.id, ...d.data() })) as SemesterGrade[]);

      // 讀取週報
      const canonicalReportsSnap = await getDocs(
        query(
          collectionFromSegments(db, buildUserSchoolCollectionPath(uid, school.id, "weeklyReports")),
          orderBy("generatedAt", "desc"),
          limit(8)
        )
      ).catch(() => ({ empty: true, docs: [] as any[] }));
      const reportsSnap = canonicalReportsSnap.empty
        ? await getDocs(query(collection(db, "users", uid, "weeklyReports"), orderBy("generatedAt", "desc"), limit(8))).catch(() => ({ docs: [] as any[] }))
        : canonicalReportsSnap;
      setWeeklyReports(reportsSnap.docs.map((d) => d.data()) as WeeklyReport[]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => { loadData(); }, [auth.user?.uid, school.id]);

  // 計算準時繳交率
  const submissionStats = useMemo(() => {
    if (submissions.length === 0) return { total: 0, onTime: 0, late: 0, rate: 100 };
    const onTime = submissions.filter((s) => !s.isLate).length;
    return {
      total: submissions.length,
      onTime,
      late: submissions.length - onTime,
      rate: Math.round((onTime / submissions.length) * 100),
    };
  }, [submissions]);

  // GPA 計算
  const gpaInfo = useMemo(() => {
    const graded = semesterGrades.filter((g) => g.grade != null && g.credits > 0);
    if (graded.length === 0) return null;
    const totalCredits = graded.reduce((s, g) => s + g.credits, 0);
    const weightedSum = graded.reduce((s, g) => s + g.grade * g.credits, 0);
    const gpa = weightedSum / totalCredits / 25; // 假設100分制→4.0制（除以25）
    const semesters = [...new Set(graded.map((g) => g.semester))].sort();
    const gpaPerSemester = semesters.map((sem) => {
      const semGrades = graded.filter((g) => g.semester === sem);
      const sc = semGrades.reduce((s, g) => s + g.credits, 0);
      const sw = semGrades.reduce((s, g) => s + g.grade * g.credits, 0);
      return { sem, gpa: sw / sc / 25 };
    });
    return { overall: Math.min(gpa, 4.0), semesters: gpaPerSemester };
  }, [semesterGrades]);

  // 科目強弱雷達數據
  const radarData = useMemo(() => {
    const graded = semesterGrades.filter((g) => g.grade != null).slice(0, 6);
    if (graded.length < 3) return null;
    return {
      axes: graded.map((g) => g.courseName.slice(0, 4)),
      values: graded.map((g) => Math.min(100, g.grade)),
    };
  }, [semesterGrades]);

  // 簡易學習活動熱圖資料（8小時 × 7天，根據 submissions 時間推算）
  const heatmapData = useMemo(() => {
    const grid = Array.from({ length: 8 }, () => new Array(7).fill(0));
    const hours = [8, 10, 12, 14, 16, 18, 20, 22];
    submissions.forEach((s) => {
      if (!s.submittedAt?.toDate) return;
      const d = s.submittedAt.toDate();
      const day = d.getDay();
      const hour = d.getHours();
      const hi = hours.findIndex((h) => Math.abs(h - hour) <= 1);
      if (hi >= 0) grid[hi][day]++;
    });
    return grid;
  }, [submissions]);

  // 儲存手動輸入的成績
  const saveGrade = async (courseId: string, courseName: string, credits: number, semester: string) => {
    if (!auth.user) return;
    const grade = parseFloat(gradeInputs[courseId] ?? "");
    if (isNaN(grade) || grade < 0 || grade > 100) {
      Alert.alert("輸入錯誤", "請輸入 0-100 的有效分數");
      return;
    }
    await setDoc(doc(db, "users", auth.user.uid, "grades", courseId), {
      courseName, credits, grade, semester,
      updatedAt: serverTimestamp(),
    }, { merge: true });
    setGradeInputs((prev) => ({ ...prev, [courseId]: "" }));
    loadData();
  };

  if (!auth.user) {
    return (
      <Screen>
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 12, padding: 32 }}>
          <Ionicons name="bar-chart-outline" size={48} color={theme.colors.muted} />
          <Text style={{ color: theme.colors.text, fontWeight: "700", fontSize: 18, textAlign: "center" }}>學習分析</Text>
          <Text style={{ color: theme.colors.muted, textAlign: "center" }}>登入後即可查看你的完整學習分析報告</Text>
        </View>
      </Screen>
    );
  }

  if (loading) return <LoadingState title="學習分析" subtitle="載入中..." rows={4} />;

  return (
    <Screen>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ gap: 16, paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); loadData(); }} tintColor={theme.colors.accent} />
        }
      >
        {/* 標頭 */}
        <View style={{ padding: 16, paddingBottom: 0 }}>
          <Text style={{ color: theme.colors.text, fontSize: 28, fontWeight: "800", letterSpacing: -0.6 }}>學習分析</Text>
          <Text style={{ color: theme.colors.muted, fontSize: 13, marginTop: 4 }}>
            根據你的作業與成績資料自動生成
          </Text>
        </View>

        {/* 本週週報 */}
        {weeklyReports.length > 0 && (
          <View style={{ paddingHorizontal: 16 }}>
            <AnimatedCard title="本週學習報告" subtitle={weeklyReports[0].weekId}>
              <Text style={{ color: theme.colors.text, lineHeight: 22, marginBottom: 12 }}>
                {weeklyReports[0].summary}
              </Text>
              <View style={{ flexDirection: "row", gap: 16 }}>
                <View style={{ alignItems: "center" }}>
                  <Text style={{ color: theme.colors.accent, fontWeight: "900", fontSize: 22 }}>
                    {weeklyReports[0].stats.onTimeRate}%
                  </Text>
                  <Text style={{ color: theme.colors.muted, fontSize: 11 }}>準時率</Text>
                </View>
                <View style={{ alignItems: "center" }}>
                  <Text style={{ color: theme.colors.success, fontWeight: "900", fontSize: 22 }}>
                    {weeklyReports[0].stats.totalSubmissions}
                  </Text>
                  <Text style={{ color: theme.colors.muted, fontSize: 11 }}>繳交作業</Text>
                </View>
                <View style={{ alignItems: "center" }}>
                  <Text style={{ color: "#F59E0B", fontWeight: "900", fontSize: 22 }}>
                    {weeklyReports[0].stats.newAchievements}
                  </Text>
                  <Text style={{ color: theme.colors.muted, fontSize: 11 }}>新成就</Text>
                </View>
              </View>
            </AnimatedCard>
          </View>
        )}

        {/* 準時繳交率 */}
        <View style={{ paddingHorizontal: 16 }}>
          <AnimatedCard title="作業繳交狀況" subtitle={`共 ${submissionStats.total} 份紀錄`} delay={100}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 20 }}>
              <ProgressRing
                progress={submissionStats.rate / 100}
                size={88}
                strokeWidth={8}
                color={submissionStats.rate >= 80 ? theme.colors.success : theme.colors.warning}
                showLabel={false}
              />
              <View style={{ flex: 1, gap: 10 }}>
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                  <Text style={{ color: theme.colors.success, fontWeight: "700" }}>準時繳交</Text>
                  <Text style={{ color: theme.colors.text, fontWeight: "800", fontSize: 18 }}>{submissionStats.onTime}</Text>
                </View>
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                  <Text style={{ color: theme.colors.danger, fontWeight: "700" }}>逾期繳交</Text>
                  <Text style={{ color: theme.colors.text, fontWeight: "800", fontSize: 18 }}>{submissionStats.late}</Text>
                </View>
                <View
                  style={{
                    height: 8,
                    borderRadius: 4,
                    backgroundColor: theme.colors.border,
                    overflow: "hidden",
                    marginTop: 4,
                  }}
                >
                  <View
                    style={{
                      width: `${submissionStats.rate}%`,
                      height: "100%",
                      backgroundColor: submissionStats.rate >= 80 ? theme.colors.success : theme.colors.warning,
                    }}
                  />
                </View>
                <Text style={{ color: theme.colors.accent, fontWeight: "900", fontSize: 24, textAlign: "center" }}>
                  {submissionStats.rate}%
                </Text>
              </View>
            </View>

            {submissions.length > 0 && (
              <View style={{ marginTop: 14, gap: 6 }}>
                <Text style={{ color: theme.colors.textSecondary, fontSize: 12, fontWeight: "600", marginBottom: 4 }}>
                  最近繳交紀錄
                </Text>
                {submissions.slice(0, 4).map((s) => (
                  <View key={s.id} style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    <Ionicons
                      name={s.isLate ? "warning-outline" : "checkmark-circle-outline"}
                      size={16}
                      color={s.isLate ? theme.colors.danger : theme.colors.success}
                    />
                    <Text style={{ flex: 1, color: theme.colors.text, fontSize: 13 }} numberOfLines={1}>
                      {s.assignmentTitle}
                    </Text>
                    {s.grade != null && (
                      <Pill text={`${s.grade} 分`} kind={s.grade >= 60 ? "success" : "danger"} size="sm" />
                    )}
                  </View>
                ))}
              </View>
            )}
          </AnimatedCard>
        </View>

        {/* GPA 軌跡 */}
        <View style={{ paddingHorizontal: 16 }}>
          <AnimatedCard title="GPA 軌跡" subtitle={gpaInfo ? `整體 GPA：${gpaInfo.overall.toFixed(2)}` : "尚無成績資料"} delay={150}>
            {gpaInfo && gpaInfo.semesters.length >= 2 ? (
              <View style={{ alignItems: "flex-start" }}>
                <SimpleLineChart
                  data={gpaInfo.semesters.map((s) => s.gpa)}
                  labels={gpaInfo.semesters.map((s) => s.sem.slice(-4))}
                  color={theme.colors.accent}
                  height={80}
                />
              </View>
            ) : (
              <Text style={{ color: theme.colors.muted, textAlign: "center", paddingVertical: 12 }}>
                輸入兩個以上學期的成績後，即可看到 GPA 趨勢
              </Text>
            )}

            {/* 手動輸入成績 */}
            <View style={{ marginTop: 14 }}>
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                <Text style={{ color: theme.colors.textSecondary, fontSize: 12, fontWeight: "600" }}>手動輸入課程成績</Text>
                <Pressable onPress={() => setEditingGrade(!editingGrade)}>
                  <Text style={{ color: theme.colors.accent, fontSize: 12, fontWeight: "700" }}>
                    {editingGrade ? "完成" : "編輯"}
                  </Text>
                </Pressable>
              </View>
              {editingGrade && (
                <View style={{ marginBottom: 12 }}>
                  <Text style={{ color: theme.colors.textSecondary, fontSize: 12, marginBottom: 6 }}>選擇學期</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                    {availableSemesters.map((sem) => (
                      <Pressable
                        key={sem}
                        onPress={() => setSelectedSemester(sem)}
                        style={{
                          paddingHorizontal: 14,
                          paddingVertical: 6,
                          borderRadius: theme.radius.full,
                          backgroundColor: selectedSemester === sem ? theme.colors.accent : theme.colors.surface2,
                          borderWidth: 1,
                          borderColor: selectedSemester === sem ? theme.colors.accent : theme.colors.border,
                        }}
                      >
                        <Text style={{ color: selectedSemester === sem ? "#fff" : theme.colors.text, fontSize: 13, fontWeight: "600" }}>
                          {sem}
                        </Text>
                      </Pressable>
                    ))}
                  </ScrollView>
                </View>
              )}
              {editingGrade && courses.slice(0, 8).map((course) => {
                const existing = semesterGrades.find((g) => g.id === course.id);
                return (
                  <View key={course.id} style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 }}>
                    <Text style={{ flex: 1, color: theme.colors.text, fontSize: 13 }} numberOfLines={1}>
                      {course.name}
                    </Text>
                    <TextInput
                      value={gradeInputs[course.id] ?? (existing?.grade?.toString() ?? "")}
                      onChangeText={(v) => setGradeInputs((p) => ({ ...p, [course.id]: v }))}
                      placeholder={existing ? `${existing.grade}` : "分數"}
                      placeholderTextColor={theme.colors.muted}
                      keyboardType="numeric"
                      style={{
                        width: 60,
                        textAlign: "center",
                        color: theme.colors.text,
                        borderWidth: 1,
                        borderColor: theme.colors.border,
                        borderRadius: theme.radius.sm,
                        padding: 6,
                        backgroundColor: theme.colors.surface2,
                        fontSize: 13,
                      }}
                    />
                    <Pressable
                      onPress={() => saveGrade(course.id, course.name, course.credits ?? 3, selectedSemester)}
                      style={{ padding: 6 }}
                    >
                      <Ionicons name="checkmark" size={18} color={theme.colors.success} />
                    </Pressable>
                  </View>
                );
              })}
              {semesterGrades.length > 0 && !editingGrade && (
                <View style={{ gap: 6 }}>
                  {semesterGrades.slice(0, 5).map((g) => (
                    <View key={g.id} style={{ flexDirection: "row", alignItems: "center" }}>
                      <Text style={{ flex: 1, color: theme.colors.text, fontSize: 13 }} numberOfLines={1}>{g.courseName}</Text>
                      <Text style={{ color: g.grade >= 60 ? theme.colors.success : theme.colors.danger, fontWeight: "700" }}>
                        {g.grade} 分
                      </Text>
                    </View>
                  ))}
                </View>
              )}
            </View>
          </AnimatedCard>
        </View>

        {/* 科目強弱雷達圖 */}
        {radarData && (
          <View style={{ paddingHorizontal: 16 }}>
            <AnimatedCard title="科目強弱分析" subtitle="依照各科成績分布" delay={200}>
              <View style={{ alignItems: "center" }}>
                <RadarChart
                  axes={radarData.axes}
                  values={radarData.values}
                  color={theme.colors.accent}
                />
              </View>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
                {radarData.axes.map((axis, i) => (
                  <View key={i} style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                    <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: theme.colors.accent }} />
                    <Text style={{ color: theme.colors.muted, fontSize: 11 }}>{axis}: {radarData.values[i]}%</Text>
                  </View>
                ))}
              </View>
            </AnimatedCard>
          </View>
        )}

        {/* 學習活動熱圖 */}
        {submissions.length >= 3 && (
          <View style={{ paddingHorizontal: 16 }}>
            <AnimatedCard title="學習活動熱圖" subtitle="依繳交時間推算使用活躍時段" delay={250}>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <HeatmapGrid title="每週各時段活躍程度（深色=越活躍）" data={heatmapData} />
              </ScrollView>
            </AnimatedCard>
          </View>
        )}

        {/* 課程負載 */}
        {courses.length > 0 && (
          <View style={{ paddingHorizontal: 16 }}>
            <AnimatedCard title="本學期課程負載" subtitle={`${courses.length} 門課，共 ${courses.reduce((s, c) => s + (c.credits ?? 0), 0)} 學分`} delay={300}>
              <View style={{ gap: 8 }}>
                {courses.slice(0, 6).map((course) => {
                  const credits = course.credits ?? 3;
                  const maxCredits = Math.max(...courses.map((c) => c.credits ?? 3), 1);
                  return (
                    <View key={course.id}>
                      <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 4 }}>
                        <Text style={{ color: theme.colors.text, fontSize: 13 }} numberOfLines={1}>{course.name}</Text>
                        <Text style={{ color: theme.colors.muted, fontSize: 12 }}>{credits} 學分</Text>
                      </View>
                      <View style={{ height: 6, borderRadius: 3, backgroundColor: theme.colors.border, overflow: "hidden" }}>
                        <View
                          style={{
                            width: `${(credits / maxCredits) * 100}%`,
                            height: "100%",
                            backgroundColor: course.color ?? theme.colors.accent,
                          }}
                        />
                      </View>
                    </View>
                  );
                })}
              </View>
            </AnimatedCard>
          </View>
        )}
      </ScrollView>
    </Screen>
  );
}
