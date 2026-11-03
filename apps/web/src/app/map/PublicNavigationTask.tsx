'use client';
import { useEffect, useRef, useState } from 'react';
import styles from './map.module.css';

export type PublicTaskPort = {
  scope: string;
  schoolId: string;
  schoolName: string;
  localPreview?: boolean;
  call: (
    action: 'preview' | 'confirm' | 'execute' | 'read',
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
type Operation = {
  status: 'pending' | 'unknown' | 'completed' | 'failed';
  operationId: string;
  result?: { receipt: Receipt };
  failureCode?: string;
};
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
  const [query, setQuery] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [operation, setOperation] = useState<Operation | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const [uncertain, setUncertain] = useState(false);
  const pending = useRef<AbortController | null>(null),
    generation = useRef(0),
    running = useRef(false);
  const focusInput = useRef(false);
  const requestId = useRef<string | null>(null),
    heading = useRef<HTMLHeadingElement>(null),
    input = useRef<HTMLInputElement>(null);
  useEffect(
    () => () => {
      generation.current++;
      pending.current?.abort();
    },
    [],
  );
  useEffect(() => {
    if (focusInput.current) {
      input.current?.focus();
      focusInput.current = false;
    } else if (preview || operation || error) heading.current?.focus();
  }, [preview, operation, error]);
  async function run(action: 'preview' | 'execute' | 'read') {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError('');
    const controller = new AbortController(),
      version = ++generation.current;
    pending.current = controller;
    let executeSent = false;
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
          setUncertain(false);
        }
      } else if (preview) {
        let value: Operation;
        if (action === 'execute') {
          // One explicit button confirms this exact preview; ordinary navigation is no approval.
          const confirmation = (await port.call(
            'confirm',
            { approved: true, request: preview.request },
            controller.signal,
          )) as { confirmationId: string };
          if (version !== generation.current) return;
          setUncertain(true);
          executeSent = true;
          value = (await port.call(
            'execute',
            { confirmationId: confirmation.confirmationId, request: preview.request },
            controller.signal,
          )) as Operation;
        } else {
          value = (await port.call('read', preview.request, controller.signal)) as Operation;
        }
        if (version === generation.current) {
          setOperation(value);
          setUncertain(value?.status === 'pending' || value?.status === 'unknown');
        }
      }
    } catch (failure) {
      if (version === generation.current) {
        if (action === 'execute' && !executeSent) {
          setUncertain(false);
          setError(message(failure));
          if (failure instanceof Error && failure.message.includes('SOURCE_CHANGED')) {
            setPreview(null);
            requestId.current = null;
          }
        } else if (action !== 'preview') {
          setUncertain(true);
          setError('尚未確認執行結果。請查詢原任務，不要重新送出。');
        } else setError(message(failure));
      }
    } finally {
      if (version === generation.current) {
        setBusy(false);
        running.current = false;
      }
    }
  }
  function cancel() {
    generation.current++;
    pending.current?.abort();
    running.current = false;
    setBusy(false);
    if (uncertain) {
      setError('已停止等待，原任務可能仍在處理。請查詢結果。');
      return;
    }
    focusInput.current = true;
    setPreview(null);
    setOperation(null);
    setError('');
    requestId.current = null;
    input.current?.focus();
  }
  const receipt = operation?.status === 'completed' ? operation.result?.receipt : null;
  return (
    <section className={`card ${styles.task}`} aria-label="公開校園導航">
      <h2 ref={heading} tabIndex={-1}>
        幫我找一條路線
      </h2>
      <p>{port.schoolName} · 確定性導航，未使用雲端模型</p>
      {port.localPreview && (
        <p role="note">本機流程預覽：合成帳號與暫存紀錄，地點使用既有公開目錄。</p>
      )}
      {!preview && (
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
      {preview && !receipt && (
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
          {!operation && !uncertain && (
            <button className="btn" disabled={busy} onClick={() => void run('execute')}>
              {busy ? '處理中…' : '確認並建立路線'}
            </button>
          )}
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
      {operation?.status === 'failed' && (
        <p role="alert">路線未完成，地點或執行結果未通過驗證。沒有重新執行。</p>
      )}
      {(uncertain || operation?.status === 'pending' || operation?.status === 'unknown') && (
        <>
          <p role="status">結果尚未確認；相同任務不會重複執行或扣次數。</p>
          <button className="btn" disabled={busy} onClick={() => void run('read')}>
            查詢原任務
          </button>
        </>
      )}
      {error && <p role="alert">{error}</p>}
      {(busy || preview) && (
        <button className="btn secondary" onClick={cancel}>
          {uncertain ? '停止等待' : receipt ? '返回輸入' : '取消'}
        </button>
      )}
    </section>
  );
}
