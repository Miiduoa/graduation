import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  applyTranscriptReview, reviewTranscript, reviewedCreditTotals,
  suggestedTranscriptSelection, transcriptPlanOverlaps,
  type TranscriptInput, type TranscriptReviewRow, type TranscriptSelection,
  type TranscriptPlanChange,
} from '@campus/shared/src/creditTranscriptReview';
import { PLANNER_CATEGORIES, formatCredits, type CreditPlan, type PlannerCategory } from '@campus/shared/src/creditPlanner';
import { Screen, Spinner } from '../ui/components';
import { theme } from '../ui/theme';
import { useThemeMode } from '../state/theme';
import { useAuth } from '../state/auth';
import { useSchool } from '../state/school';
import { TAB_BAR_CONTENT_BOTTOM_PADDING } from '../ui/navigationTheme';
import { loadCreditRecords } from './creditAudit/loadCreditRecords';
import { mobileCreditPlanKey, readMobileCreditPlan, replaceReviewedCreditPlan } from '../features/academics/creditPlanRepository';

const MAX_REVIEW_AGE_MS = 10 * 60 * 1000;
type Props = { navigation?: { goBack?: () => void; replace?: (name: string) => void } };
type Snapshot = { rows: TranscriptInput[]; readAt: number; offline: boolean };
type Preview = { plan: CreditPlan; choices: Record<string, 'remove' | 'keep'> };
const sourceLabels = { school: '校務紀錄', 'school-cache': '離線校務副本', course: '課程評分，非校方採計結論' };

function Button({ label, onPress, disabled = false, primary = false }: {
  label: string; onPress: () => void; disabled?: boolean; primary?: boolean;
}) {
  const t = theme.colors;
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }}
    disabled={disabled} onPress={onPress} style={{ minHeight: 44, borderRadius: 12, borderWidth: 1,
      padding: 12, alignItems: 'center', justifyContent: 'center', borderColor: primary ? t.accent : t.border,
      backgroundColor: primary ? t.accent : t.surface2, opacity: disabled ? 0.5 : 1 }}>
    <Text style={{ color: primary ? t.onAccent : t.text, fontWeight: '700', fontSize: 13 }}>{label}</Text>
  </Pressable>;
}
function Box({ children }: { children: React.ReactNode }) {
  const t = theme.colors;
  return <View style={{ padding: 16, gap: 12, borderRadius: 16, backgroundColor: t.surface,
    borderWidth: 1, borderColor: t.border }}>{children}</View>;
}

export default function CreditTranscriptReviewScreen({ navigation }: Props = {}) {
  useThemeMode();
  const { user, loading } = useAuth();
  const { school } = useSchool();
  if (loading || !school?.id) return <Screen title="已修學分核對"><Spinner size={28} /></Screen>;
  if (!user?.uid) return <Screen title="已修學分核對">
    <Text style={{ color: theme.colors.text, padding: 20 }}>請先登入，才能核對目前帳號的成績。訪客規劃不會被讀取或修改。</Text>
    {navigation?.goBack ? <Button label="返回" onPress={() => navigation.goBack?.()} /> : null}
  </Screen>;
  const scope = mobileCreditPlanKey(user.uid, school.id);
  return <Review key={scope} scope={scope} uid={user.uid} schoolId={school.id} schoolName={school.name} navigation={navigation} />;
}

