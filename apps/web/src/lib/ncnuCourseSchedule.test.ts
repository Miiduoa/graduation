// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { ncnuTimetableImportCsv } from '@campus/shared/src/ncnuCourseSchedule';
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
});
