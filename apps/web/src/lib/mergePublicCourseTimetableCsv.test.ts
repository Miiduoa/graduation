// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { parsePersonalImport } from '@campus/shared/src/imports/parser';
import { ncnuTimetableImportCsv } from '@campus/shared/src/ncnuCourseSchedule';
import type { PublicCatalogCourse } from '@campus/shared/src/publicCourseCatalog';
import {
  MAX_PUBLIC_COURSE_BULK_SELECTION,
  mergePublicCourseTimetableCsv,
} from '@campus/shared/src/mergePublicCourseTimetableCsv';

const ncnu: PublicCatalogCourse = {
  semester: '1151', code: '005076', section: 'a', title: '專業實習（一）',
  teacher: '李,老師', department: '諮人系', room: 'A307', time: '5bcd', credits: '3.0',
};
const nthu: PublicCatalogCourse = {
  semester: '1151', code: '11510AES 520300', section: '00', title: '環境化學',
  department: 'AES', teacher: '董瑞安', credits: '3',
  time: 'M3M4\nF3F4', room: 'R1\nR2',
  meetings: [{ time: 'M3M4', room: 'R1' }, { time: 'F3F4', room: 'R2' }],
};

describe('multi-course public timetable review', () => {
  it('combines separate NCNU courses with all periods and quoted cells intact', () => {
    const csv = mergePublicCourseTimetableCsv('ncnu', [
      ncnu,
      { ...ncnu, code: '130021', section: 'b', time: '3cd4i', title: '資料結構' },
    ]);
    expect(csv).not.toBeNull();
    const parsed = parsePersonalImport(csv!, {
      kind: 'timetable', schoolId: 'ncnu', academicYear: '115', semester: '1',
      source: { type: 'paste', name: '暨南大學官方公開課程' },
    });
    expect(parsed.issues.filter(issue => issue.severity === 'error')).toEqual([]);
    expect(parsed.rows).toHaveLength(3);
    expect(parsed.rows.map(row => row.dayOfWeek)).toEqual([5, 3, 4]);
    expect(parsed.rows.map(row => row.courseCode)).toEqual(['005076', '130021', '130021']);
    expect(parsed.rows[0].teacher).toBe('李,老師');
    expect(parsed.rows.every(row => row.schoolId === 'ncnu' && row.semester === '1')).toBe(true);
  });

  it('keeps both NTHU classroom pairs when combining different class sections', () => {
    const csv = mergePublicCourseTimetableCsv('nthu', [
      nthu,
      { ...nthu, code: '11510AES 520301', section: '01',
        time: 'W3W4', room: 'R3', meetings: [{ time: 'W3W4', room: 'R3' }] },
    ]);
    expect(csv).not.toBeNull();
    const parsed = parsePersonalImport(csv!, {
      kind: 'timetable', schoolId: 'nthu', academicYear: '115', semester: '1',
      source: { type: 'paste', name: '清華大學官方公開課程' },
    });
    expect(parsed.issues.filter(issue => issue.severity === 'error')).toEqual([]);
    expect(parsed.rows).toHaveLength(3);
    expect(parsed.rows.map(row => row.location)).toEqual(['R1', 'R2', 'R3']);
    expect(parsed.rows.map(row => row.className)).toEqual(['00', '00', '01']);
  });

  it('fails the entire batch on mixed terms, duplicate listings or unsafe credit/time', () => {
    const valid = { ...ncnu, code: '130021', section: 'b', time: '3cd' };
    expect(mergePublicCourseTimetableCsv('ncnu', [ncnu, { ...valid, semester: '1152' }])).toBeNull();
    expect(mergePublicCourseTimetableCsv('ncnu', [ncnu, { ...ncnu, title: '重複的公告' }])).toBeNull();
    expect(mergePublicCourseTimetableCsv('ncnu', [ncnu, { ...valid, credits: '40.0000000000000001' }])).toBeNull();
    expect(mergePublicCourseTimetableCsv('ncnu', [ncnu, { ...valid, time: '3cc' }])).toBeNull();
    expect(mergePublicCourseTimetableCsv('nthu', [nthu, ncnu])).toBeNull();
  });

  it('requires credits for a batch while allowing blank credits in the single-course CSV', () => {
    const missingCredits = { ...ncnu, code: '130021', credits: '' };
    expect(ncnuTimetableImportCsv(missingCredits)).not.toBeNull();
    expect(mergePublicCourseTimetableCsv('ncnu', [ncnu, missingCredits])).toBeNull();
    expect(mergePublicCourseTimetableCsv('ncnu', [ncnu, { ...missingCredits, credits: '0' }])).not.toBeNull();
  });

  it('rejects duplicate NCNU class listings using the import parser’s normalization', () => {
    expect(mergePublicCourseTimetableCsv('ncnu', [
      ncnu, { ...ncnu, code: ' 005076 ', title: '同一門課的重複公告' },
    ])).toBeNull();
    expect(mergePublicCourseTimetableCsv('ncnu', [
      ncnu, { ...ncnu, section: ' a ', title: '同班別的重複公告' },
    ])).toBeNull();
    expect(mergePublicCourseTimetableCsv('ncnu', [
      ncnu, { ...ncnu, section: 'ａ' },
    ])).toBeNull();
    // A genuinely different section is still a distinct course selection.
    expect(mergePublicCourseTimetableCsv('ncnu', [
      ncnu, { ...ncnu, section: 'b' },
    ])).not.toBeNull();
  });

  it('requires two through ten selected courses and never truncates the eleventh', () => {
    expect(mergePublicCourseTimetableCsv('ncnu', [])).toBeNull();
    expect(mergePublicCourseTimetableCsv('ncnu', [ncnu])).toBeNull();
    const courses = Array.from({ length: MAX_PUBLIC_COURSE_BULK_SELECTION }, (_, index) =>
      ({ ...ncnu, code: String(index + 1).padStart(6, '0') }));
    expect(mergePublicCourseTimetableCsv('ncnu', courses)).not.toBeNull();
    expect(mergePublicCourseTimetableCsv('ncnu', [...courses, { ...ncnu, code: '999999' }])).toBeNull();
  });
});
