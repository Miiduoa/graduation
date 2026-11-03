import {
  classroomQueryMatchKind,
  filterCoursesByClassroomQuery,
  resolveTimetableClassroomNav,
  timetableCourseSearchQuery,
  todayCourseWorkNavigateTarget,
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

  it('carries course name as Classroom q with from=timetable when unlinked', () => {
    expect(
      resolveTimetableClassroomNav({
        courseName: '資料庫系統',
        courseCode: 'CS301',
      }),
    ).toEqual({
      kind: 'search',
      screen: 'Classroom',
      params: { q: '資料庫系統', from: 'timetable', code: 'CS301' },
    });
    expect(timetableCourseSearchQuery({ courseName: '  ', courseCode: '' })).toBe('');
  });

  it('opens Classroom home without empty q when course name is blank', () => {
    expect(resolveTimetableClassroomNav({ courseName: '   ' })).toEqual({
      kind: 'search',
      screen: 'Classroom',
      params: {},
    });
  });

  it('maps today linked exits to CourseHub group params and search exits unchanged', () => {
    expect(
      todayCourseWorkNavigateTarget(
        resolveTimetableClassroomNav({
          linkedCourseId: 'cw_11111111-1111-4111-8111-111111111111',
          courseName: '資料庫',
        }),
      ),
    ).toEqual({
      screen: 'CourseHub',
      params: {
        courseSpaceId: 'cw_11111111-1111-4111-8111-111111111111',
        groupId: 'cw_11111111-1111-4111-8111-111111111111',
        section: 'week',
      },
    });
    expect(
      todayCourseWorkNavigateTarget(
        resolveTimetableClassroomNav({ courseName: '資料庫系統', courseCode: 'CS301' }),
      ),
    ).toEqual({
      screen: 'Classroom',
      params: { q: '資料庫系統', from: 'timetable', code: 'CS301' },
    });
    expect(
      todayCourseWorkNavigateTarget(resolveTimetableClassroomNav({ courseName: '   ' })),
    ).toEqual({ screen: 'Classroom', params: {} });
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

  it('manual search keeps whole-string substring (not token AND)', () => {
    expect(filterCoursesByClassroomQuery(courses, 'Data 資料')).toEqual([courses[0]]);
    expect(filterCoursesByClassroomQuery(courses, '資料庫系統 CS301')).toEqual([]);
  });

  it('timetable name+code q hits a title that only has the course name', () => {
    const onlyName = [{ id: 'db', title: '資料庫系統' }];
    expect(
      filterCoursesByClassroomQuery(onlyName, '資料庫系統 CS301', {
        fromTimetable: true,
        courseCode: 'CS301',
      }),
    ).toEqual(onlyName);
    expect(
      filterCoursesByClassroomQuery(onlyName, '資料庫系統 CS301', { fromTimetable: true }),
    ).toEqual(onlyName);
  });
});
