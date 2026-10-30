'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { buildPersonalToday } from '@campus/shared';
import {
  formatClassMeta,
  formatTodayHeaderDate,
  formatTodoDueLine,
  formatUpcomingDueLine,
  formatUpdatedAt,
  isDueWithinHours,
  isTodoOverdue,
  pickNextAction,
  sortTodayClasses,
  sortTodayTodos,
  TODAY_COPY,
  type NextAction,
  type TodayClass,
  type TodayTodo,
} from '@campus/shared/src/pickNextAction';
import { usePersonalImportScope } from '@/lib/usePersonalImports';
import { usePersonalTodayRecords } from '@/lib/usePersonalTodayRecords';
import type { HomeCourse } from '@/lib/homeOverview';
import {
  assignmentHref,
  assignmentSubmitHref,
  courseWeekHref,
  todayClassesFromSchedule,
} from '@/lib/todayScreen';
import styles from './StudentToday.module.css';
import { TodayWelcome } from './TodayWelcome';

export type TimetableStatus = 'loading' | 'ready' | 'error' | 'empty' | 'unsigned-scope';

type Props = {
  scopeKey?: string;
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
  now: Date | null;
  updatedAt: Date | null;
  signedIn: boolean;
  unsigned: boolean;
  skeleton: boolean;
  refreshing?: boolean;
  todos: TodayTodo[];
  courses: readonly HomeCourse[];
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
  const visibleClasses = classes.slice(0, 4);
  const extraClasses = classes.length > 4;

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

  return (
    <div className={styles.screen} data-testid="student-today">
      <header className={styles.header}>
        <p className={styles.date}>{props.now ? formatTodayHeaderDate(props.now) : ''}</p>
        <h1 className={styles.title}>今天</h1>
        {props.updatedAt || props.refreshing ? (
          <p
            className={styles.updated}
            role={props.refreshing ? 'status' : undefined}
            aria-live="polite"
          >
            {props.refreshing ? '正在更新課程待辦…' : formatUpdatedAt(props.updatedAt!)}
          </p>
        ) : null}
      </header>
      {props.skeleton ? (
        <TodaySkeleton />
      ) : (
        <>
          {props.unsigned && action.type !== 'class' ? (
            <TodayWelcome
              importHref={props.importHref}
              timetableHref={props.timetableHref}
              hasTimetable={props.timetableStatus === 'ready'}
            />
          ) : (
            <NextActionCard
              key={`action:${props.scopeKey ?? ''}`}
              action={action}
              unsigned={props.unsigned}
              todosError={props.todosError}
              timetableStatus={props.timetableStatus}
              lmsUnconnected={props.lmsUnconnected}
              now={now}
              weekHref={props.weekHref}
            />
          )}
          <div className={styles.columns}>
            <TodayClassList
              classes={visibleClasses}
              extra={extraClasses}
              status={props.timetableStatus}
              now={now}
              onRetry={props.onRetryTimetable}
              importHref={props.importHref}
              timetableHref={props.timetableHref}
            />
            <TodoList
              key={`todos:${props.scopeKey ?? ''}`}
              todos={todos}
              unsigned={props.unsigned}
              error={props.todosError}
              lmsUnconnected={props.lmsUnconnected}
              leavingTodoIds={props.leavingTodoIds}
              now={now}
              onRetry={props.onRetryTodos}
            />
          </div>
        </>
      )}
    </div>
  );
}

