'use client';
import Link from 'next/link';
import { Suspense, useEffect, useRef, useState, type ReactNode } from 'react';
import { useSearchParams } from 'next/navigation';
import { SiteShell } from '@/components/SiteShell';
import { resolvePublicCourseAssistantIntent } from '@campus/shared/src/publicCourseAssistant';
import { answerPublicCourseQuestion } from '@campus/shared/src/publicCourseAssistantClient';
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
function Conversation({ context, schoolId, initialDraft }: { context: string; schoolId: string; initialDraft: string }) {
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
  if (v2) return <V2Conversation context={context} schoolId={schoolId} initialDraft={initialDraft} ready={providerReady} fallback={fallback} />;
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
  initialDraft,
  ready,
  fallback,
}: {
  context: string;
  schoolId: string;
  initialDraft: string;
  ready: boolean;
  fallback: boolean;
}) {
  const conversation = useRef(crypto.randomUUID());
  const [consent, setConsent] = useState(false);
  const [question, setQuestion] = useState(initialDraft);
  const [turns, setTurns] = useState<V2Turn[]>([]);
  const [states, setStates] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const routeToken = useRef<string | undefined>(undefined);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    const active = new AbortController();
    controller.current = active;
    return () => active.abort();
  }, []);
  async function send(action: string, input: object) {
    const signal = controller.current!.signal;
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
    const signal = controller.current?.signal;
    const publicCourseIntent = resolvePublicCourseAssistantIntent(current, schoolId);
    if (!current || pending || !signal || signal.aborted || (!publicCourseIntent && (!ready || !consent))) return;
    setPending(true);
    setError('');
    try {
      if (publicCourseIntent) {
        const result = await answerPublicCourseQuestion({
          question: current,
          schoolId,
          origin: 'web',
          signal,
          isCurrent: () => !signal.aborted,
        });
        if (signal.aborted || !result) return;
        setTurns((t) => [...t, {
          question: current,
          reply: { answer: result.content, steps: [], cards: [] },
          publicCourse: { read: result.read },
        }]);
        setQuestion('');
        return;
      }
      const history = turns.filter((t) => !t.publicCourse).slice(-6).flatMap((t) => [
        { role: 'user', content: t.question },
        { role: 'assistant', content: t.reply.answer },
      ]);
      let reply = await send('ask', { question: current, history, consent, routeToken: routeToken.current });
      if (reply.bootstrap) {
        conversation.current = reply.conversationId;
        routeToken.current = reply.routeToken;
        reply = await send('ask', { question: current, history, consent, routeToken: routeToken.current });
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
      setQuestion('');
    } catch (e) {
      if (!controller.current?.signal.aborted)
        setError(e instanceof Error ? e.message : '查詢失敗');
    } finally {
      if (!controller.current?.signal.aborted) setPending(false);
    }
  }
  async function execute(cards: V2Card[]) {
    setPending(true);
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
      if (!controller.current?.signal.aborted) setPending(false);
    }
  }
  async function cancel(turn: V2Turn, cardIndex: number) {
    setPending(true);
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
      setPending(false);
    }
  }
  return (
    <AssistantThread
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
      key={JSON.stringify([auth.session.context, campus.schoolId, initialDraft])}
      context={auth.session.context}
      schoolId={campus.schoolId}
      initialDraft={initialDraft}
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
