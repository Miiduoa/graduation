import type { NuniAssignment, NuniWorkspace } from '@campus/shared/src/nuni';
import {
  isPendingActivity,
  matchesActivitySearch,
  matchesCourseListFilter,
  matchesCourseSearch,
  prioritizeActivities,
} from '../services/nuniActivityTasks';

const course: NuniWorkspace = {
  id: 'course',
  title: 'Web 設計實務',
  state: 'active',
  memberRole: 'student',
};
const task = (id: string, dueAt: string | null): NuniAssignment => ({
  id,
  workspaceId: course.id,
  title: '服務設計訪談',
  instructions: '記錄 USER 觀察與需求',
  unitId: 'unit',
  unitTitle: '第一單元',
  state: 'open',
  createdAt: '2026-10-20T00:00:00Z',
  closedAt: null,
  dueAt,
  submissionCount: 0,
  mySubmission: null,
});

it('searches course names across case, fullwidth text, spaces and multiple terms', () => {
  expect(matchesCourseSearch(course, '  ＷＥＢ　實務 ')).toBe(true);
  expect(matchesCourseSearch(course, 'web 程式')).toBe(false);
});

it('keeps archived and teaching courses distinct from active student courses', () => {
  expect(matchesCourseListFilter({ ...course, state: 'archived' }, 'student')).toBe(false);
  expect(matchesCourseListFilter({ ...course, memberRole: 'co-teacher' }, 'teaching')).toBe(true);
  expect(
    matchesCourseListFilter(
      { ...course, memberRole: 'owner-teacher', state: 'archived' },
      'teaching',
    ),
  ).toBe(false);
  expect(matchesCourseListFilter({ ...course, state: 'archived' }, 'all')).toBe(true);
});

it('searches activity titles, unit names and instructions without changing their status', () => {
  const assignment = task('a', '2020-01-01T00:00:00Z');
  expect(matchesActivitySearch(assignment, '訪談 USER')).toBe(true);
  expect(matchesActivitySearch(assignment, '第一單元')).toBe(true);
  expect(matchesActivitySearch(assignment, '統計')).toBe(false);
  expect(isPendingActivity(assignment, course)).toBe(true);
});

it('orders valid Taipei deadlines before invalid or absent dates without mutating input', () => {
  const invalid = task('invalid', 'not-a-date');
  const later = task('later', '2026-10-26T10:00:00+08:00');
  const earlier = task('earlier', '2026-10-25T10:00:00');
  const tasks = [invalid, later, earlier];
  expect(prioritizeActivities(tasks, course).map((item) => item.id)).toEqual([
    'earlier',
    'later',
    'invalid',
  ]);
  expect(tasks[0]).toBe(invalid);
});
