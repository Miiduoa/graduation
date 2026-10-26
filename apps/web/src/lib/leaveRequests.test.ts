import { describe, expect, it } from 'vitest';
import { FunctionsUnconfiguredError } from '@/lib/functionsUrl';
import { LEAVE_COPY } from './leavePageState';
import {
  countLeaveReviews, formatLeaveRange, leaveKindLabel, leaveRequestError,
  shiftLeaveDay, suggestedLeaveCourses, taipeiToday, validLeaveDates,
  type LeaveCourse,
} from './leaveRequests';
import type { PersonalCourse } from '@campus/shared';

function course(id: string, day: number): PersonalCourse {
  return {
    id, day, name: id, teacher: '授課教師', room: '', color: 'blue',
    start: day ? 2 : 0, end: day ? 3 : 0,
  };
}

describe('leave date and course suggestions', () => {
  it('validates exact Gregorian dates and limits each request to 31 days', () => {
    expect(validLeaveDates('2026-10-26', '2026-10-26')).toBe(true);
    expect(validLeaveDates('2026-02-30', '2026-03-01')).toBe(false);
    expect(validLeaveDates('2026-10-27', '2026-10-26')).toBe(false);
    expect(validLeaveDates('2026-10-26', '2026-11-26')).toBe(false);
    expect(validLeaveDates('2026-10-26', '2026-11-25')).toBe(true);
  });
  it('shifts across month and leap day using dates without timezone drift', () => {
    expect(shiftLeaveDay('2028-02-28', 1)).toBe('2028-02-29');
    expect(shiftLeaveDay('2028-02-29', 1)).toBe('2028-03-01');
    expect(shiftLeaveDay('2026-10-31', 1)).toBe('2026-11-01');
  });
  it('selects weekdays from the chosen range but excludes unscheduled courses', () => {
    const courses = [
      course('monday', 1), course('tuesday', 2), course('friday', 5), course('unscheduled', 0),
    ];
    expect(suggestedLeaveCourses(courses, '2026-10-26', '2026-10-26').map((c) => c.id)).toEqual(['monday']);
    expect(suggestedLeaveCourses(courses, '2026-10-26', '2026-10-27').map((c) => c.id)).toEqual(['monday', 'tuesday']);
    expect(suggestedLeaveCourses(courses, '2026-10-25', '2026-10-25')).toEqual([]);
    expect(suggestedLeaveCourses(courses, 'invalid', '2026-10-26')).toEqual([]);
  });
  it('separates morning from afternoon for an identified school schedule', () => {
    const courses = [
      { ...course('early', 1), start: 1, end: 2 },
      { ...course('late', 1), start: 10, end: 11 },
    ];
    expect(suggestedLeaveCourses(courses, '2026-10-26', '2026-10-26', 'morning', 'pu').map((c) => c.id)).toEqual(['early']);
    expect(suggestedLeaveCourses(courses, '2026-10-26', '2026-10-26', 'afternoon', 'pu').map((c) => c.id)).toEqual(['late']);
    expect(suggestedLeaveCourses(courses, '2026-10-26', '2026-10-26', 'afternoon', 'unknown-school')).toHaveLength(2);
  });
  it('formats Taiwanese today independently of the caller machine timezone', () => {
    expect(taipeiToday(new Date('2026-10-25T16:30:00Z'))).toBe('2026-10-26');
  });
});

describe('leave status summaries', () => {
  const rows = [
    { courseId: 'a', reviewStatus: 'approved' },
    { courseId: 'b', reviewStatus: 'rejected' },
    { courseId: 'c', reviewStatus: 'pending' },
  ] as LeaveCourse[];
  it('reports separate approvals and rejections rather than treating the whole request as approved', () => {
    expect(countLeaveReviews(rows)).toEqual({ total: 3, approved: 1, rejected: 1, pending: 1 });
  });
  it('uses concise dates and school-neutral leave kind copy', () => {
    expect(formatLeaveRange('2026-10-26', '2026-10-26')).toBe('10/26');
    expect(formatLeaveRange('2026-10-26', '2026-10-27')).toBe('10/26－10/27');
    expect(leaveKindLabel('sick')).toBe('病假');
  });
});

describe('leave mutation errors', () => {
  it('does not describe an unconfigured backend as a network failure', () => {
    expect(leaveRequestError(new FunctionsUnconfiguredError('請假服務尚未接通'))).toBe(
      LEAVE_COPY.unavailableSubmit,
    );
    expect(leaveRequestError({ code: 'functions/not-found' })).toBe(LEAVE_COPY.unavailableSubmit);
    expect(leaveRequestError(new FunctionsUnconfiguredError('請假服務尚未接通'))).not.toContain(
      '連線',
    );
  });

  it('asks the user to log in or reports missing permission instead of blaming the network', () => {
    expect(leaveRequestError({ code: 'functions/unauthenticated' })).toBe(LEAVE_COPY.unauthorized);
    expect(leaveRequestError({ code: 'functions/permission-denied' })).toBe(
      '目前沒有這所學校或這門課的操作權限。',
    );
  });

  it('mentions the network only for network-layer failures', () => {
    expect(leaveRequestError(new TypeError('Failed to fetch'))).toBe(LEAVE_COPY.network);
  });
});
