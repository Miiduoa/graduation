'use client';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import styles from './map.module.css';

export type PublicTaskPort = {
  scope: string;
  schoolId: string;
  schoolName: string;
  localPreview?: boolean;
  mode?: 'deterministic' | 'groq';
  call: (
    action:
      | 'preview'
      | 'prepareGroq'
      | 'confirm'
      | 'execute'
      | 'route'
      | 'read'
      | 'status'
      | 'reconcile'
      | 'ack',
    body: unknown,
    signal: AbortSignal,
  ) => Promise<unknown>;
};
type Place = { id: string; name: string; sourceUrl: string };
type Receipt = {
  from: Place;
  to: Place;
  url: string;
  sourceDate: string;
  sourceLabel: string;
  mode: string;
};
type Plan = {
  kind: 'navigation-plan';
  fromId: string;
  toId: string;
  fromName: string;
  toName: string;
};
type Preview = {
  request: unknown;
  receipt?: Receipt;
  checkedAt?: number;
  provider?: string;
  model?: string;
  dataScope?: string[];
  sourceDate?: string;
  sourceLabel?: string;
  placeCount?: number;
};
type State = 'pending' | 'unknown' | 'completed' | 'failed';
type Operation = {
  status: State;
  operationId: string;
  result?: { receipt: Receipt | Plan };
  failureCode?: string;
};
type Gate =
  | { kind: 'checking' | 'error' | 'clear' }
  | { kind: 'locked'; operation: Pick<Operation, 'status' | 'operationId'> | null };
function parseStatus(value: unknown): Pick<Operation, 'status' | 'operationId'> | null {
  if (value === null) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('INVALID_STATUS');
  const v = value as Record<string, unknown>;
  if (
    typeof v.status !== 'string' ||
    !['pending', 'unknown', 'completed', 'failed'].includes(v.status) ||
    typeof v.operationId !== 'string' ||
    !/^pago_[a-f0-9-]{36}$/u.test(v.operationId)
  )
    throw new Error('INVALID_STATUS');
  return { status: v.status as State, operationId: v.operationId };
}
const message = (error: unknown) => {
  const code = error instanceof Error ? error.message : '';
  if (code.includes('DESTINATION_UNCLEAR'))
    return '找不到唯一的起點與終點，請使用目錄中的完整地點名稱。';
  if (code.includes('SOURCE_CHANGED')) return '地點資料已更新，請重新檢視後再確認。';
  if (code.includes('QUOTA')) return '目前可用次數已用完。內容仍保留，稍後再試。';
  if (code.includes('SESSION')) return '登入狀態已改變，請回到帳號頁確認後再試。';
  return '目前無法完成，請稍後重試。';
};

const AUTO_STATUS_INTERVAL_MS = 5_000;
const AUTO_STATUS_MAX_CHECKS = 12;
function subscribeVisibility(callback: () => void) {
  document.addEventListener('visibilitychange', callback);
  return () => document.removeEventListener('visibilitychange', callback);
}
function isVisible() {
  return document.visibilityState === 'visible';
}
function serverVisible() {
  return true;
}

