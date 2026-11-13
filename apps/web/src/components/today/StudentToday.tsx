'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { buildPersonalToday } from '@campus/shared';
import {
  formatTodayHeaderDate,
  formatTodoDueLine,
  formatUpcomingDueLine,
  formatUpdatedAt,
  isDueWithinHours,
  isTodoOverdue,
  isSameTaipeiDay,
  pickNextAction,
  sortTodayClasses,
  sortTodayTodos,
  TODAY_COPY,
  type TodayClass,
  type TodayTodo,
} from '@campus/shared/src/pickNextAction';
import { usePersonalImportScope } from '@/lib/usePersonalImports';
import { usePersonalTodayRecords } from '@/lib/usePersonalTodayRecords';
import { TODAY_FLOW_CLASS_TITLE, TODAY_FLOW_WORK_TITLE } from '@/lib/todayCourseWork';
import {
  assignmentHref,
  assignmentSubmitHref,
  todayClassesFromSchedule,
} from '@/lib/todayScreen';
import styles from './StudentToday.module.css';
import { TodayUnreadNotifications } from './TodayUnreadNotifications';
import { TodayClassRows } from './TodayClassRows';
import { TodayWelcome } from './TodayWelcome';
import { CampusPersonalizationSection } from './CampusPersonalizationSection';

export type TimetableStatus = 'loading' | 'ready' | 'error' | 'empty' | 'unsigned-scope';

type Props = {
  assistant?: ReactNode;
  personalization?: ReactNode;
  scopeKey?: string;
  /** The actual personal timetable scope, which can differ from the signed-in school. */
  timetableSchoolId?: string | null;
  now: Date | null;
  updatedAt: Date | null;
  unsigned: boolean;
  skeleton: boolean;
  refreshing?: boolean;
  classes: TodayClass[];
  todos: TodayTodo[];
  timetableStatus: TimetableStatus;
  todosError: string;
  lmsUnconnected: boolean;
  leavingTodoIds?: readonly string[];
  onRetryTimetable: () => void;
  onRetryTodos: () => void;
  importHref: string;
  weekHref: string;
  timetableHref: string;
};

type BoundProps = {
  assistant?: ReactNode;
  now: Date | null;
  updatedAt: Date | null;
  signedIn: boolean;
  unsigned: boolean;
  skeleton: boolean;
  refreshing?: boolean;
  todos: TodayTodo[];
  todosError: string;
  lmsUnconnected: boolean;
  leavingTodoIds?: readonly string[];
  onRetryTodos: () => void;
  timetableRefreshKey?: number;
};

const SCROLL_KEY = 'campus-today-scroll';

