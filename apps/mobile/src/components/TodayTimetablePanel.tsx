import React, { useCallback, useMemo, useRef, useState } from 'react';
import { AppState, Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import {
  buildPersonalToday,
  classDate,
  type PersonalImportRecord,
  type PersonalTodayEntry,
} from '@campus/shared';
import { currentTimetableTermKey } from '@campus/shared/src/todayPriority';
import { toPublicSchoolId } from '@campus/shared/src/schoolIds';
import { usePersonalImportScope } from '../state/personalImportScope';
import { loadPersonalImports } from '../services/personalImports';
import { loadPersonalTimetable, personalTimetableRecords } from '../services/personalTimetable';
import {
  currentSavedClasses,
  nextSavedClasses,
  type SavedClassOccurrence,
} from '../services/nextSavedClasses';
import { theme } from '../ui/theme';
import { useThemeStyleSheet } from '../ui/useThemeStyleSheet';

type Props = {
  onOpenImport(): void;
  onOpenTimetable(termKey?: string): void;
  refreshKey?: number;
  /**
   * Signed-in platform landing only. Receives a generic prompt for the assistant's
   * existing current/next coursework intents; it never carries a course title.
   */
  onAskCoursework?(prompt: string): void;
  /** The verified platform account that `onAskCoursework` will open the assistant for. */
  assistantAccountId?: string;
};
type Snapshot = {
  scope: string;
  status: 'loading' | 'ready' | 'error';
  records: PersonalImportRecord[];
  assistantSchoolId?: string;
};
type CourseworkAsk = { kind: 'current' | 'next'; key: string };

// The assistant's existing deterministic intents (classCourseworkQuestion → current / next).
const COURSEWORK_PROMPT = { current: '現在這堂課有什麼作業？', next: '查下一堂課的作業' } as const;
const COURSEWORK_LABEL = { current: '問 nuni 這堂課的作業', next: '問 nuni 下一堂課的作業' } as const;
const SOON_MS = 30 * 60_000;

const termOf = (row: PersonalImportRecord) => `${row.academicYear}|${row.semester}`;
const askKey = (kind: CourseworkAsk['kind'], entry: PersonalTodayEntry) =>
  JSON.stringify([
    kind,
    entry.row.id,
    termOf(entry.row),
    classDate(new Date(entry.startAt)),
    entry.startTime,
    entry.endTime,
  ]);
const sameOccurrence = (entry: PersonalTodayEntry, found: SavedClassOccurrence) =>
  found.courseId === entry.row.id &&
  found.term === termOf(entry.row) &&
  found.date === classDate(new Date(entry.startAt)) &&
  found.startTime === entry.startTime &&
  found.endTime === entry.endTime;

/**
 * A card may offer the assistant lookup only when the assistant's own current/next
 * resolver, run on the same records at the same instant, names exactly this meeting.
 * Overlaps, other terms, undated rows, or a moved clock all resolve differently and
 * therefore yield no action.
 */
function courseworkAsks(
  today: readonly PersonalTodayEntry[],
  records: PersonalImportRecord[],
  schoolId: string,
  now: Date,
): CourseworkAsk[] {
  const canonical = toPublicSchoolId(schoolId) || schoolId;
  const asks: CourseworkAsk[] = [];
  try {
    const ongoing = today.filter((entry) => entry.status === 'ongoing');
    if (ongoing.length === 1 && !ongoing[0].conflict) {
      const found = currentSavedClasses(records, canonical, now);
      if (found?.length === 1 && sameOccurrence(ongoing[0], found[0])) {
        asks.push({ kind: 'current', key: askKey('current', ongoing[0]) });
      }
    }
    const upcoming = today.find((entry) => entry.status === 'upcoming');
    if (upcoming && !upcoming.conflict && upcoming.startAt - now.getTime() <= SOON_MS) {
      const found = nextSavedClasses(records, canonical, now, undefined, SOON_MS);
      if (found?.length === 1 && sameOccurrence(upcoming, found[0])) {
        asks.push({ kind: 'next', key: askKey('next', upcoming) });
      }
    }
  } catch {
    return [];
  }
  return asks;
}

/** An imported weekly plan is useful without granting school-account access. */
export function TodayTimetablePanel({
  onOpenImport,
  onOpenTimetable,
  refreshKey = 0,
  onAskCoursework,
  assistantAccountId,
}: Props) {
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
  const [askNotice, setAskNotice] = useState('');
  const visible = scopeKey && snapshot?.scope === scopeKey ? snapshot : null;
  const load = useCallback(async () => {
    const run = ++generation.current;
    setNow(new Date(Date.now()));
    setAskNotice('');
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
      if (run === generation.current && currentScope.current === scopeKey) {
        const canonical = toPublicSchoolId(current.schoolId) || current.schoolId;
        const imported = ledger.records.filter(row => row.kind === 'timetable' && row.schoolId === current.schoolId);
        setSnapshot({
          scope: scopeKey,
          status: 'ready',
          records: personalTimetableRecords(timetable, imported),
          assistantSchoolId: toPublicSchoolId(timetable.schoolId) === canonical ? canonical : undefined,
        });
      }
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
  const selectedTermKey = selection.scope === scopeKey ? selection.term : undefined;
  const planAt = useCallback(
    (at: Date) =>
      buildPersonalToday(visible?.status === 'ready' ? visible.records : [], {
        schoolId: scope?.schoolId || '',
        termKey: selectedTermKey || currentTimetableTermKey(visible?.records ?? [], scope?.schoolId || '', at),
        now: at,
      }),
    [visible, scope?.schoolId, selectedTermKey],
  );
  const plan = useMemo(() => planAt(now), [planAt, now]);
  // Only the verified platform account that the assistant will open for may be offered the lookup.
  const askAllowed =
    !!onAskCoursework &&
    !!assistantAccountId &&
    scope?.owner === `nuni:${assistantAccountId}` &&
    visible?.status === 'ready';
  const assistantRecords = useMemo(() => {
    if (!askAllowed || !visible?.assistantSchoolId) return null;
    const canonical = visible.assistantSchoolId;
    return visible.records.map(row => row.schoolId === canonical ? row : { ...row, schoolId: canonical });
  }, [askAllowed, visible]);
  const schoolId = scope?.schoolId || '';
  const asks = useMemo(
    () => (askAllowed && assistantRecords ? courseworkAsks(plan.today, assistantRecords, schoolId, now) : []),
    [askAllowed, assistantRecords, schoolId, plan, now],
  );
  const askCoursework = (ask: CourseworkAsk) => {
    if (!askAllowed || !onAskCoursework || !assistantRecords || currentScope.current !== scopeKey) return;
    // The minute may have turned since this card was rendered; decide on the real clock.
    const at = new Date(Date.now());
    setNow(at);
    const fresh = planAt(at);
    if (!courseworkAsks(fresh.today, assistantRecords, schoolId, at).some((item) => item.kind === ask.kind && item.key === ask.key)) {
      setAskNotice('課堂時間已更新，這個詢問已不適用。請依下方最新課表再選一次。');
      return;
    }
    setAskNotice('');
    onAskCoursework(COURSEWORK_PROMPT[ask.kind]);
  };
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
      {item.status !== 'ended'
        ? asks
            .filter((ask) => ask.key === askKey(ask.kind, item))
            .map((ask) => (
              <Pressable
                key={ask.kind}
                accessibilityRole="button"
                accessibilityHint="開啟 nuni 助理並填好問題，送出時會重新核對當時的課表"
                onPress={() => askCoursework(ask)}
                style={({ pressed }) => [s.askButton, pressed && s.pressed]}
              >
                <Text style={s.buttonText}>{COURSEWORK_LABEL[ask.kind]}</Text>
              </Pressable>
            ))
        : null}
    </View>
  );
  return (
    <View style={s.panel} testID="today-timetable">
      <Text accessibilityRole="header" style={s.heading}>
        今天的課表
      </Text>
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
                  onPress={() => {
                    setAskNotice('');
                    setSelection({ scope: scopeKey, term: term.key });
                  }}
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
          {asks.length > 0 && <Text style={s.note}>送出問題時，nuni 會重新核對當時的課表。</Text>}
          {askNotice ? (
            <Text accessibilityRole="alert" style={s.warning}>
              {askNotice}
            </Text>
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
      paddingTop: 18,
      paddingBottom: 8,
      marginVertical: 10,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.colors.border,
    },
    heading: { color: theme.colors.text, fontSize: 20, lineHeight: 28, fontWeight: '600' },
    detail: { color: theme.colors.textSecondary, fontSize: 14, lineHeight: 22 },
    note: { color: theme.colors.muted, fontSize: 12, lineHeight: 19 },
    course: {
      paddingVertical: 14,
      paddingLeft: 14,
      gap: 4,
      borderLeftWidth: StyleSheet.hairlineWidth,
      borderLeftColor: theme.colors.border,
    },
    currentCourse: {
      borderLeftWidth: 2,
      paddingLeft: 12,
      borderLeftColor: theme.colors.accent,
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
    askButton: {
      minHeight: 48,
      justifyContent: 'center',
      paddingHorizontal: 4,
      alignSelf: 'flex-start',
    },
    buttonText: { color: theme.colors.accent, fontSize: 14, lineHeight: 21, fontWeight: '600' },
    primaryButton: { backgroundColor: theme.colors.accent },
    primaryText: { color: theme.colors.onAccent },
    pressed: { backgroundColor: theme.colors.surfaceInteractive },
    primaryPressed: { backgroundColor: theme.colors.accentHover },
  });
