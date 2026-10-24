'use client';

import { use, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { SiteShell } from '@/components/SiteShell';
import { SchoolScopePlaceholder } from '@/components/SchoolScopePlaceholder';
import { useAuth } from '@/components/AuthGuard';
import { LoginRequiredLostFoundComments } from '@/components/LoginRequiredLostFoundComments';
import { Button } from '@/components/ui/Button';
import {
  LostFoundForm,
  validateLostFoundForm,
  type LostFoundFormErrors,
} from '@/components/lost-found/LostFoundForm';
import styles from '@/components/lost-found/LostFound.module.css';
import { useBrowsingSchoolPageContext } from '@/lib/useBrowsingSchoolPageContext';
import {
  LostFoundConflictError,
  LostFoundError,
  LostFoundWriteUnconfirmedError,
  canManageLostFoundItem,
  createLostFoundItem,
  getLostFoundItem,
  newLostFoundItemId,
  type LostFoundItem,
  type LostFoundWriteFields,
} from '@/lib/lostFound';
import {
  LostFoundStorageError,
  clearDamagedCreateLocalMetadata,
  clearLostFoundDraft,
  clearLostFoundPending,
  emptyLostFoundFields,
  fieldsEqual,
  forgetCreateDocumentId,
  listRecoverableCreateSessions,
  loadLostFoundDraft,
  loadLostFoundPending,
  rememberCreateDocumentId,
  saveLostFoundDraft,
  saveLostFoundPending,
  type LostFoundDraftScope,
  type LostFoundPendingIntent,
  type RecoverableCreateSession,
} from '@/lib/lostFoundDrafts';

export default function LostFoundPostPage(props: {
  searchParams?: Promise<{ schoolId?: string; school?: string; campus?: string }>;
}) {
  const search = props.searchParams ? use(props.searchParams) : undefined;
  const context = useBrowsingSchoolPageContext(search);
  const { user } = useAuth();
  if (!context.ready) {
    return (
      <SiteShell title="刊登失物招領">
        <SchoolScopePlaceholder />
      </SiteShell>
    );
  }
  return (
    <LostFoundPostContent
      key={`${user?.uid ?? 'signed-out'}:${context.schoolId}`}
      context={context}
    />
  );
}

function LostFoundPostContent({
  context,
}: {
  context: ReturnType<typeof useBrowsingSchoolPageContext>;
}) {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const uid = user?.uid ?? null;
  const loginReturnUrl = `/lost-found/post?schoolId=${encodeURIComponent(context.schoolId)}`;
  const [fields, setFields] = useState<LostFoundWriteFields>(emptyLostFoundFields);
  const [documentId, setDocumentId] = useState<string | null>(null);
  const [errors, setErrors] = useState<LostFoundFormErrors>({});
  const [busy, setBusy] = useState(false);
  const [storageBlocked, setStorageBlocked] = useState(false);
  const [storageMessage, setStorageMessage] = useState('');
  const [statusMessage, setStatusMessage] = useState('');
  const [ready, setReady] = useState(false);
  const [pending, setPending] = useState<LostFoundPendingIntent | null>(null);
  const [siblings, setSiblings] = useState<RecoverableCreateSession[]>([]);
  /** Damaged local unknown-outcome intent for a known scoped document id. */
  const [corruptBlocked, setCorruptBlocked] = useState(false);
  const [inspectBusy, setInspectBusy] = useState(false);
  const [serverReceipt, setServerReceipt] = useState<LostFoundItem | null | undefined>(undefined);
  const [confirmAction, setConfirmAction] = useState<'adopt-server' | 'rebuild-draft' | null>(null);
  const mounted = useRef(true);
  const busyLock = useRef(false);
  const scopeGeneration = useRef(0);
  const identityRef = useRef<{ uid: string | null; schoolId: string }>({
    uid,
    schoolId: context.schoolId,
  });

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    scopeGeneration.current += 1;
    identityRef.current = { uid, schoolId: context.schoolId };
  }, [uid, context.schoolId]);

  useEffect(() => {
    if (authLoading || !uid) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- wait for auth before draft recovery
      setReady(false);
      return;
    }
    let active = true;
    const generation = scopeGeneration.current;
    const scopeUid = uid;
    const schoolId = context.schoolId;
    setReady(false);
    setStorageBlocked(false);
    setStorageMessage('');
    setStatusMessage('');
    setErrors({});
    setBusy(false);
    busyLock.current = false;
    setSiblings([]);
    setCorruptBlocked(false);
    setServerReceipt(undefined);
    setConfirmAction(null);

    try {
      let id = newLostFoundItemId(schoolId);
      let nextFields = emptyLostFoundFields();
      let nextPending: LostFoundPendingIntent | null = null;
      let nextSiblings: RecoverableCreateSession[] = [];
      const recovered = recoverCreateSession(scopeUid, schoolId);
      if (recovered?.storageBlocked && !recovered.documentId) {
        if (!active || !mounted.current || generation !== scopeGeneration.current) return;
        setStorageBlocked(true);
        setStorageMessage(recovered.storageMessage);
        setDocumentId(null);
        setFields(emptyLostFoundFields());
        setPending(null);
        setSiblings([]);
        setCorruptBlocked(false);
        setReady(true);
        return;
      }
      if (recovered?.corrupt && recovered.documentId) {
        if (!active || !mounted.current || generation !== scopeGeneration.current) return;
        setDocumentId(recovered.documentId);
        setFields(emptyLostFoundFields());
        setPending(null);
        setSiblings(recovered.siblings);
        setStorageBlocked(true);
        setStorageMessage(recovered.storageMessage);
        setCorruptBlocked(true);
        setStatusMessage('');
        setReady(true);
        return;
      }
      if (recovered) {
        id = recovered.documentId;
        nextFields = recovered.fields;
        nextPending = recovered.pending;
        nextSiblings = recovered.siblings;
        if (recovered.storageMessage) {
          setStorageMessage(recovered.storageMessage);
          setStorageBlocked(recovered.storageBlocked);
        }
        if (nextPending) {
          setStatusMessage('偵測到尚未確認的刊登，請先重試同一則，避免重複發布。');
        } else if (recovered.fromDraft) {
          setStatusMessage('已還原先前未完成的草稿。');
        }
      } else {
        try {
          rememberCreateDocumentId(scopeUid, schoolId, id);
        } catch {
          // In-memory id still drives this session; storage denial is surfaced on first edit/submit.
        }
      }
      if (!active || !mounted.current || generation !== scopeGeneration.current) return;
      setDocumentId(id);
      setFields(nextFields);
      setPending(nextPending);
      setSiblings(nextSiblings);
      setCorruptBlocked(false);
      setReady(true);
    } catch (reason) {
      if (!active || !mounted.current || generation !== scopeGeneration.current) return;
      setStorageBlocked(true);
      setStorageMessage(
        reason instanceof LostFoundStorageError
          ? reason.message
          : reason instanceof LostFoundError
            ? reason.message
            : '目前無法準備刊登表單，請稍後再試。',
      );
      setDocumentId(null);
      setCorruptBlocked(false);
      setReady(true);
    }

    return () => {
      active = false;
    };
  }, [authLoading, uid, context.schoolId]);

  function scopeFor(id: string): LostFoundDraftScope {
    if (!uid) throw new LostFoundError('請先登入後再操作。');
    return { uid, schoolId: context.schoolId, mode: 'create', itemKey: id };
  }

  function refreshSiblings(activeId: string) {
    if (!uid) return;
    try {
      setSiblings(
        listRecoverableCreateSessions(uid, context.schoolId).filter(
          (session) => session.documentId !== activeId,
        ),
      );
    } catch {
      // non-fatal
    }
  }

  function persistDraft(next: LostFoundWriteFields, id: string) {
    try {
      rememberCreateDocumentId(uid!, context.schoolId, id);
      saveLostFoundDraft(scopeFor(id), {
        version: 1,
        documentId: id,
        ...next,
      });
      setStorageBlocked(false);
      setStorageMessage('');
      refreshSiblings(id);
    } catch (reason) {
      setStorageBlocked(true);
      setStorageMessage(
        reason instanceof LostFoundStorageError
          ? reason.message
          : '目前無法安全保存草稿，畫面內容仍保留。',
      );
    }
  }

  function switchToSession(session: RecoverableCreateSession) {
    if (corruptBlocked) {
      setErrors({
        form: '目前有損毀的待確認資料尚未對帳，請先處理後再切換其他草稿。',
      });
      return;
    }
    if (pending && pending.documentId !== session.documentId) {
      setErrors({
        form: '目前這則刊登結果尚未確認，請先重試完成後再切換其他草稿。',
      });
      return;
    }
    if (session.corrupt) {
      setDocumentId(session.documentId);
      setFields(emptyLostFoundFields());
      setPending(null);
      setCorruptBlocked(true);
      setStorageBlocked(true);
      setStorageMessage(
        session.corruptionMessage ||
          '本機待確認或草稿資料已損毀，尚未對帳前請勿另開新刊登。',
      );
      setServerReceipt(undefined);
      setConfirmAction(null);
      setStatusMessage('');
      setErrors({});
      refreshSiblings(session.documentId);
      return;
    }
    setDocumentId(session.documentId);
    setFields(session.fields);
    setPending(session.pending);
    setCorruptBlocked(false);
    setErrors({});
    setStatusMessage(
      session.pending
        ? '已切換至另一則尚未確認的刊登。'
        : '已切換至另一則未完成草稿。',
    );
    refreshSiblings(session.documentId);
  }

  function onFieldsChange(next: LostFoundWriteFields) {
    const id = documentId;
    if (!id || !uid || corruptBlocked) {
      setFields(next);
      return;
    }
    const currentPending = pending;
    if (currentPending && currentPending.fields && !fieldsEqual(currentPending.fields, next)) {
      setErrors({
        form: '尚有未確認的刊登結果。請先重試同一則內容，或確認列表後再修改。',
      });
      setStatusMessage('未知結果必須先對帳，不能直接改成另一則刊登。');
      setFields({
        type: currentPending.fields.type,
        title: currentPending.fields.title,
        description: currentPending.fields.description,
        category: currentPending.fields.category,
        location: currentPending.fields.location,
        date: currentPending.fields.date,
        contactInfo: currentPending.fields.contactInfo ?? '',
      });
      return;
    }
    setFields(next);
    setErrors({});
    persistDraft(next, id);
  }

  async function submitIntent(intent: LostFoundPendingIntent) {
    if (!uid || busyLock.current || corruptBlocked) return;
    const generation = scopeGeneration.current;
    const expectedUid = uid;
    const schoolId = context.schoolId;
    busyLock.current = true;
    setBusy(true);
    setErrors({});
    setStatusMessage('正在送出刊登…');
    try {
      // Persist recoverable identity BEFORE the network mutation.
      rememberCreateDocumentId(expectedUid, schoolId, intent.documentId);
      saveLostFoundPending(scopeFor(intent.documentId), intent);
      setPending(intent);
      if (intent.fields) {
        saveLostFoundDraft(scopeFor(intent.documentId), {
          version: 1,
          documentId: intent.documentId,
          ...intent.fields,
        });
      }
      const item = await createLostFoundItem(schoolId, intent.documentId, intent.fields!);
      if (!mounted.current || generation !== scopeGeneration.current) return;
      if (
        identityRef.current.uid !== expectedUid ||
        identityRef.current.schoolId !== schoolId
      ) {
        return;
      }
      try {
        clearLostFoundPending(scopeFor(intent.documentId));
        clearLostFoundDraft(scopeFor(intent.documentId));
        forgetCreateDocumentId(expectedUid, schoolId, intent.documentId);
      } catch {
        // Success already confirmed by server receipt; storage cleanup is best-effort.
      }
      setPending(null);
      setStatusMessage('刊登成功，正在前往詳情…');
      router.replace(
        `/lost-found/${encodeURIComponent(item.id)}?schoolId=${encodeURIComponent(schoolId)}`,
      );
    } catch (reason) {
      if (!mounted.current || generation !== scopeGeneration.current) return;
      if (
        identityRef.current.uid !== expectedUid ||
        identityRef.current.schoolId !== schoolId
      ) {
        return;
      }
      if (reason instanceof LostFoundStorageError) {
        setStorageBlocked(true);
        setStorageMessage(reason.message);
        setErrors({ form: reason.message });
        return;
      }
      if (reason instanceof LostFoundConflictError) {
        setErrors({ form: reason.message });
        setStatusMessage('請返回列表確認現有刊登，勿覆寫他人或較新的內容。');
        return;
      }
      if (reason instanceof LostFoundWriteUnconfirmedError) {
        setPending(intent);
        setErrors({ form: reason.message });
        setStatusMessage('送出結果未確認。請使用「重試同一則刊登」，不要另開新則。');
        return;
      }
      setErrors({
        form:
          reason instanceof LostFoundError
            ? reason.message
            : '暫時無法刊登，草稿已保留，請稍後再試。',
      });
    } finally {
      if (generation === scopeGeneration.current) {
        busyLock.current = false;
        if (mounted.current) setBusy(false);
      }
    }
  }

  async function onSubmit() {
    if (!uid || !documentId || corruptBlocked) return;
    if (pending) {
      await submitIntent(pending);
      return;
    }
    const validation = validateLostFoundForm(fields);
    if (Object.keys(validation).length) {
      setErrors(validation);
      return;
    }
    const intent: LostFoundPendingIntent = {
      version: 1,
      action: 'create',
      documentId,
      fields: {
        type: fields.type,
        title: fields.title.trim(),
        description: fields.description.trim(),
        category: fields.category,
        location: fields.location.trim(),
        date: fields.date,
        contactInfo: (fields.contactInfo ?? '').trim(),
      },
    };
    await submitIntent(intent);
  }

  /**
   * Retry local storage without requiring a pre-existing documentId.
   * Rediscover scoped pending/drafts first; allocate only when none exist.
   * Mid-edit retry persists CURRENT in-memory fields (does not reload older drafts over them).
   * Never auto-publishes.
   */
  function recoverStorage() {
    if (!uid) return;
    const generation = scopeGeneration.current;
    const scopeUid = uid;
    const schoolId = context.schoolId;
    const memoryFields = fields;
    const memoryDocumentId = documentId;
    const memoryPending = pending;

    try {
      const sessions = listRecoverableCreateSessions(scopeUid, schoolId);
      if (
        !mounted.current ||
        generation !== scopeGeneration.current ||
        identityRef.current.uid !== scopeUid ||
        identityRef.current.schoolId !== schoolId
      ) {
        return;
      }

      const corruptPrimary = sessions.find((session) => session.corrupt);
      if (corruptPrimary) {
        setDocumentId(corruptPrimary.documentId);
        setFields(emptyLostFoundFields());
        setPending(null);
        setSiblings(sessions.filter((session) => session.documentId !== corruptPrimary.documentId));
        setCorruptBlocked(true);
        setStorageBlocked(true);
        setStorageMessage(
          corruptPrimary.corruptionMessage ||
            '本機待確認或草稿資料已損毀，尚未對帳前請勿另開新刊登。',
        );
        setServerReceipt(undefined);
        setConfirmAction(null);
        setStatusMessage('');
        setReady(true);
        return;
      }

      // Existing in-memory draft whose last save failed: persist CURRENT fields.
      if (memoryDocumentId) {
        const storedPending =
          memoryPending ??
          sessions.find((session) => session.documentId === memoryDocumentId)?.pending ??
          null;
        if (storedPending || memoryPending) {
          const intent = memoryPending ?? storedPending;
          if (intent) {
            loadLostFoundPending(scopeFor(memoryDocumentId));
            setDocumentId(memoryDocumentId);
            setPending(intent);
            if (intent.fields) {
              setFields({
                type: intent.fields.type,
                title: intent.fields.title,
                description: intent.fields.description,
                category: intent.fields.category,
                location: intent.fields.location,
                date: intent.fields.date,
                contactInfo: intent.fields.contactInfo ?? '',
              });
            } else {
              setFields(memoryFields);
            }
            setCorruptBlocked(false);
            setStorageBlocked(false);
            setStorageMessage('');
            setStatusMessage('已重新載入待確認的刊登。');
            refreshSiblings(memoryDocumentId);
            setReady(true);
            return;
          }
        }
        rememberCreateDocumentId(scopeUid, schoolId, memoryDocumentId);
        saveLostFoundDraft(scopeFor(memoryDocumentId), {
          version: 1,
          documentId: memoryDocumentId,
          ...memoryFields,
        });
        setDocumentId(memoryDocumentId);
        setFields(memoryFields);
        setPending(null);
        setCorruptBlocked(false);
        setStorageBlocked(false);
        setStorageMessage('');
        setStatusMessage('已重新確認本機草稿儲存。');
        refreshSiblings(memoryDocumentId);
        setReady(true);
        return;
      }

      // documentId was null (initial denial): rediscover first, allocate only if none.
      if (sessions.length > 0) {
        const primary = sessions[0]!;
        setDocumentId(primary.documentId);
        setFields(primary.fields);
        setPending(primary.pending);
        setSiblings(sessions.slice(1));
        setCorruptBlocked(false);
        setStorageBlocked(false);
        setStorageMessage('');
        setStatusMessage(
          primary.pending
            ? '偵測到尚未確認的刊登，請先重試同一則，避免重複發布。'
            : '已還原先前未完成的草稿。',
        );
        setReady(true);
        return;
      }

      const id = newLostFoundItemId(schoolId);
      rememberCreateDocumentId(scopeUid, schoolId, id);
      // Verify the new stable id is actually writable before unlocking the form.
      saveLostFoundDraft(scopeFor(id), {
        version: 1,
        documentId: id,
        ...emptyLostFoundFields(),
      });
      const verified = loadLostFoundDraft(scopeFor(id));
      if (!verified || verified.documentId !== id) {
        throw new LostFoundStorageError();
      }
      if (
        !mounted.current ||
        generation !== scopeGeneration.current ||
        identityRef.current.uid !== scopeUid ||
        identityRef.current.schoolId !== schoolId
      ) {
        return;
      }
      setDocumentId(id);
      setFields(emptyLostFoundFields());
      setPending(null);
      setSiblings([]);
      setCorruptBlocked(false);
      setStorageBlocked(false);
      setStorageMessage('');
      setStatusMessage('本機儲存已恢復，可開始填寫。');
      setReady(true);
    } catch (reason) {
      if (!mounted.current || generation !== scopeGeneration.current) return;
      setStorageBlocked(true);
      setStorageMessage(
        reason instanceof LostFoundStorageError
          ? reason.message
          : '目前仍無法讀取或寫入本機草稿。',
      );
      setReady(true);
    }
  }

  async function inspectCorruptReceipt() {
    if (!uid || !documentId || !corruptBlocked || inspectBusy) return;
    const generation = scopeGeneration.current;
    const expectedUid = uid;
    const schoolId = context.schoolId;
    const id = documentId;
    setInspectBusy(true);
    setErrors({});
    setStatusMessage('正在查詢此則刊登狀態…');
    setServerReceipt(undefined);
    setConfirmAction(null);
    try {
      const item = await getLostFoundItem(id, schoolId);
      if (!mounted.current || generation !== scopeGeneration.current) return;
      if (
        identityRef.current.uid !== expectedUid ||
        identityRef.current.schoolId !== schoolId ||
        documentId !== id
      ) {
        return;
      }

      if (item && item.schoolId === schoolId && canManageLostFoundItem(item, expectedUid)) {
        setServerReceipt(item);
        setStatusMessage(
          `伺服器上已有你的刊登「${item.title}」。可選擇採用該紀錄並清除損毀的本機資料。`,
        );
      } else if (item && item.schoolId === schoolId) {
        setServerReceipt(null);
        setStatusMessage('伺服器上此編號不屬於目前帳號，請勿覆寫。請返回列表確認。');
      } else {
        setServerReceipt(null);
        setStatusMessage(
          '伺服器上尚無此則刊登。可在同一編號重建草稿；稍後若舊寫入成功，只會在同一編號發生衝突，不會另開重複。',
        );
      }
    } catch (reason) {
      if (!mounted.current || generation !== scopeGeneration.current) return;
      if (
        identityRef.current.uid !== expectedUid ||
        identityRef.current.schoolId !== schoolId
      ) {
        return;
      }
      setServerReceipt(undefined);
      setStatusMessage(
        reason instanceof LostFoundError
          ? reason.message
          : '暫時無法查詢刊登狀態，請稍後再試。本機損毀資料仍保留。',
      );
    } finally {
      if (generation === scopeGeneration.current && mounted.current) {
        setInspectBusy(false);
      }
    }
  }

  function requestAdoptServer() {
    if (!serverReceipt || !documentId) return;
    setConfirmAction('adopt-server');
  }

  function requestRebuildDraft() {
    if (!documentId) return;
    setConfirmAction('rebuild-draft');
  }

  function cancelConfirm() {
    setConfirmAction(null);
  }

  function confirmAdoptServer() {
    if (!uid || !documentId || !serverReceipt) return;
    const generation = scopeGeneration.current;
    const expectedUid = uid;
    const schoolId = context.schoolId;
    const id = documentId;
    const receipt = serverReceipt;
    if (
      !canManageLostFoundItem(receipt, expectedUid) ||
      receipt.schoolId !== schoolId ||
      receipt.id !== id
    ) {
      setErrors({ form: '伺服器紀錄與目前帳號或校園不符，已取消清除。' });
      setConfirmAction(null);
      return;
    }
    try {
      clearDamagedCreateLocalMetadata(scopeFor(id));
      forgetCreateDocumentId(expectedUid, schoolId, id);
    } catch (reason) {
      setErrors({
        form:
          reason instanceof LostFoundStorageError
            ? reason.message
            : '無法清除損毀的本機資料，請稍後再試。伺服器紀錄未改動。',
      });
      setConfirmAction(null);
      return;
    }
    if (!mounted.current || generation !== scopeGeneration.current) return;
    if (
      identityRef.current.uid !== expectedUid ||
      identityRef.current.schoolId !== schoolId
    ) {
      return;
    }
    setConfirmAction(null);
    setCorruptBlocked(false);
    setStorageBlocked(false);
    setStatusMessage('已改用伺服器紀錄，正在開啟…');
    router.replace(
      `/lost-found/${encodeURIComponent(id)}?schoolId=${encodeURIComponent(schoolId)}`,
    );
  }

  function confirmRebuildDraft() {
    if (!uid || !documentId) return;
    const generation = scopeGeneration.current;
    const expectedUid = uid;
    const schoolId = context.schoolId;
    const id = documentId;
    try {
      clearDamagedCreateLocalMetadata(scopeFor(id));
      rememberCreateDocumentId(expectedUid, schoolId, id);
      const blank = emptyLostFoundFields();
      saveLostFoundDraft(scopeFor(id), {
        version: 1,
        documentId: id,
        ...blank,
      });
    } catch (reason) {
      setErrors({
        form:
          reason instanceof LostFoundStorageError
            ? reason.message
            : '無法在同一編號重建草稿，損毀資料仍保留。',
      });
      setConfirmAction(null);
      return;
    }
    if (!mounted.current || generation !== scopeGeneration.current) return;
    if (
      identityRef.current.uid !== expectedUid ||
      identityRef.current.schoolId !== schoolId ||
      documentId !== id
    ) {
      return;
    }
    setFields(emptyLostFoundFields());
    setPending(null);
    setCorruptBlocked(false);
    setStorageBlocked(false);
    setStorageMessage('');
    setServerReceipt(undefined);
    setConfirmAction(null);
    setStatusMessage('已在同一編號重建草稿，請重新填寫後送出。');
    refreshSiblings(id);
  }

  const showWritableForm = Boolean(documentId) && !corruptBlocked;

  return (
    <SiteShell title="刊登失物招領" schoolName={context.schoolName}>
      <div className={styles.stack}>
        {authLoading ? (
          <p role="status">正在確認登入狀態…</p>
        ) : !uid ? (
          <section className={styles.panel}>
            <LoginRequiredLostFoundComments returnUrl={loginReturnUrl} />
          </section>
        ) : !ready ? (
          <p role="status">正在準備刊登表單…</p>
        ) : (
          <section className={styles.panel}>
            <h2>填寫物品資訊</h2>
            <p className={styles.scopeNote}>
              校園範圍：{context.schoolName}。請確認目前選取的校園與登入帳號後再刊登。
            </p>
            {siblings.length > 0 && !corruptBlocked ? (
              <div className={styles.notice} role="status">
                <p>
                  另有 {siblings.length} 則尚未完成或未確認的刊登草稿，可切換載入，避免遺失。
                </p>
                <div className={styles.actions}>
                  {siblings.map((session) => (
                    <Button
                      key={session.documentId}
                      type="button"
                      variant="outline"
                      disabled={busy}
                      onClick={() => switchToSession(session)}
                    >
                      {session.corrupt
                        ? '處理損毀：'
                        : session.pending
                          ? '載入未確認：'
                          : '載入草稿：'}
                      {session.fields.title.trim() || '（未命名）'}
                    </Button>
                  ))}
                </div>
              </div>
            ) : null}
            {corruptBlocked && documentId ? (
              <div className={styles.resolveBox}>
                <p className={styles.error} role="alert">
                  {storageMessage ||
                    '本機待確認資料已損毀，尚未對帳前無法開啟新的可編輯刊登，以免重複發布。'}
                </p>
                <p className={styles.muted} role="status">
                  刊登編號仍保留為同一則。請先查詢實際刊登狀態；不要當成已成功刊登。
                </p>
                {statusMessage ? (
                  <p className={styles.muted} role="status">
                    {statusMessage}
                  </p>
                ) : null}
                {serverReceipt ? (
                  <p className={styles.notice} role="status">
                    伺服器紀錄：{serverReceipt.title}
                    {serverReceipt.status ? `（${serverReceipt.status === 'open' ? '刊登中' : '已結案'}）` : ''}
                  </p>
                ) : null}
                {errors.form ? (
                  <p className={styles.error} role="alert">
                    {errors.form}
                  </p>
                ) : null}
                {confirmAction === 'adopt-server' ? (
                  <div className={styles.notice} role="alertdialog" aria-label="確認採用伺服器紀錄">
                    <p>
                      將清除此編號的損毀本機資料，並開啟伺服器上的刊登。不會自動刪除其他草稿。確定繼續？
                    </p>
                    <div className={styles.actions}>
                      <Button type="button" onClick={confirmAdoptServer}>
                        確定採用伺服器紀錄
                      </Button>
                      <Button type="button" variant="outline" onClick={cancelConfirm}>
                        取消
                      </Button>
                    </div>
                  </div>
                ) : confirmAction === 'rebuild-draft' ? (
                  <div className={styles.notice} role="alertdialog" aria-label="確認重建草稿">
                    <p>
                      將在同一刊登編號重建空白草稿，並清除損毀的本機資料。若稍後舊寫入成功，只會在同一編號發生衝突，不會另開重複。確定繼續？
                    </p>
                    <div className={styles.actions}>
                      <Button type="button" onClick={confirmRebuildDraft}>
                        確定在同一編號重建
                      </Button>
                      <Button type="button" variant="outline" onClick={cancelConfirm}>
                        取消
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className={styles.actions}>
                    <Button
                      type="button"
                      disabled={inspectBusy || busy}
                      onClick={() => void inspectCorruptReceipt()}
                    >
                      {inspectBusy ? '查詢中…' : '查詢此則刊登狀態'}
                    </Button>
                    {serverReceipt ? (
                      <Button type="button" variant="outline" disabled={busy} onClick={requestAdoptServer}>
                        採用伺服器紀錄並清除損毀資料
                      </Button>
                    ) : null}
                    {serverReceipt === null ? (
                      <Button type="button" variant="outline" disabled={busy} onClick={requestRebuildDraft}>
                        在同一編號重建草稿
                      </Button>
                    ) : null}
                    {serverReceipt === undefined ? (
                      <Button type="button" variant="outline" disabled={busy || inspectBusy} onClick={requestRebuildDraft}>
                        略過查詢，在同一編號重建草稿
                      </Button>
                    ) : null}
                  </div>
                )}
              </div>
            ) : storageBlocked ? (
              <div className={styles.resolveBox}>
                <p className={styles.error} role="alert">
                  {storageMessage || '本機草稿儲存目前無法使用。'}
                </p>
                <Button type="button" onClick={recoverStorage}>
                  重新確認本機儲存
                </Button>
              </div>
            ) : storageMessage ? (
              <p className={styles.muted} role="status">
                {storageMessage}
              </p>
            ) : null}
            {showWritableForm ? (
              <LostFoundForm
                value={fields}
                errors={errors}
                busy={busy}
                disabled={storageBlocked && !pending}
                submitLabel={pending ? '重試同一則刊登' : '送出刊登'}
                statusMessage={statusMessage}
                onChange={onFieldsChange}
                onSubmit={() => void onSubmit()}
                onCancel={() =>
                  router.push(`/lost-found?schoolId=${encodeURIComponent(context.schoolId)}`)
                }
              />
            ) : !corruptBlocked && !storageBlocked ? (
              <p className={styles.error} role="alert">
                {storageMessage || '無法建立刊登編號，請稍後再試。'}
              </p>
            ) : null}
            <p className={styles.actions}>
              <Link
                className={styles.link}
                href={`/lost-found?schoolId=${encodeURIComponent(context.schoolId)}`}
              >
                返回列表
              </Link>
            </p>
          </section>
        )}
      </div>
    </SiteShell>
  );
}

