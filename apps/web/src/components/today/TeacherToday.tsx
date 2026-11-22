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
import { TEACHER_TODAY_DUE_TITLE, TODAY_FLOW_CLASS_TITLE } from '@/lib/todayCourseWork';
import { assignmentHref, courseWeekHref, todayClassesFromSchedule } from '@/lib/todayScreen';
import styles from './StudentToday.module.css';

const TEACHING_ROLES = new Set(['owner', 'instructor', 'moderator', 'owner-teacher', 'co-teacher']);

export function isTeachingCourse(course: Pick<HomeCourse, 'role'>): boolean {
  return TEACHING_ROLES.has(course.role);
}

type Props = {
  assistant?: ReactNode;
  workspaces?: ReactNode;
  now: Date;
  unsigned: boolean;
  classes: TodayClass[];
  timetableStatus: 'loading' | 'ready' | 'error' | 'empty' | 'unsigned-scope';
  timetableSchoolId?: string | null;
  timetableScopeKey?: string;
  onRetryTimetable: () => void;
  teachingCourses: readonly HomeCourse[];
  upcomingTodos: TodayTodo[];
  coursesLoading: boolean;
  coursesError: string;
  onRetryCourses: () => void;
  timetableHref: string;
  importHref: string;
};

/** Teacher-facing timetable, course workspaces, and upcoming assignments. */
export function TeacherToday({
  assistant,
  workspaces,
  now,
  unsigned,
  classes,
  timetableStatus,
  timetableSchoolId,
  timetableScopeKey,
  onRetryTimetable,
  teachingCourses,
  upcomingTodos = [],
  coursesLoading,
  coursesError,
  onRetryCourses,
  timetableHref,
  importHref,
}: Props) {
  const sortedClasses = sortTodayClasses(classes, now);
  const courses = teachingCourses.filter(isTeachingCourse);
  const todos = sortTodayTodos(upcomingTodos).slice(0, 5);

  return (
    <div className={styles.screen} data-testid="teacher-today">
      <header className={styles.header}>
        <h1 className={styles.title}>今天</h1>
        <p className={styles.date}>{formatTodayHeaderDate(now)}</p>
      </header>
      {workspaces}
      {unsigned ? (
        <>
          <p className={styles.empty}>登入後，接續你的課表與已獲授權的授課課程。</p>
          {assistant}
        </>
      ) : (
        <div className={styles.flow}>
          <section
            className={styles.section}
            aria-labelledby="teacher-class-title"
            aria-busy={timetableStatus === 'loading'}
          >
            <div className={styles.sectionHeading}>
              <h2 id="teacher-class-title" className={styles.sectionTitle}>
                {TODAY_FLOW_CLASS_TITLE}
              </h2>
              <Link className={styles.sectionLink} href={timetableHref}>
                {TODAY_COPY.viewFullTimetable}
              </Link>
            </div>
            {timetableStatus === 'error' && (
              <>
                <p className={styles.empty} role="alert">
                  {TODAY_COPY.timetableUnavailable}
                </p>
                <button type="button" className={styles.retry} onClick={onRetryTimetable}>
                  重新讀取課表
                </button>
              </>
            )}
            {timetableStatus === 'loading' ? (
              <p className={styles.empty} role="status">
                正在確認今天的課表…
              </p>
            ) : timetableStatus === 'unsigned-scope' ? (
              <>
                <p className={styles.empty}>先選擇校園，就能查看或建立這所學校的課表。</p>
                <Link className={styles.import} href={timetableHref}>
                  選校園、整理課表
                </Link>
              </>
            ) : timetableStatus === 'empty' ? (
              <>
                <p className={styles.empty}>還沒有課表，加入上課時間後就能查看每天的安排。</p>
                <Link className={styles.import} href={importHref}>
                  匯入我的課表
                </Link>
              </>
            ) : sortedClasses.length > 0 ? (
              <TodayClassRows
                key={timetableScopeKey ?? timetableSchoolId}
                classes={sortedClasses}
                now={now}
                timetableHref={timetableHref}
                timetableSchoolId={timetableSchoolId}
              />
            ) : timetableStatus === 'ready' ? (
              <p className={styles.empty}>
                今天沒有排課。 <Link href={timetableHref}>查看課表</Link>
                {' · '}
                <Link href={importHref}>整理課表</Link>
              </p>
            ) : null}
          </section>

          <section
            className={styles.section}
            aria-labelledby="teacher-grading-title"
            aria-busy={coursesLoading}
          >
            <h2 id="teacher-grading-title" className={styles.sectionTitle}>
              授課課程
            </h2>
            <p className={styles.empty}>進入課程，查看學生繳交、批改作業與整理教材。</p>
            {coursesLoading && (
              <p className={styles.empty} role="status">
                正在確認授課課程…
              </p>
            )}
            {coursesError && (
              <>
                <p className={styles.empty} role="alert">
                  {coursesError}
                </p>
                <button
                  type="button"
                  className={styles.retry}
                  onClick={onRetryCourses}
                  disabled={coursesLoading}
                >
                  {coursesLoading ? '重新讀取中…' : '重新讀取授課課程'}
                </button>
              </>
            )}
            {!coursesLoading && !coursesError && courses.length === 0 && (
              <p className={styles.empty}>目前沒有已確認的授課課程，請確認登入帳號與課程權限。</p>
            )}
            {courses.length > 0 && (
              <ul className={styles.list}>
                {courses.map((course) => {
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

          {todos.length > 0 && (
            <section className={styles.section} aria-labelledby="teacher-due-title">
              <h2 id="teacher-due-title" className={styles.sectionTitle}>
                {TEACHER_TODAY_DUE_TITLE}
              </h2>
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
            </section>
          )}
          {assistant}
        </div>
      )}
    </div>
  );
}

type BoundProps = {
  assistant?: ReactNode;
  workspaces?: ReactNode;
  now: Date | null;
  unsigned: boolean;
  teachingCourses: readonly HomeCourse[];
  upcomingTodos: TodayTodo[];
  coursesLoading: boolean;
  coursesError: string;
  onRetryCourses: () => void;
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
  const timetableStatus: Props['timetableStatus'] =
    scope.loading || !records.loaded
      ? 'loading'
      : records.error
        ? 'error'
        : scope.scope.schoolId === 'personal' && classes.length === 0
          ? 'unsigned-scope'
          : timetableRecords.length === 0
            ? 'empty'
            : 'ready';
  return (
    <TeacherToday
      assistant={props.assistant}
      workspaces={props.workspaces}
      now={now}
      unsigned={props.unsigned}
      classes={classes}
      timetableStatus={timetableStatus}
      timetableSchoolId={schoolId}
      timetableScopeKey={records.scopeKey}
      onRetryTimetable={records.retry}
      teachingCourses={props.teachingCourses}
      upcomingTodos={props.upcomingTodos}
      coursesLoading={props.coursesLoading}
      coursesError={props.coursesError}
      onRetryCourses={props.onRetryCourses}
      timetableHref={timetableHref}
      importHref={importHref}
    />
  );
}
