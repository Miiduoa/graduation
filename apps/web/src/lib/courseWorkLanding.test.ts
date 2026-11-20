import { afterEach, expect, it, vi } from 'vitest';
import {
  COURSE_WORK_LANDING_ATTR,
  COURSE_WORK_OPEN_COURSE,
  courseHrefFromData,
  coursePageReturnPath,
  courseWorkElementId,
  courseWorkHrefFromData,
  courseWorkOpenLabel,
  isAssignmentNotificationType,
  isCourseWorkPath,
  landOnCourseWork,
  parseCourseWorkHash,
} from './courseWorkLanding';

afterEach(() => {
  document.body.innerHTML = '';
});

it('reads assignment and quiz hashes and rejects path-like ids', () => {
  expect(parseCourseWorkHash('#assignment-hw-1')).toEqual({ kind: 'assignment', id: 'hw-1' });
  expect(parseCourseWorkHash('#quiz-cwq_11111111-1111-4111-8111-111111111111')).toEqual({
    kind: 'quiz',
    id: 'cwq_11111111-1111-4111-8111-111111111111',
  });
  expect(parseCourseWorkHash('#assignment-hw-3#assignment-hw-3')).toEqual({
    kind: 'assignment',
    id: 'hw-3',
  });
  expect(parseCourseWorkHash('#assignment-a%2Fb')).toBeNull();
  expect(parseCourseWorkHash('#material-cwm_11111111-1111-4111-8111-111111111111')).toEqual({
    kind: 'material',
    id: 'cwm_11111111-1111-4111-8111-111111111111',
  });
});

it('attaches at most one course-work hash when building a school course return path', () => {
  expect(coursePageReturnPath('cs101', '#assignment-hw-3')).toBe('/course/cs101#assignment-hw-3');
  expect(coursePageReturnPath('cs101', '#assignment-hw-3#assignment-hw-3')).toBe(
    '/course/cs101#assignment-hw-3',
  );
  expect(coursePageReturnPath('cs101', '#quiz-midterm#quiz-midterm')).toBe(
    '/course/cs101#quiz-midterm',
  );
  expect(coursePageReturnPath('cs101', '#')).toBe('/course/cs101');
  expect(coursePageReturnPath('cs101')).toBe('/course/cs101');
});

it('builds a one-click classroom or school course hash and ignores off-site urls', () => {
  expect(
    courseWorkHrefFromData({
      workspaceId: 'cw_11111111-1111-4111-8111-111111111111',
      assignmentId: 'cwa_22222222-2222-4222-8222-222222222222',
    }),
  ).toBe(
    '/classroom/course/cw_11111111-1111-4111-8111-111111111111#assignment-cwa_22222222-2222-4222-8222-222222222222',
  );
  expect(
    courseWorkHrefFromData({
      courseId: 'cs101',
      assignmentId: 'hw-1',
      kind: 'quiz',
    }),
  ).toBe('/course/cs101#quiz-hw-1');
  expect(
    courseWorkHrefFromData({
      href: 'https://evil.test/course/cs101#assignment-hw-1',
      courseId: 'cs101',
      assignmentId: 'hw-1',
    }),
  ).toBe('/course/cs101#assignment-hw-1');
  expect(courseWorkHrefFromData({ url: 'javascript:alert(1)' })).toBeNull();
  expect(courseWorkHrefFromData({ courseId: '../other', assignmentId: 'hw-1' })).toBeNull();
  expect(courseWorkHrefFromData({ courseId: '..', assignmentId: 'hw-1' })).toBeNull();
  expect(
    courseWorkHrefFromData(
      {
        workspaceId: 'cw_11111111-1111-4111-8111-111111111111',
        materialId: 'cwm_33333333-3333-4333-8333-333333333333',
      },
      'material',
    ),
  ).toBe(
    '/classroom/course/cw_11111111-1111-4111-8111-111111111111#material-cwm_33333333-3333-4333-8333-333333333333',
  );
});

it('falls back to the in-site course page when the notice only has a course id', () => {
  expect(courseHrefFromData({ courseId: 'cs101' })).toBe('/course/cs101');
  expect(
    courseHrefFromData({ workspaceId: 'cw_11111111-1111-4111-8111-111111111111' }),
  ).toBe('/classroom/course/cw_11111111-1111-4111-8111-111111111111');
  expect(courseHrefFromData({ courseId: '..' })).toBeNull();
  expect(courseWorkHrefFromData({ courseId: 'cs101' })).toBeNull();
  expect(courseWorkOpenLabel('/course/cs101')).toBe(COURSE_WORK_OPEN_COURSE);
  expect(courseWorkOpenLabel('/classroom/course/cw_1#material-cwm_1')).toBe('開啟這份教材');
});

it('keeps only in-site course work paths', () => {
  expect(isCourseWorkPath('/course/cs101')).toBe(true);
  expect(
    isCourseWorkPath('/classroom/course/cw_11111111-1111-4111-8111-111111111111'),
  ).toBe(true);
  expect(isCourseWorkPath('/grades')).toBe(false);
  expect(isAssignmentNotificationType('assignment_due')).toBe(true);
  expect(isAssignmentNotificationType('message')).toBe(false);
  expect(courseWorkElementId('assignment', 'hw-1')).toBe('assignment-hw-1');
});

it('highlights and focuses the landed card without leaving a previous card marked', () => {
  document.body.innerHTML =
    '<article id="assignment-old" tabindex="-1"></article><article id="assignment-hw-1" tabindex="-1"></article>';
  const previous = document.getElementById('assignment-old')!;
  previous.setAttribute(COURSE_WORK_LANDING_ATTR, 'true');
  const target = document.getElementById('assignment-hw-1')!;
  const scroll = vi.fn();
  target.scrollIntoView = scroll;
  expect(landOnCourseWork('assignment-hw-1')).toBe(true);
  expect(previous.getAttribute(COURSE_WORK_LANDING_ATTR)).toBeNull();
  expect(target.getAttribute(COURSE_WORK_LANDING_ATTR)).toBe('true');
  expect(scroll).toHaveBeenCalledWith({ block: 'start' });
  expect(document.activeElement).toBe(target);
});
