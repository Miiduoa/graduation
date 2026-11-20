// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { ncnuCourseMeetings, ncnuTimetableImportCsv } from '@campus/shared/src/ncnuCourseSchedule';
import { parsePersonalImport } from '@campus/shared/src/imports/parser';
import type { PublicCatalogCourse } from '@campus/shared/src/publicCourseCatalog';

const officialCourse: PublicCatalogCourse = {
  code: '005076',
  section: '01',
  title: '資料庫管理',
  department: '資訊管理學系',
  teacher: '王老師',
  time: '3abc',
  room: '教學大樓 101',
  semester: '1151',
  credits: '3',
};

describe('NCNU public course to personal timetable credit handoff', () => {
  it.each<[string, number | undefined]>([
    ['0', 0],
    ['2.5', 2.5],
    ['3.25', 3.25],
    ['40', 40],
    ['040.000', 40],
    ['0.000001', 0.000001],
    ['', undefined],
  ])(
    'round-trips official credit text "%s" as %s',
    (credits, expected) => {
      const csv = ncnuTimetableImportCsv({ ...officialCourse, credits });
      expect(csv).not.toBeNull();
      const parsed = parsePersonalImport(csv!, {
        kind: 'timetable', schoolId: 'ncnu', academicYear: '115', semester: '1',
      });
      expect(parsed.issues.filter(issue =>
        issue.severity === 'error' || issue.code === 'unrecognized-field',
      )).toEqual([]);
      expect(parsed.rows.map(row => row.credits)).toEqual([expected]);
    },
  );

  it.each(['40.0000000000000001', '040.0000000000000001', '0.0000001'])(
    'refuses official credit %s before generating an import CSV',
    (credits) => {
      expect(ncnuTimetableImportCsv({ ...officialCourse, credits })).toBeNull();
    },
  );

  it.each(['待確認', '3學分', '-1', '40.01', 'NaN', 'Infinity', '3.5.0', ' 3'])(
    'refuses unverified NCNU credit %s instead of importing a false blank',
    (credits) => {
      expect(ncnuTimetableImportCsv({ ...officialCourse, credits })).toBeNull();
    },
  );

  it('rejects an overlong but syntactically valid course time before expanding rows', () => {
    const time = '1a'.repeat(1_200);
    expect(ncnuCourseMeetings(time, '1151')).toBeNull();
    expect(ncnuTimetableImportCsv({ ...officialCourse, time })).toBeNull();
  });

  it.each([null, undefined, 3, { day: '1a' }])(
    'refuses a malformed cached period value %s without crashing the student screen',
    (time) => {
      expect(ncnuCourseMeetings(time as unknown as string, '1151')).toBeNull();
      expect(ncnuTimetableImportCsv({ ...officialCourse, time: time as unknown as string })).toBeNull();
    },
  );

  it('accepts a full week of distinct periods without cutting off a valid schedule', () => {
    const week = 'xyabcdzefghijklm';
    const time = '1234567'.split('').map(day => day + week).join('');
    const meetings = ncnuCourseMeetings(time, '1151');
    expect(meetings).not.toBeNull();
    expect(meetings?.every(meeting => meeting.startTime && meeting.endTime)).toBe(true);
    expect(ncnuTimetableImportCsv({ ...officialCourse, time })).not.toBeNull();
  });

  it.each(['1ab1b', '3a3a', '1abc2def1c'])(
    'shows overlapping %s periods for manual review but refuses import',
    (time) => {
      expect(ncnuCourseMeetings(time, '1151')).not.toBeNull();
      expect(ncnuTimetableImportCsv({ ...officialCourse, time })).toBeNull();
    },
  );

  it('preserves distinct weekday segments when there is no overlapping period', () => {
    const time = '1ab1d2ef';
    expect(ncnuCourseMeetings(time, '1151')?.map(meeting => meeting.periodLabel)).toEqual(
      ['ab', 'd', 'ef'],
    );
    expect(ncnuTimetableImportCsv({ ...officialCourse, time })).not.toBeNull();
  });

  it.each([null, undefined, 3, { value: '3' }])(
    'rejects a non-string cached credit value %s rather than treating it as valid',
    (credits) => {
      expect(ncnuTimetableImportCsv({
        ...officialCourse,
        credits: credits as unknown as string,
      })).toBeNull();
    },
  );

  it('rejects an oversized numeric credit string before attempting numeric conversion', () => {
    expect(ncnuTimetableImportCsv({ ...officialCourse, credits: '0'.repeat(10_000) })).toBeNull();
  });
});
