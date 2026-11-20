// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { nthuTimetableImportCsv } from '@campus/shared/src/nthuCourseSchedule';
import { parsePersonalImport } from '@campus/shared/src/imports/parser';
import type { PublicCatalogCourse } from '@campus/shared/src/publicCourseCatalog';

// Actual 115-1 NTHU public course identity, room/time pair format and weekday
// mapping; no private school authentication or enrollment is implied.
const publicCourse: PublicCatalogCourse = {
  code: '11510AES 520300',
  section: '00',
  title: '環境化學',
  department: 'AES',
  teacher: '董瑞安',
  time: 'M3M4\nF3F4',
  room: 'BMES醫環618\nBMES醫環501',
  semester: '1151',
  credits: '3',
  meetings: [
    { time: 'M3M4', room: 'BMES醫環618' },
    { time: 'F3F4', room: 'BMES醫環501' },
  ],
};

describe('NTHU public course credits passed to a personal timetable', () => {
  it.each<[string, number | undefined]>([
    ['0', 0],
    ['2.5', 2.5],
    ['3.25', 3.25],
    ['40', 40],
    ['040.000', 40],
    ['0.000001', 0.000001],
    // 與 main 相容：可無損轉換的長格式等值表示仍要完整匯入。
    ['3.' + '0'.repeat(31), 3],
    ['0'.repeat(32) + '3', 3],
    ['0'.repeat(10_000), 0],
    ['', undefined],
  ])('preserves valid official credit %s as %s across both meetings', (credits, expected) => {
    const csv = nthuTimetableImportCsv({ ...publicCourse, credits });
    expect(csv).not.toBeNull();
    const parsed = parsePersonalImport(csv!, {
      kind: 'timetable', schoolId: 'nthu', academicYear: '115', semester: '1',
    });
    expect(parsed.issues.filter(issue =>
      issue.severity === 'error' || issue.code === 'unrecognized-field',
    )).toEqual([]);
    expect(parsed.rows.map(row => row.credits)).toEqual([expected, expected]);
    expect(parsed.rows.map(row => row.location)).toEqual(['BMES醫環618', 'BMES醫環501']);
  });

  it.each([
    '待確認', '3學分', '-1', '40.01', '40.0000000000000001',
    '040.0000000000000001', '0.0000001', 'NaN', 'Infinity',
    '3.5.0', ' 3', '3 ', '1' + '0'.repeat(40),
  ])('rejects invalid or lossy source credit %s before generating CSV', credits => {
    expect(nthuTimetableImportCsv({ ...publicCourse, credits })).toBeNull();
  });

  it.each([null, undefined, 3, { value: '3' }])(
    'rejects malformed cached credit %s rather than coercing its type',
    credits => {
      expect(nthuTimetableImportCsv({
        ...publicCourse,
        credits: credits as unknown as string,
      })).toBeNull();
    },
  );
});