function recoverCreateSession(
  uid: string,
  schoolId: string,
): {
  documentId: string;
  fields: LostFoundWriteFields;
  pending: LostFoundPendingIntent | null;
  fromDraft: boolean;
  siblings: RecoverableCreateSession[];
  storageBlocked: boolean;
  storageMessage: string;
  corrupt: boolean;
} | null {
  try {
    const sessions = listRecoverableCreateSessions(uid, schoolId);
    if (sessions.length === 0) return null;
    const primary = sessions[0]!;
    if (primary.corrupt) {
      return {
        documentId: primary.documentId,
        fields: emptyLostFoundFields(),
        pending: null,
        fromDraft: false,
        siblings: sessions.slice(1),
        storageBlocked: true,
        storageMessage:
          primary.corruptionMessage ||
          '本機待確認資料已損毀，尚未對帳前請勿另開新刊登。',
        corrupt: true,
      };
    }
    return {
      documentId: primary.documentId,
      fields: primary.fields,
      pending: primary.pending,
      fromDraft: Boolean(primary.draft) && !primary.pending,
      siblings: sessions.slice(1),
      storageBlocked: false,
      storageMessage: '',
      corrupt: false,
    };
  } catch (reason) {
    // Do not allocate a fresh document id when storage is unreadable — avoids silent duplicates.
    return {
      documentId: '',
      fields: emptyLostFoundFields(),
      pending: null,
      fromDraft: false,
      siblings: [],
      storageBlocked: true,
      storageMessage:
        reason instanceof LostFoundStorageError
          ? reason.message
          : '草稿資料無法讀取；請勿在未確認本機儲存前重複刊登。',
      corrupt: false,
    };
  }
}
