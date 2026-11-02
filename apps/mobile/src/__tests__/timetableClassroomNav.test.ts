import {
  classroomQueryMatchKind,
  filterCoursesByClassroomQuery,
  resolveTimetableClassroomNav,
  timetableCourseSearchQuery,
} from '../hooks/timetableClassroomNav';

describe('timetable classroom navigation', () => {
  it('opens CourseHub when linkedCourseId is present', () => {
    expect(
      resolveTimetableClassroomNav({
        linkedCourseId: 'cw_11111111-1111-4111-8111-111111111111',
        courseName: '資料庫',
      }),
    ).toEqual({
      kind: 'linked',
      screen: 'CourseHub',
      params: { courseId: 'cw_11111111-1111-4111-8111-111111111111' },
    });
  });

  it('carries course name/code as Classroom q when unlinked', () => {
    expect(
      resolveTimetableClassroomNav({
        courseName: '資料庫系統',
        courseCode: 'CS301',
      }),
    ).toEqual({
      kind: 'search',
      screen: 'Classroom',
      params: { q: '資料庫系統 CS301' },
    });
    expect(timetableCourseSearchQuery({ courseName: '  ', courseCode: '' })).toBe('');
  });
});

describe('mobile classroom q filter', () => {
  const courses = [
    { id: 'a', title: 'Data 資料庫系統' },
    { id: 'b', title: '互動設計' },
    { id: 'c', title: '進階資料庫' },
  ];

  it('filters unique, multi and zero matches from a q param', () => {
    const unique = filterCoursesByClassroomQuery(courses, '互動設計');
    expect(unique).toEqual([courses[1]]);
    expect(classroomQueryMatchKind(unique.length, true)).toBe('unique');

    const multi = filterCoursesByClassroomQuery(courses, '資料庫');
    expect(multi.map((row) => row.id)).toEqual(['a', 'c']);
    expect(classroomQueryMatchKind(multi.length, true)).toBe('multi');

    const none = filterCoursesByClassroomQuery(courses, '不存在的課程');
    expect(none).toEqual([]);
    expect(classroomQueryMatchKind(none.length, true)).toBe('none');
  });
});
