'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { parseAssistantCalendarExecutionResult } from '@campus/shared/src/assistantExecution';
import { parseAssistantFoodPickupTarget, type AssistantFoodPickupTarget } from '@campus/shared/src/assistantFoodPickupTarget';
import { toPublicSchoolId } from '@campus/shared/src/schoolIds';
import { NuniNextStep } from '@/components/NuniNextStep';
import { useAssistantEnabled } from '@/components/AssistantEnabledProvider';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Input';
import { assertAssistantCalendarLocalReady, mirrorAssistantCalendarReceipt } from '@/lib/assistantCalendarExecution';
import { readAssistantExecutionJournal, saveAssistantExecutionJournal, removeAssistantExecutionJournal } from '@/lib/assistantExecutionJournal';
import { AssistantCard } from '@/features/nuni/assistant/AssistantCards';
import { calendarExpectation, canConfirmAction, withAssistantRequestDeadline } from '@/features/nuni/assistant/execution';
import type { V2ActionState, V2ActionStates, V2Card, V2Reply } from '@/features/nuni/assistant/types';
import { foodPickupRecovery, parseFoodPickupReply } from './foodPickupEvidence';
import styles from './FoodPickupAgent.module.css';

type Props = {
  context: string;
  accountId: string;
  tenantId: string;
  schoolId: string;
  orderId: string;
  available: boolean;
  suggestion: string | null;
};
type Scope = { context: string; accountId: string; schoolId: string };
type Run = { controller: AbortController; busy: boolean };
type Pending = 'pickup-plan' | 'confirm' | 'cancel' | 'reconcile' | null;
type State = { ready: boolean; planning: boolean; writes: boolean; pending: Pending; error: string; reply: V2Reply | null;
  states: V2ActionStates; expiresAt: number | null; otherPending: boolean };
const initial = (): State => ({ ready: false, planning: false, writes: false, pending: null, error: '', reply: null,
  states: {}, expiresAt: null, otherPending: false });
const sameCard = (left: V2Card, right: V2Card) => left.token === right.token && left.mutationId === right.mutationId &&
  left.schoolId === right.schoolId && left.conversationId === right.conversationId && JSON.stringify(left.args) === JSON.stringify(right.args);
const settled = (state?: V2ActionState) => state?.status === 'cancelled' ||
  (state?.status === 'verified' && state.local === 'ready' && !state.verificationWarning);
const MARGIN = 15_000;