export function StudentToday(props: Props) {
  const now = props.now ?? new Date();
  const action = pickNextAction(props.classes, props.todos, now);
  const classes = sortTodayClasses(props.classes, now);
  const todos = sortTodayTodos(props.todos);
  const primaryTodo = !props.unsigned && 'todo' in action ? action.todo : null;
  const orderedTodos = primaryTodo
    ? [primaryTodo, ...todos.filter((item) => item.id !== primaryTodo.id)]
    : todos;
  const primaryLabel =
    action.type === 'overdue'
      ? TODAY_COPY.overdue
      : action.type === 'assignment'
        ? action.todo.dueAt !== null && isSameTaipeiDay(action.todo.dueAt, now.getTime())
          ? TODAY_COPY.dueToday
          : '明天截止'
        : TODAY_COPY.nextAssignment;

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const stored = sessionStorage.getItem(SCROLL_KEY);
      if (stored) window.scrollTo(0, Number(stored) || 0);
    } catch {
      // The page remains usable when the browser blocks session storage.
    }
    const persist = () => {
      try {
        sessionStorage.setItem(SCROLL_KEY, String(window.scrollY));
      } catch {
        // Scroll restoration is optional.
      }
    };
    window.addEventListener('pagehide', persist);
    return () => {
      persist();
      window.removeEventListener('pagehide', persist);
    };
  }, []);

  const schedule = (
    <TodayClassList
      key={'classes:' + (props.scopeKey ?? '')}
      classes={classes}
      timetableSchoolId={props.timetableStatus === 'ready' ? props.timetableSchoolId : null}
      primaryId={action.type === 'class' ? action.class.id : undefined}
      status={props.timetableStatus}
      now={now}
      onRetry={props.onRetryTimetable}
      importHref={props.importHref}
      timetableHref={props.timetableHref}
    />
  );
  const work = (
    <TodoList
      key={'todos:' + (props.scopeKey ?? '')}
      todos={orderedTodos}
      primaryId={primaryTodo?.id}
      primaryLabel={primaryLabel}
      unsigned={props.unsigned}
      error={props.todosError}
      lmsUnconnected={props.lmsUnconnected}
      leavingTodoIds={props.leavingTodoIds}
      now={now}
      onRetry={props.onRetryTodos}
    />
  );

  return (
    <div className={styles.screen} data-testid="student-today">
      <header className={styles.header}>
        <h1 className={styles.title}>今天</h1>
        <p className={styles.date}>{props.now ? formatTodayHeaderDate(props.now) : ''}</p>
      </header>
      {!props.skeleton && props.unsigned && action.type !== 'class' && (
        <TodayWelcome
          importHref={props.importHref}
          timetableHref={props.timetableHref}
          hasTimetable={props.timetableStatus === 'ready'}
        />
      )}
      {!props.skeleton && !props.unsigned && (action.type === 'empty' || action.type === 'allDone') && (
        <div className={styles.dayStatus} data-testid={primaryTodo ? undefined : 'next-action'}>
          <TodayStatus
            finished={action.type === 'allDone'}
            todosError={props.todosError}
            timetableStatus={props.timetableStatus}
            lmsUnconnected={props.lmsUnconnected}
            weekHref={props.weekHref}
          />
        </div>
      )}
      {props.skeleton ? (
        <TodaySkeleton />
      ) : (
        <div className={styles.flow + ' ' + styles.planner} data-testid="today-unified-flow">
          {primaryTodo ? [work, schedule] : [schedule, work]}
          <TodayUnreadNotifications unsigned={props.unsigned} />
        </div>
      )}
      {props.personalization}
      {props.assistant}
      {props.updatedAt || props.refreshing ? (
        <p className={styles.updated} role={props.refreshing ? 'status' : undefined} aria-live="polite">
          {props.refreshing ? '正在更新課程待辦…' : formatUpdatedAt(props.updatedAt!)}
        </p>
      ) : null}
    </div>
  );
}

function TodaySkeleton() {
  return (
    <div className={styles.skeleton} aria-busy="true" data-testid="today-skeleton">
      <span className={styles.bone} />
      <span className={styles.bone + ' ' + styles.boneRow} />
      <span className={styles.bone + ' ' + styles.boneRow} />
      <span className={styles.bone + ' ' + styles.boneRow} />
    </div>
  );
}

function TodayStatus({
  finished,
  todosError,
  timetableStatus,
  lmsUnconnected,
  weekHref,
}: {
  finished: boolean;
  todosError: string;
  timetableStatus: TimetableStatus;
  lmsUnconnected: boolean;
  weekHref: string;
}) {
  if (finished) return <p>{TODAY_COPY.allClassesDone}</p>;
  if (todosError || timetableStatus === 'error') {
    return <p>今天的安排還沒確認完整，請重試下方未讀取完成的資料。</p>;
  }
  if (timetableStatus === 'loading') {
    return <p role="status">正在確認今天的課表…</p>;
  }
  if (timetableStatus === 'unsigned-scope') {
    return <p>先選擇要安排的校園。</p>;
  }
  if (timetableStatus === 'empty') {
    return <p>先加入你的課表，就能查看每天的安排。</p>;
  }
  if (lmsUnconnected) {
    return <Link href="/classroom">查看我的課程</Link>;
  }
  return (
    <>
      <p>{TODAY_COPY.emptyDay}</p>
      <Link href={weekHref}>{TODAY_COPY.viewWeek}</Link>
    </>
  );
}

