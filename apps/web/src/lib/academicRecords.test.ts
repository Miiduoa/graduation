import { describe, expect, it } from 'vitest';
import {
  AcademicRecordError,
  calculateGradeSummary,
  findScheduleConflicts,
  formatSemester,
  normalizeCourseRecords,
  normalizeGradeRecords,
} from './academicRecords';

const course = (values: Record<string, unknown> = {}) => ({
  code: 'IM201',
  name: '資料庫',
  nameEn: 'Database',
  classOffered: '資管二A',
  courseType: '必修',
  credits: 3,
  dayOfWeek: 2,
  periods: [3, 4],
  startTime: '10:10',
  endTime: '12:00',
  location: 'PH303',
  timePlaceRaw: '二(Tue) 3, 4:PH303',
  teacherName: '王老師',
  teacherEmail: '',
  ...values,
});
const courseResponse = (courses: unknown[], values: Record<string, unknown> = {}) => ({
  success: true,
  courses,
  semester: '1151',
  totalCredits: 3,
  studentInfo: { class: '資管二A', studentId: '412345678', name: '林同學' },
  ...values,
});
const grade = (values: Record<string, unknown> = {}) => ({
  semester: '1142',
  courseName: '資料庫',
  courseNameEn: 'Database',
  class: '資管二A',
  courseType: '必修',
  credits: 3,
  score: 80,
  ...values,
});
const gradeResponse = (grades: unknown[], values: Record<string, unknown> = {}) => ({
  success: true,
  grades,
  allSemesters: ['1142'],
  summary: {},
  ...values,
});

describe('academic record boundaries', () => {
  it('never converts a failed request or malformed payload into an empty success', () => {
    for (const input of [
      null,
      [],
      {},
      { success: false, courses: [] },
      { success: true },
      { success: true, courses: '[]' },
      courseResponse([null]),
      courseResponse([course({ credits: '3' })]),
    ]) {
      expect(() => normalizeCourseRecords(input)).toThrow(AcademicRecordError);
    }
    expect(() =>
      normalizeCourseRecords({ success: false, error: '請重新登入', courses: [] }),
    ).toThrow('請重新登入');
    expect(() => normalizeCourseRecords(courseResponse([], { error: '來源失敗' }))).toThrow(
      '來源失敗',
    );
    for (const input of [
      { success: true },
      gradeResponse('bad' as unknown as unknown[]),
      gradeResponse([grade({ score: null })]),
      gradeResponse([grade({ score: NaN })]),
      gradeResponse([grade({ credits: -1 })]),
      gradeResponse([grade({ semester: '' })]),
      gradeResponse([], { allSemesters: [1142] }),
    ]) {
      expect(() => normalizeGradeRecords(input)).toThrow(AcademicRecordError);
    }
  });

  it('accepts an explicit successful empty result without inventing a semester', () => {
    expect(
      normalizeCourseRecords(courseResponse([], { semester: null, totalCredits: null })),
    ).toMatchObject({ courses: [], semester: null, totalCredits: 0, sourceTotalCredits: null });
    expect(normalizeGradeRecords(gradeResponse([], { allSemesters: [] }))).toEqual({
      grades: [],
      semesters: [],
      allSemesters: [],
      summary: {},
    });
    expect(formatSemester(null)).toBe('學期未提供');
    expect(formatSemester('1142')).toBe('114 學年度第 2 學期');
    expect(formatSemester('993')).toBe('993');
  });

  it('retains the source fields, removes identical rows, and does not mutate the payload', () => {
    const row = course({ periods: [4, 3, 3] });
    const input = courseResponse([row, row], { totalCredits: 20 });
    const before = JSON.stringify(input);
    const result = normalizeCourseRecords(input);
    expect(result.courses).toHaveLength(1);
    expect(result.courses[0]).toMatchObject({
      name: '資料庫',
      periods: [3, 4],
      semester: '1151',
      scheduleWarning: null,
      timePlaceRaw: '二(Tue) 3, 4:PH303',
      location: 'PH303',
    });
    expect(result.totalCredits).toBe(3);
    expect(result.sourceTotalCredits).toBe(20);
    expect(JSON.stringify(input)).toBe(before);
  });
});

