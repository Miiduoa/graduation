import { useCallback, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { buildPersonalToday, type PersonalImportRecord } from '@campus/shared';
import { type TodayClass } from '@campus/shared/src/pickNextAction';
import { usePersonalImportScope } from '../state/personalImportScope';
import { loadPersonalImports } from '../services/personalImports';
import { loadPersonalTimetable, personalTimetableRecords } from '../services/personalTimetable';

export type TodayTimetableStatus = 'loading' | 'ready' | 'error' | 'empty';

type Snapshot = {
  scope: string;
  status: 'loading' | 'ready' | 'error';
  records: PersonalImportRecord[];
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
        ? previous
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
      const subscription = AppState.addEventListener('change', (state) => {
        if (state === 'active') void load();
      });
      return () => {
        generation.current += 1;
        subscription.remove();
      };
    }, [load]),
  );
  const plan = useMemo(
    () =>
      buildPersonalToday(visible?.status === 'ready' ? visible.records : [], {
        schoolId: scope?.schoolId || '',
        now,
      }),
    [visible, scope?.schoolId, now],
  );
  const classes: TodayClass[] = useMemo(
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
          },
        ];
      }),
    [plan.today, now],
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
  return { status, classes, termKey: plan.termKey, retry: load };
}
