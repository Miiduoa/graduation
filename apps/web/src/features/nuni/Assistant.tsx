'use client';
import Link from 'next/link';
import { Suspense, useEffect, useRef, useState, type ReactNode } from 'react';
import { useSearchParams } from 'next/navigation';
import { SiteShell } from '@/components/SiteShell';
import { useCampusBrowseContext } from '@/lib/useCampusBrowseContext';
import { useNuniSession } from './Session';
import type { AssistantIntent } from '@/lib/nuni/assistantContracts';
import { AssistantThread } from './assistant/AssistantThread';
import { AssistantPlanRevision } from './assistant/AssistantPlanRevision';
import { buildPlanRevisionQuestion, getPlanRevisionEvents, hasUnresolvedAssistantAction, isUnattemptedCalendarPlan } from './assistant/planRevision';
import type { V2ActionState, V2ActionStates, V2Card, V2Turn } from './assistant/types';
import { assistantAnswerWithExecution, calendarExpectation, canConfirmAction, priorCalendarActionsVerified, withAssistantRequestDeadline } from './assistant/execution';
import { inAppHref } from './assistant/copy';
import { parseAssistantCalendarExecutionResult } from '@campus/shared/src/assistantExecution';
import { assertAssistantCalendarLocalReady, mirrorAssistantCalendarReceipt } from '@/lib/assistantCalendarExecution';
import { readAssistantExecutionJournal, saveAssistantExecutionJournal, removeAssistantExecutionJournal } from '@/lib/assistantExecutionJournal';
import { answerAssistantLocally } from '@/lib/assistantLocalActions';
import { AssistantServiceLinks } from '@/components/AssistantServiceLinks';
import { ASSISTANT_SERVICES } from '@campus/shared/src/assistantServices';
import { AssistantLocalEntry } from '@/components/AssistantLocalEntry';
type Step = {
  intent: AssistantIntent;
  confirmation: string;
  summary?: string;
  answer?: string;
  simulation: boolean;
};
function Conversation({ context, schoolId, accountId, cloudEnabled }: { context: string; schoolId: string; accountId: string; cloudEnabled: boolean }) {
  const [v2, setV2] = useState(false);
  const [ready, setReady] = useState(false);
  const [providerReady, setProviderReady] = useState(false);
  const [fallback, setFallback] = useState(false);
  const [capabilityUnavailable, setCapabilityUnavailable] = useState(!cloudEnabled);
  const [step, setStep] = useState<Step | null>(null);
  const [source, setSource] = useState('');
  const [href, setHref] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const controller = useRef(new AbortController());
  async function request(action: string, input?: object) {
    return withAssistantRequestDeadline(controller.current.signal, action === 'ask' ? 65000 : 15000, async (signal) => {
    const response = await fetch('/api/nuni/assistant/' + action, {
      method: input ? 'POST' : 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      redirect: 'error',
      signal,
      headers: {
        'X-Campus-Session': context,
        ...(input ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(input ? { body: JSON.stringify(input) } : {}),
    });
    if (!response.ok)
      throw new Error(
        response.status === 404
          ? '雲端助理尚未啟用。'
          : response.status === 429
            ? '查詢次數已達上限，請稍後再試。'
            : '目前無法查詢，請重新選擇或稍後再試。',
      );
    return response.json();
    });
  }
  useEffect(() => {
    if (!cloudEnabled) return;
    controller.current = new AbortController();
    const activeController = controller.current;
    let active = true;
    void request('capability')
      .then((value) => {
        if (active) {
          setV2(value.version === 2);
          setReady(value.enabled === true);
          setProviderReady(value.ready === true);
          setFallback(value.fallback === true);
          setCapabilityUnavailable(value.enabled !== true);
        }
      })
      .catch((e) => {
        if (active) {
          setError(e.message);
          setCapabilityUnavailable(true);
        }
      });
    return () => {
      active = false;
      activeController.abort();
    };
    // Conversation is remounted for each session and school scope.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  async function run(action: 'preview' | 'ask' | 'route', intent: AssistantIntent) {
    const signal = controller.current.signal;
    setPending(true);
    setError('');
    setHref('');
    setSource('');
    try {
      const value = await request(
        action,
        action === 'preview'
          ? { schoolId, intent }
          : { schoolId, intent, confirmation: step?.confirmation, consent: true },
      );
      if (signal.aborted) return;
      if (action === 'route') {
        setHref(value.href);
        setSource(value.source || '');
      } else setStep(value);
    } catch (e) {
      if (!signal.aborted) {
        setStep(null);
        setError(e instanceof Error ? e.message : '查詢失敗。');
      }
    } finally {
      if (!signal.aborted) setPending(false);
    }
  }
  if (v2 || capabilityUnavailable) return <>
    {capabilityUnavailable && <p role="status">{error || '雲端助理尚未啟用。'}</p>}
    <V2Conversation context={context} schoolId={schoolId} accountId={accountId} ready={providerReady} fallback={fallback} />
  </>;
  return (
    <section aria-label="公開校園助理">
      <p>此助理目前提供公開資訊，尚未支援代辦寫入。私人課表、作業與借閱快照尚未支援。</p>
      <AssistantLocalEntry owner={accountId ? 'platform:' + accountId : ''} schoolId={schoolId} />
      {!ready && <p role="status">{error || '正在確認助理是否啟用…'}</p>}
      {!ready && <AssistantServiceLinks serviceIds={ASSISTANT_SERVICES.map((service) => service.id)} schoolId={schoolId} audience="platform" />}
      {ready && (
        <>
          <nav aria-label="公開服務入口">
            <Link href={'/map?schoolId=' + encodeURIComponent(schoolId)}>直接開啟校園地圖</Link> ·{' '}
            <Link href={'/bus?schoolId=' + encodeURIComponent(schoolId)}>直接開啟公車資訊</Link> ·{' '}
            <Link href={'/cafeteria?schoolId=' + encodeURIComponent(schoolId)}>
              直接開啟餐廳資訊
            </Link>
          </nav>
          {!providerReady && <p role="status">模型目前無法使用，可直接開啟公開服務入口。</p>}
          <p>請選擇公開服務。確認摘要後才會將公開服務資料傳送給模型。</p>
          {(
            [
              ['map', '校園地圖'],
              ['bus', '公車資訊'],
              ['cafeteria', '餐廳資訊'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              disabled={pending}
              onClick={() => {
                setStep(null);
                void run('preview', id);
              }}
            >
              {label}
            </button>
          ))}
          {schoolId === 'pu' && (
            <button
              disabled={pending}
              onClick={() => {
                setStep(null);
                void run('preview', 'pu-library');
              }}
            >
              蓋夏圖書館
            </button>
          )}
          {step && (
            <div role="log">
              {step.simulation && <p>模擬模式：無網路模型查詢。</p>}
              <p>{step.answer || step.summary}</p>
              {!step.answer ? (
                <button
                  disabled={pending || !providerReady}
                  onClick={() => void run('ask', step.intent)}
                >
                  同意外送上述公開資料並查詢
                </button>
              ) : (
                <button disabled={pending} onClick={() => void run('route', step.intent)}>
                  確認服務，取得站內入口
                </button>
              )}
            </div>
          )}
          {href && <Link href={href}>開啟服務頁面</Link>}
          {source && (
            <a href={source} target="_blank" rel="noopener noreferrer">
              學校官方公開導覽
            </a>
          )}
          {error && <p role="alert">{error}</p>}
          {pending && <p role="status">查詢中…</p>}
        </>
      )}
    </section>
  );
}
function V2Conversation({
  context,
  schoolId,
  ready,
  fallback,
  accountId,
}: {
  context: string;
  schoolId: string;
  ready: boolean;
  fallback: boolean;
  accountId: string;
}) {
  const conversation = useRef(crypto.randomUUID());
  const [consent, setConsent] = useState(false);
  const [question, setQuestion] = useState('');
  const [turns, setTurns] = useState<V2Turn[]>([]);
  const [states, setStates] = useState<V2ActionStates>({});
  const actionStates = useRef<V2ActionStates>({});
  const busy = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const routeToken = useRef<string | undefined>(undefined);
  const revisionConsent = useRef(false);
  const revisionTurns = useRef(new Set<V2Turn>());
  const controller = useRef<AbortController | null>(null);
  const localScope = { owner: 'platform:' + accountId, schoolId };
  const journalScope = { ...localScope, context };
  const active = () => !!controller.current && !controller.current.signal.aborted;
  function setAction(card: V2Card, value: V2ActionState) {
    if (!active()) return;
    actionStates.current = { ...actionStates.current, [card.mutationId]: value };
    setStates(actionStates.current);
  }
  useEffect(() => {
    const lifetime = new AbortController();
    controller.current = lifetime;
    try {
      const entries = readAssistantExecutionJournal(journalScope);
      if (entries.length) {
        const cards: V2Card[] = entries.map((entry) => ({ ...entry.card, conversationId: entry.conversationId }));
        actionStates.current = Object.fromEntries(cards.map((card) => [card.mutationId, {
          status: 'unknown' as const, message: '已找回先前操作，等待核對原行程；不會重新送出。',
        }]));
        setStates(actionStates.current);
        setTurns(cards.map((card) => ({ question: '核對先前送出的行程',
          reply: { answer: '已保留原確認內容，這次先查核執行結果。', steps: [], cards: [card] } })));
        busy.current = true;
        setPending(true);
        // Deferring also lets a Strict Mode cleanup cancel its first mount's recovery.
        void Promise.resolve().then(async () => {
          if (lifetime.signal.aborted) return;
          try {
            for (const card of cards) {
              if (lifetime.signal.aborted) break;
              await checkCalendar(card);
              // A disconnected device should not wait through every saved card.
              if (actionStates.current[card.mutationId]?.status === 'unknown') break;
            }
          } finally {
            if (!lifetime.signal.aborted) {
              busy.current = false;
              setPending(false);
            }
          }
        });
      }
    } catch (error) {
      setError(error instanceof Error ? error.message : '先前操作紀錄暫時讀不到，請保留目前頁面再試。');
    }
    return () => lifetime.abort();
    // This component is keyed by the authenticated session, account and school.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  async function send(action: string, input: object) {
    const signal = controller.current!.signal;
    return withAssistantRequestDeadline(signal, action === 'ask' ? 65000 : 15000, async (requestSignal) => {
    const response = await fetch('/api/nuni/assistant/' + action, {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      redirect: 'error',
      signal: requestSignal,
      headers: { 'Content-Type': 'application/json', 'X-Campus-Session': context },
      body: JSON.stringify({ schoolId, conversationId: conversation.current, ...input }),
    });
    const result = await response.json();
    if (!response.ok)
      throw new Error(
        typeof result.message === 'string' && result.message
          ? result.message
          : response.status === 409
            ? '資料或登入狀態已變更，請重新提議。'
            : response.status === 429
              ? '已達查詢預算，請稍後再試。'
              : '查詢未完成，請稍後再試。',
      );
    if (signal.aborted) throw new Error('已取消');
    return result;
    });
  }
  function sendCard(action: 'confirm' | 'cancel' | 'reconcile', card: V2Card) {
    return send(action, { token: card.token, args: card.args,
      conversationId: card.conversationId || conversation.current });
  }
  function rememberCalendar(card: V2Card) {
    saveAssistantExecutionJournal(journalScope, {
      conversationId: card.conversationId || conversation.current, card,
    }, active);
  }
  function forgetCalendar(card: V2Card) {
    try {
      removeAssistantExecutionJournal(journalScope, card.mutationId, active);
    } catch {
      if (active()) setError('行程結果已核對，待核對清單暫時無法更新；再次開啟時只會查核，不會重複建立。');
    }
  }
  async function ask() {
    const current = question.trim();
    if (!current || busy.current) return;
    const local = answerAssistantLocally(current, { owner: accountId ? 'platform:' + accountId : '', schoolId });
    if (local) {
      setTurns((previous) => [...previous, { question: current,
        reply: { answer: local.content, steps: [], cards: [], local } }]);
      setQuestion('');
      setError('');
      return;
    }
    if (!consent || !ready) return;
    busy.current = true;
    setPending(true);
    setError('');
    try {
      const history = turns.filter((turn) => !turn.reply.local &&
        !turn.reply.steps.some((step) => step.name === 'get_imported_academics')).slice(-6).flatMap((t) => [
        { role: 'user', content: t.question },
        { role: 'assistant', content: assistantAnswerWithExecution(t, actionStates.current) },
      ]);
      let reply = await send('ask', { question: current, history, consent, routeToken: routeToken.current });
      if (reply.bootstrap) {
        conversation.current = reply.conversationId;
        routeToken.current = reply.routeToken;
        reply = await send('ask', { question: current, history, consent, routeToken: routeToken.current });
      }
      reply = { ...reply, cards: reply.cards.map((card: V2Card) => ({ ...card, conversationId: conversation.current })) };
      if (reply.cards.length) {
        for (const card of turns.flatMap((turn) => turn.reply.cards)) {
          if (canConfirmAction(actionStates.current[card.mutationId]))
            setAction(card, { status: 'superseded' });
        }
      }
      setTurns((t) => [...t, { question: current, reply }]);
      setQuestion('');
    } catch (e) {
      if (!controller.current?.signal.aborted)
        setError(e instanceof Error ? e.message : '查詢失敗');
    } finally {
      busy.current = false;
      if (!controller.current?.signal.aborted) setPending(false);
    }
  }
  async function applyCalendarResult(card: V2Card, raw: unknown): Promise<boolean> {
    if (card.schoolId !== schoolId) throw new Error('校園已切換，請重新開啟確認卡。');
    const result = parseAssistantCalendarExecutionResult(raw, calendarExpectation(card));
    if (result.status === 'verified') {
      let localMessage = '';
      try {
        await mirrorAssistantCalendarReceipt(result, localScope, active);
      } catch (error) {
        localMessage = error instanceof Error ? error.message : '此裝置尚未更新，請重新核對。';
      }
      setAction(card, { status: 'verified', receipt: result,
        local: localMessage ? 'unavailable' : 'ready', ...(localMessage ? { localMessage } : {}) });
      if (!localMessage && active()) forgetCalendar(card);
      return true;
    }
    if (result.status === 'revoked') {
      setAction(card, { status: 'cancelled' });
      if (active()) forgetCalendar(card);
    }
    else if (result.status === 'conflict')
      setAction(card, { status: 'conflict', message: '這筆紀錄已變更，與確認內容不同；現有資料已保留，請開啟行事曆核對。' });
    else setAction(card, { status: 'absent', retryable: result.retryable,
      message: result.retryable
        ? '查核時尚未找到這筆行程。可以用原確認重試，系統會防止重複建立。'
        : '查核時尚未找到相符行程，原確認目前不能再執行。若先前曾送出，請再次核對結果。' });
    return false;
  }
  async function checkCalendar(card: V2Card): Promise<boolean> {
    const previous = actionStates.current[card.mutationId];
    if (previous?.status === 'verified')
      setAction(card, { ...previous, verificationWarning: '正在重新核對；以下保留上次核對結果。' });
    else setAction(card, { status: 'checking' });
    try {
      return await applyCalendarResult(card, await sendCard('reconcile', card));
    } catch {
      if (previous?.status === 'verified') {
        setAction(card, { ...previous, verificationWarning: '這次查核未完成，以下保留上次已核對的結果與時間。' });
        return false;
      }
      setAction(card, { status: 'unknown', message: '尚未核對執行結果。請重新核對同一筆操作，避免重複新增；後續安排已暫停。' });
      return false;
    }
  }
  async function execute(cards: V2Card[]) {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setError('');
    try {
      for (const card of cards) {
        if (!active()) break;
        const turn = turns.find((value) => value.reply.cards.some((item) => item.mutationId === card.mutationId));
        const index = turn?.reply.cards.findIndex((item) => item.mutationId === card.mutationId) ?? -1;
        if (!turn || index < 0 || card.schoolId !== schoolId ||
          !canConfirmAction(actionStates.current[card.mutationId]) ||
          !priorCalendarActionsVerified(turn.reply.cards, index, actionStates.current)) break;
        if (card.tool === 'propose_personal_event') {
          try {
            await assertAssistantCalendarLocalReady(card.args, localScope, active);
            rememberCalendar(card);
          } catch (error) {
            setAction(card, { status: 'blocked', message: error instanceof Error ? error.message : '目前無法核對這台裝置的行程，尚未送出。' });
            break;
          }
        }
        setAction(card, { status: 'executing' });
        try {
          const result = await sendCard('confirm', card);
          if (card.tool === 'propose_personal_event') {
            if (!await applyCalendarResult(card, result)) break;
          } else {
            const expectedHref = card.tool === 'propose_open_page' ? card.destination : card.args.href;
            const href = typeof result.href === 'string' ? inAppHref(result.href) : null;
            if (!href || href !== expectedHref) throw new Error('服務結果尚未核對。');
            setAction(card, { status: 'handoff', href,
              message: card.tool === 'propose_food_order' ? '點餐內容已備妥，請到點餐頁完成確認與付款。' : '服務入口已備妥。' });
          }
        } catch {
          if (!active()) break;
          // A lost response may follow a committed write. Recovery is read-only.
          if (card.tool === 'propose_personal_event') {
            if (!await checkCalendar(card)) break;
          } else {
            setAction(card, { status: 'unknown', message: '服務結果尚未核對，請到服務頁確認，避免重複送出。' });
            break;
          }
        }
      }
    } catch (e) {
      if (!controller.current?.signal.aborted)
        setError(e instanceof Error ? e.message : '確認失敗');
    } finally {
      busy.current = false;
      if (!controller.current?.signal.aborted) setPending(false);
    }
  }
  async function revisePlan(turn: V2Turn, instruction: string): Promise<{ ok: boolean; message: string }> {
    if (busy.current || !active() || !ready || !revisionConsent.current)
      return { ok: false, message: '請先等目前操作完成，並同意模型處理後再重新預覽。' };
    const continuing = revisionTurns.current.has(turn) && turn.reply.cards.every(card =>
      actionStates.current[card.mutationId] === undefined || actionStates.current[card.mutationId]?.status === 'cancelled');
    if (!turns.includes(turn) || turn.reply.cards.some(card => card.schoolId !== schoolId) ||
      hasUnresolvedAssistantAction(actionStates.current) ||
      (!isUnattemptedCalendarPlan(turn, actionStates.current) && !continuing))
      return { ok: false, message: '原提議尚未完成核對，請先核對原操作結果；這次沒有產生新安排。' };
    let current: string;
    try { current = buildPlanRevisionQuestion(turn, instruction); }
    catch (cause) { return { ok: false, message: cause instanceof Error ? cause.message : '請核對修改條件後再試。' }; }

    // Keep the original signed cards intact. A failed cancellation is never
    // permission to create another operation with the same intended outcome.
    revisionTurns.current.add(turn);
    if (turn.reply.cards.some(card => actionStates.current[card.mutationId] === undefined))
      await cancel(turn, 0);
    if (!active()) return { ok: false, message: '已離開原對話，沒有加入新預覽。' };
    if (!turn.reply.cards.every(card => actionStates.current[card.mutationId]?.status === 'cancelled'))
      return { ok: false, message: '原提議尚未全部撤銷。請先重新核對原操作結果，已儲存的行程不會被重新建立。' };
    if (!revisionConsent.current)
      return { ok: false, message: '舊提議已撤銷；模型同意已關閉，這次沒有送出新的預覽要求。' };

    busy.current = true;
    setPending(true);
    setError('');
    try {
      // The selected visible plan is sufficient context. Other conversations,
      // identifiers and execution tokens do not enter this revision request.
      const input = { question: current, history: [], consent: true };
      let reply = await send('ask', { ...input, routeToken: routeToken.current });
      if (reply.bootstrap) {
        if (!active() || !revisionConsent.current)
          return { ok: false, message: '模型同意已關閉或對話已變更，沒有繼續產生新預覽。' };
        conversation.current = reply.conversationId;
        routeToken.current = reply.routeToken;
        reply = await send('ask', { ...input, routeToken: routeToken.current });
      }
      if (!active() || !revisionConsent.current)
        return { ok: false, message: '模型同意已關閉或對話已變更，這次回覆沒有加入新預覽。' };
      if (!Array.isArray(reply.cards) || reply.cards.length === 0)
        return { ok: false, message: '尚未取得新預覽，舊提議已撤銷。請補充明確日期、時段或其他條件後再試。'
          + (typeof reply.answer === 'string' ? ' ' + reply.answer.slice(0, 400) : '') };
      const previousIds = new Set(turns.flatMap(value => value.reply.cards.map(card => card.mutationId)));
      if (new Set(reply.cards.map((card: V2Card) => card.mutationId)).size !== reply.cards.length ||
        reply.cards.some((card: V2Card) => card.tool !== 'propose_personal_event' || card.schoolId !== schoolId ||
        typeof card.mutationId !== 'string' || !card.mutationId || previousIds.has(card.mutationId) ||
        typeof card.token !== 'string' || !card.token))
        return { ok: false, message: '尚未取得新的純行程預覽。舊提議已撤銷，其他服務請另外提出並分開確認。' };
      getPlanRevisionEvents({ question: current, reply });
      reply = { ...reply, cards: reply.cards.map((card: V2Card) => ({ ...card, conversationId: conversation.current })) };
      for (const card of turns.flatMap(value => value.reply.cards)) {
        if (canConfirmAction(actionStates.current[card.mutationId]))
          setAction(card, { status: 'superseded' });
      }
      setTurns(previous => [...previous, { question: '修改原先安排：' + instruction.trim(), reply }]);
      revisionTurns.current.delete(turn);
      return { ok: true, message: '新預覽已列在下方。請重新核對並確認；尚未建立任何新行程。' };
    } catch (cause) {
      return { ok: false, message: '尚未取得新預覽，舊提議已撤銷，修改條件已保留。'
        + (cause instanceof Error ? ' ' + cause.message : '請稍後重試。') };
    } finally {
      busy.current = false;
      if (active()) setPending(false);
    }
  }
  async function reconcile(card: V2Card) {
    if (busy.current || card.tool !== 'propose_personal_event' || card.schoolId !== schoolId) return;
    busy.current = true;
    setPending(true);
    setError('');
    try {
      await checkCalendar(card);
    } finally {
      busy.current = false;
      if (active()) setPending(false);
    }
  }
  async function cancel(turn: V2Turn, cardIndex: number) {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setError('');
    try {
      const card = turn.reply.cards[cardIndex];
      const affected =
        card.tool === 'propose_personal_event' ? turn.reply.cards.slice(cardIndex) : [card];
      for (const current of affected) {
        const state = actionStates.current[current.mutationId];
        if (state?.status === 'cancelled' || state?.status === 'superseded' ||
          state?.status === 'verified' || state?.status === 'handoff') continue;
        if (!active() || current.schoolId !== schoolId) break;
        if (state?.status === 'unknown' || state?.status === 'checking' || state?.status === 'executing') break;
        if (current.tool === 'propose_personal_event') {
          try { rememberCalendar(current); }
          catch (error) {
            setAction(current, { status: 'blocked', message: error instanceof Error ? error.message : '操作紀錄尚未保存，這次沒有送出撤銷。' });
            break;
          }
        }
        try {
          const result = await sendCard('cancel', current);
          if (current.tool === 'propose_personal_event') {
            await applyCalendarResult(current, result);
            if (!['cancelled', 'verified'].includes(actionStates.current[current.mutationId]?.status)) break;
          } else {
            if (result.revoked !== true) throw new Error('撤銷結果尚未核對。');
            setAction(current, { status: 'cancelled' });
          }
        } catch {
          if (!active()) break;
          if (current.tool === 'propose_personal_event') await checkCalendar(current);
          else setAction(current, { status: 'unknown', message: '撤銷結果尚未核對，請到服務頁確認。' });
          break;
        }
      }
    } catch {
      if (active()) setError('撤銷未完成，請核對結果。');
    } finally {
      busy.current = false;
      if (active()) setPending(false);
    }
  }
  return (
    <AssistantThread
      schoolId={schoolId}
      ready={ready}
      fallback={fallback}
      consent={consent}
      onConsent={value => { revisionConsent.current = value; setConsent(value); }}
      question={question}
      onQuestion={setQuestion}
      turns={turns}
      states={states}
      pending={pending}
      error={error}
      onAsk={() => void ask()}
      onConfirm={(cards) => void execute(cards)}
      onCancel={(turn, index) => void cancel(turn, index)}
      onReconcile={(card) => void reconcile(card)}
      renderPlanRevision={turn => <AssistantPlanRevision turn={turn} states={states} pending={pending}
        enabled={ready && consent} onPreview={instruction => revisePlan(turn, instruction)} />}
    />
  );
}
function AssistantRoute({ cloudEnabled }: { cloudEnabled: boolean }) {
  const auth = useNuniSession();
  const search = useSearchParams();
  const campus = useCampusBrowseContext({
    schoolId: search.get('schoolId') ?? undefined,
    campus: search.get('campus') ?? undefined,
    school: search.get('school') ?? undefined,
  });
  if (auth.loading) return <p role="status">正在確認登入狀態…</p>;
  if (auth.pendingLogout || auth.error)
    return <p role="alert">登入狀態尚未確認，請先完成登入或登出。</p>;
  if (!auth.session)
    return <Link href="/login?returnTo=%2Fai-assistant">請先登入以使用校園助理</Link>;
  if (campus.status !== 'ready' || !campus.schoolId) return <p role="status">請先選擇學校。</p>;
  return (
    <Conversation
      key={auth.session.context + ':' + auth.session.platformAccountId + ':' + campus.schoolId + ':' + cloudEnabled}
      context={auth.session.context}
      accountId={auth.session.platformAccountId}
      cloudEnabled={cloudEnabled}
      schoolId={campus.schoolId}
    />
  );
}
export function Assistant({ children, cloudEnabled = true }: { children?: ReactNode; cloudEnabled?: boolean }) {
  return (
    <SiteShell title="助理" subtitle="查詢課表、作業、餐點與校園服務。">
      {children}
      <Suspense fallback={<p>載入中…</p>}>
        <AssistantRoute cloudEnabled={cloudEnabled} />
      </Suspense>
    </SiteShell>
  );
}
