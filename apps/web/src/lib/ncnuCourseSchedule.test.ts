// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { ncnuCourseMeetings, ncnuTimetableImportCsv } from '@campus/shared/src/ncnuCourseSchedule';
import { readImportDelimitedRecords } from '@campus/shared/src/imports/aiDelimitedText';
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
  it.each(['0', '2.5', '3.25', '40'])(
    'keeps an official %s-credit value rather than silently dropping it',
    (credits) => {
      const csv = ncnuTimetableImportCsv({ ...officialCourse, credits });
      expect(csv).not.toBeNull();
      const records = readImportDelimitedRecords(csv!, ',');
      expect(records).not.toBeNull();
      const index = records![0].cells.indexOf('credits');
      expect(index).toBeGreaterThanOrEqual(0);
      expect(records!.slice(1).map(({ cells }) => cells[index])).toEqual(
        [String(Number(credits))],
      );
    },
  );

  it('keeps a genuinely blank official credit as unknown for review', () => {
    const csv = ncnuTimetableImportCsv({ ...officialCourse, credits: '' });
    expect(csv).not.toBeNull();
    const records = readImportDelimitedRecords(csv!, ',');
    const index = records![0].cells.indexOf('credits');
    expect(records!.slice(1).map(({ cells }) => cells[index])).toEqual(['']);
  });

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
    'refuses an overlapping %s period in both preview and import',
    (time) => {
      expect(ncnuCourseMeetings(time, '1151')).toBeNull();
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
