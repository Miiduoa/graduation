import React, { useMemo, useState, useEffect, useCallback } from "react";
import { ScrollView, Text, View, Pressable, Alert, RefreshControl } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import {
  Screen,
  Card,
  Pill,
  Button,
  AnimatedCard,
  SegmentedControl,
  SectionTitle,
  ListItem,
  ProgressRing,
  Spinner,
} from "../ui/components";
import { TAB_BAR_CONTENT_BOTTOM_PADDING } from "../ui/navigationTheme";
import { theme } from "../ui/theme";
import { useAuth } from "../state/auth";
import { useSchool } from "../state/school";
import { getDataSource, hasDataSource } from "../data";
import type { Grade as DataGrade } from "../data/types";
import { analytics } from "../services/analytics";

type Grade = {
  id: string;
  courseCode: string;
  courseName: string;
  credits: number;
  semester: string;
  midterm?: number;
  final?: number;
  grade?: string;
  gpa?: number;
  status: "completed" | "in_progress" | "failed";
  category: "required" | "elective" | "general" | "english";
  instructor?: string;
};

type Semester = {
  id: string;
  name: string;
  year: number;
  term: number;
  gpa: number;
  credits: number;
  courses: Grade[];
};

const MOCK_SEMESTERS: Semester[] = [
  {
    id: "113-1",
    name: "113學年度第1學期",
    year: 113,
    term: 1,
    gpa: 3.75,
    credits: 18,
    courses: [
      {
        id: "c1",
        courseCode: "CS101",
        courseName: "程式設計",
        credits: 3,
        semester: "113-1",
        midterm: 88,
        final: 92,
        grade: "A",
        gpa: 4.0,
        status: "completed",
        category: "required",
        instructor: "王教授",
      },
      {
        id: "c2",
        courseCode: "MATH101",
        courseName: "微積分(一)",
        credits: 3,
        semester: "113-1",
        midterm: 78,
        final: 85,
        grade: "A-",
        gpa: 3.7,
        status: "completed",
        category: "required",
        instructor: "李教授",
      },
      {
        id: "c3",
        courseCode: "PHY101",
        courseName: "普通物理",
        credits: 3,
        semester: "113-1",
        midterm: 82,
        final: 88,
        grade: "A-",
        gpa: 3.7,
        status: "completed",
        category: "required",
        instructor: "陳教授",
      },
      {
        id: "c4",
        courseCode: "GE101",
        courseName: "文學與人生",
        credits: 2,
        semester: "113-1",
        midterm: 90,
        final: 92,
        grade: "A",
        gpa: 4.0,
        status: "completed",
        category: "general",
        instructor: "張教授",
      },
      {
        id: "c5",
        courseCode: "ENG101",
        courseName: "大一英文(一)",
        credits: 2,
        semester: "113-1",
        midterm: 85,
        final: 88,
        grade: "A-",
        gpa: 3.7,
        status: "completed",
        category: "english",
        instructor: "林老師",
      },
      {
        id: "c6",
        courseCode: "CS102",
        courseName: "計算機概論",
        credits: 3,
        semester: "113-1",
        midterm: 75,
        final: 80,
        grade: "B+",
        gpa: 3.3,
        status: "completed",
        category: "required",
        instructor: "黃教授",
      },
      {
        id: "c7",
        courseCode: "PE101",
        courseName: "體育(一)",
        credits: 2,
        semester: "113-1",
        grade: "A",
        gpa: 4.0,
        status: "completed",
        category: "general",
        instructor: "體育組",
      },
    ],
  },
  {
    id: "113-2",
    name: "113學年度第2學期",
    year: 113,
    term: 2,
    gpa: 0,
    credits: 19,
    courses: [
      {
        id: "c8",
        courseCode: "CS201",
        courseName: "資料結構",
        credits: 3,
        semester: "113-2",
        midterm: 85,
        status: "in_progress",
        category: "required",
        instructor: "王教授",
      },
      {
        id: "c9",
        courseCode: "MATH102",
        courseName: "微積分(二)",
        credits: 3,
        semester: "113-2",
        midterm: 80,
        status: "in_progress",
        category: "required",
        instructor: "李教授",
      },
      {
        id: "c10",
        courseCode: "CS202",
        courseName: "物件導向程式設計",
        credits: 3,
        semester: "113-2",
        midterm: 90,
        status: "in_progress",
        category: "required",
        instructor: "張教授",
      },
      {
        id: "c11",
        courseCode: "MATH201",
        courseName: "線性代數",
        credits: 3,
        semester: "113-2",
        midterm: 75,
        status: "in_progress",
        category: "required",
        instructor: "周教授",
      },
      {
        id: "c12",
        courseCode: "GE102",
        courseName: "藝術欣賞",
        credits: 2,
        semester: "113-2",
        midterm: 88,
        status: "in_progress",
        category: "general",
        instructor: "吳教授",
      },
      {
        id: "c13",
        courseCode: "ENG102",
        courseName: "大一英文(二)",
        credits: 2,
        semester: "113-2",
        midterm: 82,
        status: "in_progress",
        category: "english",
        instructor: "林老師",
      },
      {
        id: "c14",
        courseCode: "CS203",
        courseName: "離散數學",
        credits: 3,
        semester: "113-2",
        midterm: 78,
        status: "in_progress",
        category: "required",
        instructor: "陳教授",
      },
    ],
  },
];

