'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { isTronClassAcknowledgedReadbackResult } from '@campus/shared/src/tronClassSubmissionConfirmation';
import { decodeTronClassPreparationCancellation } from '@campus/shared/src/tronClassSubmissionCancellation';
import {
  tronClassErrorMessage,
  TronClassRequestError,
  type TronClassClient,
} from '@/lib/tronClassIntegrationClient';
import type {
  TronClassHomeworkItem,
  TronClassAcknowledgedReadbackConfirmation,
  TronClassPreparation,
  TronClassSubmissionReceipt,
  TronClassSubmissionResult,
} from '@/lib/tronClassIntegrationTypes';
import { SourceLink, tronClassTime } from './TronClassSource';
import { TronClassSubmissionHistory } from './TronClassSubmissionHistory';
import { TronClassAssignmentDetails } from './TronClassAssignmentDetails';
import { TronClassSubmissionAvailability } from './TronClassSubmissionAvailability';
import { sameTronClassDraftScope, type TronClassLocalDraft } from './tronClassLocalDraft';
import styles from './tronclass.module.css';

type Attachment = { id: string; file: File; status: 'ready' | 'uploading' | 'uploaded' | 'failed' };
type Phase = 'editing' | 'preview' | 'uploading' | 'submitting' | 'unknown' | 'submitted' | 'confirmed';
type AssignmentClient = Pick<TronClassClient, 'prepare' | 'upload' | 'submit' | 'reconcile'> &
  Partial<Pick<TronClassClient, 'downloadSubmissionAttachment' | 'cancelPreparation'>>;
type OperationScope = {
  client: AssignmentClient;
  owner: string;
  revision: string;
  courseId: number;
  homeworkId: number;
  operationId: string;
};
const PENDING_CHANGED = '瀏覽器的操作紀錄已變更，請重新開啟作業後核對。';
const MAX_TOTAL_BYTES = 20 * 1024 * 1024;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_FILES = 4;

function connectionChanged(reason: unknown): reason is TronClassRequestError {
  return reason instanceof TronClassRequestError &&
    ['TRONCLASS_BINDING_CHANGED', 'TRONCLASS_RECONNECT_REQUIRED'].includes(reason.code);
}

function sizeLabel(size: number): string {
  if (size < 1024) return `${size} B`;
  return size >= 1024 * 1024
    ? `${(size / (1024 * 1024)).toFixed(1)} MB`
    : `${(size / 1024).toFixed(1)} KB`;
}

function preparationLimits(preparation: TronClassPreparation | null) {
  if (preparation?.rules?.status === 'confirmed') {
    return {
      confirmed: true,
      allowsText: preparation.rules.allowsText,
      allowsAttachments: preparation.rules.allowsAttachments,
      maxFiles: Math.min(MAX_FILES, preparation.maxFiles),
      maxFileBytes: Math.min(MAX_FILE_BYTES, preparation.maxFileBytes),
      maxTotalBytes: Math.min(MAX_TOTAL_BYTES, preparation.rules.maxTotalBytes),
      contentTypes: preparation.allowedContentTypes,
    };
  }
  // Missing/unknown source rules permit local preparation only. These limits
  // describe nuni's editor, never inferred permission to submit to the school.
  return {
    confirmed: false, allowsText: true, allowsAttachments: true,
    maxFiles: MAX_FILES, maxFileBytes: MAX_FILE_BYTES, maxTotalBytes: MAX_TOTAL_BYTES,
    contentTypes: [] as string[],
  };
}

