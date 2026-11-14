'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { TodayClassRows } from './TodayClassRows';
import { buildPersonalToday } from '@campus/shared';
import {
  formatTodayHeaderDate,
  TODAY_COPY,
  formatTodoDueLine,
  sortTodayClasses,
  sortTodayTodos,
  type TodayClass,
  type TodayTodo,
} from '@campus/shared/src/pickNextAction';
import type { HomeCourse } from '@/lib/homeOverview';
import { usePersonalImportScope } from '@/lib/usePersonalImports';
import { usePersonalTodayRecords } from '@/lib/usePersonalTodayRecords';
import {
  TEACHER_TODAY_DUE_TITLE,
  TEACHER_TODAY_EMPTY_GRADING,
  TEACHER_TODAY_GRADING_TITLE,
  TEACHER_TODAY_UNSIGNED,
  TODAY_FLOW_CLASS_TITLE,
} from '@/lib/todayCourseWork';
import { assignmentHref, courseWeekHref, todayClassesFromSchedule } from '@/lib/todayScreen';
import styles from './StudentToday.module.css';

const TEACHING_ROLES = new Set(['owner', 'instructor', 'moderator', 'owner-teacher', 'co-teacher']);

export function isTeachingCourse(course: Pick<HomeCourse, 'role'>): boolean {
  return TEACHING_ROLES.has(course.role);
}

type Props = {
  assistant?: ReactNode;
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
  assistant,
  now,
  unsigned,
  classes,
  teachingCourses,
  upcomingTodos,
  timetableHref,
  importHref,
}: Props) {
  const sortedClasses = sortTodayClasses(classes, now);
  const todos = sortTodayTodos(upcomingTodos).slice(0, 5);

  return (
    <div className={styles.screen} data-testid="teacher-today">
      <header className={styles.header}>
        <h1 className={styles.title}>今天</h1>
        <p className={styles.date}>{formatTodayHeaderDate(now)}</p>
      </header>
      {unsigned ? (
        <>
          <p className={styles.empty}>{TEACHER_TODAY_UNSIGNED}</p>
          {assistant}
        </>
      ) : (
        <div className={styles.flow}>
          <section className={styles.section} aria-labelledby="teacher-class-title">
            <div className={styles.sectionHeading}>
              <h2 id="teacher-class-title" className={styles.sectionTitle}>
                {TODAY_FLOW_CLASS_TITLE}
              </h2>
              <Link className={styles.sectionLink} href={timetableHref}>
                {TODAY_COPY.viewFullTimetable}
              </Link>
            </div>
            {sortedClasses.length === 0 ? (
              <p className={styles.empty}>
                今天沒有排課。 <Link href={timetableHref}>查看課表</Link>
                {' · '}
                <Link href={importHref}>整理課表</Link>
              </p>
            ) : (
              <TodayClassRows classes={sortedClasses} now={now} timetableHref={timetableHref} />
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
                  // School LMS workspaces keep their own destination. nuni courses
                  // open the teacher workspace with assignment management.
                  const courseHref = course.href || courseWeekHref(course.id).replace(/#week$/, '');
                  const href = courseHref.replace(/^\/course\//, '/teacher/course/');
                  return (
                    <li key={course.id}>
                      <Link href={href} className={styles.row}>
                        <span className={styles.rowBody}>
                          <span className={styles.rowTitle}>{course.name}</span>
                          <span className={styles.rowMeta}>
                            開啟課程工作台 · 查看繳交、教材與作業
                          </span>
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
          {assistant}
        </div>
      )}
    </div>
  );
}

type BoundProps = {
  assistant?: ReactNode;
  now: Date | null;
  unsigned: boolean;
  teachingCourses: readonly HomeCourse[];
  upcomingTodos: TodayTodo[];
};

/** Bound teacher today stream using the same personal timetable sources as StudentTodayPage. */
export function TeacherTodayPage(props: BoundProps) {
  const scope = usePersonalImportScope();
  const records = usePersonalTodayRecords();
  const now = props.now ?? new Date();
  const schoolId = records.schoolId || scope.scope.schoolId || 'personal';
  const campusId = schoolId === 'personal' ? 'all' : schoolId;
  const importHref = `/import?kind=timetable&campus=${encodeURIComponent(campusId)}`;
  const timetableHref = `/timetable?campus=${encodeURIComponent(campusId)}`;
  const timetableRecords = [...records.imported.records, ...(records.manual ?? [])].filter(
    (row) => row.kind === 'timetable' && row.schoolId === schoolId,
  );
  const schedule = buildPersonalToday(timetableRecords, {
    schoolId,
    now,
  });
  const classes = todayClassesFromSchedule(schedule.today, now);
  return (
    <TeacherToday
      assistant={props.assistant}
      now={now}
      unsigned={props.unsigned}
      classes={classes}
      teachingCourses={props.teachingCourses}
      upcomingTodos={props.upcomingTodos}
      timetableHref={timetableHref}
      importHref={importHref}
    />
  );
}