const GRADE_COLORS: Record<string, string> = {
  "A+": "#22C55E",
  A: "#22C55E",
  "A-": "#4ADE80",
  "B+": "#3B82F6",
  B: "#3B82F6",
  "B-": "#60A5FA",
  "C+": "#F59E0B",
  C: "#F59E0B",
  "C-": "#FBBF24",
  D: "#EF4444",
  F: "#DC2626",
};

const CATEGORY_LABELS: Record<string, { label: string; color: string }> = {
  required: { label: "必修", color: "#3B82F6" },
  elective: { label: "選修", color: "#8B5CF6" },
  general: { label: "通識", color: "#10B981" },
  english: { label: "英文", color: "#F59E0B" },
};

function GradeCard({ course }: { course: Grade }) {
  const categoryInfo = CATEGORY_LABELS[course.category];
  const gradeColor = course.grade ? GRADE_COLORS[course.grade] ?? theme.colors.muted : theme.colors.muted;

  return (
    <Pressable
      style={{
        padding: 14,
        borderRadius: theme.radius.md,
        backgroundColor: theme.colors.surface2,
        borderWidth: 1,
        borderColor: theme.colors.border,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Text style={{ color: theme.colors.text, fontWeight: "700", fontSize: 15 }}>
              {course.courseName}
            </Text>
            <View
              style={{
                paddingHorizontal: 6,
                paddingVertical: 2,
                borderRadius: 4,
                backgroundColor: `${categoryInfo.color}20`,
              }}
            >
              <Text style={{ color: categoryInfo.color, fontSize: 10, fontWeight: "600" }}>
                {categoryInfo.label}
              </Text>
            </View>
          </View>
          <Text style={{ color: theme.colors.muted, fontSize: 12, marginTop: 4 }}>
            {course.courseCode} · {course.credits} 學分 · {course.instructor}
          </Text>
        </View>

        {course.status === "completed" && course.grade && (
          <View style={{ alignItems: "center" }}>
            <Text style={{ color: gradeColor, fontWeight: "900", fontSize: 24 }}>
              {course.grade}
            </Text>
            {course.gpa !== undefined && (
              <Text style={{ color: theme.colors.muted, fontSize: 11 }}>
                GPA {course.gpa.toFixed(1)}
              </Text>
            )}
          </View>
        )}

        {course.status === "in_progress" && (
          <View style={{ alignItems: "center" }}>
            <Pill text="進行中" kind="accent" />
            {course.midterm !== undefined && (
              <Text style={{ color: theme.colors.muted, fontSize: 11, marginTop: 4 }}>
                期中 {course.midterm}
              </Text>
            )}
          </View>
        )}
      </View>

      {course.status === "completed" && course.midterm !== undefined && course.final !== undefined && (
        <View style={{ marginTop: 10, flexDirection: "row", gap: 16 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Text style={{ color: theme.colors.muted, fontSize: 12 }}>期中：</Text>
            <Text style={{ color: theme.colors.text, fontWeight: "600", fontSize: 12 }}>
              {course.midterm}
            </Text>
          </View>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Text style={{ color: theme.colors.muted, fontSize: 12 }}>期末：</Text>
            <Text style={{ color: theme.colors.text, fontWeight: "600", fontSize: 12 }}>
              {course.final}
            </Text>
          </View>
        </View>
      )}
    </Pressable>
  );
}

export function GradesScreen(props: any) {
  const nav = props?.navigation;
  const auth = useAuth();
  const { school } = useSchool();

  const [selectedTab, setSelectedTab] = useState(0);
  const [selectedSemester, setSelectedSemester] = useState<string | null>("113-2");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [serverGrades, setServerGrades] = useState<DataGrade[]>([]);
  const [gpaData, setGpaData] = useState<{ gpa: number; totalCredits: number; totalPoints: number } | null>(null);

  const TABS = ["本學期", "歷史成績", "統計分析"];

  useEffect(() => {
    analytics.logScreenView("Grades");
    loadGrades();
  }, [auth.user?.uid]);

  const loadGrades = useCallback(async () => {
    if (!auth.user?.uid || !hasDataSource()) {
      setLoading(false);
      return;
    }

    try {
      const ds = getDataSource();
      const [grades, gpa] = await Promise.all([
        ds.listGrades(auth.user.uid),
        ds.getGPA(auth.user.uid),
      ]);
      setServerGrades(grades);
      setGpaData(gpa);
    } catch (error) {
      console.error("Failed to load grades:", error);
    } finally {
      setLoading(false);
    }
  }, [auth.user?.uid]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadGrades();
    setRefreshing(false);
  }, [loadGrades]);

  const semesters = useMemo(() => {
    if (serverGrades.length > 0) {
      const semesterMap = new Map<string, Semester>();
      
      for (const grade of serverGrades) {
        const semId = grade.semester;
        if (!semesterMap.has(semId)) {
          semesterMap.set(semId, {
            id: semId,
            name: `${semId.split("-")[0]}學年度第${semId.split("-")[1]}學期`,
            year: parseInt(semId.split("-")[0]),
            term: parseInt(semId.split("-")[1]),
            gpa: 0,
            credits: 0,
            courses: [],
          });
        }
        
        const sem = semesterMap.get(semId)!;
        sem.courses.push({
          id: grade.id,
          courseCode: grade.courseCode,
          courseName: grade.courseName,
          credits: grade.credits,
          semester: grade.semester,
          midterm: grade.midtermScore,
          final: grade.finalScore,
          grade: grade.letterGrade,
          gpa: grade.gradePoints,
          status: grade.letterGrade ? "completed" : "in_progress",
          category: "required",
          instructor: grade.instructor,
        });
        sem.credits += grade.credits;
      }
      
      for (const sem of semesterMap.values()) {
        const completedCourses = sem.courses.filter(c => c.status === "completed");
        if (completedCourses.length > 0) {
          const totalPoints = completedCourses.reduce((sum, c) => sum + (c.gpa ?? 0) * c.credits, 0);
          const totalCredits = completedCourses.reduce((sum, c) => sum + c.credits, 0);
          sem.gpa = totalCredits > 0 ? totalPoints / totalCredits : 0;
        }
      }
      
      return Array.from(semesterMap.values()).sort((a, b) => {
        if (a.year !== b.year) return b.year - a.year;
        return b.term - a.term;
      });
    }
    return MOCK_SEMESTERS;
  }, [serverGrades]);

  const currentSemester = semesters[0];
  const historySemesters = semesters.slice(1);

  const allCourses = useMemo(() => {
    return semesters.flatMap((s) => s.courses);
  }, [semesters]);

  const completedCourses = useMemo(() => {
    return allCourses.filter((c) => c.status === "completed");
  }, [allCourses]);

  const overallGPA = useMemo(() => {
    if (gpaData) return gpaData.gpa;
    if (completedCourses.length === 0) return 0;
    const totalPoints = completedCourses.reduce((sum, c) => sum + (c.gpa ?? 0) * c.credits, 0);
    const totalCredits = completedCourses.reduce((sum, c) => sum + c.credits, 0);
    return totalCredits > 0 ? totalPoints / totalCredits : 0;
  }, [completedCourses, gpaData]);

  const totalCredits = useMemo(() => {
    return completedCourses.reduce((sum, c) => sum + c.credits, 0);
  }, [completedCourses]);

  const categoryStats = useMemo(() => {
    const stats: Record<string, { completed: number; total: number }> = {};
    for (const category of Object.keys(CATEGORY_LABELS)) {
      const categoryCourses = completedCourses.filter((c) => c.category === category);
      stats[category] = {
        completed: categoryCourses.reduce((sum, c) => sum + c.credits, 0),
        total: 0,
      };
    }
    return stats;
  }, [completedCourses]);

  const gradeDistribution = useMemo(() => {
    const dist: Record<string, number> = { "A系列": 0, "B系列": 0, "C系列": 0, "其他": 0 };
    for (const c of completedCourses) {
      if (!c.grade) continue;
      if (c.grade.startsWith("A")) dist["A系列"]++;
      else if (c.grade.startsWith("B")) dist["B系列"]++;
      else if (c.grade.startsWith("C")) dist["C系列"]++;
      else dist["其他"]++;
    }
    return dist;
  }, [completedCourses]);

  if (!auth.user) {
    return (
      <Screen>
        <AnimatedCard title="成績查詢" subtitle="請先登入">
          <Text style={{ color: theme.colors.muted, marginBottom: 12 }}>
            登入後才能查看成績資料
          </Text>
          <Button text="前往登入" kind="primary" onPress={() => nav?.navigate?.("MeHome")} />
        </AnimatedCard>
      </Screen>
    );
  }

  if (loading) {
    return (
      <Screen>
        <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
          <Spinner />
          <Text style={{ color: theme.colors.muted, marginTop: 12 }}>載入成績中...</Text>
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <View style={{ flex: 1 }}>
        <SegmentedControl options={TABS} selected={selectedTab} onChange={setSelectedTab} />

        <ScrollView
          style={{ flex: 1, marginTop: 12 }}
          contentContainerStyle={{ paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING }}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              tintColor={theme.colors.accent}
            />
          }
        >
          {selectedTab === 0 && (
            <View style={{ gap: 12 }}>
              <AnimatedCard title="113學年度第2學期" subtitle="進行中">
                <View style={{ flexDirection: "row", gap: 16, marginBottom: 16 }}>
                  <View style={{ flex: 1, alignItems: "center" }}>
                    <Text style={{ color: theme.colors.accent, fontWeight: "900", fontSize: 28 }}>
                      {currentSemester?.credits ?? 0}
                    </Text>
                    <Text style={{ color: theme.colors.muted, fontSize: 12 }}>修課學分</Text>
                  </View>
                  <View style={{ flex: 1, alignItems: "center" }}>
                    <Text style={{ color: theme.colors.success, fontWeight: "900", fontSize: 28 }}>
                      {currentSemester?.courses.length ?? 0}
                    </Text>
                    <Text style={{ color: theme.colors.muted, fontSize: 12 }}>修課數</Text>
                  </View>
                  <View style={{ flex: 1, alignItems: "center" }}>
                    <Text style={{ color: "#F59E0B", fontWeight: "900", fontSize: 28 }}>
                      {currentSemester?.courses.filter((c) => c.midterm !== undefined).length ?? 0}
                    </Text>
                    <Text style={{ color: theme.colors.muted, fontSize: 12 }}>已出期中成績</Text>
                  </View>
                </View>

                <View
                  style={{
                    padding: 12,
                    borderRadius: theme.radius.md,
                    backgroundColor: theme.colors.accentSoft,
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 10,
                  }}
                >
                  <Ionicons name="information-circle" size={20} color={theme.colors.accent} />
                  <Text style={{ color: theme.colors.text, fontSize: 13, flex: 1 }}>
                    期末成績尚未公布，目前僅顯示期中成績
                  </Text>
                </View>
              </AnimatedCard>

              <SectionTitle text="本學期課程" />

              {currentSemester?.courses.map((course) => (
                <GradeCard key={course.id} course={course} />
              ))}
            </View>
          )}

          {selectedTab === 1 && (
            <View style={{ gap: 12 }}>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <View style={{ flexDirection: "row", gap: 8 }}>
                  {semesters.filter((s) => s.courses.some((c) => c.status === "completed")).map(
                    (sem) => (
                      <Pressable
                        key={sem.id}
                        onPress={() => setSelectedSemester(sem.id)}
                        style={{
                          paddingHorizontal: 16,
                          paddingVertical: 10,
                          borderRadius: 999,
                          backgroundColor:
                            selectedSemester === sem.id
                              ? theme.colors.accentSoft
                              : theme.colors.surface2,
                          borderWidth: 1,
                          borderColor:
                            selectedSemester === sem.id ? theme.colors.accent : theme.colors.border,
                        }}
                      >
                        <Text
                          style={{
                            color:
                              selectedSemester === sem.id ? theme.colors.accent : theme.colors.muted,
                            fontWeight: "700",
                          }}
                        >
                          {sem.name.replace("學年度", "").replace("學期", "")}
                        </Text>
                      </Pressable>
                    )
                  )}
                </View>
              </ScrollView>

              {(() => {
                const sem = semesters.find((s) => s.id === selectedSemester);
                if (!sem) return null;
                const completedInSem = sem.courses.filter((c) => c.status === "completed");
                if (completedInSem.length === 0) {
                  return (
                    <AnimatedCard title={sem.name} subtitle="尚無成績">
                      <Text style={{ color: theme.colors.muted }}>本學期成績尚未公布</Text>
                    </AnimatedCard>
                  );
                }

                return (
                  <>
                    <AnimatedCard title={sem.name} subtitle={`GPA: ${sem.gpa.toFixed(2)}`}>
                      <View style={{ flexDirection: "row", gap: 16 }}>
                        <View style={{ flex: 1, alignItems: "center" }}>
                          <Text style={{ color: theme.colors.accent, fontWeight: "900", fontSize: 28 }}>
                            {sem.gpa.toFixed(2)}
                          </Text>
                          <Text style={{ color: theme.colors.muted, fontSize: 12 }}>學期 GPA</Text>
                        </View>
                        <View style={{ flex: 1, alignItems: "center" }}>
                          <Text style={{ color: theme.colors.success, fontWeight: "900", fontSize: 28 }}>
                            {completedInSem.reduce((sum, c) => sum + c.credits, 0)}
                          </Text>
                          <Text style={{ color: theme.colors.muted, fontSize: 12 }}>取得學分</Text>
                        </View>
                        <View style={{ flex: 1, alignItems: "center" }}>
                          <Text style={{ color: "#F59E0B", fontWeight: "900", fontSize: 28 }}>
                            {completedInSem.length}
                          </Text>
                          <Text style={{ color: theme.colors.muted, fontSize: 12 }}>修課數</Text>
                        </View>
                      </View>
                    </AnimatedCard>

                    <SectionTitle text="課程成績" />

                    {completedInSem.map((course) => (
                      <GradeCard key={course.id} course={course} />
                    ))}
                  </>
                );
              })()}
            </View>
          )}

          {selectedTab === 2 && (
            <View style={{ gap: 12 }}>
              <AnimatedCard title="成績總覽" subtitle="累積表現">
                <View style={{ flexDirection: "row", alignItems: "center", gap: 20 }}>
                  <ProgressRing
                    progress={Math.min(1, overallGPA / 4.0)}
                    size={100}
                    strokeWidth={10}
                    color={theme.colors.accent}
                  />
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: theme.colors.muted, fontSize: 12 }}>累積 GPA</Text>
                    <Text style={{ color: theme.colors.accent, fontWeight: "900", fontSize: 36 }}>
                      {overallGPA.toFixed(2)}
                    </Text>
                    <Text style={{ color: theme.colors.muted, fontSize: 12, marginTop: 4 }}>
                      滿分 4.0
                    </Text>
                  </View>
                </View>

                <View style={{ marginTop: 16, flexDirection: "row", gap: 12 }}>
                  <View
                    style={{
                      flex: 1,
                      padding: 12,
                      borderRadius: theme.radius.md,
                      backgroundColor: theme.colors.surface2,
                      alignItems: "center",
                    }}
                  >
                    <Text style={{ color: theme.colors.success, fontWeight: "900", fontSize: 24 }}>
                      {totalCredits}
                    </Text>
                    <Text style={{ color: theme.colors.muted, fontSize: 11 }}>已修學分</Text>
                  </View>
                  <View
                    style={{
                      flex: 1,
                      padding: 12,
                      borderRadius: theme.radius.md,
                      backgroundColor: theme.colors.surface2,
                      alignItems: "center",
                    }}
                  >
                    <Text style={{ color: "#F59E0B", fontWeight: "900", fontSize: 24 }}>
                      {completedCourses.length}
                    </Text>
                    <Text style={{ color: theme.colors.muted, fontSize: 11 }}>完成課程</Text>
                  </View>
                  <View
                    style={{
                      flex: 1,
                      padding: 12,
                      borderRadius: theme.radius.md,
                      backgroundColor: theme.colors.surface2,
                      alignItems: "center",
                    }}
                  >
                    <Text style={{ color: "#3B82F6", fontWeight: "900", fontSize: 24 }}>
                      {MOCK_SEMESTERS.filter((s) => s.courses.some((c) => c.status === "completed")).length}
                    </Text>
                    <Text style={{ color: theme.colors.muted, fontSize: 11 }}>完成學期</Text>
                  </View>
                </View>
              </AnimatedCard>

              <AnimatedCard title="成績分布" subtitle="依等第分類" delay={100}>
                <View style={{ gap: 12 }}>
                  {Object.entries(gradeDistribution).map(([label, count]) => {
                    const total = completedCourses.length || 1;
                    const percent = (count / total) * 100;
                    const color =
                      label === "A系列"
                        ? "#22C55E"
                        : label === "B系列"
                        ? "#3B82F6"
                        : label === "C系列"
                        ? "#F59E0B"
                        : theme.colors.muted;

                    return (
                      <View key={label}>
                        <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 4 }}>
                          <Text style={{ color: theme.colors.text, fontWeight: "600" }}>{label}</Text>
                          <Text style={{ color: theme.colors.muted }}>
                            {count} 門 ({percent.toFixed(0)}%)
                          </Text>
                        </View>
                        <View
                          style={{
                            height: 8,
                            borderRadius: 4,
                            backgroundColor: theme.colors.border,
                            overflow: "hidden",
                          }}
                        >
                          <View
                            style={{
                              height: "100%",
                              width: `${percent}%`,
                              backgroundColor: color,
                              borderRadius: 4,
                            }}
                          />
                        </View>
                      </View>
                    );
                  })}
                </View>
              </AnimatedCard>

              <AnimatedCard title="學分分類" subtitle="依類別統計" delay={200}>
                <View style={{ gap: 10 }}>
                  {Object.entries(CATEGORY_LABELS).map(([key, info]) => {
                    const credits = categoryStats[key]?.completed ?? 0;
                    return (
                      <View
                        key={key}
                        style={{
                          flexDirection: "row",
                          alignItems: "center",
                          padding: 12,
                          borderRadius: theme.radius.md,
                          backgroundColor: theme.colors.surface2,
                          gap: 12,
                        }}
                      >
                        <View
                          style={{
                            width: 40,
                            height: 40,
                            borderRadius: 10,
                            backgroundColor: `${info.color}20`,
                            alignItems: "center",
                            justifyContent: "center",
                          }}
                        >
                          <Ionicons
                            name={
                              key === "required"
                                ? "school"
                                : key === "elective"
                                ? "options"
                                : key === "general"
                                ? "globe"
                                : "language"
                            }
                            size={20}
                            color={info.color}
                          />
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={{ color: theme.colors.text, fontWeight: "600" }}>
                            {info.label}
                          </Text>
                        </View>
                        <Text style={{ color: info.color, fontWeight: "700", fontSize: 18 }}>
                          {credits} 學分
                        </Text>
                      </View>
                    );
                  })}
                </View>
              </AnimatedCard>

              <AnimatedCard title="GPA 趨勢" subtitle="各學期表現" delay={300}>
                <View style={{ gap: 8 }}>
                  {semesters.filter((s) => s.courses.some((c) => c.status === "completed")).map(
                    (sem) => (
                      <View
                        key={sem.id}
                        style={{
                          flexDirection: "row",
                          alignItems: "center",
                          justifyContent: "space-between",
                          padding: 12,
                          borderRadius: theme.radius.md,
                          backgroundColor: theme.colors.surface2,
                        }}
                      >
                        <Text style={{ color: theme.colors.text, fontWeight: "600" }}>
                          {sem.name.replace("學年度", "").replace("學期", "")}
                        </Text>
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                          <Text style={{ color: theme.colors.muted, fontSize: 12 }}>
                            {sem.courses.filter((c) => c.status === "completed").reduce((s, c) => s + c.credits, 0)} 學分
                          </Text>
                          <Text style={{ color: theme.colors.accent, fontWeight: "700", fontSize: 16 }}>
                            {sem.gpa.toFixed(2)}
                          </Text>
                        </View>
                      </View>
                    )
                  )}
                </View>
              </AnimatedCard>

              <View style={{ marginTop: 8 }}>
                <Button
                  text="前往學分試算"
                  kind="primary"
                  onPress={() => nav?.navigate?.("CreditAuditStack")}
                />
              </View>
            </View>
          )}
        </ScrollView>
      </View>
    </Screen>
  );
}
