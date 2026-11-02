import { render, screen, within } from '@testing-library/react';
import { expect, it } from 'vitest';
import type { TodayClass, TodayTodo } from '@campus/shared/src/pickNextAction';
import {
  TEACHER_TODAY_DUE_TITLE,
  TEACHER_TODAY_GRADING_TITLE,
  TODAY_FLOW_CLASS_TITLE,
} from '@/lib/todayCourseWork';
import { TeacherToday, isTeachingCourse } from './TeacherToday';

const now = new Date('2026-10-25T09:50:00+08:00');

const klass: TodayClass = {
  id: 'class-1',
  title: '教學實習',
  location: '教育館 101',
  startAt: Date.parse('2026-10-25T10:10:00+08:00'),
  endAt: Date.parse('2026-10-25T12:00:00+08:00'),
  courseId: 'teach-1',
};

const todo: TodayTodo = {
  id: 'hw-1',
  title: '觀摩報告',
  courseName: '教學實習',
  courseId: 'teach-1',
  dueAt: Date.parse('2026-10-26T23:59:00+08:00'),
  href: '/course/teach-1#assignment-hw-1',
};

it('recognizes teaching roles', () => {
  expect(isTeachingCourse({ role: 'owner-teacher' })).toBe(true);
  expect(isTeachingCourse({ role: 'student' })).toBe(false);
});

it('shows today classes, grading entries and upcoming work in one flow', () => {
  render(
    <TeacherToday
      now={now}
      unsigned={false}
      classes={[klass]}
      teachingCourses={[{ id: 'teach-1', name: '教學實習', role: 'owner-teacher', unreadCount: 0 }]}
      upcomingTodos={[todo]}
      timetableHref="/timetable?campus=pu"
      importHref="/import?kind=timetable&campus=pu"
    />,
  );
  expect(screen.getByTestId('teacher-today')).toBeTruthy();
  expect(screen.getByRole('heading', { name: TODAY_FLOW_CLASS_TITLE })).toBeTruthy();
  expect(screen.getByRole('heading', { name: TEACHER_TODAY_GRADING_TITLE })).toBeTruthy();
  expect(screen.getByRole('heading', { name: TEACHER_TODAY_DUE_TITLE })).toBeTruthy();
  expect(
    within(screen.getByRole('heading', { name: TEACHER_TODAY_GRADING_TITLE }).parentElement!)
      .getByRole('link', { name: /教學實習/ })
      .getAttribute('href'),
  ).toBe('/course/teach-1');
  expect(
    within(screen.getByRole('heading', { name: TEACHER_TODAY_DUE_TITLE }).parentElement!)
      .getByRole('link', { name: /觀摩報告/ })
      .getAttribute('href'),
  ).toBe('/course/teach-1#assignment-hw-1');
});
