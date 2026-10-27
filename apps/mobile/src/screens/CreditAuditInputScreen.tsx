/* eslint-disable */
import React, { useMemo, useState, useEffect, useCallback, useRef } from 'react';
import { ScrollView, Text, TextInput, View, Alert, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';
import { isAvailableAsync, shareAsync } from 'expo-sharing';
import {
  getCreditAuditStorageKey,
  getCreditChecklistStorageKey,
  loadCreditChecklistStatus,
  saveCreditChecklistStatus,
  loadCreditAuditSavedCourses,
  saveCreditAuditSavedCourses,
  syncCreditAuditCoursesToCloud,
  type SavedCourse,
} from '../features/academics';
import {
  Screen,
  Card,
  Button,
  Pill,
  AnimatedCard,
  Spinner,
  SegmentedControl,
} from '../ui/components';
import { TAB_BAR_CONTENT_BOTTOM_PADDING } from '../ui/navigationTheme';
import { theme } from '../ui/theme';
import {
  calculateDetailedCredits,
  type CreditCategory,
} from '@campus/shared/src/creditAudit';
import {
  puCSIE_115,
  flattenCategories,
  mapDetailedToLegacyCategory,
} from '@campus/shared/src/puGradRequirements';
import { useAuth } from '../state/auth';
import { useSchool } from '../state/school';
import { analytics } from '../services/analytics';
import {
  exportManualCreditCsv,
  manualCreditAmount,
  manualCreditProgress,
  mayOfferPuCsie115Reference,
  parseManualCreditCsv,
  validCourseName,
} from './creditAudit/manualCreditCourses';

const legacyCategories: Array<{ key: CreditCategory; label: string; color: string }> = [
  { key: 'required', label: '必修', color: '#FF3B30' },
  { key: 'elective', label: '選修', color: theme.colors.accent },
  { key: 'general', label: '通識', color: '#34C759' },
  { key: 'english', label: '英文', color: '#AF52DE' },
  { key: 'other', label: '其他', color: '#FF9500' },
];

/** 歷年學期仍可選，目前學年會排在前面。 */
function localAcademicTerm(now = new Date()): { year: number; semester: 1 | 2 } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: 'numeric',
  }).formatToParts(now);
  const calendarYear = Number(parts.find((part) => part.type === 'year')?.value);
  const month = Number(parts.find((part) => part.type === 'month')?.value);
  const year = calendarYear - 1911 - (month < 8 ? 1 : 0);
  return { year, semester: month >= 8 || month <= 1 ? 1 : 2 };
}

const currentTerm = localAcademicTerm();
const semesters = Array.from({ length: 13 }, (_, offset) => currentTerm.year + 2 - offset)
  .flatMap((year) => [`${year}-1`, `${year}-2`]);

