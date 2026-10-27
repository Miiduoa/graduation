import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert, Pressable, ScrollView, Text, TextInput, View,
  type KeyboardTypeOptions,
} from 'react-native';
import { File, Paths } from 'expo-file-system';
import * as DocumentPicker from 'expo-document-picker';
import { isAvailableAsync, shareAsync } from 'expo-sharing';
import { Ionicons } from '@expo/vector-icons';
import {
  MAX_MILESTONES, MAX_PLANNED_COURSES, PLANNER_CATEGORIES,
  creditPlanSummary, emptyCreditPlan, formatCredits, parseCredits,
  type CreditPlan, type PlannedCourse,
} from '@campus/shared/src/creditPlanner';
import { Screen, Spinner } from '../ui/components';
import { CreditPlanFeasibilityCard } from './creditAudit/CreditPlanFeasibilityCard';
import { useAuth } from '../state/auth';
import { useSchool } from '../state/school';
import { theme } from '../ui/theme';
import { useThemeMode } from '../state/theme';
import { TAB_BAR_CONTENT_BOTTOM_PADDING } from '../ui/navigationTheme';
import {
  CREDIT_PLAN_BACKUP_MAX_BYTES, mobileCreditPlanKey, parsePortableCreditPlan,
  portableCreditPlanJson,
} from '../features/academics/creditPlanRepository';
import type { CreditPlanTicket } from '../features/academics/creditPlanSession';
import { useCreditPlanningWorkspace } from './creditAudit/useCreditPlanningWorkspace';
import type { NavigationAction } from '@react-navigation/native';
import {
  creditPlanDirtySections, creditCourseHasChanges,
  emptyCreditCourseForm as emptyForm, type CreditCourseForm as CourseForm,
} from '../features/academics/creditPlanDrafts';
import {
  CreditPlanNavigationGuard, useCreditPlanDraftProtection,
} from './creditAudit/useCreditPlanDraftProtection';

type Props = { navigation?: {
  goBack?: () => void;
  dispatch?: (action: NavigationAction) => void;
} };
const categories = PLANNER_CATEGORIES;
const invalid = (value: string) => value.trim() !== '' && parseCredits(value) === null;
const metric = (value: number | null) => value === null ? '—' : formatCredits(value);

function Card({ children }: { children: React.ReactNode }) {
  const t = theme.colors;
  return <View style={{ backgroundColor: t.surface, borderWidth: 1, borderColor: t.border,
    borderRadius: 18, padding: 18, gap: 14 }}>{children}</View>;
}
function Heading({ title, subtitle }: { title: string; subtitle: string }) {
  const t = theme.colors;
  return <View style={{ gap: 5, marginTop: 8 }}>
    <Text style={{ color: t.text, fontWeight: '700', fontSize: 19 }}>{title}</Text>
    <Text style={{ color: t.muted, fontSize: 12, lineHeight: 19 }}>{subtitle}</Text>
  </View>;
}
function Field({ label, value, onChangeText, placeholder, disabled = false,
  keyboardType = 'default', inputRef }: {
  label: string; value: string; onChangeText: (value: string) => void;
  placeholder?: string; disabled?: boolean; keyboardType?: KeyboardTypeOptions;
  inputRef?: React.Ref<TextInput>;
}) {
  const t = theme.colors;
  return <View style={{ flex: 1, minWidth: 120, gap: 7 }}>
    <Text style={{ color: t.muted, fontSize: 12, fontWeight: '600' }}>{label}</Text>
    <TextInput ref={inputRef} accessibilityLabel={label} value={value} onChangeText={onChangeText}
      editable={!disabled} accessibilityState={{ disabled }}
      placeholder={placeholder} placeholderTextColor={t.muted} keyboardType={keyboardType}
      autoCorrect={keyboardType === 'default'}
      style={{ borderWidth: 1, borderRadius: 12, minHeight: 48, paddingHorizontal: 13,
        paddingVertical: 9, fontSize: 15, color: t.text, backgroundColor: t.surface2,
        borderColor: keyboardType === 'decimal-pad' && invalid(value) ? t.danger : t.border }} />
  </View>;
}
function Action({ title, label = title, onPress, primary = false, disabled = false }: {
  title: string; label?: string; onPress: () => void; primary?: boolean; disabled?: boolean;
}) {
  const t = theme.colors;
  return <Pressable accessibilityRole="button" accessibilityLabel={label}
    accessibilityState={{ disabled }} disabled={disabled} onPress={onPress}
    style={{ minHeight: 44, borderRadius: 12, borderWidth: 1, paddingHorizontal: 16,
      paddingVertical: 10, justifyContent: 'center', alignItems: 'center',
      borderColor: primary ? t.accent : t.border,
      backgroundColor: primary ? t.accent : t.surface2, opacity: disabled ? 0.55 : 1 }}>
    <Text style={{ color: primary ? t.onAccent : t.text, fontSize: 14, fontWeight: '700' }}>{title}</Text>
  </Pressable>;
}
function Chip({ label, selected, onPress, disabled }: {
  label: string; selected: boolean; onPress: () => void; disabled: boolean;
}) {
  const t = theme.colors;
  return <Pressable accessibilityRole="button" accessibilityLabel={label}
    accessibilityState={{ selected, disabled }} disabled={disabled} onPress={onPress}
    style={{ minHeight: 44, borderRadius: 12, borderWidth: 1, paddingHorizontal: 13,
      paddingVertical: 9, justifyContent: 'center', borderColor: selected ? t.accent : t.border,
      backgroundColor: selected ? t.accentSoft : t.surface2, opacity: disabled ? 0.55 : 1 }}>
    <Text style={{ color: t.text, fontSize: 13, fontWeight: selected ? '700' : '500' }}>{label}</Text>
  </Pressable>;
}

