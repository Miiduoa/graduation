import { describe, expect, it } from 'vitest';
import type { PersonalImportRecord } from '@campus/shared';
import { resolveCourseTodayMeeting } from './useCourseTodayMeeting';

/** 2026-05-15 為週五 → dayOfWeek 5 */
const FRIDAY = new Date('2026-05-15T10:00:00+08:00');

const row = (overrides: Partial<PersonalImportRecord> = {}): PersonalImportRecord => ({
  id: 'row-1',
  kind: 'timetable',
  title: '資料結構',
  schoolId: 'pu',
  academicYear: '114',
  semester: '2',
  dayOfWeek: 5,
  startTime: '09:00',
  endTime: '12:00',
  source: { type: 'paste', line: 1, rawText: '' },
  batchId: 'batch',
  importedAt: '2026-05-01T12:00:00Z',
  ...overrides,
});

describe('resolveCourseTodayMeeting', () => {
  it('有可靠 linkedCourseId 時回傳本堂起迄', () => {
    const result = resolveCourseTodayMeeting({
      rows: [row({ linkedCourseId: 'course-a' })],
      schoolId: 'pu',
      courseId: 'course-a',
      now: FRIDAY,
    });
    expect(result.status).toBe('ready');
    if (result.status === 'ready') {
      expect(new Date(result.startAt).getTime()).toBeLessThan(FRIDAY.getTime());
      expect(new Date(result.endAt).getTime()).toBeGreaterThan(FRIDAY.getTime());
    }
  });

  it('同名兩課只連結其中一門：只對到 linkedCourseId，不靠課名', () => {
    const rows = [
      row({
        id: 'linked',
        title: '資料結構',
        linkedCourseId: 'course-linked',
        startTime: '09:00',
        endTime: '10:00',
      }),
      row({
        id: 'name-only',
        title: '資料結構',
        linkedCourseId: undefined,
        startTime: '14:00',
        endTime: '16:00',
      }),
    ];
    const forLinked = resolveCourseTodayMeeting({
      rows,
      schoolId: 'pu',
      courseId: 'course-linked',
      now: FRIDAY,
    });
    expect(forLinked.status).toBe('ready');
    if (forLinked.status === 'ready') {
      expect(new Date(forLinked.startAt).getUTCHours()).toBe(1); // 09:00+08 → 01:00Z
    }

    const forOtherSameName = resolveCourseTodayMeeting({
      rows,
      schoolId: 'pu',
      courseId: 'course-other',
      now: FRIDAY,
    });
    expect(forOtherSameName.status).toBe('unlinked');
  });

  it('沒有 linkedCourseId 即使課名相同 → unlinked', () => {
    const result = resolveCourseTodayMeeting({
      rows: [row({ title: '資料結構', linkedCourseId: undefined })],
      schoolId: 'pu',
      courseId: 'course-a',
      now: FRIDAY,
    });
    expect(result.status).toBe('unlinked');
  });

  it('當天沒有這門課 → unlinked', () => {
    const result = resolveCourseTodayMeeting({
      rows: [row({ dayOfWeek: 1, linkedCourseId: 'course-a' })],
      schoolId: 'pu',
      courseId: 'course-a',
      now: FRIDAY,
    });
    expect(result.status).toBe('unlinked');
  });
});
