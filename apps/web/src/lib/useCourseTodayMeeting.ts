'use client';

import { useMemo } from 'react';
import { buildPersonalToday, type PersonalImportRecord } from '@campus/shared';
import { usePersonalTodayRecords } from '@/lib/usePersonalTodayRecords';
import type { CourseMeetingInput } from '@/lib/attendanceMissingNotice';

/**
 * 只以可靠的 linkedCourseId 對應本堂；沒有 linkedCourseId 時視為未連結，
 * 不用課名比對，避免同名兩課誤對。
 */
export function resolveCourseTodayMeeting(input: {
  rows: readonly PersonalImportRecord[];
  schoolId: string;
  courseId: string;
  now: Date;
}): CourseMeetingInput {
  if (!Number.isFinite(input.now.getTime())) return { status: 'error' };
  try {
    const { today } = buildPersonalToday(input.rows, {
      schoolId: input.schoolId,
      now: input.now,
    });
    const matched = today.find((entry) => {
      const linked = entry.row.linkedCourseId?.trim();
      return Boolean(linked && linked === input.courseId);
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
}

/** 從個人今日課表對應某門課的本堂起迄；對不到或讀取失敗時回傳 unlinked／error。 */
export function useCourseTodayMeeting(
  courseId: string,
  _courseName: string,
  now: Date | null = null,
): CourseMeetingInput {
  const { loaded, error, manual, imported, schoolId } = usePersonalTodayRecords();
  return useMemo(() => {
    if (!loaded) return { status: 'loading' };
    if (error && !manual && imported.records.length === 0) return { status: 'error' };
    const clock = now ?? new Date();
    return resolveCourseTodayMeeting({
      rows: [...(manual ?? []), ...imported.records],
      schoolId,
      courseId,
      now: clock,
    });
  }, [loaded, error, manual, imported.records, schoolId, courseId, now]);
}
