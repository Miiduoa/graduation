'use client';

import Link from 'next/link';
import {
  formatClassMeta,
  formatTodoDueLine,
  sortTodayClasses,
  sortTodayTodos,
  type TodayClass,
  type TodayTodo,
} from '@campus/shared/src/pickNextAction';
import type { HomeCourse } from '@/lib/homeOverview';
import {
  TEACHER_TODAY_DUE_TITLE,
  TEACHER_TODAY_EMPTY_GRADING,
  TEACHER_TODAY_GRADING_TITLE,
  TEACHER_TODAY_UNSIGNED,
  TODAY_FLOW_CLASS_TITLE,
} from '@/lib/todayCourseWork';
import { assignmentHref, courseWeekHref } from '@/lib/todayScreen';
import styles from './StudentToday.module.css';

const TEACHING_ROLES = new Set([
  'owner',
  'instructor',
  'moderator',
  'owner-teacher',
  'co-teacher',
]);

export function isTeachingCourse(course: Pick<HomeCourse, 'role'>): boolean {
  return TEACHING_ROLES.has(course.role);
}

type Props = {
  now: Date;
  unsigned: boolean;
  classes: TodayClass[];
  teachingCourses: readonly HomeCourse[];
  upcomingTodos: TodayTodo[];
  timetableHref: string;
  importHref: string;
};

/** Teacher-facing today stream: classes, grading entry points, upcoming student work. */
export function TeacherToday({
  now,
  unsigned,
  classes,
  teachingCourses,
  upcomingTodos,
  timetableHref,
  importHref,
}: Props) {
  const sortedClasses = sortTodayClasses(classes, now).slice(0, 4);
  const todos = sortTodayTodos(upcomingTodos).slice(0, 5);

  return (
    <div className={styles.screen} data-testid="teacher-today">
      <header className={styles.header}>
        <h1 className={styles.title}>今天</h1>
        <p className={styles.updated}>授課視角：今天的課、待批改入口與即將到期作業。</p>
      </header>
      {unsigned ? (
        <p className={styles.empty}>{TEACHER_TODAY_UNSIGNED}</p>
      ) : (
        <div className={styles.flow}>
          <section className={styles.section} aria-labelledby="teacher-class-title">
            <h2 id="teacher-class-title" className={styles.sectionTitle}>
              {TODAY_FLOW_CLASS_TITLE}
            </h2>
            {sortedClasses.length === 0 ? (
              <p className={styles.empty}>
                今天沒有排課。{' '}
                <Link href={timetableHref}>查看課表</Link>
                {' · '}
                <Link href={importHref}>整理課表</Link>
              </p>
            ) : (
              <ul className={styles.list}>
                {sortedClasses.map((item) => {
                  const href = courseWeekHref(item.courseId);
                  return (
                    <li key={item.id}>
                      <Link href={href} className={`${styles.row} ${styles.withTime}`}>
                        <span className={styles.time}>{formatClassMeta(item).split('・')[0]}</span>
                        <span className={styles.rowBody}>
                          <span className={styles.rowTitle}>{item.title}</span>
                          <span className={styles.rowMeta}>{item.location || '教室未填'}</span>
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section className={styles.section} aria-labelledby="teacher-grading-title">
            <h2 id="teacher-grading-title" className={styles.sectionTitle}>
              {TEACHER_TODAY_GRADING_TITLE}
            </h2>
            {teachingCourses.length === 0 ? (
              <p className={styles.empty}>{TEACHER_TODAY_EMPTY_GRADING}</p>
            ) : (
              <ul className={styles.list}>
                {teachingCourses.map((course) => {
                  const href =
                    course.href ||
                    courseWeekHref(course.id).replace(/#week$/, '') ||
                    `/teacher/course/${encodeURIComponent(course.id)}`;
                  return (
                    <li key={course.id}>
                      <Link href={href} className={styles.row}>
                        <span className={styles.rowBody}>
                          <span className={styles.rowTitle}>{course.name}</span>
                          <span className={styles.rowMeta}>查看繳交、教材與作業</span>
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section className={styles.section} aria-labelledby="teacher-due-title">
            <h2 id="teacher-due-title" className={styles.sectionTitle}>
              {TEACHER_TODAY_DUE_TITLE}
            </h2>
            {todos.length === 0 ? (
              <p className={styles.empty}>目前沒有即將到期的學生作業。</p>
            ) : (
              <ul className={styles.list}>
                {todos.map((item) => (
                  <li key={item.id}>
                    <Link href={assignmentHref(item)} className={styles.row}>
                      <span className={styles.rowBody}>
                        <span className={styles.rowTitle}>{item.title}</span>
                        <span className={styles.rowMeta}>
                          {item.courseName} · {formatTodoDueLine(item, now)}
                        </span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
