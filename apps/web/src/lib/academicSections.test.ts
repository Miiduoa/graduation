import { expect, it } from 'vitest';
import {
  STUDENT_ACADEMIC_SECTIONS,
  studentAcademicSectionLabels,
} from '@campus/shared/src/academicSections';
import {
  ACADEMIC_LMS_SECTIONS,
  ACADEMIC_SECTIONS,
  academicNavigationPath,
} from './academicSections';

it('keeps a stable academic secondary-nav vocabulary', () => {
  expect(ACADEMIC_SECTIONS.map((section) => section.label)).toEqual([
    '課表',
    '課程與作業',
    '成績',
    '學分規劃',
    '行事曆',
  ]);
  expect(ACADEMIC_LMS_SECTIONS.map((section) => section.label)).toEqual([
    '校方課程',
    '校方作業與教材',
  ]);
});

it('derives student section labels and order from shared academicSections', () => {
  expect(ACADEMIC_SECTIONS.map((section) => section.label)).toEqual(studentAcademicSectionLabels());
  expect(ACADEMIC_SECTIONS.map((section) => section.path)).toEqual(
    STUDENT_ACADEMIC_SECTIONS.map((section) => section.webPath),
  );
});

it.each([
  ['/timetable', '/timetable'],
  ['/classroom', '/classroom'],
  ['/classroom/course/cs101', '/classroom'],
  ['/grades', '/grades'],
  ['/credit-planner', '/credit-planner'],
  ['/credit-planner/review', '/credit-planner'],
  ['/calendar', '/calendar'],
  ['/school-courses', '/school-courses'],
  ['/school-lms', '/school-lms'],
  ['/school-lms/homework/1/2', '/school-lms'],
  ['/import', '/import'],
] as const)('maps %s onto academic navigation path %s', (pathname, expected) => {
  expect(academicNavigationPath(pathname)).toBe(expected);
});

it.each(['/classroom/grades', '/classroom/account', '/classroom/login', '/life', '/teacher', null])(
  'does not treat %s as an academic navigation surface',
  (pathname) => {
    expect(academicNavigationPath(pathname)).toBeNull();
  },
);