function TodayClassList({
  classes,
  primaryId,
  status,
  now,
  onRetry,
  importHref,
  timetableHref,
  timetableSchoolId,
}: {
  classes: TodayClass[];
  primaryId?: string;
  status: TimetableStatus;
  now: Date;
  onRetry: () => void;
  importHref: string;
  timetableHref: string;
  timetableSchoolId?: string | null;
}) {
  return (
    <section
      className={styles.section}
      aria-labelledby="today-class-title"
      data-testid="today-classes"
    >
      <div className={styles.sectionHeading}>
        <h2 id="today-class-title" className={styles.sectionTitle}>
          {TODAY_FLOW_CLASS_TITLE}
        </h2>
        {status === 'ready' && (
          <Link className={styles.sectionLink} href={timetableHref}>
            {TODAY_COPY.viewFullTimetable}
          </Link>
        )}
      </div>
      {status === 'loading' ? (
        <div className={styles.skeleton} aria-busy="true">
          <span className={styles.bone} />
          <span className={styles.bone} />
        </div>
      ) : status === 'error' ? (
        <>
          <p className={styles.empty} role="alert">
            {TODAY_COPY.timetableUnavailable}
          </p>
          <button type="button" className={styles.retry} onClick={onRetry}>
            {TODAY_COPY.retry}
          </button>
        </>
      ) : status === 'unsigned-scope' ? (
        <>
          <p className={styles.empty}>先選擇校園，就能查看或建立這所學校的課表。</p>
          <Link className={styles.import} href={timetableHref}>
            選校園、整理課表
          </Link>
        </>
      ) : status === 'empty' ? (
        <>
          <p className={styles.empty}>{TODAY_COPY.noTimetable}</p>
          <Link className={styles.import} href={importHref}>
            {TODAY_COPY.importTimetable}
          </Link>
        </>
      ) : classes.length === 0 ? (
        <p className={styles.empty}>今天沒有排課。</p>
      ) : (
        <TodayClassRows classes={classes} primaryId={primaryId} now={now} timetableHref={timetableHref} timetableSchoolId={timetableSchoolId} />
      )}
    </section>
  );
}

