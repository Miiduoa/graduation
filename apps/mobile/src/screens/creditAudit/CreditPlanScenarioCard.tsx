import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { File, Paths } from 'expo-file-system';
import { isAvailableAsync, shareAsync } from 'expo-sharing';
import { formatCredits, restoreCreditPlan, type CreditPlan } from '@campus/shared/src/creditPlanner';
import {
  changeCreditScenario, compareCreditScenario, creditScenarioTargetLabel,
  filterCreditScenarioCourses, startCreditScenario,
  type CreditScenario, type CreditScenarioPreset,
} from '@campus/shared/src/creditPlanScenarios';
import { portableCreditPlanJson } from '../../features/academics/creditPlanRepository';
import { theme } from '../../ui/theme';
import type { CreditScenarioWriter } from '@campus/shared/src/creditScenarioAdoption';
import { CreditScenarioAdoptionActions } from './CreditScenarioAdoptionActions';

const number = (value: number | null) => value === null ? '未設定' : formatCredits(value);
function Action({ title, onPress, disabled = false, selected = false }: {
  title: string; onPress: () => void; disabled?: boolean; selected?: boolean;
}) {
  const c = theme.colors;
  return <Pressable accessibilityRole="button" accessibilityLabel={title}
    accessibilityState={{ disabled, selected }} disabled={disabled} onPress={onPress}
    style={{ minHeight: 44, borderWidth: 1, borderColor: selected ? c.accent : c.border,
      backgroundColor: selected ? c.accentSoft : c.surface2, borderRadius: 10,
      paddingHorizontal: 13, paddingVertical: 10, justifyContent: 'center', opacity: disabled ? .5 : 1 }}>
    <Text style={{ color: c.text, fontSize: 13, fontWeight: '600' }}>{title}</Text>
  </Pressable>;
}

