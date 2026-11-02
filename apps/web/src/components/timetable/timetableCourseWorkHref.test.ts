import { describe, expect, it } from 'vitest';
import {
  classroomQueryMatchKind,
  classroomSearchHref,
  filterCoursesByClassroomQuery,
  resolveTimetableCourseWorkExit,
  timetableCourseSearchQuery,
} from './timetableCourseWorkHref';

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

  it('falls back to /classroom?q=… without writing a link when linkedCourseId is missing', () => {
    expect(
      resolveTimetableCourseWorkExit({
        courseName: '資料庫系統',
      }),
    ).toBe('/classroom?q=%E8%B3%87%E6%96%99%E5%BA%AB%E7%B3%BB%E7%B5%B1');
    expect(
      resolveTimetableCourseWorkExit({
        courseName: '資料庫系統',
        courseCode: 'CS301',
      }),
    ).toBe('/classroom?q=%E8%B3%87%E6%96%99%E5%BA%AB%E7%B3%BB%E7%B5%B1%20CS301');
    expect(resolveTimetableCourseWorkExit({ courseName: '   ' })).toBe('/classroom');
  });

  it('builds search query from name and optional course code', () => {
    expect(timetableCourseSearchQuery({ courseName: '互動設計', courseCode: 'DES101' })).toBe(
      '互動設計 DES101',
    );
    expect(timetableCourseSearchQuery({ courseName: 'DES101 互動設計', courseCode: 'DES101' })).toBe(
      'DES101 互動設計',
    );
    expect(classroomSearchHref('資料庫')).toBe('/classroom?q=%E8%B3%87%E6%96%99%E5%BA%AB');
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
});
