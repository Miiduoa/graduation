/* eslint-disable */
import React, { useMemo, useState, useEffect, useCallback } from "react";
import { ScrollView, Text, TextInput, View, Alert, Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import { File, Paths } from "expo-file-system";
import { isAvailableAsync, shareAsync } from "expo-sharing";
import {
  getCreditAuditStorageKey,
  loadCreditAuditSavedCourses,
  saveCreditAuditSavedCourses,
  syncCreditAuditCoursesToCloud,
  type SavedCourse,
} from "../features/academics";
import { Screen, Card, Button, Pill, AnimatedCard, Spinner, SegmentedControl } from "../ui/components";
import { TAB_BAR_CONTENT_BOTTOM_PADDING } from "../ui/navigationTheme";
import { theme } from "../ui/theme";
import { calculateCredits, calculateDetailedCredits, type CreditCategory, type DetailedGradTemplate } from "@campus/shared/src/creditAudit";
import { mockGradRuleTemplateV1, mockCourses, demoEnrollments } from "@campus/shared/src/mockData";
import {
  puCSIE_115,
  puDetailedTemplates,
  puDepartments,
  flattenCategories,
  mapDetailedToLegacyCategory,
} from "@campus/shared/src/puGradRequirements";
import { useAuth } from "../state/auth";
import { useSchool } from "../state/school";
import { analytics } from "../services/analytics";

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

const legacyCategories: Array<{ key: CreditCategory; label: string; color: string }> = [
  { key: "required", label: "必修", color: "#EF4444" },
  { key: "elective", label: "選修", color: "#3B82F6" },
  { key: "general", label: "通識", color: "#10B981" },
  { key: "english", label: "英文", color: "#8B5CF6" },
  { key: "other", label: "其他", color: "#F59E0B" },
];

const semesters = [
  "111-1", "111-2", "112-1", "112-2", "113-1", "113-2", "114-1", "114-2", "115-1", "115-2",
];

const gradeOptions = ["A+", "A", "A-", "B+", "B", "B-", "C+", "C", "C-", "D", "E", "F"];

/** Map legacy CreditCategory back to a reasonable detailed category key */
function categoryToDetailedKey(cat: CreditCategory): string {
  switch (cat) {
    case "required": return "dept_required";
    case "elective": return "dept_elective";
    case "general": return "university_core";
    case "english": return "university_core";
    case "other": return "other_dept";
    default: return "other_dept";
  }
}

export function CreditAuditInputScreen(props: any) {
  const onAdded: ((x: any) => void) | undefined = props?.route?.params?.onAdded;
  const auth = useAuth();
  const { school } = useSchool();

  const [tab, setTab] = useState(0);
  const [name, setName] = useState("");
  const [credits, setCredits] = useState("3");
  const [category, setCategory] = useState<CreditCategory>("elective");
  const [detailedCatKey, setDetailedCatKey] = useState("dept_elective");
  const [detailedSubKey, setDetailedSubKey] = useState<string | undefined>(undefined);
  const [passed, setPassed] = useState(true);
  const [grade, setGrade] = useState("A");
  const [semester, setSemester] = useState("114-1");

  // Detailed graduation template (default to PU CSIE 115)
  const [selectedTemplateId, setSelectedTemplateId] = useState(puCSIE_115.id);
  const detailedTemplate = useMemo(
    () => puDetailedTemplates.find((t) => t.id === selectedTemplateId) ?? puCSIE_115,
    [selectedTemplateId]
  );
  const detailedCategoryOptions = useMemo(
    () => flattenCategories(detailedTemplate),
    [detailedTemplate]
  );

  // Non-credit requirement satisfaction (persisted per user later)
  const [nonCreditSatisfied, setNonCreditSatisfied] = useState<Record<string, boolean>>({});

  const [savedCourses, setSavedCourses] = useState<SavedCourse[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [importing, setImporting] = useState(false);
  const storageKey = useMemo(
    () => getCreditAuditStorageKey(auth.user?.uid ?? null, school.id),
    [auth.user?.uid, school.id]
  );

  const loadSavedCourses = useCallback(async () => {
    try {
      setSavedCourses(await loadCreditAuditSavedCourses(storageKey));
    } catch (error) {
      console.error("Failed to load saved courses:", error);
    } finally {
      setLoading(false);
    }
  }, [storageKey]);

  useEffect(() => {
    analytics.logScreenView("CreditAuditInput");
    void loadSavedCourses();
  }, [loadSavedCourses]);

  const saveCourses = useCallback(async (courses: SavedCourse[]) => {
    try {
      await saveCreditAuditSavedCourses(storageKey, courses);
    } catch (error) {
      console.error("Failed to save courses:", error);
    }
  }, [storageKey]);

  const syncCoursesToCloud = useCallback(
    async (courses: SavedCourse[]) => {
      if (!auth.user) {
        throw new Error("請先登入，才能同步到雲端");
      }

      await syncCreditAuditCoursesToCloud({
        uid: auth.user.uid,
        schoolId: school.id,
        courses,
      });
    },
    [auth.user, school.id]
  );

  // --- Detailed audit calculations ---
  const savedCoursesForDetailedCalc = useMemo(
    () =>
      savedCourses.map((sc) => ({
        name: sc.name,
        credits: sc.credits,
        categoryKey: (sc as any).detailedCatKey ?? mapDetailedToLegacyCategory((sc as any).detailedCatKey ?? "") !== "other"
          ? ((sc as any).detailedCatKey ?? categoryToDetailedKey(sc.category))
          : categoryToDetailedKey(sc.category),
        subCategoryKey: (sc as any).detailedSubKey,
        passed: sc.passed,
      })),
    [savedCourses]
  );

  const detailedAudit = useMemo(
    () =>
      calculateDetailedCredits({
        template: detailedTemplate,
        courses: savedCoursesForDetailedCalc,
        nonCreditSatisfied,
      }),
    [detailedTemplate, savedCoursesForDetailedCalc, nonCreditSatisfied]
  );

  const detailedPreview = useMemo(() => {
    if (!name.trim()) return detailedAudit;
    const previewCourse = {
      name: name || "（未命名）",
      credits: Number(credits) || 0,
      categoryKey: detailedCatKey,
      subCategoryKey: detailedSubKey,
      passed,
    };
    return calculateDetailedCredits({
      template: detailedTemplate,
      courses: [...savedCoursesForDetailedCalc, previewCourse],
      nonCreditSatisfied,
    });
  }, [name, credits, detailedCatKey, detailedSubKey, passed, detailedTemplate, savedCoursesForDetailedCalc, nonCreditSatisfied, detailedAudit]);

  // Legacy calculation (kept for backward compat)
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
        detailedCatKey,
        detailedSubKey,
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

  const TABS = ["新增課程", "畢業進度", "已儲存", "匯入/匯出"];

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

              <Text style={{ color: theme.colors.muted, marginBottom: 4 }}>學分分類（依 {detailedTemplate.departmentName} 畢業規則）</Text>
              <View style={{ gap: 6, marginTop: 4 }}>
                {detailedTemplate.categories.map((cat) => {
                  const isMainSelected = detailedCatKey === cat.key && !detailedSubKey;
                  const hasSubs = cat.subCategories && cat.subCategories.length > 0;
                  const catColor = cat.color || "#6366F1";
                  return (
                    <View key={cat.key}>
                      <Pressable
                        onPress={() => {
                          setDetailedCatKey(cat.key);
                          setDetailedSubKey(undefined);
                          setCategory(mapDetailedToLegacyCategory(cat.key));
                        }}
                        style={{
                          paddingVertical: 10,
                          paddingHorizontal: 14,
                          borderRadius: theme.radius.md,
                          backgroundColor: detailedCatKey === cat.key ? `${catColor}15` : theme.colors.surface2,
                          borderWidth: 1,
                          borderColor: detailedCatKey === cat.key ? catColor : theme.colors.border,
                          flexDirection: "row",
                          justifyContent: "space-between",
                          alignItems: "center",
                        }}
                      >
                        <Text style={{
                          color: detailedCatKey === cat.key ? catColor : theme.colors.text,
                          fontWeight: "600",
                          fontSize: 14,
                        }}>
                          {cat.label}
                        </Text>
                        <Text style={{ color: theme.colors.muted, fontSize: 12 }}>
                          {cat.minCredits}{cat.maxCredits != null ? `~${cat.maxCredits}` : "+"} 學分
                        </Text>
                      </Pressable>
                      {hasSubs && detailedCatKey === cat.key && (
                        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 6, marginLeft: 12 }}>
                          <View style={{ flexDirection: "row", gap: 6 }}>
                            {cat.subCategories!.map((sub) => {
                              const isSubSel = detailedSubKey === sub.key;
                              return (
                                <Pressable
                                  key={sub.key}
                                  onPress={() => {
                                    setDetailedCatKey(cat.key);
                                    setDetailedSubKey(sub.key);
                                    setCategory(mapDetailedToLegacyCategory(cat.key));
                                  }}
                                  style={{
                                    paddingVertical: 8,
                                    paddingHorizontal: 12,
                                    borderRadius: theme.radius.sm,
                                    backgroundColor: isSubSel ? `${catColor}25` : theme.colors.surface2,
                                    borderWidth: 1,
                                    borderColor: isSubSel ? catColor : theme.colors.border,
                                  }}
                                >
                                  <Text style={{
                                    color: isSubSel ? catColor : theme.colors.muted,
                                    fontSize: 12,
                                    fontWeight: "500",
                                  }}>
                                    {sub.label}
                                  </Text>
                                </Pressable>
                              );
                            })}
                          </View>
                        </ScrollView>
                      )}
                    </View>
                  );
                })}
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

            <AnimatedCard title="即時試算預覽" subtitle={`${detailedTemplate.departmentName} ${detailedTemplate.academicYear} 學年度`} delay={100}>
              <View style={{ gap: 12 }}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                  <Text style={{ color: theme.colors.muted }}>目前總學分</Text>
                  <Text style={{ color: theme.colors.text, fontWeight: "700", fontSize: 18 }}>
                    {detailedAudit.total.earned} / {detailedAudit.total.required}
                  </Text>
                </View>

                <View style={{
                  height: 8,
                  backgroundColor: theme.colors.border,
                  borderRadius: 4,
                  overflow: "hidden",
                }}>
                  <View style={{
                    width: `${Math.min((detailedAudit.total.earned / Math.max(detailedAudit.total.required, 1)) * 100, 100)}%`,
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
                        {detailedPreview.total.earned} / {detailedPreview.total.required}
                      </Text>
                    </View>
                    <Text style={{ color: theme.colors.accent, fontSize: 12, marginTop: 4 }}>
                      +{Number(credits) || 0} 學分（{detailedTemplate.categories.find(c => c.key === detailedCatKey)?.label ?? "其他"}）
                    </Text>
                  </View>
                )}

                <View style={{ gap: 6 }}>
                  {detailedAudit.byCategory.map((cat) => {
                    const catDef = detailedTemplate.categories.find(c => c.key === cat.key);
                    const catColor = catDef?.color || "#6366F1";
                    const pct = cat.required > 0 ? Math.min((cat.earned / cat.required) * 100, 100) : (cat.earned > 0 ? 100 : 0);
                    return (
                      <View
                        key={cat.key}
                        style={{
                          padding: 10,
                          backgroundColor: `${catColor}08`,
                          borderRadius: theme.radius.md,
                          borderWidth: 1,
                          borderColor: `${catColor}20`,
                        }}
                      >
                        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                          <Text style={{ color: catColor, fontSize: 13, fontWeight: "600" }}>{cat.label}</Text>
                          <Text style={{ color: theme.colors.text, fontSize: 14, fontWeight: "700" }}>
                            {cat.earned}/{cat.required}{catDef?.maxCredits != null ? ` (上限${catDef.maxCredits})` : ""}
                          </Text>
                        </View>
                        <View style={{ height: 4, backgroundColor: `${catColor}20`, borderRadius: 2, marginTop: 6 }}>
                          <View style={{ width: `${pct}%`, height: "100%", backgroundColor: catColor, borderRadius: 2 }} />
                        </View>
                      </View>
                    );
                  })}
                </View>

                {detailedAudit.warnings.length > 0 && (
                  <View style={{ padding: 10, backgroundColor: "#FEF3C7", borderRadius: theme.radius.md }}>
                    {detailedAudit.warnings.map((w, i) => (
                      <Text key={i} style={{ color: "#92400E", fontSize: 12, lineHeight: 18 }}>{w}</Text>
                    ))}
                  </View>
                )}
              </View>
            </AnimatedCard>
          </>
        )}

        {tab === 1 && (
          <>
            {/* 系所選擇 */}
            <AnimatedCard title="畢業規則" subtitle={`${detailedTemplate.schoolName} — ${detailedTemplate.departmentName}`}>
              <View style={{ gap: 8 }}>
                <Text style={{ color: theme.colors.muted, fontSize: 12 }}>
                  {detailedTemplate.academicYear} 學年度入學 ／ {detailedTemplate.division} ／ {detailedTemplate.studentType}
                </Text>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 4 }}>
                  <Text style={{ color: theme.colors.text, fontWeight: "600" }}>畢業總學分</Text>
                  <Text style={{ color: theme.colors.accent, fontWeight: "900", fontSize: 22 }}>
                    {detailedAudit.total.earned} / {detailedTemplate.totalCreditsRequired}
                  </Text>
                </View>
                <View style={{ height: 10, backgroundColor: theme.colors.border, borderRadius: 5, overflow: "hidden" }}>
                  <View style={{
                    width: `${Math.min((detailedAudit.total.earned / Math.max(detailedTemplate.totalCreditsRequired, 1)) * 100, 100)}%`,
                    height: "100%",
                    backgroundColor: detailedAudit.satisfied ? "#10B981" : theme.colors.accent,
                    borderRadius: 5,
                  }} />
                </View>
                <Text style={{ color: theme.colors.muted, fontSize: 12, textAlign: "right" }}>
                  {detailedAudit.total.remaining > 0 ? `還需 ${detailedAudit.total.remaining} 學分` : "已達標！"}
                </Text>
              </View>
            </AnimatedCard>

            {/* 各分類詳細進度 */}
            {detailedAudit.byCategory.map((cat, idx) => {
              const catDef = detailedTemplate.categories.find(c => c.key === cat.key);
              const catColor = catDef?.color || "#6366F1";
              const pct = cat.required > 0 ? Math.min((cat.earned / cat.required) * 100, 100) : (cat.earned > 0 ? 100 : 0);
              return (
                <AnimatedCard
                  key={cat.key}
                  title={cat.label}
                  subtitle={`${cat.earned}/${cat.required} 學分${cat.remaining > 0 ? `（差 ${cat.remaining}）` : " ✓"}`}
                  delay={idx * 60}
                >
                  <View style={{ gap: 8 }}>
                    <View style={{ height: 6, backgroundColor: `${catColor}20`, borderRadius: 3 }}>
                      <View style={{ width: `${pct}%`, height: "100%", backgroundColor: catColor, borderRadius: 3 }} />
                    </View>

                    {catDef?.notes && (
                      <Text style={{ color: theme.colors.muted, fontSize: 11, lineHeight: 16 }}>{catDef.notes}</Text>
                    )}

                    {cat.subCategories && cat.subCategories.length > 0 && (
                      <View style={{ gap: 6, marginTop: 4 }}>
                        {cat.subCategories.map((sub) => {
                          const subPct = sub.required > 0 ? Math.min((sub.earned / sub.required) * 100, 100) : (sub.earned > 0 ? 100 : 0);
                          return (
                            <View key={sub.key} style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                              <View style={{ flex: 1 }}>
                                <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                                  <Text style={{ color: theme.colors.text, fontSize: 12, fontWeight: "500" }}>{sub.label}</Text>
                                  <Text style={{ color: theme.colors.muted, fontSize: 12 }}>{sub.earned}/{sub.required}</Text>
                                </View>
                                <View style={{ height: 3, backgroundColor: `${catColor}15`, borderRadius: 2, marginTop: 3 }}>
                                  <View style={{ width: `${subPct}%`, height: "100%", backgroundColor: `${catColor}80`, borderRadius: 2 }} />
                                </View>
                              </View>
                              {sub.remaining <= 0 && sub.required > 0 && (
                                <Ionicons name="checkmark-circle" size={16} color="#10B981" />
                              )}
                            </View>
                          );
                        })}
                      </View>
                    )}

                    {catDef?.courses && catDef.courses.length > 0 && (
                      <View style={{ marginTop: 4 }}>
                        <Text style={{ color: theme.colors.muted, fontSize: 11, fontWeight: "600", marginBottom: 4 }}>
                          課程清單（{catDef.courses.filter(c => c.required).length} 門必修）
                        </Text>
                        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 4 }}>
                          {catDef.courses.filter(c => c.required).map((c, i) => (
                            <View key={i} style={{
                              paddingVertical: 4,
                              paddingHorizontal: 8,
                              backgroundColor: `${catColor}10`,
                              borderRadius: theme.radius.sm,
                            }}>
                              <Text style={{ color: catColor, fontSize: 11 }}>{c.name} ({c.credits})</Text>
                            </View>
                          ))}
                        </View>
                      </View>
                    )}
                  </View>
                </AnimatedCard>
              );
            })}

            {/* 非學分畢業條件 */}
            <AnimatedCard
              title="其他畢業條件"
              subtitle="非學分認證要求"
              delay={detailedAudit.byCategory.length * 60}
            >
              <View style={{ gap: 10 }}>
                {detailedTemplate.nonCreditRequirements.map((req) => {
                  const satisfied = nonCreditSatisfied[req.key] ?? false;
                  return (
                    <Pressable
                      key={req.key}
                      onPress={() => {
                        setNonCreditSatisfied((prev) => ({
                          ...prev,
                          [req.key]: !prev[req.key],
                        }));
                      }}
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        padding: 12,
                        backgroundColor: satisfied ? "#10B98110" : theme.colors.surface2,
                        borderRadius: theme.radius.md,
                        borderWidth: 1,
                        borderColor: satisfied ? "#10B98140" : theme.colors.border,
                        gap: 12,
                      }}
                    >
                      <Ionicons
                        name={satisfied ? "checkmark-circle" : "ellipse-outline"}
                        size={24}
                        color={satisfied ? "#10B981" : theme.colors.muted}
                      />
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: theme.colors.text, fontWeight: "600", fontSize: 14 }}>{req.label}</Text>
                        <Text style={{ color: theme.colors.muted, fontSize: 12, marginTop: 2, lineHeight: 16 }}>
                          {req.description}
                        </Text>
                        {req.alternatives && req.alternatives.length > 0 && (
                          <Text style={{ color: theme.colors.muted, fontSize: 11, marginTop: 4, fontStyle: "italic" }}>
                            替代方案：{req.alternatives.join("、")}
                          </Text>
                        )}
                      </View>
                    </Pressable>
                  );
                })}
                <Text style={{ color: theme.colors.muted, fontSize: 11, textAlign: "center" }}>
                  點擊可切換完成狀態
                </Text>
              </View>
            </AnimatedCard>

            {/* 附註 */}
            {detailedTemplate.otherRules && detailedTemplate.otherRules.length > 0 && (
              <AnimatedCard title="附註" delay={detailedAudit.byCategory.length * 60 + 60}>
                <View style={{ gap: 6 }}>
                  {detailedTemplate.otherRules.map((rule, i) => (
                    <View key={i} style={{ flexDirection: "row", gap: 6 }}>
                      <Text style={{ color: theme.colors.muted, fontSize: 12 }}>•</Text>
                      <Text style={{ color: theme.colors.muted, fontSize: 12, flex: 1, lineHeight: 18 }}>{rule}</Text>
                    </View>
                  ))}
                </View>
              </AnimatedCard>
            )}
          </>
        )}

        {tab === 2 && (
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
                    const catInfo = legacyCategories.find(c => c.key === course.category);
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

        {tab === 3 && (
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
