import React, { useEffect, useRef, useState, useMemo } from 'react';
import { Text, TextInput, View } from 'react-native';
import { classDate, type PersonalImportRecord } from '@campus/shared';
import {
  calendarRangeEnd,
  personalCalendarEventLabel,
  personalCalendarSnapshotCopy,
  previewPersonalCalendar,
  serializePersonalCalendar,
} from '@campus/shared/src/timetable/personalCalendarExport';
import { shareICalContent } from '../services/ical';
import { Button } from '../ui/components';
import { theme } from '../ui/theme';

export function PersonalCalendarExport({
  records,
  schoolId,
  termKey,
  disabled,
}: {
  records: PersonalImportRecord[];
  schoolId: string;
  termKey: string;
  disabled?: boolean;
}) {
  const [start, setStart] = useState(() => classDate(new Date()));
  const [end, setEnd] = useState(() => calendarRangeEnd(classDate(new Date())));
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const [showDetails, setShowDetails] = useState(false);
  const { preview, error } = useMemo(() => {
    try {
      return {
        preview: previewPersonalCalendar(records, { schoolId, termKey, start, end }),
        error: '',
      };
    } catch (cause) {
      return { preview: undefined, error: (cause as Error).message };
    }
  }, [records, schoolId, termKey, start, end]);
  return (
    <View style={{ gap: 8 }} accessibilityLabel="匯出課表快照">
      <Text style={{ color: theme.colors.text, fontWeight: '700' }}>帶到我的行事曆</Text>
      <Text style={{ color: theme.colors.text }}>{personalCalendarSnapshotCopy}</Text>
      <Text style={{ color: theme.colors.muted }}>
        依目前選取的學期匯出，最多八週；日期與時間皆以台灣時間為準。未登記的放假或停課仍會照每週課表匯出，請先核對。
      </Text>
      <Text style={{ color: theme.colors.text }}>匯出開始日期（YYYY-MM-DD）</Text>
      <TextInput
        accessibilityLabel="匯出開始日期"
        value={start}
        onChangeText={setStart}
        style={inputStyle}
      />
      <Text style={{ color: theme.colors.text }}>匯出結束日期（YYYY-MM-DD）</Text>
      <TextInput
        accessibilityLabel="匯出結束日期"
        value={end}
        onChangeText={setEnd}
        style={inputStyle}
      />
      {disabled ? (
        <Text>課表尚未完整讀取，暫時無法匯出。</Text>
      ) : error ? (
        <Text accessibilityRole="alert">{error}</Text>
      ) : (
        preview && (
          <View accessibilityLiveRegion="polite">
            <Text style={{ color: theme.colors.text }}>
              將匯出 {preview.events.length} 堂課；略過 {preview.skipped.length}{' '}
              門時間未確認的課程。
            </Text>
            <Button
              text={showDetails ? '收起逐堂明細' : '查看逐堂明細'}
              onPress={() => setShowDetails(!showDetails)}
            />
            {showDetails &&
              preview.events.map((event) => (
                <Text key={event.uid} style={{ color: theme.colors.text }}>
                  {personalCalendarEventLabel(event)}
                </Text>
              ))}
            {preview.skipped.map((row) => (
              <Text key={row.id} style={{ color: theme.colors.muted }}>
                {row.title}：星期或時間未確認
              </Text>
            ))}
          </View>
        )
      )}
      <Button
        text={busy ? '正在開啟分享…' : '分享課表 ICS'}
        disabled={disabled || busy || !preview?.events.length}
        onPress={async () => {
          if (!preview || disabled || busy) return;
          setBusy(true);
          setNotice('');
          try {
            await shareICalContent(
              serializePersonalCalendar(preview),
              `nuni-timetable-${start}-${end}.ics`,
              () => mounted.current,
            );
          } catch {
            if (mounted.current) setNotice('分享選單未能開啟，請稍後再試。');
          } finally {
            if (mounted.current) setBusy(false);
          }
        }}
      />
      {notice ? <Text accessibilityRole="alert">{notice}</Text> : null}
    </View>
  );
}
const inputStyle = {
  color: theme.colors.text,
  borderColor: theme.colors.separator,
  borderWidth: 1,
  padding: 12,
  minHeight: 44,
  borderRadius: 10,
};
