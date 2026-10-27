import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
  type KeyboardTypeOptions,
} from 'react-native';
import { File, Paths } from 'expo-file-system';
import * as DocumentPicker from 'expo-document-picker';
import { isAvailableAsync, shareAsync } from 'expo-sharing';
import { Ionicons } from '@expo/vector-icons';
import {
  MAX_MILESTONES,
  MAX_PLANNED_COURSES,
  PLANNER_CATEGORIES,
  creditPlanSummary,
  emptyCreditPlan,
  formatCredits,
  parseCredits,
  type CreditPlan,
  type PlannedCourse,
  type PlannerCategory,
  type PlannerCourseStatus,
} from '@campus/shared/src/creditPlanner';
import { Screen, Spinner } from '../ui/components';
import { useAuth } from '../state/auth';
import { useSchool } from '../state/school';
import { theme, type ThemeColors } from '../ui/theme';
import { useThemeMode } from '../state/theme';
import { TAB_BAR_CONTENT_BOTTOM_PADDING } from '../ui/navigationTheme';
import {
  CREDIT_PLAN_BACKUP_MAX_BYTES,
  mobileCreditPlanKey,
  parsePortableCreditPlan,
  portableCreditPlanJson,
  readMobileCreditPlan,
  writeMobileCreditPlan,
} from '../features/academics/creditPlanRepository';

const t = new Proxy({} as ThemeColors, {
  get(_target, key: string | symbol) {
    return typeof key === 'string' ? theme.colors[key as keyof ThemeColors] : undefined;
  },
});
const space = 16;
const categories = PLANNER_CATEGORIES;

type CourseForm = {
  name: string;
  credits: string;
  term: number;
  category: PlannerCategory;
  status: PlannerCourseStatus;
};

function emptyCourseForm(term = 1): CourseForm {
  return { name: '', credits: '3', term, category: 'elective', status: 'considering' };
}

function fieldInvalid(value: string): boolean {
  return value.trim() !== '' && parseCredits(value) === null;
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <View style={{
      backgroundColor: t.surface,
      borderWidth: 1,
      borderColor: t.border,
      borderRadius: 18,
      padding: 18,
      gap: 14,
    }}>
      {children}
    </View>
  );
}

function SectionTitle({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <View style={{ gap: 4, marginTop: 8 }}>
      <Text style={{ color: t.text, fontWeight: '700', fontSize: 19 }}>{title}</Text>
      {subtitle ? <Text style={{ color: t.muted, fontSize: 12, lineHeight: 19 }}>{subtitle}</Text> : null}
    </View>
  );
}

function Field({
  label,
  value,
  onChangeText,
  placeholder,
  keyboardType = 'default',
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
  keyboardType?: KeyboardTypeOptions;
}) {
  return (
    <View style={{ flex: 1, minWidth: 120, gap: 7 }}>
      <Text style={{ color: t.muted, fontSize: 12, fontWeight: '600' }}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={t.muted}
        keyboardType={keyboardType}
        autoCorrect={keyboardType === 'default'}
        style={{
          borderColor: fieldInvalid(value) && keyboardType === 'decimal-pad' ? t.danger : t.border,
          borderWidth: 1,
          borderRadius: 12,
          backgroundColor: t.surface2,
          color: t.text,
          minHeight: 48,
          fontSize: 15,
          paddingHorizontal: 13,
          paddingVertical: 9,
        }}
      />
    </View>
  );
}

function Action({
  title,
  onPress,
  primary = false,
  disabled = false,
}: {
  title: string;
  onPress: () => void;
  primary?: boolean;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={{
        minHeight: 44,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: primary ? t.accent : t.border,
        backgroundColor: primary ? t.accent : t.surface2,
        justifyContent: 'center',
        alignItems: 'center',
        paddingHorizontal: 16,
        opacity: disabled ? 0.55 : 1,
      }}
    >
      <Text style={{
        color: primary ? t.onAccent : t.text,
        fontSize: 14,
        fontWeight: '700',
      }}>{title}</Text>
    </Pressable>
  );
}

