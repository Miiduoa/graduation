import type { NextClassSnapshot } from './nextClassSnapshot';
import { nextClassState } from './nextClassSnapshot';

export type LiveClassContent = {
  key: string;
  title: string;
  location: string;
  startAt: number;
  endAt: number;
  url: string;
  mapURL: string;
  conflict: boolean;
};

/** Consume the widget's confirmed instants; never reinterpret timetable periods. */
export function liveClassContent(
  snapshot: NextClassSnapshot | null,
  now: number,
): LiveClassContent | null {
  if (!Number.isFinite(now)) return null;
  const state = nextClassState(snapshot, now);
  if (!('course' in state) || !state.course) return null;
  const course = state.course;
  if (
    !Number.isFinite(course.startAt) ||
    !Number.isFinite(course.endAt) ||
    course.endAt <= course.startAt ||
    course.startAt - now > 3_600_000
  )
    return null;
  const params = new URL(course.url).searchParams;
  const mapParams = new URLSearchParams({
    query: course.location,
    schoolId: params.get('schoolId') || '',
  });
  return {
    key: `${course.id}:${course.startAt}`,
    title: course.title.slice(0, 120),
    location: course.location.slice(0, 120),
    startAt: course.startAt,
    endAt: Math.min(course.endAt, snapshot!.expiresAt),
    url: course.url,
    mapURL: `campus://map?${mapParams}`,
    conflict: course.conflict,
  };
}
