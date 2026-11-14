'use client';

import { useId } from 'react';
import Link from 'next/link';
import { formatTaipeiDateTime, parseTaipeiInstant } from '@campus/shared/src/taipeiTime';
import type { AssistantCourseworkFollowup } from '@campus/shared/src/assistantCourseworkFollowup';
import { AssistantCardStack } from '@/features/nuni/assistant/AssistantCards';
import { AssistantMarkdown } from '@/features/nuni/assistant/AssistantMarkdown';
import { formatEventWhen } from '@/features/nuni/assistant/copy';
import type { V2ActionStates, V2Card, V2Reply } from '@/features/nuni/assistant/types';
import type { HomeTask } from '@/lib/homeOverview';
import styles from './TodayAgentPanel.module.css';

export type TodayAgentPanelProps = {
  tasks: HomeTask[];
  now: Date | null;
  loading?: boolean;
  error?: string;
  selectedTaskId?: string;
  reply?: V2Reply | null;
  states: V2ActionStates;
  pending: 'plan' | 'confirm' | 'reconcile' | 'cancel' | 'followup' | null;
  followups?: AssistantCourseworkFollowup[];
  tracking?: boolean;
  planningBlocked?: boolean;
  onRefreshFollowups?: () => void;
  onPlan: (task: HomeTask) => void;
  onConfirm: (cards: V2Card[]) => void;
  onCancel: (index: number) => void;
  onReconcile: (card: V2Card) => void;
  onRetry?: () => void;
};

/** Presentation identity only; callers pass the original IDs to the action API. */
export function todayAgentTaskKey(task: HomeTask): string {
  return `${task.courseId}:${task.kind ?? 'assignment'}:${task.id}`;
}

const pendingLabels = {
  plan: '正在核對作業期限、已同步課表與個人行程，準備 30 分鐘的安排…',
  confirm: '正在加入行事曆並讀回核對…',
  reconcile: '正在查核原本那筆行程…',
  cancel: '正在取消這份安排…',
  followup: '正在核對已安排的時間與最新作業狀態…',
};

function followupTaskKey(row: AssistantCourseworkFollowup): string | null {
  return row.task ? `${row.task.workspaceId}:${row.task.kind}:${row.task.taskId}` : null;
}

function needsFollowup(row: AssistantCourseworkFollowup): boolean {
  return row.calendar === 'changed' || row.calendar === 'missing' ||
    !['scheduled', 'in_progress', 'submitted', 'not_coursework'].includes(row.status);
}

function followupCopy(row: AssistantCourseworkFollowup): { label: string; note?: string } {
  const work = row.task?.kind === 'quiz' ? '測驗' : '作業';
  switch (row.status) {
    case 'scheduled': return { label: '已安排' };
    case 'in_progress': return { label: '準備時間進行中' };
    case 'elapsed': return { label: '準備時間已結束', note: row.source
      ? `${work}${row.task?.kind === 'quiz' ? '仍待作答' : '仍待繳交'}。`
      : `${work}狀態仍待確認。` };
    case 'source_changed': return { label: `${work}內容或期限有變更`, note: row.source?.dueAt
      ? `目前期限：${formatTaipeiDateTime(row.source.dueAt, { seconds: false })}。請確認原安排是否仍合適。`
      : `請查看${work}的新內容，再確認原安排。` };
    case 'submitted': return { label: row.task?.kind === 'quiz' ? '測驗已作答' : '作業已繳交' };
    case 'closed': return { label: `${work}已停止收件`, note: '請查看課程中的收件狀態，確認後續處理方式。' };
    case 'conflict': return { label: '準備時間與最新安排重疊', note: '請開啟行事曆，確認這段時間的安排。' };
    case 'event_changed': return { label: '原行程有變更', note: '下方保留原準備時間，目前內容請以行事曆為準。' };
    case 'event_missing': return { label: '目前查不到原行程', note: '請查看行事曆，確認這段準備時間。' };
    case 'unavailable': return { label: '最新狀態尚未確認', note: row.calendar === 'matching'
      ? row.source
        ? `${work}與原行程已核對，準備時段仍待確認。`
        : `已核對原行程，${work}資料暫時讀不到。`
      : '先保留上次安排，資料讀取完成後再更新狀態。' };
    case 'not_coursework': return { label: '個人行程紀錄', note: '這筆行程沒有對應的課程待辦。' };
  }
}

