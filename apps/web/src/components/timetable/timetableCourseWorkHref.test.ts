import { describe, expect, it } from 'vitest';
import {
  classroomQueryMatchKind,
  classroomSearchHref,
  filterCoursesByClassroomQuery,
  resolveTimetableCourseWorkExit,
  timetableCourseSearchQuery,
} from './timetableCourseWorkHref';
import {
  filterCoursesByClassroomQuery as sharedFilter,
  timetableClassroomSearchParams,
  timetableCourseSearchQuery as sharedSearchQuery,
} from '@campus/shared/src/timetable/classroomCourseQuery';

describe('timetable course-work exit', () => {
  it('opens the linked course shell when linkedCourseId is present', () => {
    expect(
      resolveTimetableCourseWorkExit({
        linkedCourseId: 'cw_11111111-1111-4111-8111-111111111111',
        courseName: '資料庫',
      }),
    ).toBe('/classroom/course/cw_11111111-1111-4111-8111-111111111111');
    expect(
      resolveTimetableCourseWorkExit({
        linkedCourseId: 'cs-db',
        courseName: '資料庫',
      }),
    ).toBe('/course/cs-db');
  });

  it('falls back to /classroom?q=…&from=timetable without writing a link when linkedCourseId is missing', () => {
    expect(
      resolveTimetableCourseWorkExit({
        courseName: '資料庫系統',
      }),
    ).toBe('/classroom?q=%E8%B3%87%E6%96%99%E5%BA%AB%E7%B3%BB%E7%B5%B1&from=timetable');
    expect(
      resolveTimetableCourseWorkExit({
        courseName: '資料庫系統',
        courseCode: 'CS301',
      }),
    ).toBe(
      '/classroom?q=%E8%B3%87%E6%96%99%E5%BA%AB%E7%B3%BB%E7%B5%B1&from=timetable&code=CS301',
    );
    expect(resolveTimetableCourseWorkExit({ courseName: '   ' })).toBe('/classroom');
  });

  it('builds search query from name primarily and carries code separately', () => {
    expect(timetableCourseSearchQuery({ courseName: '互動設計', courseCode: 'DES101' })).toBe(
      '互動設計',
    );
    expect(timetableCourseSearchQuery({ courseName: 'DES101 互動設計', courseCode: 'DES101' })).toBe(
      'DES101 互動設計',
    );
    expect(classroomSearchHref('資料庫', { fromTimetable: true })).toBe(
      '/classroom?q=%E8%B3%87%E6%96%99%E5%BA%AB&from=timetable',
    );
  });
});

describe('classroom q filter', () => {
  const courses = [
    { id: 'a', title: 'Data 資料庫系統' },
    { id: 'b', title: '互動設計' },
    { id: 'c', title: '進階資料庫' },
  ];

  it('highlights a unique match', () => {
    const matched = filterCoursesByClassroomQuery(courses, '互動設計');
    expect(matched).toEqual([courses[1]]);
    expect(classroomQueryMatchKind(matched.length, true)).toBe('unique');
  });

  it('lists multiple matches', () => {
    const matched = filterCoursesByClassroomQuery(courses, '資料庫');
    expect(matched.map((row) => row.id)).toEqual(['a', 'c']);
    expect(classroomQueryMatchKind(matched.length, true)).toBe('multi');
  });

  it('reports zero matches', () => {
    const matched = filterCoursesByClassroomQuery(courses, '不存在的課程');
    expect(matched).toEqual([]);
    expect(classroomQueryMatchKind(matched.length, true)).toBe('none');
  });

  it('manual search keeps whole-string substring (not token AND)', () => {
    const matched = filterCoursesByClassroomQuery(courses, 'Data 資料');
    expect(matched).toEqual([courses[0]]);
    expect(
      filterCoursesByClassroomQuery(courses, '資料庫系統 CS301'),
    ).toEqual([]);
  });

  it('timetable name+code q hits a title that only has the course name', () => {
    const onlyName = [{ id: 'db', title: '資料庫系統' }];
    const matched = filterCoursesByClassroomQuery(onlyName, '資料庫系統', {
      fromTimetable: true,
      courseCode: 'CS301',
    });
    expect(matched).toEqual(onlyName);
    expect(classroomQueryMatchKind(matched.length, true)).toBe('unique');
  });

  it('does not treat the last token of a multi-word name as a course code without code param', () => {
    const multiWord = [
      { id: 'ds', title: '資料 結構' },
      { id: 'other', title: '程式 結構' },
    ];
    const matched = filterCoursesByClassroomQuery(multiWord, '資料 結構', {
      fromTimetable: true,
    });
    expect(matched).toEqual([multiWord[0]]);
    expect(classroomQueryMatchKind(matched.length, true)).toBe('unique');

    const english = [
      { id: 'ml', title: 'Machine Learning' },
      { id: 'dl', title: 'Deep Learning' },
    ];
    expect(
      filterCoursesByClassroomQuery(english, 'Machine Learning', { fromTimetable: true }),
    ).toEqual([english[0]]);
  });

  it('stays aligned with the shared classroomCourseQuery module', () => {
    const sample = [{ id: 'x', title: '資料 結構' }];
    const input = { courseName: '資料庫系統', courseCode: 'CS301' };
    expect(timetableCourseSearchQuery(input)).toBe(sharedSearchQuery(input));
    expect(timetableClassroomSearchParams(input)).toEqual({
      q: '資料庫系統',
      from: 'timetable',
      code: 'CS301',
    });
    expect(
      filterCoursesByClassroomQuery(sample, '資料 結構', { fromTimetable: true }),
    ).toEqual(sharedFilter(sample, '資料 結構', { fromTimetable: true }));
  });
});
