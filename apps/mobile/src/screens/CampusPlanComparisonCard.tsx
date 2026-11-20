import React, { useState, useSyncExternalStore } from 'react';
import { Pressable, Text, View } from 'react-native';
import { AIButton, aiTokens } from '../ui/aiFirst';
import { getThemeVersion, subscribeToTheme } from '../ui/theme';
import type { CampusPlanComparison } from '../services/campusPlanComparison';

type Props = {
  comparison: CampusPlanComparison;
  disabled: boolean;
  onOpenOriginal?: () => void;
};

const PREVIEW_COUNT = 5;
const CHANGE_LABEL = {
  receipt: '平台紀錄',
  added: '本次新增',
  missing: '本次未列出',
  changed: '內容調整',
  unverifiable: '待核對',
  window: '規劃日期調整',
};
const taipeiTimestamp = new Intl.DateTimeFormat('zh-TW', {
  timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

function checkedTime(value: string): string {
  const timestamp = typeof value === 'string' && /T.*(?:Z|[+-]\d{2}:\d{2})$/i.test(value)
    ? Date.parse(value) : NaN;
  return Number.isFinite(timestamp) ? taipeiTimestamp.format(new Date(timestamp)) : '時間未確認';
}

/** Compares saved copies without changing either plan or its personal checklist. */
export function CampusPlanComparisonCard({ comparison, disabled, onOpenOriginal }: Props) {
  useSyncExternalStore(subscribeToTheme, getThemeVersion, getThemeVersion);
  const [view, setView] = useState({ comparison, expanded: false });
  const expanded = view.comparison === comparison && view.expanded;

  const visibleChanges = expanded ? comparison.changes : comparison.changes.slice(0, PREVIEW_COUNT);
  const hasComparableContent = comparison.comparableDates > 0 || comparison.unchangedAssignments > 0 ||
    (comparison.unchangedQuizzes ?? 0) > 0;
  const summary = comparison.changes.length
    ? '有 ' + comparison.changes.length + ' 項變動或需要核對的內容。'
    : hasComparableContent
      ? '這次沒有列出可確認的調整；僅涵蓋下方比對範圍。'
      : '目前沒有足夠資料可比對，請先查看下方說明。';

  return (
    <View style={{
      marginTop: 14, padding: 14, gap: 14, minWidth: 0,
      borderWidth: 1, borderColor: aiTokens.border, borderRadius: 14,
      backgroundColor: aiTokens.surface,
    }}>
      <View style={{ gap: 6 }}>
        <Text accessibilityRole="header" style={{ color: aiTokens.text, fontSize: 16, fontWeight: '700', lineHeight: 24 }}>
          這次調整了什麼
        </Text>
        <Text style={{ color: aiTokens.textSecondary, fontSize: 13, lineHeight: 21 }}>{summary}</Text>
      </View>

      <View style={{ gap: 4, paddingLeft: 10, borderLeftWidth: 2, borderLeftColor: aiTokens.border }}>
        <Text style={{ color: aiTokens.muted, fontSize: 12, lineHeight: 20 }}>
          原計畫整理：{checkedTime(comparison.previousCheckedAt)}（台灣時間）
        </Text>
        <Text style={{ color: aiTokens.textSecondary, fontSize: 12, lineHeight: 20 }}>
          本次整理：{checkedTime(comparison.currentCheckedAt)}（台灣時間）
        </Text>
      </View>

      <View style={{ gap: 4 }}>
        <Text style={{ color: aiTokens.muted, fontSize: 12, lineHeight: 20 }}>
          {comparison.comparableDates > 0
            ? '可比對日期：' + comparison.comparableDates + ' 個共同日期。'
            : '沒有可共同核對的日期。'}
        </Text>
        {comparison.unchangedAssignments > 0 ? (
          <Text style={{ color: aiTokens.muted, fontSize: 12, lineHeight: 20 }}>
            {comparison.unchangedAssignments} 項作業摘要與原計畫相同。
          </Text>
        ) : null}
        {(comparison.unchangedQuizzes ?? 0) > 0 ? (
          <Text style={{ color: aiTokens.muted, fontSize: 12, lineHeight: 20 }}>
            {comparison.unchangedQuizzes} 項測驗摘要與原計畫相同。
          </Text>
        ) : null}
      </View>

      {visibleChanges.map((change) => (
        <View key={change.id} style={{ gap: 7, paddingTop: 12, borderTopWidth: 1, borderTopColor: aiTokens.border, minWidth: 0 }}>
          <Text style={{
            color: change.kind === 'unverifiable' || change.kind === 'missing' ? aiTokens.warning : aiTokens.muted,
            fontSize: 12, fontWeight: '600', lineHeight: 19,
          }}>
            {CHANGE_LABEL[change.kind]}
          </Text>
          <Text style={{ color: aiTokens.text, fontSize: 14, fontWeight: '600', lineHeight: 23 }}>
            {change.title}
          </Text>
          {change.before ? (
            <View style={{ gap: 2 }}>
              <Text style={{ color: aiTokens.muted, fontSize: 12, lineHeight: 19 }}>原計畫</Text>
              <Text style={{ color: aiTokens.textSecondary, fontSize: 13, lineHeight: 22 }}>{change.before}</Text>
            </View>
          ) : null}
          {change.after ? (
            <View style={{ gap: 2 }}>
              <Text style={{ color: aiTokens.muted, fontSize: 12, lineHeight: 19 }}>本次計畫</Text>
              <Text style={{ color: aiTokens.text, fontSize: 13, lineHeight: 22 }}>{change.after}</Text>
            </View>
          ) : null}
          <Text style={{ color: aiTokens.textSecondary, fontSize: 13, lineHeight: 22 }}>{change.detail}</Text>
        </View>
      ))}

      {comparison.changes.length > PREVIEW_COUNT ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={expanded ? '收起調整清單' : '查看全部 ' + comparison.changes.length + ' 項'}
          accessibilityState={{ expanded, disabled }}
          aria-expanded={expanded}
          disabled={disabled}
          onPress={() => { if (!disabled) setView({ comparison, expanded: !expanded }); }}
          style={({ pressed }) => ({
            minHeight: 44, paddingHorizontal: 12, paddingVertical: 11, alignItems: 'center', justifyContent: 'center',
            borderWidth: 1, borderColor: aiTokens.border, borderRadius: 10,
            backgroundColor: pressed ? aiTokens.panel : aiTokens.surface,
            opacity: disabled ? 0.5 : 1,
          })}
        >
          <Text style={{ color: aiTokens.text, fontSize: 13, fontWeight: '600', lineHeight: 20 }}>
            {expanded ? '收起調整清單' : '查看全部 ' + comparison.changes.length + ' 項'}
          </Text>
        </Pressable>
      ) : null}

      {comparison.limitations.length ? (
        <View style={{ gap: 5, paddingTop: 12, borderTopWidth: 1, borderTopColor: aiTokens.border }}>
          <Text style={{ color: aiTokens.textSecondary, fontSize: 12, fontWeight: '600', lineHeight: 20 }}>
            這次能核對的範圍
          </Text>
          {comparison.limitations.map((limitation, index) => (
            <Text key={index} style={{ color: aiTokens.muted, fontSize: 12, lineHeight: 21 }}>{limitation}</Text>
          ))}
        </View>
      ) : null}

      <View style={{ gap: 10, paddingTop: 12, borderTopWidth: 1, borderTopColor: aiTokens.border }}>
        <Text style={{ color: aiTokens.muted, fontSize: 12, lineHeight: 21 }}>
          原計畫與勾選進度會保留。新計畫可另外儲存，處理進度不會自動帶入。
        </Text>
        {onOpenOriginal ? (
          <AIButton label="查看原計畫" variant="ghost" size="sm" disabled={disabled}
            onPress={() => { if (!disabled) onOpenOriginal(); }} />
        ) : null}
      </View>
    </View>
  );
}
