import React, { useSyncExternalStore } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { formatTaipeiDateTime, parseTaipeiInstant, TAIPEI_TIME_ZONE } from '@campus/shared/src/taipeiTime';
import type { SavedClassOccurrence } from '../services/onDeviceSchoolContext';
import type { SavedClassRead } from '../services/savedClassQuery';
import { aiTokens } from '../ui/aiFirst';
import { getThemeVersion, subscribeToTheme } from '../ui/theme';

const classDate = new Intl.DateTimeFormat('zh-TW', {
  timeZone: TAIPEI_TIME_ZONE, month: 'numeric', day: 'numeric', weekday: 'short',
});

export function savedClassReplyTitle({ classes, focus, currentAt }: SavedClassRead): string {
  if (focus === 'room') return '上課教室';
  if (focus === 'time') return '上課時間';
  if (currentAt) {
    if (!classes.length) return '這個時段沒有排課';
    return classes.length > 1 ? `這個時段有 ${classes.length} 堂課` : '這個時段的課';
  }
  return classes.length > 1 ? '同時段有多堂課' : '下一堂課';
}

export function SavedClassReplyCard({ classes, updatedAt, onOpen, disabled, focus, currentAt }: {
  classes: readonly SavedClassOccurrence[];
  updatedAt: string | null;
  onOpen: (item: SavedClassOccurrence) => void;
  disabled: boolean;
  focus?: 'room' | 'time';
  currentAt?: string;
}) {
  useSyncExternalStore(subscribeToTheme, getThemeVersion, getThemeVersion);
  if (!classes.length && !currentAt) return null;
  const checkedAt = currentAt && formatTaipeiDateTime(currentAt, { seconds: false });
  const savedAt = updatedAt && formatTaipeiDateTime(updatedAt, { seconds: false });
  const primary = { color: aiTokens.text, fontSize: 18, fontWeight: '700' } as const;
  const detail = { color: aiTokens.textSecondary, fontSize: 14 };
  return (
    <View style={{ gap: 8 }}>
      {checkedAt && <Text style={detail}>查詢時間 {checkedAt}（台灣時間）</Text>}
      {classes.map((item) => {
        const stamp = parseTaipeiInstant(item.date);
        const date = stamp === null ? '日期未確認' : classDate.format(stamp);
        const time = `${item.startTime}–${item.endTime <= item.startTime ? '隔日 ' : ''}${item.endTime}`;
        const room = item.room.trim() || '教室未填';
        const endAt = Date.parse(`${item.date}T${item.endTime}:00+08:00`) +
          (item.endTime <= item.startTime ? 86_400_000 : 0);
        const remaining = currentAt ? Math.ceil((endAt - Date.parse(currentAt)) / 60_000) : 0;
        const remainingLabel = remaining > 0 ? `查詢時距下課約 ${remaining} 分鐘` : '';
        const schedule = (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: 8, rowGap: 2 }}>
            <Text style={detail}>{date}</Text>
            {focus !== 'time' && <Text style={{ color: aiTokens.text, fontSize: 14, fontWeight: '600' }}>{time}</Text>}
          </View>
        );
        return (
          <TouchableOpacity
            key={JSON.stringify([item.term, item.courseId, item.date, item.startTime])}
            accessibilityRole="button"
            accessibilityLabel={`在課表中查看${item.name}，${date}，${time}，${room}${remainingLabel ? '，' + remainingLabel : ''}`}
            accessibilityState={{ disabled }}
            disabled={disabled}
            onPress={() => onOpen(item)}
            style={{
              minHeight: 48, gap: 6, padding: 14, borderRadius: 12,
              borderWidth: 1, borderColor: aiTokens.border, backgroundColor: aiTokens.panel,
            }}
          >
            {focus ? <Text style={primary}>{focus === 'room' ? room : time}</Text> : schedule}
            <Text style={focus ? { color: aiTokens.text, fontSize: 15, fontWeight: '600' } : primary}>{item.name}</Text>
            {focus !== 'room' && <Text style={detail}>{room}</Text>}
            {focus && schedule}
            {remainingLabel && <Text style={{ color: aiTokens.aiStrong, fontSize: 14 }}>{remainingLabel}</Text>}
            <Text style={{ color: disabled ? aiTokens.muted : aiTokens.aiStrong, fontSize: 14, fontWeight: '600', marginTop: 4 }}>
              在課表中查看 ›
            </Text>
          </TouchableOpacity>
        );
      })}
      <Text style={{ color: aiTokens.muted, fontSize: 12 }}>
        手機儲存課表 · {savedAt ? `儲存於 ${savedAt}（台灣時間）` : '儲存時間未知'}
      </Text>
    </View>
  );
}