/** Transport is supplied only by a reviewed host; the live map does not register one yet. */
export function PublicNavigationTask({ port }: { port: PublicTaskPort }) {
  return <Task key={`${port.scope}:${port.schoolId}`} port={port} />;
}
function Task({ port }: { port: PublicTaskPort }) {
  const [gate, setGate] = useState<Gate>({ kind: 'checking' });
  const [query, setQuery] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [operation, setOperation] = useState<Operation | null>(null);
  const [routeReceipt, setRouteReceipt] = useState<Receipt | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const [confirmClose, setConfirmClose] = useState<string | null>(null);
  const [autoStopped, setAutoStopped] = useState(false);
  const [autoChecks, setAutoChecks] = useState(0);
  const visible = useSyncExternalStore(subscribeVisibility, isVisible, serverVisible);
  const pending = useRef<AbortController | null>(null),
    generation = useRef(0),
    running = useRef(false);
  const mayBeUnsettled = useRef(false),
    requestId = useRef<string | null>(null),
    lastAck = useRef<Pick<Operation, 'status' | 'operationId'> | null>(null);
  const heading = useRef<HTMLHeadingElement>(null),
    input = useRef<HTMLInputElement>(null),
    focusInput = useRef(false);
  const scope = { task: 'public-campus-navigation', schoolId: port.schoolId };
  const invalidate = useCallback(() => {
    generation.current++;
    pending.current?.abort();
    running.current = false;
  }, []);
  useEffect(() => {
    void checkStatus(true);
    return invalidate;
  }, [invalidate]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (focusInput.current) {
      input.current?.focus();
      focusInput.current = false;
    } else if (preview || operation || error) heading.current?.focus();
  }, [preview, operation, error, gate.kind]);
  async function checkStatus(initial = false) {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError('');
    setOperation(null);
    setRouteReceipt(null);
    if (initial) setGate({ kind: 'checking' });
    const controller = new AbortController(),
      version = ++generation.current;
    pending.current = controller;
    try {
      const state = parseStatus(await port.call('status', scope, controller.signal));
      if (version !== generation.current) return;
      if (state) {
        mayBeUnsettled.current = true;
        setGate({ kind: 'locked', operation: state });
        setOperation((previous) =>
          previous?.operationId === state.operationId && previous.status === state.status
            ? previous
            : null,
        );
        if (state.status === 'completed' && preview) {
          setOperation(null);
          try {
            const result = (await port.call(
              'read',
              preview.request,
              controller.signal,
            )) as Operation;
            const verified = parseStatus(result);
            if (
              !verified ||
              verified.status !== 'completed' ||
              verified.operationId !== state.operationId ||
              !result.result?.receipt
            )
              throw new Error('INVALID_RECEIPT');
            if (version === generation.current) setOperation(result);
          } catch {
            if (version === generation.current) setError('無法取得經來源確認的回執，請重新查詢。');
          }
        }
      } else if (mayBeUnsettled.current) setGate({ kind: 'locked', operation: lastAck.current });
      else setGate({ kind: 'clear' });
    } catch (failure) {
      if (version === generation.current) {
        setGate((previous) =>
          mayBeUnsettled.current
            ? {
                kind: 'locked',
                operation:
                  lastAck.current ?? (previous.kind === 'locked' ? previous.operation : null),
              }
            : { kind: 'error' },
        );
        setError(
          failure instanceof Error &&
            ['PUBLIC_AGENT_SESSION_INVALID', 'PUBLIC_AGENT_SESSION_EXPIRED'].includes(
              failure.message,
            )
            ? '登入已失效，請重新登入後查詢原任務。'
            : '無法確認先前任務狀態，請重新查詢。',
        );
      }
    } finally {
      if (version === generation.current) {
        running.current = false;
        setBusy(false);
      }
    }
  }
  // Only poll an unresolved operation while the page is visible. Each request
  // settles before the next timer; no provider execution or acknowledgement occurs.
  useEffect(() => {
    const waiting =
      gate.kind === 'locked' && (!gate.operation || gate.operation.status === 'pending');
    if (
      !waiting ||
      !visible ||
      busy ||
      autoStopped ||
      error ||
      autoChecks >= AUTO_STATUS_MAX_CHECKS
    )
      return;
    const timer = setTimeout(() => {
      setAutoChecks((count) => count + 1);
      void checkStatus();
    }, AUTO_STATUS_INTERVAL_MS);
    return () => clearTimeout(timer);
    // checkStatus reads this render's scope and preview; busy/gate changes reschedule it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gate, visible, busy, autoStopped, error, autoChecks, preview]);
  function pauseAutoStatus() {
    setAutoStopped(true);
    invalidate();
    setBusy(false);
    setError('已停止自動查詢。原任務仍保留，可手動查詢。');
  }
  function resumeAutoStatus() {
    setAutoChecks(0);
    setAutoStopped(false);
    setError('');
  }
  async function run(action: 'preview' | 'execute') {
    if (running.current || gate.kind !== 'clear') return;
    running.current = true;
    setBusy(true);
    setError('');
    const controller = new AbortController(),
      version = ++generation.current;
    pending.current = controller;
    let sent = false,
      refreshStatus = false;
    try {
      if (action === 'preview') {
        const value = (await port.call(
          port.mode === 'groq' ? 'prepareGroq' : 'preview',
          {
            schoolId: port.schoolId,
            query: query.trim(),
            requestId: (requestId.current ??= `nav_${crypto.randomUUID()}`),
          },
          controller.signal,
        )) as Preview;
        if (version === generation.current) {
          setPreview(value);
          setOperation(null);
          setRouteReceipt(null);
        }
      } else if (preview) {
        setAutoChecks(0);
        setAutoStopped(false);
        const confirmation = (await port.call(
          'confirm',
          { approved: true, request: preview.request },
          controller.signal,
        )) as { confirmationId: string };
        if (version !== generation.current) return;
        mayBeUnsettled.current = true;
        sent = true;
        setGate({ kind: 'locked', operation: null });
        const result = (await port.call(
          'execute',
          { confirmationId: confirmation.confirmationId, request: preview.request },
          controller.signal,
        )) as Operation;
        const state = parseStatus(result);
        if (!state) throw new Error('INVALID_STATUS');
        if (version === generation.current) {
          setOperation(result);
          setGate({ kind: 'locked', operation: state });
        }
      }
    } catch (failure) {
      if (version === generation.current) {
        if (failure instanceof Error && failure.message === 'PUBLIC_AGENT_OPEN_OPERATION') {
          mayBeUnsettled.current = true;
          setGate({ kind: 'locked', operation: null });
          setError('已有尚未結案的任務，正在查詢狀態。');
          refreshStatus = true;
        } else if (
          action === 'execute' &&
          sent &&
          !(failure instanceof Error && failure.message === 'PUBLIC_AGENT_FREE_QUOTA_UNAVAILABLE')
        ) {
          setGate({ kind: 'locked', operation: null });
          setError(
            failure instanceof Error &&
              ['PUBLIC_AGENT_SESSION_INVALID', 'PUBLIC_AGENT_SESSION_EXPIRED'].includes(
                failure.message,
              )
              ? '登入已失效，執行結果尚未確認。請重新登入後查詢原任務，不要重新送出。'
              : '尚未確認執行結果。請查詢原任務，不要重新送出。',
          );
        } else {
          if (sent) {
            mayBeUnsettled.current = false;
            setGate({ kind: 'clear' });
          }
          setError(message(failure));
          if (failure instanceof Error && failure.message.includes('SOURCE_CHANGED')) {
            setPreview(null);
            requestId.current = null;
          }
        }
      }
    } finally {
      if (version === generation.current) {
        running.current = false;
        setBusy(false);
        if (refreshStatus) void checkStatus();
      }
    }
  }
  async function reconcile() {
    if (running.current || gate.kind !== 'locked' || gate.operation?.status !== 'unknown') return;
    const id = gate.operation.operationId;
    running.current = true;
    setBusy(true);
    setError('');
    const controller = new AbortController(),
      version = ++generation.current;
    pending.current = controller;
    try {
      const value = await port.call('reconcile', { ...scope, operationId: id }, controller.signal);
      const verified = parseStatus(value);
      if (!verified || verified.status !== 'failed' || verified.operationId !== id)
        throw new Error('INVALID_STATUS');
      const current = parseStatus(await port.call('status', scope, controller.signal));
      if (!current || current.status !== 'failed' || current.operationId !== id)
        throw new Error('INVALID_STATUS');
      let detail: Operation | null = null;
      if (preview) {
        const result = (await port.call('read', preview.request, controller.signal)) as Operation;
        const state = parseStatus(result);
        if (
          state?.status !== 'failed' ||
          state.operationId !== id ||
          result.failureCode !== 'NOT_DISPATCHED'
        )
          throw new Error('INVALID_STATUS');
        detail = result;
      }
      if (version === generation.current) {
        setGate({ kind: 'locked', operation: current });
        setOperation(detail);
      }
    } catch {
      if (version === generation.current) setError('仍無法確認是否送出，請保留原任務並稍後再查。');
    } finally {
      if (version === generation.current) {
        running.current = false;
        setBusy(false);
      }
    }
  }
  async function acknowledge() {
    if (
      running.current ||
      gate.kind !== 'locked' ||
      !gate.operation ||
      !['completed', 'failed'].includes(gate.operation.status) ||
      confirmClose !== gate.operation.operationId
    )
      return;
    running.current = true;
    setBusy(true);
    setError('');
    lastAck.current = gate.operation;
    const id = gate.operation.operationId,
      controller = new AbortController(),
      version = ++generation.current;
    pending.current = controller;
    try {
      const response = (await port.call(
        'ack',
        { ...scope, operationId: id, approved: true },
        controller.signal,
      )) as { status?: unknown; operationId?: unknown };
      if (response?.status !== 'acknowledged' || response.operationId !== id)
        throw new Error('INVALID_ACK');
      // Another tab can start a new operation after this acknowledgement commits.
      // Recheck the durable gate before offering a new task. The backend admission
      // remains authoritative for races after this read.
      const current = parseStatus(await port.call('status', scope, controller.signal));
      if (version === generation.current) {
        setOperation(null);
        setRouteReceipt(null);
        setPreview(null);
        setConfirmClose(null);
        setAutoChecks(0);
        setAutoStopped(false);
        requestId.current = null;
        if (current) {
          mayBeUnsettled.current = true;
          lastAck.current = null;
          setGate({ kind: 'locked', operation: current });
        } else {
          mayBeUnsettled.current = false;
          lastAck.current = null;
          setGate({ kind: 'clear' });
          focusInput.current = true;
        }
      }
    } catch {
      if (version === generation.current)
        setError('無法確認結案，任務仍保留；請重新查詢或再次確認結案。');
    } finally {
      if (version === generation.current) {
        running.current = false;
        setBusy(false);
      }
    }
  }
  function cancel() {
    generation.current++;
    pending.current?.abort();
    running.current = false;
    setBusy(false);
    if (mayBeUnsettled.current) {
      setAutoStopped(true);
      setError('已停止等待，原任務可能仍在處理。請查詢狀態。');
      return;
    }
    focusInput.current = true;
    setPreview(null);
    setOperation(null);
    setRouteReceipt(null);
    setError('');
    requestId.current = null;
  }
  const rawResult = operation?.status === 'completed' ? operation.result?.receipt : null;
  const plan =
    rawResult && 'kind' in rawResult && rawResult.kind === 'navigation-plan'
      ? (rawResult as Plan)
      : null;
  const receipt = routeReceipt ?? (rawResult && !plan ? (rawResult as Receipt) : null);
  async function confirmRoute() {
    if (
      running.current ||
      !plan ||
      !preview ||
      !operation ||
      gate.kind !== 'locked' ||
      gate.operation?.operationId !== operation.operationId ||
      operation.status !== 'completed'
    )
      return;
    running.current = true;
    setBusy(true);
    setError('');
    setRouteReceipt(null);
    const controller = new AbortController(),
      version = ++generation.current;
    pending.current = controller;
    try {
      const result = (await port.call(
        'route',
        {
          approved: true,
          operationId: operation.operationId,
          request: preview.request,
          fromId: plan.fromId,
          toId: plan.toId,
        },
        controller.signal,
      )) as { operationId?: unknown; receipt?: Receipt };
      if (
        result.operationId !== operation.operationId ||
        !result.receipt ||
        result.receipt.mode !== 'groq' ||
        result.receipt.from.id !== plan.fromId ||
        result.receipt.to.id !== plan.toId ||
        result.receipt.from.name !== plan.fromName ||
        result.receipt.to.name !== plan.toName
      )
        throw new Error('INVALID_RECEIPT');
      if (version === generation.current) setRouteReceipt(result.receipt);
    } catch {
      if (version === generation.current)
        setError('無法確認路線或地點已更新，請重新查詢；尚未開啟地圖。');
    } finally {
      if (version === generation.current) {
        running.current = false;
        setBusy(false);
      }
    }
  }
  const state = gate.kind === 'locked' ? gate.operation?.status : null;
  const terminal = state === 'completed' || state === 'failed';
  return (
    <section className={`card ${styles.task}`} aria-label="公開校園導航">
      <h2 ref={heading} tabIndex={-1}>
        幫我找一條路線
      </h2>
      <p>
        {port.schoolName} · {port.mode === 'groq' ? 'Groq 雲端導航' : '確定性導航，未使用雲端模型'}
      </p>
      {port.localPreview && (
        <p role="note">本機流程預覽：合成帳號與暫存紀錄，地點使用既有公開目錄。</p>
      )}
      {gate.kind === 'checking' && <p role="status">正在確認先前任務狀態…</p>}
      {gate.kind === 'error' && (
        <button className="btn" disabled={busy} onClick={() => void checkStatus(true)}>
          重新查詢狀態
        </button>
      )}
      {gate.kind === 'clear' && !preview && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void run('preview');
          }}
        >
          <label className={styles.search}>
            起點與終點
            <input
              ref={input}
              value={query}
              maxLength={240}
              disabled={busy}
              placeholder="例如：從主顧樓到蓋夏圖書館"
              onChange={(event) => {
                setQuery(event.target.value);
                requestId.current = null;
                setError('');
              }}
            />
          </label>
          <button className="btn" disabled={busy || !query.trim()}>
            {busy ? '讀取地點…' : port.mode === 'groq' ? '檢視傳送內容' : '檢視路線'}
          </button>
        </form>
      )}
      {preview &&
        gate.kind === 'clear' &&
        (port.mode === 'groq' ? (
          <>
            <p>
              將傳送至 Groq：所選校園、你的問題及公開地點名稱與
              ID。系統不會自動附加帳號、課表或定位；請勿在問題中輸入個資。
            </p>
            <p>
              模型：{preview.model}；公開地點來源：{preview.sourceLabel}，資料日期{' '}
              {preview.sourceDate}，共 {preview.placeCount} 筆。
            </p>
            <p>問題：{query}</p>
            <button className="btn" disabled={busy} onClick={() => void run('execute')}>
              {busy ? '處理中…' : '同意傳送並取得建議'}
            </button>
          </>
        ) : (
          <>
            <p>
              <strong>
                {preview.receipt?.from.name} → {preview.receipt?.to.name}
              </strong>
            </p>
            <p>
              只使用所選校園、起終點及公開地點；不讀取課表、定位或校務帳號，也不傳送給模型供應商。
            </p>
            <p>
              目錄日期：{preview.receipt?.sourceDate}。導航會交由 Google
              地圖開啟，不代表道路或通行狀態已即時確認。
            </p>
            <button className="btn" disabled={busy} onClick={() => void run('execute')}>
              {busy ? '處理中…' : '確認並建立路線'}
            </button>
          </>
        ))}
      {plan && !routeReceipt && (
        <div role="status">
          <h3>請確認建議的地點</h3>
          <p>
            {plan.fromName} → {plan.toName}
          </p>
          <p>
            公開來源：{preview?.sourceLabel}，資料日期 {preview?.sourceDate}
            。請確認地點；不代表道路或通行狀態已即時確認。
          </p>
          <button className="btn" disabled={busy} onClick={() => void confirmRoute()}>
            確認地點並建立步行路線
          </button>
        </div>
      )}
      {receipt && (
        <div role="status">
          <h3>路線已建立</h3>
          <p>
            {receipt.from.name} → {receipt.to.name}
          </p>
          <p>
            {receipt.sourceLabel} · 目錄日期 {receipt.sourceDate}
          </p>
          <div className={styles.actions}>
            <a className="btn" href={receipt.url} target="_blank" rel="noopener noreferrer">
              在 Google 地圖開啟
            </a>
            <a href={receipt.from.sourceUrl} target="_blank" rel="noopener noreferrer">
              起點來源
            </a>
            <a href={receipt.to.sourceUrl} target="_blank" rel="noopener noreferrer">
              終點來源
            </a>
          </div>
          <p>任務編號：{operation?.operationId}</p>
        </div>
      )}
      {operation?.status === 'failed' && (
        <p role="alert">
          {operation.failureCode === 'NOT_DISPATCHED'
            ? '這次未送出，請先確認結案。'
            : operation.failureCode === 'FREE_QUOTA_UNAVAILABLE'
              ? '目前達到使用限制，這次沒有取得建議。請先確認結案，稍後可再試。'
              : operation.failureCode === 'FREE_ASSURANCE_UNAVAILABLE'
                ? '目前無法確認免費使用保障，這次沒有傳送給 Groq。請先確認結案。'
                : operation.failureCode === 'DESTINATION_UNCLEAR'
                  ? '無法確認起點與終點；請先確認結案再修改問題。'
                  : '這次沒有取得可驗證的建議；請先確認結案。'}
        </p>
      )}
      {gate.kind === 'locked' && (
        <>
          {(!gate.operation || gate.operation.status === 'pending') && (
            <div>
              <p>
                {autoStopped || autoChecks >= AUTO_STATUS_MAX_CHECKS || error
                  ? '自動查詢已暫停，可手動查詢。'
                  : !visible
                    ? '切回此頁後繼續查詢。'
                    : '正在自動查詢任務狀態。'}
              </p>
              {!busy &&
                (autoStopped || autoChecks >= AUTO_STATUS_MAX_CHECKS || error ? (
                  <button className="btn secondary" onClick={resumeAutoStatus}>
                    恢復自動查詢
                  </button>
                ) : (
                  <button className="btn secondary" onClick={pauseAutoStatus}>
                    停止自動查詢
                  </button>
                ))}
            </div>
          )}
          <p role="status">
            {terminal
              ? state === 'completed'
                ? '先前任務已完成。'
                : '先前任務未完成。'
              : '任務結果尚未確認；請勿重新送出。'}
          </p>
          {terminal && !receipt && !preview && (
            <p>目前無法取得前次回執；確認結案後才能建立新任務。</p>
          )}
          {state === 'unknown' && gate.operation && (
            <button className="btn" disabled={busy} onClick={() => void reconcile()}>
              確認是否已送出
            </button>
          )}
          <button className="btn" disabled={busy} onClick={() => void checkStatus()}>
            查詢原任務
          </button>
          {terminal && confirmClose !== gate.operation?.operationId && (
            <button
              className="btn"
              disabled={busy}
              onClick={() => setConfirmClose(gate.operation!.operationId)}
            >
              結案並開始新任務
            </button>
          )}
          {terminal && confirmClose === gate.operation?.operationId && (
            <div role="group" aria-label="確認結案">
              <p>確定結案？結案後才能建立新任務。</p>
              <button className="btn" disabled={busy} onClick={() => void acknowledge()}>
                確認結案
              </button>
              <button
                className="btn secondary"
                disabled={busy}
                onClick={() => setConfirmClose(null)}
              >
                取消結案
              </button>
            </div>
          )}
        </>
      )}
      {error && <p role="alert">{error}</p>}
      {gate.kind === 'clear' && (busy || preview) && (
        <button className="btn secondary" onClick={cancel}>
          取消
        </button>
      )}
      {gate.kind === 'locked' && busy && (
        <button className="btn secondary" onClick={cancel}>
          停止等待
        </button>
      )}
    </section>
  );
}
