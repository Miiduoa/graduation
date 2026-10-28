import React, { useMemo, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { formatCredits, parseCredits, type CreditPlan } from '@campus/shared/src/creditPlanner';
import { compareCreditScenarioDeadline, creditDeadlineConclusion } from '@campus/shared/src/creditScenarioDeadline';
import { theme } from '../../ui/theme';

const number = (value: number | null) => value === null ? '未設定' : formatCredits(value);
function Action({ title, disabled = false, onPress }: { title: string; disabled?: boolean; onPress: () => void }) {
  const c = theme.colors;
  return <Pressable accessibilityRole="button" accessibilityLabel={title} accessibilityState={{ disabled }}
    disabled={disabled} onPress={onPress} style={{ minHeight: 44, justifyContent: 'center', padding: 11,
      borderRadius: 10, backgroundColor: c.surface2, borderWidth: 1, borderColor: c.border, opacity: disabled ? .5 : 1 }}>
    <Text style={{ color: c.text, fontSize: 13, fontWeight: '600' }}>{title}</Text>
  </Pressable>;
}

export function CreditScenarioDeadlineCard({ before, after }: { before: CreditPlan; after: CreditPlan }) {
  const c = theme.colors;
  const [targetTerm, setTargetTerm] = useState(before.terms);
  const [limitText, setLimitText] = useState('25');
  const [expanded, setExpanded] = useState(false);
  const [allLater, setAllLater] = useState(false);
  const limit = parseCredits(limitText);
  const result = useMemo(() => compareCreditScenarioDeadline(before, after, {
    targetTerm, workloadLimit: limit ?? Number.NaN,
  }), [before, after, targetTerm, limit]);
  const report = result.ok === true ? result.report : null;

  return <View accessibilityLabel="目標學期比較" style={{ borderWidth: 1, borderColor: c.border,
    borderRadius: 14, padding: 14, gap: 12, backgroundColor: c.surface }}>
    <Text style={{ color: c.muted, fontSize: 12 }}>看期限，不只看總量</Text>
    <Text style={{ color: c.text, fontWeight: '700', fontSize: 18 }}>這個學期前，學分來得及嗎？</Text>
    <Text style={{ color: c.muted, fontSize: 12, lineHeight: 19 }}>只計入期限前排定的課程，並假設全部通過且獲採計。</Text>
    <Text style={{ color: c.text, fontSize: 14, fontWeight: '600' }}>比較到未來第 {targetTerm} 學期末</Text>
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
      <Action title="提前一學期比較" disabled={targetTerm <= 1} onPress={() => setTargetTerm((value) => Math.max(1, value - 1))} />
      <Action title="延後一學期比較" disabled={targetTerm >= 8} onPress={() => setTargetTerm((value) => Math.min(8, value + 1))} />
    </View>
    <Text style={{ color: c.muted, fontSize: 12 }}>個人每學期負擔提醒</Text>
    <TextInput accessibilityLabel="個人每學期負擔提醒" value={limitText} maxLength={6} keyboardType="decimal-pad"
      onChangeText={setLimitText} style={{ minHeight: 46, borderWidth: 1, borderColor: c.border,
        borderRadius: 10, paddingHorizontal: 12, color: c.text, fontSize: 16 }} />
    <Text style={{ color: c.muted, fontSize: 11, lineHeight: 18 }}>1～40 學分；是你的規劃偏好，不是校方上限。</Text>
    {result.ok === false ? <Text accessibilityRole="alert" style={{ color: c.text, lineHeight: 21 }}>{result.message}</Text> : null}
    {report ? <>
      <View style={{ padding: 12, borderRadius: 10, backgroundColor: c.accentSoft }}>
        <Text accessibilityLiveRegion="polite" style={{ color: c.text, fontSize: 14, lineHeight: 23, fontWeight: '600' }}>{creditDeadlineConclusion(report)}</Text>
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
        {[{ title: '原規劃', value: report.before }, { title: '比較方案', value: report.after }].map((item) => (
          <View key={item.title} accessibilityLabel={`${item.title}期限缺口`} style={{ flex: 1, minWidth: 126, gap: 7,
            padding: 12, borderWidth: 1, borderColor: c.border, borderRadius: 12 }}>
            <Text style={{ color: c.muted, fontSize: 12 }}>{item.title} · 期限內還差</Text>
            <Text style={{ color: c.text, fontSize: 26, fontWeight: '700', fontVariant: ['tabular-nums'] }}>{number(item.value.remaining)}<Text style={{ fontSize: 12 }}> 學分</Text></Text>
            <Text style={{ color: c.muted, fontSize: 12, lineHeight: 19 }}>期限前安排 {formatCredits(item.value.scheduled)} 學分</Text>
          </View>
        ))}
      </View>
      {report.remainingDelta !== null ? <Text style={{ color: c.text, fontSize: 12, lineHeight: 20 }}>期限內缺口變化：{report.remainingDelta > 0 ? '+' : ''}{formatCredits(report.remainingDelta)} 學分；全部課程結束後仍缺 {number(report.after.remainingAfterAll)} 學分。</Text> : null}
      <Pressable accessibilityRole="button" accessibilityState={{ expanded }} accessibilityLabel="核對期限內分類與每學期負擔"
        onPress={() => setExpanded((value) => !value)} style={{ minHeight: 46, justifyContent: 'center' }}>
        <Text style={{ color: c.text, fontSize: 13, fontWeight: '700' }}>核對期限內分類與每學期負擔 {expanded ? '−' : '＋'}</Text>
      </Pressable>
      {expanded ? <View style={{ gap: 12 }}>
        <Text style={{ color: c.muted, fontSize: 12 }}>分類缺口 · 原規劃 → 比較方案</Text>
        {report.categories.map((row) => <View key={row.key} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
          <Text style={{ color: c.text, flex: 1, fontSize: 13 }}>{row.label}</Text><Text style={{ color: c.text, fontSize: 13 }}>{number(row.before)} → {number(row.after)}</Text>
        </View>)}
        <Text style={{ color: c.muted, fontSize: 12 }}>每學期學分 · 原規劃 → 比較方案</Text>
        {report.terms.map((row) => <View key={row.term} style={{ gap: 5 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
            <Text style={{ color: c.text, flex: 1, fontSize: 13 }}>第 {row.term} 學期</Text>
            <Text style={{ color: c.text, fontSize: 13 }}>{formatCredits(row.before)} → {formatCredits(row.after)}</Text>
          </View>
          {row.overBy > 0 ? <Text style={{ color: c.muted, fontSize: 12 }}>超過個人負擔提醒 {formatCredits(row.overBy)} 學分</Text> : null}
        </View>)}
        <Text style={{ color: c.muted, fontSize: 12, lineHeight: 20 }}>單位為學分；未設定不當成零。還有 {report.pendingMilestones} 項個人非學分條件未勾選，{report.unknownCategories} 類門檻未填完整。</Text>
        <Text style={{ color: c.muted, fontSize: 12, lineHeight: 20 }}>每學期不超過 {formatCredits(report.workloadLimit)} 學分時，期限內數學餘量為 {formatCredits(report.after.roomWithinLimit)} 學分；不代表有對應課程可選、符合先修或一定開課。</Text>
        {report.capacityShortfall !== null && report.capacityShortfall > 0 ? <Text style={{ color: c.text, fontSize: 12, lineHeight: 20 }}>若維持這個負擔偏好，單看學分量仍放不下 {formatCredits(report.capacityShortfall)} 學分，需重新安排期限或負擔。</Text> : null}
        {report.laterCourses.length ? <>
          <Text style={{ color: c.text, fontWeight: '600', fontSize: 13 }}>{report.laterCourses.length} 門排在期限後，不計入期限內學分</Text>
          {report.laterCourses.slice(0, allLater ? undefined : 6).map((course) => <View key={course.id} style={{ gap: 4 }}>
            <Text style={{ color: c.text, fontSize: 13 }}>{course.name}</Text><Text style={{ color: c.muted, fontSize: 12 }}>第 {course.term} 學期 · {formatCredits(course.credits)} 學分</Text>
          </View>)}
          {!allLater && report.laterCourses.length > 6 ? <Action title="顯示全部期限後課程" onPress={() => setAllLater(true)} /> : null}
        </> : null}
      </View> : null}
      {report.warnings.map((warning) => <Text key={warning} style={{ color: c.text, fontSize: 12, lineHeight: 20 }}>{warning}</Text>)}
      <Text style={{ color: c.muted, fontSize: 11, lineHeight: 19 }}>這不是畢業審查，也不會更動原規劃。期限與負擔提醒只用於當次比較，不寫入或匯出為校方規則。</Text>
    </> : null}
  </View>;
}
