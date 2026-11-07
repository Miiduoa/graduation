import React, { useSyncExternalStore } from 'react';
import { Text, View } from 'react-native';
import { savedClassGapTitle, type SavedClassGapQuery } from '../services/savedClassGapQuery';
import { AICard, AIButton, aiTokens } from '../ui/aiFirst';
import { getThemeVersion, subscribeToTheme } from '../ui/theme';

const days: ReadonlyArray<{ day: SavedClassGapQuery['day']; label: string; question: string }> = [
  { day: 'today', label: '改查今天', question: '那今天呢？' },
  { day: 'tomorrow', label: '改查明天', question: '那明天呢？' },
  { day: 'day-after-tomorrow', label: '改查後天', question: '那後天呢？' },
];

export function ClassGapReplyCard({ query, content, latest, busy, onAsk, onOpenTimetable }: {
  query: SavedClassGapQuery;
  content: string;
  latest: boolean;
  busy: boolean;
  onAsk: (question: string) => void;
  onOpenTimetable?: () => void;
}) {
  useSyncExternalStore(subscribeToTheme, getThemeVersion, getThemeVersion);
  const questions = latest ? days.filter(({ day }) => day !== query.day).map(({ label, question }) => ({ label, question })) : [];
  if (latest) {
    if (query.minMinutes < 60) questions.push({ label: '只看一小時以上', question: '至少一小時呢？' });
    if (query.minMinutes > 0) questions.push({ label: '不限長度', question: '不限長度' });
    if (query.part || query.fromMinute !== undefined || query.untilMinute !== undefined) {
      questions.push({ label: '查看全天', question: '全天' });
    }
    if (query.part !== 'afternoon') questions.push({ label: '只看下午', question: '只看下午' });
  }

  return (
    <AICard title={savedClassGapTitle(query)}>
      <Text selectable style={{ color: aiTokens.text, fontSize: 15, lineHeight: 25 }}>{content}</Text>
      {(questions.length > 0 || onOpenTimetable) && (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 12 }}>
          {questions.map(({ label, question }) => (
            <AIButton key={label} label={label} variant="ghost" size="sm" disabled={busy}
              style={{ maxWidth: '100%', flexShrink: 1, paddingHorizontal: 12 }}
              onPress={() => onAsk(question)} />
          ))}
          {onOpenTimetable && (
            <AIButton label="開啟我的課表" variant="ghost" size="sm" disabled={busy}
              style={{ maxWidth: '100%', flexShrink: 1, paddingHorizontal: 12 }} onPress={onOpenTimetable} />
          )}
        </View>
      )}
    </AICard>
  );
}
