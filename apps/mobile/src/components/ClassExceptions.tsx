import React, { useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import {
  buildPersonalToday,
  classDate,
  classMeetingKey,
  saveClassException,
  withClassExceptions,
  previewClassException,
  type ClassException,
  type PersonalImportRecord,
} from '@campus/shared';
import { Button } from '../ui/components';
import { theme } from '../ui/theme';

export function ClassExceptions({
  records,
  exceptions = [],
  schoolId,
  termKey,
  initialDate,
  disabled,
  onSave,
}: {
  records: PersonalImportRecord[];
  exceptions?: ClassException[];
  schoolId: string;
  termKey?: string;
  initialDate?: string;
  disabled?: boolean;
  onSave: (next: ClassException[]) => Promise<boolean>;
}) {
  const [date, setDate] = useState(() => initialDate || classDate(new Date()));
  const [selected, setSelected] = useState('');
  const [kind, setKind] = useState<ClassException['kind']>('cancel');
  const [target, setTarget] = useState(date);
  const [endDate, setEndDate] = useState(date);
  const [start, setStart] = useState('18:00');
  const [end, setEnd] = useState('20:00');
  const [room, setRoom] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  let plan: ReturnType<typeof buildPersonalToday> | null = null;
  try {
    plan = buildPersonalToday(withClassExceptions(records, exceptions), {
      schoolId,
      termKey,
      now: new Date(`${date}T12:00:00+08:00`),
    });
  } catch {
    /* Keep partially typed dates editable. */
  }
  const candidates = records.filter(
    (row) =>
      row.kind === 'timetable' &&
      row.schoolId === schoolId &&
      `${row.academicYear}|${row.semester}` === plan?.termKey &&
      row.dayOfWeek === plan?.weekday,
  );
  const row = candidates.find((item) => item.id === selected) || candidates[0];
  const preview =
    row && kind === 'move'
      ? previewClassException(records, exceptions, {
          id: 'preview',
          courseKey: classMeetingKey(row),
          original: row,
          originalDate: date,
          kind,
          date: target,
          endDate,
          startTime: start,
          endTime: end,
          location: room.trim() || row.location || '',
          createdAt: '',
        })
      : null;
  const overlap = preview
    ? buildPersonalToday(preview, {
        schoolId,
        termKey,
        now: new Date(`${target}T12:00:00+08:00`),
      }).today.some((entry) => entry.row.id === row?.id && entry.conflict)
    : false;
  const persist = async (next: ClassException[]) => {
    if (saving || disabled) return;
    setSaving(true);
    setError('');
    try {
      if (!(await onSave(next))) setError('尚未完成儲存，請保留畫面並重試。');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '尚未儲存，請重試。');
    } finally {
      setSaving(false);
    }
  };
  const field = (
    label: string,
    value: string,
    change: (value: string) => void,
    placeholder?: string,
  ) => (
    <View style={{ gap: 4 }}>
      <Text style={{ color: theme.colors.text }}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={change}
        placeholder={placeholder}
        editable={!saving && !disabled}
        autoCapitalize="none"
        style={{
          color: theme.colors.text,
          borderColor: theme.colors.muted,
          borderWidth: 1,
          borderRadius: 10,
          padding: 12,
        }}
      />
    </View>
  );
  return (
    <View
      style={{
        padding: 16,
        gap: 12,
        borderWidth: 1,
        borderColor: theme.colors.muted,
        borderRadius: 16,
      }}
    >
      <Text
        accessibilityRole="header"
        style={{ color: theme.colors.text, fontSize: 20, fontWeight: '700' }}
      >
        這一天，照實際安排走
      </Text>
      <Text style={{ color: theme.colors.muted }}>
        週課表保留原排課；這裡只改指定日期。日期格式：2026-11-02。
      </Text>
      {field(
        '查看日期',
        date,
        (value) => {
          setDate(value);
          setSelected('');
        },
        'YYYY-MM-DD',
      )}
      {!plan && <Text accessibilityRole="alert">請填寫完整有效日期。</Text>}
      {plan?.today.map((entry) => (
        <View key={`${entry.row.id}:${entry.startAt}`}>
          <Text style={{ color: theme.colors.text, fontWeight: '700' }}>{entry.row.title}</Text>
          <Text style={{ color: theme.colors.text }}>
            {entry.startTime}–{entry.endTime} · {entry.row.location || '教室未填'}
          </Text>
          {entry.conflict && <Text accessibilityRole="alert">時間重疊，請核對</Text>}
        </View>
      ))}
      {plan && !plan.today.length && (
        <Text style={{ color: theme.colors.muted }}>
          這天沒有已排定的課程。{plan.unplacedCount ? '仍有時間未完整的課程，請先核對。' : ''}
        </Text>
      )}
      <Text style={{ color: theme.colors.text }}>調整原本在這天的課</Text>
      {candidates.map((item) => (
        <Button
          key={item.id}
          text={`${item.id === row?.id ? '✓ ' : ''}${item.title} · ${item.startTime || `第 ${item.startPeriod} 節`}`}
          disabled={saving || disabled}
          onPress={() => setSelected(item.id)}
        />
      ))}
      <View style={{ gap: 8 }}>
        {(['cancel', 'move', 'room'] as const).map((value, index) => (
          <Button
            key={value}
            text={`${kind === value ? '✓ ' : ''}${['只停這一次', '改期補課', '只換教室'][index]}`}
            disabled={saving || disabled}
            onPress={() => setKind(value)}
          />
        ))}
      </View>
      {kind === 'move' && (
        <>
          {field(
            '補課日期',
            target,
            (value) => {
              setTarget(value);
              setEndDate(value);
            },
            'YYYY-MM-DD',
          )}
          {field('開始時間', start, setStart, 'HH:mm')}
          {field('結束日期', endDate, setEndDate, 'YYYY-MM-DD')}
          {field('結束時間', end, setEnd, 'HH:mm')}
        </>
      )}
      {kind !== 'cancel' && field('這次的教室', room, setRoom)}
      {overlap && <Text accessibilityRole="alert">補課時間與其他課程重疊，請核對；仍可儲存。</Text>}
      <Button
        text={saving ? '儲存中…' : '儲存這次安排'}
        disabled={!row || saving || disabled}
        onPress={() => {
          if (!row) return;
          try {
            const { classExceptions: omitted, ...original } = row;
            void omitted;
            const value: ClassException = {
              id: `exception-${Date.now()}`,
              courseKey: classMeetingKey(row),
              originalDate: date,
              kind,
              original,
              createdAt: new Date().toISOString(),
              ...(kind === 'move'
                ? { date: target, endDate, startTime: start, endTime: end, location: room.trim() || row.location || '' }
                : {}),
              ...(kind === 'room' ? { location: room } : {}),
            };
            void persist(saveClassException(exceptions, value));
          } catch (cause) {
            setError((cause as Error).message);
          }
        }}
      />
      {error ? <Text accessibilityRole="alert">{error}</Text> : null}
      {exceptions.map((item) => (
        <View key={item.id} style={{ gap: 6, paddingTop: 12 }}>
          <Text style={{ color: theme.colors.text }}>
            {item.original.title} · {item.originalDate} ·{' '}
            {item.kind === 'cancel'
              ? '停課'
              : item.kind === 'room'
                ? `換至 ${item.location}`
                : `補課 ${item.date} ${item.startTime}–${item.endTime} ${item.location || ''}`}
          </Text>
          {!records.some((record) => classMeetingKey(record) === item.courseKey) && (
            <Text accessibilityRole="alert">原課程時段已變更，此調整保留待核對，尚未套用。</Text>
          )}
          <Text style={{ color: theme.colors.muted }}>
            原始來源：{item.original.source.name || item.original.source.type} · 第{' '}
            {item.original.source.line} 列
          </Text>
          <Text style={{ color: theme.colors.muted }}>
            {item.original.source.rawText || '手動建立的課程'}
          </Text>
          <Button
            text="恢復原安排"
            disabled={saving || disabled}
            onPress={() => void persist(exceptions.filter((value) => value.id !== item.id))}
          />
        </View>
      ))}
    </View>
  );
}
