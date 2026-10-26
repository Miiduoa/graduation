import React, { useCallback, useState } from 'react';
import { Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { formatClock, type TodayClass } from '@campus/shared/src/pickNextAction';
import { useTodayTimetableData } from '../hooks/useTodayTimetableData';
import { AICard, AIButton, aiTokens } from '../ui/aiFirst';

export function nextLearningClass(classes: readonly TodayClass[], now: Date): TodayClass | null {
  const current = now.getTime();
  if (!Number.isFinite(current)) return null;
  return [...classes]
    .filter((entry) =>
      Number.isFinite(entry.startAt) &&
      Number.isFinite(entry.endAt) &&
      entry.endAt > current &&
      entry.endAt > entry.startAt,
    )
    .sort((a, b) => a.startAt - b.startAt || a.endAt - b.endAt || a.id.localeCompare(b.id))[0] ?? null;
}

type Props = {
  onOpenTimetable: () => void;
  onImportTimetable: () => void;
};

export function LearningNextClassCard({ onOpenTimetable, onImportTimetable }: Props) {
  const [now, setNow] = useState(() => new Date());
  const { status, classes, retry } = useTodayTimetableData(now);
  useFocusEffect(
    useCallback(() => {
      setNow(new Date());
      const timer = setInterval(() => setNow(new Date()), 60_000);
      return () => clearInterval(timer);
    }, []),
  );
  const next = status === 'ready' ? nextLearningClass(classes, now) : null;
  const current = next && next.startAt <= now.getTime();
  const body = { color: aiTokens.textSecondary, fontSize: 13, lineHeight: 20 } as const;
  const muted = { color: aiTokens.muted, fontSize: 12, lineHeight: 18 } as const;

  return (
    <AICard title="今天的課表" badge="個人課表" badgeTone="muted">
      <View style={{ gap: 10 }}>
        {status === 'loading' ? (
          <Text style={body} accessibilityLiveRegion="polite">正在讀取課表…</Text>
        ) : status === 'error' ? (
          <>
            <Text style={body} accessibilityRole="alert">課表暫時無法讀取，並不代表今天沒有課。</Text>
            <AIButton label="重新讀取課表" onPress={() => void retry()} />
          </>
        ) : status === 'empty' ? (
          <>
            <Text style={body}>尚未建立個人課表，匯入後就能快速查看下一堂課。</Text>
            <AIButton label="匯入課表" onPress={onImportTimetable} />
          </>
        ) : next ? (
          <>
            <Text style={{ color: aiTokens.text, fontWeight: '700', fontSize: 18, lineHeight: 26 }}>
              {next.title}
            </Text>
            <Text style={body}>
              {formatClock(next.startAt)}–{formatClock(next.endAt)}
              {next.location.trim() ? ' · ' + next.location.trim() : ' · 教室未填'}
            </Text>
            <Text style={muted}>
              {current ? '目前是這堂課的上課時段' : '下一堂課'}
              {' · '}
              依你自行編輯或匯入的課表顯示
            </Text>
            <AIButton label="開啟我的課表" variant="ghost" onPress={onOpenTimetable} />
          </>
        ) : (
          <>
            <Text style={body}>
              {classes.length ? '今天的上課時段已結束。' : '這份個人課表今天沒有可確認時間的課程。'}
            </Text>
            <AIButton label="查看整週課表" variant="ghost" onPress={onOpenTimetable} />
          </>
        )}
        {status === 'ready' ? (
          <Text style={muted}>停課、調課及補課請以學校最新公告為準。</Text>
        ) : null}
      </View>
    </AICard>
  );
}
