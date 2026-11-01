'use client';

import Link from 'next/link';
import { StudyDeadlineExport } from './StudyDeadlineExport';
import { useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { NuniError, nuniErrorMessage, type NuniWorkspace } from '@campus/shared/src/nuni';
import {
  loadNuniStudyAgenda,
  sortStudyTasks,
  recommendStudyFocus,
  studyTaskStatus,
  studyTaskTiming,
  type NuniStudyAgenda,
  type NuniStudyTask,
} from '@campus/shared/src/nuniStudyAgenda';
import { formatTaipeiDateTime, parseTaipeiInstant } from '@campus/shared/src/taipeiTime';
import { CampusIcon } from '@/components/CampusIcon';
import { useClientNow } from '@/lib/useMaterialClientState';
import { useClasses } from './CourseUI';
import { useNuniSession } from './Session';
import { classroomCourseHref, replaceStudyQuery, type StudyAgendaFilter } from './studyNavigation';
import shared from './NuniApp.module.css';
import styles from './StudyWorkspace.module.css';

const filterLabels: [StudyAgendaFilter, string][] = [
  ['pending', '待完成'],
  ['overdue', '已過參考時間'],
  ['submitted', '已繳交／作答'],
  ['closed', '已停止收件'],
  ['all', '全部'],
];

function matches(task: NuniStudyTask, filter: StudyAgendaFilter, now: number) {
  const status = studyTaskStatus(task);
  const timing = studyTaskTiming(task, now);
  switch (filter) {
    case 'pending':
      return status === 'pending';
    case 'overdue':
      return status === 'pending' && timing === 'overdue';
    case 'soon':
      return status === 'pending' && (timing === 'today' || timing === 'week');
    case 'feedback':
      return status === 'feedback';
    case 'submitted':
      return status === 'submitted' || status === 'feedback';
    case 'closed':
      return status === 'closed';
    default:
      return true;
  }
}

function TaskRow({ task, now, context }: { task: NuniStudyTask; now: number; context: string }) {
  const status = studyTaskStatus(task);
  const timing = studyTaskTiming(task, now);
  const pending = status === 'pending';
  const statusLabel =
    status === 'feedback'
      ? '老師已回饋'
      : status === 'submitted'
        ? task.kind === 'assignment'
          ? '已繳交'
          : '已作答'
        : status === 'closed'
          ? task.kind === 'assignment'
            ? '已停止收件 · 未繳交'
            : '已結束 · 未作答'
          : task.kind === 'assignment'
            ? '待繳交'
            : '待作答';
  const due =
    task.dueAt && parseTaipeiInstant(task.dueAt) !== null
      ? formatTaipeiDateTime(task.dueAt, { seconds: false })
      : null;
  return (
    <li className={styles.taskRow} data-urgency={pending ? timing : 'none'}>
      <span className={styles.taskIcon} aria-hidden="true">
        <CampusIcon name={task.kind === 'assignment' ? 'orders' : 'calendar'} size={19} />
      </span>
      <div className={styles.taskBody}>
        <div className={styles.taskMeta}>
          <span>{task.courseTitle}</span>
          <span aria-hidden="true">·</span>
          <span>{task.kind === 'assignment' ? '作業' : '測驗'}</span>
        </div>
        <Link className={styles.taskTitle} href={classroomCourseHref(task.courseId, context, task)}>
          {task.title}
        </Link>
        <div className={styles.taskDetails}>
          <span className={styles.status} data-state={status}>
            {statusLabel}
          </span>
          <span className={pending && timing === 'overdue' ? styles.overdue : undefined}>
            {due
              ? `${pending && timing === 'overdue' ? '已過建議時間' : pending && timing === 'today' ? '建議今天完成' : '建議完成'} · ${due}`
              : '未設定完成時間'}
          </span>
        </div>
        {task.submittedAt && (
          <p className={styles.receiptTime}>
            {task.kind === 'quiz' ? '作答紀錄' : '繳交紀錄'}：{formatTaipeiDateTime(task.submittedAt, { seconds: false })}
          </p>
        )}
        {status === 'feedback' && task.feedback && (
          <p className={styles.feedbackPreview}>{task.feedback}</p>
        )}
      </div>
      <Link
        className={styles.taskAction}
        href={classroomCourseHref(task.courseId, context, task)}
        aria-label={`${status === 'feedback' ? '查看回饋' : pending ? (task.kind === 'assignment' ? '前往繳交' : '前往作答') : '查看紀錄'}：${task.title}`}
      >
        <span>
          {status === 'feedback'
            ? '看回饋'
            : pending
              ? task.kind === 'assignment' ? '去繳交' : '去作答'
              : '看紀錄'}
        </span>
        <CampusIcon name="arrow" size={16} />
      </Link>
    </li>
  );
}

export function StudyAgenda({
  workspaces,
  filter,
  onFilter,
  context,
}: {
  workspaces: NuniWorkspace[];
  filter: StudyAgendaFilter;
  onFilter: (filter: StudyAgendaFilter) => void;
  context: string;
}) {
  const classes = useClasses();
  const params = useSearchParams();
  const { refresh } = useNuniSession();
  const api = useRef(classes);
  const refreshSession = useRef(refresh);
  const [snapshot, setSnapshot] = useState<{ key: string; data: NuniStudyAgenda } | null>(null);
  const [reading, setReading] = useState(true);
  const [error, setError] = useState('');
  const [epoch, setEpoch] = useState(0);
  const [visibleLimit, setVisibleLimit] = useState(6);
  const [taskCourse, setTaskCourse] = useState(() => params.get('taskCourse') || 'all');
  const now = useClientNow() ?? 0;
  const membershipKey = workspaces
    .map((item) => `${item.id}:${item.memberRole}:${item.state}:${item.title}`)
    .sort()
    .join('|');
  const data = snapshot?.key === membershipKey ? snapshot.data : null;
  const taskCourseFromUrl = params.get('taskCourse');

  useEffect(() => {
    api.current = classes;
    refreshSession.current = refresh;
  });
  useEffect(() => {
    setTaskCourse(taskCourseFromUrl || 'all');
  }, [taskCourseFromUrl]);
  useEffect(() => {
    let active = true;
    setReading(true);
    setError('');
    void loadNuniStudyAgenda(api.current, workspaces, { cancelled: () => !active })
      .then((result) => {
        if (active && result !== 'cancelled') setSnapshot({ key: membershipKey, data: result });
      })
      .catch((failure: unknown) => {
        if (!active) return;
        setSnapshot(null);
        setError(nuniErrorMessage(failure));
        if (
          failure instanceof NuniError &&
          (failure.status === 401 || failure.code === 'SESSION_CHANGED')
        )
          void refreshSession.current();
      })
      .finally(() => {
        if (active) setReading(false);
      });
    return () => {
      active = false;
    };
  }, [workspaces, epoch, membershipKey]);

  const studentCourses = workspaces.filter(
    (course) => course.state === 'active' && course.memberRole === 'student',
  );
  const tasks = data?.tasks ?? [];
  const selectedCourse =
    taskCourse === 'all' || studentCourses.some((item) => item.id === taskCourse)
      ? taskCourse
      : 'all';
  const chooseCourse = (value: string) => {
    setTaskCourse(value);
    setVisibleLimit(6);
    replaceStudyQuery('taskCourse', value, 'all');
  };
  const taskContext = new URLSearchParams(context);
  if (selectedCourse !== 'all') taskContext.set('taskCourse', selectedCourse);
  else taskContext.delete('taskCourse');
  const scopedTasks =
    selectedCourse === 'all' ? tasks : tasks.filter((item) => item.courseId === selectedCourse);
  const shown = sortStudyTasks(
    scopedTasks.filter((task) => matches(task, filter, now)),
    now,
  );
  const failedCourseIds =
    data?.failedCourseIds.filter((id) => selectedCourse === 'all' || id === selectedCourse) ?? [];
  const limitedCourseIds =
    data?.limitedCourseIds.filter((id) => selectedCourse === 'all' || id === selectedCourse) ?? [];
  const partial = failedCourseIds.length > 0 || limitedCourseIds.length > 0;
  const focus = data && now > 0 ? recommendStudyFocus(scopedTasks, now) : [];
  const chooseFilter = (next: StudyAgendaFilter) => {
    setVisibleLimit(6);
    onFilter(next);
  };
  const count = (value: StudyAgendaFilter) =>
    scopedTasks.filter((task) => matches(task, value, now)).length;

  if (!studentCourses.length) return null;

  return (
    <section className={styles.agenda} aria-labelledby="study-agenda-title" aria-busy={reading}>
      <div className={styles.sectionHeading}>
        <div>
          <p className={styles.kicker}>課業待辦</p>
          <h2 id="study-agenda-title">接下來要做的事</h2>
        </div>
        <button
          type="button"
          className={styles.textButton}
          disabled={reading}
          onClick={() => setEpoch((value) => value + 1)}
        >
          {reading ? '更新中…' : '更新待辦'}
        </button>
      </div>
      <div className={styles.metrics} role="group" aria-label="待辦快速篩選">
        {(
          [
            ['pending', '待完成'],
            ['overdue', '已過參考時間'],
            ['soon', '未來七天'],
            ['feedback', '老師回饋'],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            aria-pressed={filter === value}
            onClick={() => chooseFilter(value)}
            disabled={!data}
          >
            <span>{label}</span>
            <strong>{data ? `${count(value)}${partial ? '+' : ''}` : '—'}</strong>
            <CampusIcon name="arrow" size={16} />
          </button>
        ))}
      </div>
      {focus.length > 0 && (
        <section className={styles.focusPanel} aria-label="今日優先課業">
          <div className={styles.focusHeading}>
            <div>
              <p className={styles.kicker}>下一步</p>
              <h3>建議先處理這 {focus.length} 件</h3>
            </div>
            <p>
              依已載入的待辦、參考時間與跨課程分布排列。
              {partial ? '部分課程資料尚未完整，這不是所有課程的最終排序。' : ''}
            </p>
          </div>
          <div className={styles.focusGrid}>
            {focus.map(({ task, timing }, index) => (
              <Link
                key={`${task.courseId}:${task.kind}:${task.id}`}
                className={styles.focusItem}
                data-urgency={timing}
                href={classroomCourseHref(task.courseId, taskContext.toString(), task)}
                aria-label={`優先處理第 ${index + 1} 件：${task.title}`}
              >
                <div className={styles.focusItemTop}>
                  <span className={styles.focusPosition}>{String(index + 1).padStart(2, '0')}</span>
                  <span className={styles.focusReason}>
                    {timing === 'overdue'
                      ? '已過參考時間 · 仍可開啟'
                      : timing === 'today'
                        ? '建議今天完成'
                        : timing === 'week'
                          ? '未來七天內'
                          : timing === 'later'
                            ? '較晚到期'
                            : '未設定參考時間'}
                  </span>
                </div>
                <strong>{task.title}</strong>
                <span className={styles.focusCourse}>{task.courseTitle} · {task.kind === 'assignment' ? '作業' : '測驗'}</span>
                <span className={styles.focusAction}>
                  {task.kind === 'assignment' ? '前往繳交' : '前往作答'}
                  <CampusIcon name="arrow" size={16} />
                </span>
              </Link>
            ))}
          </div>
          <p className={styles.focusDisclaimer}>
            只安排已確認仍開放的課業，參考時間不等於停止收件；實際作答與繳交結果以伺服器回執為準。
          </p>
        </section>
      )}
      <div className={styles.agendaToolbar}>
        <div className={styles.segmented} role="group" aria-label="篩選課業待辦">
          {filterLabels.map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={filter === value}
              onClick={() => chooseFilter(value)}
            >
              {label}
            </button>
          ))}
        </div>
        {studentCourses.length > 1 && (
          <label className={styles.courseSelect}>
            <span className={styles.srOnly}>待辦課程</span>
            <select value={selectedCourse} onChange={(event) => chooseCourse(event.target.value)}>
              <option value="all">所有修習課程</option>
              {studentCourses.map((course) => (
                <option key={course.id} value={course.id}>
                  {course.title}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      {filter === 'soon' || filter === 'feedback' || filter === 'overdue' ? (
        <p className={styles.filterContext}>
          目前顯示：
          {filter === 'soon'
            ? '今天起未來七天內建議完成的項目'
            : filter === 'overdue'
              ? '已過參考時間、但仍可開啟處理的項目；是否接受補交由課程老師決定'
              : '老師已留下回饋的項目'}
          <button
            type="button"
            className={styles.textButton}
            onClick={() => chooseFilter('pending')}
          >
            回到待完成
          </button>
        </p>
      ) : null}
      {reading && (
        <div className={styles.loading} role="status">
          正在整理各門課的作業與測驗…
        </div>
      )}
      {error && (
        <div className={shared.notice} role="alert">
          {error}
          <button
            type="button"
            className={`${shared.button} ${shared.secondary}`}
            onClick={() => setEpoch((value) => value + 1)}
          >
            重試待辦
          </button>
        </div>
      )}
      {data && failedCourseIds.length > 0 && (
        <div className={styles.partialNotice} role="status">
          有 {failedCourseIds.length} 門課未能完整讀取，以下只顯示已確認的項目。
          <button
            type="button"
            className={styles.textButton}
            disabled={reading}
            onClick={() => setEpoch((value) => value + 1)}
          >
            重試
          </button>
        </div>
      )}
      {data && limitedCourseIds.length > 0 && (
        <p className={styles.partialNotice}>
          有 {limitedCourseIds.length}{' '}
          門課達到目前的顯示上限；數量只計入已載入項目，較早的紀錄可能未列出。
        </p>
      )}
      {!reading && !error && data && (
        <StudyDeadlineExport
          key={`${membershipKey}:${selectedCourse}:${epoch}`}
          tasks={scopedTasks}
          partial={partial}
          retry={() => setEpoch((value) => value + 1)}
        />
      )}
      {!reading && data && shown.length === 0 && (
        <div className={styles.empty} role="status">
          <CampusIcon name="calendar" size={26} />
          <h3>
            {partial
              ? '已載入的項目中沒有符合的待辦'
              : filter === 'pending'
                ? '目前沒有待完成的項目'
                : '這個分類還沒有項目'}
          </h3>
          <p>
            {partial
              ? '還有部分課程尚未確認，請重試或進入課程查看。'
              : filter === 'pending'
                ? '可以接著閱讀教材，或切換分類查看繳交紀錄與老師回饋。'
                : '試著查看全部項目，或切換其他課程。'}
          </p>
          {(filter !== 'all' || selectedCourse !== 'all') && (
            <button
              type="button"
              className={styles.textButton}
              onClick={() => {
                chooseFilter('all');
                chooseCourse('all');
              }}
            >
              查看全部項目
            </button>
          )}
        </div>
      )}
      {data && shown.length > 0 && (
        <>
          <ul className={styles.taskList}>
            {shown.slice(0, visibleLimit).map((task) => (
              <TaskRow
                key={`${task.courseId}:${task.kind}:${task.id}`}
                task={task}
                now={now}
                context={taskContext.toString()}
              />
            ))}
          </ul>
          <div className={styles.listFooter}>
            <span>
              顯示 {Math.min(visibleLimit, shown.length)} / {shown.length} 項
              {partial ? '（已載入）' : ''}
            </span>
            {shown.length > visibleLimit ? (
              <button
                type="button"
                className={styles.textButton}
                onClick={() => setVisibleLimit((value) => value + 12)}
              >
                再顯示 12 項
              </button>
            ) : shown.length > 6 ? (
              <button
                type="button"
                className={styles.textButton}
                onClick={() => setVisibleLimit(6)}
              >
                收合清單
              </button>
            ) : null}
          </div>
        </>
      )}
      <p className={styles.agendaNote}>
        依實際繳交紀錄顯示狀態。超過建議完成時間的項目，只要老師尚未停止收件，仍可開啟處理。
      </p>
    </section>
  );
}