const gradeOptions = ['A+', 'A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'C-', 'D', 'E', 'F'];

/** Map legacy CreditCategory back to a reasonable detailed category key */
function categoryToDetailedKey(cat: CreditCategory): string {
  switch (cat) {
    case 'required':
      return 'dept_required';
    case 'elective':
      return 'dept_elective';
    case 'general':
      return 'university_core';
    case 'english':
      return 'university_core';
    case 'other':
      return 'other_dept';
    default:
      return 'other_dept';
  }
}

export function CreditAuditInputScreen(props: any) {
  const onAdded: ((x: any) => void) | undefined = props?.route?.params?.onAdded;
  const auth = useAuth();
  const { school } = useSchool();

  const [tab, setTab] = useState(0);
  const [name, setName] = useState('');
  const [credits, setCredits] = useState('3');
  const [category, setCategory] = useState<CreditCategory>('elective');
  const [detailedCatKey, setDetailedCatKey] = useState('dept_elective');
  const [detailedSubKey, setDetailedSubKey] = useState<string | undefined>(undefined);
  const [passed, setPassed] = useState(false);
  const [grade, setGrade] = useState('');
  const [semester, setSemester] = useState(`${currentTerm.year}-${currentTerm.semester}`);

  // 內建範本只有靜宜資工 115。不可默默套到別系、別屆、別的帳號或校區當畢業審核。
  const [referenceEnabled, setReferenceEnabled] = useState(false);
  const canUseReference = mayOfferPuCsie115Reference(school.id, auth.profile?.department);
  const referenceActive = canUseReference && referenceEnabled;
  const detailedTemplate = puCSIE_115;
  const detailedCategoryOptions = useMemo(
    () => flattenCategories(detailedTemplate),
    [detailedTemplate],
  );

  // 對照清單的勾選狀態只屬於這個帳號、校區與範本。
  const [nonCreditSatisfied, setNonCreditSatisfied] = useState<Record<string, boolean>>({});

  const [savedCourses, setSavedCourses] = useState<SavedCourse[]>([]);
  const [loadedScope, setLoadedScope] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const requestIdRef = useRef(0);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [importing, setImporting] = useState(false);
  const storageKey = useMemo(
    () => getCreditAuditStorageKey(auth.user?.uid ?? null, school.id),
    [auth.user?.uid, school.id],
  );
  const checklistKey = useMemo(
    () => getCreditChecklistStorageKey(auth.user?.uid ?? null, school.id, detailedTemplate.id),
    [auth.user?.uid, school.id, detailedTemplate.id],
  );

  const activeScope = useRef(storageKey);
  activeScope.current = storageKey;
  const [loadError, setLoadError] = useState<string | null>(null);

  const loadSavedCourses = useCallback(async () => {
    const request = ++requestIdRef.current;
    setLoading(true);
    setLoadedScope(null);
    setSavedCourses([]);
    setLoadError(null);
    try {
      const [rows, checklist] = await Promise.all([
        loadCreditAuditSavedCourses(storageKey),
        loadCreditChecklistStatus(checklistKey),
      ]);
      if (request !== requestIdRef.current) return;
      if (!Array.isArray(rows)) throw new Error('儲存格式錯誤');
      setSavedCourses(rows);
      setNonCreditSatisfied(checklist);
    } catch {
      if (request !== requestIdRef.current) return;
      setLoadError('本機課程資料無法讀取，這次不會以空資料覆寫原紀錄。');
    } finally {
      if (request === requestIdRef.current) {
        setLoadedScope(storageKey);
        setLoading(false);
      }
    }
  }, [storageKey, checklistKey]);

  useEffect(() => {
    analytics.logScreenView('CreditAuditInput');
    setReferenceEnabled(false);
    setNonCreditSatisfied({});
    void loadSavedCourses();
    return () => { requestIdRef.current += 1; };
  }, [loadSavedCourses]);

  const saveCourses = useCallback(
    (courses: SavedCourse[]) => saveCreditAuditSavedCourses(storageKey, courses),
    [storageKey],
  );

  const syncCoursesToCloud = useCallback(
    async (courses: SavedCourse[]) => {
      if (!auth.user) {
        throw new Error('請先登入，才能同步到雲端');
      }

      await syncCreditAuditCoursesToCloud({
        uid: auth.user.uid,
        schoolId: school.id,
        courses,
      });
    },
    [auth.user, school.id],
  );

  // --- Detailed audit calculations ---
  const savedCoursesForDetailedCalc = useMemo(
    () =>
      savedCourses.map((sc) => ({
        name: sc.name,
        credits: sc.credits,
        categoryKey: referenceActive && sc.detailedCatKey
          ? sc.detailedCatKey
          : categoryToDetailedKey(sc.category),
        subCategoryKey: referenceActive ? sc.detailedSubKey : undefined,
        passed: sc.passed,
      })),
    [savedCourses, referenceActive],
  );

  const detailedAudit = useMemo(
    () =>
      calculateDetailedCredits({
        template: detailedTemplate,
        courses: savedCoursesForDetailedCalc,
        nonCreditSatisfied,
      }),
    [detailedTemplate, savedCoursesForDetailedCalc, nonCreditSatisfied],
  );

  const detailedPreview = useMemo(() => {
    if (!name.trim()) return detailedAudit;
    const previewCourse = {
      name: name || '（未命名）',
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
  }, [
    name,
    credits,
    detailedCatKey,
    detailedSubKey,
    passed,
    detailedTemplate,
    savedCoursesForDetailedCalc,
    nonCreditSatisfied,
    detailedAudit,
  ]);

  const personalProgress = useMemo(() => manualCreditProgress(savedCourses), [savedCourses]);

  const handleSaveCourse = async () => {
    if (!validCourseName(name)) {
      Alert.alert('請檢查課程名稱', '請輸入 1–80 字的課程名稱');
      return;
    }
    const validCredits = manualCreditAmount(credits);
    if (validCredits === null) {
      Alert.alert('請檢查學分', '每門課應為 0.01–30 學分，最多兩位小數');
      return;
    }
    if (passed && ['E', 'F'].includes(grade.toUpperCase())) {
      Alert.alert('通過狀態與成績不一致', '請重新核對自行填寫的課程狀態。');
      return;
    }

    setSaving(true);
    try {
      const newCourseId = `course-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      const courseDraft = {
        id: newCourseId,
        name: name.trim(),
        credits: validCredits,
        category,
        detailedCatKey,
        detailedSubKey,
        passed,
        grade: passed && grade ? grade : undefined,
        semester,
      };

      let syncedToCloud = false;

      if (auth.user && onAdded) {
        try {
          await Promise.resolve(onAdded(courseDraft));
          syncedToCloud = true;
        } catch (syncError) {
          console.warn('Failed to sync saved course immediately:', syncError);
        }
      }

      const newCourse: SavedCourse = {
        ...courseDraft,
        createdAt: new Date().toISOString(),
        syncedToCloud,
      };

      const updatedCourses = [...savedCourses, newCourse];
      const savingScope = storageKey;
      await saveCourses(updatedCourses);
      if (activeScope.current !== savingScope) return;
      setSavedCourses(updatedCourses);

      analytics.logEvent('credit_course_added', {
        category,
        credits: validCredits,
        passed,
      });

      setName('');
      setCredits('3');
      setCategory('elective');
      setPassed(false);
      setGrade('');

      Alert.alert(
        '已儲存',
        syncedToCloud
          ? `「${newCourse.name}」已加入您的學分記錄，並同步到雲端`
          : `「${newCourse.name}」已加入您的學分記錄`,
      );
    } catch (error) {
      Alert.alert('儲存失敗', '請稍後再試');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteCourse = (courseId: string) => {
    Alert.alert('確認刪除', '確定刪除這門本機課程？已同步的雲端紀錄不會跟著刪除。', [
      { text: '取消', style: 'cancel' },
      {
        text: '刪除',
        style: 'destructive',
        onPress: async () => {
          const updatedCourses = savedCourses.filter((c) => c.id !== courseId);
          const savingScope = storageKey;
          try {
            await saveCourses(updatedCourses);
            if (activeScope.current === savingScope) setSavedCourses(updatedCourses);
          } catch {
            Alert.alert('刪除失敗', '這次未能更新本機紀錄，請重試。');
          }
        },
      },
    ]);
  };

  const handleSyncToCloud = async () => {
    if (!auth.user) {
      Alert.alert('請先登入', '需要登入才能同步到雲端');
      return;
    }

    const unsyncedCourses = savedCourses.filter((c) => !c.syncedToCloud);
    if (unsyncedCourses.length === 0) {
      Alert.alert('已同步', '所有課程都已同步到雲端');
      return;
    }

    setSyncing(true);
    try {
      await syncCoursesToCloud(unsyncedCourses);

      const updatedCourses = savedCourses.map((course) =>
        unsyncedCourses.some((item) => item.id === course.id)
          ? { ...course, syncedToCloud: true }
          : course,
      );
      const savingScope = storageKey;
      await saveCourses(updatedCourses);
      if (activeScope.current !== savingScope) return;
      setSavedCourses(updatedCourses);

      analytics.logEvent('credit_courses_synced', {
        count: unsyncedCourses.length,
      });

      Alert.alert('同步成功', `已同步 ${unsyncedCourses.length} 門課程到雲端`);
    } catch (error) {
      Alert.alert('同步狀態未確認', '可能已寫入雲端，但本機同步狀態尚未保存。請先核對，避免重複操作。');
    } finally {
      setSyncing(false);
    }
  };

  const handleExportCSV = useCallback(async () => {
    if (savedCourses.length === 0) {
      Alert.alert('沒有資料', '目前沒有可匯出的課程');
      return;
    }

    try {
      const timestamp = new Date().toISOString().slice(0, 10);
      const file = new File(Paths.cache, `credit-audit-${timestamp}.csv`);
      const csvContent = exportManualCreditCsv(savedCourses);

      await file.write(csvContent);

      if (await isAvailableAsync()) {
        await shareAsync(file.uri, {
          mimeType: 'text/csv',
          dialogTitle: '匯出學分資料',
          UTI: 'public.comma-separated-values-text',
        });
        Alert.alert('匯出成功', 'CSV 已建立，並已開啟分享選單');
      } else {
        Alert.alert('匯出成功', `CSV 已儲存至：${file.uri}`);
      }

      analytics.logEvent('credit_courses_exported', {
        count: savedCourses.length,
      });
    } catch (error) {
      console.error('CSV export error:', error);
      Alert.alert('匯出失敗', error instanceof Error ? error.message : '無法匯出 CSV');
    }
  }, [savedCourses]);

  const handleImportCSV = async () => {
    const selectedScope = storageKey;
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['text/csv', 'text/comma-separated-values', 'application/csv'],
        copyToCacheDirectory: true,
      });
      if (result.canceled || !result.assets?.[0] || activeScope.current !== selectedScope) return;
      const file = result.assets[0];
      if (file.size != null && file.size > 600_000) {
        Alert.alert('檔案過大', '每次最多匯入約 600 KB，請先分批整理。');
        return;
      }
      setImporting(true);
      const content = await new File(file.uri).text();
      const parsed = parseManualCreditCsv(content);
      if (activeScope.current !== selectedScope) return;
      const note = [
        `辨識到 ${parsed.courses.length} 門課程。`,
        parsed.skipped ? `已略過 ${parsed.skipped} 筆非課程或無效資料。` : '',
        parsed.missingPassEvidence
          ? `其中 ${parsed.missingPassEvidence} 門沒有明確「通過」標記，將暫不計入自行標示通過的學分。`
          : '',
        '匯入只是個人紀錄，不代表學校正式採計。',
      ].filter(Boolean).join('\n');
      Alert.alert('確認匯入課程', note, [
        { text: '取消', style: 'cancel' },
        {
          text: `匯入 ${parsed.courses.length} 門`,
          onPress: async () => {
            if (activeScope.current !== selectedScope) return;
            const now = new Date().toISOString();
            const importedCourses: SavedCourse[] = parsed.courses.map((course, index) => ({
              ...course,
              id: `import-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 7)}`,
              createdAt: now,
              syncedToCloud: false,
            }));
            const next = [...savedCourses, ...importedCourses];
            try {
              await saveCourses(next);
              if (activeScope.current !== selectedScope) return;
              setSavedCourses(next);
              analytics.logEvent('credit_courses_imported', { count: importedCourses.length });
              Alert.alert('匯入完成', `已儲存 ${importedCourses.length} 門本機課程，尚未同步雲端。`);
            } catch {
              Alert.alert('匯入失敗', '本機儲存未完成，現有課程仍保留。');
            }
          },
        },
      ]);
    } catch (error) {
      Alert.alert('匯入失敗', error instanceof Error ? error.message : '無法解析這份 CSV');
    } finally {
      setImporting(false);
    }
  };

  const handleClearAll = () => {
    if (savedCourses.length === 0) {
      Alert.alert('沒有資料', '目前沒有已儲存的課程');
      return;
    }

    Alert.alert(
      '清除所有資料',
      `確定清除本機的 ${savedCourses.length} 門課程？這不會刪除之前同步到雲端的紀錄。`,
      [
        { text: '取消', style: 'cancel' },
        {
          text: '清除',
          style: 'destructive',
          onPress: async () => {
            const savingScope = storageKey;
            try {
              await saveCourses([]);
              if (activeScope.current !== savingScope) return;
              setSavedCourses([]);
              Alert.alert('已清除本機資料', '本機課程已清除；先前同步到雲端的資料不會跟著刪除。');
            } catch {
              Alert.alert('清除失敗', '無法更新本機紀錄，請重新操作。');
            }
          },
        },
      ],
    );
  };

  const unsyncedCount = savedCourses.filter((c) => !c.syncedToCloud).length;

  const TABS = ['新增課程', '修課概覽', '已儲存', '匯入/匯出'];

  if (loading || loadedScope !== storageKey) {
    return (
      <Screen title="學分試算">
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <Spinner size={32} />
          <Text style={{ color: theme.colors.muted, marginTop: 12 }}>載入中...</Text>
        </View>
      </Screen>
    );
  }
  if (loadError) {
    return (
      <Screen title="個人學分規劃">
        <View style={{ padding: 24, gap: 14 }}>
          <Text style={{ color: theme.colors.text, fontSize: 16, lineHeight: 24 }}>
            {loadError}
          </Text>
          <Button text="重新讀取本機課程" kind="primary" onPress={() => void loadSavedCourses()} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen title="學分試算" subtitle="管理您的修課紀錄並追蹤畢業學分進度">
      <SegmentedControl options={TABS} selected={tab} onChange={setTab} />

      <ScrollView
        contentContainerStyle={{
          gap: 12,
          paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING,
          paddingTop: 12,
        }}
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

              <View style={{ flexDirection: 'row', gap: 12 }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: theme.colors.muted, marginBottom: 4 }}>學分</Text>
                  <TextInput
                    value={credits}
                    onChangeText={setCredits}
                    keyboardType="decimal-pad"
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
                      textAlign: 'center',
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
                    <View style={{ flexDirection: 'row', gap: 6 }}>
                      {semesters.map((sem) => (
                        <Pressable
                          key={sem}
                          onPress={() => setSemester(sem)}
                          style={{
                            paddingVertical: 10,
                            paddingHorizontal: 12,
                            borderRadius: theme.radius.md,
                            backgroundColor:
                              semester === sem ? theme.colors.accent : theme.colors.surface2,
                          }}
                        >
                          <Text
                            style={{
                              color: semester === sem ? '#fff' : theme.colors.text,
                              fontSize: 13,
                              fontWeight: '600',
                            }}
                          >
                            {sem}
                          </Text>
                        </Pressable>
                      ))}
                    </View>
                  </ScrollView>
                </View>
              </View>

              <View style={{ height: 12 }} />

              <Text style={{ color: theme.colors.muted, marginBottom: 4 }}>
                {referenceActive ? '參考學程分類（自行標示，非校方認列）' : '個人課程分類（自行標示）'}
              </Text>
              {referenceActive ? (
              <View style={{ gap: 6, marginTop: 4 }}>
                {detailedTemplate.categories.map((cat) => {
                  const isMainSelected = detailedCatKey === cat.key && !detailedSubKey;
                  const hasSubs = cat.subCategories && cat.subCategories.length > 0;
                  const catColor = cat.color || theme.colors.accent;
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
                          backgroundColor:
                            detailedCatKey === cat.key ? `${catColor}15` : theme.colors.surface2,
                          borderWidth: 1,
                          borderColor: detailedCatKey === cat.key ? catColor : theme.colors.border,
                          flexDirection: 'row',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                        }}
                      >
                        <Text
                          style={{
                            color: detailedCatKey === cat.key ? catColor : theme.colors.text,
                            fontWeight: '600',
                            fontSize: 14,
                          }}
                        >
                          {cat.label}
                        </Text>
                        <Text style={{ color: theme.colors.muted, fontSize: 12 }}>
                          {cat.minCredits}
                          {cat.maxCredits != null ? `~${cat.maxCredits}` : '+'} 學分
                        </Text>
                      </Pressable>
                      {hasSubs && detailedCatKey === cat.key && (
                        <ScrollView
                          horizontal
                          showsHorizontalScrollIndicator={false}
                          style={{ marginTop: 6, marginLeft: 12 }}
                        >
                          <View style={{ flexDirection: 'row', gap: 6 }}>
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
                                    backgroundColor: isSubSel
                                      ? `${catColor}25`
                                      : theme.colors.surface2,
                                    borderWidth: 1,
                                    borderColor: isSubSel ? catColor : theme.colors.border,
                                  }}
                                >
                                  <Text
                                    style={{
                                      color: isSubSel ? catColor : theme.colors.muted,
                                      fontSize: 12,
                                      fontWeight: '500',
                                    }}
                                  >
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

              ) : (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 }}>
                {legacyCategories.map((entry) => (
                  <Pressable
                    key={entry.key}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: category === entry.key }}
                    accessibilityLabel={entry.label}
                    onPress={() => {
                      setCategory(entry.key);
                      setDetailedCatKey(categoryToDetailedKey(entry.key));
                      setDetailedSubKey(undefined);
                    }}
                    style={{
                      minHeight: 44,
                      justifyContent: 'center',
                      paddingHorizontal: 16,
                      borderRadius: theme.radius.md,
                      borderWidth: 1,
                      borderColor: category === entry.key ? theme.colors.accent : theme.colors.border,
                      backgroundColor: category === entry.key ? theme.colors.accentSoft : theme.colors.surface2,
                    }}
                  >
                    <Text style={{ color: theme.colors.text, fontWeight: category === entry.key ? '700' : '500' }}>
                      {entry.label}
                    </Text>
                  </Pressable>
                ))}
              </View>
              )}

              <View style={{ height: 12 }} />

              <Text style={{ color: theme.colors.muted, marginBottom: 4 }}>
                通過狀態（自行確認，不代表校方已認列）
              </Text>
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 4 }}>
                <View style={{ flex: 1 }}>
                  <Button
                    text="已確認通過"
                    kind={passed ? 'primary' : 'secondary'}
                    onPress={() => setPassed(true)}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Button
                    text="尚未確認／未通過"
                    kind={!passed ? 'primary' : 'secondary'}
                    onPress={() => setPassed(false)}
                  />
                </View>
              </View>

              {passed && (
                <View style={{ marginTop: 12 }}>
                  <Text style={{ color: theme.colors.muted, marginBottom: 4 }}>
                    等第成績（可留空，不自動填 A）
                  </Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                    <View style={{ flexDirection: 'row', gap: 6 }}>
                      {gradeOptions.map((g) => (
                        <Pressable
                          key={g}
                          onPress={() => setGrade(g)}
                          style={{
                            width: 44,
                            height: 44,
                            borderRadius: 22,
                            backgroundColor:
                              grade === g ? theme.colors.accent : theme.colors.surface2,
                            alignItems: 'center',
                            justifyContent: 'center',
                          }}
                        >
                          <Text
                            style={{
                              color: grade === g ? '#fff' : theme.colors.text,
                              fontWeight: '700',
                              fontSize: 13,
                            }}
                          >
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
                  text={saving ? '儲存中...' : '儲存課程'}
                  kind="primary"
                  onPress={handleSaveCourse}
                  disabled={saving || !name.trim()}
                />
              </View>
            </AnimatedCard>

            {referenceActive ? (
            <AnimatedCard
              title="115 入學資工系參考情境"
              subtitle={`${detailedTemplate.departmentName} ${detailedTemplate.academicYear} 學年度`}
              delay={100}
            >
              <View style={{ gap: 12 }}>
                <View
                  style={{
                    flexDirection: 'row',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  <Text style={{ color: theme.colors.muted }}>目前總學分</Text>
                  <Text style={{ color: theme.colors.text, fontWeight: '700', fontSize: 18 }}>
                    {detailedAudit.total.earned} / {detailedAudit.total.required}
                  </Text>
                </View>

                <View
                  style={{
                    height: 8,
                    backgroundColor: theme.colors.border,
                    borderRadius: 4,
                    overflow: 'hidden',
                  }}
                >
                  <View
                    style={{
                      width: `${Math.min((detailedAudit.total.earned / Math.max(detailedAudit.total.required, 1)) * 100, 100)}%`,
                      height: '100%',
                      backgroundColor: theme.colors.accent,
                      borderRadius: 4,
                    }}
                  />
                </View>

                {name.trim() && (
                  <View
                    style={{
                      padding: 12,
                      backgroundColor: theme.colors.accentSoft,
                      borderRadius: theme.radius.md,
                    }}
                  >
                    <View
                      style={{
                        flexDirection: 'row',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                      }}
                    >
                      <Text style={{ color: theme.colors.accent }}>新增後總學分</Text>
                      <Text style={{ color: theme.colors.accent, fontWeight: '700', fontSize: 18 }}>
                        {detailedPreview.total.earned} / {detailedPreview.total.required}
                      </Text>
                    </View>
                    <Text style={{ color: theme.colors.accent, fontSize: 12, marginTop: 4 }}>
                      +{Number(credits) || 0} 學分（
                      {detailedTemplate.categories.find((c) => c.key === detailedCatKey)?.label ??
                        '其他'}
                      ）
                    </Text>
                  </View>
                )}

                <View style={{ gap: 6 }}>
                  {detailedAudit.byCategory.map((cat) => {
                    const catDef = detailedTemplate.categories.find((c) => c.key === cat.key);
                    const catColor = catDef?.color || theme.colors.accent;
                    const pct =
                      cat.required > 0
                        ? Math.min((cat.earned / cat.required) * 100, 100)
                        : cat.earned > 0
                          ? 100
                          : 0;
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
                        <View
                          style={{
                            flexDirection: 'row',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                          }}
                        >
                          <Text style={{ color: catColor, fontSize: 13, fontWeight: '600' }}>
                            {cat.label}
                          </Text>
                          <Text
                            style={{ color: theme.colors.text, fontSize: 14, fontWeight: '700' }}
                          >
                            {cat.earned}/{cat.required}
                            {catDef?.maxCredits != null ? ` (上限${catDef.maxCredits})` : ''}
                          </Text>
                        </View>
                        <View
                          style={{
                            height: 4,
                            backgroundColor: `${catColor}20`,
                            borderRadius: 2,
                            marginTop: 6,
                          }}
                        >
                          <View
                            style={{
                              width: `${pct}%`,
                              height: '100%',
                              backgroundColor: catColor,
                              borderRadius: 2,
                            }}
                          />
                        </View>
                      </View>
                    );
                  })}
                </View>

                {detailedAudit.warnings.length > 0 && (
                  <View
                    style={{
                      padding: 10,
                      backgroundColor: '#FEF3C7',
                      borderRadius: theme.radius.md,
                    }}
                  >
                    {detailedAudit.warnings.map((w, i) => (
                      <Text key={i} style={{ color: '#92400E', fontSize: 12, lineHeight: 18 }}>
                        {w}
                      </Text>
                    ))}
                  </View>
                )}
              </View>
            </AnimatedCard>
            ) : (
              <AnimatedCard title="我的修課學分" subtitle="已確認通過為自行標示，未套用畢業門檻">
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <Text style={{ color: theme.colors.muted, fontSize: 13 }}>自行標示通過</Text>
                  <Text style={{ fontSize: 28, fontWeight: '700', color: theme.colors.text }}>
                    {personalProgress.selfReportedCredits} <Text style={{ fontSize: 13 }}>學分</Text>
                  </Text>
                </View>
                <Text style={{ color: theme.colors.muted, fontSize: 12, marginTop: 10, lineHeight: 19 }}>
                  共 {personalProgress.totalCourses} 門手動記錄；{personalProgress.pendingCourses} 門尚未明示通過。
                  這裡未核對重修、抵免、通識分類或畢業審查，請以學校正式資料為準。
                </Text>
              </AnimatedCard>
            )}
          </>
        )}

        {tab === 1 && (
          <>
            <AnimatedCard title="個人修課總覽" subtitle="根據手動記錄整理，不代替正式畢業審查">
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <Text style={{ color: theme.colors.muted }}>自行標示通過的課程學分</Text>
                <Text style={{ color: theme.colors.text, fontSize: 28, fontWeight: '700' }}>
                  {personalProgress.selfReportedCredits}
                </Text>
              </View>
              <Text style={{ color: theme.colors.muted, fontSize: 12, marginTop: 10, lineHeight: 20 }}>
                {personalProgress.reportedPassedCourses} 門標示通過，{personalProgress.pendingCourses} 門未確認。
                未扣除重修與不能採計的課程，也未推定學校畢業資格。
              </Text>
              {canUseReference ? (
                <Pressable
                  accessibilityRole="button"
                  style={{ minHeight: 44, paddingVertical: 12, justifyContent: 'center' }}
                  onPress={() => {
                    if (referenceActive) {
                      setReferenceEnabled(false);
                      return;
                    }
                    Alert.alert(
                      '啟用 115 學年度資工系參考規則？',
                      '僅供靜宜資訊工程學系 115 學年度入學學生自行估算。請先確認你的入學年度；系統不會把此範本當作正式畢業審查。',
                      [
                        { text: '取消', style: 'cancel' },
                        { text: '我已核對，啟用參考', onPress: () => setReferenceEnabled(true) },
                      ],
                    );
                  }}
                >
                  <Text style={{ color: theme.colors.accent, fontWeight: '700' }}>
                    {referenceActive ? '關閉系所參考規則' : '手動啟用 115 資工系參考規則'}
                  </Text>
                </Pressable>
              ) : (
                <Text style={{ color: theme.colors.muted, fontSize: 12, marginTop: 10, lineHeight: 19 }}>
                  此學校／系所目前沒有對應的已核實畢業規則，無法以其他科系範本推定你的畢業門檻。
                </Text>
              )}
            </AnimatedCard>
            {referenceActive ? (
              <>
            {/* 使用者明確選擇後，才顯示對應系所的參考規則。 */}
            <AnimatedCard
              title="系所學分參考"
              subtitle={`${detailedTemplate.schoolName} — ${detailedTemplate.departmentName}`}
            >
              <Text style={{ color: theme.colors.muted, fontSize: 12, lineHeight: 19, marginBottom: 12 }}>
                僅計算手動標示的學分與此版分類門檻；未核對必修課代碼、重修替代、抵免、修課年度及正式畢業資格。
              </Text>
              <View style={{ gap: 8 }}>
                <Text style={{ color: theme.colors.muted, fontSize: 12 }}>
                  {detailedTemplate.academicYear} 學年度入學 ／ {detailedTemplate.division} ／{' '}
                  {detailedTemplate.studentType}
                </Text>
                <View
                  style={{
                    flexDirection: 'row',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginTop: 4,
                  }}
                >
                  <Text style={{ color: theme.colors.text, fontWeight: '600' }}>畢業總學分</Text>
                  <Text style={{ color: theme.colors.accent, fontWeight: '700', fontSize: 22 }}>
                    {detailedAudit.total.earned} / {detailedTemplate.totalCreditsRequired}
                  </Text>
                </View>
                <View
                  style={{
                    height: 10,
                    backgroundColor: theme.colors.border,
                    borderRadius: 5,
                    overflow: 'hidden',
                  }}
                >
                  <View
                    style={{
                      width: `${Math.min((detailedAudit.total.earned / Math.max(detailedTemplate.totalCreditsRequired, 1)) * 100, 100)}%`,
                      height: '100%',
                      backgroundColor: detailedAudit.satisfied ? '#34C759' : theme.colors.accent,
                      borderRadius: 5,
                    }}
                  />
                </View>
                <Text style={{ color: theme.colors.muted, fontSize: 12, textAlign: 'right' }}>
                  {detailedAudit.total.remaining > 0
                    ? `還需 ${detailedAudit.total.remaining} 學分`
                    : '參考學分量達門檻（非正式認列）'}
                </Text>
              </View>
            </AnimatedCard>

            {/* 各分類詳細進度 */}
            {detailedAudit.byCategory.map((cat, idx) => {
              const catDef = detailedTemplate.categories.find((c) => c.key === cat.key);
              const catColor = catDef?.color || theme.colors.accent;
              const pct =
                cat.required > 0
                  ? Math.min((cat.earned / cat.required) * 100, 100)
                  : cat.earned > 0
                    ? 100
                    : 0;
              return (
                <AnimatedCard
                  key={cat.key}
                  title={cat.label}
                  subtitle={`${cat.earned}/${cat.required} 學分${cat.remaining > 0 ? `（差 ${cat.remaining}）` : ' ✓'}`}
                  delay={idx * 60}
                >
                  <View style={{ gap: 8 }}>
                    <View style={{ height: 6, backgroundColor: `${catColor}20`, borderRadius: 3 }}>
                      <View
                        style={{
                          width: `${pct}%`,
                          height: '100%',
                          backgroundColor: catColor,
                          borderRadius: 3,
                        }}
                      />
                    </View>

                    {catDef?.notes && (
                      <Text style={{ color: theme.colors.muted, fontSize: 11, lineHeight: 16 }}>
                        {catDef.notes}
                      </Text>
                    )}

                    {cat.subCategories && cat.subCategories.length > 0 && (
                      <View style={{ gap: 6, marginTop: 4 }}>
                        {cat.subCategories.map((sub) => {
                          const subPct =
                            sub.required > 0
                              ? Math.min((sub.earned / sub.required) * 100, 100)
                              : sub.earned > 0
                                ? 100
                                : 0;
                          return (
                            <View
                              key={sub.key}
                              style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}
                            >
                              <View style={{ flex: 1 }}>
                                <View
                                  style={{ flexDirection: 'row', justifyContent: 'space-between' }}
                                >
                                  <Text
                                    style={{
                                      color: theme.colors.text,
                                      fontSize: 12,
                                      fontWeight: '500',
                                    }}
                                  >
                                    {sub.label}
                                  </Text>
                                  <Text style={{ color: theme.colors.muted, fontSize: 12 }}>
                                    {sub.earned}/{sub.required}
                                  </Text>
                                </View>
                                <View
                                  style={{
                                    height: 3,
                                    backgroundColor: `${catColor}15`,
                                    borderRadius: 2,
                                    marginTop: 3,
                                  }}
                                >
                                  <View
                                    style={{
                                      width: `${subPct}%`,
                                      height: '100%',
                                      backgroundColor: `${catColor}80`,
                                      borderRadius: 2,
                                    }}
                                  />
                                </View>
                              </View>
                              {sub.remaining <= 0 && sub.required > 0 && (
                                <Ionicons name="checkmark-circle" size={16} color="#34C759" />
                              )}
                            </View>
                          );
                        })}
                      </View>
                    )}

                    {catDef?.courses && catDef.courses.length > 0 && (
                      <View style={{ marginTop: 4 }}>
                        <Text
                          style={{
                            color: theme.colors.muted,
                            fontSize: 11,
                            fontWeight: '600',
                            marginBottom: 4,
                          }}
                        >
                          課程清單（{catDef.courses.filter((c) => c.required).length} 門必修）
                        </Text>
                        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>
                          {catDef.courses
                            .filter((c) => c.required)
                            .map((c, i) => (
                              <View
                                key={i}
                                style={{
                                  paddingVertical: 4,
                                  paddingHorizontal: 8,
                                  backgroundColor: `${catColor}10`,
                                  borderRadius: theme.radius.sm,
                                }}
                              >
                                <Text style={{ color: catColor, fontSize: 11 }}>
                                  {c.name} ({c.credits})
                                </Text>
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
                        const previousScope = storageKey;
                        const next = { ...nonCreditSatisfied, [req.key]: !nonCreditSatisfied[req.key] };
                        void saveCreditChecklistStatus(checklistKey, next)
                          .then(() => {
                            if (activeScope.current === previousScope) setNonCreditSatisfied(next);
                          })
                          .catch(() => Alert.alert('尚未儲存', '這次勾選無法保存，請稍後重試。'));
                      }}
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        padding: 12,
                        backgroundColor: satisfied ? '#34C75910' : theme.colors.surface2,
                        borderRadius: theme.radius.md,
                        borderWidth: 1,
                        borderColor: satisfied ? '#34C75940' : theme.colors.border,
                        gap: 12,
                      }}
                    >
                      <Ionicons
                        name={satisfied ? 'checkmark-circle' : 'ellipse-outline'}
                        size={24}
                        color={satisfied ? '#34C759' : theme.colors.muted}
                      />
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: theme.colors.text, fontWeight: '600', fontSize: 14 }}>
                          {req.label}
                        </Text>
                        <Text
                          style={{
                            color: theme.colors.muted,
                            fontSize: 12,
                            marginTop: 2,
                            lineHeight: 16,
                          }}
                        >
                          {req.description}
                        </Text>
                        {req.alternatives && req.alternatives.length > 0 && (
                          <Text
                            style={{
                              color: theme.colors.muted,
                              fontSize: 11,
                              marginTop: 4,
                              fontStyle: 'italic',
                            }}
                          >
                            替代方案：{req.alternatives.join('、')}
                          </Text>
                        )}
                      </View>
                    </Pressable>
                  );
                })}
                <Text style={{ color: theme.colors.muted, fontSize: 11, textAlign: 'center' }}>
                  個人勾選結果只保存在此裝置，不代表校方認證完成
                </Text>
              </View>
            </AnimatedCard>

            {/* 附註 */}
            {detailedTemplate.otherRules && detailedTemplate.otherRules.length > 0 && (
              <AnimatedCard title="附註" delay={detailedAudit.byCategory.length * 60 + 60}>
                <View style={{ gap: 6 }}>
                  {detailedTemplate.otherRules.map((rule, i) => (
                    <View key={i} style={{ flexDirection: 'row', gap: 6 }}>
                      <Text style={{ color: theme.colors.muted, fontSize: 12 }}>•</Text>
                      <Text
                        style={{ color: theme.colors.muted, fontSize: 12, flex: 1, lineHeight: 18 }}
                      >
                        {rule}
                      </Text>
                    </View>
                  ))}
                </View>
              </AnimatedCard>
            )}
              </>
            ) : (
              <AnimatedCard title="下一步怎麼安排" subtitle="先核對校方門檻，再決定修課計畫">
                <Text style={{ color: theme.colors.muted, lineHeight: 20 }}>
                  可在「新增課程」整理成績與修課，或從 Web 學分規劃逐學期安排候選課程。
                  目前沒有你的學制與入學年度的正式採計規則，避免直接顯示錯誤的畢業達標百分比。
                </Text>
              </AnimatedCard>
            )}
          </>
        )}

        {tab === 2 && (
          <>
            <AnimatedCard
              title={`已儲存課程（${savedCourses.length}）`}
              subtitle={savedCourses.length === 0 ? '尚無本機課程' : unsyncedCount > 0 ? `${unsyncedCount} 門尚未同步` : '目前課程皆已標示同步'}
            >
              {savedCourses.length === 0 ? (
                <View style={{ alignItems: 'center', padding: 24 }}>
                  <Ionicons name="school-outline" size={48} color={theme.colors.muted} />
                  <Text style={{ color: theme.colors.muted, marginTop: 12 }}>尚未新增任何課程</Text>
                  <Button
                    text="新增第一門課程"
                    onPress={() => setTab(0)}
                    style={{ marginTop: 12 }}
                  />
                </View>
              ) : (
                <View style={{ gap: 10 }}>
                  {savedCourses.map((course) => {
                    const catInfo = legacyCategories.find((c) => c.key === course.category);
                    return (
                      <View
                        key={course.id}
                        style={{
                          flexDirection: 'row',
                          alignItems: 'center',
                          padding: 12,
                          backgroundColor: theme.colors.surface2,
                          borderRadius: theme.radius.md,
                          borderWidth: 1,
                          borderColor: theme.colors.border,
                          gap: 12,
                        }}
                      >
                        <View
                          style={{
                            width: 40,
                            height: 40,
                            borderRadius: 20,
                            backgroundColor: `${catInfo?.color || theme.colors.accent}20`,
                            alignItems: 'center',
                            justifyContent: 'center',
                          }}
                        >
                          <Text
                            style={{
                              color: catInfo?.color || theme.colors.accent,
                              fontWeight: '700',
                              fontSize: 16,
                            }}
                          >
                            {course.credits}
                          </Text>
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text
                            style={{ color: theme.colors.text, fontWeight: '600' }}
                            numberOfLines={1}
                          >
                            {course.name}
                          </Text>
                          <View style={{ flexDirection: 'row', gap: 6, marginTop: 4 }}>
                            <Pill text={catInfo?.label || course.category} />
                            {course.semester && <Pill text={course.semester} />}
                            {course.grade && <Pill text={course.grade} kind="accent" />}
                            {!course.passed && <Pill text="未標示通過" kind="accent" />}
                          </View>
                        </View>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
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
                    text={
                      syncing
                        ? '同步中...'
                        : `同步到雲端${unsyncedCount > 0 ? ` (${unsyncedCount})` : ''}`
                    }
                    kind="primary"
                    onPress={handleSyncToCloud}
                    disabled={syncing || unsyncedCount === 0}
                  />
                  <Button text="清除所有資料" onPress={handleClearAll} />
                </View>
              </AnimatedCard>
            )}
          </>
        )}

        {tab === 3 && (
          <>
            <AnimatedCard title="匯入課程" subtitle="先預覽、再確認寫入這台手機">
              <Text style={{ color: theme.colors.muted, lineHeight: 20, marginBottom: 12 }}>
                支援的 CSV 格式：{'\n'}
                課程名稱, 學分, 分類, 成績, 學期{'\n'}
                例如：資料庫系統, 3, 必修, A, 113-1, 否
                {'\\n'}沒有「通過」欄位的匯入資料，一律先列為未確認，不會自動認定已取得學分。
              </Text>
              <Button
                text={importing ? '匯入中...' : '選擇 CSV 檔案'}
                kind="primary"
                onPress={handleImportCSV}
                disabled={importing}
              />
            </AnimatedCard>

            <AnimatedCard title="同步設定" subtitle="雲端資料同步" delay={100}>
              <View style={{ gap: 12 }}>
                <View
                  style={{
                    flexDirection: 'row',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  <Text style={{ color: theme.colors.text }}>已儲存課程</Text>
                  <Text style={{ color: theme.colors.muted }}>{savedCourses.length} 門</Text>
                </View>
                <View
                  style={{
                    flexDirection: 'row',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  <Text style={{ color: theme.colors.text }}>已同步</Text>
                  <Text style={{ color: theme.colors.success }}>
                    {savedCourses.filter((c) => c.syncedToCloud).length} 門
                  </Text>
                </View>
                <View
                  style={{
                    flexDirection: 'row',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  <Text style={{ color: theme.colors.text }}>待同步</Text>
                  <Text style={{ color: unsyncedCount > 0 ? '#FF9500' : theme.colors.muted }}>
                    {unsyncedCount} 門
                  </Text>
                </View>

                {auth.user ? (
                  <Button
                    text={syncing ? '同步中...' : '立即同步'}
                    kind="primary"
                    onPress={handleSyncToCloud}
                    disabled={syncing || unsyncedCount === 0}
                  />
                ) : (
                  <View
                    style={{
                      padding: 12,
                      backgroundColor: theme.colors.surface2,
                      borderRadius: theme.radius.md,
                      alignItems: 'center',
                    }}
                  >
                    <Text style={{ color: theme.colors.muted, textAlign: 'center' }}>
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
