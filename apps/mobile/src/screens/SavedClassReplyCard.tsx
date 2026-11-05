import React, { useSyncExternalStore } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { formatTaipeiDateTime, parseTaipeiInstant, TAIPEI_TIME_ZONE } from '@campus/shared/src/taipeiTime';
import type { SavedClassOccurrence } from '../services/onDeviceSchoolContext';
import { aiTokens } from '../ui/aiFirst';
import { getThemeVersion, subscribeToTheme } from '../ui/theme';

const classDate = new Intl.DateTimeFormat('zh-TW', {
  timeZone: TAIPEI_TIME_ZONE, month: 'numeric', day: 'numeric', weekday: 'short',
});

export function SavedClassReplyCard({ classes, updatedAt, onOpen, disabled, focus }: {
  classes: readonly SavedClassOccurrence[];
  updatedAt: string | null;
  onOpen: (item: SavedClassOccurrence) => void;
  disabled: boolean;
  focus?: 'room' | 'time';
}) {
  useSyncExternalStore(subscribeToTheme, getThemeVersion, getThemeVersion);
  if (!classes.length) return null;
  const savedAt = updatedAt && formatTaipeiDateTime(updatedAt, { seconds: false });
  const primary = { color: aiTokens.text, fontSize: 18, fontWeight: '700' } as const;
  const detail = { color: aiTokens.textSecondary, fontSize: 14 };
  return (
    <View style={{ gap: 8 }}>
      {classes.map((item) => {
        const stamp = parseTaipeiInstant(item.date);
        const date = stamp === null ? '日期未確認' : classDate.format(stamp);
        const time = `${item.startTime}–${item.endTime <= item.startTime ? '隔日 ' : ''}${item.endTime}`;
        const room = item.room.trim() || '教室未填';
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
            accessibilityLabel={`在課表中查看${item.name}，${date}，${time}，${room}`}
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