function Chip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={{
        minHeight: 44,
        justifyContent: 'center',
        paddingHorizontal: 13,
        paddingVertical: 9,
        borderRadius: 12,
        backgroundColor: selected ? t.accentSoft : t.surface2,
        borderWidth: 1,
        borderColor: selected ? t.accent : t.border,
      }}
    >
      <Text style={{ color: t.text, fontSize: 13, fontWeight: selected ? '700' : '500' }}>{label}</Text>
    </Pressable>
  );
}

export default function CreditPlanningScreen() {
  useThemeMode();
  const { user } = useAuth();
  const { school } = useSchool();
  const schoolId = school.id;
  const scopeKey = useMemo(() => mobileCreditPlanKey(user?.uid ?? null, schoolId), [user?.uid, schoolId]);
  const activeScope = useRef(scopeKey);
  activeScope.current = scopeKey;
  const generation = useRef(0);
  const savingScope = useRef<string | null>(null);

  const [plan, setPlan] = useState<CreditPlan | null>(null);
  const [loadedScope, setLoadedScope] = useState<string | null>(null);
  const [loadError, setLoadError] = useState('');
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(false);
  const [draftGoals, setDraftGoals] = useState({ recognized: '', target: '', extra: '' });
  const [categoryGoals, setCategoryGoals] = useState<CreditPlan['categoryGoals']>(emptyCreditPlan().categoryGoals);
  const [form, setForm] = useState<CourseForm>(emptyCourseForm());
  const [editId, setEditId] = useState<string | null>(null);
  const [milestoneLabel, setMilestoneLabel] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);

  const load = useCallback(async () => {
    const request = ++generation.current;
    setPlan(null);
    setLoadedScope(null);
    setSaving(false);
    setNotice('');
    setLoadError('');
    try {
      const saved = await readMobileCreditPlan(scopeKey);
      if (request !== generation.current || activeScope.current !== scopeKey) return;
      setPlan(saved);
      setDraftGoals({ recognized: saved.recognized, target: saved.target, extra: saved.extra });
      setCategoryGoals(saved.categoryGoals);
      setForm(emptyCourseForm());
      setEditId(null);
    } catch (error) {
      if (request !== generation.current || activeScope.current !== scopeKey) return;
      setLoadError(error instanceof Error ? error.message : '讀取個人規劃失敗，原資料仍保留。');
    } finally {
      if (request === generation.current && activeScope.current === scopeKey) setLoadedScope(scopeKey);
    }
  }, [scopeKey]);

  useEffect(() => {
    void load();
    return () => { generation.current += 1; };
  }, [load]);

  const summary = useMemo(() => plan ? creditPlanSummary(plan) : null, [plan]);

  async function save(next: CreditPlan, successMessage: string): Promise<boolean> {
    if (savingScope.current === scopeKey || activeScope.current !== scopeKey || loadedScope !== scopeKey) return false;
    savingScope.current = scopeKey;
    setSaving(true);
    try {
      await writeMobileCreditPlan(scopeKey, next);
      if (activeScope.current !== scopeKey) return false;
      setPlan(next);
      setLoadError('');
      setNotice(successMessage);
      return true;
    } catch (error) {
      if (activeScope.current === scopeKey) {
        Alert.alert('規劃未儲存', error instanceof Error ? error.message : '無法存到這台裝置。');
      }
      return false;
    } finally {
      if (savingScope.current === scopeKey) savingScope.current = null;
      if (activeScope.current === scopeKey) setSaving(false);
    }
  }

  function commitGoals() {
    if (!plan) return;
    for (const number of Object.values(draftGoals)) {
      if (fieldInvalid(number)) {
        Alert.alert('學分格式不正確', '請輸入 0–1000，最多兩位小數；留空代表尚未設定。');
        return;
      }
    }
    void save({ ...plan, ...draftGoals }, '個人目標已保存在這台裝置。');
  }

  function commitCourse() {
    if (!plan) return;
    const name = form.name.trim();
    const parsed = parseCredits(form.credits);
    if (!name || name.length > 80 || parsed === null || parsed <= 0 || parsed > 30) {
      Alert.alert('請檢查課程', '課程名稱需要 1–80 字，學分應為 0.01–30，最多兩位小數。');
      return;
    }
    if (!editId && plan.courses.length >= MAX_PLANNED_COURSES) {
      Alert.alert('課程數量已達上限', '每份規劃最多 120 門課，請先整理舊課程。');
      return;
    }
    if (plan.courses.some((course) =>
      course.id !== editId &&
      course.term === form.term &&
      course.name.trim().toLocaleLowerCase() === name.toLocaleLowerCase())) {
      Alert.alert('課程可能重複', '同一個未來學期已有同名課程，請確認後再編輯。');
      return;
    }
    const course: PlannedCourse = {
      id: editId ?? `mobile-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      name,
      credits: parsed,
      term: form.term,
      category: form.category,
      status: form.status,
    };
    const next = {
      ...plan,
      terms: Math.max(plan.terms, form.term),
      courses: editId ? plan.courses.map((item) => item.id === editId ? course : item) : [...plan.courses, course],
    };
    void save(next, editId ? '課程安排已更新。' : '課程已加入未來規劃。').then((ok) => {
      if (ok) {
        setForm(emptyCourseForm(form.term));
        setEditId(null);
      }
    });
  }

  function removeCourse(course: PlannedCourse) {
    if (!plan) return;
    Alert.alert('移除課程', `確定從個人規劃移除「${course.name}」？不影響學校課表或成績。`, [
      { text: '取消', style: 'cancel' },
      {
        text: '移除',
        style: 'destructive',
        onPress: () => {
          void save({
            ...plan,
            courses: plan.courses.filter((item) => item.id !== course.id),
          }, '已從本機規劃移除課程。');
        },
      },
    ]);
  }

  function commitCategories() {
    if (!plan) return;
    if (categories.some(({ key }) =>
      fieldInvalid(categoryGoals[key].recognized) || fieldInvalid(categoryGoals[key].target))) {
      Alert.alert('請核對分類門檻', '學分須為 0–1000，最多兩位小數。');
      return;
    }
    void save({ ...plan, categoryGoals }, '分類目標已更新。');
  }

  function addMilestone() {
    if (!plan) return;
    const label = milestoneLabel.trim();
    if (label.length < 2 || label.length > 80 || plan.milestones.length >= MAX_MILESTONES) {
      Alert.alert('條件無法新增', '名稱需要 2–80 字，每份規劃最多 24 項條件。');
      return;
    }
    const id = `milestone-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    void save({
      ...plan,
      milestones: [...plan.milestones, { id, label, done: false }],
    }, '條件已加入個人清單。').then((ok) => { if (ok) setMilestoneLabel(''); });
  }

  async function importBackup() {
    if (saving || loadedScope !== scopeKey) return;
    const expectedScope = scopeKey;
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['application/json', 'text/plain', '*/*'],
        copyToCacheDirectory: true,
      });
      if (result.canceled || !result.assets?.[0] || activeScope.current !== expectedScope) return;
      const asset = result.assets[0];
      if (asset.size != null && asset.size > CREDIT_PLAN_BACKUP_MAX_BYTES) {
        Alert.alert('檔案過大', '請選擇小於 90 KB 的學分規劃 JSON 備份。');
        return;
      }
      const raw = await new File(asset.uri).text();
      const imported = parsePortableCreditPlan(raw);
      if (activeScope.current !== expectedScope) return;
      const importedSummary = creditPlanSummary(imported);
      Alert.alert(
        '確認匯入學分規劃',
        `這份備份包含 ${imported.courses.length} 門規劃課程、${imported.milestones.length} 項條件，目標 ${importedSummary.target === null ? '尚未設定' : importedSummary.target + ' 學分'}。\n\n匯入後將取代目前這間校園的本機規劃，不會動到學校正式紀錄。`,
        [
          { text: '取消', style: 'cancel' },
          {
            text: '確認取代',
            onPress: () => {
              if (activeScope.current !== expectedScope) return;
              void save(imported, 'Web／手機相容的 JSON 備份已匯入。').then((ok) => {
                if (!ok) return;
                setDraftGoals({ recognized: imported.recognized, target: imported.target, extra: imported.extra });
                setCategoryGoals(imported.categoryGoals);
                setForm(emptyCourseForm());
                setEditId(null);
              });
            },
          },
        ],
      );
    } catch (error) {
      if (activeScope.current === expectedScope) {
        Alert.alert('無法匯入', error instanceof Error ? error.message : '這份備份無法讀取。');
      }
    }
  }

  async function exportBackup() {
    if (!plan) return;
    try {
      const data = portableCreditPlanJson(plan);
      const filename = `campus-credit-plan-${new Date().toISOString().slice(0, 10)}.json`;
      const file = new File(Paths.cache, filename);
      await file.write(data);
      if (await isAvailableAsync()) {
        await shareAsync(file.uri, {
          mimeType: 'application/json',
          dialogTitle: '分享或儲存學分規劃備份',
          UTI: 'public.json',
        });
      } else {
        Alert.alert('備份建立完成', '已建立暫存備份，這台裝置未提供分享功能。請在暫存檔清除前另行保存。');
      }
    } catch (error) {
      Alert.alert('無法匯出備份', error instanceof Error ? error.message : '請稍後再試。');
    }
  }

  if (loadedScope !== scopeKey) {
    return (
      <Screen title="未來學分規劃">
        <View style={{ padding: 24, gap: 14 }}>
          <Spinner size={28} />
          <Text style={{ color: t.muted, fontSize: 14 }}>正在讀取這台裝置的個人規劃…</Text>
        </View>
      </Screen>
    );
  }
  if (loadError || !plan || !summary) {
    return (
      <Screen title="未來學分規劃">
        <View style={{ padding: 24, gap: 14 }}>
          <Text style={{ color: t.text, fontSize: 15, lineHeight: 23 }}>{loadError || '目前無法載入規劃。'}</Text>
          <Text style={{ color: t.muted, fontSize: 12 }}>原有資料沒有被重設或覆寫。</Text>
          <Action title="重新讀取" primary onPress={() => void load()} />
          <Action title="使用 JSON 備份修復" onPress={() => void importBackup()} />
          <Text style={{ color: t.muted, fontSize: 12, lineHeight: 20 }}>
            只有你主動選擇備份並確認取代時，才會寫入本機規劃；原始資料不會因為讀取失敗而自動清除。
          </Text>
        </View>
      </Screen>
    );
  }

  const metric = (value: number | null) => value === null ? '—' : formatCredits(value);

  return (
    <Screen title="未來學分規劃" subtitle={`${school.name} · 個人修課草稿`}>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: space, paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING + 28, gap: 17 }}
      >
        <View style={{
          padding: 22,
          borderRadius: 22,
          backgroundColor: t.accentSoft,
          borderWidth: 1,
          borderColor: t.border,
          gap: 12,
        }}>
          <Text style={{ color: t.text, fontSize: 12, fontWeight: '700', letterSpacing: 0.8 }}>
            MY DEGREE ROADMAP
          </Text>
          <Text style={{ color: t.text, fontSize: 25, lineHeight: 34, fontWeight: '700' }}>
            把未來的學分，排成可執行的計畫。
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
            <View style={{ flex: 1, minWidth: 90 }}>
              <Text style={{ color: t.muted, fontSize: 11 }}>已確認採計（手填）</Text>
              <Text style={{ color: t.text, fontSize: 27, fontWeight: '700', marginTop: 4 }}>{metric(summary.recognized)}</Text>
            </View>
            <View style={{ flex: 1, minWidth: 90 }}>
              <Text style={{ color: t.muted, fontSize: 11 }}>規劃中（尚未取得）</Text>
              <Text style={{ color: t.text, fontSize: 27, fontWeight: '700', marginTop: 4 }}>{metric(summary.planned)}</Text>
            </View>
            <View style={{ flex: 1, minWidth: 90 }}>
              <Text style={{ color: t.muted, fontSize: 11 }}>預估還差</Text>
              <Text style={{ color: t.text, fontSize: 27, fontWeight: '700', marginTop: 4 }}>{metric(summary.remaining)}</Text>
            </View>
          </View>
          {summary.target !== null && summary.target > 0 && summary.projected !== null ? (
            <View
              accessibilityRole="progressbar"
              accessibilityLabel="假設全部規劃通過後的進度"
              accessibilityValue={{ min: 0, max: 100, now: summary.progress }}
              style={{ height: 8, backgroundColor: t.border, borderRadius: 8, overflow: 'hidden' }}
            >
              <View style={{ height: 8, width: `${summary.progress}%` as `${number}%`, borderRadius: 8, backgroundColor: t.accent }} />
            </View>
          ) : null}
          <Text style={{ color: t.muted, fontSize: 12, lineHeight: 19 }}>
            假設規劃的每門課全部修過且可採計，才有上述預估值。已選課不代表已取得，達到總學分也不等於正式畢業。
          </Text>
        </View>

        <SectionTitle title="設定學分目標" subtitle="只填學校已確認採計的學分；不要把下面還沒修的課先加進去。" />
        <Card>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
            <Field label="已確認可採計學分" keyboardType="decimal-pad" placeholder="例如 60" value={draftGoals.recognized}
              onChangeText={(value) => setDraftGoals((old) => ({ ...old, recognized: value }))} />
            <Field label="希望累計的學分" keyboardType="decimal-pad" placeholder="例如 128" value={draftGoals.target}
              onChangeText={(value) => setDraftGoals((old) => ({ ...old, target: value }))} />
          </View>
          <Field label="未列成課程的其他預計學分" keyboardType="decimal-pad" placeholder="可留空"
            value={draftGoals.extra} onChangeText={(value) => setDraftGoals((old) => ({ ...old, extra: value }))} />
          <Text style={{ color: t.muted, fontSize: 12, lineHeight: 19 }}>
            此處僅保留個人設定，不會修改課表、成績或選課系統。
          </Text>
          <Action title={saving ? '儲存中…' : '儲存學分目標'} onPress={commitGoals} primary disabled={saving} />
        </Card>

        <SectionTitle title="分學期安排" subtitle="候選課程與已選課都列為尚未取得學分。切換每個學期，查看修課負擔。" />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 9, paddingRight: 10 }}>
          {summary.perTerm.map((entry) => (
            <Chip key={entry.term}
              label={`第 ${entry.term} 學期 · ${formatCredits(entry.credits)}`}
              selected={form.term === entry.term}
              onPress={() => setForm((prev) => ({ ...prev, term: entry.term }))} />
          ))}
          {plan.terms < 8 ? (
            <Chip label="＋ 增加學期" selected={false} onPress={() => {
              void save({ ...plan, terms: Math.min(8, plan.terms + 1) }, '已延長規劃學期。');
            }} />
          ) : null}
        </ScrollView>
        <Card>
          <Text style={{ color: t.text, fontSize: 17, fontWeight: '700' }}>
            {editId ? '調整課程安排' : '加入未來課程'}
          </Text>
          <Field label="課程名稱" placeholder="例如：資料庫系統" value={form.name}
            onChangeText={(value) => setForm((prev) => ({ ...prev, name: value }))} />
          <View style={{ flexDirection: 'row', gap: 12 }}>
            <Field label="學分" keyboardType="decimal-pad" value={form.credits}
              onChangeText={(value) => setForm((prev) => ({ ...prev, credits: value }))} />
            <View style={{ flex: 1, gap: 7 }}>
              <Text style={{ color: t.muted, fontSize: 12 }}>預計學期</Text>
              <Text style={{ color: t.text, fontSize: 15, marginTop: 12 }}>第 {form.term} 學期</Text>
            </View>
          </View>
          <Text style={{ color: t.muted, fontSize: 12 }}>課程分類（手動設定）</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7 }}>
            {categories.map(({ key, label }) => (
              <Chip key={key} label={label} selected={form.category === key}
                onPress={() => setForm((prev) => ({ ...prev, category: key }))} />
            ))}
          </View>
          <Text style={{ color: t.muted, fontSize: 12 }}>目前安排狀態</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            <Chip label="候選課程" selected={form.status === 'considering'}
              onPress={() => setForm((prev) => ({ ...prev, status: 'considering' }))} />
            <Chip label="已選課（未取得）" selected={form.status === 'registered'}
              onPress={() => setForm((prev) => ({ ...prev, status: 'registered' }))} />
          </View>
          <Action title={saving ? '儲存中…' : editId ? '儲存課程修改' : '加入修課規劃'}
            onPress={commitCourse} disabled={saving} primary />
          {editId ? <Action title="取消修改" onPress={() => { setEditId(null); setForm(emptyCourseForm(form.term)); }} /> : null}
        </Card>

        <SectionTitle title={`已安排課程 · ${plan.courses.length} 門`} subtitle="每門課都能重新修改或移除，無須回到上一個頁面。" />
        {plan.courses.length ? (
          <View style={{ gap: 9 }}>
            {[...plan.courses].sort((a, b) => a.term - b.term).map((course) => (
              <View key={course.id} style={{
                backgroundColor: t.surface,
                borderRadius: 15,
                borderWidth: 1,
                borderColor: t.border,
                padding: 14,
                gap: 10,
              }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: t.text, fontSize: 15, fontWeight: '700' }}>{course.name}</Text>
                    <Text style={{ color: t.muted, fontSize: 12, marginTop: 5 }}>
                      第 {course.term} 學期 · {categories.find((item) => item.key === course.category)?.label} · {course.status === 'registered' ? '已選課（未取得）' : '候選'}
                    </Text>
                  </View>
                  <Text style={{ color: t.text, fontSize: 20, fontWeight: '700' }}>{formatCredits(course.credits)}
                    <Text style={{ color: t.muted, fontSize: 11 }}> 學分</Text>
                  </Text>
                </View>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <View style={{ flex: 1 }}><Action title="編輯" onPress={() => {
                    setEditId(course.id);
                    setForm({
                      name: course.name, credits: formatCredits(course.credits), term: course.term,
                      category: course.category, status: course.status,
                    });
                  }} /></View>
                  <View style={{ flex: 1 }}><Action title="移除" onPress={() => removeCourse(course)} /></View>
                </View>
              </View>
            ))}
          </View>
        ) : (
          <Card>
            <Ionicons name="albums-outline" size={30} color={t.muted} />
            <Text style={{ color: t.text, fontSize: 15, fontWeight: '700' }}>還沒有安排課程</Text>
            <Text style={{ color: t.muted, fontSize: 12, lineHeight: 19 }}>先加入一門候選課程，就能看到學期學分量與預估進度。</Text>
          </Card>
        )}

        <Pressable accessibilityRole="button" onPress={() => setShowAdvanced((value) => !value)}
          style={{ minHeight: 55, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 4 }}>
          <Text style={{ color: t.text, fontSize: 17, fontWeight: '700' }}>分類門檻與非學分條件</Text>
          <Ionicons name={showAdvanced ? 'chevron-up' : 'chevron-down'} size={22} color={t.muted} />
        </Pressable>
        {showAdvanced ? (
          <>
            <Card>
              <Text style={{ color: t.muted, fontSize: 12, lineHeight: 19 }}>
                各校規定不同；請自行從正式審查單填入門檻。這些類別目標不會自動代替正式學程規則。
              </Text>
              {categories.map(({ key, label }) => {
                const gap = summary.categoryGaps.find((item) => item.key === key);
                return (
                  <View key={key} style={{ gap: 10, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: t.border }}>
                    <Text style={{ color: t.text, fontSize: 15, fontWeight: '700' }}>{label} · 已規劃 {formatCredits(gap?.planned ?? 0)} 學分</Text>
                    <View style={{ flexDirection: 'row', gap: 12 }}>
                      <Field label={`${label}已確認採計`} keyboardType="decimal-pad"
                        value={categoryGoals[key].recognized}
                        onChangeText={(value) => setCategoryGoals((old) => ({ ...old, [key]: { ...old[key], recognized: value } }))} />
                      <Field label={`${label}目標門檻`} keyboardType="decimal-pad"
                        value={categoryGoals[key].target}
                        onChangeText={(value) => setCategoryGoals((old) => ({ ...old, [key]: { ...old[key], target: value } }))} />
                    </View>
                    <Text style={{ color: t.muted, fontSize: 12 }}>
                      {gap?.remaining === null ? '設定目標與已確認學分後顯示缺口' : `假設都通過且可採計，此類還差 ${metric(gap?.remaining ?? null)} 學分`}
                    </Text>
                  </View>
                );
              })}
              {summary.categoryOvercount ? (
                <Text style={{ color: t.danger, fontSize: 12 }}>目前分類已確認學分總和超過整體已確認學分，請檢查重複採計。</Text>
              ) : null}
              <Action title="儲存分類門檻" onPress={commitCategories} primary disabled={saving} />
            </Card>
            <Card>
              <Text style={{ color: t.text, fontSize: 16, fontWeight: '700' }}>非學分畢業條件</Text>
              <Text style={{ color: t.muted, fontSize: 12, lineHeight: 19 }}>
                例如語言檢定、服務學習；勾選只代表個人紀錄，不代表校方已通過。
              </Text>
              {plan.milestones.map((item) => (
                <View key={item.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, justifyContent: 'space-between' }}>
                  <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: item.done }}
                    accessibilityLabel={item.label} disabled={saving} onPress={() => {
                      void save({ ...plan, milestones: plan.milestones.map((entry) =>
                        entry.id === item.id ? { ...entry, done: !entry.done } : entry,
                      ) }, '個人檢核狀態已更新。');
                    }}
                    style={{ flex: 1, minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                    <Ionicons name={item.done ? 'checkbox' : 'square-outline'} size={22} color={t.accent} />
                    <Text style={{ color: t.text, fontSize: 13, flex: 1 }}>{item.label}</Text>
                  </Pressable>
                  <Pressable accessibilityRole="button" accessibilityLabel={`移除${item.label}`} disabled={saving}
                    onPress={() => Alert.alert('移除條件', `確定移除「${item.label}」？`, [
                      { text: '取消', style: 'cancel' },
                      { text: '移除', style: 'destructive', onPress: () => void save({
                        ...plan, milestones: plan.milestones.filter((entry) => entry.id !== item.id),
                      }, '個人條件已移除。') },
                    ])} style={{ minHeight: 44, padding: 10, justifyContent: 'center' }}>
                    <Text style={{ color: t.muted, fontSize: 12 }}>移除</Text>
                  </Pressable>
                </View>
              ))}
              <Field label="新增畢業條件（自行核對）" placeholder="例如：英文能力門檻"
                value={milestoneLabel} onChangeText={setMilestoneLabel} />
              <Action title="新增非學分條件" onPress={addMilestone} disabled={saving} />
            </Card>
          </>
        ) : null}

        <SectionTitle title="備份與跨裝置移轉" subtitle="手機和 Web 採用同一個 JSON 格式，但目前不會自動雲端同步。" />
        <Card>
          <Text style={{ color: t.muted, fontSize: 12, lineHeight: 20 }}>
            這份規劃只存在目前帳號、這間校園在此裝置的本機空間。可從 Web「備份 JSON」匯出，再在這裡匯入；反向亦然。匯入會取代目前規劃，先確認內容才會保存。
          </Text>
          <Action title="匯出規劃 JSON" onPress={() => void exportBackup()} disabled={saving} />
          <Action title="匯入 Web／手機 JSON 備份" onPress={() => void importBackup()} disabled={saving} />
          {!user ? <Text style={{ color: t.muted, fontSize: 12 }}>
            目前是訪客模式；若使用共用裝置，請避免輸入私人資料並在使用後清除裝置資料。
          </Text> : null}
        </Card>

        <View style={{ backgroundColor: t.surface2, padding: 14, borderRadius: 13 }}>
          <Text style={{ color: t.muted, fontSize: 12, lineHeight: 20 }}>
            提醒：學分規劃不等於畢業資格審查，也不會幫你選課。學校成績、抵免、必修、學制、年度、通識領域與非學分門檻，請依校方正式規定確認。
          </Text>
        </View>
        {notice ? <Text accessibilityRole="text" style={{ color: t.muted, fontSize: 12, lineHeight: 18 }}>{notice}</Text> : null}
      </ScrollView>
    </Screen>
  );
}