function TodaySkeleton() {
  return (
    <div className={styles.skeleton} aria-busy="true" data-testid="today-skeleton">
      <span className={`${styles.bone} ${styles.boneCard}`} />
      <span className={styles.bone} />
      <span className={styles.bone} />
      <span className={styles.bone} />
    </div>
  );
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

function NextActionCard({
  action,
  unsigned,
  todosError,
  timetableStatus,
  lmsUnconnected,
  now,
  weekHref,
}: {
  action: NextAction;
  unsigned: boolean;
  todosError: string;
  timetableStatus: TimetableStatus;
  lmsUnconnected: boolean;
  now: Date;
  weekHref: string;
}) {
  const incomingKey = actionKey(action, unsigned);
  const [shown, setShown] = useState({ action, unsigned });
  const [visible, setVisible] = useState(true);
  const shownKey = actionKey(shown.action, shown.unsigned);
  const renderCurrent =
    incomingKey === shownKey || unsigned !== shown.unsigned || !isContentKey(incomingKey);
  const displayed = renderCurrent ? { action, unsigned } : shown;

  useEffect(() => {
    if (incomingKey === shownKey) {
      if (shown.action !== action || shown.unsigned !== unsigned) setShown({ action, unsigned });
      setVisible(true);
      return;
    }
    const animate =
      unsigned === shown.unsigned &&
      !prefersReducedMotion() &&
      isContentKey(shownKey) &&
      isContentKey(incomingKey);
    if (!animate) {
      setShown({ action, unsigned });
      setVisible(true);
      return;
    }
    setVisible(false);
    let frame = 0;
    const timer = window.setTimeout(() => {
      setShown({ action, unsigned });
      frame = window.requestAnimationFrame(() => {
        frame = window.requestAnimationFrame(() => setVisible(true));
      });
    }, 150);
    return () => {
      window.clearTimeout(timer);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [incomingKey, shownKey, action, unsigned, shown.action, shown.unsigned]);

  return (
    <div
      className={`${cardTone(displayed.action, displayed.unsigned)} ${styles.fade} ${renderCurrent || visible ? '' : styles.fadeOut}`}
      data-testid="next-action"
    >
      <NextActionBody
        action={displayed.action}
        unsigned={displayed.unsigned}
        todosError={todosError}
        timetableStatus={timetableStatus}
        lmsUnconnected={lmsUnconnected}
        now={now}
        weekHref={weekHref}
      />
    </div>
  );
}

function cardTone(action: NextAction, unsigned: boolean): string {
  if (unsigned && action.type !== 'class') return styles.cardLight;
  if (action.type === 'empty' || (action.type === 'allDone' && !action.todo))
    return styles.cardLight;
  return styles.card;
}

function NextActionBody({
  action,
  unsigned,
  todosError,
  timetableStatus,
  lmsUnconnected,
  now,
  weekHref,
}: {
  action: NextAction;
  unsigned: boolean;
  todosError: string;
  timetableStatus: TimetableStatus;
  lmsUnconnected: boolean;
  now: Date;
  weekHref: string;
}) {
  if (unsigned && action.type !== 'class') {
    return <p className={styles.headline}>{TODAY_COPY.unsigned}</p>;
  }

  if (action.type === 'empty') {
    if (todosError || timetableStatus === 'error') {
      return (
        <>
          <p className={styles.headline}>今天的安排還沒確認完整</p>
          <p className={styles.meta}>請重新讀取下方未完成的資料，再確認課程與待辦。</p>
        </>
      );
    }
    if (timetableStatus === 'loading') {
      return (
        <p className={styles.headline} role="status">
          正在確認今天的課表…
        </p>
      );
    }
    if (timetableStatus === 'unsigned-scope') {
      return (
        <>
          <p className={styles.headline}>先選擇要安排的校園</p>
          <p className={styles.meta}>課表會依校園分開保存，切換後就能查看對應的安排。</p>
        </>
      );
    }
    if (timetableStatus === 'empty') {
      return (
        <>
          <p className={styles.headline}>先加入你的課表</p>
          <p className={styles.meta}>匯入課表後，就能在這裡確認今天的上課安排。</p>
        </>
      );
    }
    if (lmsUnconnected) {
      return (
        <>
          <p className={styles.headline}>到課程空間查看待辦</p>
          <p className={styles.meta}>在 nuni 課程空間加入課堂，查看作業與測驗。</p>
          <Link className={styles.action} href="/classroom">
            查看我的課程
          </Link>
        </>
      );
    }
    return (
      <>
        <p className={styles.headline}>{TODAY_COPY.emptyDay}</p>
        <Link className={styles.action} href={weekHref}>
          {TODAY_COPY.viewWeek}
        </Link>
      </>
    );
  }

  if (action.type === 'allDone' && !action.todo) {
    return <p className={styles.headline}>{TODAY_COPY.allClassesDone}</p>;
  }

  if (action.type === 'allDone' && action.todo) {
    return (
      <>
        <Link href={assignmentHref(action.todo)} className={styles.cardMain}>
          <p className={styles.kind}>{TODAY_COPY.allClassesDone}</p>
          <p className={styles.headline}>{action.todo.title}</p>
          <p className={styles.meta}>{formatTodoDueLine(action.todo, now)}</p>
        </Link>
        <Link className={styles.action} href={assignmentSubmitHref(action.todo)}>
          {TODAY_COPY.goSubmit}
        </Link>
      </>
    );
  }

  if (action.type === 'class') {
    const href = courseWeekHref(action.class.courseId);
    return (
      <>
        <Link href={href} className={styles.cardMain}>
          <p className={styles.kind}>{TODAY_COPY.nextClass}</p>
          <p className={styles.headline}>{action.class.title}</p>
          <p className={styles.meta}>{formatClassMeta(action.class)}</p>
        </Link>
        <Link className={styles.action} href={href}>
          {TODAY_COPY.viewCourse}
        </Link>
      </>
    );
  }

  if (action.type !== 'assignment' && action.type !== 'overdue' && action.type !== 'upcoming')
    return null;

  return (
    <>
      <Link href={assignmentHref(action.todo)} className={styles.cardMain}>
        <p className={styles.kind}>
          {action.type === 'overdue'
            ? TODAY_COPY.overdue
            : action.type === 'upcoming'
              ? TODAY_COPY.nextAssignment
              : TODAY_COPY.dueToday}
        </p>
        <p className={styles.headline}>{action.todo.title}</p>
        <p className={`${styles.meta} ${action.type === 'overdue' ? styles.metaDanger : ''}`}>
          {action.type === 'upcoming'
            ? formatUpcomingDueLine(action.todo)
            : formatTodoDueLine(action.todo, now)}
        </p>
      </Link>
      <Link className={styles.action} href={assignmentSubmitHref(action.todo)}>
        {TODAY_COPY.goSubmit}
      </Link>
    </>
  );
}

function actionKey(action: NextAction, unsigned: boolean): string {
  if (unsigned && action.type !== 'class') return 'unsigned';
  if (action.type === 'class') return `class:${action.class.id}`;
  if (action.type === 'assignment') return `todo:${action.todo.id}`;
  if (action.type === 'upcoming') return `upcoming:${action.todo.id}`;
  if (action.type === 'overdue') return `overdue:${action.todo.id}`;
  if (action.type === 'allDone') return `done:${action.todo?.id ?? ''}`;
  return 'empty';
}

function isContentKey(key: string): boolean {
  return (
    key.startsWith('class:') ||
    key.startsWith('todo:') ||
    key.startsWith('upcoming:') ||
    key.startsWith('overdue:') ||
    key.startsWith('done:')
  );
}

function TodayClassList({
  classes,
  extra,
  status,
  now,
  onRetry,
  importHref,
  timetableHref,
}: {
  classes: TodayClass[];
  extra: boolean;
  status: TimetableStatus;
  now: Date;
  onRetry: () => void;
  importHref: string;
  timetableHref: string;
}) {
  return (
    <section className={styles.section} aria-labelledby="today-class-title">
      <h2 id="today-class-title" className={styles.sectionTitle}>
        今天課表
      </h2>
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
        <ul className={styles.list}>
          {classes.map((item) => {
            const ended = item.endAt <= now.getTime();
            const href = courseWeekHref(item.courseId);
            return (
              <li key={item.id}>
                <Link
                  href={href}
                  className={`${styles.row} ${styles.withTime} ${ended ? styles.ended : ''}`}
                  style={{ minHeight: 56 }}
                >
                  <span className={styles.time}>{formatClassMeta(item).split('・')[0]}</span>
                  <span className={styles.rowBody}>
                    <span className={styles.rowTitle}>{item.title}</span>
                    <span className={styles.rowMeta}>{item.location || '教室未填'}</span>
                  </span>
                </Link>
              </li>
            );
          })}
          {extra ? (
            <li>
              <Link className={styles.more} href={timetableHref}>
                {TODAY_COPY.viewFullTimetable}
              </Link>
            </li>
          ) : null}
        </ul>
      )}
    </section>
  );
}

function TodoList({
  todos,
  unsigned,
  error,
  lmsUnconnected,
  leavingTodoIds,
  now,
  onRetry,
}: {
  todos: TodayTodo[];
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
      <h2 id="today-todo-title" className={styles.sectionTitle}>
        待處理
      </h2>
      {unsigned ? (
        <p className={styles.empty}>{TODAY_COPY.unsigned}</p>
      ) : error ? (
        <>
          <p className={styles.empty} role="alert">
            {error}
          </p>
          <button type="button" className={styles.retry} onClick={onRetry}>
            {TODAY_COPY.retry}
          </button>
        </>
      ) : lmsUnconnected && todos.length === 0 ? (
        <p className={styles.empty}>{TODAY_COPY.lmsUnconnected}</p>
      ) : todos.length === 0 ? null : (
        <ul id="today-work-items" className={styles.list} data-testid="today-work-list">
          {visible.map((item) => {
            const overdue = isTodoOverdue(item, now);
            const soon = isDueWithinHours(item, now, 6);
            return (
              <li key={item.id} className={leaving.has(item.id) ? styles.leaving : undefined}>
                <Link
                  href={assignmentHref(item)}
                  className={`${styles.row} ${overdue ? styles.overdue : soon ? styles.dueSoon : ''}`}
                >
                  <span className={styles.rowBody}>
                    <span className={styles.rowTitle}>{item.title}</span>
                    <span className={styles.rowMeta}>
                      {item.courseName} · {formatTodoDueLine(item, now)}
                    </span>
                  </span>
                </Link>
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
  const classes = todayClassesFromSchedule(schedule.today, now, props.courses);
  return (
    <StudentToday
      scopeKey={records.scopeKey}
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