export function CreditPlanScenarioCard({ plan, scenarioWriter, scenarioBlocked }: {
  plan: CreditPlan; scenarioWriter?: CreditScenarioWriter; scenarioBlocked?: string;
}) {
  const c = theme.colors;
  const [expanded, setExpanded] = useState(false);
  const [draft, setDraft] = useState<{ source: CreditPlan; value: CreditScenario } | null>(null);
  const [query, setQuery] = useState('');
  const [term, setTerm] = useState<number | null>(null);
  const [limit, setLimit] = useState(12);
  const [editing, setEditing] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const live = useRef(true);
  const transfer = useRef(false);
  const source = useRef({ plan, revision: 0 });
  if (source.current.plan !== plan) source.current = { plan, revision: source.current.revision + 1 };
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  const validPlan = useMemo(() => restoreCreditPlan(JSON.stringify(plan)) !== null, [plan]);
  const stale = draft !== null && draft.source !== plan;
  const result = useMemo(() => draft && !stale ? compareCreditScenario(plan, draft.value) : null, [plan, draft, stale]);
  const comparison = result?.ok === true ? result : null;
  const rows = useMemo(() => filterCreditScenarioCourses(plan, query, term), [plan, query, term]);

  function begin(preset: CreditScenarioPreset) {
    if (!validPlan || transfer.current) return;
    setDraft({ source: plan, value: startCreditScenario(plan, preset) });
    setEditing(null);
  }
  function choose(id: string, value: number | null) {
    if (transfer.current) return;
    setDraft((old) => old && old.source === plan
      ? { ...old, value: changeCreditScenario(old.value, id, value) } : old);
  }
  async function exportScenario() {
    if (!comparison?.changed || stale || transfer.current) return;
    const revision = source.current.revision;
    const current = () => live.current && source.current.revision === revision;
    transfer.current = true;
    setExporting(true);
    let file: File | null = null;
    let handedOff = false;
    try {
      const available = await isAvailableAsync();
      if (!current()) return;
      if (!available) {
        Alert.alert('目前無法分享方案', '這台裝置沒有提供分享功能；尚未匯出，原規劃仍保留。');
        return;
      }
      const data = portableCreditPlanJson(comparison.plan);
      file = new File(Paths.cache, `credit-scenario-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
      await file.write(data);
      if (!current()) return;
      handedOff = true;
      await shareAsync(file.uri, { mimeType: 'application/json', UTI: 'public.json', dialogTitle: '儲存學分比較方案' });
    } catch (error) {
      if (current()) Alert.alert('無法匯出方案', error instanceof Error ? error.message : '原規劃沒有被變更，請稍後重試。');
    } finally {
      // 已交給外部分享程式的檔案由系統管理，避免接收端尚未讀完就被刪除。
      if (!handedOff) { try { file?.delete(); } catch { /* 快取可能已被系統移除。 */ } }
      transfer.current = false;
      if (live.current) setExporting(false);
    }
  }

  return <View style={{ borderWidth: 1, borderColor: c.border, borderRadius: 17, backgroundColor: c.surface, overflow: 'hidden' }}>
    <Pressable accessibilityRole="button" accessibilityLabel="換個修法，先看差多少"
      accessibilityState={{ expanded }} onPress={() => setExpanded((value) => !value)}
      style={{ padding: 18, minHeight: 64, gap: 6 }}>
      <Text style={{ color: c.text, fontSize: 18, fontWeight: '700' }}>換個修法，先看差多少 {expanded ? '−' : '＋'}</Text>
      <Text style={{ color: c.muted, fontSize: 12, lineHeight: 19 }}>不修、延後或只修已選課；先比較，不直接更動原規劃。</Text>
    </Pressable>
    {expanded ? <View style={{ paddingHorizontal: 16, paddingBottom: 18, gap: 14 }}>
      <Text style={{ color: c.muted, fontSize: 12, lineHeight: 19 }}>只比較已儲存的課程，不含表單未儲存的輸入。已選課狀態由你手動設定，仍假設未來通過且可採計。</Text>
      {!validPlan ? <Text style={{ color: c.text }}>請先修正原規劃的無效欄位，再開始比較。</Text> : null}
      {!plan.courses.length ? <Text style={{ color: c.muted }}>先在課程清單加入並儲存一門課，就能比較不同修法。</Text> : <>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          <Action title="以全部課程開始比較" disabled={!validPlan || exporting} onPress={() => begin('all')} />
          <Action title="比較只修已選課" disabled={!validPlan || exporting} onPress={() => begin('registered')} />
          {draft ? <Action title="結束比較" disabled={exporting} onPress={() => { setDraft(null); setEditing(null); }} /> : null}
        </View>
        {stale ? <Text accessibilityRole="alert" style={{ color: c.text, lineHeight: 22 }}>原規劃已更新，舊比較不再適用。請以上方按鈕重新開始。</Text> : null}
        {result?.ok === false ? <Text accessibilityRole="alert" style={{ color: c.text }}>{result.message}</Text> : null}
        {comparison ? <>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
            {[
              { title: '原規劃', summary: comparison.before, insight: comparison.beforeInsights },
              { title: '比較方案', summary: comparison.after, insight: comparison.afterInsights },
            ].map((item, index) => <View key={item.title} style={{ flex: 1, minWidth: 130, padding: 14, gap: 7,
              borderRadius: 12, backgroundColor: index ? c.accentSoft : c.surface2 }}>
              <Text style={{ color: c.text, fontWeight: '700' }}>{item.title}</Text>
              <Text style={{ color: c.muted, fontSize: 11 }}>全部通過仍缺</Text>
              <Text style={{ color: c.text, fontSize: 26, fontWeight: '700' }}>{number(item.summary.remaining)}<Text style={{ fontSize: 11 }}> 學分</Text></Text>
              <Text style={{ color: c.muted, fontSize: 12 }}>已排 {number(item.summary.courseCredits)} 學分</Text>
              <Text style={{ color: c.muted, fontSize: 11, lineHeight: 18 }}>總量達標：{creditScenarioTargetLabel(item.insight.earliestTargetTerm, item.summary.remaining !== null)}</Text>
            </View>)}
          </View>
          <Text accessibilityLiveRegion="polite" style={{ color: c.text, fontSize: 13, lineHeight: 21 }}>{`不排入 ${comparison.omitted.length} 門、移動 ${comparison.moved.length} 門；總學分缺口變化：${comparison.remainingDelta === null ? '目標尚未完整設定' : (comparison.remainingDelta > 0 ? '+' : '') + formatCredits(comparison.remainingDelta) + ' 學分'}。`}</Text>
          <Text style={{ color: c.text, fontWeight: '700' }}>每學期負擔：原規劃 → 比較方案</Text>
          {comparison.terms.map((row) => <View key={row.term} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 10, minHeight: 40, alignItems: 'center' }}>
            <Text style={{ color: c.muted, flex: 1 }}>第 {row.term} 學期</Text>
            <Text style={{ color: c.text, fontVariant: ['tabular-nums'] }}>{formatCredits(row.before)} → {formatCredits(row.after)} 學分</Text>
          </View>)}
          <Text style={{ color: c.text, fontWeight: '700' }}>分類缺口：原規劃 → 比較方案</Text>
          {comparison.categories.map((row) => <View key={row.key} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8, minHeight: 36 }}>
            <Text style={{ color: c.muted }}>{row.label}</Text><Text style={{ color: c.text }}>{number(row.before)} → {number(row.after)}</Text>
          </View>)}
          <Text style={{ color: c.muted, fontSize: 11, lineHeight: 19 }}>達標學期只計已排入學期的課程，不把其他預計學分放進某學期。總量達標不等於畢業，也不保證實際開課與先修條件。</Text>
        </> : null}
      </>}
    </View> : null}
    {/* 維持掛載以保留收合後的復原收據；視覺上放在比較摘要之後。 */}
    <View style={expanded ? { paddingHorizontal: 16, paddingBottom: comparison ? 0 : 18, gap: 14 } : undefined}>
      <CreditScenarioAdoptionActions plan={plan} candidate={comparison?.plan ?? null}
        writer={scenarioWriter} visible={expanded} blocked={exporting ? '請先完成分享，再採用方案。' : scenarioBlocked}
        onApplied={() => { setDraft(null); setEditing(null); }} />
    </View>
    {expanded && comparison ? <View style={{ paddingHorizontal: 16, paddingBottom: 18, gap: 14 }}>
      <TextInput accessibilityLabel="搜尋比較課程" placeholder="搜尋課程名稱" placeholderTextColor={c.muted}
        value={query} maxLength={80} onChangeText={(value) => { setQuery(value); setLimit(12); }}
        style={{ minHeight: 44, borderWidth: 1, borderColor: c.border, borderRadius: 10, paddingHorizontal: 12, color: c.text }} />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
        <Action title="全部原安排學期" selected={term === null} onPress={() => { setTerm(null); setLimit(12); }} />
        {comparison.before.perTerm.map((row) => <Action key={row.term} title={`原第 ${row.term} 學期`} selected={term === row.term}
          onPress={() => { setTerm(row.term); setLimit(12); }} />)}
      </ScrollView>
      <Text style={{ color: c.muted, fontSize: 11 }}>顯示 {Math.min(limit, rows.length)}／{rows.length} 門；篩選不影響整份方案計算。</Text>
      {rows.slice(0, limit).map((course) => {
        const choice = draft!.value.choices.find((item) => item.courseId === course.id)!;
        return <View key={course.id} style={{ borderWidth: 1, borderColor: c.border, borderRadius: 12, padding: 12, gap: 9 }}>
          <Text style={{ color: c.text, fontWeight: '700' }}>{course.name}</Text>
          <Text style={{ color: c.muted, fontSize: 12 }}>原第 {course.term} 學期 · {formatCredits(course.credits)} 學分 · {course.status === 'registered' ? '已選課（未取得）' : '候選'}</Text>
          <Text style={{ color: c.text, fontSize: 12 }}>比較安排：{choice.term === null ? '此方案不排入' : `第 ${choice.term} 學期`}</Text>
          <Action title={`調整${course.name}（原第 ${course.term} 學期）`} disabled={exporting} selected={editing === course.id}
            onPress={() => setEditing((id) => id === course.id ? null : course.id)} />
          {editing === course.id ? <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            <Action title="此方案不排入" selected={choice.term === null} disabled={exporting} onPress={() => choose(course.id, null)} />
            {Array.from({ length: 8 }, (_, index) => index + 1).map((value) => <Action key={value}
              title={`改排第 ${value} 學期`} selected={choice.term === value} disabled={exporting} onPress={() => choose(course.id, value)} />)}
          </View> : null}
        </View>;
      })}
      {!rows.length ? <Text style={{ color: c.muted }}>沒有符合篩選的課程；比較仍包含整份方案。</Text> : null}
      {rows.length > limit ? <Action title="顯示更多比較課程" onPress={() => setLimit((value) => value + 12)} /> : null}
      {comparison.afterInsights.possibleRetakes.length ? <Text style={{ color: c.text, lineHeight: 20 }}>此方案有同名課程，可能重複採計，請向系辦核對。</Text> : null}
      {comparison.afterInsights.workloadCautions.length ? <Text style={{ color: c.text, lineHeight: 20 }}>部分學期超過 25 學分，請核對個人負擔與學校上限；25 只是提醒，不是正式規定。</Text> : null}
      <View style={{ backgroundColor: c.surface2, borderRadius: 12, padding: 14, gap: 10 }}>
        <Text style={{ color: c.text, fontWeight: '700' }}>原規劃仍完整保留</Text>
        <Text style={{ color: c.muted, fontSize: 12, lineHeight: 20 }}>比較不會退選或修改校方紀錄。可直接預覽並採用；跨裝置移轉仍可分享 JSON。請另外保留原規劃備份。分享完成後仍需自行核對是否確實保存。</Text>
        <Action title={exporting ? '正在處理比較備份…' : '匯出此比較方案 JSON'} disabled={!comparison.changed || exporting} onPress={() => void exportScenario()} />
      </View>
    </View> : null}
  </View>;
}
