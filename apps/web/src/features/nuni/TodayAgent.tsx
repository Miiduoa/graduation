'use client';

import { useEffect, useRef, useState } from 'react';
import { parseAssistantCalendarEvent, parseAssistantCalendarExecutionResult } from '@campus/shared/src/assistantExecution';
import { parseAssistantCourseworkFollowup, type AssistantCourseworkFollowup } from '@campus/shared/src/assistantCourseworkFollowup';
import { parseTaipeiInstant } from '@campus/shared/src/taipeiTime';
import { TodayAgentPanel, todayAgentTaskKey } from '@/components/today/TodayAgentPanel';
import { useAssistantEnabled } from '@/components/AssistantEnabledProvider';
import { useCampusBrowseContext } from '@/lib/useCampusBrowseContext';
import type { HomeTask } from '@/lib/homeOverview';
import { assertAssistantCalendarLocalReady, mirrorAssistantCalendarReceipt } from '@/lib/assistantCalendarExecution';
import {
  readAssistantExecutionJournal,
  saveAssistantExecutionJournal,
  removeAssistantExecutionJournal,
  type AssistantExecutionJournalEntry,
} from '@/lib/assistantExecutionJournal';
import { readTodayAgentFollowups, saveTodayAgentFollowup, removeTodayAgentFollowup, assertTodayAgentFollowupCapacity,
  todayAgentFollowupStorageKey, type TodayAgentFollowupEntry } from '@/lib/todayAgentFollowups';
import { calendarExpectation, canConfirmAction, priorCalendarActionsVerified, withAssistantRequestDeadline } from './assistant/execution';
import type { V2ActionState, V2ActionStates, V2Card, V2Reply } from './assistant/types';

type Scope = { context: string; accountId: string; schoolId: string };
type Props = {
  context: string;
  accountId: string;
  tasks: HomeTask[];
  now: Date | null;
  loading?: boolean;
  error?: string;
  onRetry?: () => void;
};
type Pending = 'plan' | 'confirm' | 'reconcile' | 'cancel' | 'followup' | null;
type State = {
  ready: boolean;
  reply: V2Reply | null;
  states: V2ActionStates;
  selectedTaskId?: string;
  pending: Pending;
  error: string;
  previewExpiresAt: number | null;
  followups: AssistantCourseworkFollowup[];
  trackingReady: boolean;
  trackingError: string;
};
type Lifetime = { controller: AbortController; busy: boolean };
const initialState = (): State => ({ ready: false, reply: null, states: {}, pending: null, error: '', previewExpiresAt: null,
  followups: [], trackingReady: false, trackingError: '' });
const AUTOMATIC_COOLDOWN = 15 * 60_000;
const CONFIRMATION_MARGIN = 15_000;
const FOLLOWUP_COOLDOWN = 60_000;
function claimAutomaticPreview(scope: Scope): boolean {
  const key = 'campus.today-agent-auto.v1:' + [scope.context, scope.accountId, scope.schoolId].map(encodeURIComponent).join(':');
  try {
    const now = Date.now();
    const previous = sessionStorage.getItem(key);
    if (previous !== null) {
      const at = Number(previous);
      if (!Number.isSafeInteger(at) || at < 0 || now - at < AUTOMATIC_COOLDOWN) return false;
    }
    sessionStorage.setItem(key, String(now));
    return sessionStorage.getItem(key) === String(now);
  } catch { return false; }
}
const settled = (state: V2ActionState | undefined) =>
  state?.status === 'cancelled' || state?.status === 'superseded' ||
  (state?.status === 'verified' && state.local === 'ready' && !state.verificationWarning);
const sameCard = (left: V2Card, right: V2Card) =>
  left.token === right.token && left.mutationId === right.mutationId &&
  left.schoolId === right.schoolId && left.conversationId === right.conversationId &&
  JSON.stringify(left.args) === JSON.stringify(right.args);

