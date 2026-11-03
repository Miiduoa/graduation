'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import styles from './map.module.css';

export type PublicTaskPort = {
  scope: string;
  schoolId: string;
  schoolName: string;
  localPreview?: boolean;
  call: (
    action: 'preview' | 'confirm' | 'execute' | 'read' | 'status' | 'ack',
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
type Preview = { request: unknown; receipt: Receipt; checkedAt: number };
type State = 'pending' | 'unknown' | 'completed' | 'failed';
type Operation = {
  status: State;
  operationId: string;
  result?: { receipt: Receipt };
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

/** Transport is supplied only by a reviewed host; the live map does not register one yet. */
export function PublicNavigationTask({ port }: { port: PublicTaskPort }) {
  return <Task key={`${port.scope}:${port.schoolId}`} port={port} />;
}
function Task({ port }: { port: PublicTaskPort }) {
  const [gate, setGate] = useState<Gate>({ kind: 'checking' });
  const [query, setQuery] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [operation, setOperation] = useState<Operation | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const [confirmClose, setConfirmClose] = useState<string | null>(null);
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
          'preview',
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
        }
      } else if (preview) {
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
        setPreview(null);
        setConfirmClose(null);
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
      setError('已停止等待，原任務可能仍在處理。請查詢狀態。');
      return;
    }
    focusInput.current = true;
    setPreview(null);
    setOperation(null);
    setError('');
    requestId.current = null;
  }
  const receipt = operation?.status === 'completed' ? operation.result?.receipt : null;
  const state = gate.kind === 'locked' ? gate.operation?.status : null;
  const terminal = state === 'completed' || state === 'failed';
  return (
    <section className={`card ${styles.task}`} aria-label="公開校園導航">
      <h2 ref={heading} tabIndex={-1}>
        幫我找一條路線
      </h2>
      <p>{port.schoolName} · 確定性導航，未使用雲端模型</p>
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
            {busy ? '讀取地點…' : '檢視路線'}
          </button>
        </form>
      )}
      {preview && gate.kind === 'clear' && (
        <>
          <p>
            <strong>
              {preview.receipt.from.name} → {preview.receipt.to.name}
            </strong>
          </p>
          <p>
            只使用所選校園、起終點及公開地點；不讀取課表、定位或校務帳號，也不傳送給模型供應商。
          </p>
          <p>
            目錄日期：{preview.receipt.sourceDate}。導航會交由 Google
            地圖開啟，不代表道路或通行狀態已即時確認。
          </p>
          <button className="btn" disabled={busy} onClick={() => void run('execute')}>
            {busy ? '處理中…' : '確認並建立路線'}
          </button>
        </>
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
      {gate.kind === 'locked' && (
        <>
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
