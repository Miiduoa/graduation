import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import type { CreditPlan } from '@campus/shared/src/creditPlanner';
import {
  prepareCreditScenarioAdoption, prepareCreditScenarioUndo, creditScenarioChangeSummary,
  type ScenarioAdoption, type CreditScenarioWriter,
} from '@campus/shared/src/creditScenarioAdoption';
import { theme } from '../../ui/theme';

function Action({ title, onPress, disabled = false }: {
  title: string; onPress: () => void; disabled?: boolean;
}) {
  const c = theme.colors;
  return <Pressable accessibilityRole="button" accessibilityLabel={title}
    accessibilityState={{ disabled }} disabled={disabled} onPress={onPress}
    style={{ minHeight: 44, padding: 12, borderWidth: 1, borderColor: c.border,
      borderRadius: 10, backgroundColor: c.surface2, opacity: disabled ? .55 : 1 }}>
    <Text style={{ color: c.text, fontSize: 13, fontWeight: '600' }}>{title}</Text>
  </Pressable>;
}

export function CreditScenarioAdoptionActions({ plan, candidate, writer, blocked, onApplied, visible = true }: {
  plan: CreditPlan; candidate: CreditPlan | null; writer?: CreditScenarioWriter;
  blocked?: string; onApplied: () => void; visible?: boolean;
}) {
  const c = theme.colors;
  const [preview, setPreview] = useState<{ source: CreditPlan; value: ScenarioAdoption } | null>(null);
  const [receipt, setReceipt] = useState<{ applied: CreditPlan; value: ScenarioAdoption } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const lock = useRef(false);
  const live = useRef(true);
  const latest = useRef({ plan, candidate, blocked, writer });
  useLayoutEffect(() => { latest.current = { plan, candidate, blocked, writer }; }, [plan, candidate, blocked, writer]);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  useEffect(() => {
    if (receipt && plan !== receipt.applied) setReceipt(null);
  }, [plan, receipt]);
  if (!writer || !visible) return null;
  const stale = preview && (preview.source !== plan || !candidate ||
    JSON.stringify(preview.value.after) !== JSON.stringify(candidate));
  const changed = candidate && prepareCreditScenarioAdoption(plan, candidate).ok;
  function review() {
    if (!candidate || blocked || lock.current) return;
    const result = prepareCreditScenarioAdoption(plan, candidate);
    if (result.ok === false) { setMessage(result.message); return; }
    setPreview({ source: plan, value: result.value }); setMessage('');
  }
  async function persist(undo: boolean) {
    if (lock.current || !live.current || latest.current.blocked || !latest.current.writer) return;
    const expected = latest.current.plan;
    const active = undo ? receipt?.value : preview?.value;
    if (!active || (undo ? receipt?.applied !== expected : preview?.source !== expected)) return;
    const next = undo ? prepareCreditScenarioUndo(expected, active) : active.after;
    if (!next || (!undo && JSON.stringify(latest.current.candidate) !== JSON.stringify(next))) {
      setMessage('比較內容已更改，請重新預覽。'); return;
    }
    lock.current = true; setBusy(true); setMessage('');
    try {
      const saved = await latest.current.writer(expected, next);
      if (!live.current) return;
      if (!saved) { setMessage('尚未完成儲存，請確認輸入與本機狀態後重試。'); return; }
      setPreview(null);
      setReceipt(undo ? null : { applied: saved, value: active });
      setMessage(undo ? '已復原這次採用，回到原本的修課安排。' : '已採用到這台裝置的個人規劃。');
      onApplied();
    } catch (error) {
      if (live.current) setMessage(error instanceof Error ? error.message : '儲存失敗，請重試。');
    } finally {
      lock.current = false;
      if (live.current) setBusy(false);
    }
  }
  const textStyle = { color: c.text, fontSize: 13, lineHeight: 21 };
  return <View style={{ gap: 12 }}>
    {changed && !preview ? <Action title="預覽並採用此方案" disabled={Boolean(blocked) || busy} onPress={review} /> : null}
    {blocked && (changed || receipt) ? <Text style={{ color: c.muted, fontSize: 12 }}>{blocked}</Text> : null}
    {preview ? <View style={{ padding: 16, gap: 12, borderWidth: 1, borderColor: c.border, borderRadius: 14, backgroundColor: c.accentSoft }}>
      <Text accessibilityRole="header" style={{ color: c.text, fontSize: 17, fontWeight: '700' }}>確認修課安排差異</Text>
      <Text style={textStyle}>{creditScenarioChangeSummary(preview.value)}</Text>
      {preview.value.moved.map((course) => <Text key={course.id} style={textStyle}>{course.name}：第 {course.from} → 第 {course.to} 學期</Text>)}
      {preview.value.removed.map((course) => <Text key={course.id} style={textStyle}>{course.name}：不再安排（{course.credits} 學分）</Text>)}
      <Text style={{ color: c.muted, fontSize: 12, lineHeight: 20 }}>只更新此帳號、此校園的本機規劃，不會選課、退選或變更校方紀錄。有後續修改後，這次復原將失效。</Text>
      {stale ? <Text accessibilityRole="alert" style={textStyle}>原規劃或比較方案已變更，請取消後重新預覽。</Text> : null}
      <Action title={busy ? '正在儲存…' : '確認採用到個人規劃'} disabled={busy || Boolean(blocked) || Boolean(stale)} onPress={() => void persist(false)} />
      <Action title="取消採用" disabled={busy} onPress={() => setPreview(null)} />
    </View> : null}
    {receipt && receipt.applied === plan ? <View style={{ gap: 10 }}>
      <Text style={textStyle}>這次採用已保存；目前尚未有其他規劃修改。</Text>
      <Action title="復原這次採用" disabled={busy || Boolean(blocked)} onPress={() => void persist(true)} />
    </View> : null}
    {message ? <Text accessibilityLiveRegion="polite" style={textStyle}>{message}</Text> : null}
  </View>;
}
