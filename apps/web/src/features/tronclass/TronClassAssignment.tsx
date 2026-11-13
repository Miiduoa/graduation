'use client';

import { useEffect, useRef, useState } from 'react';
import {
  tronClassErrorMessage,
  TronClassRequestError,
  type TronClassClient,
} from '@/lib/tronClassIntegrationClient';
import type {
  TronClassHomeworkItem,
  TronClassPreparation,
  TronClassSubmissionReceipt,
  TronClassSubmissionResult,
} from '@/lib/tronClassIntegrationTypes';
import { SourceLink, tronClassTime } from './TronClassSource';
import styles from './tronclass.module.css';

type Attachment = { id: string; file: File; status: 'ready' | 'uploading' | 'uploaded' | 'failed' };
type Phase = 'editing' | 'preview' | 'uploading' | 'submitting' | 'unknown' | 'submitted';
const MAX_TOTAL_BYTES = 20 * 1024 * 1024;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_FILES = 4;

function sizeLabel(size: number): string {
  return size >= 1024 * 1024
    ? `${(size / (1024 * 1024)).toFixed(1)} MB`
    : `${Math.max(1, Math.ceil(size / 1024))} KB`;
}

function pendingKey(owner: string, courseId: number, homeworkId: number): string {
  // The server verifies the remote student before reconciling an operation after reconnecting.
  return `nuni.tronclass.pending:${owner}:${courseId}:${homeworkId}`;
}

