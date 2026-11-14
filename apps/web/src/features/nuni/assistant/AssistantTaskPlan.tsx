import Link from 'next/link';
import { parseAssistantCalendarReceipt } from '@campus/shared/src/assistantExecution';
import { getAssistantService } from '@campus/shared/src/assistantServices';
import { parseAssistantTaskPlan, type AssistantTaskStep } from '@campus/shared/src/assistantTaskPlan';
import { inAppHref } from './copy';
import type { V2ActionState, V2ActionStates, V2Card } from './types';
import styles from './AssistantTaskPlan.module.css';

type DisplayStatus = AssistantTaskStep['status'] | 'working' | 'unknown' | 'stopped';
type DisplayStep = { step: AssistantTaskStep; status: DisplayStatus; summary: string };

const STATUS_LABELS: Record<DisplayStatus, string> = {
  completed: '已完成',
  ready: '待確認',
  partial: '部分完成',
  blocked: '尚未完成',
  handoff: '開啟服務',
  working: '核對中',
  unknown: '待核對',
  stopped: '已停止',
};

function actionStatus(card: V2Card, state: V2ActionState | undefined): DisplayStatus {
  if (!state) return 'ready';
  if (state.status === 'verified') {
    // Only a receipt for this exact calendar card establishes completion.
    // A page handoff or a receipt belonging to another task cannot do so.
    if (card.tool !== 'propose_personal_event') return 'unknown';
    try {
      parseAssistantCalendarReceipt(state.receipt, {
        schoolId: card.schoolId, mutationId: card.mutationId, event: card.args, storage: 'synced',
      });
    } catch {
      return 'unknown';
    }
    return state.verificationWarning ? 'unknown' : 'completed';
  }
  if (state.status === 'handoff')
    return card.tool === 'propose_open_page' || card.tool === 'propose_food_order' ? 'handoff' : 'unknown';
  if (state.status === 'executing' || state.status === 'checking') return 'working';
  if (state.status === 'unknown' || state.status === 'conflict') return 'unknown';
  if (state.status === 'cancelled' || state.status === 'superseded') return 'stopped';
  return 'blocked';
}

function displayStep(step: AssistantTaskStep, cards: V2Card[], states: V2ActionStates): DisplayStep {
  const ids = step.cardIds ?? [];
  if (!ids.length) return step.status === 'ready'
    ? { step, status: 'blocked', summary: '確認內容尚未備妥，請重新提出這個任務。' }
    : { step, status: step.status, summary: step.summary };
  const selected = ids.map((id) => cards.filter((card) => card.mutationId === id));
  if (selected.some((matches) => matches.length !== 1 ||
      !['propose_personal_event', 'propose_food_order', 'propose_open_page'].includes(matches[0].tool))) {
    return { step, status: 'blocked', summary: '無法對應這個任務的確認內容，請重新核對。' };
  }
  const entries = selected.map(([card]) => {
    const state = Object.prototype.hasOwnProperty.call(states, card.mutationId) ? states[card.mutationId] : undefined;
    return { state, status: actionStatus(card, state) };
  });
  const count = (status: DisplayStatus) => entries.filter((entry) => entry.status === status).length;
  const completed = count('completed');
  const prefix = completed ? `已讀回核對 ${completed}/${entries.length} 筆個人行程。` : '';
  if (completed === entries.length) {
    const localPending = entries.some(({ state }) => state?.status === 'verified' && state.local === 'unavailable');
    return { step, status: step.status === 'partial' ? 'partial' : 'completed',
      summary: prefix + (localPending ? '帳號已儲存，此裝置尚未更新。' : '已加入個人行事曆。') +
        (step.status === 'partial' ? `原任務仍有未完成部分：${step.summary}` : '') };
  }
  if (count('working')) return { step, status: 'working', summary: prefix + '正在核對原操作的執行結果。' };
  if (count('unknown')) return { step, status: completed ? 'partial' : 'unknown',
    summary: prefix + '另有操作結果尚未核對，請從下方確認卡查核原結果。' };
  if (count('stopped') === entries.length) return { step, status: 'stopped',
    summary: '這份提議已撤銷或被新提議取代，沒有刪除已建立的行程。' };
  if (count('handoff') === entries.length) return { step, status: 'handoff',
    summary: '服務入口已備妥，請在服務頁面完成後續操作。' };
  if (completed || count('handoff') || count('stopped')) return { step, status: 'partial',
    summary: prefix + '其餘操作尚未完成，請逐項查看下方確認卡。' };
  if (count('blocked')) return { step, status: 'blocked',
    summary: '這一步尚未完成，請查看下方確認卡的原因。' };
  return { step, status: step.status === 'partial' ? 'partial' : 'ready', summary: step.summary };
}

/** The task list describes results; all confirmations remain in the existing cards. */
export function AssistantTaskPlan({ plan, cards, states }: {
  plan: unknown;
  cards: V2Card[];
  states: V2ActionStates;
}) {
  const parsed = parseAssistantTaskPlan(plan);
  if (!parsed?.steps.length) return null;
  const steps = parsed.steps.map((step) => displayStep(step, cards, states));
  const completed = steps.filter((step) => step.status === 'completed').length;
  const ready = steps.filter((step) => step.status === 'ready').length;
  return <section className={styles.plan} aria-label="跨功能任務步驟">
    <div className={styles.header}>
      <h3>這次任務</h3>
      <p role="status" aria-live="polite" aria-atomic="true">
        已完成 {completed}/{steps.length} 項{ready ? ` · ${ready} 項待確認` : ''}
      </p>
    </div>
    <ol className={styles.steps}>
      {steps.map(({ step, status, summary }, index) => {
        const href = status === 'handoff' && step.href ? inAppHref(step.href) : null;
        const service = getAssistantService(step.serviceId);
        return <li key={step.id} className={styles.step} data-status={status}>
          <span className={styles.number} aria-hidden="true">{index + 1}</span>
          <div className={styles.body}>
            <div className={styles.stepHeading}>
              <h4>{step.label}</h4>
              <span className={styles.status}>{STATUS_LABELS[status]}</span>
            </div>
            <p className={styles.summary}>{summary}</p>
            {href && service && <Link className={styles.link} href={href}>開啟{service.label}</Link>}
          </div>
        </li>;
      })}
    </ol>
  </section>;
}