function confirmationScope(preparation: TronClassPreparation) {
  // Match the native editor: refreshing a read timestamp does not change the
  // assignment, but school requirements must still match what the student saw.
  const details = preparation.details?.status === 'available'
    ? { ...preparation.details, fetchedAt: undefined }
    : preparation.details;
  return JSON.stringify([
    preparation.revision,
    preparation.courseId,
    preparation.homeworkId,
    preparation.title,
    preparation.description,
    preparation.deadline,
    preparation.canSubmit,
    preparation.rules,
    preparation.maxFiles,
    preparation.maxFileBytes,
    preparation.allowedContentTypes,
    details,
  ]);
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
  prepareOnly = false,
  initialDraft,
  onDraftChange,
}: {
  client: AssignmentClient;
  revision: string;
  owner: string;
  homework: TronClassHomeworkItem;
  onClose: () => void;
  onBusy: (busy: boolean) => void;
  onConnectionChanged: (reason?: unknown) => void;
  onSubmitted: () => void;
  /** An Agent can prepare locally without inheriting manual submission authority. */
  prepareOnly?: boolean;
  /** Only the enclosing verified school identity may supply a draft. */
  initialDraft?: TronClassLocalDraft;
  onDraftChange?: (draft: TronClassLocalDraft | null) => void;
}) {
  const fieldId = useId();
  const [preparation, setPreparation] = useState<TronClassPreparation | null>(null);
  const [preparing, setPreparing] = useState(true);
  const [prepareEpoch, setPrepareEpoch] = useState(0);
  const [prepareError, setPrepareError] = useState('');
  const [error, setError] = useState('');
  const [content, setContent] = useState('');
  const [files, setFiles] = useState<Attachment[]>([]);
  const [phase, setPhase] = useState<Phase>('editing');
  const [confirmed, setConfirmed] = useState(false);
  const confirmedScope = useRef<string | null>(null);
  const [receipt, setReceipt] = useState<TronClassSubmissionReceipt | null>(null);
  const [readbackConfirmation, setReadbackConfirmation] = useState<TronClassAcknowledgedReadbackConfirmation | null>(null);
  const [restored, setRestored] = useState(false);
  const [checking, setChecking] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [copyMessage, setCopyMessage] = useState('');
  const [draftRecovered, setDraftRecovered] = useState(false);
  const draftToRestore = useRef(!prepareOnly && initialDraft &&
    sameTronClassDraftScope(initialDraft, homework.courseId, homework.id) ? initialDraft : null);
  const [awaitingDraftRecovery, setAwaitingDraftRecovery] = useState(!prepareOnly && !!initialDraft &&
    sameTronClassDraftScope(initialDraft, homework.courseId, homework.id));
  const alive = useRef(true);
  const lock = useRef(false);
  const operation = useRef<string | null>(null);
  const activeScope = useRef({ client, owner, revision, courseId: homework.courseId, homeworkId: homework.id });
  activeScope.current = { client, owner, revision, courseId: homework.courseId, homeworkId: homework.id };
  const title = useRef<HTMLHeadingElement>(null);
  const callbacks = useRef({ onConnectionChanged, onBusy, onSubmitted, onDraftChange });
  useEffect(() => {
    callbacks.current = { onConnectionChanged, onBusy, onSubmitted, onDraftChange };
  }, [onConnectionChanged, onBusy, onSubmitted, onDraftChange]);
  const storageKey = pendingKey(owner, homework.courseId, homework.id);
  const working = phase === 'uploading' || phase === 'submitting' || checking || cancelling;
  const completed = phase === 'submitted' || phase === 'confirmed';
  const limits = preparationLimits(preparation);
  const canAddAttachments = limits.allowsAttachments && limits.maxFiles > 0 &&
    limits.maxFileBytes > 0 && limits.maxTotalBytes > 0;
  const submissionAllowed = preparation?.canSubmit === true && limits.confirmed && !prepareError;

  function captureOperation(operationId: string): Readonly<OperationScope> {
    return Object.freeze({ client, owner, revision, courseId: homework.courseId, homeworkId: homework.id, operationId });
  }

  function operationCurrent(expected: Readonly<OperationScope>) {
    const current = activeScope.current;
    return alive.current && current.client === expected.client && current.owner === expected.owner &&
      current.revision === expected.revision && current.courseId === expected.courseId &&
      current.homeworkId === expected.homeworkId && operation.current === expected.operationId;
  }

  function clearPending(expected: Readonly<OperationScope>): 'cleared' | 'changed' | 'unavailable' | 'stale' {
    if (!operationCurrent(expected)) return 'stale';
    const key = pendingKey(expected.owner, expected.courseId, expected.homeworkId);
    try {
      const saved = sessionStorage.getItem(key);
      if (saved !== null && saved !== expected.operationId) return 'changed';
      if (!operationCurrent(expected)) return 'stale';
      sessionStorage.removeItem(key);
      return sessionStorage.getItem(key) === null ? 'cleared' : 'changed';
    } catch {
      return 'unavailable';
    }
  }

  function finishPending(expected: Readonly<OperationScope>, failureMessage: string): boolean {
    const cleared = clearPending(expected);
    if (cleared === 'cleared') return operationCurrent(expected);
    if (cleared !== 'stale' && operationCurrent(expected)) {
      setPhase('unknown');
      setError(cleared === 'changed' ? PENDING_CHANGED : failureMessage);
    }
    return false;
  }

  useEffect(() => {
    // A recovered draft stays hidden until a fresh prepare confirms its scope.
    // This callback only retains local text/File handles, never upload status.
    if (prepareOnly || draftToRestore.current) return;
    callbacks.current.onDraftChange?.(completed || (!content && !files.length) ? null : {
      courseId: homework.courseId, homeworkId: homework.id, content,
      files: files.map(({ file }) => file),
    });
  }, [content, files, completed, homework.courseId, homework.id, prepareOnly]);

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
    if (prepareOnly) {
      // Agent preparation never resumes a separate manual submission operation.
      // eslint-disable-next-line react-hooks/set-state-in-effect -- scoped preparation has no submission journal to restore
      setRestored(true);
      return;
    }
    try {
      const existing = sessionStorage.getItem(storageKey);
      if (existing && /^[A-Za-z0-9_-]{16,80}$/.test(existing)) {
        operation.current = existing;
        setPhase('unknown');
      }
    } catch {
      // A storage failure is reported before any submission is dispatched.
    }
    setRestored(true);
  }, [storageKey, prepareOnly]);

  useEffect(() => {
    let current = true;
    void client.prepare(homework.courseId, homework.id, revision).then(
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
        const draft = draftToRestore.current;
        if (draft) {
          draftToRestore.current = null;
          setContent(draft.content);
          setFiles(draft.files.map((file) => ({ id: crypto.randomUUID(), file, status: 'ready' })));
          setDraftRecovered(true);
          setAwaitingDraftRecovery(false);
        }
        setPrepareError('');
        setPreparing(false);
      },
      (reason) => {
        if (!current) return;
        if (connectionChanged(reason)) {
          callbacks.current.onConnectionChanged(reason);
          return;
        }
        setPreparation(null);
        setConfirmed(false);
        setPrepareError(tronClassErrorMessage(reason));
        setPreparing(false);
      },
    );
    return () => {
      current = false;
    };
  }, [client, homework.courseId, homework.id, revision, prepareEpoch]);

  function rememberLocalDraft(nextContent: string, nextFiles: Attachment[]) {
    if (prepareOnly) return;
    callbacks.current.onDraftChange?.(!nextContent && !nextFiles.length ? null : {
      courseId: homework.courseId, homeworkId: homework.id,
      content: nextContent, files: nextFiles.map(({ file }) => file),
    });
  }

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
    const ready = next.map((item) => ({ ...item, status: 'ready' as const }));
    rememberLocalDraft(content, ready);
    setFiles(ready);
    setError('');
  }

  function validateFiles(values: Attachment[], preparationValue = preparation): string | null {
    const rules = preparationLimits(preparationValue);
    if (values.length > 0 && (!rules.allowsAttachments || rules.maxFiles === 0 ||
      rules.maxFileBytes === 0 || rules.maxTotalBytes === 0)) {
      return 'nuni 目前未開放這份作業的附件繳交，請移除附件，或到 TronClass 完成繳交。';
    }
    if (values.length > rules.maxFiles) return `一次最多可加入 ${rules.maxFiles} 個附件。`;
    if (values.some(({ file }) => !file.name || file.name.length > 200 || /[\\/\u0000-\u001f\u007f]/.test(file.name)))
      return '附件名稱須在 200 字以內，請移除無法使用的字元後重新選取。';
    if (values.some((item) => item.file.size === 0)) return '附件是空白檔案，請重新選擇。';
    if (values.some((item) => item.file.size > rules.maxFileBytes))
      return `單一附件不可超過 ${sizeLabel(rules.maxFileBytes)}。`;
    if (values.reduce((sum, item) => sum + item.file.size, 0) > rules.maxTotalBytes)
      return `附件合計不可超過 ${sizeLabel(rules.maxTotalBytes)}。`;
    if (values.some(({ file }) => file.type.length > 100 ||
      !/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/i.test(file.type || 'application/octet-stream')))
      return '其中有無法辨識格式的附件，請重新選取檔案。';
    if (
      rules.contentTypes.length &&
      values.some((item) => !rules.contentTypes.includes(item.file.type || 'application/octet-stream'))
    )
      return '其中有目前無法在 nuni 繳交的檔案格式，請調整附件或至 TronClass 處理。';
    return null;
  }

  function validatePayload(preparationValue = preparation, requireConfirmed = false): string | null {
    const rules = preparationLimits(preparationValue);
    if (requireConfirmed && !rules.confirmed)
      return '尚未確認這份作業的繳交規則，請重新讀取後再試。';
    if (!content.trim() && files.length === 0) return '請先輸入作業內容或加入附件。';
    if (content.length > 20000) return '作業文字最多 20,000 字，較長內容請改用附件。';
    if (content.trim() && !rules.allowsText)
      return '目前可在 nuni 以附件繳交，請將文字整理在附件內，並清空本頁的作業內容後再送出。';
    return validateFiles(files, preparationValue);
  }

  function preview() {
    if (working || !restored || awaitingDraftRecovery || phase !== 'editing') return;
    const issue = validatePayload();
    if (issue) {
      setError(issue);
      return;
    }
    setError('');
    setConfirmed(false);
    setPhase('preview');
  }

  function acceptResult(value: TronClassSubmissionResult, expected: Readonly<OperationScope>) {
    if (!operationCurrent(expected)) return;
    const { operationId, courseId, homeworkId } = expected;
    if (value.status === 'confirmed') {
      if (!isTronClassAcknowledgedReadbackResult(value, {
        operationId, courseId, homeworkId,
      })) {
        setPhase('unknown');
        return;
      }
      if (!finishPending(expected, '原操作已確認，但瀏覽器紀錄尚未更新。請再次查證原操作。')) return;
      operation.current = null;
      draftToRestore.current = null;
      setAwaitingDraftRecovery(false);
      callbacks.current.onDraftChange?.(null);
      setReceipt(null);
      setReadbackConfirmation(value.confirmation);
      setPhase('confirmed');
      setError('');
      callbacks.current.onSubmitted();
      return;
    }
    const result = value.receipt;
    const verified =
      value.operationId === operationId &&
      value.status === 'submitted' &&
      result?.status === 'submitted' &&
      result.source === 'tronclass' &&
      result.courseId === courseId &&
      result.homeworkId === homeworkId &&
      !!result.id &&
      Number.isFinite(Date.parse(result.submittedAt));
    if (verified && result) {
      if (!finishPending(expected, '原操作已確認，但瀏覽器紀錄尚未更新。請再次查證原操作。')) return;
      operation.current = null;
      draftToRestore.current = null;
      setAwaitingDraftRecovery(false);
      callbacks.current.onDraftChange?.(null);
      setReadbackConfirmation(null);
      setReceipt(result);
      setPhase('submitted');
      setError('');
      callbacks.current.onSubmitted();
    } else {
      setPhase('unknown');
    }
  }

  async function submit() {
    if (prepareOnly || lock.current || phase !== 'preview' || !confirmed || !submissionAllowed || preparing || !restored)
      return;
    lock.current = true;
    callbacks.current.onBusy(true);
    setError('');
    setPhase('uploading');
    const operationId = operation.current ?? crypto.randomUUID();
    operation.current = operationId;
    const expected = captureOperation(operationId);
    let dispatched = false;
    let prepared = false;
    let journalSaved = false;
    try {
      const latest = await client.prepare(homework.courseId, homework.id, revision);
      if (!operationCurrent(expected)) return;
      if (
        latest.revision !== revision ||
        latest.courseId !== homework.courseId ||
        latest.homeworkId !== homework.id
      ) {
        callbacks.current.onConnectionChanged();
        return;
      }
      setPreparation(latest);
      prepared = true;
      if (!latest.canSubmit) {
        setPhase('editing');
        setConfirmed(false);
        setError(latest.blockedReason || '這份作業目前無法從 nuni 繳交，請查看原作業。');
        return;
      }
      const issue = validatePayload(latest, true);
      if (issue) {
        setPhase('editing');
        setConfirmed(false);
        setError(issue);
        return;
      }
      if (confirmationScope(latest) !== confirmedScope.current) {
        setPhase('editing');
        setConfirmed(false);
        setError('校方作業條件已變更，請查看最新要求並重新預覽。');
        return;
      }
      try {
        const saved = sessionStorage.getItem(storageKey);
        if (saved !== null && saved !== expected.operationId) {
          setConfirmed(false);
          setPhase('unknown');
          setError(PENDING_CHANGED);
          return;
        }
        sessionStorage.setItem(storageKey, operationId);
      } catch {
        operation.current = null;
        setPhase('editing');
        setConfirmed(false);
        setError('此瀏覽器無法保留繳交查證紀錄，請允許網站儲存空間後重試，或開啟原作業。');
        return;
      }
      journalSaved = true;
      for (const attachment of files) {
        if (!operationCurrent(expected)) return;
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
          if (!operationCurrent(expected)) return;
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
          if (operationCurrent(expected))
            setFiles((items) =>
              items.map((item) =>
                item.id === attachment.id ? { ...item, status: 'failed' } : item,
              ),
            );
          throw reason;
        }
      }
      if (!operationCurrent(expected)) return;
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
      if (!operationCurrent(expected)) return;
      acceptResult(result, expected);
    } catch (reason) {
      if (!operationCurrent(expected)) return;
      if (!journalSaved) {
        // Nothing was dispatched before the recovery ID could be retained.
        operation.current = null;
        setFiles((items) => items.map((item) => ({ ...item, status: 'ready' })));
      }
      if (connectionChanged(reason)) {
        // A recorded operation survives reconnecting for read-only checks or
        // explicit preparation cancellation; a session error cannot clear it.
        callbacks.current.onConnectionChanged(reason);
        return;
      }
      if (!prepared) {
        setPreparation(null);
        setPrepareError(tronClassErrorMessage(reason));
      }
      setPhase(journalSaved ? 'unknown' : 'editing');
      setError(
        dispatched ? '尚未收到可核對的繳交結果，請先查證這次送出。'
          : journalSaved ? '附件準備中斷，請先停止這次準備，再重新預覽送出。'
          : prepared ? tronClassErrorMessage(reason) : '',
      );
    } finally {
      lock.current = false;
      if (alive.current) {
        if (!operationCurrent(expected)) {
          setPhase(value => value === 'uploading' || value === 'submitting'
            ? journalSaved ? 'unknown' : 'editing' : value);
        }
        callbacks.current.onBusy(false);
      }
    }
  }

  async function reconcile() {
    if (lock.current || !operation.current || phase !== 'unknown') return;
    const expected = captureOperation(operation.current);
    lock.current = true;
    callbacks.current.onBusy(true);
    setChecking(true);
    setError('');
    try {
      const result = await expected.client.reconcile(expected.operationId, expected.revision);
      if (!operationCurrent(expected)) return;
      acceptResult(result, expected);
    } catch (reason) {
      if (!operationCurrent(expected)) return;
      if (connectionChanged(reason)) {
        callbacks.current.onConnectionChanged(reason);
        return;
      }
      if (
        reason instanceof TronClassRequestError &&
        reason.code === 'TRONCLASS_SUBMISSION_NOT_STARTED'
      ) {
        // Only this explicit server verdict proves the final write was never dispatched.
        if (!finishPending(expected, '已確認未送出，但瀏覽器紀錄尚未更新。請再次查證後再編輯。')) return;
        operation.current = null;
        confirmedScope.current = null;
        setFiles((items) => items.map((item) => ({ ...item, status: 'ready' })));
        setConfirmed(false);
        setPhase('editing');
        setError('已確認未送出，請重新核對後再繳交。');
      } else setError(tronClassErrorMessage(reason));
    } finally {
      lock.current = false;
      if (alive.current) {
        setChecking(false);
        callbacks.current.onBusy(false);
      }
    }
  }

  async function cancelPreparation() {
    if (prepareOnly || !client.cancelPreparation || lock.current || !alive.current ||
      !operation.current || phase !== 'unknown') return;
    const expected = captureOperation(operation.current);
    lock.current = true;
    callbacks.current.onBusy(true);
    setCancelling(true);
    setError('');
    try {
      const value = await client.cancelPreparation({ operationId: expected.operationId, revision: expected.revision,
        courseId: expected.courseId, homeworkId: expected.homeworkId });
      if (!operationCurrent(expected)) return;
      const result = decodeTronClassPreparationCancellation(value, expected);
      if (!result) throw new TronClassRequestError('INVALID_RESPONSE', '尚未收到可確認的回覆，請稍後重新查詢。');
      if (result.status !== 'cancelled') {
        setError('這次送出尚未確認可停止，請繼續查證原操作。');
        return;
      }
      if (!finishPending(expected, '已停止準備，但瀏覽器紀錄尚未更新。請再次停止準備，清除紀錄後再編輯。')) return;
      operation.current = null;
      confirmedScope.current = null;
      setFiles((items) => items.map((item) => ({ ...item, status: 'ready' })));
      setConfirmed(false);
      setPhase('editing');
      setError('已停止這次準備。內容與附件已保留，請重新預覽後再繳交。');
    } catch (reason) {
      if (!operationCurrent(expected)) return;
      if (connectionChanged(reason)) callbacks.current.onConnectionChanged(reason);
      else setError(tronClassErrorMessage(reason));
    } finally {
      lock.current = false;
      // A refreshed client can keep this component mounted. Release only this
      // request's UI lock; the stale result never clears or edits its operation.
      if (alive.current) {
        setCancelling(false);
        callbacks.current.onBusy(false);
      }
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

  function retryPreparation() {
    if (preparing || working) return;
    setPreparing(true);
    setPrepareError('');
    setConfirmed(false);
    setPrepareEpoch((value) => value + 1);
  }

  const previous = preparation?.receipt;
  const blocked = !preparing && !submissionAllowed;
  const displayTitle = preparation?.title ?? homework.title;
  const displayDescription = preparation ? preparation.description : homework.description;
  const displayDeadline = preparation ? preparation.deadline : homework.deadline;

  return (
    <section
      className={`${styles.panel} ${styles.assignment}`}
      aria-labelledby={`${fieldId}-title`}
    >
      <div className={styles.heading}>
        <div>
          <p className={styles.eyebrow}>{homework.courseName}</p>
          <h2 id={`${fieldId}-title`} ref={title} tabIndex={-1}>
            {displayTitle}
          </h2>
        </div>
        <button className={styles.textButton} disabled={working} onClick={onClose}>
          {prepareOnly ? '關閉作業準備' : '返回作業清單'}
        </button>
      </div>
      <p className={styles.muted}>
        {displayDeadline
          ? `${tronClassTime(displayDeadline)} 截止`
          : (!preparation && homework.deadlineLabel) || '未提供截止時間'}
      </p>
      {displayDescription && (
        <div className={styles.assignmentBrief}>
          <h3>作業要求</h3>
          <p className={styles.bodyText}>{displayDescription}</p>
        </div>
      )}
      <SourceLink href={homework.href}>在 TronClass 查看原作業</SourceLink>
      {draftRecovered && <p className={styles.notice} role="status">
        已取回本頁保留的文字與附件。請重新核對內容與最新繳交條件；先前的上傳狀態不會沿用。
      </p>}
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
            onClick={retryPreparation}
          >
            重新確認繳交條件
          </button>
        </div>
      )}
      {!preparing && !prepareError && preparation?.details && !completed && (
        <TronClassAssignmentDetails
          details={preparation.details}
          onRetry={retryPreparation}
          retryDisabled={working}
        />
      )}
      {!preparing && !prepareError && preparation?.availability && !completed && phase !== 'unknown' && (
        <TronClassSubmissionAvailability
          availability={preparation.availability}
          onRetry={retryPreparation}
          retryDisabled={working}
        />
      )}
      {!preparing && !working && !prepareError && preparation?.history && !completed && phase !== 'unknown' && (
        <TronClassSubmissionHistory
          history={preparation.history}
          sourceHref={homework.href}
          onRetry={retryPreparation}
          retryDisabled={working}
          attachmentDownload={client.downloadSubmissionAttachment ? {
            revision, download: client.downloadSubmissionAttachment,
            onConnectionChanged: (reason) => callbacks.current.onConnectionChanged(reason),
          } : undefined}
        />
      )}
      {blocked && phase !== 'unknown' && !completed && (
        <div className={styles.notice}>
          <p>{preparation?.blockedReason || (limits.confirmed
            ? '目前無法確認這份作業是否接受直接繳交。'
            : '尚未確認這份作業的繳交規則。')}</p>
          <p>可以先整理內容與附件，再開啟原作業完成繳交。</p>
        </div>
      )}
      {previous && !completed && (
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
      {phase === 'confirmed' && readbackConfirmation ? (
        <div className={styles.receipt} role="status">
          <h3>已確認校方版本</h3>
          <p>已核對這次送出的校方版本。</p>
          <p className={styles.muted}>確認時間：{tronClassTime(readbackConfirmation.confirmedAt)}</p>
          <p className={styles.muted}>來源紀錄時間：{readbackConfirmation.sourceRecordedAt
            ? tronClassTime(readbackConfirmation.sourceRecordedAt) : '尚無可確認的時間'}</p>
          <p className={styles.muted}>校方版本：{readbackConfirmation.submissionId}</p>
          <p className={styles.muted}>確認時間是 nuni 完成核對的時間，來源紀錄時間由 TronClass 提供。</p>
        </div>
      ) : phase === 'submitted' && receipt ? (
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
            <button className="btn primary" disabled={checking || cancelling} onClick={() => void reconcile()}>
              {checking ? '正在查證…' : '查證繳交結果'}
            </button>
            {!prepareOnly && client.cancelPreparation && (
              <button className="btn" disabled={checking || cancelling} onClick={() => void cancelPreparation()}>
                {cancelling ? '正在停止準備…' : '停止準備並返回編輯'}
              </button>
            )}
            <SourceLink href={homework.href}>到 TronClass 核對</SourceLink>
          </div>
          {checking && <p role="status">正在核對學校的繳交紀錄…</p>}
        </div>
      ) : (
        <>
          {phase === 'editing' ? (
            <div className={styles.form}>
              {limits.confirmed && <p className={styles.muted}>
                {!submissionAllowed ? '目前可在本頁整理與預覽；正式繳交請使用 TronClass 原頁。' : limits.allowsText
                  ? canAddAttachments ? '目前可在 nuni 以文字與附件繳交。' : '目前可在 nuni 以文字繳交，附件請至 TronClass 處理。'
                  : canAddAttachments ? '目前可在 nuni 以附件繳交，請將作業文字整理在附件內。' : 'nuni 目前未開放這份作業的繳交方式。'}
              </p>}
              <div className={styles.textField}>
                <label htmlFor={`${fieldId}-answer`}>作業內容</label>
                <textarea
                  id={`${fieldId}-answer`}
                  value={content}
                  disabled={awaitingDraftRecovery}
                  maxLength={20000}
                  rows={9}
                  placeholder="在這裡整理要繳交的內容…"
                  onChange={(event) => {
                    rememberLocalDraft(event.target.value, files);
                    setContent(event.target.value);
                    setCopyMessage('');
                  }}
                />
              </div>
              <p className={styles.characterCount}>{content.length.toLocaleString()} / 20,000 字</p>
              <label htmlFor={`${fieldId}-attachments`}>
                作業附件
                <input
                  id={`${fieldId}-attachments`}
                  type="file"
                  multiple
                  disabled={awaitingDraftRecovery || !canAddAttachments}
                  accept={limits.contentTypes.length ? limits.contentTypes.join(',') : undefined}
                  onChange={(event) => {
                    addFiles(event.target.files);
                    event.target.value = '';
                  }}
                />
              </label>
              <p className={styles.muted}>
                {canAddAttachments
                  ? `${limits.confirmed ? '本次附件上限' : '本頁整理上限'}：最多 ${limits.maxFiles} 個附件，每個 ${sizeLabel(limits.maxFileBytes)}，合計 ${sizeLabel(limits.maxTotalBytes)}。`
                  : 'nuni 目前未開放這份作業的附件繳交。'}
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
                作業：{displayTitle}
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
                        const remaining = files.filter((file) => file.id !== item.id)
                          .map((file) => ({ ...file, status: 'ready' as const }));
                        rememberLocalDraft(content, remaining);
                        setFiles(remaining);
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
                disabled={preparing || !preparation}
                onChange={(event) => {
                  if (preparing || !preparation) return;
                  confirmedScope.current = event.target.checked ? confirmationScope(preparation) : null;
                  setConfirmed(event.target.checked);
                }}
              />
              我已確認課程、作業內容與附件正確
            </label>
          )}
          {!prepareOnly && <p className={styles.muted}>
            返回作業清單會保留本頁的文字與附件。離開或重新整理本頁會清除草稿。
          </p>}
          <div className={styles.actions}>
            {phase === 'editing' && !prepareOnly && <button className="btn"
              disabled={working || awaitingDraftRecovery || (!content && !files.length)}
              onClick={() => {
                setContent('');
                setFiles([]);
                setConfirmed(false);
                confirmedScope.current = null;
                rememberLocalDraft('', []);
                setError('');
                setCopyMessage('已清除本頁草稿。');
              }}>丟棄本頁草稿</button>}
            {phase === 'editing' ? (
              <button className="btn primary" disabled={!restored || awaitingDraftRecovery} onClick={preview}>
                預覽繳交內容
              </button>
            ) : (
              <>
                <button
                  className="btn primary"
                  disabled={prepareOnly || working || !confirmed || !submissionAllowed || preparing}
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