function requestError(status: number, raw: unknown): Error {
  const value = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  if (typeof value.message === 'string' && value.message.trim()) return new Error(value.message);
  return new Error(status === 401 ? '登入狀態已變更，請重新登入後再安排。'
    : status === 403 ? '目前無法使用這項操作，請先確認課程與助理權限。'
      : status === 404 ? '自動安排尚未開放，請稍後再試。'
        : status === 409 ? '原始資料或確認內容已變更，請先核對這筆操作。'
          : status === 429 ? '安排要求較多，請稍後再試。'
            : '目前無法完成這次操作，請稍後重試。');
}

/** Validate a structured, read-only plan before making any action available to the page. */
function planReply(raw: unknown, scope: Scope, conversationId: string): V2Reply {
  if (!raw || typeof raw !== 'object') throw new Error('安排結果無法核對，請重新尋找時段。');
  const value = raw as Record<string, unknown>;
  if (value.version !== 2 || value.dataRead !== true || value.modelCalls !== 0 || value.simulation === true ||
      typeof value.answer !== 'string' || value.answer.length > 12000 ||
      !Array.isArray(value.cards) || value.cards.length > 1 || !Array.isArray(value.steps) || value.steps.length > 10)
    throw new Error('安排結果無法核對，請重新尋找時段。');
  const cards = value.cards.map((rawCard): V2Card => {
    if (!rawCard || typeof rawCard !== 'object') throw new Error('安排內容無法核對。');
    const card = rawCard as Record<string, unknown>;
    if (card.tool !== 'propose_personal_event' || card.schoolId !== scope.schoolId ||
        typeof card.token !== 'string' || !/^[A-Za-z0-9_.-]{1,2048}$/.test(card.token) ||
        typeof card.mutationId !== 'string' || !/^[A-Za-z0-9_-]{8,100}$/.test(card.mutationId) ||
        typeof card.destination !== 'string' || !card.destination || card.destination.length > 300)
      throw new Error('安排內容無法核對，沒有送出任何操作。');
    return { tool: card.tool, args: { ...parseAssistantCalendarEvent(card.args) }, token: card.token,
      mutationId: card.mutationId, schoolId: scope.schoolId, destination: card.destination, conversationId };
  });
  const steps = value.steps.map((rawStep) => {
    if (!rawStep || typeof rawStep !== 'object') throw new Error('安排步驟無法核對。');
    const step = rawStep as Record<string, unknown>;
    if (typeof step.name !== 'string' || typeof step.status !== 'string' || typeof step.summary !== 'string' ||
        step.name.length > 100 || step.status.length > 30 || step.summary.length > 1000)
      throw new Error('安排步驟無法核對。');
    return { name: step.name, status: step.status, summary: step.summary };
  });
  return { answer: value.answer, cards, steps, dataRead: true };
}

