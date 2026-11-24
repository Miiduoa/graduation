import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { PersonalImportRecord } from '@campus/shared';
import {
  currentTermClassCalendarMeetings,
  findClassCalendarOverlaps,
} from '@campus/shared/src/classCalendarOverlap';
import { formatClock } from '@campus/shared/src/pickNextAction';
import { theme } from '../ui/theme';
import { useThemeStyleSheet } from '../ui/useThemeStyleSheet';

type Props = {
  records: PersonalImportRecord[];
  schoolId: string;
  selectedTerm?: string;
  now: Date;
  onOpenEvent: (eventId: string) => void;
};

export function TodayClassCalendarOverlap({ records, schoolId, selectedTerm, now, onOpenEvent }: Props) {
  const styles = useThemeStyleSheet(createStyles);
  const next = useMemo(() => {
    if (selectedTerm) {
      const selected = records.find((row) => row.kind === 'timetable' && row.schoolId === schoolId &&
        [row.academicYear, row.semester].join('|') === selectedTerm);
      if (!selected || !currentTermClassCalendarMeetings([selected], schoolId, now).hasCurrentTerm) return undefined;
    }
    const { classes } = currentTermClassCalendarMeetings(records, schoolId, now);
    return findClassCalendarOverlaps(classes, records, schoolId, now.getTime())[0];
  }, [records, schoolId, selectedTerm, now]);
  if (!next) return null;

  return (
    <View style={styles.card}>
      <Text accessibilityRole="header" style={styles.title}>nuni 發現今天有行程重疊</Text>
      <Text style={styles.body}>
        {formatClock(next.startAt)}–{formatClock(next.endAt)}，你的「{next.eventTitle}」和「{next.classTitle}」上課時間重疊。
      </Text>
      <Text style={styles.source}>依據你的個人課表與本機行事曆</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`查看個人行程「${next.eventTitle}」`}
        onPress={() => {
          if (Date.now() < next.endAt) onOpenEvent(next.eventId);
        }}
        style={({ pressed }) => [styles.action, pressed && styles.pressed]}
      >
        <Text style={styles.actionText}>查看這筆行程</Text>
      </Pressable>
    </View>
  );
}

const createStyles = () => StyleSheet.create({
  card: { padding: 16, gap: 6, backgroundColor: theme.colors.accentSoft, borderRadius: 14 },
  title: { color: theme.colors.text, fontSize: 17, fontWeight: '700' },
  body: { color: theme.colors.text, fontSize: 16, lineHeight: 23 },
  source: { color: theme.colors.textSecondary, fontSize: 13 },
  action: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' },
  actionText: { color: theme.colors.accentStrong, fontWeight: '700', fontSize: 16 },
  pressed: { opacity: 0.7 },
});
