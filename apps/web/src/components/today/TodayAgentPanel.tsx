'use client';

import { useId } from 'react';
import Link from 'next/link';
import { formatTaipeiDateTime, parseTaipeiInstant } from '@campus/shared/src/taipeiTime';
import { AssistantCardStack } from '@/features/nuni/assistant/AssistantCards';
import { AssistantMarkdown } from '@/features/nuni/assistant/AssistantMarkdown';
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
  pending: 'plan' | 'confirm' | 'reconcile' | 'cancel' | null;
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
};

/** This surface never dispatches an operation on mount or derives authority from a task row. */
export function TodayAgentPanel(props: TodayAgentPanelProps) {
  const titleId = useId();
  const tasksId = useId();
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
  const blocked = waiting || !!props.pending || activePlan || unresolved;
  const completed = cards.length > 0 && calendarOnly && cards.every((card) =>
    props.states[card.mutationId]?.status === 'verified');
  const step = completed ? 3 : cards.length ? 2 : 1;
  const sourceReady = !waiting && (tasks.length > 0 || !props.error);

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
                return (
                  <li key={key} className={styles.task} data-selected={selected || undefined}>
                    <div className={styles.taskContent}>
                      <h3>{task.title}</h3>
                      <p>{task.courseName}</p>
                      <p className={styles.deadline}>{due} 截止</p>
                    </div>
                    <button type="button" className={styles.planButton} disabled={blocked}
                      aria-label={`替「${task.title}」找 30 分鐘準備時間`}
                      onClick={() => props.onPlan(task)}>
                      {props.pending === 'plan' && selected ? '正在安排…' : '找 30 分鐘'}
                    </button>
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

      {props.reply && <div className={styles.result} aria-label="這次代辦結果">
        {props.reply.answer && <div className={styles.answer}><AssistantMarkdown text={props.reply.answer} /></div>}
        {props.reply.steps.length > 0 && <ul className={styles.checks} aria-label="本次已執行的檢查">
          {props.reply.steps.map((item, index) => (
            <li key={`${item.name}:${index}`} data-failed={item.status === 'error' || undefined}>
              {item.status === 'error' ? '這一步尚未完成，請依上方說明處理。' : item.summary}
            </li>
          ))}
        </ul>}
        {calendarOnly ? <AssistantCardStack
          cards={cards}
          states={props.states}
          pending={!!props.pending}
          onConfirm={props.onConfirm}
          onCancel={props.onCancel}
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
