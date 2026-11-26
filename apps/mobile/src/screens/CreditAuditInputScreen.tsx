/* eslint-disable */
import React, { useMemo, useState, useEffect, useCallback, useRef } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View, Alert, Pressable } from 'react-native';
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
  Button,
  Spinner,
  SegmentedControl,
} from '../ui/components';
import { TAB_BAR_CONTENT_BOTTOM_PADDING } from '../ui/navigationTheme';
import { useTabPanelScroll } from '../hooks/useTabPanelScroll';
import { theme } from '../ui/theme';
import { useThemeStyleSheet } from '../ui/useThemeStyleSheet';
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

const legacyCategories: Array<{ key: CreditCategory; label: string }> = [
  { key: 'required', label: '必修' },
  { key: 'elective', label: '選修' },
  { key: 'general', label: '通識' },
  { key: 'english', label: '英文' },
  { key: 'other', label: '其他' },
];

type AuditStyles = ReturnType<typeof createStyles>;

function pctOf(earned: number, required: number): number {
  if (required > 0) return Math.min((earned / required) * 100, 100);
  return earned > 0 ? 100 : 0;
}

/** 區塊：清楚標題 + 內容，不以卡片層層堆疊 */
function Section({
  title,
  subtitle,
  children,
  styles: s,
}: {
  title?: string;
  subtitle?: string;
  children?: React.ReactNode;
  styles: AuditStyles;
}) {
  return (
    <View style={s.section}>
      {title ? (
        <View style={s.sectionHead}>
          <Text accessibilityRole="header" style={s.sectionTitle}>
            {title}
          </Text>
          {subtitle ? <Text style={s.sectionSub}>{subtitle}</Text> : null}
        </View>
      ) : null}
      {children}
    </View>
  );
}

function ProgressBar({
  pct,
  color,
  height = 6,
  styles: s,
}: {
  pct: number;
  color: string;
  height?: number;
  styles: AuditStyles;
}) {
  return (
    <View style={[s.track, { height, borderRadius: height / 2 }]}>
      <View
        style={{
          width: `${pct}%`,
          height: '100%',
          backgroundColor: color,
          borderRadius: height / 2,
        }}
      />
    </View>
  );
}

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

const AUDIT_TABS = [
  { id: 'add', label: '新增課程' },
  { id: 'overview', label: '修課概覽' },
  { id: 'saved', label: '已儲存' },
  { id: 'transfer', label: '匯入/匯出' },
] as const;

