import { expect, it } from 'vitest';
import {
  ASSIGNMENT_FOCUS_MISSING,
  classroomTeacherSubmissionHref,
  parseAssignmentFocusId,
  resolveAssignmentFocus,
  teacherSubmissionListHref,
} from './assignmentDeepLink';

it('parses safe assignment ids', () => {
  expect(parseAssignmentFocusId('hw-1')).toBe('hw-1');
  expect(parseAssignmentFocusId('cwa_11111111-1111-4111-8111-111111111111')).toBe(
    'cwa_11111111-1111-4111-8111-111111111111',
  );
  expect(parseAssignmentFocusId('../x')).toBeNull();
  expect(parseAssignmentFocusId('')).toBeNull();
});

it('builds teacher submission list href that keeps campus query and sets assignmentId', () => {
  expect(teacherSubmissionListHref('course-a', 'hw-1', '?schoolId=pu&campus=pu')).toBe(
    '/teacher/course/course-a?schoolId=pu&campus=pu&assignmentId=hw-1',
  );
  expect(teacherSubmissionListHref('course-a', 'hw-1')).toBe(
    '/teacher/course/course-a?assignmentId=hw-1',
  );
});

it('builds classroom teacher submission deep link with view and hash', () => {
  const href = classroomTeacherSubmissionHref(
    'cw_11111111-1111-4111-8111-111111111111',
    'cwa_22222222-2222-4222-8222-222222222222',
    '?campus=pu',
  );
  expect(href).toContain('/classroom/course/cw_11111111-1111-4111-8111-111111111111?');
  expect(href).toContain('view=assignments');
  expect(href).toContain('assignmentId=cwa_22222222-2222-4222-8222-222222222222');
  expect(href).toContain('submissions=1');
  expect(href).toContain('#assignment-cwa_22222222-2222-4222-8222-222222222222');
});

it('resolves found versus missing assignment focus', () => {
  expect(resolveAssignmentFocus(['hw-1'], 'hw-1')).toEqual({ found: true, missing: false });
  expect(resolveAssignmentFocus(['hw-1'], 'hw-9')).toEqual({ found: false, missing: true });
  expect(resolveAssignmentFocus([], 'hw-9', { ready: false })).toEqual({
    found: false,
    missing: false,
  });
  expect(ASSIGNMENT_FOCUS_MISSING).toContain('找不到這份作業');
});
