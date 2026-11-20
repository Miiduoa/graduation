import { describe, expect, it } from 'vitest';
import { cleanCourse, PERIOD_TIMES, WEEKDAY_LABELS } from '@campus/shared';
import { moveCourseToSlot, planningReadiness } from './timetableMovement';

const periods = PERIOD_TIMES.length;
const days = WEEKDAY_LABELS.length;
const course = cleanCourse({ id: 'database', name: '資料庫', day: 1, start: 3, end: 5, teacher: '林老師', room: '主顧303' });

describe('course movement', () => {
  it('preserves identity, metadata and the entire duration without mutating the original', () => {
    const before = { ...course };
    const result = moveCourseToSlot(course, 2, 6, periods, days);
    expect(result).toEqual({ ok: true, changed: true, course: { ...course, day: 2, start: 6, end: 8 } });
    expect(course).toEqual(before);
  });
  it('allows a course to end exactly at the final period', () => {
    expect(moveCourseToSlot(course, 5, periods - 2, periods, days)).toMatchObject({ ok: true, course: { end: periods } });
  });
  it('never clips a course at the final period', () => {
    expect(moveCourseToSlot(course, 2, periods - 1, periods, days)).toMatchObject({ ok: false, message: expect.stringContaining('放不下') });
  });
  it.each([[0, 1], [6, 1], [1.5, 1], [NaN, 1], [1, 0], [1, -1], [1, 1.5], [1, Infinity]])('rejects invalid destination %s / %s', (day, start) => {
    expect(moveCourseToSlot(course, day, start, periods, days).ok).toBe(false);
  });
  it('marks a drop on the original start as unchanged', () => {
    expect(moveCourseToSlot(course, 1, 3, periods, days)).toMatchObject({ ok: true, changed: false });
  });
  it('requires a valid original duration', () => {
    expect(moveCourseToSlot({ ...course, start: 0 }, 2, 3, periods, days).ok).toBe(false);
  });
});

describe('planning readiness', () => {
  it('does not interpret an empty timetable as availability', () => {
    expect(planningReadiness([], periods, days)).toMatchObject({ ready: false, message: expect.stringContaining('空白課表') });
  });
  it.each([{ day: 0 }, { day: 6 }, { start: 0 }, { end: periods + 1 }, { start: 6, end: 3 }, { day: 1.5 }])('blocks incomplete course data %j', (invalid) => {
    expect(planningReadiness([course, { ...course, id: 'pending', ...invalid }], periods, days)).toMatchObject({ ready: false, message: expect.stringContaining('1 門課') });
  });
  it('permits complete schedules, including known overlaps', () => {
    expect(planningReadiness([course, { ...course, id: 'overlap' }], periods, days)).toEqual({ ready: true, message: '' });
  });
});
