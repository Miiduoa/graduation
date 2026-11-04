'use client';
import Link from 'next/link';
import { Suspense, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { SiteShell } from '@/components/SiteShell';
import { useCampusBrowseContext } from '@/lib/useCampusBrowseContext';
import { useNuniSession } from './Session';
import type { AssistantIntent } from '@/lib/nuni/assistantContracts';
type Step = {
  intent: AssistantIntent;
  confirmation: string;
  summary?: string;
  answer?: string;
  simulation: boolean;
};
function Conversation({ context, schoolId }: { context: string; schoolId: string }) {
  const [v2, setV2] = useState(false);
  const [ready, setReady] = useState(false);
  const [providerReady, setProviderReady] = useState(false);
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
  if (v2) return <V2Conversation context={context} schoolId={schoolId} ready={providerReady} />;
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
type V2Card = {
  tool: string;
  args: Record<string, unknown>;
  token: string;
  mutationId: string;
  schoolId: string;
  destination: string;
};
function foodSummary(raw: unknown): string {
  if (!raw || typeof raw !== 'object') return '';
  const summary = raw as Record<string, unknown>;
  const lines = Array.isArray(summary.lines) ? summary.lines : [];
  return `${String(summary.store)}：${lines
    .map((raw) => {
      const line = raw as Record<string, unknown>;
      return `${String(line.name)} × ${String(line.quantity)}（${Array.isArray(line.options) ? line.options.join('、') : ''}，單價 ${Number(line.unitMinor) / 100} 元）`;
    })
    .join(
      '；',
    )}。合計 ${Number(summary.totalMinor) / 100} 元，${String(summary.pickupMethod)}，取餐時間 ${String(summary.requestedPickupAt)}。`;
}
const cardLabels: Record<string, string> = {
  summary: '餐點與金額',
  reason: '說明',
  title: '標題',
  date: '日期',
  endDate: '結束日期',
  startTime: '開始時間',
  endTime: '結束時間',
  allDay: '全天',
  page: '頁面',
  entityId: '項目',
};
type V2Reply = {
  answer: string;
  steps: { name: string; status: string; summary: string }[];
  cards: V2Card[];
  simulation: boolean;
};
function V2Conversation({
  context,
  schoolId,
  ready,
}: {
  context: string;
  schoolId: string;
  ready: boolean;
}) {
  const [conversationId] = useState(() => crypto.randomUUID());
  const [consent, setConsent] = useState(false);
  const [question, setQuestion] = useState('');
  const [turns, setTurns] = useState<{ question: string; reply: V2Reply }[]>([]);
  const [states, setStates] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
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
      body: JSON.stringify({ schoolId, conversationId, ...input }),
    });
    if (!response.ok)
      throw new Error(
        response.status === 409
          ? '資料或登入狀態已變更，請重新提議。'
          : response.status === 429
            ? '已達查詢預算，請稍後再試。'
            : '查詢未完成，請稍後再試。',
      );
    const result = await response.json();
    if (signal.aborted) throw new Error('已取消');
    return result;
  }
  async function ask() {
    const current = question.trim();
    if (!current || pending) return;
    setPending(true);
    setError('');
    try {
      const history = turns.slice(-6).flatMap((t) => [
        { role: 'user', content: t.question },
        { role: 'assistant', content: t.reply.answer },
      ]);
      const reply = await send('ask', { question: current, history, consent });
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
  return (
    <section aria-label="情境助理 v2">
      <p>課表與事件僅包含已同步資料；建立個人事件不會發送推播提醒。</p>
      <nav aria-label="校園服務入口">
        <Link href={'/map?schoolId=' + encodeURIComponent(schoolId)}>校園地圖</Link> ·{' '}
        <Link href={'/bus?schoolId=' + encodeURIComponent(schoolId)}>公車資訊</Link> ·{' '}
        <Link href={'/cafeteria?schoolId=' + encodeURIComponent(schoolId)}>餐廳資訊</Link>
      </nav>
      {!ready && <p role="status">模型目前無法使用。</p>}
      <label>
        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
        同意在本次對話將問題、對話紀錄及必要課表、作業、個人事件、訂單取餐資訊、餐點偏好與社團貼文摘要傳送
        Groq
      </label>
      <div role="log">
        {turns.map((turn, i) => (
          <article key={i}>
            <p>你：{turn.question}</p>
            <p>{turn.reply.answer}</p>
            {turn.reply.simulation && <p>模擬資料</p>}
            <details>
              <summary>查了哪些資料</summary>
              <ul>
                {turn.reply.steps.map((s, j) => (
                  <li key={j}>
                    {s.name}：{s.summary} ({s.status})
                  </li>
                ))}
              </ul>
            </details>
            {turn.reply.cards.filter((c) => !states[c.mutationId]).length > 1 && (
              <button
                disabled={pending}
                onClick={() => void execute(turn.reply.cards.filter((c) => !states[c.mutationId]))}
              >
                依序全部確認
              </button>
            )}
            {turn.reply.cards.length > 1 && (
              <p>讀書安排請依序確認；取消後若要更改順序，請重新規劃。</p>
            )}
            {turn.reply.cards.map((card, cardIndex) => (
              <div key={card.mutationId}>
                <p>
                  學校：{card.schoolId}；目的地：{card.destination}
                </p>
                <dl>
                  {Object.entries(card.args)
                    .filter(
                      ([key]) =>
                        card.tool !== 'propose_food_order' || ['summary', 'reason'].includes(key),
                    )
                    .map(([key, value]) => (
                      <div key={key}>
                        <dt>{cardLabels[key] || key}</dt>
                        <dd>
                          {card.tool === 'propose_food_order' && key === 'summary'
                            ? foodSummary(value)
                            : typeof value === 'boolean'
                              ? value
                                ? '是'
                                : '否'
                              : typeof value === 'object'
                                ? JSON.stringify(value)
                                : String(value)}
                        </dd>
                      </div>
                    ))}
                </dl>
                {states[card.mutationId] ? (
                  states[card.mutationId].startsWith('/') ? (
                    <Link href={states[card.mutationId]}>開啟確認的頁面</Link>
                  ) : (
                    <p>{states[card.mutationId]}</p>
                  )
                ) : (
                  <>
                    <button
                      disabled={
                        pending ||
                        turn.reply.cards
                          .slice(0, cardIndex)
                          .some(
                            (c) =>
                              states[c.mutationId] !== '已加入個人行事曆' &&
                              c.tool === 'propose_personal_event',
                          )
                      }
                      onClick={() => void execute([card])}
                    >
                      確認
                    </button>
                    <button
                      disabled={pending}
                      onClick={() =>
                        void (async () => {
                          setPending(true);
                          try {
                            const affected =
                              card.tool === 'propose_personal_event'
                                ? turn.reply.cards.slice(cardIndex)
                                : [card];
                            for (const c of affected)
                              await send('cancel', { token: c.token, args: c.args });
                            setStates((s) => ({
                              ...s,
                              ...Object.fromEntries(affected.map((c) => [c.mutationId, '已取消'])),
                            }));
                          } catch {
                            setError('撤銷未完成，請重試。');
                          } finally {
                            setPending(false);
                          }
                        })()
                      }
                    >
                      取消
                    </button>
                  </>
                )}
              </div>
            ))}
          </article>
        ))}
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void ask();
        }}
      >
        <label>
          問題
          <input value={question} maxLength={1000} onChange={(e) => setQuestion(e.target.value)} />
        </label>
        <button disabled={!consent || !ready || pending || !question.trim()}>送出</button>
      </form>
      {pending && <p role="status">查詢中…</p>}
      {error && <p role="alert">{error}</p>}
    </section>
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
export function Assistant() {
  return (
    <SiteShell title="助理" subtitle="查詢公開校園資訊與站內服務入口。">
      <Suspense fallback={<p>載入中…</p>}>
        <AssistantRoute />
      </Suspense>
    </SiteShell>
  );
}
