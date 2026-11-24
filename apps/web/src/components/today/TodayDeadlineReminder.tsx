'use client';

import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { createCourseAccess } from '@campus/shared/src/courseAccessClient';
import { formatClock, type TodayClass, type TodayTodo } from '@campus/shared/src/pickNextAction';
import { pickTodayPriority } from '@campus/shared/src/todayPriority';
import { browserRequest } from '@/features/nuni/Session';
import { buildCampusNavigationSearch, campusServiceHref } from '@/lib/campusNavigationLinks';
import {
  COURSE_WORK_OPEN_ASSIGNMENT, COURSE_WORK_OPEN_QUIZ, isCourseWorkPath, parseCourseWorkHash,
} from '@/lib/courseWorkLanding';
import styles from './StudentToday.module.css';

export type ReminderSession = { accountId: string; context: string };

function timetableSource(scopeKey: string | undefined, schoolId: string, session?: ReminderSession) {
  if (!scopeKey) return null;
  try {
    const scope: unknown = JSON.parse(scopeKey);
    if (!Array.isArray(scope) || scope[1] !== schoolId) return null;
    const [owner, , uid] = scope;
    if (session && owner === `platform:${session.accountId}`) return 'platform';
    if (!session && typeof uid === 'string' && uid && owner === `school:${uid}`) return 'school';
  } catch { /* The record has no usable account scope. */ }
  return null;
}

/** Validate the real work anchor before adding the selected campus to the link. */
function workLabel(todo: TodayTodo, coursePath: string) {
  if (!todo.href || !todo.courseId) return null;
  const path = coursePath + encodeURIComponent(todo.courseId);
  if (!isCourseWorkPath(path) || !todo.href.startsWith(path + '#')) return null;
  const work = parseCourseWorkHash(todo.href.slice(path.length));
  if (!work || work.kind === 'material' || todo.id !== todo.courseId + ':' + work.id) return null;
  return work.kind === 'quiz' ? COURSE_WORK_OPEN_QUIZ : COURSE_WORK_OPEN_ASSIGNMENT;
}

function ReviewedStudentWork({ context, schoolId, workspaceId, todo, children }: {
  context: string; schoolId: string; workspaceId: string; todo: TodayTodo; children: ReactNode;
}) {
  const [verified, setVerified] = useState<TodayTodo | null>(null);
  useEffect(() => {
    let current = true;
    const access = createCourseAccess((path, input) => browserRequest(path, context, input));
    void access.workspace(workspaceId, schoolId).then(receipt => {
      if (current && receipt.status === 'reviewed' && receipt.memberRole === 'student') setVerified(todo);
    }).catch(() => { /* An unverified workspace cannot supply a campus reminder. */ });
    return () => { current = false; };
  }, [context, schoolId, workspaceId, todo]);
  return verified === todo ? children : null;
}

export function TodayDeadlineReminder({ classes, todos, now, scopeKey, schoolId, search, leavingTodoIds, platformSession }: {
  classes: readonly TodayClass[];
  todos: readonly TodayTodo[];
  now: Date;
  scopeKey?: string;
  schoolId?: string | null;
  search: string;
  leavingTodoIds?: readonly string[];
  platformSession?: ReminderSession;
}) {
  if (!schoolId || schoolId === 'personal' || schoolId === 'all') return null;
  const source = timetableSource(scopeKey, schoolId, platformSession);
  const params = new URLSearchParams(search);
  const campuses = [...params.getAll('campus'), ...params.getAll('schoolId')];
  if (!source || !campuses.length || campuses.some(id => id !== schoolId)) return null;
  const coursePath = source === 'school' ? '/course/' : '/classroom/course/';
  const eligible = todos.filter(todo =>
    todo.href?.startsWith(coursePath) && (source !== 'school' || todo.schoolId === schoolId) &&
    !leavingTodoIds?.includes(todo.id),
  );
  const priority = pickTodayPriority(classes, eligible, now);
  if (priority?.kind !== 'deadline-during-class') return null;
  const { todo } = priority;
  const label = workLabel(todo, coursePath);
  if (!label || !todo.href || !todo.courseId || todo.dueAt === null) return null;
  const content = (
    <section className={styles.reminder} aria-labelledby="today-priority-title" data-testid="today-priority-reminder">
      <h2 id="today-priority-title" className={styles.reminderKind}>nuni 提醒</h2>
      <p className={styles.reminderTitle}>{priority.title}</p>
      <p className={styles.reminderReason}>{priority.reason}</p>
      <Link className={styles.reminderLink} href={campusServiceHref(todo.href, buildCampusNavigationSearch(params))}
        aria-label={label + '：' + todo.title + '，' + todo.courseName + '，' + formatClock(todo.dueAt) + ' 截止'}>
        {label}
      </Link>
    </section>
  );
  return source === 'platform' && platformSession ? (
    <ReviewedStudentWork key={JSON.stringify([scopeKey, platformSession.context, todo.id])}
      context={platformSession.context} schoolId={schoolId} workspaceId={todo.courseId} todo={todo}>
      {content}
    </ReviewedStudentWork>
  ) : content;
}
