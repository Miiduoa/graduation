'use client';

import { useCallback, useEffect, useState } from 'react';
import { withClassExceptions, type ClassException, type PersonalImportRecord } from '@campus/shared';
import { usePersonalImportScope, usePersonalImports } from '@/lib/usePersonalImports';
import { useAuth } from '@/components/AuthGuard';
import { loadPersonalTimetable, type StoredTimetable } from '@/lib/timetable/store';

function manualRecords(timetable: StoredTimetable): PersonalImportRecord[] {
  return timetable.courses.map((course) => ({
    id: `manual:${course.id}`,
    kind: 'timetable',
    title: course.name,
    schoolId: timetable.schoolId,
    academicYear: timetable.meta.year || '未填',
    semester: timetable.meta.semester || '未填',
    dayOfWeek: course.day,
    startPeriod: course.start,
    endPeriod: course.end,
    teacher: course.teacher,
    location: course.room,
    batchId: 'manual',
    importedAt: timetable.updatedAt,
    source: { type: 'paste', line: 0, rawText: '' },
  }));
}

export function usePersonalTodayRecords() {
  const context = usePersonalImportScope();
  const { user } = useAuth();
  const imported = usePersonalImports(context.scope, !context.loading);
  const [manualState, setManualState] = useState<{
    key: string;
    records: PersonalImportRecord[] | null;
    exceptions?: ClassException[];
    error: string;
  } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const { owner, schoolId } = context.scope;
  const uid = user?.uid ?? null;
  const scopeKey = JSON.stringify([owner, schoolId, uid]);
  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  useEffect(() => {
    if (context.loading) return;
    let active = true;
    let generation = 0;
    const refresh = async () => {
      const request = ++generation;
      try {
        const data = await loadPersonalTimetable(uid, schoolId, owner);
        if (active && request === generation) {
          setManualState({ key: scopeKey, records: withClassExceptions(manualRecords(data), data.classExceptions), exceptions: data.classExceptions, error: '' });
        }
      } catch {
        if (active && request === generation) {
          setManualState({
            key: scopeKey,
            records: null,
            error: '手動課表暫時讀不到，請保留瀏覽器資料後重試。',
          });
        }
      }
    };
    const visible = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    void refresh();
    window.addEventListener('focus', visible);
    window.addEventListener('storage', visible);
    document.addEventListener('visibilitychange', visible);
    return () => {
      active = false;
      window.removeEventListener('focus', visible);
      window.removeEventListener('storage', visible);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [uid, owner, schoolId, scopeKey, context.loading, attempt]);
  const visible = !context.loading && manualState?.key === scopeKey ? manualState : null;
  const manual = visible?.records ?? null;
  const loaded = !imported.loading && visible !== null;
  const error = imported.error || visible?.error || '';
  return { context, imported: { ...imported, records: withClassExceptions(imported.records, visible?.exceptions) }, manual, retry, loaded, error, schoolId, scopeKey };
}
