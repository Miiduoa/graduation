import { buildCourseNavigationTarget, buildNavigationTarget, migrateTabName } from '../../utils/courseNavigation';

describe('courseNavigation utilities (4+1 AI-First nav)', () => {
  it('routes student course entry to the unified 學習 Tab', () => {
    expect(buildCourseNavigationTarget('student')).toEqual({
      tab: '學習',
      screen: 'LearnHome',
      params: undefined,
    });
  });

  it('routes teacher course entry to the same 學習 Tab (dispatcher inside)', () => {
    expect(buildCourseNavigationTarget('teacher')).toEqual({
      tab: '學習',
      screen: 'LearnHome',
      params: undefined,
    });
  });

  it('keeps a specific course workspace when groupId is present', () => {
    expect(buildCourseNavigationTarget('student', 'CourseHub', { groupId: 'course-1' })).toEqual({
      tab: '學習',
      screen: 'CourseHub',
      params: { groupId: 'course-1' },
    });
  });

  it('normalizes generic CourseHub entries back to LearnHome', () => {
    expect(buildCourseNavigationTarget('student', 'CourseHub')).toEqual({
      tab: '學習',
      screen: 'LearnHome',
      params: undefined,
    });
  });

  it('migrates legacy 課程/教學 tab requests to 學習', () => {
    expect(buildNavigationTarget('teacher', '課程', 'Grades')).toEqual({
      tab: '學習',
      screen: 'Grades',
      params: undefined,
    });
  });

  it('admin still uses 學習 Tab (dispatcher routes to AdminDashboard)', () => {
    expect(buildCourseNavigationTarget('admin', 'Attendance')).toEqual({
      tab: '學習',
      screen: 'Attendance',
      params: undefined,
    });
  });

  describe('migrateTabName', () => {
    it('maps legacy role tabs to 學習', () => {
      expect(migrateTabName('課程')).toBe('學習');
      expect(migrateTabName('教學')).toBe('學習');
      expect(migrateTabName('服務')).toBe('學習');
      expect(migrateTabName('審核')).toBe('學習');
      expect(migrateTabName('管理')).toBe('學習');
    });

    it('maps 收件匣 to 訊息', () => {
      expect(migrateTabName('收件匣')).toBe('訊息');
    });

    it('leaves new tab names untouched', () => {
      expect(migrateTabName('Today')).toBe('Today');
      expect(migrateTabName('學習')).toBe('學習');
      expect(migrateTabName('校園')).toBe('校園');
      expect(migrateTabName('訊息')).toBe('訊息');
      expect(migrateTabName('我的')).toBe('我的');
    });
  });
});