function TodoList({
  todos,
  primaryId,
  primaryLabel,
  unsigned,
  error,
  lmsUnconnected,
  leavingTodoIds,
  now,
  onRetry,
}: {
  todos: TodayTodo[];
  primaryId?: string;
  primaryLabel: string;
  unsigned: boolean;
  error: string;
  lmsUnconnected: boolean;
  leavingTodoIds?: readonly string[];
  now: Date;
  onRetry: () => void;
}) {
  const leaving = useMemo(() => new Set(leavingTodoIds ?? []), [leavingTodoIds]);
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? todos : todos.slice(0, 3);
  const extra = Math.max(0, todos.length - 3);
  return (
    <section className={styles.section} aria-labelledby="today-todo-title" data-testid="today-work">
      <div className={styles.sectionHeading}>
        <h2 id="today-todo-title" className={styles.sectionTitle}>
          {TODAY_FLOW_WORK_TITLE}
        </h2>
        {!unsigned && (
          <Link className={styles.sectionLink} href="/calendar">
            查看行事曆
          </Link>
        )}
      </div>
      {unsigned ? (
        <p className={styles.empty}>
          {TODAY_COPY.unsigned} <Link href="/calendar">也可先查看行事曆與期限</Link>
        </p>
      ) : error ? (
        <>
          <p className={styles.empty} role="alert">
            {error}
          </p>
          <button type="button" className={styles.retry} onClick={onRetry}>
            {TODAY_COPY.retry}
          </button>
        </>
      ) : null}
      {!unsigned && lmsUnconnected && todos.length === 0 ? (
        <p className={styles.empty}>
          還沒有 nuni 課程資料。<Link href="/classroom">加入課程</Link>
          ，加入後作業期限會出現在這裡與行事曆。
        </p>
      ) : !unsigned && !error && !lmsUnconnected && todos.length === 0 ? (
        <p className={styles.empty}>
          目前沒有今日或即將到期的作業。
        </p>
      ) : unsigned || todos.length === 0 ? null : (
        <ul id="today-work-items" className={styles.list} data-testid="today-work-list">
          {visible.map((item) => {
            const overdue = isTodoOverdue(item, now);
            const soon = isDueWithinHours(item, now, 6);
            const primary = item.id === primaryId;
            const dueLine = !overdue && item.dueAt !== null && !isSameTaipeiDay(item.dueAt, now.getTime())
              ? formatUpcomingDueLine(item)
              : formatTodoDueLine(item, now);
            return (
              <li
                key={item.id}
                data-testid={primary ? 'next-action' : undefined}
                className={styles.workItem + (leaving.has(item.id) ? ' ' + styles.leaving : '')}
              >
                <Link
                  href={assignmentHref(item)}
                  className={`${styles.row} ${overdue ? styles.overdue : soon ? styles.dueSoon : ''}`}
                >
                  <span className={styles.rowBody}>
                    {primary && <span className={styles.kind}>{primaryLabel}</span>}
                    <span className={styles.rowTitle}>{item.title}</span>
                    <span className={styles.rowMeta}>{item.courseName}</span>
                    <span className={styles.rowDeadline}>{dueLine}</span>
                  </span>
                </Link>
                {primary && (
                  <Link className={styles.submit} href={assignmentSubmitHref(item)}>
                    {TODAY_COPY.goSubmit}
                  </Link>
                )}
              </li>
            );
          })}
          {extra > 0 ? (
            <li>
              <button
                type="button"
                className={styles.more}
                aria-expanded={expanded}
                aria-controls="today-work-items"
                onClick={() => setExpanded((value) => !value)}
              >
                {expanded ? '收起待辦' : TODAY_COPY.moreTodos(extra)}
              </button>
            </li>
          ) : null}
        </ul>
      )}
    </section>
  );
}

export function StudentTodayPage(props: BoundProps) {
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
  const timetableStatus: TimetableStatus = scope.loading
    ? 'loading'
    : scope.scope.schoolId === 'personal'
      ? 'unsigned-scope'
      : !records.loaded
        ? 'loading'
        : records.error
          ? 'error'
          : timetableRecords.length === 0
            ? 'empty'
            : 'ready';
  const schedule = buildPersonalToday(timetableRecords, {
    schoolId,
    now,
  });
  const classes = todayClassesFromSchedule(schedule.today, now);
  return (
    <StudentToday
      assistant={props.assistant}
      personalization={!scope.loading && props.now ? (
        <CampusPersonalizationSection
          key={scope.scopeKey}
          scope={scope.scope}
          now={props.now}
          events={records.imported.records}
          eventsReady={records.imported.ready}
          eventsError={records.imported.error}
          schoolName={scope.schoolName}
        />
      ) : null}
      scopeKey={records.scopeKey}
      timetableSchoolId={schoolId}
      now={props.now}
      updatedAt={props.updatedAt}
      unsigned={props.unsigned}
      skeleton={props.skeleton}
      refreshing={props.refreshing}
      classes={classes}
      todos={props.todos}
      timetableStatus={timetableStatus}
      todosError={props.todosError}
      lmsUnconnected={props.lmsUnconnected}
      leavingTodoIds={props.leavingTodoIds}
      onRetryTimetable={records.retry}
      onRetryTodos={props.onRetryTodos}
      importHref={importHref}
      weekHref={timetableHref}
      timetableHref={timetableHref}
    />
  );
}
