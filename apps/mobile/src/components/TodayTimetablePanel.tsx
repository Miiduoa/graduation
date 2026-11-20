import React, { useCallback, useMemo, useRef, useState } from 'react';
import { AppState, Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { buildPersonalToday, type PersonalImportRecord } from '@campus/shared';
import { usePersonalImportScope } from '../state/personalImportScope';
import { loadPersonalImports } from '../services/personalImports';
import { loadPersonalTimetable, personalTimetableRecords } from '../services/personalTimetable';
import { theme } from '../ui/theme';
import { useThemeStyleSheet } from '../ui/useThemeStyleSheet';

type Props = {
  onOpenImport(): void;
  onOpenTimetable(termKey?: string): void;
  refreshKey?: number;
};
type Snapshot = {
  scope: string;
  status: 'loading' | 'ready' | 'error';
  records: PersonalImportRecord[];
};

/** An imported weekly plan is useful without granting school-account access. */
export function TodayTimetablePanel({ onOpenImport, onOpenTimetable, refreshKey = 0 }: Props) {
  const s = useThemeStyleSheet(createStyles);
  const scope = usePersonalImportScope();
  const scopeKey = scope ? JSON.stringify(scope) : '';
  const currentScope = useRef(scopeKey);
  currentScope.current = scopeKey;
  const generation = useRef(0);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [selection, setSelection] = useState({ scope: '', term: '' });
  const [expandedHistory, setExpandedHistory] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date(Date.now()));
  const visible = scopeKey && snapshot?.scope === scopeKey ? snapshot : null;
  const load = useCallback(async () => {
    const run = ++generation.current;
    setNow(new Date(Date.now()));
    if (!scopeKey) return;
    setSnapshot({ scope: scopeKey, status: 'loading', records: [] });
    try {
      const current = JSON.parse(scopeKey) as { owner: string; schoolId: string };
      const [ledger, timetable] = await Promise.all([
        loadPersonalImports(current),
        loadPersonalTimetable(
          current.owner.startsWith('firebase:') ? current.owner.slice('firebase:'.length) : null,
          current.schoolId,
          current.owner.startsWith('nuni:') ? current.owner : undefined,
        ),
      ]);
      if (run === generation.current && currentScope.current === scopeKey)
        setSnapshot({
          scope: scopeKey,
          status: 'ready',
          records: personalTimetableRecords(timetable, ledger.records),
        });
    } catch {
      if (run === generation.current && currentScope.current === scopeKey)
        setSnapshot({ scope: scopeKey, status: 'error', records: [] });
    }
  }, [scopeKey]);
  useFocusEffect(
    useCallback(() => {
      void load();
      const timer = setInterval(() => setNow(new Date(Date.now())), 30_000);
      const subscription = AppState.addEventListener('change', (state) => {
        if (state === 'active') void load();
      });
      return () => {
        generation.current += 1;
        clearInterval(timer);
        subscription.remove();
      };
    }, [load, refreshKey]),
  );
  const plan = useMemo(
    () =>
      buildPersonalToday(visible?.status === 'ready' ? visible.records : [], {
        schoolId: scope?.schoolId || '',
        termKey: selection.scope === scopeKey ? selection.term : undefined,
        now,
      }),
    [visible, scope?.schoolId, scopeKey, selection, now],
  );
  const openButton = (label: string, onPress: () => void, primary = false) => (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        s.button,
        primary && s.primaryButton,
        pressed && (primary ? s.primaryPressed : s.pressed),
      ]}
    >
      <Text style={[s.buttonText, primary && s.primaryText]}>{label}</Text>
    </Pressable>
  );
  const selectedTerm = plan.terms.find((term) => term.key === plan.termKey);
  const remaining = plan.today.filter((item) => item.status !== 'ended');
  const ended = plan.today.filter((item) => item.status === 'ended');
  const historyKey = JSON.stringify([
    scopeKey,
    plan.termKey,
    now.toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' }),
  ]);
  const historyVisible = expandedHistory === historyKey;
  const renderCourse = (item: (typeof plan.today)[number]) => (
    <View
      key={item.row.id}
      style={[
        s.course,
        (item.status === 'ongoing' || item.row.id === plan.nextId) && s.currentCourse,
      ]}
    >
      <Text style={[s.time, item.status === 'ended' && s.endedTime]}>
        {item.startTime}–{item.endTime} ·{' '}
        {item.status === 'ongoing'
          ? '上課時段'
          : item.status === 'ended'
            ? '已過下課時間'
            : item.row.id === plan.nextId
              ? '下一堂'
              : '待上課'}
      </Text>
      <Text style={s.courseTitle}>{item.row.title}</Text>
      <Text style={s.detail}>
        {item.row.location || '教室未填'}
        {item.row.teacher ? ` · ${item.row.teacher}` : ''}
      </Text>
      <Text style={s.note}>
        {item.row.id.startsWith('manual:') ? '來源：自行編輯' : '來源：個人匯入'}
      </Text>
      {item.conflict ? <Text style={s.warning}>上課時間重疊，請核對課表。</Text> : null}
    </View>
  );
  return (
    <View style={s.panel} testID="today-timetable">
      <View style={s.headingRow}>
        <View style={s.headingAccent} accessibilityElementsHidden />
        <Text accessibilityRole="header" style={s.heading}>
          今天的課表
        </Text>
      </View>
      {!scopeKey ? (
        <Text style={s.detail}>正在確認帳號，暫時不顯示個人課表。</Text>
      ) : !visible || visible.status === 'loading' ? (
        <Text accessibilityLiveRegion="polite" style={s.detail}>
          正在讀取這台裝置的課表…
        </Text>
      ) : visible.status === 'error' ? (
        <>
          <Text accessibilityRole="alert" style={s.detail}>
            課表暫時讀不到，請重新讀取。這不代表今天沒有課。
          </Text>
          {openButton('重試課表', () => void load())}
        </>
      ) : plan.terms.length ? (
        <>
          <Text style={s.detail}>
            目前課表：{selectedTerm?.academicYear}／{selectedTerm?.semester} · 個人課表
          </Text>
          {plan.terms.length > 1 ? (
            <View style={s.terms}>
              {plan.terms.map((term) => (
                <Pressable
                  key={term.key}
                  accessibilityRole="button"
                  accessibilityLabel={`查看 ${term.academicYear}／${term.semester} 課表`}
                  accessibilityState={{ selected: plan.termKey === term.key }}
                  onPress={() => setSelection({ scope: scopeKey, term: term.key })}
                  style={({ pressed }) => [
                    s.term,
                    plan.termKey === term.key && s.selectedTerm,
                    pressed && s.pressed,
                  ]}
                >
                  <Text style={s.buttonText}>
                    {term.academicYear}／{term.semester}
                  </Text>
                </Pressable>
              ))}
            </View>
          ) : null}
          {plan.today.length ? (
            <>
              {remaining.map(renderCourse)}
              {!remaining.length ? <Text style={s.detail}>今天的上課時段已結束。</Text> : null}
              {ended.length ? (
                <View style={s.history}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={
                      historyVisible ? '收合已結束課程' : `查看已結束的 ${ended.length} 堂課`
                    }
                    accessibilityState={{ expanded: historyVisible }}
                    onPress={() => setExpandedHistory(historyVisible ? null : historyKey)}
                    style={({ pressed }) => [s.historyButton, pressed && s.pressed]}
                  >
                    <Text style={s.buttonText}>
                      {historyVisible ? '收合已結束課程' : `查看已結束的 ${ended.length} 堂課`}
                    </Text>
                    <Text
                      accessibilityElementsHidden
                      importantForAccessibility="no"
                      style={s.historyIndicator}
                    >
                      {historyVisible ? '−' : '+'}
                    </Text>
                  </Pressable>
                  {historyVisible ? ended.map(renderCourse) : null}
                </View>
              ) : null}
            </>
          ) : (
            <Text style={s.detail}>
              {plan.unplacedCount ? '目前沒有可確認時間的今日課程。' : '這份課表今天沒有排課。'}
            </Text>
          )}
          {plan.unplacedCount ? (
            <Text style={s.warning}>
              {plan.unplacedCount} 門課的上課時間未確認，請到匯入紀錄補齊。
            </Text>
          ) : null}
          <Text style={s.note}>
            依每週課表顯示；停課與補課請確認學校通知。個人課表尚未經學校確認，匯入資料只儲存在這台裝置。
          </Text>
          <View style={s.actions}>
            {openButton('查看整週課表', () => onOpenTimetable(plan.termKey))}
            {openButton('檢查匯入紀錄', onOpenImport)}
          </View>
        </>
      ) : (
        <>
          <Text style={s.detail}>
            匯入課表後，就能在這裡查看上課時間與教室。資料只儲存在這台裝置。
          </Text>
          <View style={s.actions}>
            {openButton('匯入我的課表', onOpenImport, true)}
            {openButton('自行編輯課表', () => onOpenTimetable())}
          </View>
        </>
      )}
    </View>
  );
}