export default function CreditPlanningScreen({ navigation }: Props = {}) {
  useThemeMode();
  const { user, loading } = useAuth();
  const { school } = useSchool();
  if (loading || !school?.id) {
    return <Screen title="未來學分規劃"><Spinner size={28} />
      <Text style={{ color: theme.colors.muted }}>正在確認帳號與校園…</Text>
    </Screen>;
  }
  const scopeKey = mobileCreditPlanKey(user?.uid ?? null, school.id);
  // A -> B -> A must create a *new* instance, not revive A's pending dialogs.
  return <Workspace key={scopeKey} scopeKey={scopeKey} schoolName={school.name}
    guest={!user} navigation={navigation} />;
}

function Workspace({ scopeKey, schoolName, guest, navigation }: {
  scopeKey: string; schoolName: string; guest: boolean; navigation?: Props['navigation'];
}) {
  const t = theme.colors;
  const workspace = useCreditPlanningWorkspace(scopeKey);
  const { plan, phase, ticket, session, save, saving } = workspace;
  const summary = useMemo(() => plan ? creditPlanSummary(plan) : null, [plan]);
  const [goals, setGoals] = useState({ recognized: '', target: '', extra: '' });
  const [categoryGoals, setCategoryGoals] = useState(emptyCreditPlan().categoryGoals);
  const [form, setForm] = useState<CourseForm>(emptyForm());
  const [editId, setEditId] = useState<string | null>(null);
  const [milestoneLabel, setMilestoneLabel] = useState('');
  const [advanced, setAdvanced] = useState(false);
  const [transferring, setTransferring] = useState(false);
  const transfer = useRef<symbol | null>(null);
  const hydrated = useRef(-1);
  const scroll = useRef<ScrollView>(null);
  const nameInput = useRef<TextInput>(null);
  const editorY = useRef(0);
  const busy = saving || transferring;
  const inputs = useMemo(() => ({ goals, categoryGoals, form, editId, milestoneLabel }),
    [goals, categoryGoals, form, editId, milestoneLabel]);
  const dirtySections = creditPlanDirtySections(plan, inputs);
  const courseDirty = plan ? creditCourseHasChanges(plan, inputs) : false;
  const confirmAction = useCreditPlanDraftProtection({ inputs, ticket, session, busy });

  function requestLeave(leave: () => void) {
    if (busy) {
      Alert.alert('請先完成目前操作', '正在儲存或處理備份，完成後再返回，避免遺失尚未儲存的輸入。');
      return;
    }
    confirmAction(dirtySections.length > 0, leave, {
      title: '尚有未儲存的內容',
      message: `${dirtySections.join('、')}尚未儲存。離開會捨棄這些輸入，已儲存的規劃不受影響。`,
      confirmText: '捨棄並離開',
    });
  }
  function requestExport() {
    confirmAction(dirtySections.length > 0, () => void exportBackup(), {
      title: '備份不含尚未儲存的輸入',
      message: `${dirtySections.join('、')}尚未儲存。請先儲存各區塊，或只匯出目前已儲存的版本；輸入仍會保留。`,
      confirmText: '只匯出已儲存版本', cancelText: '返回儲存', destructive: false,
    });
  }
  function cancelCourseEdit() {
    confirmAction(courseDirty, () => { setEditId(null); setForm(emptyForm(form.term)); }, {
      title: '捨棄課程修改？', message: '這門課尚未儲存的修改會被捨棄，原有課程不會刪除。',
      confirmText: '捨棄修改',
    });
  }

  function applyFormValues(value: CreditPlan) {
    setGoals({ recognized: value.recognized, target: value.target, extra: value.extra });
    setCategoryGoals(value.categoryGoals);
    setForm(emptyForm());
    setEditId(null);
    setMilestoneLabel('');
  }
  useEffect(() => {
    if (phase === 'ready' && plan && hydrated.current !== ticket.generation) {
      hydrated.current = ticket.generation;
      setGoals({ recognized: plan.recognized, target: plan.target, extra: plan.extra });
      setCategoryGoals(plan.categoryGoals);
      setForm(emptyForm());
      setEditId(null);
      setMilestoneLabel('');
    }
  }, [phase, plan, ticket.generation]);

  function current(expected: CreditPlanTicket): boolean {
    if (!session.isLive(expected)) return false;
    if (!session.isCurrent(expected)) {
      Alert.alert('規劃已更新', '目前規劃與剛才的確認內容不同，請重新操作；新的內容沒有被覆蓋。');
      return false;
    }
    return true;
  }
  function finishTransfer(id: symbol, expected: CreditPlanTicket) {
    if (transfer.current !== id) return;
    transfer.current = null;
    if (session.isLive(expected)) setTransferring(false);
  }
  function commitGoals() {
    if (!plan || busy) return;
    if (Object.values(goals).some(invalid)) {
      Alert.alert('學分格式不正確', '請輸入 0–1000，最多兩位小數；留空代表尚未設定。');
      return;
    }
    void save({ ...plan, ...goals }, '個人目標已保存在這台裝置。');
  }
  function commitCourse() {
    if (!plan || busy) return;
    const name = form.name.trim();
    const credits = parseCredits(form.credits);
    if (!name || name.length > 80 || credits === null || credits <= 0 || credits > 30) {
      Alert.alert('請檢查課程', '課程名稱需要 1–80 字，學分應為 0.01–30，最多兩位小數。');
      return;
    }
    if (!editId && plan.courses.length >= MAX_PLANNED_COURSES) {
      Alert.alert('課程數量已達上限', '每份規劃最多 120 門課，請先整理舊課程。');
      return;
    }
    if (editId && !plan.courses.some((course) => course.id === editId)) {
      Alert.alert('課程已不存在', '請重新選擇要編輯的課程。');
      return;
    }
    if (plan.courses.some((course) => course.id !== editId && course.term === form.term &&
      course.name.trim().toLocaleLowerCase() === name.toLocaleLowerCase())) {
      Alert.alert('課程可能重複', '同一個未來學期已有同名課程，請先編輯原課程。');
      return;
    }
    const course: PlannedCourse = { ...form, name, credits,
      id: editId ?? `mobile-${Date.now()}-${Math.random().toString(36).slice(2)}` };
    void save({ ...plan, terms: Math.max(plan.terms, course.term),
      courses: editId ? plan.courses.map((row) => row.id === editId ? course : row) : [...plan.courses, course],
    }, editId ? '課程安排已更新。' : '課程已加入未來規劃。').then((saved) => {
      if (saved && session.isCurrent(saved.ticket)) {
        setForm(emptyForm(form.term));
        setEditId(null);
      }
    });
  }
  function editCourse(course: PlannedCourse) {
    if (busy) return;
    const focusEditor = () => {
      scroll.current?.scrollTo({ y: Math.max(0, editorY.current - 12), animated: true });
      nameInput.current?.focus();
    };
    // Tapping the same course is a shortcut back to its current draft, not a reset.
    if (editId === course.id) { focusEditor(); return; }
    confirmAction(courseDirty, () => {
      setEditId(course.id);
      setForm({ ...course, credits: formatCredits(course.credits) });
      focusEditor();
    }, {
      title: '捨棄目前課程輸入？',
      message: `目前課程尚未儲存。改編輯「${course.name}」會捨棄這份課程輸入，其他區塊不受影響。`,
      confirmText: '捨棄並切換',
    });
  }
  function removeCourse(course: PlannedCourse) {
    if (!plan || busy) return;
    const expected = ticket;
    Alert.alert('移除課程', `確定從個人規劃移除「${course.name}」？不影響學校課表或成績。`, [
      { text: '取消', style: 'cancel' },
      { text: '移除', style: 'destructive', onPress: () => {
        void save({ ...plan, courses: plan.courses.filter((row) => row.id !== course.id) },
          '已從本機規劃移除課程。', expected).then((saved) => {
            if (saved && session.isCurrent(saved.ticket) && editId === course.id) {
              setEditId(null);
              setForm(emptyForm(form.term));
            }
          });
      } },
    ]);
  }
  function commitCategories() {
    if (!plan || busy) return;
    if (categories.some(({ key }) => invalid(categoryGoals[key].recognized) || invalid(categoryGoals[key].target))) {
      Alert.alert('請核對分類門檻', '學分須為 0–1000，最多兩位小數。');
      return;
    }
    void save({ ...plan, categoryGoals }, '分類目標已更新。');
  }
  function addMilestone() {
    if (!plan || busy) return;
    const label = milestoneLabel.trim();
    if (label.length < 2 || label.length > 80 || plan.milestones.length >= MAX_MILESTONES) {
      Alert.alert('條件無法新增', '名稱需要 2–80 字，每份規劃最多 24 項條件。');
      return;
    }
    const id = `milestone-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    void save({ ...plan, milestones: [...plan.milestones, { id, label, done: false }] },
      '條件已加入個人清單。').then((saved) => {
        if (saved && session.isCurrent(saved.ticket)) setMilestoneLabel('');
      });
  }
  async function importBackup() {
    if (busy || transfer.current || phase === 'loading' || !current(ticket)) return;
    const expected = ticket;
    const id = Symbol('import');
    transfer.current = id;
    setTransferring(true);
    let confirming = false;
    try {
      const result = await DocumentPicker.getDocumentAsync({ type: ['application/json', 'text/plain', '*/*'], copyToCacheDirectory: true });
      if (!current(expected) || result.canceled || !result.assets?.[0]) return;
      const asset = result.assets[0];
      if (asset.size != null && asset.size > CREDIT_PLAN_BACKUP_MAX_BYTES) {
        Alert.alert('檔案過大', '請選擇小於 90 KB 的學分規劃 JSON 備份。');
        return;
      }
      const raw = await new File(asset.uri).text();
      if (!current(expected)) return;
      const imported = parsePortableCreditPlan(raw);
      const total = creditPlanSummary(imported);
      confirming = true;
      Alert.alert('確認匯入學分規劃',
        `這份備份包含 ${imported.courses.length} 門課程、${imported.milestones.length} 項條件，目標 ${total.target === null ? '尚未設定' : total.target + ' 學分'}。\n\n確認後會取代目前「${schoolName}」的本機規劃與尚未儲存的輸入，不會修改學校正式紀錄。`, [
          { text: '取消', style: 'cancel', onPress: () => finishTransfer(id, expected) },
          { text: '確認取代', onPress: () => {
            if (transfer.current !== id) return;
            if (!current(expected)) { finishTransfer(id, expected); return; }
            void save(imported, 'Web／手機相容的 JSON 備份已匯入。', expected).then((saved) => {
              if (saved && session.isCurrent(saved.ticket)) applyFormValues(saved.plan);
            }).finally(() => finishTransfer(id, expected));
          } },
        ], { cancelable: true, onDismiss: () => finishTransfer(id, expected) });
    } catch (error) {
      if (session.isLive(expected)) Alert.alert('無法匯入', error instanceof Error ? error.message : '這份備份無法讀取。');
    } finally {
      if (!confirming) finishTransfer(id, expected);
    }
  }
  async function exportBackup() {
    if (!plan || busy || transfer.current || !current(ticket)) return;
    const expected = ticket;
    const id = Symbol('export');
    transfer.current = id;
    setTransferring(true);
    let file: File | null = null;
    let handedToShare = false;
    try {
      const data = portableCreditPlanJson(plan);
      const name = `campus-credit-plan-${Date.now()}-${Math.random().toString(36).slice(2)}.json`;
      file = new File(Paths.cache, name);
      await file.write(data);
      if (!current(expected)) return;
      const available = await isAvailableAsync();
      if (!current(expected)) return;
      if (!available) {
        Alert.alert('目前無法分享備份', '這台裝置未提供分享功能；尚未完成備份，本機規劃仍保留。');
        return;
      }
      handedToShare = true;
      await shareAsync(file.uri, { mimeType: 'application/json', dialogTitle: '分享或儲存學分規劃備份', UTI: 'public.json' });
    } catch (error) {
      if (session.isLive(expected)) Alert.alert('無法匯出備份', error instanceof Error ? error.message : '請稍後再試。');
    } finally {
      // An external recipient may still be reading after its share intent opens.
      // Keep handed-off files in the OS cache; clean only aborted local exports.
      try { if (!handedToShare) file?.delete(); } catch { /* Already removed from cache. */ }
      finishTransfer(id, expected);
    }
  }

  const navigationGuard = navigation?.dispatch ? <CreditPlanNavigationGuard
    preventRemove={busy || dirtySections.length > 0} onAttemptLeave={requestLeave}
    dispatch={navigation.dispatch} /> : null;
  const back = navigation?.goBack ? <Action title="返回" label="返回學分總覽" disabled={busy}
    onPress={() => navigation.dispatch ? navigation.goBack?.() : requestLeave(() => navigation.goBack?.())} /> : undefined;
  if (phase === 'loading') return <Screen title="未來學分規劃" headerRight={back}>
    {navigationGuard}
    <View style={{ padding: 24, gap: 14 }}><Spinner size={28} />
      <Text style={{ color: t.muted }}>正在讀取這台裝置的個人規劃…</Text></View>
  </Screen>;
  if (phase === 'error' || !plan || !summary) return <Screen title="未來學分規劃" headerRight={back}>
    {navigationGuard}
    <View style={{ padding: 24, gap: 14 }}>
      <Text style={{ color: t.text, fontSize: 15, lineHeight: 23 }}>{workspace.error || '目前無法載入規劃。'}</Text>
      <Text style={{ color: t.muted }}>原有資料沒有被重設或覆寫。</Text>
      <Action title="重新讀取" primary disabled={busy} onPress={() => void workspace.reload()} />
      <Action title="使用 JSON 備份修復" disabled={busy} onPress={() => void importBackup()} />
      <Text style={{ color: t.muted, lineHeight: 20 }}>只有主動選擇備份並確認取代後，才會寫入此帳號、此校園的本機規劃。</Text>
    </View>
  </Screen>;

  return <Screen title="未來學分規劃" subtitle={`${schoolName} · 個人修課草稿`} headerRight={back}>
    {navigationGuard}
    <ScrollView ref={scroll} keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ padding: 16, paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING + 28, gap: 17 }}>
      {dirtySections.length > 0 ? <View style={{ padding: 14, gap: 6, borderRadius: 12,
        borderWidth: 1, borderColor: t.border, backgroundColor: t.surface2 }}>
        <Text accessibilityLiveRegion="polite" style={{ color: t.text, fontWeight: '700' }}>
          {`尚未儲存：${dirtySections.join('、')}`}
        </Text>
        <Text style={{ color: t.muted, fontSize: 12, lineHeight: 19 }}>
          請分別儲存各區塊；試算與備份目前只包含已儲存的內容。
        </Text>
      </View> : null}
      <View style={{ padding: 22, borderRadius: 22, backgroundColor: t.accentSoft, borderWidth: 1, borderColor: t.border, gap: 12 }}>
        <Text style={{ color: t.text, fontSize: 25, lineHeight: 34, fontWeight: '700' }}>把未來的學分，排成可執行的計畫。</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
          {[
            ['已確認採計（手填）', summary.recognized], ['規劃中（尚未取得）', summary.planned], ['預估還差', summary.remaining],
          ].map(([label, value]) => <View key={String(label)} style={{ flex: 1, minWidth: 90 }}>
            <Text style={{ color: t.muted, fontSize: 11 }}>{label}</Text>
            <Text style={{ color: t.text, fontSize: 27, fontWeight: '700', marginTop: 4 }}>{metric(value as number | null)}</Text>
          </View>)}
        </View>
        {summary.target !== null && summary.target > 0 && summary.projected !== null ?
          <View accessibilityRole="progressbar" accessibilityLabel="假設全部規劃通過後的進度"
            accessibilityValue={{ min: 0, max: 100, now: summary.progress }}
            style={{ height: 8, borderRadius: 8, backgroundColor: t.border, overflow: 'hidden' }}>
            <View style={{ height: 8, width: `${summary.progress}%`, backgroundColor: t.accent }} />
          </View> : null}
        <Text style={{ color: t.muted, fontSize: 12, lineHeight: 19 }}>假設規劃課程全部通過且可採計，才有上述預估值。已選課不代表已取得，達到總學分也不等於正式畢業。</Text>
      </View>
      <CreditPlanFeasibilityCard plan={plan} />
      <Heading title="設定學分目標" subtitle="只填學校已確認採計的學分；未來課程請安排在下方。" />
      <Card>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
          <Field label="已確認可採計學分" value={goals.recognized} keyboardType="decimal-pad" disabled={busy}
            onChangeText={(recognized) => setGoals((old) => ({ ...old, recognized }))} />
          <Field label="希望累計的學分" value={goals.target} keyboardType="decimal-pad" disabled={busy}
            onChangeText={(target) => setGoals((old) => ({ ...old, target }))} />
        </View>
        <Field label="未列成課程的其他預計學分" value={goals.extra} keyboardType="decimal-pad" disabled={busy}
          onChangeText={(extra) => setGoals((old) => ({ ...old, extra }))} />
        <Action title="儲存學分目標" primary disabled={busy} onPress={commitGoals} />
      </Card>
      <Heading title="分學期安排" subtitle="候選課程與已選課都屬於尚未取得學分。" />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 9 }}>
        {summary.perTerm.map((term) => <Chip key={term.term} selected={form.term === term.term} disabled={busy}
          label={`第 ${term.term} 學期 · ${formatCredits(term.credits)}`}
          onPress={() => setForm((old) => ({ ...old, term: term.term }))} />)}
        {plan.terms < 8 ? <Chip label="＋ 增加學期" selected={false} disabled={busy}
          onPress={() => void save({ ...plan, terms: plan.terms + 1 }, '已延長規劃學期。')} /> : null}
      </ScrollView>
      <View onLayout={(event) => { editorY.current = event.nativeEvent.layout.y; }}>
        <Card>
          <Text style={{ color: t.text, fontSize: 17, fontWeight: '700' }}>{editId ? '調整課程安排' : '加入未來課程'}</Text>
          <Field label="課程名稱" inputRef={nameInput} value={form.name} disabled={busy}
            onChangeText={(name) => setForm((old) => ({ ...old, name }))} />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
            <Field label="學分" value={form.credits} keyboardType="decimal-pad" disabled={busy}
              onChangeText={(credits) => setForm((old) => ({ ...old, credits }))} />
            <View style={{ flex: 1, minWidth: 100, gap: 10 }}><Text style={{ color: t.muted, fontSize: 12 }}>預計學期</Text>
              <Text style={{ color: t.text }}>第 {form.term} 學期</Text></View>
          </View>
          <Text style={{ color: t.muted, fontSize: 12 }}>課程分類（手動設定）</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {categories.map(({ key, label }) => <Chip key={key} label={label} selected={form.category === key} disabled={busy}
              onPress={() => setForm((old) => ({ ...old, category: key }))} />)}
          </View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            <Chip label="候選課程" selected={form.status === 'considering'} disabled={busy}
              onPress={() => setForm((old) => ({ ...old, status: 'considering' }))} />
            <Chip label="已選課（未取得）" selected={form.status === 'registered'} disabled={busy}
              onPress={() => setForm((old) => ({ ...old, status: 'registered' }))} />
          </View>
          <Action title={editId ? '儲存課程修改' : '加入修課規劃'} primary disabled={busy} onPress={commitCourse} />
          {editId ? <Action title="取消修改" disabled={busy} onPress={cancelCourseEdit} /> : null}
        </Card>
      </View>
      <Heading title={`已安排課程 · ${plan.courses.length} 門`} subtitle="點選編輯會直接回到上方課程表單。" />
      {plan.courses.length ? [...plan.courses].sort((a, b) => a.term - b.term).map((course) =>
        <Card key={course.id}>
          <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start' }}>
            <View style={{ flex: 1 }}><Text style={{ color: t.text, fontSize: 15, fontWeight: '700' }}>{course.name}</Text>
              <Text style={{ color: t.muted, fontSize: 12, marginTop: 5 }}>第 {course.term} 學期 · {categories.find((item) => item.key === course.category)?.label} · {course.status === 'registered' ? '已選課（未取得）' : '候選'}</Text>
            </View>
            <Text style={{ color: t.text, fontSize: 18, fontWeight: '700' }}>{formatCredits(course.credits)} 學分</Text>
          </View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            <Action title="編輯" label={`編輯${course.name}`} disabled={busy} onPress={() => editCourse(course)} />
            <Action title="移除" label={`移除${course.name}`} disabled={busy} onPress={() => removeCourse(course)} />
          </View>
        </Card>) : <Card>
          <Text style={{ color: t.text, fontWeight: '700' }}>還沒有安排課程</Text>
          <Text style={{ color: t.muted, lineHeight: 19 }}>先加入一門候選課程，就能看到學期學分量與預估進度。</Text>
        </Card>}
      <Pressable accessibilityRole="button" accessibilityLabel="分類門檻與非學分條件"
        accessibilityState={{ expanded: advanced }} onPress={() => setAdvanced((old) => !old)}
        style={{ minHeight: 55, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text style={{ color: t.text, fontSize: 17, fontWeight: '700' }}>分類門檻與非學分條件</Text>
        <Ionicons name={advanced ? 'chevron-up' : 'chevron-down'} size={22} color={t.muted} />
      </Pressable>
      {advanced ? <>
        <Card>
          <Text style={{ color: t.muted, lineHeight: 19 }}>請依自己的學制、系所與入學年度，從正式審查單填入分類門檻。</Text>
          {categories.map(({ key, label }) => {
            const gap = summary.categoryGaps.find((item) => item.key === key)!;
            return <View key={key} style={{ gap: 10, paddingVertical: 10 }}>
              <Text style={{ color: t.text, fontWeight: '700' }}>{label} · 已規劃 {formatCredits(gap.planned)} 學分</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
                <Field label={`${label}已確認採計`} value={categoryGoals[key].recognized} keyboardType="decimal-pad" disabled={busy}
                  onChangeText={(recognized) => setCategoryGoals((old) => ({ ...old, [key]: { ...old[key], recognized } }))} />
                <Field label={`${label}目標門檻`} value={categoryGoals[key].target} keyboardType="decimal-pad" disabled={busy}
                  onChangeText={(target) => setCategoryGoals((old) => ({ ...old, [key]: { ...old[key], target } }))} />
              </View>
              <Text style={{ color: t.muted, fontSize: 12 }}>{gap.remaining === null ? '兩欄都填妥並儲存後顯示缺口' : `假設都通過且可採計，此類還差 ${metric(gap.remaining)} 學分`}</Text>
            </View>;
          })}
          {summary.categoryOvercount ? <Text style={{ color: t.danger }}>分類已確認學分總和超過整體已確認學分，請檢查重複採計。</Text> : null}
          <Action title="儲存分類門檻" primary disabled={busy} onPress={commitCategories} />
        </Card>
        <Card>
          <Text style={{ color: t.text, fontSize: 16, fontWeight: '700' }}>非學分畢業條件</Text>
          <Text style={{ color: t.muted, fontSize: 12, lineHeight: 19 }}>例如語言檢定、服務學習；勾選只是個人紀錄，不代表校方已通過。</Text>
          {plan.milestones.map((item) => <View key={item.id} style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
            <Pressable accessibilityRole="checkbox" accessibilityLabel={item.label}
              accessibilityState={{ checked: item.done, disabled: busy }} disabled={busy}
              onPress={() => void save({ ...plan, milestones: plan.milestones.map((row) => row.id === item.id ? { ...row, done: !row.done } : row) }, '個人檢核狀態已更新。')}
              style={{ flex: 1, minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <Ionicons name={item.done ? 'checkbox' : 'square-outline'} size={22} color={t.accent} />
              <Text style={{ color: t.text, flex: 1 }}>{item.label}</Text>
            </Pressable>
            <Action title="移除" label={`移除${item.label}`} disabled={busy} onPress={() => {
              const expected = ticket;
              Alert.alert('移除條件', `確定移除「${item.label}」？`, [
                { text: '取消', style: 'cancel' },
                { text: '移除', style: 'destructive', onPress: () => void save({ ...plan,
                  milestones: plan.milestones.filter((row) => row.id !== item.id),
                }, '個人條件已移除。', expected) },
              ]);
            }} />
          </View>)}
          <Field label="新增畢業條件（自行核對）" value={milestoneLabel} disabled={busy} onChangeText={setMilestoneLabel} />
          <Action title="新增非學分條件" disabled={busy} onPress={addMilestone} />
        </Card>
      </> : null}
      <Heading title="備份與跨裝置移轉" subtitle="手機與 Web 使用相同的 JSON 格式；不會自動雲端同步。" />
      <Card>
        <Text style={{ color: t.muted, fontSize: 12, lineHeight: 20 }}>規劃只存在此帳號、此校園的本機空間。匯入前會列出課程數與目標，確認後才取代目前內容。</Text>
        <Action title="匯出規劃 JSON" disabled={busy} onPress={requestExport} />
        <Action title="匯入 Web／手機 JSON 備份" disabled={busy} onPress={() => void importBackup()} />
        {guest ? <Text style={{ color: t.muted, fontSize: 12 }}>目前是訪客模式；共用裝置請避免輸入私人資料，並在使用後清除裝置資料。</Text> : null}
      </Card>
      <Text style={{ color: t.muted, fontSize: 12, lineHeight: 20 }}>學分規劃不等於畢業資格審查，也不會替你選課。必修、抵免、通識領域與其他門檻，請依校方正式認定確認。</Text>
      {busy ? <Text accessibilityLiveRegion="polite" style={{ color: t.muted }}>{saving ? '正在儲存規劃…' : '正在處理備份…'}</Text> : null}
      {workspace.notice ? <Text accessibilityLiveRegion="polite" style={{ color: t.muted, fontSize: 12 }}>{workspace.notice}</Text> : null}
    </ScrollView>
  </Screen>;
}