function ScopedFoodPickupAgent({ scope, ...props }: Props & { scope: Scope }) {
  const [state, render] = useState<State>(initial);
  const [minutes, setMinutes] = useState('15');
  const current = useRef(state), lifetime = useRef<Run | null>(null);
  const route = useRef<{ conversationId: string; token: string } | null>(null);
  const dispatched = useRef(new Set<string>());
  const available = useRef(props.available);
  useLayoutEffect(() => { available.current = props.available; }, [props.available]);
  const target = { tenantId: props.tenantId, orderId: props.orderId, durationMinutes: Number(minutes) };
  const localScope = { owner: 'platform:' + scope.accountId, schoolId: scope.schoolId };
  const journalScope = { ...localScope, context: scope.context };
  const active = (run: Run) => lifetime.current === run && !run.controller.signal.aborted;
  const update = (run: Run, change: Partial<State>) => {
    if (!active(run)) return;
    current.current = { ...current.current, ...change };
    render(current.current);
  };
  const action = (run: Run, card: V2Card, value: V2ActionState) =>
    update(run, { states: { ...current.current.states, [card.mutationId]: value } });
  const begin = (pending: Pending, needReady = true) => {
    const run = lifetime.current;
    if (!run || !active(run) || run.busy || (needReady && !current.current.ready)) return null;
    run.busy = true;
    update(run, { pending, error: '' });
    return run;
  };
  const finish = (run: Run) => { run.busy = false; update(run, { pending: null }); };
  async function send(run: Run, name: Exclude<Pending, null> | 'capability', body?: Record<string, unknown>) {
    return withAssistantRequestDeadline(run.controller.signal, name === 'pickup-plan' ? 25000 : 15000, async signal => {
      const response = await fetch('/api/nuni/assistant/' + name, {
        method: body ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal,
        headers: { 'X-Campus-Session': scope.context, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify({ schoolId: scope.schoolId, ...body }) } : {}),
      });
      const raw: unknown = await response.json();
      if (!active(run) || signal.aborted) throw new Error('這次操作已停止。');
      if (!response.ok) {
        const message = raw && typeof raw === 'object' && 'message' in raw && typeof raw.message === 'string'
          ? raw.message : response.status === 403 ? '目前沒有使用這項操作的權限，請確認助理設定與原訂單。'
            : response.status === 401 || response.status === 409 ? '登入狀態、訂單或確認內容已變更，請核對原操作後再試。'
              : '暫時無法完成取餐安排，請稍後再試。';
        throw new Error(message);
      }
      return raw as Record<string, unknown>;
    });
  }
  const sendCard = (run: Run, name: 'confirm' | 'cancel' | 'reconcile', card: V2Card) =>
    send(run, name, { conversationId: card.conversationId, token: card.token, args: card.args });
  function journal(run: Run, planning = false): V2Card[] | null {
    const result = foodPickupRecovery(readAssistantExecutionJournal(journalScope), target);
    update(run, { otherPending: result.otherPending });
    if (result.cards.some(card => !current.current.reply?.cards.some(existing => sameCard(existing, card)))) {
      update(run, { reply: { answer: '已找回這筆訂單上次的安排，先核對原操作結果再繼續。',
        cards: result.cards, steps: [], dataRead: true }, expiresAt: null,
        states: Object.fromEntries(result.cards.map(card => [card.mutationId,
          current.current.states[card.mutationId] ?? { status: 'unknown', message: '上次操作尚待核對。' }])) });
      return null;
    }
    if (planning && (result.cards.length || result.otherPending)) {
      update(run, { error: '還有行程結果待核對，請先確認原操作，再準備新的取餐安排。' });
      return null;
    }
    return result.cards;
  }
  function forget(run: Run, card: V2Card) {
    try { removeAssistantExecutionJournal(journalScope, card.mutationId, () => active(run)); }
    catch (error) { update(run, { error: error instanceof Error ? error.message : '行程紀錄尚未完成核對。' }); }
  }
  async function apply(run: Run, card: V2Card, raw: unknown) {
    if (!active(run)) return;
    const result = parseAssistantCalendarExecutionResult(raw, calendarExpectation(card));
    if (result.status === 'verified') {
      let message = '';
      try { await mirrorAssistantCalendarReceipt(result, localScope, () => active(run)); }
      catch (error) { message = error instanceof Error ? error.message : '此裝置尚未更新，請重新核對。'; }
      if (!active(run)) return;
      action(run, card, { status: 'verified', receipt: result, local: message ? 'unavailable' : 'ready',
        ...(message ? { localMessage: message } : {}) });
      if (!message) {
        forget(run, card);
        const reply = current.current.reply;
        if (reply?.cards.every(value => current.current.states[value.mutationId]?.status === 'verified'))
          update(run, { reply: { ...reply, answer: '已核對原取餐行程的儲存結果。' } });
      }
    } else if (result.status === 'revoked') {
      action(run, card, { status: 'cancelled' });
      forget(run, card);
    } else if (result.status === 'conflict') {
      action(run, card, { status: 'conflict', message: '原行程與這份安排不一致，請先到行事曆核對。' });
    } else action(run, card, { status: 'absent', retryable: result.retryable,
      message: result.retryable ? '尚未找到這筆行程，可以重試原確認。'
        : '沒有找到相符行程，這份確認已無法執行。請停止原提議後重新預覽。' });
  }
  async function check(run: Run, card: V2Card) {
    const previous = current.current.states[card.mutationId];
    action(run, card, previous?.status === 'verified' ? { ...previous, verificationWarning: '正在重新核對原行程。' } : { status: 'checking' });
    update(run, { pending: 'reconcile' });
    try { await apply(run, card, await sendCard(run, 'reconcile', card)); }
    catch {
      action(run, card, previous?.status === 'verified' ? { ...previous, verificationWarning: '這次查核未完成，保留上次核對結果。' }
        : { status: 'unknown', message: '執行結果尚未確認，請核對原操作，避免重複新增。' });
    }
  }
  async function initialize(run: Run) {
    try {
      const result = foodPickupRecovery(readAssistantExecutionJournal(journalScope), target);
      update(run, { otherPending: result.otherPending });
      if (result.cards.length) {
        journal(run);
        for (const card of result.cards) { if (!active(run)) return; await check(run, card); }
      }
      const capability = await send(run, 'capability');
      update(run, { ready: true, planning: capability.enabled === true && capability.version === 2 && capability.planning === true,
        writes: capability.writesEnabled === true });
    } catch (error) { update(run, { error: error instanceof Error ? error.message : '暫時無法確認取餐安排。' }); }
    finally { finish(run); }
  }
  useEffect(() => {
    const run = { controller: new AbortController(), busy: true };
    lifetime.current = run;
    void Promise.resolve().then(() => { if (active(run)) void initialize(run); });
    return () => run.controller.abort();
    // Scope and source form the component key; late replies cannot cross either boundary.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  function expire(run: Run): boolean {
    const until = current.current.expiresAt;
    if (until === null || Date.now() < until - MARGIN) return false;
    const cards = current.current.reply?.cards ?? [];
    const entries = journal(run);
    if (!entries || cards.some(card => dispatched.current.has(card.mutationId)) || entries.length) return false;
    update(run, { expiresAt: null, reply: { answer: '這份預覽已過期，請重新核對取餐時間。', cards: [], steps: [], dataRead: true }, states: {} });
    return true;
  }
  useEffect(() => {
    const run = lifetime.current;
    if (!run || state.expiresAt === null || state.pending) return;
    const timer = setTimeout(() => { if (active(run) && !run.busy) {
      try { expire(run); } catch (error) { update(run, { error: error instanceof Error ? error.message : '原操作尚待核對。' }); }
    } }, Math.max(0, state.expiresAt - MARGIN - Date.now()));
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.expiresAt, state.pending]);
  async function handlePrepare() {
    if (!available.current || !current.current.planning || !current.current.writes ||
        current.current.reply?.cards.some(card => !settled(current.current.states[card.mutationId]))) return;
    const run = begin('pickup-plan');
    if (!run) return;
    try {
      if (!journal(run, true)) return;
      const selection = parseAssistantFoodPickupTarget(target);
      let binding = route.current;
      let raw = await send(run, 'pickup-plan', { conversationId: binding?.conversationId ?? crypto.randomUUID(),
        ...(binding ? { routeToken: binding.token } : {}), target: selection });
      if (raw.bootstrap === true) {
        if (typeof raw.conversationId !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(raw.conversationId) ||
            typeof raw.routeToken !== 'string' || !/^[A-Za-z0-9_.-]{1,2048}$/.test(raw.routeToken))
          throw new Error('取餐安排的連線無法核對，請重試。');
        binding = { conversationId: raw.conversationId, token: raw.routeToken };
        route.current = binding;
        raw = await send(run, 'pickup-plan', { conversationId: binding.conversationId, routeToken: binding.token, target: selection });
      }
      if (!binding) throw new Error('取餐安排的連線尚未確認，請重試。');
      const reply = parseFoodPickupReply(raw, scope.schoolId, binding.conversationId, selection);
      // This runs only after the explicit preview click and its awaited response, never during render.
      // eslint-disable-next-line react-hooks/purity
      if (reply.cards.length && (!Number.isSafeInteger(raw.expiresAt) || Number(raw.expiresAt) <= Date.now() + MARGIN))
        throw new Error('這份預覽已過期，請重新核對取餐時間。');
      update(run, { reply, states: {}, expiresAt: reply.cards.length ? Number(raw.expiresAt) : null });
    } catch (error) { route.current = null; update(run, { error: error instanceof Error ? error.message : '取餐安排未完成，請重試。' }); }
    finally { finish(run); }
  }
  async function confirm(card: V2Card) {
    if (!available.current || !current.current.writes || !current.current.reply?.cards.some(value => sameCard(value, card)) ||
        !canConfirmAction(current.current.states[card.mutationId])) return;
    const run = begin('confirm');
    if (!run) return;
    try {
      if (!journal(run) || current.current.otherPending || expire(run)) return;
      await assertAssistantCalendarLocalReady(card.args, localScope, () => active(run));
      if (!active(run) || !available.current || !journal(run) || current.current.otherPending || expire(run)) return;
      saveAssistantExecutionJournal(journalScope, { conversationId: card.conversationId!, card }, () => active(run));
      dispatched.current.add(card.mutationId);
      action(run, card, { status: 'executing' });
      try { await apply(run, card, await sendCard(run, 'confirm', card)); }
      catch { if (active(run)) await check(run, card); }
    } catch (error) { action(run, card, { status: 'blocked', message: error instanceof Error ? error.message : '尚未送出，請先核對裝置資料。' }); }
    finally { finish(run); }
  }
  async function reconcile(card: V2Card) {
    if (!current.current.reply?.cards.some(value => sameCard(value, card))) return;
    const run = begin('reconcile', false);
    if (!run) return;
    try { await check(run, card); } finally { finish(run); }
  }
  async function cancel(card: V2Card) {
    if (!current.current.reply?.cards.some(value => sameCard(value, card))) return;
    const previous = current.current.states[card.mutationId];
    if (previous && !['blocked', 'absent'].includes(previous.status)) return;
    const run = begin('cancel', false);
    if (!run) return;
    try {
      const entries = journal(run);
      if (!entries) return;
      if (!dispatched.current.has(card.mutationId) && !entries.some(value => sameCard(value, card))) {
        action(run, card, { status: 'cancelled' });
        update(run, { expiresAt: null });
        return;
      }
      saveAssistantExecutionJournal(journalScope, { conversationId: card.conversationId!, card }, () => active(run));
      dispatched.current.add(card.mutationId);
      try { await apply(run, card, await sendCard(run, 'cancel', card)); }
      catch { if (active(run)) await check(run, card); }
    } catch (error) { update(run, { error: error instanceof Error ? error.message : '原操作仍待核對。' }); }
    finally { finish(run); }
  }
  const open = state.reply?.cards.some(card => !settled(state.states[card.mutationId]));
  if (!props.available && !state.reply && !state.error && !state.otherPending) return null;
  if (!state.ready && !state.reply && !state.error && !state.otherPending) {
    return props.suggestion ? <p role="status">正在確認取餐安排是否可用…</p> : null;
  }
  const showPreview = props.available && !open && !state.reply?.cards.some(card => state.states[card.mutationId]?.status === 'verified');
  const contents = <>
    {showPreview && <div className={styles.controls}>
      <Select label="取餐預留時間" value={minutes} disabled={!!state.pending || !!open}
        options={[5, 10, 15, 20, 30, 60].map(value => ({ value: String(value), label: `${value} 分鐘` }))}
        onChange={event => setMinutes(event.target.value)} />
      <Button onClick={handlePrepare} disabled={!state.ready || !state.planning || !state.writes || !!state.pending || !!open || state.otherPending}>
        預覽這筆取餐安排
      </Button>
    </div>}
    {state.pending && <p role="status">{state.pending === 'pickup-plan' ? '正在核對訂單、課表與個人行程…'
      : state.pending === 'confirm' ? '正在儲存並讀回核對…' : '正在核對原操作結果…'}</p>}
    {state.ready && !state.planning && <p className={styles.note}>目前未開放取餐行程安排。</p>}
    {state.ready && state.planning && !state.writes && <p className={styles.note}>目前未開放儲存行程，先前結果仍可核對。</p>}
    {state.otherPending && <div><p>另有行程尚待核對。<Link href={'/ai-assistant?schoolId=' + encodeURIComponent(scope.schoolId)}>前往助理核對原操作</Link></p>
      <Button disabled={!!state.pending} onClick={() => { const run = begin('reconcile', false); if (run) void initialize(run); }}>重新核對行程狀態</Button>
    </div>}
    {state.error && <div role="alert" className={styles.error}><p>{state.error}</p>
      {!state.ready && <Button disabled={!!state.pending} onClick={() => { const run = begin('reconcile', false); if (run) void initialize(run); }}>重新確認取餐安排</Button>}
    </div>}
    {state.reply && <>
      <p className={styles.answer}>{state.reply.answer}</p>
      {state.reply.steps.some(step => step.status !== 'error') && <ol className={styles.steps} aria-label="取餐安排進度">
        {state.reply.steps.filter(step => step.status !== 'error').map((step, index) => <li key={index}>{step.summary}</li>)}
      </ol>}
      {state.reply.cards.map((card, index) => <div key={card.mutationId}>
        <AssistantCard card={card} index={0} cards={[card]} states={state.states} pending={!!state.pending}
          confirmationDisabled={!props.available || !state.writes || !state.ready || state.otherPending}
          onConfirm={() => void confirm(card)} onCancel={() => void cancel(card)} onReconcile={() => void reconcile(card)} />
        {state.states[card.mutationId]?.status === 'absent' && !canConfirmAction(state.states[card.mutationId]) &&
          <Button disabled={!!state.pending} onClick={() => void cancel(state.reply!.cards[index])}>停止這份未完成安排</Button>}
      </div>)}
    </>}
  </>;
  if (showPreview && props.suggestion && state.planning && state.writes && !state.otherPending) {
    return <NuniNextStep reason={props.suggestion}>{contents}</NuniNextStep>;
  }
  if (showPreview && !props.suggestion && !state.reply && !state.error && !state.otherPending) {
    return <details className={styles.panel}>
      <summary>安排稍後取餐的時間</summary>
      {contents}
    </details>;
  }
  return <section className={styles.panel} aria-label="取餐行程安排">
    <h3>這筆訂單的取餐行程</h3>
    {contents}
  </section>;
}

export function FoodPickupAgent(props: Props) {
  const enabled = useAssistantEnabled();
  const incomingSchoolId = toPublicSchoolId(props.schoolId);
  const lockedSchoolId = useRef<string | null>(null);
  if (incomingSchoolId && !lockedSchoolId.current) lockedSchoolId.current = incomingSchoolId;
  const schoolId = lockedSchoolId.current;
  if (!enabled || !schoolId ||
      !/^[A-Za-z0-9_-]{43}$/.test(props.context) || !/^[A-Za-z0-9_-]{1,128}$/.test(props.accountId)) return null;
  let target: AssistantFoodPickupTarget;
  try { target = parseAssistantFoodPickupTarget({ tenantId: props.tenantId, orderId: props.orderId }); } catch { return null; }
  const scope = { context: props.context, accountId: props.accountId, schoolId };
  return <ScopedFoodPickupAgent key={JSON.stringify([scope, target.tenantId, target.orderId])} scope={scope} {...props} />;
}
