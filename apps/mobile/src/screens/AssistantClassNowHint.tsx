import React, { useCallback, useState } from 'react';
import { AppState, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { isAssistantTimetableOwner, readAssistantTimetable, subscribeAssistantTimetableOwner, type PlatformTimetableAccess } from '../services/assistantTimetableSource';
import { currentSavedClasses, nextSavedClasses } from '../services/nextSavedClasses';
import { subscribePersonalImports } from '../services/personalImports';
import { subscribeTimetableChanges } from '../widgets/timetableChanges';
import { aiTokens } from '../ui/aiFirst';

const MINUTE = 60_000;
type Source = Awaited<ReturnType<typeof readAssistantTimetable>>;

function classHint(source: Source, now: Date) {
  if (!source) return null;
  const current = currentSavedClasses(source.records, source.schoolId, now);
  if (!current) return null;
  if (current.length > 1) return {
    upcoming: false, status: '手機課表 · 時段重疊', title: `現在有 ${current.length} 堂課重疊`,
    detail: '點「現在有課嗎？」查看各堂課的時間與教室。',
  };
  if (current.length === 1) {
    const [item] = current;
    const end = item.endTime <= item.startTime ? `隔日 ${item.endTime}` : item.endTime;
    return {
      upcoming: false, status: '手機課表 · 上課中', title: item.name,
      detail: `${item.startTime}–${end} · ${item.room.trim() || '教室未填'}`,
    };
  }
  const upcoming = nextSavedClasses(source.records, source.schoolId, now, undefined, 20 * MINUTE);
  if (!upcoming?.length) return null;
  const [next] = upcoming;
  const minutes = Math.ceil((Date.parse(`${next.date}T${next.startTime}:00+08:00`) - now.getTime()) / MINUTE);
  if (minutes <= 0 || minutes > 20) return null;
  return {
    upcoming: true, status: `手機課表 · ${minutes} 分鐘後上課`,
    title: upcoming.length === 1 ? next.name : `有 ${upcoming.length} 堂課同時開始`,
    detail: upcoming.length === 1 ? `${next.startTime} 開始 · ${next.room.trim() || '教室未填'}` : `${next.startTime} 開始 · 點「查下一堂課」查看`,
  };
}

export function AssistantClassNowHint({ uid, schoolId, platformTimetable, children }: {
  uid: string;
  schoolId: string;
  platformTimetable?: PlatformTimetableAccess;
  children?: (upcoming: boolean) => React.ReactNode;
}) {
  const [hint, setHint] = useState<ReturnType<typeof classHint>>(null);
  useFocusEffect(useCallback(() => {
    let focused = true;
    let foreground = !AppState.currentState || AppState.currentState === 'active';
    let generation = 0;
    let timer: ReturnType<typeof setTimeout>;
    let source: Source = null;
    const tick = () => {
      clearTimeout(timer);
      if (!focused || !foreground) return;
      if (!isAssistantTimetableOwner(uid, platformTimetable)) source = null;
      const now = new Date();
      setHint(classHint(source, now));
      if (source) timer = setTimeout(tick, MINUTE - now.getTime() % MINUTE);
    };
    const reload = async () => {
      if (!foreground) return;
      const version = ++generation;
      source = null;
      tick();
      if (!isAssistantTimetableOwner(uid, platformTimetable)) return;
      const result = await readAssistantTimetable(uid, schoolId, platformTimetable).catch(() => null);
      if (!focused || version !== generation) return;
      source = result;
      tick();
    };
    void reload();
    const account = subscribeAssistantTimetableOwner(uid, () => void reload(), platformTimetable);
    const owner = platformTimetable ? `nuni:${platformTimetable.accountId}` : `firebase:${uid}`;
    const imports = subscribePersonalImports(({ scope }) => {
      if (scope.owner === owner && scope.schoolId === schoolId) void reload();
    });
    const manual = subscribeTimetableChanges(() => void reload());
    const app = AppState.addEventListener('change', (state) => {
      foreground = state === 'active';
      if (foreground) void reload();
      else {
        ++generation;
        clearTimeout(timer);
        setHint(null);
      }
    });
    return () => {
      focused = false;
      clearTimeout(timer);
      imports();
      manual();
      account?.();
      app.remove();
    };
  }, [uid, schoolId, platformTimetable]));

  return (
    <>
      {hint ? (
        <View style={{ gap: 4 }}>
          <Text style={{ color: aiTokens.aiStrong, fontSize: 14, fontWeight: '600' }}>{hint.status}</Text>
          <Text style={{ color: aiTokens.text, fontSize: 21, fontWeight: '700' }}>{hint.title}</Text>
          <Text style={{ color: aiTokens.textSecondary, fontSize: 15 }}>{hint.detail}</Text>
        </View>
      ) : (
        <Text style={{ color: aiTokens.textSecondary, lineHeight: 22 }}>
          {platformTimetable ? '查這台手機已存的上課時間與教室，也可以用鍵盤麥克風提問。'
            : '查現在或下一堂課會讀取手機已存課表。整理課業時會同步已授權的作業與公告。'}
        </Text>
      )}
      {children?.(hint?.upcoming === true)}
    </>
  );
}