function TrackedArrangement({ row, showTitle = false }: {
  row: AssistantCourseworkFollowup;
  showTitle?: boolean;
}) {
  const title = row.source?.title ?? row.event.title;
  const copy = followupCopy(row);
  const calendarNote = ['submitted', 'closed'].includes(row.status)
    ? row.calendar === 'changed'
      ? '原行程有變更，目前內容請以行事曆為準。'
      : row.calendar === 'missing'
        ? '目前查不到原行程，請查看行事曆確認。'
        : null
    : null;
  const time = formatEventWhen({ ...row.event });
  const calendarHref = '/calendar?schoolId=' + encodeURIComponent(row.schoolId) +
    '&eventId=' + encodeURIComponent(row.mutationId);
  // These are the same platform course anchors used by nuniHomeOverview.
  // The source identity comes from the verified follow-up, never a title or a supplied URL.
  const taskHref = row.task
    ? `/classroom/course/${encodeURIComponent(row.task.workspaceId)}#${row.task.kind}-${encodeURIComponent(row.task.taskId)}`
    : null;
  return (
    <div className={styles.followup} role="group" aria-label={`「${title}」的安排追蹤`}
      data-attention={needsFollowup(row) || undefined}>
      {showTitle && <div className={styles.taskContent}>
        <h3>{title}</h3>
        {row.source?.courseName && <p>{row.source.courseName}</p>}
      </div>}
      <p className={styles.followupStatus}>
        <strong>{copy.label}</strong>
        <span>{row.calendar !== 'matching' ? '原準備時間：' : ''}{time}</span>
      </p>
      {copy.note && <p className={styles.followupNote}>{copy.note}</p>}
      {calendarNote && <p className={styles.followupNote}>{calendarNote}</p>}
      <div className={styles.followupActions}>
        <Link href={calendarHref} aria-label={`查看「${title}」的行程`}>
          {row.calendar === 'matching' ? '查看安排' : '查看行事曆'}
        </Link>
        {taskHref && <Link href={taskHref} aria-label={`查看「${title}」的${row.task?.kind === 'quiz' ? '測驗' : '作業'}`}>
          {row.task?.kind === 'quiz' ? '查看測驗' : '查看作業'}
        </Link>}
        <span className={styles.followupChecked}>{formatTaipeiDateTime(row.checkedAt, { seconds: false })} 核對</span>
      </div>
    </div>
  );
}

function matchesTrackedCard(row: AssistantCourseworkFollowup, card: V2Card): boolean {
  if (row.schoolId !== card.schoolId || row.mutationId !== card.mutationId ||
      row.status === 'unavailable' || row.calendar !== 'matching') return false;
  return (['title', 'date', 'allDay', 'endDate', 'startTime', 'endTime', 'location'] as const)
    .every((key) => row.event[key] === card.args[key]);
}

