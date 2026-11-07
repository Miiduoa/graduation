'use client';
import Link from 'next/link';
import { Suspense, useEffect, useRef, useState, type ReactNode, type Dispatch, type SetStateAction } from 'react';
import { useSearchParams } from 'next/navigation';
import { SiteShell } from '@/components/SiteShell';
import { useCampusBrowseContext } from '@/lib/useCampusBrowseContext';
import { useNuniSession } from './Session';
import type { AssistantIntent } from '@/lib/nuni/assistantContracts';
import { AssistantThread } from './assistant/AssistantThread';
import type { V2Card, V2Turn } from './assistant/types';
type Step = {
  intent: AssistantIntent;
  confirmation: string;
  summary?: string;
  answer?: string;
  simulation: boolean;
};
type InlineDraft = { text: string; setText: Dispatch<SetStateAction<string>> };
export function Conversation({ context, schoolId, inlineDraft, onFreeformReady }: {
  context: string;
  schoolId: string;
  inlineDraft?: InlineDraft;
  onFreeformReady?: (ready: boolean) => void;
}) {
  const [v2, setV2] = useState(false);
  const [ready, setReady] = useState(false);
  const [providerReady, setProviderReady] = useState(false);
  const [fallback, setFallback] = useState(false);
  const [step, setStep] = useState<Step | null>(null);
  const [source, setSource] = useState('');
  const [href, setHref] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const controller = useRef(new AbortController());
  async function request(action: string, input?: object) {
    const response = await fetch('/api/nuni/assistant/' + action, {
      method: input ? 'POST' : 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      redirect: 'error',
      signal: controller.current.signal,
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
  }
  useEffect(() => {
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
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
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
  if (v2) return <V2Conversation context={context} schoolId={schoolId} ready={ready && providerReady} fallback={fallback} inlineDraft={inlineDraft} />;
  return (
    <section aria-label="公開校園助理">
      <p>此助理目前提供公開資訊，尚未支援代辦寫入。私人課表、作業與借閱快照尚未支援。</p>
      {!ready && <p role="status">{error || '正在確認助理是否啟用…'}</p>}
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
  inlineDraft,
}: {
  context: string;
  schoolId: string;
  ready: boolean;
  fallback: boolean;
  inlineDraft?: InlineDraft;
}) {
  const conversation = useRef(crypto.randomUUID());
  const [consent, setConsent] = useState(false);
  const [localQuestion, setLocalQuestion] = useState('');
  const question = inlineDraft?.text ?? localQuestion;
  const setQuestion = inlineDraft?.setText ?? setLocalQuestion;
  const [turns, setTurns] = useState<V2Turn[]>([]);
  const [states, setStates] = useState<Record<string, string>>({});
  const [operation, setOperation] = useState<'ask' | 'card' | null>(null);
  const pending = operation !== null;
  const activeAsk = useRef<AbortController | null>(null);
  const [error, setError] = useState('');
  const routeToken = useRef<string | undefined>(undefined);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    const active = new AbortController();
    controller.current = active;
    return () => {
      active.abort();
      activeAsk.current?.abort();
    };
  }, []);
  async function send(action: string, input: object, signal = controller.current!.signal) {
    const response = await fetch('/api/nuni/assistant/' + action, {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      redirect: 'error',
      signal,
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
  }
  async function ask() {
    const current = question.trim();
    if (!current || !consent || !ready || pending || activeAsk.current) return;
    const request = new AbortController();
    activeAsk.current = request;
    setOperation('ask');
    setError('');
    try {
      const history = turns.slice(-6).flatMap((t) => [
        { role: 'user', content: t.question },
        { role: 'assistant', content: t.reply.answer },
      ]);
      const query = () => send('ask', {
        question: current, history, consent, routeToken: routeToken.current,
      }, request.signal);
      let reply = await query();
      if (reply.bootstrap) {
        conversation.current = reply.conversationId;
        routeToken.current = reply.routeToken;
        reply = await query();
      }
      if (reply.cards.length)
        setStates((s) => ({
          ...s,
          ...Object.fromEntries(
            turns
              .flatMap((t) => t.reply.cards)
              .filter((c) => !s[c.mutationId])
              .map((c) => [c.mutationId, '已被新提議取代']),
          ),
        }));
      setTurns((t) => [...t, { question: current, reply }]);
      setQuestion((draft) => draft.trim() === current ? '' : draft);
    } catch (e) {
      if (!request.signal.aborted) setError(e instanceof Error ? e.message : '查詢失敗');
    } finally {
      if (activeAsk.current === request) {
        activeAsk.current = null;
        if (!request.signal.aborted) setOperation(null);
      }
    }
  }
  function stopAsking() {
    activeAsk.current?.abort();
    activeAsk.current = null;
    setOperation(null);
  }
  async function execute(cards: V2Card[]) {
    setOperation('card');
    setError('');
    try {
      for (const card of cards) {
        const result = await send('confirm', { token: card.token, args: card.args });
        setStates((s) => ({
          ...s,
          [card.mutationId]:
            result.href || (card.tool === 'propose_food_order' ? '已送出訂單' : '已加入個人行事曆'),
        }));
      }
    } catch (e) {
      if (!controller.current?.signal.aborted)
        setError(e instanceof Error ? e.message : '確認失敗');
    } finally {
      if (!controller.current?.signal.aborted) setOperation(null);
    }
  }
  async function cancel(turn: V2Turn, cardIndex: number) {
    setOperation('card');
    try {
      const card = turn.reply.cards[cardIndex];
      const affected =
        card.tool === 'propose_personal_event' ? turn.reply.cards.slice(cardIndex) : [card];
      for (const c of affected) await send('cancel', { token: c.token, args: c.args });
      setStates((s) => ({
        ...s,
        ...Object.fromEntries(affected.map((c) => [c.mutationId, '已取消'])),
      }));
    } catch {
      setError('撤銷未完成，請重試。');
    } finally {
      setOperation(null);
    }
  }
  return (
    <AssistantThread
      inline={!!inlineDraft}
      schoolId={schoolId}
      ready={ready}
      fallback={fallback}
      consent={consent}
      onConsent={setConsent}
      question={question}
      onQuestion={setQuestion}
      turns={turns}
      states={states}
      pending={pending}
      error={error}
      onAsk={() => void ask()}
      onStop={inlineDraft && operation === 'ask' ? stopAsking : undefined}
      onConfirm={(cards) => void execute(cards)}
      onCancel={(turn, index) => void cancel(turn, index)}
    />
  );
}
function AssistantRoute() {
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
      key={auth.session.context + ':' + campus.schoolId}
      context={auth.session.context}
      schoolId={campus.schoolId}
    />
  );
}
export function Assistant({ children }: { children?: ReactNode }) {
  return (
    <SiteShell title="助理" subtitle="查詢課表、作業、餐點與校園服務。">
      {children}
      <Suspense fallback={<p>載入中…</p>}>
        <AssistantRoute />
      </Suspense>
    </SiteShell>
  );
}
