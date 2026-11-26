import { useCallback, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { buildPersonalToday, type PersonalImportRecord } from '@campus/shared';
import { currentTimetableTermKey } from '@campus/shared/src/todayPriority';
import { type TodayClass } from '@campus/shared/src/pickNextAction';
import { subscribeTodayTimetableSources } from './subscribeTodayTimetableSources';
import { usePersonalImportScope } from '../state/personalImportScope';
import { loadPersonalImports } from '../services/personalImports';
import { loadPersonalTimetable, scopedPersonalTimetableRecords } from '../services/personalTimetable';
import {
  resolveTimetableClassroomNav,
  type TimetableClassroomDestination,
} from './timetableClassroomNav';

export type TodayTimetableStatus = 'loading' | 'ready' | 'error' | 'empty';

export type TodayTimetableClass = TodayClass & {
  courseCode?: string;
  courseWorkNav: TimetableClassroomDestination;
};

type Snapshot = {
  scope: string;
  status: 'loading' | 'ready' | 'error';
  records: PersonalImportRecord[];
  refreshing?: boolean;
};

export function useTodayTimetableData(now: Date) {
  const scope = usePersonalImportScope();
  const scopeKey = scope ? JSON.stringify(scope) : '';
  const currentScope = useRef(scopeKey);
  currentScope.current = scopeKey;
  const generation = useRef(0);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const visible = scopeKey && snapshot?.scope === scopeKey ? snapshot : null;
  const load = useCallback(async () => {
    const run = ++generation.current;
    if (!scopeKey) return;
    setSnapshot((previous) =>
      previous?.scope === scopeKey && previous.status === 'ready'
        ? { ...previous, refreshing: true }
        : { scope: scopeKey, status: 'loading', records: [] },
    );
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
          records: scopedPersonalTimetableRecords(timetable, ledger.records, current.schoolId),
        });
    } catch {
      if (run === generation.current && currentScope.current === scopeKey)
        setSnapshot({ scope: scopeKey, status: 'error', records: [] });
    }
  }, [scopeKey]);
  useFocusEffect(
    useCallback(() => {
      void load();
      const unsubscribe = scopeKey ? subscribeTodayTimetableSources(JSON.parse(scopeKey), load) : undefined;
      const subscription = AppState.addEventListener('change', (state) => {
        if (state === 'active') void load();
      });
      return () => {
        generation.current += 1;
        subscription.remove();
        unsubscribe?.();
      };
    }, [load, scopeKey]),
  );
  const plan = useMemo(() => {
    const records = visible?.status === 'ready' ? visible.records : [];
    const schoolId = scope?.schoolId || '';
    return buildPersonalToday(records, { schoolId, now, termKey: currentTimetableTermKey(records, schoolId, now) });
  }, [visible, scope?.schoolId, now]);
  const classes: TodayTimetableClass[] = useMemo(
    () =>
      plan.today.flatMap((entry) => {
        const { startAt, endAt } = entry;
        return [
          {
            id: entry.row.id,
            title: entry.row.title,
            location: entry.row.location?.trim() || '',
            startAt,
            endAt,
            courseId: entry.row.linkedCourseId,
            courseCode: entry.row.courseCode,
            courseWorkNav: resolveTimetableClassroomNav({
              linkedCourseId: entry.row.linkedCourseId,
              courseName: entry.row.title,
              courseCode: entry.row.courseCode,
            }),
          },
        ];
      }),
    [plan.today],
  );
  const status: TodayTimetableStatus = !scopeKey
    ? 'loading'
    : !visible || visible.status === 'loading'
      ? 'loading'
      : visible.status === 'error'
        ? 'error'
        : plan.terms.length === 0
          ? 'empty'
          : 'ready';
  const personalSchedule = scope && visible?.status === 'ready' && !visible.refreshing
    ? { scope, records: visible.records }
    : null;
  return { status, refreshing: visible?.refreshing === true, classes, scope, termKey: plan.termKey, retry: load, personalSchedule };
}