export function TronClassAssignment({
  client,
  revision,
  owner,
  homework,
  onClose,
  onBusy,
  onConnectionChanged,
  onSubmitted,
}: {
  client: TronClassClient;
  revision: string;
  owner: string;
  homework: TronClassHomeworkItem;
  onClose: () => void;
  onBusy: (busy: boolean) => void;
  onConnectionChanged: () => void;
  onSubmitted: () => void;
}) {
  const [preparation, setPreparation] = useState<TronClassPreparation | null>(null);
  const [preparing, setPreparing] = useState(true);
  const [prepareEpoch, setPrepareEpoch] = useState(0);
  const [prepareError, setPrepareError] = useState('');
  const [error, setError] = useState('');
  const [content, setContent] = useState('');
  const [files, setFiles] = useState<Attachment[]>([]);
  const [phase, setPhase] = useState<Phase>('editing');
  const [confirmed, setConfirmed] = useState(false);
  const [receipt, setReceipt] = useState<TronClassSubmissionReceipt | null>(null);
  const [restored, setRestored] = useState(false);
  const [checking, setChecking] = useState(false);
  const [copyMessage, setCopyMessage] = useState('');
  const alive = useRef(true);
  const lock = useRef(false);
  const operation = useRef<string | null>(null);
  const title = useRef<HTMLHeadingElement>(null);
  const callbacks = useRef({ onConnectionChanged, onBusy, onSubmitted });
  useEffect(() => {
    callbacks.current = { onConnectionChanged, onBusy, onSubmitted };
  }, [onConnectionChanged, onBusy, onSubmitted]);
  const storageKey = pendingKey(owner, homework.courseId, homework.id);
  const working = phase === 'uploading' || phase === 'submitting' || checking;
  const maxFiles = Math.min(
    MAX_FILES,
    preparation?.maxFiles && preparation.maxFiles > 0 ? preparation.maxFiles : MAX_FILES,
  );
  const maxFileBytes = Math.min(
    MAX_FILE_BYTES,
    preparation?.maxFileBytes && preparation.maxFileBytes > 0
      ? preparation.maxFileBytes
      : MAX_FILE_BYTES,
  );
  const permitted = preparation?.allowedContentTypes ?? [];

  useEffect(() => {
    alive.current = true;
    title.current?.focus();
    title.current?.scrollIntoView?.({ block: 'start', behavior: 'instant' });
    return () => {
      alive.current = false;
      callbacks.current.onBusy(false);
    };
  }, []);

  useEffect(() => {
    try {
      const existing = sessionStorage.getItem(storageKey);
      if (existing && /^[A-Za-z0-9_-]{16,80}$/.test(existing)) {
        operation.current = existing;
        // eslint-disable-next-line react-hooks/set-state-in-effect -- restore only the account-scoped operation ID before allowing a new submission
        setPhase('unknown');
      }
    } catch {
      // A storage failure is reported before any submission is dispatched.
    }
    setRestored(true);
  }, [storageKey]);

  useEffect(() => {
    let current = true;
    void client.prepare(homework.courseId, homework.id).then(
      (value) => {
        if (!current) return;
        if (
          value.revision !== revision ||
          value.courseId !== homework.courseId ||
          value.homeworkId !== homework.id
        ) {
          callbacks.current.onConnectionChanged();
          return;
        }
        setPreparation(value);
        setPrepareError('');
        setPreparing(false);
      },
      (reason) => {
        if (!current) return;
        setPrepareError(tronClassErrorMessage(reason));
        setPreparing(false);
      },
    );
    return () => {
      current = false;
    };
  }, [client, homework.courseId, homework.id, revision, prepareEpoch]);

  function addFiles(list: FileList | null) {
    if (!list || working || phase !== 'editing') return;
    const next = [
      ...files,
      ...Array.from(list).map((file) => ({
        id: crypto.randomUUID(),
        file,
        status: 'ready' as const,
      })),
    ];
    const issue = validateFiles(next);
    if (issue) {
      setError(issue);
      return;
    }
    operation.current = null;
    setFiles(next.map((item) => ({ ...item, status: 'ready' })));
    setError('');
  }

  function validateFiles(values: Attachment[], limits = preparation): string | null {
    const count = Math.min(
      MAX_FILES,
      limits?.maxFiles && limits.maxFiles > 0 ? limits.maxFiles : MAX_FILES,
    );
    const bytes = Math.min(
      MAX_FILE_BYTES,
      limits?.maxFileBytes && limits.maxFileBytes > 0 ? limits.maxFileBytes : MAX_FILE_BYTES,
    );
    if (values.length > count) return `一次最多可加入 ${count} 個附件。`;
    if (values.some((item) => item.file.size === 0)) return '附件是空白檔案，請重新選擇。';
    if (values.some((item) => item.file.size > bytes))
      return `每個附件須小於 ${sizeLabel(bytes)}。`;
    if (values.reduce((sum, item) => sum + item.file.size, 0) > MAX_TOTAL_BYTES)
      return '附件合計須小於 20 MB。';
    const types = limits?.allowedContentTypes ?? [];
    if (
      types.length &&
      values.some((item) => !types.includes(item.file.type || 'application/octet-stream'))
    )
      return '其中有此作業不接受的檔案格式，請依作業要求調整附件。';
    return null;
  }

  function preview() {
    if (working || !restored || phase !== 'editing') return;
    const issue = validateFiles(files);
    if (issue) {
      setError(issue);
      return;
    }
    if (!content.trim() && files.length === 0) {
      setError('請先輸入作業內容或加入附件。');
      return;
    }
    if (content.length > 20000) {
      setError('作業文字最多 20,000 字，較長內容請改用附件。');
      return;
    }
    setError('');
    setConfirmed(false);
    setPhase('preview');
  }

  function acceptResult(value: TronClassSubmissionResult, operationId: string) {
    const result = value.receipt;
    const verified =
      value.operationId === operationId &&
      value.status === 'submitted' &&
      result?.status === 'submitted' &&
      result.source === 'tronclass' &&
      result.courseId === homework.courseId &&
      result.homeworkId === homework.id &&
      !!result.id &&
      Number.isFinite(Date.parse(result.submittedAt));
    if (verified && result) {
      setReceipt(result);
      setPhase('submitted');
      setError('');
      try {
        sessionStorage.removeItem(storageKey);
      } catch {
        /* The server receipt still confirms success. */
      }
      callbacks.current.onSubmitted();
    } else {
      setPhase('unknown');
    }
  }

  async function submit() {
    if (lock.current || phase !== 'preview' || !confirmed || !preparation?.canSubmit || !restored)
      return;
    lock.current = true;
    callbacks.current.onBusy(true);
    setError('');
    setPhase('uploading');
    const operationId = operation.current ?? crypto.randomUUID();
    operation.current = operationId;
    let dispatched = false;
    try {
      const latest = await client.prepare(homework.courseId, homework.id);
      if (!alive.current) return;
      if (
        latest.revision !== revision ||
        latest.courseId !== homework.courseId ||
        latest.homeworkId !== homework.id
      ) {
        callbacks.current.onConnectionChanged();
        return;
      }
      setPreparation(latest);
      if (!latest.canSubmit) {
        setPhase('editing');
        setError(latest.blockedReason || '這份作業目前無法從 nuni 繳交，請查看原作業。');
        return;
      }
      const issue = validateFiles(files, latest);
      if (issue) {
        setPhase('editing');
        setError(issue);
        return;
      }
      for (const attachment of files) {
        if (!alive.current) return;
        if (attachment.status === 'uploaded') continue;
        setFiles((items) =>
          items.map((item) =>
            item.id === attachment.id ? { ...item, status: 'uploading' } : item,
          ),
        );
        try {
          const uploaded = await client.upload({
            courseId: homework.courseId,
            homeworkId: homework.id,
            revision,
            operationId,
            fileId: attachment.id,
            file: attachment.file,
          });
          if (!alive.current) return;
          if (
            uploaded.status !== 'uploaded' ||
            uploaded.fileId !== attachment.id ||
            uploaded.size !== attachment.file.size
          )
            throw new Error('UPLOAD_NOT_CONFIRMED');
          setFiles((items) =>
            items.map((item) =>
              item.id === attachment.id ? { ...item, status: 'uploaded' } : item,
            ),
          );
        } catch (reason) {
          if (alive.current)
            setFiles((items) =>
              items.map((item) =>
                item.id === attachment.id ? { ...item, status: 'failed' } : item,
              ),
            );
          throw reason;
        }
      }
      if (!alive.current) return;
      try {
        sessionStorage.setItem(storageKey, operationId);
      } catch {
        setPhase('editing');
        setError('此瀏覽器無法保留繳交查證紀錄，請允許網站儲存空間後重試，或開啟原作業。');
        return;
      }
      setPhase('submitting');
      dispatched = true;
      const result = await client.submit({
        courseId: homework.courseId,
        homeworkId: homework.id,
        revision,
        operationId,
        content,
        attachments: files.map((file) => file.id),
        confirmed: true,
      });
      if (!alive.current) return;
      acceptResult(result, operationId);
    } catch (reason) {
      if (!alive.current) return;
      if (!dispatched) {
        // An uncertain final submission keeps its ID; a failed upload needs a fresh draft ledger.
        operation.current = null;
        setFiles((items) => items.map((item) => ({ ...item, status: 'ready' })));
      }
      setPhase(dispatched ? 'unknown' : 'editing');
      setError(
        dispatched ? '尚未收到可核對的繳交結果，請先查證這次送出。' : tronClassErrorMessage(reason),
      );
    } finally {
      lock.current = false;
      if (alive.current) callbacks.current.onBusy(false);
    }
  }

  async function reconcile() {
    if (lock.current || !operation.current || phase !== 'unknown') return;
    lock.current = true;
    setChecking(true);
    setError('');
    try {
      const result = await client.reconcile(operation.current, revision);
      if (!alive.current) return;
      acceptResult(result, operation.current);
    } catch (reason) {
      if (!alive.current) return;
      if (
        reason instanceof TronClassRequestError &&
        reason.code === 'TRONCLASS_SUBMISSION_NOT_STARTED'
      ) {
        // Only this explicit server verdict proves the final write was never dispatched.
        try {
          sessionStorage.removeItem(storageKey);
        } catch {
          /* The next send replaces this metadata. */
        }
        operation.current = null;
        setFiles((items) => items.map((item) => ({ ...item, status: 'ready' })));
        setConfirmed(false);
        setPhase('editing');
        setError('已確認未送出，請重新核對後再繳交。');
      } else setError(tronClassErrorMessage(reason));
    } finally {
      lock.current = false;
      if (alive.current) setChecking(false);
    }
  }

  async function copyContent() {
    if (!content) return;
    try {
      await navigator.clipboard.writeText(content);
      if (alive.current) setCopyMessage('已複製作業內容。');
    } catch {
      if (alive.current) setCopyMessage('請選取作業文字後複製。');
    }
  }

  const previous = preparation?.receipt;
  const blocked = !preparing && !preparation?.canSubmit;

  return (
    <section
      className={`${styles.panel} ${styles.assignment}`}
      aria-labelledby="tronclass-assignment-title"
    >
      <div className={styles.heading}>
        <div>
          <p className={styles.eyebrow}>{homework.courseName}</p>
          <h2 id="tronclass-assignment-title" ref={title} tabIndex={-1}>
            {homework.title}
          </h2>
        </div>
        <button className={styles.textButton} disabled={working} onClick={onClose}>
          返回作業清單
        </button>
      </div>
      <p className={styles.muted}>
        {(preparation?.deadline ?? homework.deadline)
          ? `${tronClassTime(preparation?.deadline ?? homework.deadline)} 截止`
          : homework.deadlineLabel || '未提供截止時間'}
      </p>
      {(preparation?.description || homework.description) && (
        <div className={styles.assignmentBrief}>
          <h3>作業要求</h3>
          <p className={styles.bodyText}>{preparation?.description || homework.description}</p>
        </div>
      )}
      <SourceLink href={homework.href}>在 TronClass 查看原作業</SourceLink>
      {preparing && (
        <p role="status" className={styles.muted}>
          正在確認繳交條件與既有紀錄…
        </p>
      )}
      {prepareError && (
        <div className={styles.notice}>
          <p role="alert">{prepareError}</p>
          <button
            className="btn"
            disabled={preparing || working}
            onClick={() => {
              setPreparing(true);
              setPrepareEpoch((value) => value + 1);
            }}
          >
            重新確認繳交條件
          </button>
        </div>
      )}
      {blocked && phase !== 'unknown' && phase !== 'submitted' && (
        <div className={styles.notice}>
          <p>{preparation?.blockedReason || '目前無法確認這份作業是否接受直接繳交。'}</p>
          <p>可以先整理內容與附件，再開啟原作業完成繳交。</p>
        </div>
      )}
      {previous && phase !== 'submitted' && (
        <details className={styles.previous}>
          <summary>TronClass 的上次繳交紀錄 · {tronClassTime(previous.submittedAt)}</summary>
          <Receipt receipt={previous} />
        </details>
      )}
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      {phase === 'submitted' && receipt ? (
        <div className={styles.receipt} role="status">
          <h3>TronClass 已確認收到</h3>
          <Receipt receipt={receipt} />
        </div>
      ) : phase === 'unknown' ? (
        <div className={styles.notice}>
          <h3>繳交結果待確認</h3>
          <p>正在保留這次送出紀錄。先查證 TronClass 是否收到，再決定後續處理。</p>
          {content && (
            <details>
              <summary>查看這次準備的文字</summary>
              <p className={styles.bodyText}>{content}</p>
            </details>
          )}
          <div className={styles.actions}>
            <button className="btn primary" disabled={checking} onClick={() => void reconcile()}>
              {checking ? '正在查證…' : '查證繳交結果'}
            </button>
            <SourceLink href={homework.href}>到 TronClass 核對</SourceLink>
          </div>
          {checking && <p role="status">正在核對學校的繳交紀錄…</p>}
        </div>
      ) : (
        <>
          {phase === 'editing' ? (
            <div className={styles.form}>
              <label htmlFor="tronclass-answer">
                作業內容
                <textarea
                  id="tronclass-answer"
                  value={content}
                  maxLength={20000}
                  rows={9}
                  placeholder="在這裡整理要繳交的內容…"
                  onChange={(event) => {
                    setContent(event.target.value);
                    setCopyMessage('');
                  }}
                />
              </label>
              <p className={styles.characterCount}>{content.length.toLocaleString()} / 20,000 字</p>
              <label htmlFor="tronclass-attachments">
                作業附件
                <input
                  id="tronclass-attachments"
                  type="file"
                  multiple
                  accept={permitted.length ? permitted.join(',') : undefined}
                  onChange={(event) => {
                    addFiles(event.target.files);
                    event.target.value = '';
                  }}
                />
              </label>
              <p className={styles.muted}>
                最多 {maxFiles} 個附件，每個 {sizeLabel(maxFileBytes)}，合計 20 MB。
              </p>
            </div>
          ) : (
            <div className={styles.preview}>
              <h3>
                {working
                  ? phase === 'submitting'
                    ? '正在送出作業'
                    : '正在準備繳交'
                  : '確認繳交內容'}
              </h3>
              <p className={styles.muted}>
                課程：{homework.courseName}
                <br />
                作業：{homework.title}
              </p>
              {content ? (
                <p className={styles.bodyText}>{content}</p>
              ) : (
                <p className={styles.muted}>本次僅繳交附件。</p>
              )}
            </div>
          )}
          {files.length > 0 && (
            <ul className={styles.attachments} aria-label="準備的附件">
              {files.map((item) => (
                <li key={item.id}>
                  <div>
                    <strong>{item.file.name}</strong>
                    <span className={styles.muted}>
                      {sizeLabel(item.file.size)} ·{' '}
                      {item.status === 'uploaded'
                        ? '附件已上傳，尚待繳交'
                        : item.status === 'uploading'
                          ? '上傳中…'
                          : item.status === 'failed'
                            ? '上傳未完成'
                            : '已選取'}
                    </span>
                  </div>
                  {phase === 'editing' && (
                    <button
                      className={styles.textButton}
                      aria-label={`移除 ${item.file.name}`}
                      onClick={() => {
                        operation.current = null;
                        setFiles((values) =>
                          values
                            .filter((file) => file.id !== item.id)
                            .map((file) => ({ ...file, status: 'ready' })),
                        );
                      }}
                    >
                      移除
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {phase === 'preview' && (
            <label className={styles.confirm}>
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(event) => setConfirmed(event.target.checked)}
              />
              我已確認課程、作業內容與附件正確
            </label>
          )}
          <div className={styles.actions}>
            {phase === 'editing' ? (
              <button className="btn primary" disabled={!restored} onClick={preview}>
                預覽繳交內容
              </button>
            ) : (
              <>
                <button
                  className="btn primary"
                  disabled={working || !confirmed || !preparation?.canSubmit || preparing}
                  onClick={() => void submit()}
                >
                  {phase === 'uploading'
                    ? '準備附件中…'
                    : phase === 'submitting'
                      ? '正在繳交…'
                      : '確認送出到 TronClass'}
                </button>
                <button className="btn" disabled={working} onClick={() => setPhase('editing')}>
                  返回編輯
                </button>
              </>
            )}
            <button
              className={styles.textButton}
              disabled={!content || working}
              onClick={() => void copyContent()}
            >
              複製作業內容
            </button>
          </div>
          {copyMessage && (
            <p role="status" className={styles.muted}>
              {copyMessage}
            </p>
          )}
          {working && (
            <p role="status" className={styles.muted}>
              {phase === 'submitting'
                ? '正在核對 TronClass 的繳交紀錄，請保留這個畫面。'
                : '附件會逐一上傳，完成後才會送出作業。'}
            </p>
          )}
        </>
      )}
    </section>
  );
}

function Receipt({ receipt }: { receipt: TronClassSubmissionReceipt }) {
  return (
    <div>
      <p className={styles.muted}>繳交時間：{tronClassTime(receipt.submittedAt)}</p>
      {receipt.content && <p className={styles.bodyText}>{receipt.content}</p>}
      {receipt.attachments.length > 0 && (
        <ul className={styles.fileLinks} aria-label="已繳交的附件">
          {receipt.attachments.map((file, index) => (
            <li key={`${file.name}:${index}`}>
              {file.name} · {sizeLabel(file.size)}
            </li>
          ))}
        </ul>
      )}
      <p className={styles.muted}>繳交紀錄：{receipt.id}</p>
    </div>
  );
}