/** A scope-keyed task surface. It uses the same signed actions and recovery journal as chat. */
function ScopedTodayAgent({ scope, ...props }: Omit<Props, 'context' | 'accountId'> & { scope: Scope }) {
  const [state, renderState] = useState<State>(initialState);
  const stateRef = useRef(state);
  const lifetime = useRef<Lifetime | null>(null);
  const autoPrepared = useRef(false);
  const dispatched = useRef(new Set<string>());
  const route = useRef<{ conversationId: string; token: string } | null>(null);
  const trackingSnapshot = useRef('');
  const lastFollowup = useRef(0);
  const followupQueued = useRef(false);
  const localScope = { owner: 'platform:' + scope.accountId, schoolId: scope.schoolId };
  const journalScope = { ...localScope, context: scope.context };
  const active = (run: Lifetime) => lifetime.current === run && !run.controller.signal.aborted;
  const update = (run: Lifetime, change: Partial<State>) => {
    if (!active(run)) return;
    stateRef.current = { ...stateRef.current, ...change };
    renderState(stateRef.current);
  };
  const setAction = (run: Lifetime, card: V2Card, action: V2ActionState) =>
    update(run, { states: { ...stateRef.current.states, [card.mutationId]: action } });
  const begin = (pending: Exclude<Pending, null>, requireReady = true) => {
    const run = lifetime.current;
    if (!run || !active(run) || run.busy || (requireReady && !stateRef.current.ready)) return null;
    run.busy = true;
    update(run, { pending, error: '' });
    return run;
  };
  const finish = (run: Lifetime) => {
    run.busy = false;
    update(run, { pending: null });
    if (active(run) && followupQueued.current) {
      followupQueued.current = false;
      void Promise.resolve().then(() => { if (active(run)) void refreshFollowups(); });
    }
  };
  async function send(run: Lifetime, action: Exclude<Pending, null>, input: Record<string, unknown>) {
    return withAssistantRequestDeadline(run.controller.signal, action === 'plan' ? 25000 : 15000, async (signal) => {
      const response = await fetch('/api/nuni/assistant/' + action, {
        method: 'POST', credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal,
        headers: { 'Content-Type': 'application/json', 'X-Campus-Session': scope.context },
        body: JSON.stringify({ schoolId: scope.schoolId, ...input }),
      });
      const result: unknown = await response.json();
      if (!active(run) || signal.aborted) throw new Error('這次操作已停止。');
      if (!response.ok) throw requestError(response.status, result);
      return result;
    });
  }
  const sendCard = (run: Lifetime, action: 'confirm' | 'cancel' | 'reconcile', card: V2Card) =>
    send(run, action, { conversationId: card.conversationId, token: card.token, args: card.args });
  const trackedTask = (task: HomeTask) => stateRef.current.followups.some(item => item.task &&
    item.task.workspaceId === task.courseId && item.task.taskId === task.id && item.task.kind === (task.kind ?? 'assignment'));
  function trackingCurrent(run: Lifetime): boolean {
    const entries = readTodayAgentFollowups(localScope);
    if (!stateRef.current.trackingReady || JSON.stringify(entries) !== trackingSnapshot.current) {
      update(run, { trackingReady: false, trackingError: '已有安排需要重新核對，確認後再準備新的時段。' });
      followupQueued.current = true;
      return false;
    }
    return true;
  }
  /** A stored proof selects only a read. The server authenticates its original task association each time. */
  async function refreshTracking(run: Lifetime, only?: TodayAgentFollowupEntry[]) {
    const entries = readTodayAgentFollowups(localScope);
    const selected = only ?? entries;
    const results = new Map(stateRef.current.followups.map(item => [item.mutationId, item]));
    const failed: string[] = [];
    let index = 0;
    update(run, { pending: 'followup', trackingError: '' });
    await Promise.all(Array.from({ length: Math.min(3, selected.length) }, async () => {
      while (active(run)) {
        const entry = selected[index++];
        if (!entry) return;
        try {
          const raw = await send(run, 'followup', { conversationId: entry.conversationId,
            issuedContext: entry.issuedContext, token: entry.card.token, args: entry.card.args });
          if (!active(run)) return;
          const result = parseAssistantCourseworkFollowup(raw, { schoolId: scope.schoolId,
            mutationId: entry.card.mutationId, event: entry.card.args });
          if (result.status === 'not_coursework') {
            await removeTodayAgentFollowup(localScope, entry.card.mutationId, () => active(run));
            results.delete(entry.card.mutationId);
          } else {
            results.set(result.mutationId, result);
            const ended = parseTaipeiInstant(`${result.event.endDate || result.event.date}T${result.event.allDay ? '23:59' : result.event.endTime}:00+08:00`);
            // A fresh completed source can retire old tracking; the original calendar event remains untouched.
            if (['submitted', 'closed'].includes(result.status) && result.calendar === 'matching' && ended !== null &&
                Date.parse(result.checkedAt) - ended > 7 * 86400000)
              await removeTodayAgentFollowup(localScope, entry.card.mutationId, () => active(run));
          }
        } catch {
          if (!active(run)) return;
          failed.push(entry.card.mutationId);
          const previous = results.get(entry.card.mutationId);
          if (previous) results.set(entry.card.mutationId, { ...previous, status: 'unavailable', source: null, calendar: 'unavailable' });
        }
      }
    }));
    if (!active(run)) return;
    const after = readTodayAgentFollowups(localScope);
    const retainedIds = new Set(after.map(entry => entry.card.mutationId));
    for (const id of results.keys()) if (!retainedIds.has(id)) results.delete(id);
    const selectedIds = new Set(selected.map(entry => entry.card.mutationId));
    const beforeEntries = new Map(entries.map(entry => [entry.card.mutationId, JSON.stringify(entry)]));
    // Another tab may have added a proof while reads were running; do not call that unseen result checked.
    const unseen = after.some(entry => beforeEntries.get(entry.card.mutationId) !== JSON.stringify(entry) ||
      !selectedIds.has(entry.card.mutationId) && !results.has(entry.card.mutationId));
    const ready = !failed.length && !unseen;
    trackingSnapshot.current = JSON.stringify(after);
    lastFollowup.current = Date.now();
    update(run, { followups: [...results.values()], trackingReady: ready,
      trackingError: ready ? '' : '部分已安排事項暫時無法核對，原紀錄仍保留。請重新核對後再安排，避免重複新增。' });
    const selectedTask = props.tasks.find(task => todayAgentTaskKey(task) === stateRef.current.selectedTaskId);
    if (selectedTask && trackedTask(selectedTask))
      discardUnsentPreview(run, '這件課務已有安排，已撤下尚未送出的預覽。請查看原安排的最新狀態。');
  }
  function remember(run: Lifetime, card: V2Card) {
    saveAssistantExecutionJournal(journalScope, { conversationId: card.conversationId!, card }, () => active(run));
  }
  function forget(run: Lifetime, card: V2Card) {
    try { removeAssistantExecutionJournal(journalScope, card.mutationId, () => active(run)); }
    catch (error) {
      update(run, { error: error instanceof Error ? error.message : '待核對紀錄尚未更新，請再次核對結果。' });
    }
  }
  function recoveryCards(entries: AssistantExecutionJournalEntry[]): V2Card[] {
    return entries.map((entry) => ({ ...entry.card, args: { ...entry.card.args }, conversationId: entry.conversationId }));
  }
  function adoptRecovery(run: Lifetime, cards: V2Card[]) {
    autoPrepared.current = true;
    const states = Object.fromEntries(cards.map((card) => [card.mutationId,
      stateRef.current.reply?.cards.some((existing) => sameCard(existing, card))
        ? stateRef.current.states[card.mutationId] ?? { status: 'unknown', message: '上次操作尚待核對。' }
        : { status: 'unknown', message: '已找回上次操作，請核對原行程結果。' },
    ])) as V2ActionStates;
    update(run, { ready: true, selectedTaskId: undefined, previewExpiresAt: null, states, reply: {
      answer: '上次送出的安排還有結果待核對，先確認原行程再繼續。', cards, steps: [], dataRead: true,
    } });
  }
  /** A preview which never left this surface can be discarded without cancelling a remote write. */
  function discardUnsentPreview(run: Lifetime, message: string): boolean {
    const cards = stateRef.current.reply?.cards ?? [];
    if (cards.length !== 1 || dispatched.current.has(cards[0].mutationId)) return false;
    const action = stateRef.current.states[cards[0].mutationId];
    if (action && action.status !== 'blocked') return false;
    const entries = readAssistantExecutionJournal(journalScope);
    if (entries.some((entry) => entry.card.mutationId === cards[0].mutationId)) return false;
    update(run, { previewExpiresAt: null, states: {}, reply: {
      answer: message, cards: [], steps: [], dataRead: true,
    } });
    return true;
  }
  function retireExpiredPreview(run: Lifetime): boolean {
    const until = stateRef.current.previewExpiresAt;
    return until !== null && Date.now() >= until - CONFIRMATION_MARGIN &&
      discardUnsentPreview(run, '這份時段預覽已過期，請重新尋找準備時間，再確認最新安排。');
  }
  /** Chat can have added recovery evidence since this surface mounted. Never ignore it. */
  function checkJournal(run: Lifetime, forPlanning: boolean): boolean {
    const cards = recoveryCards(readAssistantExecutionJournal(journalScope));
    if (cards.some((card) => !stateRef.current.reply?.cards.some((existing) => sameCard(existing, card)))) {
      adoptRecovery(run, cards);
      update(run, { error: '另一次安排還有結果待核對，請先核對下方原行程。' });
      return false;
    }
    if (forPlanning && cards.length) {
      update(run, { error: '先核對上一筆行程，確認結果與裝置資料一致後，再準備下一份安排。' });
      return false;
    }
    return true;
  }
  async function applyResult(run: Lifetime, card: V2Card, raw: unknown): Promise<boolean> {
    if (!active(run) || card.schoolId !== scope.schoolId) return false;
    const result = parseAssistantCalendarExecutionResult(raw, calendarExpectation(card));
    if (result.status === 'verified') {
      let localMessage = '';
      try { await mirrorAssistantCalendarReceipt(result, localScope, () => active(run)); }
      catch (error) { localMessage = error instanceof Error ? error.message : '此裝置尚未更新，請重新核對。'; }
      if (!active(run)) return false;
      if (!localMessage) {
        try {
          await saveTodayAgentFollowup(localScope, { issuedContext: scope.context, conversationId: card.conversationId!,
            card: { tool: 'propose_personal_event', token: card.token, args: parseAssistantCalendarEvent(card.args),
              mutationId: card.mutationId, schoolId: card.schoolId, destination: card.destination } }, result, () => active(run));
        } catch (error) {
          localMessage = error instanceof Error ? error.message : '這部裝置尚未保留安排追蹤紀錄，請重新核對。';
          update(run, { trackingReady: false, trackingError: localMessage });
        }
      }
      setAction(run, card, { status: 'verified', receipt: result,
        local: localMessage ? 'unavailable' : 'ready', ...(localMessage ? { localMessage } : {}) });
      if (!localMessage) {
        forget(run, card);
        try {
          await refreshTracking(run, readTodayAgentFollowups(localScope).filter(entry => entry.card.mutationId === card.mutationId));
        } catch {
          update(run, { trackingReady: false, trackingError: '行程已加入，但後續追蹤暫時無法核對，請重新確認資料。' });
        }
      }
      return !localMessage;
    }
    if (result.status === 'revoked') {
      setAction(run, card, { status: 'cancelled' });
      forget(run, card);
    } else if (result.status === 'conflict') {
      setAction(run, card, { status: 'conflict', message: '原行程與這份安排不同，請先到行事曆核對。' });
    } else setAction(run, card, { status: 'absent', retryable: result.retryable,
      message: result.retryable ? '目前未找到這筆行程，可以確認重試同一份安排。'
        : '目前未找到相符行程，這份確認已無法執行。請先核對或撤銷原提議。' });
    return false;
  }
  async function checkCard(run: Lifetime, card: V2Card): Promise<boolean> {
    const previous = stateRef.current.states[card.mutationId];
    if (previous?.status === 'verified')
      setAction(run, card, { ...previous, verificationWarning: '正在重新核對原行程。' });
    else setAction(run, card, { status: 'checking' });
    update(run, { pending: 'reconcile' });
    try { return await applyResult(run, card, await sendCard(run, 'reconcile', card)); }
    catch {
      if (previous?.status === 'verified')
        setAction(run, card, { ...previous, verificationWarning: '這次查核未完成，保留上次的核對結果。' });
      else setAction(run, card, { status: 'unknown', message: '執行結果尚未確認，請核對原操作，避免重複新增。' });
      return false;
    }
  }
  async function initialize(run: Lifetime) {
    try {
      const cards = recoveryCards(readAssistantExecutionJournal(journalScope));
      if (cards.length) {
        adoptRecovery(run, cards);
        for (const card of cards) {
          if (!active(run)) break;
          await checkCard(run, card);
          if (stateRef.current.states[card.mutationId]?.status === 'unknown') break;
        }
      }
      if (!active(run)) return;
      await refreshTracking(run);
      update(run, { ready: true });
    } catch (error) {
      update(run, { ready: false, error: error instanceof Error ? error.message : '先前安排紀錄暫時讀不到，請重試。' });
    } finally { finish(run); }
  }
  useEffect(() => {
    const run = { controller: new AbortController(), busy: true };
    lifetime.current = run;
    void Promise.resolve().then(() => { if (active(run)) void initialize(run); });
    return () => run.controller.abort();
    // The parent keys this component by session, account and campus; late results belong to this lifetime only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function plan(task: HomeTask) {
    if (props.loading || !props.tasks.some((current) => todayAgentTaskKey(current) === todayAgentTaskKey(task))) return;
    const due = task.dueAt ? parseTaipeiInstant(task.dueAt) : null;
    const now = props.now?.getTime();
    if (!now || !Number.isFinite(now) || due === null || due <= now) return;
    if (stateRef.current.reply?.cards.some((card) => !settled(stateRef.current.states[card.mutationId]))) return;
    const run = begin('plan');
    if (!run) return;
    autoPrepared.current = true;
    try {
      if (!checkJournal(run, true)) return;
      if (!trackingCurrent(run) || trackedTask(task)) return;
      assertTodayAgentFollowupCapacity(localScope);
      update(run, { selectedTaskId: todayAgentTaskKey(task), reply: null, states: {}, previewExpiresAt: null });
      const target = { workspaceId: task.courseId, taskId: task.id, kind: task.kind ?? 'assignment' };
      let binding = route.current;
      let raw = await send(run, 'plan', { conversationId: binding?.conversationId ?? crypto.randomUUID(),
        ...(binding ? { routeToken: binding.token } : {}), task: target });
      if (!active(run)) return;
      if (raw && typeof raw === 'object' && (raw as { bootstrap?: unknown }).bootstrap === true) {
        const value = raw as Record<string, unknown>;
        if (typeof value.conversationId !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(value.conversationId) ||
            typeof value.routeToken !== 'string' || !/^[A-Za-z0-9_.-]{1,2048}$/.test(value.routeToken))
          throw new Error('安排連線無法核對，請重新尋找時段。');
        binding = { conversationId: value.conversationId, token: value.routeToken };
        route.current = binding;
        raw = await send(run, 'plan', { conversationId: binding.conversationId, routeToken: binding.token, task: target });
      }
      if (!active(run)) return;
      // A non-bootstrap result still belongs to the exact conversation sent in the first request.
      if (!binding) throw new Error('安排連線尚未確認，請重新尋找時段。');
      const reply = planReply(raw, scope, binding.conversationId);
      const expiresAt = (raw as Record<string, unknown>).expiresAt;
      if (reply.cards.length && (!Number.isSafeInteger(expiresAt) || Number(expiresAt) <= Date.now() + CONFIRMATION_MARGIN))
        throw new Error('這份時段預覽已過期，請重新尋找準備時間。');
      update(run, { reply, previewExpiresAt: reply.cards.length ? Number(expiresAt) : null });
    } catch (error) {
      route.current = null;
      update(run, { error: error instanceof Error ? error.message : '尋找準備時間未完成，請再試一次。' });
    } finally { finish(run); }
  }
  useEffect(() => {
    if (!state.ready || !state.trackingReady || state.pending || state.error || state.trackingError || state.reply || autoPrepared.current || props.loading || props.error || !props.now) return;
    const now = props.now.getTime();
    if (!Number.isFinite(now)) return;
    const candidate = props.tasks
      .map((task) => ({ task, due: task.dueAt ? parseTaipeiInstant(task.dueAt) : null }))
      .filter((row): row is { task: HomeTask; due: number } => row.due !== null && row.due > now && row.due - now <= 7 * 86400000 && !trackedTask(row.task))
      .sort((left, right) => left.due - right.due || todayAgentTaskKey(left.task).localeCompare(todayAgentTaskKey(right.task)))[0];
    if (candidate) {
      autoPrepared.current = true;
      if (claimAutomaticPreview(scope)) void plan(candidate.task);
    }
    // Re-entering Today shares a short cooldown; it cannot consume the chat request budget on every navigation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.ready, state.trackingReady, state.pending, state.error, state.trackingError, state.reply, props.loading, props.error, props.tasks, props.now]);

  useEffect(() => {
    const run = lifetime.current;
    if (!run || state.previewExpiresAt === null || state.pending) return;
    const timer = setTimeout(() => {
      if (!active(run) || run.busy) return;
      try { retireExpiredPreview(run); }
      catch (error) { update(run, { ready: false, error: error instanceof Error ? error.message : '原安排紀錄尚未核對。' }); }
    }, Math.max(0, state.previewExpiresAt - CONFIRMATION_MARGIN - Date.now()));
    return () => clearTimeout(timer);
    // This only withdraws a never-dispatched preview. Recovery evidence never expires locally.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.previewExpiresAt, state.pending]);

  async function confirm(cards: V2Card[]) {
    const run = begin('confirm');
    if (!run) return;
    try {
      if (!checkJournal(run, false)) return;
      if (!trackingCurrent(run)) return;
      if (retireExpiredPreview(run)) return;
      for (const card of cards) {
        if (!active(run)) break;
        const currentCards = stateRef.current.reply?.cards ?? [];
        const index = currentCards.findIndex((current) => sameCard(current, card));
        if (index < 0 || card.schoolId !== scope.schoolId || card.tool !== 'propose_personal_event' ||
            !canConfirmAction(stateRef.current.states[card.mutationId]) ||
            !priorCalendarActionsVerified(currentCards, index, stateRef.current.states)) break;
        try {
          assertTodayAgentFollowupCapacity(localScope, card.mutationId);
          await assertAssistantCalendarLocalReady(card.args, localScope, () => active(run));
          if (!active(run)) break;
          if (!checkJournal(run, false)) break;
          if (!trackingCurrent(run)) break;
          if (retireExpiredPreview(run)) break;
          assertTodayAgentFollowupCapacity(localScope, card.mutationId);
          remember(run, card);
        } catch (error) {
          setAction(run, card, { status: 'blocked', message: error instanceof Error ? error.message : '尚未送出，請先確認裝置的行事曆。' });
          break;
        }
        update(run, { pending: 'confirm' });
        setAction(run, card, { status: 'executing' });
        dispatched.current.add(card.mutationId);
        try {
          if (!await applyResult(run, card, await sendCard(run, 'confirm', card))) break;
        } catch {
          if (!active(run)) break;
          if (!await checkCard(run, card)) break;
        }
      }
    } catch (error) {
      update(run, { error: error instanceof Error ? error.message : '操作尚未完成，請先核對原結果。' });
    } finally { finish(run); }
  }
  async function reconcile(card: V2Card) {
    if (!stateRef.current.reply?.cards.some((current) => sameCard(current, card))) return;
    const run = begin('reconcile');
    if (!run) return;
    try { await checkCard(run, card); }
    finally { finish(run); }
  }
  async function cancel(index: number) {
    const run = begin('cancel');
    if (!run) return;
    try {
      if (!checkJournal(run, false)) return;
      const cards = stateRef.current.reply?.cards ?? [];
      if (!Number.isSafeInteger(index) || index < 0 || index >= cards.length) return;
      if (discardUnsentPreview(run, '已取消這份尚未送出的安排。可以再選一件待辦，重新尋找時間。')) return;
      for (const card of cards.slice(index)) {
        if (!active(run)) break;
        const status = stateRef.current.states[card.mutationId];
        if (settled(status) || status?.status === 'verified') continue;
        if (status && ['unknown', 'checking', 'executing'].includes(status.status)) break;
        remember(run, card);
        dispatched.current.add(card.mutationId);
        try {
          update(run, { pending: 'cancel' });
          await applyResult(run, card, await sendCard(run, 'cancel', card));
          const after = stateRef.current.states[card.mutationId]?.status;
          if (after !== 'cancelled' && after !== 'verified') break;
        } catch {
          if (active(run)) await checkCard(run, card);
          break;
        }
      }
    } catch (error) {
      update(run, { error: error instanceof Error ? error.message : '取消尚未完成，請先核對原行程。' });
    } finally { finish(run); }
  }
  function retry() {
    if (!stateRef.current.ready) {
      const run = begin('reconcile', false);
      if (run) void initialize(run);
    } else {
      void refreshFollowups();
    }
    props.onRetry?.();
  }
  async function refreshFollowups(automatic = false) {
    if (automatic && (document.visibilityState === 'hidden' || Date.now() - lastFollowup.current < FOLLOWUP_COOLDOWN)) return;
    const run = begin('followup');
    if (!run) {
      if (lifetime.current?.busy) followupQueued.current = true;
      return;
    }
    try { await refreshTracking(run); }
    catch (error) {
      update(run, { trackingReady: false, trackingError: error instanceof Error ? error.message : '安排追蹤暫時無法讀取，請重新核對。' });
    } finally { finish(run); }
  }
  useEffect(() => {
    const foreground = () => { void refreshFollowups(true); };
    const changed = (event: StorageEvent) => {
      if (event.key !== null && event.key !== todayAgentFollowupStorageKey(localScope)) return;
      const run = lifetime.current;
      if (!run || !active(run)) return;
      update(run, { trackingReady: false });
      void refreshFollowups();
    };
    window.addEventListener('focus', foreground);
    document.addEventListener('visibilitychange', foreground);
    window.addEventListener('storage', changed);
    return () => {
      window.removeEventListener('focus', foreground);
      document.removeEventListener('visibilitychange', foreground);
      window.removeEventListener('storage', changed);
    };
    // The component lifetime is fixed to one account and campus. Reads use stateRef and never dispatch a write.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return <TodayAgentPanel tasks={state.ready ? props.tasks : []} now={props.now}
    loading={props.loading || (!state.ready && !state.error)} error={state.error || state.trackingError || props.error}
    selectedTaskId={state.selectedTaskId} reply={state.reply} states={state.states} pending={state.pending}
    followups={state.followups} tracking={state.pending === 'followup'} planningBlocked={!state.trackingReady}
    onRefreshFollowups={() => void refreshFollowups()}
    onPlan={(task) => void plan(task)} onConfirm={(cards) => void confirm(cards)}
    onCancel={(index) => void cancel(index)} onReconcile={(card) => void reconcile(card)} onRetry={retry} />;
}

export function TodayAgent(props: Props) {
  const enabled = useAssistantEnabled();
  const campus = useCampusBrowseContext();
  if (!enabled || campus.status !== 'ready' || !campus.schoolId ||
      !/^[A-Za-z0-9_-]{43}$/.test(props.context) || !/^[A-Za-z0-9_-]{1,128}$/.test(props.accountId)) return null;
  const scope = { context: props.context, accountId: props.accountId, schoolId: campus.schoolId };
  return <ScopedTodayAgent key={JSON.stringify(scope)} scope={scope} {...props} />;
}
