'use client';
import Link from 'next/link';
import { Suspense, useEffect, useRef, useState, type ReactNode, type Dispatch, type SetStateAction } from 'react';
import { useSearchParams } from 'next/navigation';
import { SiteShell } from '@/components/SiteShell';
import { resolvePublicCourseAssistantIntent } from '@campus/shared/src/publicCourseAssistant';
import { answerPublicCourseQuestion } from '@campus/shared/src/publicCourseAssistantClient';
import { useCampusBrowseContext } from '@/lib/useCampusBrowseContext';
import { useNuniSession } from './Session';
import type { AssistantIntent } from '@/lib/nuni/assistantContracts';
import { AssistantThread } from './assistant/AssistantThread';
import { AssistantPlanRevision } from './assistant/AssistantPlanRevision';
import { AssistantPrecisePlanRevision, AssistantPrecisePlanComparison } from './assistant/AssistantPrecisePlanRevision';
import { buildPrecisePlanRevision, type PrecisePlanRevisionChange } from './assistant/precisePlanRevision';
import { AssistantPlanSelection, AssistantPlanSelectionComparison } from './assistant/AssistantPlanSelection';
import { buildPlanSelection } from './assistant/planSelection';
import { AssistantPlanShift, AssistantPlanShiftComparison } from './assistant/AssistantPlanShift';
import { buildShiftPlanRevision, type PlanShiftChange } from './assistant/shiftPlanRevision';
import { AssistantPlanDraftRecovery } from './assistant/AssistantPlanDraftRecovery';
import { usePlanRevisionDraft } from './assistant/usePlanRevisionDraft';
import { usePrecisePlanDraft } from './assistant/usePrecisePlanDraft';
import { useShiftPlanDraft } from './assistant/useShiftPlanDraft';
import { AssistantShiftPlanDraftRecovery } from './assistant/AssistantShiftPlanDraftRecovery';
import { shiftPlanDraftSourceMatch } from '@/lib/assistantShiftPlanDraft';
import { AssistantPrecisePlanDraftRecovery } from './assistant/AssistantPrecisePlanDraftRecovery';
import { precisePlanDraftSourceMatch } from '@/lib/assistantPrecisePlanDraft';
import { revisionDraftContentMatches, revisionDraftSource } from '@/lib/assistantPlanRevisionDraft';
import { AssistantPlanComparison } from './assistant/AssistantPlanComparison';
import { createPlanProtection, validatePlanProtection, type PlanProtection } from '@/lib/assistantPlanProtection';
import { buildPlanRevisionQuestion, getPlanRevisionEvents, hasUnresolvedAssistantAction, isUnattemptedCalendarPlan, type PlanRevisionEvent } from './assistant/planRevision';
import type { V2ActionState, V2ActionStates, V2Card, V2Turn } from './assistant/types';
import { assistantAnswerWithExecution, calendarExpectation, canConfirmAction, priorCalendarActionsVerified, withAssistantRequestDeadline } from './assistant/execution';
import { assistantPermissionMessage, inAppHref } from './assistant/copy';
import { parseAssistantCalendarExecutionResult } from '@campus/shared/src/assistantExecution';
import { assertAssistantCalendarLocalReady, mirrorAssistantCalendarReceipt } from '@/lib/assistantCalendarExecution';
import { readAssistantExecutionJournal, saveAssistantExecutionJournal, removeAssistantExecutionJournal } from '@/lib/assistantExecutionJournal';
import { answerAssistantLocally } from '@/lib/assistantLocalActions';
import { answerAssistantPersonalQuestion, canAnswerAssistantPersonalQuestion, personalAssistantReadIntent } from '@/lib/assistantPersonalReads';
import { courseworkStudyFollowup, courseworkStudyTarget, parseAssistantCourseworkTargets, type AssistantCourseworkSelection } from '@/lib/assistantCoursework';
import { AssistantServiceLinks } from '@/components/AssistantServiceLinks';
import { ASSISTANT_SERVICES } from '@campus/shared/src/assistantServices';
type Step = {
  intent: AssistantIntent;
  confirmation: string;
  summary?: string;
  answer?: string;
  simulation: boolean;
};
type InlineDraft = { text: string; setText: Dispatch<SetStateAction<string>> };
class AssistantPermissionFailure extends Error {}
export function Conversation({ context, schoolId, accountId, cloudEnabled = true, inlineDraft, onFreeformReady, initialDraft = '' }: {
  initialDraft?: string;
  context: string;
  schoolId: string;
  accountId: string;
  cloudEnabled?: boolean;
  inlineDraft?: InlineDraft;
  onFreeformReady?: (ready: boolean) => void;
}) {
  const [v2, setV2] = useState(false);
  const [ready, setReady] = useState(false);
  const [providerReady, setProviderReady] = useState(false);
  const [fallback, setFallback] = useState(false);
  const [capabilityUnavailable, setCapabilityUnavailable] = useState(!cloudEnabled);
  const [capabilityChecked, setCapabilityChecked] = useState(!cloudEnabled);
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
    if (!response.ok) {
      throw new Error(
        response.status === 404
            ? '雲端助理尚未啟用。'
            : response.status === 429
              ? '查詢次數已達上限，請稍後再試。'
              : '目前無法查詢，請重新選擇或稍後再試。',
      );
    }
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
          onFreeformReady?.(value.version === 2 && value.enabled === true && value.ready === true);
          setReady(value.enabled === true);
          setProviderReady(value.ready === true);
          setFallback(value.fallback === true);
          setCapabilityUnavailable(value.enabled !== true);
          setCapabilityChecked(true);
        }
      })
      .catch((e) => {
        if (active) {
          setError(e.message);
          setCapabilityUnavailable(true);
          setCapabilityChecked(true);
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
  if (!capabilityChecked) return <p role="status">正在確認助理是否啟用…</p>;
  if (v2 || capabilityUnavailable) return <>
    {capabilityUnavailable && <p role="status">{error || '雲端助理尚未啟用。'}</p>}
    <V2Conversation context={context} schoolId={schoolId} initialDraft={initialDraft} accountId={accountId} inlineDraft={inlineDraft} ready={ready && providerReady} fallback={fallback} />
  </>;
  return (
    <section aria-label="公開校園助理">
      <V2Conversation context={context} schoolId={schoolId} initialDraft={initialDraft} accountId={accountId}
        inlineDraft={inlineDraft} ready={false} fallback={false} />
      <details>
      <summary>公開校園資訊查詢</summary>
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
      </details>
    </section>
  );
}
const ASSISTANT_PENDING_STATUS = {
  ask: '正在整理回覆',
  confirm: '正在確認操作結果',
  reconcile: '正在核對執行結果',
  cancel: '正在確認撤銷結果',
} as const;

function V2Conversation({
  context,
  schoolId,
  initialDraft,
  ready,
  fallback,
  inlineDraft,
  accountId,
}: {
  context: string;
  schoolId: string;
  initialDraft: string;
  ready: boolean;
  fallback: boolean;
  inlineDraft?: InlineDraft;
  accountId: string;
}) {
  const conversation = useRef(crypto.randomUUID());
  const [consent, setConsent] = useState(false);
  const [localQuestion, setLocalQuestion] = useState(initialDraft);
  const question = inlineDraft?.text ?? localQuestion;
  const setQuestion = inlineDraft?.setText ?? setLocalQuestion;
  const [turns, setTurns] = useState<V2Turn[]>([]);
  const [states, setStates] = useState<V2ActionStates>({});
  const actionStates = useRef<V2ActionStates>({});
  const journalReadyRef = useRef(false);
  const [journalReady, setJournalReady] = useState(false);
  const busy = useRef(false);
  const [pending, setPending] = useState(false);
  const [pendingAction, setPendingAction] = useState<keyof typeof ASSISTANT_PENDING_STATUS>('ask');
  const [asking, setAsking] = useState(false);
  const askRequest = useRef<AbortController | null>(null);
  const [error, setError] = useState('');
  const [recoverableQuestion, setRecoverableQuestion] = useState('');
  const routeToken = useRef<string | undefined>(undefined);
  const revisionConsent = useRef(false);
  const revisionTurns = useRef(new Set<V2Turn>());
  const preciseRevisionTurns = useRef(new Set<V2Turn>());
  const selectionRevisionTurns = useRef(new Set<V2Turn>());
  const shiftRevisionTurns = useRef(new Set<V2Turn>());
  const protectedSelections = useRef(new WeakMap<V2Turn, number[]>());
  const [, refreshProtectedSelections] = useState(0);
  const rejectedProposalIds = useRef(new Set<string>());
  // Selection and group-shift per-card policies follow their revision descendants,
  // independently of comparison indices or any restored draft content.
  const individualConfirmationTurns = useRef(new WeakSet<V2Turn>());
  const planComparisons = useRef(new WeakMap<V2Turn, { before: PlanRevisionEvent[]; after: PlanRevisionEvent[]; preciseIndex?: number; retainedIndices?: number[]; shiftedIndices?: number[]; offsetMinutes?: number }>());
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
    journalReadyRef.current = false;
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
        setPendingAction('reconcile');
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
              journalReadyRef.current = true;
              setJournalReady(true);
            }
          }
        });
      } else {
        journalReadyRef.current = true;
        setJournalReady(true);
      }
    } catch (error) {
      setError(error instanceof Error ? error.message : '先前操作紀錄暫時讀不到，請保留目前頁面再試。');
    }
    return () => lifetime.abort();
    // This component is keyed by the authenticated session, account and school.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const drafts = usePlanRevisionDraft({ accountId, schoolId, context }, active);
  const timeDrafts = usePrecisePlanDraft({ accountId, schoolId, context }, active);
  const shiftDrafts = useShiftPlanDraft({ accountId, schoolId, context }, active);
  function sourceForTurn(turn: V2Turn) {
    if (turn.reply.cards.some(card => card.schoolId !== schoolId)) return null;
    try { return revisionDraftSource(turn.reply.cards); } catch { return null; }
  }
  function clearTurnDraft(turn: V2Turn): { ok: boolean; message?: string } {
    const source = sourceForTurn(turn);
    if (!source) return { ok: true };
    // Each mode stores unfinished inputs for this exact source, never execution authority.
    // Clear sequentially before dispatch; any unverified storage result stops dispatch.
    const textResult = drafts.clearSource(source.key, true);
    if (!textResult.ok) return textResult;
    const timeResult = timeDrafts.clearSource(source.key, true);
    if (!timeResult.ok) return timeResult;
    return shiftDrafts.clearSource(source.key, true);
  }
  function canEditPlanDraft(turn: V2Turn) {
    return active() && !busy.current && journalReadyRef.current &&
      turns.includes(turn) && !hasUnresolvedAssistantAction(actionStates.current) &&
      isUnattemptedCalendarPlan(turn, actionStates.current) &&
      !revisionTurns.current.has(turn) && !preciseRevisionTurns.current.has(turn) && !selectionRevisionTurns.current.has(turn) && !shiftRevisionTurns.current.has(turn);
  }
  function changeProtectedSelection(turn: V2Turn, indices: readonly number[]) {
    if (!active() || busy.current || !turns.includes(turn) || hasUnresolvedAssistantAction(actionStates.current)) return;
    const registered = [revisionTurns, preciseRevisionTurns, selectionRevisionTurns, shiftRevisionTurns]
      .some(attempts => attempts.current.has(turn));
    const retrying = registered && turn.reply.cards.every(card =>
      actionStates.current[card.mutationId] === undefined || actionStates.current[card.mutationId]?.status === 'cancelled');
    if ((!isUnattemptedCalendarPlan(turn, actionStates.current) && !retrying) ||
      new Set(indices).size !== indices.length ||
      indices.some(index => !Number.isInteger(index) || index < 0 || index >= turn.reply.cards.length)) return;
    // This changes only the current editing constraint. It never restores old
    // signatures, changes a signed card or sends an operation.
    protectedSelections.current.set(turn, [...indices]);
    refreshProtectedSelections(value => value + 1);
  }
  async function send(action: string, input: object, askSignal?: AbortSignal) {
    const scopeSignal = controller.current!.signal;
    const signal = askSignal ?? scopeSignal;
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
    const permissionMessage = assistantPermissionMessage(result.error);
    if (!response.ok && permissionMessage) throw new AssistantPermissionFailure(permissionMessage);
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
    if (signal.aborted || scopeSignal.aborted) throw new Error('已取消');
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
  async function ask(selection?: AssistantCourseworkSelection) {
    const current = selection
      ? `幫「${selection.target.title}」${selection.date ? '在 ' + selection.date + ' ' : ''}找 30 分鐘準備時間`
      : question.trim();
    if (!current || busy.current) return;
    const publicCourseIntent = !selection && resolvePublicCourseAssistantIntent(current, schoolId);
    const followup = !publicCourseIntent && !selection ? courseworkStudyFollowup(current) : null;
    const targets = parseAssistantCourseworkTargets(turns.at(-1)?.reply.courseworkTargets);
    const studyDate = followup?.date ?? turns.at(-1)?.reply.courseworkDate;
    let studySelection = selection;
    if (followup) {
      if (targets.length !== 1) {
        const content = targets.length
          ? '要替哪一份安排？請選下方作業或測驗，我會重新核對來源與時段，再列出確認內容。'
          : '請先查詢未交作業，或從剛才的作業清單選擇一份，再幫你找 30 分鐘的準備空堂。';
        setTurns((previous) => [...previous, { question: current, reply: {
          answer: content, steps: [], cards: [], dataRead: true,
          courseworkTargets: targets, courseworkDate: studyDate,
        } }]);
        setQuestion('');
        setError('');
        return;
      }
      studySelection = { target: targets[0], ...(studyDate ? { date: studyDate } : {}) };
    }
    const local = !studySelection && answerAssistantLocally(current, { owner: accountId ? 'platform:' + accountId : '', schoolId }, { deferMissingSchedule: ready && consent, preferCampusReads: personalAssistantReadIntent(current)?.kind === 'calendar' });
    if (local && !publicCourseIntent) {
      setTurns((previous) => [...previous, { question: current,
        reply: { answer: local.content, steps: [], cards: [], local } }]);
      setQuestion('');
      setError('');
      return;
    }
    const personalRead = !studySelection && canAnswerAssistantPersonalQuestion(current);
    if ((!consent || !ready) && !publicCourseIntent && !personalRead && !studySelection) return;
    busy.current = true;
    const pendingAsk = new AbortController();
    askRequest.current = pendingAsk;
    const scopeSignal = controller.current!.signal;
    const abortForScope = () => pendingAsk.abort();
    if (scopeSignal.aborted) pendingAsk.abort();
    else scopeSignal.addEventListener('abort', abortForScope, { once: true });
    setAsking(true);
    setPendingAction('ask');
    setPending(true);
    setError('');
    // Free the composer immediately so the next thought can be typed during a slow response.
    // The sent content remains captured in `current` and can be recovered on failure.
    if (!selection) setQuestion('');
    try {
      if (publicCourseIntent) {
        const result = await answerPublicCourseQuestion({
          question: current,
          schoolId,
          origin: 'web',
          signal: pendingAsk.signal,
          isCurrent: () => !pendingAsk.signal.aborted,
        });
        if (pendingAsk.signal.aborted || !result) return;
        setTurns((t) => [...t, {
          question: current,
          reply: { answer: result.content, steps: [], cards: [] },
          publicCourse: { read: result.read },
        }]);
        return;
      }
      if (personalRead) {
        const direct = await withAssistantRequestDeadline(pendingAsk.signal, 45000, (signal) =>
          answerAssistantPersonalQuestion(current, localScope, {
            context, signal, fallbackOnMissing: ready && consent,
          }));
        if (pendingAsk.signal.aborted || scopeSignal.aborted) return;
        if (direct) {
          setTurns((previous) => [...previous, { question: current,
            reply: { answer: direct.content, steps: [], cards: [], local: direct,
              courseworkTargets: parseAssistantCourseworkTargets(direct.courseworkTargets) } }]);
          setRecoverableQuestion((previous) => previous === current ? '' : previous);
          return;
        }
      }
      if ((!ready || !consent) && !studySelection) return;
      const history = studySelection ? [] : turns.filter((turn) => !turn.publicCourse && !turn.reply.local && !turn.reply.dataRead &&
        !turn.reply.steps.some((step) => step.name === 'get_imported_academics')).slice(-6).flatMap((t) => [
        { role: 'user', content: t.question },
        { role: 'assistant', content: assistantAnswerWithExecution(t, actionStates.current) },
      ]);
      const studyTarget = studySelection ? courseworkStudyTarget(studySelection) : undefined;
      let reply = await send('ask', { question: current, history, consent, routeToken: routeToken.current,
        ...(studyTarget ? { studyTarget } : {}) }, pendingAsk.signal);
      if (reply.bootstrap) {
        conversation.current = reply.conversationId;
        routeToken.current = reply.routeToken;
        reply = await send('ask', { question: current, history, consent, routeToken: routeToken.current,
          ...(studyTarget ? { studyTarget } : {}) }, pendingAsk.signal);
      }
      reply = { ...reply, cards: reply.cards.map((card: V2Card) => ({ ...card, conversationId: conversation.current })) };
      // The last selected source stays an untrusted hint for a fresh read, never a model-history fact.
      reply.courseworkTargets = parseAssistantCourseworkTargets(
        reply.courseworkTargets ?? (studySelection ? [studySelection.target] : undefined));
      if (studySelection) {
        reply.dataRead = true;
        reply.courseworkDate = studySelection.date;
      }
      if (reply.cards.length) {
        for (const card of turns.flatMap((turn) => turn.reply.cards)) {
          if (canConfirmAction(actionStates.current[card.mutationId]))
            setAction(card, { status: 'superseded' });
        }
      }
      setTurns((t) => [...t, { question: current, reply }]);
      setRecoverableQuestion((previous) => previous === current ? '' : previous);
    } catch (e) {
      if (!controller.current?.signal.aborted) {
        setError(pendingAsk.signal.aborted ? '已停止這次回答。原問題已保留，沒有執行任何確認操作。'
          : e instanceof Error ? e.message : '查詢失敗');
        if (!selection) setRecoverableQuestion(current);
      }
    } finally {
      scopeSignal.removeEventListener('abort', abortForScope);
      if (askRequest.current === pendingAsk) askRequest.current = null;
      busy.current = false;
      if (!scopeSignal.aborted) {
        setAsking(false);
        setPending(false);
      }
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
    setPendingAction('reconcile');
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
    // Selection previews promise a separate decision for every retained item.
    // Keep this guard even when a caller bypasses the presentation controls.
    if (cards.length > 1 && cards.some(card => turns.some(turn =>
      turn.reply.cards.some(item => item.mutationId === card.mutationId) &&
      individualConfirmationTurns.current.has(turn)))) {
      if (active()) setError('請逐張核對並確認保留項目；這次沒有送出任何行程。');
      return;
    }
    busy.current = true;
    setPendingAction('confirm');
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
          const cleared = clearTurnDraft(turn);
          if (!cleared.ok) { setError(cleared.message || '草稿尚未確認清除，這次操作尚未送出。'); break; }
          try {
            await assertAssistantCalendarLocalReady(card.args, localScope, active);
            rememberCalendar(card);
          } catch (error) {
            setAction(card, { status: 'blocked', message: error instanceof Error ? error.message : '目前無法核對這台裝置的行程，尚未送出。' });
            break;
          }
        }
        // A previous card may have required a read-only reconcile; restore the write-stage label.
        setPendingAction('confirm');
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
        } catch (error) {
          if (!active()) break;
          if (error instanceof AssistantPermissionFailure) {
            setError(error.message);
            // A prior attempt may still need its receipt read back; never retry a write here.
            if (card.tool === 'propose_personal_event') await checkCalendar(card);
            else setAction(card, { status: 'blocked', message: error.message });
            break;
          }
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
  async function revisePlan(turn: V2Turn, instruction: string, protectedIndices: readonly number[] = []): Promise<{ ok: boolean; message: string }> {
    if (busy.current || !active() || !ready || !revisionConsent.current)
      return { ok: false, message: '請先等目前操作完成，並同意模型處理後再重新預覽。' };
    const continuing = revisionTurns.current.has(turn) && turn.reply.cards.every(card =>
      actionStates.current[card.mutationId] === undefined || actionStates.current[card.mutationId]?.status === 'cancelled');
    if (!turns.includes(turn) || turn.reply.cards.some(card => card.schoolId !== schoolId) ||
      hasUnresolvedAssistantAction(actionStates.current) ||
      (!isUnattemptedCalendarPlan(turn, actionStates.current) && !continuing))
      return { ok: false, message: '原提議尚未完成核對，請先核對原操作結果；這次沒有產生新安排。' };
    let current: string;
    let before: PlanRevisionEvent[];
    let protection: PlanProtection | undefined;
    try {
      before = getPlanRevisionEvents(turn);
      protection = createPlanProtection(turn.reply.cards.map(card => card.args), protectedIndices);
      if (protection && protection.protectedIndices.length === protection.originalEvents.length)
        return { ok: false, message: isUnattemptedCalendarPlan(turn, actionStates.current)
          ? '已選擇全部保留原樣，不需要重新預覽；原確認卡保持原狀。'
          : '已選擇全部保留原樣，但原提議已撤銷，不能恢復舊確認卡；這次沒有送出新的要求。' };
      current = buildPlanRevisionQuestion(turn, instruction, protectedIndices);
    }
    catch (cause) { return { ok: false, message: cause instanceof Error ? cause.message : '請核對修改條件後再試。' }; }

    const cleared = clearTurnDraft(turn);
    if (!cleared.ok) return { ok: false, message: cleared.message || '草稿尚未確認清除，這次操作尚未送出。' };

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
      // Even without locked items, identify this as a revision of the reviewed plan.
      const input = { question: current, history: [], consent: true, planProtection: protection };
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
      const previousIds = new Set([...rejectedProposalIds.current, ...turns.flatMap(value => value.reply.cards.map(card => card.mutationId))]);
      if (new Set(reply.cards.map((card: V2Card) => card.mutationId)).size !== reply.cards.length ||
        reply.cards.some((card: V2Card) => card.tool !== 'propose_personal_event' || card.schoolId !== schoolId ||
        typeof card.mutationId !== 'string' || !card.mutationId || previousIds.has(card.mutationId) ||
        typeof card.token !== 'string' || !card.token))
        return { ok: false, message: '尚未取得新的純行程預覽。舊提議已撤銷，其他服務請另外提出並分開確認。' };
      if (protection) {
        const preservation = validatePlanProtection(protection, reply.cards.map((card: V2Card) => card.args));
        if (!preservation.ok) {
          for (const card of reply.cards) rejectedProposalIds.current.add(card.mutationId);
          return { ok: false, message: '新預覽不符合保留條件，沒有提供新的可確認提議。' + preservation.message + ' 修改條件與保留選擇已保留，請調整後再試。' };
        }
      }
      const after = getPlanRevisionEvents({ question: current, reply });
      reply = { ...reply, cards: reply.cards.map((card: V2Card) => ({ ...card, conversationId: conversation.current })) };
      for (const card of turns.flatMap(value => value.reply.cards)) {
        if (canConfirmAction(actionStates.current[card.mutationId]))
          setAction(card, { status: 'superseded' });
      }
      const revisedTurn = { question: '修改原先安排：' + instruction.trim(), reply };
      const protectedEvents = protection.protectedIndices.map(index => protection.originalEvents[index]);
      const sameEvent = (left: PlanRevisionEvent, right: PlanRevisionEvent) =>
        ['title', 'date', 'endDate', 'allDay', 'startTime', 'endTime'].every(field =>
          Object.hasOwn(left, field) === Object.hasOwn(right, field) &&
          left[field as keyof PlanRevisionEvent] === right[field as keyof PlanRevisionEvent]);
      protectedSelections.current.set(revisedTurn, after.flatMap((event, index) =>
        protectedEvents.some(locked => sameEvent(event, locked)) ? [index] : []));
      if (individualConfirmationTurns.current.has(turn)) individualConfirmationTurns.current.add(revisedTurn);
      // Comparison is local presentation data, never a replacement for signed cards.
      planComparisons.current.set(revisedTurn, { before, after });
      setTurns(previous => [...previous, revisedTurn]);
      revisionTurns.current.delete(turn);
      return { ok: true, message: '這次重新預覽沒有寫入行程。請核對下方新卡，再決定是否確認。' };
    } catch (cause) {
      return { ok: false, message: '尚未取得新預覽，舊提議已撤銷，修改條件已保留。'
        + (cause instanceof Error ? ' ' + cause.message : '請稍後重試。') };
    } finally {
      busy.current = false;
      if (active()) setPending(false);
    }
  }
  async function reviseTime(turn: V2Turn, change: PrecisePlanRevisionChange) {
    return reviseDirectPlan(turn, { kind: 'time', change });
  }
  async function reviseSelection(turn: V2Turn, keepMutationIds: string[]) {
    return reviseDirectPlan(turn, { kind: 'selection', keepMutationIds });
  }
  async function reviseShift(turn: V2Turn, change: PlanShiftChange) {
    return reviseDirectPlan(turn, { kind: 'shift', change });
  }
  async function reviseDirectPlan(turn: V2Turn, request:
    | { kind: 'time'; change: PrecisePlanRevisionChange }
    | { kind: 'selection'; keepMutationIds: string[] }
    | { kind: 'shift'; change: PlanShiftChange },
  ): Promise<{ ok: boolean; message: string }> {
    const selecting = request.kind === 'selection', shifting = request.kind === 'shift';
    const attempts = selecting ? selectionRevisionTurns.current : shifting ? shiftRevisionTurns.current : preciseRevisionTurns.current;
    if (busy.current || !active() || !journalReadyRef.current)
      return { ok: false, message: selecting
        ? '請先等目前操作與原結果核對完成，再選擇要建立的行程。'
        : '請先等目前操作與原結果核對完成，再調整時間。' };
    const continuing = attempts.has(turn) && turn.reply.cards.every(card =>
      actionStates.current[card.mutationId] === undefined || actionStates.current[card.mutationId]?.status === 'cancelled');
    if (!turns.includes(turn) || turn.reply.cards.some(card => card.schoolId !== schoolId) ||
      hasUnresolvedAssistantAction(actionStates.current) ||
      (!isUnattemptedCalendarPlan(turn, actionStates.current) && !continuing))
      return { ok: false, message: '原提議尚未完成核對，這次不會建立新預覽；已寫入的行程不能由此修改。' };
    let edit: { before: PlanRevisionEvent[]; after: PlanRevisionEvent[]; changed: boolean;
      label: string; preciseIndex?: number; retainedIndices?: number[]; shiftedIndices?: number[]; offsetMinutes?: number };
    try {
      if (request.kind === 'time') {
        const time = buildPrecisePlanRevision(turn, request.change);
        edit = { ...time, preciseIndex: time.index };
      } else if (request.kind === 'shift') {
        const shift = buildShiftPlanRevision(turn, request.change, protectedSelections.current.get(turn) ?? []);
        edit = { ...shift, shiftedIndices: shift.selectedIndices };
      } else {
        const selected = buildPlanSelection(turn, request.keepMutationIds);
        edit = { ...selected, retainedIndices: selected.keptIndices,
          label: `保留 ${selected.after.length} 項，不建立 ${selected.before.length - selected.after.length} 項` };
      }
    } catch (cause) {
      return { ok: false, message: cause instanceof Error ? cause.message : '請核對要調整的原提議。' };
    }
    if (!edit.changed)
      return { ok: false, message: selecting
        ? '尚未排除任何項目，這次不會重新預覽；請查看原確認卡的狀態。'
        : '日期與時間沒有變更，這次不會重新預覽；請查看原確認卡的狀態。' };
    const cancellingAll = selecting && edit.after.length === 0;
    if (!cancellingAll && !routeToken.current)
      return { ok: false, message: '原提議來源已失效，請重新取得有效的行程預覽。' };
    const input = {
      routeToken: routeToken.current,
      originalCards: turn.reply.cards.map(card => ({ token: card.token, args: card.args })),
      ...(request.kind === 'time' ? { change: request.change }
        : request.kind === 'shift' ? { shift: { mutationIds: edit.shiftedIndices!.map(index => turn.reply.cards[index].mutationId),
          offsetMinutes: request.change.offsetMinutes,
          protectedMutationIds: (protectedSelections.current.get(turn) ?? []).map(index => turn.reply.cards[index].mutationId) } }
        : { keepMutationIds: edit.retainedIndices!.map(index => turn.reply.cards[index].mutationId) }),
    };
    // No source is truncated or modified. The empty selection only cancels;
    // it never sends a revision request or attempts to create an empty plan.
    const bytes = new TextEncoder().encode(JSON.stringify({ schoolId, conversationId: conversation.current, ...input })).byteLength;
    if (!cancellingAll && bytes > 16384)
      return { ok: false, message: '這份提議超過可完整核對的大小，原確認卡未變更。請重新取得較少項目的預覽後再調整。' };
    const cleared = clearTurnDraft(turn);
    if (!cleared.ok) return { ok: false, message: cleared.message || '原草稿尚未確認清除，這次尚未送出。' };
    attempts.add(turn);
    if (turn.reply.cards.some(card => actionStates.current[card.mutationId] === undefined))
      await cancel(turn, 0);
    if (!active()) return { ok: false, message: '已離開原對話，沒有加入新預覽。' };
    if (!turn.reply.cards.every(card => actionStates.current[card.mutationId]?.status === 'cancelled'))
      return { ok: false, message: selecting
        ? '原提議尚未全部確認撤銷，不能宣稱已排除或提供新卡。請先核對原操作結果；不會刪除已存在的行程。'
        : '原提議尚未全部確認撤銷。請先核對原操作結果，再調整時間。' };
    if (cancellingAll) {
      attempts.delete(turn);
      return { ok: true, message: '整份待確認提議已確認撤銷，這次不建立任何項目。沒有呼叫模型、建立新預覽或刪除既有行程。' };
    }
    busy.current = true;
    setPending(true);
    setError('');
    try {
      // Deterministic revisions use the same signed-source route. None
      // includes a model question/history or reuses any original signed card.
      let reply = await send('revise', input);
      if (!active()) return { ok: false, message: '對話已變更，這次回覆沒有加入新預覽。' };
      const previousIds = new Set([...rejectedProposalIds.current, ...turns.flatMap(value => value.reply.cards.map(card => card.mutationId))]);
      if (!Array.isArray(reply.cards) || reply.cards.length !== edit.after.length ||
        new Set(reply.cards.map((card: V2Card) => card.mutationId)).size !== reply.cards.length ||
        reply.cards.some((card: V2Card) => card.tool !== 'propose_personal_event' || card.schoolId !== schoolId ||
          typeof card.mutationId !== 'string' || !card.mutationId || previousIds.has(card.mutationId) ||
          typeof card.token !== 'string' || !card.token))
        return { ok: false, message: '新預覽無法完整核對，沒有提供新的確認卡。修改欄位已保留。' };
      const after = createPlanProtection(reply.cards.map((card: V2Card) => card.args), []).originalEvents;
      const exact = (events: PlanRevisionEvent[]) => JSON.stringify(events.map(event =>
        Object.entries(event).sort(([left], [right]) => left.localeCompare(right))));
      if (exact(after) !== exact(edit.after)) {
        for (const card of reply.cards) rejectedProposalIds.current.add(card.mutationId);
        return { ok: false, message: selecting
          ? '新預覽與指定保留項目的內容或順序不一致，沒有提供可確認的安排。'
          : '新預覽與指定的時間或其他原項目不一致，沒有提供可確認的安排。' };
      }
      reply = { ...reply, cards: reply.cards.map((card: V2Card) => ({ ...card, conversationId: conversation.current })) };
      for (const card of turns.flatMap(value => value.reply.cards)) {
        if (canConfirmAction(actionStates.current[card.mutationId])) setAction(card, { status: 'superseded' });
      }
      const revisedTurn = { question: (selecting ? '選擇要建立的行程：' : shifting ? '整組調整時間：' : '精確調整時間：') + edit.label, reply };
      if (selecting || shifting || individualConfirmationTurns.current.has(turn)) individualConfirmationTurns.current.add(revisedTurn);
      const sourceLocks = protectedSelections.current.get(turn) ?? [];
      protectedSelections.current.set(revisedTurn, selecting
        ? edit.retainedIndices!.flatMap((sourceIndex, index) => sourceLocks.includes(sourceIndex) ? [index] : [])
        : [...sourceLocks]);
      planComparisons.current.set(revisedTurn, { before: edit.before, after,
        ...(selecting ? { retainedIndices: edit.retainedIndices }
          : shifting ? { shiftedIndices: edit.shiftedIndices, offsetMinutes: edit.offsetMinutes }
          : { preciseIndex: edit.preciseIndex }) });
      setTurns(previous => [...previous, revisedTurn]);
      attempts.delete(turn);
      return { ok: true, message: selecting
        ? '已依原順序重新預覽保留項目，內容保持原樣；沒有呼叫模型或寫入行程。請核對後逐張確認。'
        : shifting ? '整組時間調整已供預覽，沒有呼叫模型或寫入行程。請核對前後差異後逐張確認。'
        : '時間調整已供預覽，沒有呼叫模型或寫入行程。請核對後逐張確認。' };
    } catch (cause) {
      return { ok: false, message: (selecting
        ? '尚未取得所選行程的預覽；原提議已撤銷，保留選擇仍在此頁。'
        : shifting ? '整組時間預覽未完成，沒有提供部分新卡；原提議已撤銷，選取範圍與分鐘數仍保留。'
        : '尚未取得時間調整預覽；原提議已撤銷，修改欄位已保留。')
        + (cause instanceof Error ? ' ' + cause.message : '請核對後再試。') };
    } finally {
      busy.current = false;
      if (active()) setPending(false);
    }
  }
  async function reconcile(card: V2Card) {
    if (busy.current || card.tool !== 'propose_personal_event' || card.schoolId !== schoolId) return;
    busy.current = true;
    setPendingAction('reconcile');
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
    setPendingAction('cancel');
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
          const cleared = clearTurnDraft(turn);
          if (!cleared.ok) { setError(cleared.message || '草稿尚未確認清除，這次操作尚未送出。'); break; }
          try { rememberCalendar(current); }
          catch (error) {
            setAction(current, { status: 'blocked', message: error instanceof Error ? error.message : '操作紀錄尚未保存，這次沒有送出撤銷。' });
            break;
          }
        }
        setPendingAction('cancel');
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
  function recoverQuestion() {
    if (busy.current || !recoverableQuestion) return;
    const previousQuestion = recoverableQuestion;
    // Swapping preserves a follow-up already typed while the failed request was running.
    setRecoverableQuestion(question.trim() ? question : '');
    setQuestion(previousQuestion);
    setError('');
  }
  return (
    <>
    <AssistantPlanDraftRecovery draft={drafts.draft} restored={drafts.restored} status={drafts.status}
      blocked={!journalReady || pending || hasUnresolvedAssistantAction(states)}
      onRestore={drafts.restore} onDiscard={drafts.discard} onChange={drafts.changeRecovered} />
    <AssistantPrecisePlanDraftRecovery draft={timeDrafts.draft} restored={timeDrafts.restored} status={timeDrafts.status}
      blocked={!journalReady || pending || hasUnresolvedAssistantAction(states)}
      onRestore={timeDrafts.restore} onDiscard={timeDrafts.discard} />
    <AssistantShiftPlanDraftRecovery draft={shiftDrafts.draft} restored={shiftDrafts.restored} status={shiftDrafts.status}
      blocked={!journalReady || pending || hasUnresolvedAssistantAction(states)}
      onRestore={shiftDrafts.restore} onDiscard={shiftDrafts.discard} />
    <AssistantThread
      inline={!!inlineDraft}
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
      pendingLabel={ASSISTANT_PENDING_STATUS[pendingAction]}
      asking={asking}
      onStopAsk={() => askRequest.current?.abort()}
      error={error}
      recoverableQuestion={recoverableQuestion}
      onRecoverQuestion={recoverQuestion}
      onAsk={() => void ask()}
      onStudyTarget={(target, date) => void ask({ target, date })}
      onStop={inlineDraft && asking ? () => askRequest.current?.abort() : undefined}
      onConfirm={(cards) => void execute(cards)}
      allowBatchConfirmation={turn => !individualConfirmationTurns.current.has(turn)}
      onCancel={(turn, index) => void cancel(turn, index)}
      onReconcile={(card) => void reconcile(card)}
      renderPlanComparison={turn => {
        const comparison = planComparisons.current.get(turn);
        return comparison ? comparison.shiftedIndices !== undefined
          ? <AssistantPlanShiftComparison before={comparison.before} after={comparison.after} selectedIndices={comparison.shiftedIndices} offsetMinutes={comparison.offsetMinutes!} />
          : comparison.retainedIndices !== undefined
          ? <AssistantPlanSelectionComparison before={comparison.before} retainedIndices={comparison.retainedIndices} />
          : comparison.preciseIndex !== undefined
          ? <AssistantPrecisePlanComparison before={comparison.before} after={comparison.after} index={comparison.preciseIndex} />
          : <AssistantPlanComparison {...comparison} /> : null;
      }}
      renderPlanRevision={turn => {
        const source = sourceForTurn(turn);
        return <>
          <AssistantPlanSelection turn={turn} states={states} pending={pending}
            enabled={journalReady} onPreview={ids => reviseSelection(turn, ids)} />
          <AssistantPlanShift turn={turn} states={states} pending={pending} enabled={journalReady}
            protectedIndices={protectedSelections.current.get(turn) ?? []} onPreview={change => reviseShift(turn, change)}
            onReleaseProtection={index => changeProtectedSelection(turn,
              (protectedSelections.current.get(turn) ?? []).filter(value => value !== index))}
            draft={source ? {
              status: shiftDrafts.editorStatuses[source.key],
              pendingRecovery: !!shiftDrafts.draft,
              recovery: shiftDrafts.restored && shiftDrafts.draft ? {
                id: shiftDrafts.draft.id,
                match: shiftPlanDraftSourceMatch(shiftDrafts.draft, source, protectedSelections.current.get(turn) ?? []),
              } : undefined,
              onChange: content => {
                if (canEditPlanDraft(turn)) shiftDrafts.saveEditor(source, content);
              },
              onReplace: content => {
                if (!canEditPlanDraft(turn))
                  return { ok: false, message: '目前提議或原操作仍待核對，尚未取代平移草稿。' };
                return shiftDrafts.replaceEditor(source, content);
              },
              onClear: () => shiftDrafts.clearSource(source.key),
              onApply: () => {
                if (!canEditPlanDraft(turn))
                  return { ok: false, message: '請先取得有效且未執行的提議，並核對原操作後再套用平移草稿。' };
                return shiftDrafts.apply(source, protectedSelections.current.get(turn) ?? []);
              },
            } : undefined} />
          <AssistantPrecisePlanRevision turn={turn} states={states} pending={pending}
            enabled={journalReady} onPreview={change => reviseTime(turn, change)}
            draft={source ? {
              status: timeDrafts.editorStatuses[source.key],
              pendingRecovery: !!timeDrafts.draft,
              recovery: timeDrafts.restored && timeDrafts.draft ? {
                id: timeDrafts.draft.id, match: precisePlanDraftSourceMatch(timeDrafts.draft, source),
              } : undefined,
              onChange: content => {
                if (canEditPlanDraft(turn)) timeDrafts.saveEditor(source, content);
              },
              onReplace: content => {
                if (!canEditPlanDraft(turn))
                  return { ok: false, message: '目前提議或原操作仍待核對，尚未取代時間草稿。' };
                return timeDrafts.replaceEditor(source, content);
              },
              onClear: () => timeDrafts.clearSource(source.key),
              onApply: () => {
                if (!canEditPlanDraft(turn))
                  return { ok: false, message: '請先取得有效且未執行的提議，並核對原操作後再套用時間草稿。' };
                return timeDrafts.apply(source);
              },
            } : undefined} />
          <AssistantPlanRevision turn={turn} states={states} pending={pending}
          protectedSelection={protectedSelections.current.get(turn) ?? []}
          onProtectedSelectionChange={indices => changeProtectedSelection(turn, indices)}
          enabled={ready && consent} onPreview={(instruction, indices) => revisePlan(turn, instruction, indices)}
          draft={source ? {
            status: drafts.editorStatuses[source.key],
            recovery: drafts.restored && drafts.draft ? {
              id: drafts.draft.id, sameContent: revisionDraftContentMatches(drafts.draft, source),
            } : undefined,
            onChange: (instruction, indices) => {
              if (active() && isUnattemptedCalendarPlan(turn, actionStates.current) && !revisionTurns.current.has(turn) &&
                !preciseRevisionTurns.current.has(turn) && !selectionRevisionTurns.current.has(turn) && !shiftRevisionTurns.current.has(turn))
                drafts.saveEditor(source, { instruction, protectedIndices: [...indices] });
            },
            onClear: () => drafts.clearSource(source.key),
            onApply: () => {
              if (!active() || busy.current || !journalReadyRef.current || !ready || !revisionConsent.current ||
                hasUnresolvedAssistantAction(actionStates.current) || !turns.includes(turn) ||
                !isUnattemptedCalendarPlan(turn, actionStates.current) || revisionTurns.current.has(turn) ||
                preciseRevisionTurns.current.has(turn) || selectionRevisionTurns.current.has(turn) || shiftRevisionTurns.current.has(turn))
                return { ok: false, message: '目前提議或舊操作尚未完成核對，請先核對後再套用草稿。' };
              return drafts.apply(source);
            },
          } : undefined} />
        </>;
      }}
    />
    </>
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
  const initialDraft = (search.get('q') || '').slice(0, 1000);
  if (auth.loading) return <p role="status">正在確認登入狀態…</p>;
  if (auth.pendingLogout || auth.error)
    return <p role="alert">登入狀態尚未確認，請先完成登入或登出。</p>;
  if (!auth.session) {
    const returnTo = '/ai-assistant' + (search.size ? `?${search.toString()}` : '');
    return <Link href={'/login?returnTo=' + encodeURIComponent(returnTo)}>請先登入以使用校園助理</Link>;
  }
  if (campus.status !== 'ready' || !campus.schoolId) return <p role="status">請先選擇學校。</p>;
  return (
    <Conversation
      key={JSON.stringify([auth.session.context, auth.session.platformAccountId, campus.schoolId, cloudEnabled, initialDraft])}
      context={auth.session.context}
      accountId={auth.session.platformAccountId}
      cloudEnabled={cloudEnabled}
      schoolId={campus.schoolId}
      initialDraft={initialDraft}
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