function Review({ scope, uid, schoolId, schoolName, navigation }: {
  scope: string; uid: string; schoolId: string; schoolName: string; navigation?: Props['navigation'];
}) {
  const t = theme.colors;
  const epoch = useRef(0);
  const lock = useRef(false);
  const [source, setSource] = useState<Snapshot | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [passMark, setPassMark] = useState<number | null>(null);
  const [selected, setSelected] = useState<TranscriptSelection[]>([]);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [receipt, setReceipt] = useState<TranscriptPlanChange | null>(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'all' | 'review' | 'selected'>('all');
  const [limit, setLimit] = useState(25);

  const reload = useCallback(async () => {
    const token = ++epoch.current;
    lock.current = false;
    setBusy(false); setLoading(true); setSource(null); setPreview(null); setError('');
    setSelected([]); setPassMark(null); setAcknowledged(false); setReceipt(null);
    try {
      const result = await loadCreditRecords({ uid, schoolId });
      if (token !== epoch.current) return;
      if (result.ok === false) throw new Error(result.errorMessage);
      if (result.grades.length > 2_000) throw new Error('成績筆數超出核對範圍，請先確認資料來源。');
      const rows: TranscriptInput[] = result.grades.map((grade) => ({
        id: grade.id, courseName: grade.courseName ?? '', courseCode: grade.courseCode,
        semester: grade.semester, courseType: grade.courseType, credits: grade.credits,
        score: grade.grade ?? grade.score, letterGrade: grade.letterGrade,
        source: grade.gradeSource === 'school-official' ? 'school' :
          grade.gradeSource === 'school-official-offline' ? 'school-cache' : 'course',
      }));
      setSource({ rows, readAt: result.readAt, offline: result.fromOfflineSchoolCache });
    } catch (failure) {
      if (token === epoch.current) setError(failure instanceof Error ? failure.message : '成績讀取失敗，沒有更新規劃。');
    } finally { if (token === epoch.current) setLoading(false); }
  }, [uid, schoolId]);
  useEffect(() => { void reload(); return () => { epoch.current += 1; }; }, [reload]);

  const review = useMemo(() => source && passMark !== null ? reviewTranscript(source.rows, passMark) : null, [source, passMark]);
  const totals = useMemo(() => {
    if (!review || !selected.length) return null;
    try { return reviewedCreditTotals(review, selected); } catch { return null; }
  }, [review, selected]);
  const overlaps = useMemo(() => preview && totals ? transcriptPlanOverlaps(preview.plan, totals) : [], [preview, totals]);
  const visible = review?.rows.filter((row) => {
    const matched = `${row.name} ${row.code} ${row.semester}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
    return matched && (filter === 'all' || (filter === 'selected' ? selected.some((item) => item.key === row.key) :
      row.duplicateCount > 1 || !row.eligible || row.category === 'other' || row.source === 'course'));
  }) ?? [];
  const fresh = () => Boolean(source && Date.now() >= source.readAt && Date.now() - source.readAt <= MAX_REVIEW_AGE_MS);
  function assertFresh() {
    if (fresh()) return true;
    setPreview(null); setAcknowledged(false);
    setError('這次成績讀取已超過 10 分鐘或時間異常，請重新讀取後再核對；沒有更新規劃。');
    return false;
  }
  function toggle(row: TranscriptReviewRow) {
    if (busy || lock.current || !review || !row.eligible) return;
    if (selected.some((item) => item.key === row.key)) {
      setSelected((old) => old.filter((item) => item.key !== row.key)); return;
    }
    const duplicate = selected.find((item) => review.rows.find((entry) => entry.key === item.key)?.group === row.group);
    if (duplicate) {
      Alert.alert('請先核對重複課程', '這組同名或同課號紀錄已有選取項目。請先取消原項目，再選取這一筆。'); return;
    }
    setSelected((old) => [...old, { key: row.key, category: row.category }]);
  }
  async function preparePreview() {
    if (!review || !totals || busy || lock.current || !assertFresh()) return;
    const token = epoch.current;
    lock.current = true; setBusy(true); setError('');
    try {
      const plan = await readMobileCreditPlan(scope);
      if (token !== epoch.current || !assertFresh()) return;
      setPreview({ plan, choices: {} }); setAcknowledged(false);
    } catch (failure) {
      if (token === epoch.current) setError(failure instanceof Error ? failure.message : '無法讀取原規劃，沒有套用。');
    } finally { if (token === epoch.current) { lock.current = false; setBusy(false); } }
  }
  async function apply() {
    if (!review || !preview || !acknowledged || busy || lock.current || !assertFresh()) return;
    const token = epoch.current;
    lock.current = true; setBusy(true); setError('');
    try {
      const change = applyTranscriptReview(preview.plan, review, selected, preview.choices);
      await replaceReviewedCreditPlan(scope, preview.plan, change.next,
        () => token === epoch.current && fresh());
      if (token !== epoch.current) return;
      setReceipt(change); setPreview(null);
    } catch (failure) {
      if (token === epoch.current) setError(failure instanceof Error ? failure.message : '儲存失敗，原規劃仍保留。');
    } finally { if (token === epoch.current) { lock.current = false; setBusy(false); } }
  }

  const back = navigation?.goBack ? <Button label="返回學分總覽" disabled={busy} onPress={() => navigation.goBack?.()} /> : null;
  const heading = <Text style={{ color: t.muted, fontSize: 12, lineHeight: 20 }}>
    只核對目前帳號在「{schoolName}」的已讀取成績。通過不等於畢業可採計，抵免、重修與各系規定仍須自行核對。
  </Text>;
  if (loading) return <Screen title="已修學分核對" headerRight={back}>
    <View style={{ padding: 24, gap: 14 }}><Spinner size={28} /><Text style={{ color: t.muted }}>正在讀取目前帳號的成績…</Text></View>
  </Screen>;
  if (receipt) return <Screen title="已更新個人規劃" headerRight={back}>
    <Box><Ionicons name="checkmark-circle-outline" size={36} color={t.success} />
      <Text accessibilityLiveRegion="polite" style={{ color: t.text, fontSize: 21, fontWeight: '700' }}>
        已帶入 {formatCredits(receipt.totals.credits)} 學分
      </Text>
      <Text style={{ color: t.muted, lineHeight: 21 }}>
        本次選取 {receipt.totals.selectedCount} 門課，移除 {receipt.removedCourseIds.length} 門經你確認的未來規劃重複課程。
        只取代個人已確認合計，沒有修改校方成績、畢業目標或選課。
      </Text>
      <Text style={{ color: t.muted, lineHeight: 20 }}>原始成績與核對清單不另行儲存；本機規劃只保存你確認後的學分合計。</Text>
      {navigation?.replace ? <Button label="查看更新後的學分規劃" primary onPress={() => navigation.replace?.('CreditPlanning')} /> : null}
    </Box>
  </Screen>;
  return <Screen title="已修學分核對" subtitle={`${schoolName} · 讀取、核對、確認套用`} headerRight={back} noPadding>
    {source && review && !preview ? <View style={{ padding: 12, borderBottomWidth: 1, borderBottomColor: t.border, gap: 8 }}>
      <Text accessibilityLiveRegion="polite" style={{ color: t.text, fontWeight: '700' }}>
        已選 {selected.length} 門 · {totals ? formatCredits(totals.credits) : '0'} 學分
      </Text>
      <Button label="預覽套用差異" primary disabled={!totals || busy} onPress={() => void preparePreview()} />
    </View> : null}
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 16, gap: 14,
      paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING + 24 }}>
      {heading}
      {error ? <Box><Text accessibilityLiveRegion="polite" style={{ color: t.danger }}>{error}</Text>
        <Button label="重新讀取成績與核對" disabled={busy} onPress={() => void reload()} />
      </Box> : null}
      {!source ? null : !source.rows.length ? <Box>
        <Text style={{ color: t.text, fontWeight: '700' }}>目前沒有可核對的成績</Text>
        <Text style={{ color: t.muted }}>不會把沒有資料當成 0 學分，也不會清空原規劃。</Text>
        <Button label="重新讀取成績" onPress={() => void reload()} />
      </Box> : <>
        <Text style={{ color: t.muted, fontSize: 12 }}>
          {`本次讀取 ${source.rows.length} 筆 · ${new Date(source.readAt).toLocaleString('zh-TW')}`}
          {source.offline ? ' · 含離線／過期副本，不是校方即時更新' : ' · 讀取時間不是校方修改時間'}
        </Text>
        {preview && totals ? <>
          <Box>
            <Text style={{ color: t.text, fontSize: 18, fontWeight: '700' }}>核對更新前後</Text>
            <Text style={{ color: t.text }}>已確認合計：{preview.plan.recognized || '未設定'} → {formatCredits(totals.credits)} 學分</Text>
            {PLANNER_CATEGORIES.map(({ key, label }) => <Text key={key} style={{ color: t.muted }}>
              {label}：{preview.plan.categoryGoals[key].recognized || '未設定'} → {formatCredits(totals.byCategory[key])}
            </Text>)}
            <Text style={{ color: t.muted, fontSize: 12, lineHeight: 20 }}>
              此次會取代合計，不是往舊數字累加。來源可能不含抵免、校際或其他學期；若資料不完整，請返回調整，不要套用較少的合計。
              畢業目標、分類目標及非學分條件不變。
            </Text>
          </Box>
          {overlaps.length ? <Box>
            <Text style={{ color: t.text, fontWeight: '700' }}>避免已修與未來規劃重複計算</Text>
            <Text style={{ color: t.muted, lineHeight: 20 }}>下列未來課程與選取成績同名，不代表一定是同一門。請逐筆決定，系統不會自行移除。</Text>
            {overlaps.map((course) => <View key={course.id} style={{ gap: 8 }}>
              <Text style={{ color: t.text }}>{course.name} · 未來第 {course.term} 學期 · {course.credits} 學分</Text>
              <Button label={`${preview.choices[course.id] === 'remove' ? '✓ ' : ''}移除已修規劃：${course.name}`}
                disabled={busy} onPress={() => setPreview({ ...preview, choices: { ...preview.choices, [course.id]: 'remove' } })} />
              <Button label={`${preview.choices[course.id] === 'keep' ? '✓ ' : ''}不同課，保留規劃：${course.name}`}
                disabled={busy} onPress={() => setPreview({ ...preview, choices: { ...preview.choices, [course.id]: 'keep' } })} />
            </View>)}
          </Box> : null}
          <Pressable accessibilityRole="checkbox" accessibilityLabel="我已核對來源、採計與重修規則"
            accessibilityState={{ checked: acknowledged, disabled: busy }} disabled={busy}
            onPress={() => setAcknowledged((value) => !value)} style={{ minHeight: 48, flexDirection: 'row', gap: 10, alignItems: 'center' }}>
            <Ionicons name={acknowledged ? 'checkbox' : 'square-outline'} color={t.accent} size={24} />
            <Text style={{ color: t.text, flex: 1, lineHeight: 22 }}>我已核對來源、採計與重修規則，確認用本次合計取代個人規劃。</Text>
          </Pressable>
          <Button label={busy ? '正在更新個人規劃…' : '確認套用到個人規劃'} primary
            disabled={busy || !acknowledged || overlaps.some((course) => !preview.choices[course.id])} onPress={() => void apply()} />
          <Button label="返回選取與分類" disabled={busy} onPress={() => { setPreview(null); setAcknowledged(false); }} />
        </> : <>
          <Box>
            <Text style={{ color: t.text, fontSize: 17, fontWeight: '700' }}>1 · 選擇核對標準</Text>
            <Text style={{ color: t.muted, lineHeight: 20 }}>先依自己的學制選擇參考及格分數。未評分、無法判定的等第與零學分不自動計入。改變標準會清空目前選取。</Text>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              {[60, 70].map((mark) => <View style={{ flex: 1 }} key={mark}>
                <Button label={`${mark} 分${passMark === mark ? '（已選）' : ''}`} disabled={busy} primary={passMark === mark}
                  onPress={() => { setPassMark(mark); setSelected([]); setLimit(25); }} />
              </View>)}
            </View>
          </Box>
          {review ? <>
            <Box>
              <Text style={{ color: t.text, fontSize: 17, fontWeight: '700' }}>2 · 核對已修課程與分類</Text>
              <Text style={{ color: t.muted, lineHeight: 20 }}>一鍵選取只包含校務來源、明確通過且沒有重複疑義的紀錄。其他類別請手動核對，不猜測校方分類。</Text>
              <Button label="選取無重複疑義的通過紀錄" disabled={busy}
                onPress={() => setSelected((old) => [...old, ...suggestedTranscriptSelection(review).filter((item) => !old.some((current) => current.key === item.key))])} />
              <Button label="取消全部選取" disabled={busy || !selected.length} onPress={() => setSelected([])} />
              <TextInput accessibilityLabel="搜尋核對課程" placeholder="課名、課號或學期" placeholderTextColor={t.muted}
                value={query} editable={!busy} onChangeText={(value) => { setQuery(value); setLimit(25); }}
                style={{ color: t.text, minHeight: 46, padding: 12, borderWidth: 1, borderColor: t.border, borderRadius: 12 }} />
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {([['all', '全部'], ['review', '需核對'], ['selected', '已選']] as const).map(([value, label]) =>
                  <Button key={value} label={label} primary={filter === value} disabled={busy}
                    onPress={() => { setFilter(value); setLimit(25); }} />)}
              </View>
            </Box>
            {visible.slice(0, limit).map((row) => {
              const picked = selected.find((item) => item.key === row.key);
              return <Box key={row.key}>
                <Pressable accessibilityRole="checkbox" accessibilityLabel={`選取${row.name} ${row.semester}`}
                  accessibilityState={{ checked: Boolean(picked), disabled: busy || !row.eligible }} disabled={busy || !row.eligible}
                  onPress={() => toggle(row)} style={{ minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <Ionicons name={picked ? 'checkbox' : 'square-outline'} size={23} color={row.eligible ? t.accent : t.muted} />
                  <View style={{ flex: 1, gap: 5 }}>
                    <Text style={{ color: t.text, fontSize: 15, fontWeight: '700' }}>{row.name || '缺少名稱'}</Text>
                    <Text style={{ color: t.muted, fontSize: 12 }}>{row.semester || '學期未提供'} · {row.code || '課號未提供'}</Text>
                  </View>
                  <Text style={{ color: t.text, fontWeight: '700' }}>{row.credits ?? '—'} 學分</Text>
                </Pressable>
                <Text style={{ color: t.muted, fontSize: 12, lineHeight: 19 }}>成績 {row.scoreLabel} · 原分類 {row.sourceType || '未提供'} · {sourceLabels[row.source]}</Text>
                <Text style={{ color: row.eligible ? t.muted : t.danger, fontSize: 12 }}>{row.reason}</Text>
                {row.duplicateCount > 1 ? <Text style={{ color: t.warning, fontSize: 12 }}>同名或同課號共 {row.duplicateCount} 筆，核對後只能選取一筆。</Text> : null}
                {picked ? <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7 }}>
                  {PLANNER_CATEGORIES.map(({ key, label }) => <Pressable key={key} accessibilityRole="radio"
                    accessibilityLabel={`${row.name}分類${label}`} accessibilityState={{ checked: picked.category === key, disabled: busy }}
                    disabled={busy} onPress={() => setSelected((old) => old.map((item) => item.key === row.key ? { ...item, category: key as PlannerCategory } : item))}
                    style={{ padding: 11, minHeight: 44, borderRadius: 10, backgroundColor: picked.category === key ? t.accentSoft : t.surface2 }}>
                    <Text style={{ color: t.text }}>{label}</Text>
                  </Pressable>)}
                </View> : null}
              </Box>;
            })}
            {!visible.length ? <Text style={{ color: t.muted }}>目前篩選沒有符合的紀錄；原成績沒有刪除。</Text> : null}
            {visible.length > limit ? <Button label={`再顯示 ${Math.min(25, visible.length - limit)} 筆`} onPress={() => setLimit((value) => value + 25)} /> : null}
          </> : null}
        </>}
      </>}
    </ScrollView>
  </Screen>;
}
