import { describe, expect, it } from 'vitest';
import { PERIOD_TIMES, WEEKDAY_LABELS, type PersonalCourse } from '@campus/shared';
import { coursesAtSlot, draftConflicts, hasCourseChanges, isPlacedCourse, validateCourseDraft } from './courseEditorModel';

const course: PersonalCourse = { id: 'database', name: '資料庫', day: 1, start: 3, end: 4, teacher: '林老師', room: '主顧303', color: 'gray' };
const periods = PERIOD_TIMES.length;
const days = WEEKDAY_LABELS.length;
const validate = (patch: Partial<PersonalCourse> = {}) => validateCourseDraft({ ...course, ...patch }, periods, days);

describe('course draft validation', () => {
  it('accepts a scheduled course without changing it', () => {
    const snapshot = { ...course };
    expect(validate()).toEqual({});
    expect(course).toEqual(snapshot);
  });
  it.each(['', ' ', '\t\n'])('rejects a blank course name (%j)', (name) => {
    expect(validate({ name }).name).toBeTruthy();
  });
  it('reports long names rather than silently truncating them', () => {
    expect(validate({ name: '課'.repeat(100) })).toEqual({});
    expect(validate({ name: '課'.repeat(101) }).name).toBeTruthy();
  });
  it.each([-1, days + 1, 1.5, NaN])('rejects an invalid weekday (%s)', (day) => {
    expect(validate({ day }).day).toBeTruthy();
  });
  it.each([0, -1, periods + 1, 1.5, NaN, Infinity])('rejects an invalid period (%s)', (period) => {
    expect(validate({ start: period }).start).toBeTruthy();
    expect(validate({ end: period }).end).toBeTruthy();
  });
  it('reports reversed periods before normalisation could shorten the course', () => {
    expect(validate({ start: 5, end: 3 }).end).toContain('不能早於');
  });
  it('accepts first and last periods and a single-period course', () => {
    expect(validate({ start: 1, end: periods })).toEqual({});
    expect(validate({ start: periods, end: periods })).toEqual({});
  });
  it('allows an unscheduled course but still requires its name', () => {
    expect(validate({ day: 0, start: 0, end: 0 })).toEqual({});
    expect(validate({ day: 0, name: '' }).name).toBeTruthy();
    expect(isPlacedCourse({ ...course, day: 0 }, periods, days)).toBe(false);
  });
});

describe('timetable occupancy', () => {
  it('keeps every overlapping course and includes continuation periods', () => {
    const second = { ...course, id: 'networks', name: '網路', start: 4, end: 5 };
    const input = [course, second];
    expect(coursesAtSlot(input, 1, 4, periods, days)).toEqual(input);
    expect(coursesAtSlot(input, 1, 3, periods, days)).toEqual([course]);
    expect(coursesAtSlot(input, 1, 5, periods, days)).toEqual([second]);
    expect(coursesAtSlot(input, 2, 4, periods, days)).toEqual([]);
    expect(input).toEqual([course, second]);
  });
  it('does not place invalid or unscheduled records in the grid', () => {
    const input = [{ ...course, start: 0 }, { ...course, day: 0 }, { ...course, end: periods + 1 }];
    expect(coursesAtSlot(input, 1, 3, periods, days)).toEqual([]);
  });
  it('distinguishes editing the same record from colliding with another record', () => {
    const other = { ...course, id: 'another' };
    expect(draftConflicts(course, [course, other], periods, days)).toEqual([other]);
    expect(draftConflicts({ ...course, day: 0 }, [other], periods, days)).toEqual([]);
    expect(draftConflicts({ ...course, start: 5, end: 6 }, [other], periods, days)).toEqual([]);
  });
  it.each(['name', 'day', 'start', 'end', 'teacher', 'room'] as const)('tracks unsaved %s changes', (field) => {
    const value = course[field];
    const next = { ...course, [field]: typeof value === 'number' ? value + 1 : `${value}更改` };
    expect(hasCourseChanges(course, next)).toBe(true);
    expect(hasCourseChanges(course, { ...course })).toBe(false);
  });
});
