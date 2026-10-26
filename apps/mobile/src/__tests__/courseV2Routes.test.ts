import { COURSE_V2_ROUTES, COURSE_V2_SHORTCUT_GROUPS } from '../screens/lmsV2/courseV2Routes';

test('the LMS v2 student journey keeps course-specific entry points on their v2 screens', () => {
  const entries = COURSE_V2_SHORTCUT_GROUPS.flatMap((group) => group.shortcuts);
  const routes = Object.fromEntries(entries.map((item) => [item.key, item.route]));
  expect(routes).toMatchObject({
    materials: COURSE_V2_ROUTES.materials,
    assignments: COURSE_V2_ROUTES.assignments,
    quizzes: COURSE_V2_ROUTES.quizzes,
    announcements: COURSE_V2_ROUTES.announcements,
    forum: 'CourseDiscussion',
    grades: 'CourseScores',
    live: 'Attendance',
  });
  expect(COURSE_V2_ROUTES.assignmentDetail).not.toBe('HomeworkSubmit');
  expect(new Set(entries.map((item) => item.key)).size).toBe(entries.length);
  expect(new Set(Object.values(COURSE_V2_ROUTES)).size).toBe(Object.values(COURSE_V2_ROUTES).length);
});
