import { buildCourseNavigationTarget, buildNavigationTarget } from '../../utils/courseNavigation';

describe('courseNavigation utilities', () => {
  it('routes the student course entry to CoursesHome', () => {
    expect(buildCourseNavigationTarget('student')).toEqual({
      tab: '課程',
      screen: 'CoursesHome',
      params: undefined,
    });
  });

  it('routes the teacher course entry to TeachingHub', () => {
    expect(buildCourseNavigationTarget('teacher')).toEqual({
      tab: '教學',
      screen: 'TeachingHub',
      params: undefined,
    });
  });

  it('keeps a specific course workspace when groupId is present', () => {
    expect(buildCourseNavigationTarget('student', 'CourseHub', { groupId: 'course-1' })).toEqual({
      tab: '課程',
      screen: 'CourseHub',
      params: { groupId: 'course-1' },
    });
  });

  it('normalizes generic CourseHub entries back to the course home', () => {
    expect(buildCourseNavigationTarget('student', 'CourseHub')).toEqual({
      tab: '課程',
      screen: 'CoursesHome',
      params: undefined,
    });
  });

  it('maps course tab targets to the current role tab', () => {
    expect(buildNavigationTarget('teacher', '課程', 'Grades')).toEqual({
      tab: '教學',
      screen: 'Grades',
      params: undefined,
    });
  });

  it('falls back to the role tab when no course stack is available', () => {
    expect(buildCourseNavigationTarget('admin', 'Attendance')).toEqual({
      tab: '管理',
    });
  });
});