describe('schedule interpretation', () => {
  it('keeps unrecognized schedules visible, including invalid structured fields', () => {
    const rows = [
      course({
        code: 'A',
        dayOfWeek: null,
        periods: [],
        startTime: null,
        endTime: null,
        timePlaceRaw: '另行公告',
      }),
      course({ code: 'B', dayOfWeek: 0, periods: [3], timePlaceRaw: '未定' }),
      course({ code: 'C', periods: [3, '4'], startTime: '25:00', endTime: '26:00' }),
      course({ code: 'D', startTime: '12:00', endTime: '10:00' }),
    ];
    const result = normalizeCourseRecords(courseResponse(rows));
    expect(result.courses).toHaveLength(4);
    expect(result.courses.every((item) => item.scheduleWarning)).toBe(true);
    expect(result.courses[0].timePlaceRaw).toBe('另行公告');
    expect(result.courses[1].dayOfWeek).toBeNull();
    expect(result.courses[2].periods).toEqual([]);
    expect(result.courses[2].startTime).toBeNull();
    expect(findScheduleConflicts(result.courses)).toEqual([]);
  });

  it.each([1, 2, 3, 4, 5, 6, 7])('checks real overlapping periods on day %s', (dayOfWeek) => {
    const { courses } = normalizeCourseRecords(
      courseResponse([
        course({ code: 'A', dayOfWeek, periods: [3, 4] }),
        course({ code: 'B', dayOfWeek, periods: [4, 5] }),
        course({ code: 'C', dayOfWeek: dayOfWeek === 7 ? 1 : dayOfWeek + 1 }),
      ]),
    );
    const result = findScheduleConflicts(courses);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ dayOfWeek, overlappingPeriods: [4], timeOverlap: null });
    expect(result[0].first.code).toBe('A');
    expect(result[0].second.code).toBe('B');
  });

  it('does not treat gaps between nonconsecutive periods as occupied', () => {
    const { courses } = normalizeCourseRecords(
      courseResponse([
        course({ code: 'A', periods: [1, 3], startTime: '08:10', endTime: '11:00' }),
        course({ code: 'B', periods: [2], startTime: '09:10', endTime: '10:00' }),
      ]),
    );
    expect(findScheduleConflicts(courses)).toEqual([]);
  });

  it('uses exact source times when periods are absent and excludes touching endpoints', () => {
    const { courses } = normalizeCourseRecords(
      courseResponse([
        course({ code: 'A', periods: [], startTime: '10:00', endTime: '11:00' }),
        course({ code: 'B', periods: [], startTime: '10:30', endTime: '11:00' }),
        course({ code: 'C', periods: [], startTime: '11:00', endTime: '12:00' }),
      ]),
    );
    expect(findScheduleConflicts(courses)).toHaveLength(1);
    expect(findScheduleConflicts(courses)[0].timeOverlap).toEqual({
      startTime: '10:30',
      endTime: '11:00',
    });
  });

  it('does not mix semesters or report an identical row twice', () => {
    const { courses } = normalizeCourseRecords(courseResponse([course(), course()]));
    expect(findScheduleConflicts([...courses, ...courses])).toEqual([]);
    const previous = normalizeCourseRecords(
      courseResponse([course({ code: 'OTHER' })], { semester: '1142' }),
    );
    expect(findScheduleConflicts([...courses, ...previous.courses])).toEqual([]);
  });
});

describe('grade interpretation', () => {
  it('preserves text scores and school summaries, using only source semesters', () => {
    const result = normalizeGradeRecords(
      gradeResponse(
        [
          grade({ score: '未到' }),
          grade({ courseName: '體育', score: 'Pass', credits: 0 }),
          grade({ courseName: '專題', score: '尚未公布', semester: '1151' }),
        ],
        { summary: { '1142': { semesterAverage: '82.35', classRanking: '5/40' } } },
      ),
    );
    expect(result.grades.map((item) => item.score)).toEqual(['未到', 'Pass', '尚未公布']);
    expect(result.semesters).toEqual(['1142', '1151']);
    expect(result.summary['1142']).toEqual({ semesterAverage: '82.35', classRanking: '5/40' });
    expect(calculateGradeSummary(result.grades)).toMatchObject({
      totalCredits: 6,
      numericGradeCount: 0,
      numericCredits: 0,
      weightedAverage: null,
    });
  });

  it('weights only numeric results, keeps zero scores, and never presents a GPA or earned credits', () => {
    const { grades } = normalizeGradeRecords(
      gradeResponse([
        grade({ courseName: 'A', credits: 3, score: 80 }),
        grade({ courseName: 'B', credits: 1, score: 0 }),
        grade({ courseName: 'C', credits: 2, score: 'Pass' }),
        grade({ courseName: 'D', credits: 2, score: '未到' }),
        grade({ courseName: 'E', credits: 0, score: 100 }),
      ]),
    );
    expect(calculateGradeSummary(grades)).toEqual({
      courseCount: 5,
      totalCredits: 8,
      numericGradeCount: 3,
      numericCredits: 4,
      weightedAverage: 60,
    });
    expect(calculateGradeSummary([]).weightedAverage).toBeNull();
  });

  it('deduplicates exact rows but retains retakes from different semesters', () => {
    const row = grade();
    const { grades } = normalizeGradeRecords(
      gradeResponse([row, row, grade({ semester: '1151' })]),
    );
    expect(grades).toHaveLength(2);
    expect(calculateGradeSummary(grades).totalCredits).toBe(6);
  });
});