export function CreditAuditInputScreen(props: any) {
  const s = useThemeStyleSheet(createStyles);
  const onAdded: ((x: any) => void) | undefined = props?.route?.params?.onAdded;
  const auth = useAuth();
  const { school } = useSchool();

  const [tab, setTab] = useState<(typeof AUDIT_TABS)[number]['id']>('add');
  const panelScroll = useTabPanelScroll(tab);
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

  if (loading || loadedScope !== storageKey) {
    return (
      <Screen title="學分試算">
        <View style={s.centered}>
          <Spinner size={32} />
          <Text style={s.mutedText}>載入中...</Text>
        </View>
      </Screen>
    );
  }
  if (loadError) {
    return (
      <Screen title="個人學分規劃">
        <View style={s.errorBox}>
          <Text accessibilityRole="alert" style={s.errorText}>
            {loadError}
          </Text>
          <Button text="重新讀取本機課程" kind="primary" onPress={() => void loadSavedCourses()} />
        </View>
      </Screen>
    );
  }

  const totalPct = pctOf(detailedAudit.total.earned, Math.max(detailedAudit.total.required, 1));
  const referencePct = pctOf(
    detailedAudit.total.earned,
    Math.max(detailedTemplate.totalCreditsRequired, 1),
  );

  return (
    <Screen title="學分試算" subtitle="管理您的修課紀錄並追蹤畢業學分進度">
      <SegmentedControl options={AUDIT_TABS} selected={tab} onChange={setTab} />

      <ScrollView
        ref={panelScroll}
        contentContainerStyle={[s.content, { paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {tab === 'add' && (
          <>
            <Section title="新增課程" subtitle="手動輸入修課資訊" styles={s}>
              <View style={s.group}>
                <View style={s.fieldBlock}>
                  <Text style={s.fieldLabel}>課程名稱 *</Text>
                  <TextInput
                    value={name}
                    onChangeText={setName}
                    placeholder="例如：資料庫系統"
                    placeholderTextColor={theme.colors.muted}
                    accessibilityLabel="課程名稱"
                    style={s.input}
                  />
                </View>

                <View style={[s.fieldBlock, s.divider]}>
                  <View style={s.fieldRow}>
                    <View style={s.fieldCreditCol}>
                      <Text style={s.fieldLabel}>學分</Text>
                      <TextInput
                        value={credits}
                        onChangeText={setCredits}
                        keyboardType="decimal-pad"
                        accessibilityLabel="學分"
                        style={[s.input, s.inputCenter]}
                      />
                    </View>
                    <View style={s.fieldSemesterCol}>
                      <Text style={s.fieldLabel}>學期</Text>
                      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                        <View style={s.chipRow}>
                          {semesters.map((sem) => {
                            const active = semester === sem;
                            return (
                              <Pressable
                                key={sem}
                                accessibilityRole="button"
                                accessibilityState={{ selected: active }}
                                onPress={() => setSemester(sem)}
                                style={[s.chip, active && s.chipActive]}
                              >
                                <Text style={[s.chipText, active && s.chipTextActive]}>{sem}</Text>
                              </Pressable>
                            );
                          })}
                        </View>
                      </ScrollView>
                    </View>
                  </View>
                </View>

                <View style={[s.fieldBlock, s.divider]}>
                  <Text style={s.fieldLabel}>
                    {referenceActive
                      ? '參考學程分類（自行標示，非校方認列）'
                      : '個人課程分類（自行標示）'}
                  </Text>
                  {referenceActive ? (
                    <View style={s.subGroup}>
                      {detailedTemplate.categories.map((cat, index) => {
                        const selected = detailedCatKey === cat.key;
                        const hasSubs = cat.subCategories && cat.subCategories.length > 0;
                        return (
                          <View key={cat.key} style={index > 0 && s.divider}>
                            <Pressable
                              accessibilityRole="radio"
                              accessibilityState={{ checked: selected }}
                              onPress={() => {
                                setDetailedCatKey(cat.key);
                                setDetailedSubKey(undefined);
                                setCategory(mapDetailedToLegacyCategory(cat.key));
                              }}
                              style={[s.optionRow, selected && s.optionRowActive]}
                            >
                              <Ionicons
                                name={selected ? 'radio-button-on' : 'radio-button-off'}
                                size={20}
                                color={selected ? theme.colors.accent : theme.colors.muted}
                              />
                              <Text style={[s.optionLabel, selected && s.optionLabelActive]}>
                                {cat.label}
                              </Text>
                              <Text style={s.metaText}>
                                {cat.minCredits}
                                {cat.maxCredits != null ? `~${cat.maxCredits}` : '+'} 學分
                              </Text>
                            </Pressable>
                            {hasSubs && selected && (
                              <ScrollView
                                horizontal
                                showsHorizontalScrollIndicator={false}
                                style={s.subChips}
                              >
                                <View style={s.chipRow}>
                                  {cat.subCategories!.map((sub) => {
                                    const isSubSel = detailedSubKey === sub.key;
                                    return (
                                      <Pressable
                                        key={sub.key}
                                        accessibilityRole="button"
                                        accessibilityState={{ selected: isSubSel }}
                                        onPress={() => {
                                          setDetailedCatKey(cat.key);
                                          setDetailedSubKey(sub.key);
                                          setCategory(mapDetailedToLegacyCategory(cat.key));
                                        }}
                                        style={[s.chip, isSubSel && s.chipActive]}
                                      >
                                        <Text style={[s.chipText, isSubSel && s.chipTextActive]}>
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
                    <View style={s.chipWrap}>
                      {legacyCategories.map((entry) => {
                        const active = category === entry.key;
                        return (
                          <Pressable
                            key={entry.key}
                            accessibilityRole="radio"
                            accessibilityState={{ checked: active }}
                            accessibilityLabel={entry.label}
                            onPress={() => {
                              setCategory(entry.key);
                              setDetailedCatKey(categoryToDetailedKey(entry.key));
                              setDetailedSubKey(undefined);
                            }}
                            style={[s.chip, active && s.chipActive]}
                          >
                            <Text style={[s.chipText, active && s.chipTextActive]}>
                              {entry.label}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  )}
                </View>

                <View style={[s.fieldBlock, s.divider]}>
                  <Text style={s.fieldLabel}>通過狀態（自行確認，不代表校方已認列）</Text>
                  <View style={s.buttonRow}>
                    <View style={s.flex}>
                      <Button
                        text="已確認通過"
                        kind={passed ? 'primary' : 'secondary'}
                        onPress={() => setPassed(true)}
                      />
                    </View>
                    <View style={s.flex}>
                      <Button
                        text="尚未確認／未通過"
                        kind={!passed ? 'primary' : 'secondary'}
                        onPress={() => setPassed(false)}
                      />
                    </View>
                  </View>
                </View>

                {passed && (
                  <View style={[s.fieldBlock, s.divider]}>
                    <Text style={s.fieldLabel}>等第成績（可留空，不自動填 A）</Text>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                      <View style={s.chipRow}>
                        {gradeOptions.map((g) => {
                          const active = grade === g;
                          return (
                            <Pressable
                              key={g}
                              accessibilityRole="button"
                              accessibilityState={{ selected: active }}
                              accessibilityLabel={`成績 ${g}`}
                              onPress={() => setGrade(g)}
                              style={[s.gradeChip, active && s.chipActive]}
                            >
                              <Text style={[s.chipText, active && s.chipTextActive]}>{g}</Text>
                            </Pressable>
                          );
                        })}
                      </View>
                    </ScrollView>
                  </View>
                )}

                <View style={[s.fieldBlock, s.divider]}>
                  <Button
                    text={saving ? '儲存中...' : '儲存課程'}
                    kind="primary"
                    onPress={handleSaveCourse}
                    disabled={saving || !name.trim()}
                  />
                </View>
              </View>
            </Section>

            {referenceActive ? (
              <Section
                title="115 入學資工系參考情境"
                subtitle={`${detailedTemplate.departmentName} ${detailedTemplate.academicYear} 學年度`}
                styles={s}
              >
                <View style={s.group}>
                  <View style={s.fieldBlock}>
                    <View style={s.spaceBetween}>
                      <Text style={s.metaText}>目前總學分</Text>
                      <Text style={s.strongValue}>
                        {detailedAudit.total.earned} / {detailedAudit.total.required}
                      </Text>
                    </View>
                    <ProgressBar pct={totalPct} color={theme.colors.accent} height={8} styles={s} />
                  </View>

                  {name.trim() ? (
                    <View style={[s.fieldBlock, s.divider]}>
                      <View style={s.spaceBetween}>
                        <Text style={s.fieldLabel}>新增後總學分</Text>
                        <Text style={s.strongValue}>
                          {detailedPreview.total.earned} / {detailedPreview.total.required}
                        </Text>
                      </View>
                      <Text style={s.metaText}>
                        +{Number(credits) || 0} 學分（
                        {detailedTemplate.categories.find((c) => c.key === detailedCatKey)?.label ??
                          '其他'}
                        ）
                      </Text>
                    </View>
                  ) : null}

                  {detailedAudit.byCategory.map((cat) => {
                    const catDef = detailedTemplate.categories.find((c) => c.key === cat.key);
                    return (
                      <View key={cat.key} style={[s.fieldBlock, s.divider]}>
                        <View style={s.spaceBetween}>
                          <Text style={s.optionLabel}>{cat.label}</Text>
                          <Text style={s.rowValue}>
                            {cat.earned}/{cat.required}
                            {catDef?.maxCredits != null ? ` (上限${catDef.maxCredits})` : ''}
                          </Text>
                        </View>
                        <ProgressBar
                          pct={pctOf(cat.earned, cat.required)}
                          color={theme.colors.accent}
                          height={4}
                          styles={s}
                        />
                      </View>
                    );
                  })}

                  {detailedAudit.warnings.length > 0 && (
                    <View style={[s.warningBox, s.divider]}>
                      <Ionicons name="warning-outline" size={18} color={theme.colors.warning} />
                      <View style={s.flex}>
                        {detailedAudit.warnings.map((w, i) => (
                          <Text key={i} style={s.warningText}>
                            {w}
                          </Text>
                        ))}
                      </View>
                    </View>
                  )}
                </View>
              </Section>
            ) : (
              <Section
                title="我的修課學分"
                subtitle="已確認通過為自行標示，未套用畢業門檻"
                styles={s}
              >
                <View style={s.group}>
                  <View style={s.fieldBlock}>
                    <View style={s.spaceBetween}>
                      <Text style={s.metaText}>自行標示通過</Text>
                      <Text style={s.bigValue}>
                        {personalProgress.selfReportedCredits} <Text style={s.unit}>學分</Text>
                      </Text>
                    </View>
                    <Text style={s.noteText}>
                      共 {personalProgress.totalCourses} 門手動記錄；
                      {personalProgress.pendingCourses} 門尚未明示通過。
                      這裡未核對重修、抵免、通識分類或畢業審查，請以學校正式資料為準。
                    </Text>
                  </View>
                </View>
              </Section>
            )}
          </>
        )}

        {tab === 'overview' && (
          <>
            <Section
              title="個人修課總覽"
              subtitle="根據手動記錄整理，不代替正式畢業審查"
              styles={s}
            >
              <View style={s.group}>
                <View style={s.fieldBlock}>
                  <View style={s.spaceBetween}>
                    <Text style={s.metaText}>自行標示通過的課程學分</Text>
                    <Text style={s.bigValue}>{personalProgress.selfReportedCredits}</Text>
                  </View>
                  <Text style={s.noteText}>
                    {personalProgress.reportedPassedCourses} 門標示通過，
                    {personalProgress.pendingCourses} 門未確認。
                    未扣除重修與不能採計的課程，也未推定學校畢業資格。
                  </Text>
                </View>
                <View style={[s.fieldBlock, s.divider]}>
                  {canUseReference ? (
                    <Pressable
                      accessibilityRole="button"
                      style={s.linkButton}
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
                      <Text style={s.linkText}>
                        {referenceActive ? '關閉系所參考規則' : '手動啟用 115 資工系參考規則'}
                      </Text>
                    </Pressable>
                  ) : (
                    <Text style={s.noteText}>
                      此學校／系所目前沒有對應的已核實畢業規則，無法以其他科系範本推定你的畢業門檻。
                    </Text>
                  )}
                </View>
              </View>
            </Section>

            {referenceActive ? (
              <>
                {/* 使用者明確選擇後，才顯示對應系所的參考規則。 */}
                <Section
                  title="系所學分參考"
                  subtitle={`${detailedTemplate.schoolName} — ${detailedTemplate.departmentName}`}
                  styles={s}
                >
                  <View style={s.group}>
                    <View style={s.fieldBlock}>
                      <Text style={s.noteText}>
                        僅計算手動標示的學分與此版分類門檻；未核對必修課代碼、重修替代、抵免、修課年度及正式畢業資格。
                      </Text>
                      <Text style={s.metaText}>
                        {detailedTemplate.academicYear} 學年度入學 ／ {detailedTemplate.division} ／{' '}
                        {detailedTemplate.studentType}
                      </Text>
                    </View>
                    <View style={[s.fieldBlock, s.divider]}>
                      <View style={s.spaceBetween}>
                        <Text style={s.optionLabel}>畢業總學分</Text>
                        <Text style={s.bigValue}>
                          {detailedAudit.total.earned} / {detailedTemplate.totalCreditsRequired}
                        </Text>
                      </View>
                      <ProgressBar
                        pct={referencePct}
                        color={detailedAudit.satisfied ? theme.colors.success : theme.colors.accent}
                        height={8}
                        styles={s}
                      />
                      <Text style={s.rightNote}>
                        {detailedAudit.total.remaining > 0
                          ? `還需 ${detailedAudit.total.remaining} 學分`
                          : '參考學分量達門檻（非正式認列）'}
                      </Text>
                    </View>
                  </View>
                </Section>

                {/* 各分類詳細進度 */}
                <Section title="各分類進度" styles={s}>
                  <View style={s.group}>
                    {detailedAudit.byCategory.map((cat, idx) => {
                      const catDef = detailedTemplate.categories.find((c) => c.key === cat.key);
                      const requiredCourses = catDef?.courses?.filter((c) => c.required) ?? [];
                      return (
                        <View key={cat.key} style={[s.fieldBlock, idx > 0 && s.divider]}>
                          <View style={s.spaceBetween}>
                            <Text style={s.optionLabel}>{cat.label}</Text>
                            <Text style={s.rowValue}>
                              {cat.earned}/{cat.required} 學分
                              {cat.remaining > 0 ? `（差 ${cat.remaining}）` : ' ✓'}
                            </Text>
                          </View>
                          <ProgressBar
                            pct={pctOf(cat.earned, cat.required)}
                            color={cat.remaining > 0 ? theme.colors.accent : theme.colors.success}
                            styles={s}
                          />

                          {catDef?.notes ? <Text style={s.noteText}>{catDef.notes}</Text> : null}

                          {cat.subCategories && cat.subCategories.length > 0 && (
                            <View style={s.subList}>
                              {cat.subCategories.map((sub) => (
                                <View key={sub.key} style={s.subItem}>
                                  <View style={s.flex}>
                                    <View style={s.spaceBetween}>
                                      <Text style={s.subLabel}>{sub.label}</Text>
                                      <Text style={s.metaText}>
                                        {sub.earned}/{sub.required}
                                      </Text>
                                    </View>
                                    <ProgressBar
                                      pct={pctOf(sub.earned, sub.required)}
                                      color={theme.colors.accent}
                                      height={3}
                                      styles={s}
                                    />
                                  </View>
                                  {sub.remaining <= 0 && sub.required > 0 && (
                                    <Ionicons
                                      name="checkmark-circle"
                                      size={16}
                                      color={theme.colors.success}
                                    />
                                  )}
                                </View>
                              ))}
                            </View>
                          )}

                          {requiredCourses.length > 0 && (
                            <Text style={s.noteText}>
                              課程清單（{requiredCourses.length} 門必修）：
                              {requiredCourses.map((c) => `${c.name} (${c.credits})`).join('、')}
                            </Text>
                          )}
                        </View>
                      );
                    })}
                  </View>
                </Section>

                {/* 非學分畢業條件 */}
                <Section title="其他畢業條件" subtitle="非學分認證要求" styles={s}>
                  <View style={s.group}>
                    {detailedTemplate.nonCreditRequirements.map((req, index) => {
                      const satisfied = nonCreditSatisfied[req.key] ?? false;
                      return (
                        <Pressable
                          key={req.key}
                          accessibilityRole="checkbox"
                          accessibilityState={{ checked: satisfied }}
                          accessibilityLabel={req.label}
                          onPress={() => {
                            const previousScope = storageKey;
                            const next = {
                              ...nonCreditSatisfied,
                              [req.key]: !nonCreditSatisfied[req.key],
                            };
                            void saveCreditChecklistStatus(checklistKey, next)
                              .then(() => {
                                if (activeScope.current === previousScope) {
                                  setNonCreditSatisfied(next);
                                }
                              })
                              .catch(() =>
                                Alert.alert('尚未儲存', '這次勾選無法保存，請稍後重試。'),
                              );
                          }}
                          style={({ pressed }) => [
                            s.checkRow,
                            index > 0 && s.divider,
                            pressed && s.pressed,
                          ]}
                        >
                          <Ionicons
                            name={satisfied ? 'checkmark-circle' : 'ellipse-outline'}
                            size={24}
                            color={satisfied ? theme.colors.success : theme.colors.muted}
                          />
                          <View style={s.flex}>
                            <Text style={s.optionLabel}>{req.label}</Text>
                            <Text style={s.metaText}>{req.description}</Text>
                            {req.alternatives && req.alternatives.length > 0 && (
                              <Text style={s.altText}>替代方案：{req.alternatives.join('、')}</Text>
                            )}
                          </View>
                        </Pressable>
                      );
                    })}
                    <View style={[s.fieldBlock, s.divider]}>
                      <Text style={s.centerNote}>個人勾選結果只保存在此裝置，不代表校方認證完成</Text>
                    </View>
                  </View>
                </Section>

                {/* 附註 */}
                {detailedTemplate.otherRules && detailedTemplate.otherRules.length > 0 && (
                  <Section title="附註" styles={s}>
                    <View style={s.group}>
                      <View style={s.fieldBlock}>
                        {detailedTemplate.otherRules.map((rule, i) => (
                          <View key={i} style={s.bulletRow}>
                            <Text style={s.metaText}>•</Text>
                            <Text style={[s.metaText, s.flex]}>{rule}</Text>
                          </View>
                        ))}
                      </View>
                    </View>
                  </Section>
                )}
              </>
            ) : (
              <Section
                title="下一步怎麼安排"
                subtitle="先核對校方門檻，再決定修課計畫"
                styles={s}
              >
                <Text style={s.noteText}>
                  可在「新增課程」整理成績與修課，或從 Web 學分規劃逐學期安排候選課程。
                  目前沒有你的學制與入學年度的正式採計規則，避免直接顯示錯誤的畢業達標百分比。
                </Text>
              </Section>
            )}
          </>
        )}

        {tab === 'saved' && (
          <>
            <Section
              title={`已儲存課程（${savedCourses.length}）`}
              subtitle={
                savedCourses.length === 0
                  ? '尚無本機課程'
                  : unsyncedCount > 0
                    ? `${unsyncedCount} 門尚未同步`
                    : '目前課程皆已標示同步'
              }
              styles={s}
            >
              {savedCourses.length === 0 ? (
                <View style={[s.group, s.emptyBox]}>
                  <Ionicons name="school-outline" size={40} color={theme.colors.muted} />
                  <Text style={s.mutedText}>尚未新增任何課程</Text>
                  <Button text="新增第一門課程" onPress={() => setTab('add')} />
                </View>
              ) : (
                <View style={s.group}>
                  {savedCourses.map((course, index) => {
                    const catInfo = legacyCategories.find((c) => c.key === course.category);
                    const meta = [
                      catInfo?.label || course.category,
                      course.semester,
                      course.grade ? `成績 ${course.grade}` : null,
                      !course.passed ? '未標示通過' : null,
                    ]
                      .filter(Boolean)
                      .join(' · ');
                    return (
                      <View key={course.id} style={[s.savedRow, index > 0 && s.divider]}>
                        <View style={s.creditCol}>
                          <Text style={s.creditValue}>{course.credits}</Text>
                          <Text style={s.creditUnit}>學分</Text>
                        </View>
                        <View style={s.flex}>
                          <Text style={s.optionLabel} numberOfLines={1}>
                            {course.name}
                          </Text>
                          <Text style={s.metaText} numberOfLines={2}>
                            {meta}
                          </Text>
                        </View>
                        <Ionicons
                          name={course.syncedToCloud ? 'cloud-done-outline' : 'cloud-offline-outline'}
                          size={18}
                          color={course.syncedToCloud ? theme.colors.success : theme.colors.muted}
                          accessibilityLabel={course.syncedToCloud ? '已同步' : '尚未同步'}
                        />
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={`刪除 ${course.name}`}
                          hitSlop={4}
                          onPress={() => handleDeleteCourse(course.id)}
                          style={s.iconButton}
                        >
                          <Ionicons name="trash-outline" size={20} color={theme.colors.danger} />
                        </Pressable>
                      </View>
                    );
                  })}
                </View>
              )}
            </Section>

            {savedCourses.length > 0 && (
              <View style={s.buttonStack}>
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
            )}
          </>
        )}

        {tab === 'transfer' && (
          <>
            <Section title="匯入課程" subtitle="先預覽、再確認寫入這台手機" styles={s}>
              <View style={s.group}>
                <View style={s.fieldBlock}>
                  <Text style={s.noteText}>
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
                </View>
              </View>
            </Section>

            <Section title="同步設定" subtitle="雲端資料同步" styles={s}>
              <View style={s.group}>
                <View style={s.statRow}>
                  <Text style={s.optionLabel}>已儲存課程</Text>
                  <Text style={s.metaText}>{savedCourses.length} 門</Text>
                </View>
                <View style={[s.statRow, s.divider]}>
                  <Text style={s.optionLabel}>已同步</Text>
                  <Text style={[s.metaText, { color: theme.colors.success }]}>
                    {savedCourses.filter((c) => c.syncedToCloud).length} 門
                  </Text>
                </View>
                <View style={[s.statRow, s.divider]}>
                  <Text style={s.optionLabel}>待同步</Text>
                  <Text
                    style={[
                      s.metaText,
                      unsyncedCount > 0 && { color: theme.colors.warning },
                    ]}
                  >
                    {unsyncedCount} 門
                  </Text>
                </View>
                <View style={[s.fieldBlock, s.divider]}>
                  {auth.user ? (
                    <Button
                      text={syncing ? '同步中...' : '立即同步'}
                      kind="primary"
                      onPress={handleSyncToCloud}
                      disabled={syncing || unsyncedCount === 0}
                    />
                  ) : (
                    <Text style={s.centerNote}>請先登入以啟用雲端同步功能</Text>
                  )}
                </View>
              </View>
            </Section>

            <Section title="匯出資料" subtitle="將學分資料匯出" styles={s}>
              <Button
                text="匯出為 CSV"
                onPress={handleExportCSV}
                disabled={savedCourses.length === 0}
              />
            </Section>
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

const createStyles = () =>
  StyleSheet.create({
    flex: { flex: 1 },
    centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: theme.space.md },
    mutedText: { color: theme.colors.textSecondary },
    errorBox: { padding: theme.space.lg, gap: theme.space.md },
    errorText: { color: theme.colors.text, fontSize: 16, lineHeight: 24 },
    content: {
      gap: theme.layout.sectionGap,
      paddingTop: theme.space.md,
    },
    section: { gap: theme.space.sm },
    sectionHead: { gap: 2 },
    sectionTitle: {
      color: theme.colors.text,
      fontSize: theme.typography.h2.fontSize,
      lineHeight: theme.typography.h2.lineHeight,
      fontWeight: '700',
    },
    sectionSub: { color: theme.colors.textSecondary, fontSize: 13, lineHeight: 18 },
    group: {
      borderRadius: theme.radius.lg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.surface,
      overflow: 'hidden',
    },
    subGroup: {
      borderRadius: theme.radius.md,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.colors.border,
      overflow: 'hidden',
    },
    divider: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.colors.separator,
    },
    pressed: { backgroundColor: theme.colors.surfaceInteractive },
    fieldBlock: { padding: theme.space.md, gap: theme.space.sm },
    fieldRow: { flexDirection: 'row', gap: theme.space.md },
    fieldCreditCol: { flex: 1, gap: theme.space.sm },
    fieldSemesterCol: { flex: 2, gap: theme.space.sm },
    fieldLabel: { color: theme.colors.textSecondary, fontSize: 13, lineHeight: 18, fontWeight: '600' },
    input: {
      minHeight: 44,
      paddingVertical: 10,
      paddingHorizontal: 14,
      borderRadius: theme.radius.md,
      borderWidth: 1,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.surfaceMuted,
      color: theme.colors.text,
      fontSize: 15,
    },
    inputCenter: { textAlign: 'center' },
    chipRow: { flexDirection: 'row', gap: theme.space.sm },
    chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.space.sm },
    chip: {
      minHeight: 44,
      justifyContent: 'center',
      paddingHorizontal: theme.space.md,
      borderRadius: theme.radius.md,
      borderWidth: 1,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.surface,
    },
    chipActive: { backgroundColor: theme.colors.accentSoft, borderColor: theme.colors.accent },
    chipText: { color: theme.colors.textSecondary, fontSize: 14, fontWeight: '600' },
    chipTextActive: { color: theme.colors.text, fontWeight: '700' },
    gradeChip: {
      width: 44,
      height: 44,
      borderRadius: theme.radius.md,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.surface,
    },
    optionRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.space.sm + 4,
      minHeight: 48,
      paddingHorizontal: theme.space.md,
      paddingVertical: theme.space.sm,
    },
    optionRowActive: { backgroundColor: theme.colors.accentSoft },
    optionLabel: { flex: 1, color: theme.colors.text, fontSize: 15, lineHeight: 21, fontWeight: '600' },
    optionLabelActive: { fontWeight: '700' },
    subChips: { paddingHorizontal: theme.space.md, paddingBottom: theme.space.sm },
    buttonRow: { flexDirection: 'row', gap: theme.space.sm },
    buttonStack: { gap: theme.space.sm },
    spaceBetween: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      gap: theme.space.sm,
    },
    metaText: { color: theme.colors.textSecondary, fontSize: 12, lineHeight: 18 },
    noteText: { color: theme.colors.textSecondary, fontSize: 12, lineHeight: 19 },
    centerNote: { color: theme.colors.textSecondary, fontSize: 12, lineHeight: 18, textAlign: 'center' },
    rightNote: { color: theme.colors.textSecondary, fontSize: 12, textAlign: 'right' },
    altText: { color: theme.colors.textSecondary, fontSize: 11, marginTop: 4, fontStyle: 'italic' },
    strongValue: { color: theme.colors.text, fontWeight: '700', fontSize: 18 },
    bigValue: { color: theme.colors.text, fontWeight: '700', fontSize: 26, lineHeight: 32 },
    unit: { fontSize: 13, fontWeight: '400', color: theme.colors.textSecondary },
    rowValue: { color: theme.colors.text, fontSize: 14, fontWeight: '700' },
    track: { backgroundColor: theme.colors.separator, overflow: 'hidden' },
    warningBox: {
      flexDirection: 'row',
      gap: theme.space.sm,
      padding: theme.space.md,
      backgroundColor: theme.colors.warningSoft,
    },
    warningText: { color: theme.colors.text, fontSize: 12, lineHeight: 18 },
    linkButton: { minHeight: 44, justifyContent: 'center' },
    linkText: { color: theme.colors.accent, fontWeight: '700' },
    subList: { gap: theme.space.sm, marginTop: theme.space.xs },
    subItem: { flexDirection: 'row', alignItems: 'center', gap: theme.space.sm },
    subLabel: { color: theme.colors.text, fontSize: 12, fontWeight: '500' },
    checkRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.space.sm + 4,
      minHeight: 56,
      padding: theme.space.md,
    },
    bulletRow: { flexDirection: 'row', gap: theme.space.sm - 2 },
    emptyBox: {
      alignItems: 'center',
      padding: theme.space.lg,
      gap: theme.space.sm + 4,
    },
    savedRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.space.sm + 4,
      minHeight: 56,
      paddingLeft: theme.space.md,
      paddingRight: theme.space.xs,
      paddingVertical: theme.space.sm,
    },
    creditCol: { alignItems: 'center', minWidth: 36 },
    creditValue: { color: theme.colors.text, fontWeight: '700', fontSize: 18, lineHeight: 22 },
    creditUnit: { color: theme.colors.textSecondary, fontSize: 11 },
    iconButton: {
      width: 44,
      height: 44,
      alignItems: 'center',
      justifyContent: 'center',
    },
    statRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      minHeight: 48,
      paddingHorizontal: theme.space.md,
    },
  });
