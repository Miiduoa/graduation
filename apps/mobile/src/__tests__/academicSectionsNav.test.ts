import {
  MESSAGING_NAV_SECTIONS,
  STUDENT_ACADEMIC_SECTIONS,
  TEACHER_ACADEMIC_SECTIONS,
  messagingNavLabels,
  studentAcademicSectionLabels,
  teacherAcademicSectionLabels,
} from '@campus/shared/src/academicSections';

describe('shared academic / messaging nav vocabulary', () => {
  it('keeps student section labels aligned with Web order', () => {
    expect(studentAcademicSectionLabels()).toEqual([
      '課表',
      '課程與作業',
      '成績',
      '學分規劃',
      '行事曆',
    ]);
    expect(STUDENT_ACADEMIC_SECTIONS.map((section) => section.mobileScreen)).toEqual([
      'PersonalTimetable',
      'LearnHome',
      'Grades',
      'CreditAuditStack',
      'Calendar',
    ]);
  });

  it('keeps teacher section labels in product order', () => {
    expect(teacherAcademicSectionLabels()).toEqual(['今天的課', '授課課程', '待批改']);
    expect(TEACHER_ACADEMIC_SECTIONS.map((section) => section.id)).toEqual([
      'today',
      'courses',
      'grading',
    ]);
  });

  it('distinguishes 通知 vs 私訊 entry labels', () => {
    expect(messagingNavLabels()).toEqual(['通知', '私訊']);
    expect(MESSAGING_NAV_SECTIONS.map((section) => section.webPath)).toEqual([
      '/messages',
      '/dms',
    ]);
  });
});
