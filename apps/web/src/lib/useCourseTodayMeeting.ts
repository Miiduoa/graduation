'use client';

import { useMemo } from 'react';
import { buildPersonalToday } from '@campus/shared';
import { usePersonalTodayRecords } from '@/lib/usePersonalTodayRecords';
import type { CourseMeetingInput } from '@/lib/attendanceMissingNotice';

/** 從個人今日課表對應某門課的本堂起迄；對不到或讀取失敗時回傳 unlinked／error。 */
export function useCourseTodayMeeting(
  courseId: string,
  courseName: string,
  now: Date | null = null,
): CourseMeetingInput {
  const { loaded, error, manual, imported, schoolId } = usePersonalTodayRecords();
  return useMemo(() => {
    if (!loaded) return { status: 'loading' };
    if (error && !manual && imported.records.length === 0) return { status: 'error' };
    const clock = now ?? new Date();
    if (!Number.isFinite(clock.getTime())) return { status: 'error' };
    try {
      const rows = [...(manual ?? []), ...imported.records];
      const { today } = buildPersonalToday(rows, { schoolId, now: clock });
      const matched = today.find((entry) => {
        const linked = entry.row.linkedCourseId?.trim();
        if (linked && linked === courseId) return true;
        return entry.row.title.trim() === courseName.trim();
      });
      if (!matched) return { status: 'unlinked' };
      return {
        status: 'ready',
        startAt: new Date(matched.startAt).toISOString(),
        endAt: new Date(matched.endAt).toISOString(),
      };
    } catch {
      return { status: 'error' };
    }
  }, [loaded, error, manual, imported.records, schoolId, courseId, courseName, now]);
}
