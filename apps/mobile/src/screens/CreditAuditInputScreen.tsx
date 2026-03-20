import React, { useMemo, useState, useEffect, useCallback } from "react";
import { ScrollView, Text, TextInput, View, Alert, Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { buildUserSchoolCollectionPath } from "@campus/shared/src";
import * as DocumentPicker from "expo-document-picker";
import { File, Paths } from "expo-file-system";
import { isAvailableAsync, shareAsync } from "expo-sharing";
import { doc, serverTimestamp, writeBatch } from "firebase/firestore";
import { Screen, Card, Button, Pill, AnimatedCard, Spinner, SegmentedControl } from "../ui/components";
import { TAB_BAR_CONTENT_BOTTOM_PADDING } from "../ui/navigationTheme";
import { theme } from "../ui/theme";
import { calculateCredits, type CreditCategory } from "@campus/shared/src/creditAudit";
import { mockGradRuleTemplateV1, mockCourses, demoEnrollments } from "@campus/shared/src/mockData";
import { useAuth } from "../state/auth";
import { useSchool } from "../state/school";
import { analytics } from "../services/analytics";
import { getDb } from "../firebase";
import { docFromSegments } from "../data/firestorePath";
import { getFirstStorageValue, getScopedStorageKey } from "../services/scopedStorage";

const LEGACY_STORAGE_KEY = "@credit_audit_courses";

type SavedCourse = {
  id: string;
  name: string;
  credits: number;
  category: CreditCategory;
  passed: boolean;
  grade?: string;
  semester?: string;
  createdAt: string;
  syncedToCloud: boolean;
};

function escapeCsvValue(value: string | number | boolean | null | undefined): string {
  const normalized = value == null ? "" : String(value);
  const escaped = normalized.replace(/"/g, "\"\"");
  return /[",\n]/.test(escaped) ? `"${escaped}"` : escaped;
}

function buildCsvContent(courses: SavedCourse[]): string {
  const header = ["課程名稱", "學分", "分類", "成績", "學期", "通過"];
  const rows = courses.map((course) => [
    course.name,
    course.credits,
    course.category,
    course.grade ?? "",
    course.semester ?? "",
    course.passed ? "是" : "否",
  ]);

  return [header, ...rows]
    .map((row) => row.map((cell) => escapeCsvValue(cell)).join(","))
    .join("\r\n");
}

const categories: Array<{ key: CreditCategory; label: string; color: string }> = [
  { key: "required", label: "必修", color: "#EF4444" },
  { key: "elective", label: "選修", color: "#3B82F6" },
  { key: "general", label: "通識", color: "#10B981" },
  { key: "english", label: "英文", color: "#8B5CF6" },
  { key: "other", label: "其他", color: "#F59E0B" },
];

const semesters = [
  "111-1", "111-2", "112-1", "112-2", "113-1", "113-2", "114-1", "114-2",
];

const gradeOptions = ["A+", "A", "A-", "B+", "B", "B-", "C+", "C", "C-", "D", "E", "F"];

export function CreditAuditInputScreen(props: any) {
  const onAdded: ((x: any) => void) | undefined = props?.route?.params?.onAdded;
  const auth = useAuth();
  const { school } = useSchool();

  const [tab, setTab] = useState(0);
  const [name, setName] = useState("");
  const [credits, setCredits] = useState("3");
  const [category, setCategory] = useState<CreditCategory>("elective");
  const [passed, setPassed] = useState(true);
  const [grade, setGrade] = useState("A");
  const [semester, setSemester] = useState("113-1");
  
  const [savedCourses, setSavedCourses] = useState<SavedCourse[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [importing, setImporting] = useState(false);
  const storageKey = useMemo(
    () => getScopedStorageKey("credit-audit-courses", { uid: auth.user?.uid ?? null, schoolId: school.id }),
    [auth.user?.uid, school.id]
  );

  useEffect(() => {
    analytics.logScreenView("CreditAuditInput");
    loadSavedCourses();
  }, [storageKey]);

  const loadSavedCourses = async () => {
    try {
      const stored = await getFirstStorageValue([storageKey, LEGACY_STORAGE_KEY]);
      if (stored) {
        setSavedCourses(JSON.parse(stored));
      }
    } catch (error) {
      console.error("Failed to load saved courses:", error);
    } finally {
      setLoading(false);
    }
  };

  const saveCourses = async (courses: SavedCourse[]) => {
    try {
      await AsyncStorage.setItem(storageKey, JSON.stringify(courses));
    } catch (error) {
      console.error("Failed to save courses:", error);
    }
  };

  const syncCoursesToCloud = useCallback(
    async (courses: SavedCourse[]) => {
      if (!auth.user) {
        throw new Error("請先登入，才能同步到雲端");
      }

      const db = getDb();
      const batch = writeBatch(db);

      for (const course of courses) {
        const enrollmentRef = docFromSegments(db, buildUserSchoolCollectionPath(auth.user.uid, school.id, "enrollments", course.id));
        batch.set(
          enrollmentRef,
          {
            courseId: course.id,
            courseName: course.name,
            credits: course.credits,
            category: course.category,
            schoolId: school.id,
            passed: course.passed,
            grade: course.grade ?? null,
            semester: course.semester ?? null,
            status: "completed",
            source: "credit-audit-input",
            localCreatedAt: course.createdAt,
            updatedAt: serverTimestamp(),
            createdAt: serverTimestamp(),
          },
          { merge: true }
        );
      }

      await batch.commit();
    },
    [auth.user, school.id]
  );

  const preview = useMemo(() => {
    const id = `manual-${Date.now()}`;
    const newCourse = { 
      id, 
      departmentId: "dept-demo-cs", 
      name: name || "（未命名課程）", 
      credits: Number(credits) || 0, 
      category 
    };
    
    const savedCoursesForCalc = savedCourses.map(sc => ({
      id: sc.id,
      departmentId: "dept-demo-cs",
      name: sc.name,
      credits: sc.credits,
      category: sc.category,
    }));
    
    const savedEnrollments = savedCourses.map(sc => ({
      id: `en-${sc.id}`,
      uid: auth.user?.uid || "demo",
      courseId: sc.id,
      status: "completed" as const,
      passed: sc.passed,
    }));
    
    const coursesById = Object.fromEntries(
      [...mockCourses, ...savedCoursesForCalc, newCourse].map((c) => [c.id, c])
    );
    
    const enrollments = [
      ...demoEnrollments,
      ...savedEnrollments,
      { id: `en-${id}`, uid: auth.user?.uid || "demo", courseId: id, status: "completed" as const, passed },
    ];
    
    return calculateCredits({ template: mockGradRuleTemplateV1, coursesById, enrollments });
  }, [name, credits, category, passed, savedCourses, auth.user?.uid]);

  const currentTotals = useMemo(() => {
    const savedCoursesForCalc = savedCourses.map(sc => ({
      id: sc.id,
      departmentId: "dept-demo-cs",
      name: sc.name,
      credits: sc.credits,
      category: sc.category,
    }));
    
    const savedEnrollments = savedCourses.map(sc => ({
      id: `en-${sc.id}`,
      uid: auth.user?.uid || "demo",
      courseId: sc.id,
      status: "completed" as const,
      passed: sc.passed,
    }));
    
    const coursesById = Object.fromEntries(
      [...mockCourses, ...savedCoursesForCalc].map((c) => [c.id, c])
    );
    
    const enrollments = [...demoEnrollments, ...savedEnrollments];
    
    return calculateCredits({ template: mockGradRuleTemplateV1, coursesById, enrollments });
  }, [savedCourses, auth.user?.uid]);

  const handleSaveCourse = async () => {
    if (!name.trim()) {
      Alert.alert("請輸入課程名稱", "課程名稱為必填欄位");
      return;
    }
    
    setSaving(true);
    try {
      const newCourseId = `course-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      const courseDraft = {
        id: newCourseId,
        name: name.trim(),
        credits: Number(credits) || 0,
        category,
        passed,
        grade: passed ? grade : undefined,
        semester,
      };

      let syncedToCloud = false;

      if (auth.user && onAdded) {
        try {
          await Promise.resolve(onAdded(courseDraft));
          syncedToCloud = true;
        } catch (syncError) {
          console.warn("Failed to sync saved course immediately:", syncError);
        }
      }

      const newCourse: SavedCourse = {
        ...courseDraft,
        createdAt: new Date().toISOString(),
        syncedToCloud,
      };
      
      const updatedCourses = [...savedCourses, newCourse];
      setSavedCourses(updatedCourses);
      await saveCourses(updatedCourses);
      
      analytics.logEvent("credit_course_added", {
        category,
        credits: Number(credits),
        passed,
      });

      setName("");
      setCredits("3");
      setCategory("elective");
      setPassed(true);
      setGrade("A");
      
      Alert.alert(
        "已儲存",
        syncedToCloud
          ? `「${newCourse.name}」已加入您的學分記錄，並同步到雲端`
          : `「${newCourse.name}」已加入您的學分記錄`
      );
    } catch (error) {
      Alert.alert("儲存失敗", "請稍後再試");
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteCourse = (courseId: string) => {
    Alert.alert(
      "確認刪除",
      "確定要刪除這門課程嗎？",
      [
        { text: "取消", style: "cancel" },
        {
          text: "刪除",
          style: "destructive",
          onPress: async () => {
            const updatedCourses = savedCourses.filter(c => c.id !== courseId);
            setSavedCourses(updatedCourses);
            await saveCourses(updatedCourses);
          },
        },
      ]
    );
  };

  const handleSyncToCloud = async () => {
    if (!auth.user) {
      Alert.alert("請先登入", "需要登入才能同步到雲端");
      return;
    }
    
    const unsyncedCourses = savedCourses.filter(c => !c.syncedToCloud);
    if (unsyncedCourses.length === 0) {
      Alert.alert("已同步", "所有課程都已同步到雲端");
      return;
    }
    
    setSyncing(true);
    try {
      await syncCoursesToCloud(unsyncedCourses);

      const updatedCourses = savedCourses.map((course) =>
        unsyncedCourses.some((item) => item.id === course.id)
          ? { ...course, syncedToCloud: true }
          : course
      );
      setSavedCourses(updatedCourses);
      await saveCourses(updatedCourses);
      
      analytics.logEvent("credit_courses_synced", {
        count: unsyncedCourses.length,
      });
      
      Alert.alert("同步成功", `已同步 ${unsyncedCourses.length} 門課程到雲端`);
    } catch (error) {
      Alert.alert("同步失敗", error instanceof Error ? error.message : "請稍後再試");
    } finally {
      setSyncing(false);
    }
  };

  const handleExportCSV = useCallback(async () => {
    if (savedCourses.length === 0) {
      Alert.alert("沒有資料", "目前沒有可匯出的課程");
      return;
    }

    try {
      const timestamp = new Date().toISOString().slice(0, 10);
      const file = new File(Paths.cache, `credit-audit-${timestamp}.csv`);
      const csvContent = `\uFEFF${buildCsvContent(savedCourses)}`;

      await file.write(csvContent);

      if (await isAvailableAsync()) {
        await shareAsync(file.uri, {
          mimeType: "text/csv",
          dialogTitle: "匯出學分資料",
          UTI: "public.comma-separated-values-text",
        });
        Alert.alert("匯出成功", "CSV 已建立，並已開啟分享選單");
      } else {
        Alert.alert("匯出成功", `CSV 已儲存至：${file.uri}`);
      }

      analytics.logEvent("credit_courses_exported", {
        count: savedCourses.length,
      });
    } catch (error) {
      console.error("CSV export error:", error);
      Alert.alert("匯出失敗", error instanceof Error ? error.message : "無法匯出 CSV");
    }
  }, [savedCourses]);

  const handleImportCSV = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ["text/csv", "text/comma-separated-values", "application/csv"],
        copyToCacheDirectory: true,
      });
      
      if (result.canceled || !result.assets?.[0]) {
        return;
      }
      
      setImporting(true);
      const file = result.assets[0];
      
      const pickedFile = new File(file.uri);
      const content = await pickedFile.text();
      
      const lines = content.split("\n").filter(line => line.trim());
      if (lines.length < 2) {
        Alert.alert("格式錯誤", "CSV 檔案必須包含標題行和至少一筆資料");
        return;
      }
      
      const headers = lines[0].split(",").map(h => h.trim().toLowerCase());
      const nameIdx = headers.findIndex(h => h.includes("name") || h.includes("課程") || h.includes("名稱"));
      const creditsIdx = headers.findIndex(h => h.includes("credit") || h.includes("學分"));
      const categoryIdx = headers.findIndex(h => h.includes("category") || h.includes("分類") || h.includes("類別"));
      const gradeIdx = headers.findIndex(h => h.includes("grade") || h.includes("成績"));
      const semesterIdx = headers.findIndex(h => h.includes("semester") || h.includes("學期"));
      
      if (nameIdx === -1 || creditsIdx === -1) {
        Alert.alert("格式錯誤", "CSV 必須包含課程名稱和學分欄位");
        return;
      }
      
      const importedCourses: SavedCourse[] = [];
      
      for (let i = 1; i < lines.length; i++) {
        const values = lines[i].split(",").map(v => v.trim());
        if (values.length < 2) continue;
        
        const courseName = values[nameIdx];
        const courseCredits = parseInt(values[creditsIdx]) || 0;
        
        if (!courseName) continue;
        
        let courseCategory: CreditCategory = "elective";
        if (categoryIdx !== -1) {
          const cat = values[categoryIdx]?.toLowerCase();
          if (cat?.includes("必修") || cat?.includes("required")) courseCategory = "required";
          else if (cat?.includes("通識") || cat?.includes("general")) courseCategory = "general";
          else if (cat?.includes("英文") || cat?.includes("english")) courseCategory = "english";
          else if (cat?.includes("其他") || cat?.includes("other")) courseCategory = "other";
        }
        
        const courseGrade = gradeIdx !== -1 ? values[gradeIdx] : "A";
        const courseSemester = semesterIdx !== -1 ? values[semesterIdx] : semester;
        const coursePassed = !courseGrade || !["F", "E"].includes(courseGrade.toUpperCase());
        
        importedCourses.push({
          id: `import-${Date.now()}-${i}-${Math.random().toString(36).substr(2, 5)}`,
          name: courseName,
          credits: courseCredits,
          category: courseCategory,
          passed: coursePassed,
          grade: coursePassed ? courseGrade : undefined,
          semester: courseSemester,
          createdAt: new Date().toISOString(),
          syncedToCloud: false,
        });
      }
      
      if (importedCourses.length === 0) {
        Alert.alert("匯入失敗", "未能從 CSV 中解析出有效的課程資料");
        return;
      }
      
      const updatedCourses = [...savedCourses, ...importedCourses];
      setSavedCourses(updatedCourses);
      await saveCourses(updatedCourses);
      
      analytics.logEvent("credit_courses_imported", {
        count: importedCourses.length,
      });
      
      Alert.alert("匯入成功", `已匯入 ${importedCourses.length} 門課程`);
    } catch (error) {
      console.error("CSV import error:", error);
      Alert.alert("匯入失敗", "讀取檔案時發生錯誤");
    } finally {
      setImporting(false);
    }
  };

  const handleClearAll = () => {
    if (savedCourses.length === 0) {
      Alert.alert("沒有資料", "目前沒有已儲存的課程");
      return;
    }
    
    Alert.alert(
      "清除所有資料",
      `確定要刪除全部 ${savedCourses.length} 門課程嗎？此操作無法復原。`,
      [
        { text: "取消", style: "cancel" },
        {
          text: "清除",
          style: "destructive",
          onPress: async () => {
            setSavedCourses([]);
            await saveCourses([]);
            Alert.alert("已清除", "所有課程資料已刪除");
          },
        },
      ]
    );
  };

  const unsyncedCount = savedCourses.filter(c => !c.syncedToCloud).length;

  const TABS = ["新增課程", "已儲存", "匯入/匯出"];

  if (loading) {
    return (
      <Screen title="學分試算">
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <Spinner size={32} />
          <Text style={{ color: theme.colors.muted, marginTop: 12 }}>載入中...</Text>
        </View>
      </Screen>
    );
  }

  return (
    <Screen title="學分試算" subtitle="管理您的修課紀錄並追蹤畢業學分進度">
      <SegmentedControl options={TABS} selected={tab} onChange={setTab} />
      
      <ScrollView 
        contentContainerStyle={{ gap: 12, paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING, paddingTop: 12 }}
        showsVerticalScrollIndicator={false}
      >
        {tab === 0 && (
          <>
            <AnimatedCard title="新增課程" subtitle="手動輸入修課資訊">
              <Text style={{ color: theme.colors.muted, marginBottom: 4 }}>課程名稱 *</Text>
              <TextInput
                value={name}
                onChangeText={setName}
                placeholder="例如：資料庫系統"
                placeholderTextColor="rgba(168,176,194,0.6)"
                style={{
                  marginTop: 4,
                  paddingVertical: 12,
                  paddingHorizontal: 14,
                  borderRadius: theme.radius.md,
                  borderWidth: 1,
                  borderColor: theme.colors.border,
                  backgroundColor: theme.colors.surface2,
                  color: theme.colors.text,
                  fontSize: 15,
                }}
              />

              <View style={{ height: 12 }} />

              <View style={{ flexDirection: "row", gap: 12 }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: theme.colors.muted, marginBottom: 4 }}>學分</Text>
                  <TextInput
                    value={credits}
                    onChangeText={setCredits}
                    keyboardType="number-pad"
                    style={{
                      marginTop: 4,
                      paddingVertical: 12,
                      paddingHorizontal: 14,
                      borderRadius: theme.radius.md,
                      borderWidth: 1,
                      borderColor: theme.colors.border,
                      backgroundColor: theme.colors.surface2,
                      color: theme.colors.text,
                      fontSize: 15,
                      textAlign: "center",
                    }}
                  />
                </View>
                <View style={{ flex: 2 }}>
                  <Text style={{ color: theme.colors.muted, marginBottom: 4 }}>學期</Text>
                  <ScrollView 
                    horizontal 
                    showsHorizontalScrollIndicator={false}
                    style={{ marginTop: 4 }}
                  >
                    <View style={{ flexDirection: "row", gap: 6 }}>
                      {semesters.map(sem => (
                        <Pressable
                          key={sem}
                          onPress={() => setSemester(sem)}
                          style={{
                            paddingVertical: 10,
                            paddingHorizontal: 12,
                            borderRadius: theme.radius.md,
                            backgroundColor: semester === sem ? theme.colors.accent : theme.colors.surface2,
                          }}
                        >
                          <Text style={{ 
                            color: semester === sem ? "#fff" : theme.colors.text,
                            fontSize: 13,
                            fontWeight: "600",
                          }}>
                            {sem}
                          </Text>
                        </Pressable>
                      ))}
                    </View>
                  </ScrollView>
                </View>
              </View>

              <View style={{ height: 12 }} />

              <Text style={{ color: theme.colors.muted, marginBottom: 4 }}>分類</Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 4 }}>
                {categories.map((c) => (
                  <Pressable 
                    key={c.key}
                    onPress={() => setCategory(c.key)}
                    style={{
                      paddingVertical: 10,
                      paddingHorizontal: 16,
                      borderRadius: theme.radius.md,
                      backgroundColor: category === c.key ? `${c.color}20` : theme.colors.surface2,
                      borderWidth: 1,
                      borderColor: category === c.key ? c.color : theme.colors.border,
                    }}
                  >
                    <Text style={{ 
                      color: category === c.key ? c.color : theme.colors.text,
                      fontWeight: "600",
                    }}>
                      {c.label}
                    </Text>
                  </Pressable>
                ))}
              </View>

              <View style={{ height: 12 }} />

              <Text style={{ color: theme.colors.muted, marginBottom: 4 }}>成績</Text>
              <View style={{ flexDirection: "row", gap: 8, marginTop: 4 }}>
                <View style={{ flex: 1 }}>
                  <Button 
                    text="通過" 
                    kind={passed ? "primary" : "secondary"} 
                    onPress={() => setPassed(true)} 
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Button 
                    text="未通過" 
                    kind={!passed ? "primary" : "secondary"} 
                    onPress={() => setPassed(false)} 
                  />
                </View>
              </View>

              {passed && (
                <View style={{ marginTop: 12 }}>
                  <Text style={{ color: theme.colors.muted, marginBottom: 4 }}>等第成績</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                    <View style={{ flexDirection: "row", gap: 6 }}>
                      {gradeOptions.map(g => (
                        <Pressable
                          key={g}
                          onPress={() => setGrade(g)}
                          style={{
                            width: 44,
                            height: 44,
                            borderRadius: 22,
                            backgroundColor: grade === g ? theme.colors.accent : theme.colors.surface2,
                            alignItems: "center",
                            justifyContent: "center",
                          }}
                        >
                          <Text style={{ 
                            color: grade === g ? "#fff" : theme.colors.text,
                            fontWeight: "700",
                            fontSize: 13,
                          }}>
                            {g}
                          </Text>
                        </Pressable>
                      ))}
                    </View>
                  </ScrollView>
                </View>
              )}

              <View style={{ marginTop: 16 }}>
                <Button
                  text={saving ? "儲存中..." : "儲存課程"}
                  kind="primary"
                  onPress={handleSaveCourse}
                  disabled={saving || !name.trim()}
                />
              </View>
            </AnimatedCard>

            <AnimatedCard title="即時試算預覽" subtitle="加入這門課後的學分變化" delay={100}>
              <View style={{ gap: 12 }}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                  <Text style={{ color: theme.colors.muted }}>目前總學分</Text>
                  <Text style={{ color: theme.colors.text, fontWeight: "700", fontSize: 18 }}>
                    {currentTotals.total.earned} / {currentTotals.total.required}
                  </Text>
                </View>
                
                <View style={{ 
                  height: 8, 
                  backgroundColor: theme.colors.border, 
                  borderRadius: 4,
                  overflow: "hidden",
                }}>
                  <View style={{ 
                    width: `${Math.min((currentTotals.total.earned / currentTotals.total.required) * 100, 100)}%`,
                    height: "100%",
                    backgroundColor: theme.colors.accent,
                    borderRadius: 4,
                  }} />
                </View>
                
                {name.trim() && (
                  <View style={{ 
                    padding: 12, 
                    backgroundColor: theme.colors.accentSoft, 
                    borderRadius: theme.radius.md,
                  }}>
                    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                      <Text style={{ color: theme.colors.accent }}>新增後總學分</Text>
                      <Text style={{ color: theme.colors.accent, fontWeight: "700", fontSize: 18 }}>
                        {preview.total.earned} / {preview.total.required}
                      </Text>
                    </View>
                    <Text style={{ color: theme.colors.accent, fontSize: 12, marginTop: 4 }}>
                      +{Number(credits) || 0} 學分（{categories.find(c => c.key === category)?.label}）
                    </Text>
                  </View>
                )}
                
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                  {categories.map(c => {
                    const catResult = currentTotals.byCategory[c.key];
                    if (!catResult) return null;
                    return (
                      <View 
                        key={c.key}
                        style={{ 
                          padding: 10, 
                          backgroundColor: `${c.color}10`,
                          borderRadius: theme.radius.md,
                          borderWidth: 1,
                          borderColor: `${c.color}30`,
                          minWidth: 80,
                        }}
                      >
                        <Text style={{ color: c.color, fontSize: 11, fontWeight: "600" }}>{c.label}</Text>
                        <Text style={{ color: theme.colors.text, fontSize: 15, fontWeight: "700", marginTop: 2 }}>
                          {catResult.earned}/{catResult.required}
                        </Text>
                      </View>
                    );
                  })}
                </View>
              </View>
            </AnimatedCard>
          </>
        )}

        {tab === 1 && (
          <>
            <AnimatedCard 
              title={`已儲存課程（${savedCourses.length}）`} 
              subtitle={unsyncedCount > 0 ? `${unsyncedCount} 門尚未同步` : "所有課程已同步"}
            >
              {savedCourses.length === 0 ? (
                <View style={{ alignItems: "center", padding: 24 }}>
                  <Ionicons name="school-outline" size={48} color={theme.colors.muted} />
                  <Text style={{ color: theme.colors.muted, marginTop: 12 }}>
                    尚未新增任何課程
                  </Text>
                  <Button 
                    text="新增第一門課程" 
                    onPress={() => setTab(0)} 
                    style={{ marginTop: 12 }}
                  />
                </View>
              ) : (
                <View style={{ gap: 10 }}>
                  {savedCourses.map(course => {
                    const catInfo = categories.find(c => c.key === course.category);
                    return (
                      <View
                        key={course.id}
                        style={{
                          flexDirection: "row",
                          alignItems: "center",
                          padding: 12,
                          backgroundColor: theme.colors.surface2,
                          borderRadius: theme.radius.md,
                          borderWidth: 1,
                          borderColor: theme.colors.border,
                          gap: 12,
                        }}
                      >
                        <View style={{
                          width: 40,
                          height: 40,
                          borderRadius: 20,
                          backgroundColor: `${catInfo?.color || theme.colors.accent}20`,
                          alignItems: "center",
                          justifyContent: "center",
                        }}>
                          <Text style={{ 
                            color: catInfo?.color || theme.colors.accent, 
                            fontWeight: "900",
                            fontSize: 16,
                          }}>
                            {course.credits}
                          </Text>
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={{ color: theme.colors.text, fontWeight: "600" }} numberOfLines={1}>
                            {course.name}
                          </Text>
                          <View style={{ flexDirection: "row", gap: 6, marginTop: 4 }}>
                            <Pill text={catInfo?.label || course.category} />
                            {course.semester && <Pill text={course.semester} />}
                            {course.grade && <Pill text={course.grade} kind="accent" />}
                            {!course.passed && <Pill text="未通過" kind="accent" />}
                          </View>
                        </View>
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                          {course.syncedToCloud ? (
                            <Ionicons name="cloud-done" size={18} color={theme.colors.success} />
                          ) : (
                            <Ionicons name="cloud-offline" size={18} color={theme.colors.muted} />
                          )}
                          <Pressable onPress={() => handleDeleteCourse(course.id)}>
                            <Ionicons name="trash-outline" size={20} color={theme.colors.danger} />
                          </Pressable>
                        </View>
                      </View>
                    );
                  })}
                </View>
              )}
            </AnimatedCard>

            {savedCourses.length > 0 && (
              <AnimatedCard delay={100}>
                <View style={{ gap: 10 }}>
                  <Button
                    text={syncing ? "同步中..." : `同步到雲端${unsyncedCount > 0 ? ` (${unsyncedCount})` : ""}`}
                    kind="primary"
                    onPress={handleSyncToCloud}
                    disabled={syncing || unsyncedCount === 0}
                  />
                  <Button
                    text="清除所有資料"
                    onPress={handleClearAll}
                  />
                </View>
              </AnimatedCard>
            )}
          </>
        )}

        {tab === 2 && (
          <>
            <AnimatedCard title="匯入課程" subtitle="從 CSV 檔案批量匯入">
              <Text style={{ color: theme.colors.muted, lineHeight: 20, marginBottom: 12 }}>
                支援的 CSV 格式：{"\n"}
                課程名稱, 學分, 分類, 成績, 學期{"\n"}
                例如：資料庫系統, 3, 必修, A, 113-1
              </Text>
              <Button
                text={importing ? "匯入中..." : "選擇 CSV 檔案"}
                kind="primary"
                onPress={handleImportCSV}
                disabled={importing}
              />
            </AnimatedCard>

            <AnimatedCard title="同步設定" subtitle="雲端資料同步" delay={100}>
              <View style={{ gap: 12 }}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                  <Text style={{ color: theme.colors.text }}>已儲存課程</Text>
                  <Text style={{ color: theme.colors.muted }}>{savedCourses.length} 門</Text>
                </View>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                  <Text style={{ color: theme.colors.text }}>已同步</Text>
                  <Text style={{ color: theme.colors.success }}>
                    {savedCourses.filter(c => c.syncedToCloud).length} 門
                  </Text>
                </View>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                  <Text style={{ color: theme.colors.text }}>待同步</Text>
                  <Text style={{ color: unsyncedCount > 0 ? "#F59E0B" : theme.colors.muted }}>
                    {unsyncedCount} 門
                  </Text>
                </View>
                
                {auth.user ? (
                  <Button
                    text={syncing ? "同步中..." : "立即同步"}
                    kind="primary"
                    onPress={handleSyncToCloud}
                    disabled={syncing || unsyncedCount === 0}
                  />
                ) : (
                  <View style={{ 
                    padding: 12, 
                    backgroundColor: theme.colors.surface2, 
                    borderRadius: theme.radius.md,
                    alignItems: "center",
                  }}>
                    <Text style={{ color: theme.colors.muted, textAlign: "center" }}>
                      請先登入以啟用雲端同步功能
                    </Text>
                  </View>
                )}
              </View>
            </AnimatedCard>

            <AnimatedCard title="匯出資料" subtitle="將學分資料匯出" delay={200}>
              <Button
                text="匯出為 CSV"
                onPress={handleExportCSV}
                disabled={savedCourses.length === 0}
              />
            </AnimatedCard>
          </>
        )}
      </ScrollView>
    </Screen>
  );
}
