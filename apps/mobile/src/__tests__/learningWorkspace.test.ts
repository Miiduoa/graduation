import type { CourseSpace, InboxTask } from '../data/types';
import {
  buildLearningWorkspace,
  describeLearningTask,
  filterLearningTasks,
} from '../features/learningWorkspace';

const now = new Date('2026-10-26T01:00:00.000Z');

const courses = [{ groupId: 'course-1', name: '資料結構' }] as CourseSpace[];

function task(id: string, kind: InboxTask['kind'], dueAt?: string, groupId = 'course-1'): InboxTask {
  return {
    id,
    kind,
    groupId,
    groupName: '資料結構',
    title: id,
    subtitle: '',
    priority: 2,
    dueAt: dueAt ? new Date(dueAt) : null,
  };
}

test('shows only tasks from enrolled courses, without contaminating the inbox with AI queues', () => {
  const summary = buildLearningWorkspace(courses, [
    task('inbox', 'assignment', '2026-10-26T07:00:00Z'),
    task('foreign', 'quiz', '2026-10-26T03:00:00Z', 'course-2'),
    task('suggestion', 'assistant_queue'),
  ], now);

  expect(summary.courses).toEqual(courses);
  expect(summary.tasks.map((row) => row.id)).toEqual(['inbox']);
  expect(summary.upcomingCount).toBe(1);
  expect(summary.overdueCount).toBe(0);
});

test('puts active attendance and overdue work before future deadlines', () => {
  const summary = buildLearningWorkspace(courses, [
    task('later', 'assignment', '2026-11-10T06:00:00Z'),
    task('soon', 'quiz', '2026-10-27T07:00:00Z'),
    task('late', 'assignment', '2026-10-24T16:00:00Z'),
    task('attendance', 'live'),
  ], now);
  expect(summary.tasks.map((row) => row.id)).toEqual(['attendance', 'late', 'soon', 'later']);
  expect(summary.overdueCount).toBe(1);
  expect(summary.upcomingCount).toBe(1);
});

test('uses Taipei calendar days for due labels, including just after midnight', () => {
  expect(describeLearningTask(task('today', 'assignment', '2026-10-26T15:59:00Z'), now))
    .toEqual({ label: '今日截止', tone: 'warning' });
  expect(describeLearningTask(task('tomorrow', 'quiz', '2026-10-26T16:01:00Z'), now))
    .toEqual({ label: '明日截止', tone: 'warning' });
  expect(describeLearningTask(task('overdue', 'assignment', '2026-10-25T16:00:00Z'), now))
    .toEqual({ label: '已逾期', tone: 'danger' });
});

test('seven-day filter excludes overdue and undated items without inventing deadlines', () => {
  const tasks = [
    task('expired', 'assignment', '2026-10-24T16:00:00Z'),
    task('week', 'quiz', '2026-10-30T01:00:00Z'),
    task('undated', 'assignment'),
    task('later', 'assignment', '2026-11-30T01:00:00Z'),
  ];
  expect(filterLearningTasks(tasks, 'week', now).map((row) => row.id)).toEqual(['week']);
  expect(filterLearningTasks(tasks, 'assignment', now).map((row) => row.id))
    .toEqual(['expired', 'undated', 'later']);
});