const createStyles = () =>
  StyleSheet.create({
    panel: {
      gap: 10,
      padding: 18,
      marginVertical: 14,
      borderWidth: 1,
      borderColor: theme.colors.border,
      borderRadius: 14,
      backgroundColor: theme.colors.surface,
    },
    headingRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 3 },
    headingAccent: { width: 3, height: 19, backgroundColor: theme.colors.accent, borderRadius: 2 },
    heading: { color: theme.colors.text, fontSize: 19, lineHeight: 27, fontWeight: '600', flex: 1 },
    detail: { color: theme.colors.textSecondary, fontSize: 14, lineHeight: 22 },
    note: { color: theme.colors.muted, fontSize: 12, lineHeight: 19 },
    course: {
      paddingVertical: 14,
      paddingHorizontal: 14,
      gap: 6,
      borderLeftWidth: 2,
      borderLeftColor: theme.colors.border,
    },
    currentCourse: {
      backgroundColor: theme.colors.focusSurface,
      borderLeftColor: theme.colors.accent,
      borderTopRightRadius: 8,
      borderBottomRightRadius: 8,
    },
    time: {
      color: theme.colors.accent,
      fontSize: 13,
      lineHeight: 21,
      fontWeight: '600',
      fontVariant: ['tabular-nums'],
    },
    courseTitle: { color: theme.colors.text, fontSize: 18, fontWeight: '600', lineHeight: 26 },
    endedTime: { color: theme.colors.muted },
    history: { gap: 8, borderTopWidth: 1, borderTopColor: theme.colors.border, paddingTop: 4 },
    historyButton: {
      minHeight: 48,
      paddingHorizontal: 10,
      paddingVertical: 10,
      borderRadius: 7,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
    },
    historyIndicator: { color: theme.colors.muted, fontSize: 20 },
    warning: { color: theme.colors.danger, fontSize: 13, lineHeight: 21 },
    actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingTop: 4 },
    terms: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    term: {
      minHeight: 44,
      paddingHorizontal: 12,
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: theme.colors.border,
      borderRadius: 6,
    },
    selectedTerm: { backgroundColor: theme.colors.focusSurface, borderColor: theme.colors.accent },
    button: {
      minHeight: 48,
      justifyContent: 'center',
      paddingHorizontal: 12,
      paddingVertical: 10,
      borderRadius: 7,
      alignSelf: 'flex-start',
    },
    buttonText: { color: theme.colors.accent, fontSize: 14, lineHeight: 21, fontWeight: '600' },
    primaryButton: { backgroundColor: theme.colors.accent },
    primaryText: { color: theme.colors.onAccent },
    pressed: { backgroundColor: theme.colors.surfaceInteractive },
    primaryPressed: { backgroundColor: theme.colors.accentHover },
  });