/** This surface never dispatches an operation on mount or derives authority from a task row. */
export function TodayAgentPanel(props: TodayAgentPanelProps) {
  const titleId = useId();
  const tasksId = useId();
  const trackingId = useId();
  const clock = props.now?.getTime();
  const clockReady = typeof clock === 'number' && Number.isFinite(clock);
  const waiting = Boolean(props.loading) || !clockReady;
  const eligible = clockReady
    ? props.tasks.filter((task) => {
      const deadline = task.dueAt ? parseTaipeiInstant(task.dueAt) : null;
      return deadline !== null && deadline > clock;
    }).sort((first, second) =>
      parseTaipeiInstant(first.dueAt!)! - parseTaipeiInstant(second.dueAt!)! ||
      todayAgentTaskKey(first).localeCompare(todayAgentTaskKey(second)))
    : [];
  const seen = new Set<string>();
  const unique = eligible.filter((task) => {
    const key = todayAgentTaskKey(task);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const tasks = unique.slice(0, 3);
  const tracking = !!props.tracking || props.pending === 'followup';
  const followups = props.followups ?? [];
  const taskFollowups = new Map<string, AssistantCourseworkFollowup[]>();
  for (const row of followups) {
    const key = followupTaskKey(row);
    if (key) taskFollowups.set(key, [...(taskFollowups.get(key) ?? []), row]);
  }
  const visibleKeys = new Set(waiting ? [] : tasks.map(todayAgentTaskKey));
  const otherFollowups = followups.filter((row) => {
    const key = followupTaskKey(row);
    return key === null || !visibleKeys.has(key);
  });
  const attentionCount = otherFollowups.filter(needsFollowup).length;
  const cards = props.reply?.cards ?? [];
  const calendarOnly = cards.every((card) => card.tool === 'propose_personal_event');
  const activePlan = cards.some((card) => {
    const state = props.states[card.mutationId];
    return !['verified', 'cancelled', 'superseded'].includes(state?.status ?? '') ||
      (state?.status === 'verified' && (state.local !== 'ready' || !!state.verificationWarning));
  });
  const unresolved = Object.values(props.states).some((state) =>
    ['unknown', 'checking', 'executing', 'conflict', 'absent'].includes(state.status) ||
    (state.status === 'verified' && (state.local !== 'ready' || !!state.verificationWarning)));
  const blocked = waiting || tracking || !!props.planningBlocked || !!props.pending || activePlan || unresolved;
  const completed = cards.length > 0 && calendarOnly && cards.every((card) =>
    props.states[card.mutationId]?.status === 'verified');
  const step = completed ? 3 : cards.length ? 2 : 1;
  const sourceReady = !waiting && (tasks.length > 0 || !props.error);
  const detailedCards = cards.filter((card) => {
    const state = props.states[card.mutationId];
    return card.tool !== 'propose_personal_event' || state?.status !== 'verified' ||
      state.local !== 'ready' || !!state.verificationWarning ||
      !followups.some((row) => matchesTrackedCard(row, card));
  });
  const compacted = cards.length - detailedCards.length;
  const showReply = props.reply && (!calendarOnly || !cards.length || detailedCards.length > 0);

  return (
    <section className={styles.panel} aria-labelledby={titleId}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>nuni 代辦</p>
          <h2 id={titleId} className={styles.title}>替待辦安排時間</h2>
        </div>
        <Link className={styles.settings} href="/settings?section=assistant">代辦權限</Link>
      </header>
      <p className={styles.description}>
        依作業期限、已同步課表與個人行程找出準備時間，確認後替你加入行事曆。
      </p>
      <ol className={styles.progress} aria-label="代辦步驟">
        {['讀取待辦', '安排空檔', '加入行事曆'].map((label, index) => {
          const done = index === 0 ? sourceReady : index === 1 ? cards.length > 0 : completed;
          const current = !completed && (waiting ? index === 0 : props.pending === 'plan' ? index === 1 : index === step);
          return (
            <li key={label} data-state={done ? 'done' : current ? 'current' : 'waiting'}
              aria-current={current ? 'step' : undefined}>
              <span className={styles.stepNumber} aria-hidden="true">{index + 1}</span>
              <span>{label}</span>
            </li>
          );
        })}
      </ol>

      {props.error && <div className={styles.error}>
        <p role="alert">{props.error}</p>
        {props.onRetry && <button type="button" className={styles.textButton}
          disabled={!!props.pending || !!props.loading} onClick={props.onRetry}>
          重新確認資料
        </button>}
      </div>}

      {waiting ? <p className={styles.message} role="status">正在讀取可安排的課程待辦…</p>
        : tasks.length ? (
          <div>
            <p id={tasksId} className={styles.listHeading}>先處理近期截止的事</p>
            <ul className={styles.tasks} aria-labelledby={tasksId}>
              {tasks.map((task) => {
                const key = todayAgentTaskKey(task);
                const selected = props.selectedTaskId === key;
                const due = formatTaipeiDateTime(task.dueAt!, { seconds: false });
                const tracked = taskFollowups.get(key) ?? [];
                return (
                  <li key={key} className={styles.task} data-selected={selected || undefined}>
                    <div className={styles.taskContent}>
                      <h3>{task.title}</h3>
                      <p>{task.courseName}</p>
                      <p className={styles.deadline}>{due} 截止</p>
                      {tracked.map((row) => <TrackedArrangement key={row.mutationId} row={row} />)}
                    </div>
                    {!tracked.length && <button type="button" className={styles.planButton} disabled={blocked}
                      aria-label={`替「${task.title}」找 30 分鐘準備時間`}
                      onClick={() => props.onPlan(task)}>
                      {props.pending === 'plan' && selected ? '正在安排…' : '找 30 分鐘'}
                    </button>}
                  </li>
                );
              })}
            </ul>
            {unique.length > 3 && <p className={styles.message}>
              先列出最接近截止的 3 件，其他 {unique.length - 3} 件可在課程中查看。
            </p>}
          </div>
        ) : !props.error ? (
          <div className={styles.empty}>
            <p>{props.tasks.length
              ? '目前讀到的待辦沒有可提前安排的期限，請先查看作業收件狀態。'
              : '目前讀到的 nuni 課程沒有待安排的作業或測驗。'}</p>
            <Link href="/classroom">查看課程與作業</Link>
          </div>
        ) : null}

      {props.pending ? <p className={styles.pending} role="status">{pendingLabels[props.pending]}</p>
        : (activePlan || unresolved) && <p className={styles.message}>
          先完成或取消下方安排，再選下一件。結果尚未確認時，請先核對原操作。
        </p>}

      {otherFollowups.length > 0 && <details className={styles.recent}>
        <summary className={styles.recentSummary}>
          <span>最近安排（{otherFollowups.length}）</span>
          {attentionCount > 0 && <span className={styles.needsAttention}>需要確認 {attentionCount} 件</span>}
        </summary>
        <ul className={styles.recentList} aria-label="最近安排的追蹤狀態">
          {otherFollowups.map((row) => <li key={row.mutationId}>
            <TrackedArrangement row={row} showTitle />
          </li>)}
        </ul>
      </details>}

      {(followups.length > 0 || tracking) && <div className={styles.trackingFooter}>
        <p id={trackingId} className={styles.followupNote}>
          {tracking ? '正在核對這台裝置保留的安排…' : '這台裝置保留的安排，會在開啟首頁或回到前景時核對。'}
        </p>
        {props.onRefreshFollowups && <button type="button" className={styles.textButton}
          aria-describedby={trackingId} disabled={!!props.pending}
          onClick={props.onRefreshFollowups}>更新安排狀態</button>}
      </div>}

      {compacted > 0 && <p className={styles.compactReceipt} role="status">
        已儲存並核對的 {compacted} 筆安排，最新狀態已列入追蹤。
      </p>}

      {showReply && props.reply && <div className={styles.result} aria-label="這次代辦結果">
        {props.reply.answer && <div className={styles.answer}><AssistantMarkdown text={props.reply.answer} /></div>}
        {props.reply.steps.length > 0 && <ul className={styles.checks} aria-label="本次已執行的檢查">
          {props.reply.steps.map((item, index) => (
            <li key={`${item.name}:${index}`} data-failed={item.status === 'error' || undefined}>
              {item.status === 'error' ? '這一步尚未完成，請依上方說明處理。' : item.summary}
            </li>
          ))}
        </ul>}
        {calendarOnly ? <AssistantCardStack
          cards={detailedCards}
          states={props.states}
          pending={!!props.pending}
          onConfirm={props.onConfirm}
          onCancel={(index) => {
            const originalIndex = cards.indexOf(detailedCards[index]);
            if (originalIndex >= 0) props.onCancel(originalIndex);
          }}
          onReconcile={props.onReconcile}
          allowBatchConfirmation={false}
        /> : <p role="alert">這份安排無法核對為個人行程，請重新確認資料。</p>}
        {calendarOnly && cards.map((card, index) => {
          const action = props.states[card.mutationId];
          return action?.status === 'absent' && !action.retryable ? <div key={card.mutationId} className={styles.message}>
            <p>這份確認已無法繼續。可以請系統核對能否停止原提議，再重新安排。</p>
            <button type="button" className={styles.textButton} disabled={!!props.pending}
              onClick={() => props.onCancel(index)}>停止這份未完成安排</button>
          </div> : null;
        })}
      </div>}
      <p className={styles.source}>
        來源：目前帳號的 nuni 課程待辦。規劃時會重新核對課程、已同步課表與個人行程。
      </p>
    </section>
  );
}
