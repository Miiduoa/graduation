'use client';

import { use, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
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
  lostFoundListHref,
  lostFoundListQuery,
  readLostFoundListState,
} from '@/lib/lostFoundListNavigation';
import type { ServiceListSearchParams } from '@/lib/serviceListNavigation';
import {
  CONTACT_VISIBILITY_NOTE,
  LostFoundConflictError,
  LostFoundError,
  LostFoundWriteUnconfirmedError,
  canManageLostFoundItem,
  categoryLabel,
  formatLostFoundCalendarDate,
  getLostFoundItem,
  isOpenLostFoundStatus,
  resolveLostFoundItem,
  statusLabel,
  toTaipeiCalendarDateInput,
  typeLabel,
  updateLostFoundItem,
  type LostFoundItem,
  type LostFoundWriteFields,
} from '@/lib/lostFound';
import {
  LostFoundStorageError,
  clearLostFoundDraft,
  clearLostFoundPending,
  fieldsEqual,
  loadLostFoundDraft,
  loadLostFoundPending,
  saveLostFoundDraft,
  saveLostFoundPending,
  type LostFoundDraftScope,
  type LostFoundPendingIntent,
} from '@/lib/lostFoundDrafts';
import { isPermissionDeniedError } from '@campus/shared/src/signedInSocialReads';

function toFormFields(item: LostFoundItem): LostFoundWriteFields {
  return {
    type: item.type,
    title: item.title,
    description: item.description,
    category: item.category,
    location: item.location,
    date: toTaipeiCalendarDateInput(item.date),
    contactInfo: item.contactInfo ?? '',
  };
}

export default function LostFoundDetailPage(props: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<ServiceListSearchParams>;
}) {
  const { id } = use(props.params);
  const search = props.searchParams ? use(props.searchParams) : undefined;
  const context = useBrowsingSchoolPageContext(search);
  const { user } = useAuth();
  if (!context.ready) {
    return (
      <SiteShell title="失物招領">
        <SchoolScopePlaceholder />
      </SiteShell>
    );
  }
  // Remount on account OR school change so stale async generations cannot commit.
  return (
    <LostFoundDetailPageContent
      key={`${user?.uid ?? 'signed-out'}:${context.schoolId}:${id}`}
      id={id}
      context={context}
      listSearch={search}
    />
  );
}

function LostFoundDetailPageContent({
  context,
  id,
  listSearch,
}: {
  context: ReturnType<typeof useBrowsingSchoolPageContext>;
  id: string;
  listSearch?: ServiceListSearchParams;
}) {
  const { user, loading: authLoading } = useAuth();
  const uid = user?.uid ?? null;
  const signedIn = Boolean(uid);
  const listHref = lostFoundListHref(context.schoolId, listSearch);
  const loginReturnUrl = `/lost-found/${encodeURIComponent(id)}?${lostFoundListQuery(context.schoolId, readLostFoundListState(listSearch), listSearch)}`;
  const [item, setItem] = useState<LostFoundItem | null | undefined>(undefined);
  const [error, setError] = useState('');
  const [loginRequired, setLoginRequired] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const [editing, setEditing] = useState(false);
  const [fields, setFields] = useState<LostFoundWriteFields | null>(null);
  /** Draft/pending base revision — never silently rebase to a newer server item.updatedAt. */
  const [baseUpdatedAt, setBaseUpdatedAt] = useState<string | null>(null);
  const [formErrors, setFormErrors] = useState<LostFoundFormErrors>({});
  const [busy, setBusy] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [confirmResolve, setConfirmResolve] = useState(false);
  const [pending, setPending] = useState<LostFoundPendingIntent | null>(null);
  const [storageBlocked, setStorageBlocked] = useState(false);
  const [storageMessage, setStorageMessage] = useState('');
  const mounted = useRef(true);
  const busyLock = useRef(false);
  const scopeGeneration = useRef(0);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    scopeGeneration.current += 1;
  }, [uid, context.schoolId, id, reloadToken]);

  useEffect(() => {
    let active = true;
    const generation = scopeGeneration.current;
    const expectedUid = uid;
    const schoolId = context.schoolId;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- identity fence before async detail load
    setError('');
    setStatusMessage('');
    setConfirmResolve(false);
    if (authLoading) {
      return () => {
        active = false;
      };
    }
    if (!signedIn || !expectedUid) {
      setItem(undefined);
      setLoginRequired(true);
      setEditing(false);
      setFields(null);
      setPending(null);
      setBaseUpdatedAt(null);
      return () => {
        active = false;
      };
    }
    setLoginRequired(false);
    setItem(undefined);
    setBusy(false);
    busyLock.current = false;
    void getLostFoundItem(id, schoolId).then(
      (next) => {
        if (!active || !mounted.current || generation !== scopeGeneration.current) return;
        setItem(next);
        if (next && canManageLostFoundItem(next, expectedUid)) {
          try {
            const scope: LostFoundDraftScope = {
              uid: expectedUid,
              schoolId,
              mode: 'edit',
              itemKey: id,
            };
            const storedPending = loadLostFoundPending(scope);
            const draft = loadLostFoundDraft(scope);
            setPending(storedPending);
            if (storedPending?.fields) {
              setFields({
                type: storedPending.fields.type,
                title: storedPending.fields.title,
                description: storedPending.fields.description,
                category: storedPending.fields.category,
                location: storedPending.fields.location,
                date: storedPending.fields.date,
                contactInfo: storedPending.fields.contactInfo ?? '',
              });
              setBaseUpdatedAt(storedPending.expectedUpdatedAt ?? null);
              setEditing(true);
              setStatusMessage('偵測到尚未確認的編輯，請先重試同一則內容。');
            } else if (draft) {
              setFields({
                type: draft.type,
                title: draft.title,
                description: draft.description,
                category: draft.category,
                location: draft.location,
                date: draft.date,
                contactInfo: draft.contactInfo ?? '',
              });
              setBaseUpdatedAt(
                draft.expectedUpdatedAt !== undefined ? (draft.expectedUpdatedAt ?? null) : null,
              );
              setEditing(true);
              setStatusMessage('已還原先前未完成的編輯草稿。');
            } else {
              setFields(toFormFields(next));
              setBaseUpdatedAt(next.updatedAt ?? null);
            }
            setStorageBlocked(false);
            setStorageMessage('');
          } catch (reason) {
            setFields(toFormFields(next));
            setBaseUpdatedAt(next.updatedAt ?? null);
            setStorageBlocked(true);
            setStorageMessage(
              reason instanceof LostFoundStorageError
                ? reason.message
                : '本機草稿無法讀取，畫面仍顯示伺服器內容。',
            );
          }
        } else {
          setEditing(false);
          setFields(null);
          setPending(null);
          setBaseUpdatedAt(null);
        }
      },
      (reason) => {
        if (!active || !mounted.current || generation !== scopeGeneration.current) return;
        if (isPermissionDeniedError(reason)) {
          setLoginRequired(true);
          return;
        }
        setError('暫時無法讀取物品，請稍後再試。');
        setItem(undefined);
      },
    );
    return () => {
      active = false;
    };
  }, [authLoading, context.schoolId, id, reloadToken, signedIn, uid]);

  function editScope(): LostFoundDraftScope {
    if (!uid) throw new LostFoundError('請先登入後再操作。');
    return { uid, schoolId: context.schoolId, mode: 'edit', itemKey: id };
  }

  function onFieldsChange(next: LostFoundWriteFields) {
    if (!item || !uid || !canManageLostFoundItem(item, uid)) return;
    if (pending?.fields && !fieldsEqual(pending.fields, next)) {
      setFormErrors({
        form: '尚有未確認的編輯結果。請先重試同一則內容，勿覆蓋成不同內容。',
      });
      setFields({
        type: pending.fields.type,
        title: pending.fields.title,
        description: pending.fields.description,
        category: pending.fields.category,
        location: pending.fields.location,
        date: pending.fields.date,
        contactInfo: pending.fields.contactInfo ?? '',
      });
      return;
    }
    setFields(next);
    setFormErrors({});
    try {
      saveLostFoundDraft(editScope(), {
        version: 1,
        documentId: id,
        expectedUpdatedAt: baseUpdatedAt,
        ...next,
      });
      setStorageBlocked(false);
      setStorageMessage('');
    } catch (reason) {
      setStorageBlocked(true);
      setStorageMessage(
        reason instanceof LostFoundStorageError
          ? reason.message
          : '目前無法保存編輯草稿，畫面內容仍保留。',
      );
    }
  }

  function adoptServerRevision() {
    if (!item) return;
    setFields(toFormFields(item));
    setBaseUpdatedAt(item.updatedAt ?? null);
    setPending(null);
    setFormErrors({});
    setStatusMessage('已改用伺服器最新內容。');
    try {
      clearLostFoundPending(editScope());
      clearLostFoundDraft(editScope());
      setStorageBlocked(false);
      setStorageMessage('');
    } catch (reason) {
      setStorageBlocked(true);
      setStorageMessage(
        reason instanceof LostFoundStorageError
          ? reason.message
          : '無法清除本機草稿，但畫面已改為最新內容。',
      );
    }
  }

  async function runPending(intent: LostFoundPendingIntent) {
    if (!uid || !item || busyLock.current) return;
    const generation = scopeGeneration.current;
    busyLock.current = true;
    setBusy(true);
    setFormErrors({});
    setStatusMessage(intent.action === 'resolve' ? '正在結案…' : '正在儲存編輯…');
    try {
      saveLostFoundPending(editScope(), intent);
      setPending(intent);
      let receipt: LostFoundItem;
      if (intent.action === 'resolve') {
        receipt = await resolveLostFoundItem(id, context.schoolId, intent.expectedUpdatedAt);
      } else {
        receipt = await updateLostFoundItem(
          id,
          context.schoolId,
          intent.expectedUpdatedAt,
          intent.fields!,
        );
      }
      if (!mounted.current || generation !== scopeGeneration.current) return;
      try {
        clearLostFoundPending(editScope());
        clearLostFoundDraft(editScope());
      } catch {
        // Server receipt already confirmed.
      }
      setPending(null);
      setItem(receipt);
      setFields(toFormFields(receipt));
      setBaseUpdatedAt(receipt.updatedAt ?? null);
      setEditing(intent.action === 'edit' ? false : editing);
      setConfirmResolve(false);
      setStatusMessage(intent.action === 'resolve' ? '已確認結案。' : '已儲存更新。');
    } catch (reason) {
      if (!mounted.current || generation !== scopeGeneration.current) return;
      if (reason instanceof LostFoundStorageError) {
        setStorageBlocked(true);
        setStorageMessage(reason.message);
        setFormErrors({ form: reason.message });
        return;
      }
      if (reason instanceof LostFoundConflictError) {
        setFormErrors({ form: reason.message });
        setStatusMessage('伺服器內容已不同。請比對本機草稿與最新內容後再決定。');
        return;
      }
      if (reason instanceof LostFoundWriteUnconfirmedError) {
        setPending(intent);
        setFormErrors({ form: reason.message });
        setStatusMessage('結果未確認。請重試同一則操作，勿另開新操作。');
        return;
      }
      setFormErrors({
        form: reason instanceof LostFoundError ? reason.message : '暫時無法完成操作，請稍後再試。',
      });
    } finally {
      // Only the active generation may clear the lock; remount/reload resets it explicitly.
      if (generation === scopeGeneration.current) {
        busyLock.current = false;
        if (mounted.current) setBusy(false);
      }
    }
  }

  async function onSaveEdit() {
    if (!item || !fields || !uid || !canManageLostFoundItem(item, uid)) return;
    if (pending) {
      await runPending(pending);
      return;
    }
    const validation = validateLostFoundForm(fields);
    if (Object.keys(validation).length) {
      setFormErrors(validation);
      return;
    }
    await runPending({
      version: 1,
      action: 'edit',
      documentId: id,
      expectedUpdatedAt: baseUpdatedAt,
      fields: {
        type: fields.type,
        title: fields.title.trim(),
        description: fields.description.trim(),
        category: fields.category,
        location: fields.location.trim(),
        date: fields.date,
        // Explicit empty string clears contact; do not coerce to undefined (omission).
        contactInfo: (fields.contactInfo ?? '').trim(),
      },
    });
  }

  async function onConfirmResolve() {
    if (!item || !uid || !canManageLostFoundItem(item, uid)) return;
    if (pending) {
      if (pending.action === 'resolve') {
        await runPending(pending);
        return;
      }
      setFormErrors({ form: '尚有未確認的編輯，請先重試或確認後再結案。' });
      return;
    }
    await runPending({
      version: 1,
      action: 'resolve',
      documentId: id,
      expectedUpdatedAt: baseUpdatedAt ?? item.updatedAt ?? null,
    });
  }

  const canManage = item ? canManageLostFoundItem(item, uid) : false;
  const legacyReadOnly = Boolean(item && !item.userId && item.reporterId);
  const revisionStale =
    Boolean(editing && item && fields) && (baseUpdatedAt ?? null) !== (item?.updatedAt ?? null);

  return (
    <SiteShell title="失物招領" schoolName={context.schoolName}>
      <div className={styles.stack}>
        {authLoading ? (
          <p role="status">正在確認登入狀態…</p>
        ) : loginRequired || !signedIn ? (
          <section className={styles.panel}>
            <LoginRequiredLostFoundComments returnUrl={loginReturnUrl} />
          </section>
        ) : error ? (
          <section className={styles.panel}>
            <p className={styles.error} role="alert">
              {error}
            </p>
            <div className={styles.actions}>
              <Button
                type="button"
                variant="primary"
                onClick={() => {
                  setError('');
                  setReloadToken((value) => value + 1);
                }}
              >
                再試一次
              </Button>
            </div>
          </section>
        ) : item === undefined ? (
          <p role="status">正在讀取物品…</p>
        ) : item === null ? (
          <section className={styles.panel}>
            <p>找不到物品</p>
            <p className={styles.actions}>
              <Link className="btn" href={listHref}>
                返回列表
              </Link>
            </p>
          </section>
        ) : (
          <article className={styles.panel}>
            <div className={styles.itemMeta}>
              <span className={styles.badge}>{typeLabel(item.type)}</span>
              <span className={styles.badge}>{categoryLabel(item.category)}</span>
              <span className={styles.badge}>{statusLabel(item.status)}</span>
              {!item.canonical ? <span className={styles.badge}>舊版紀錄</span> : null}
            </div>
            <h2>{item.title}</h2>
            <p className={styles.muted}>
              {item.location}
              {item.date ? ` · ${formatLostFoundCalendarDate(item.date)}` : ''}
            </p>
            <p>{item.description}</p>
            {item.contactInfo ? (
              <p>
                聯絡方式：{item.contactInfo}
                <span className={styles.muted}>（{CONTACT_VISIBILITY_NOTE}）</span>
              </p>
            ) : (
              <p className={styles.muted}>未提供聯絡方式</p>
            )}
            {item.imageUrl ? <p className={styles.muted}>此則含既有圖片連結。</p> : null}

            {legacyReadOnly ? (
              <p className={styles.notice} role="status">
                這則為尚未完整遷移的舊版紀錄，目前僅供檢視，無法在此編輯或結案。
              </p>
            ) : null}

            {storageBlocked ? (
              <div className={styles.resolveBox}>
                <p className={styles.error} role="alert">
                  {storageMessage}
                </p>
                <Button
                  type="button"
                  onClick={() => {
                    try {
                      const storedPending = loadLostFoundPending(editScope());
                      const draft = loadLostFoundDraft(editScope());
                      setPending(storedPending);
                      if (storedPending?.fields) {
                        setFields({
                          type: storedPending.fields.type,
                          title: storedPending.fields.title,
                          description: storedPending.fields.description,
                          category: storedPending.fields.category,
                          location: storedPending.fields.location,
                          date: storedPending.fields.date,
                          contactInfo: storedPending.fields.contactInfo ?? '',
                        });
                        setBaseUpdatedAt(storedPending.expectedUpdatedAt ?? null);
                      } else if (draft) {
                        setFields({
                          type: draft.type,
                          title: draft.title,
                          description: draft.description,
                          category: draft.category,
                          location: draft.location,
                          date: draft.date,
                          contactInfo: draft.contactInfo ?? '',
                        });
                        setBaseUpdatedAt(
                          draft.expectedUpdatedAt !== undefined
                            ? (draft.expectedUpdatedAt ?? null)
                            : null,
                        );
                      }
                      setStorageBlocked(false);
                      setStorageMessage('');
                    } catch (reason) {
                      setStorageMessage(
                        reason instanceof LostFoundStorageError
                          ? reason.message
                          : '仍無法讀取本機草稿。',
                      );
                    }
                  }}
                >
                  重新確認本機儲存
                </Button>
              </div>
            ) : null}

            {canManage && editing && fields ? (
              <div className={styles.resolveBox}>
                <h2>編輯刊登</h2>
                {revisionStale ? (
                  <div className={styles.notice} role="status">
                    <p>
                      伺服器上的內容已更新，你目前編輯的是較早版本的草稿。本機內容會保留；若直接儲存而伺服器已不同，會提示衝突。也可放棄草稿、改載入最新內容。
                    </p>
                    <div className={styles.actions}>
                      <Button
                        type="button"
                        variant="outline"
                        disabled={busy}
                        onClick={adoptServerRevision}
                      >
                        改用最新內容
                      </Button>
                    </div>
                  </div>
                ) : null}
                <LostFoundForm
                  value={fields}
                  errors={formErrors}
                  busy={busy}
                  disabled={storageBlocked && !pending}
                  submitLabel={pending?.action === 'edit' ? '重試同一則更新' : '儲存更新'}
                  statusMessage={statusMessage}
                  onChange={onFieldsChange}
                  onSubmit={() => void onSaveEdit()}
                  onCancel={() => {
                    if (pending) {
                      setFormErrors({
                        form: '尚有未確認的操作，請先重試，勿直接放棄後另開。',
                      });
                      return;
                    }
                    setEditing(false);
                    setFields(toFormFields(item));
                    setBaseUpdatedAt(item.updatedAt ?? null);
                    setFormErrors({});
                    setStatusMessage('');
                    try {
                      clearLostFoundDraft(editScope());
                    } catch {
                      // keep in-memory fields
                    }
                  }}
                />
              </div>
            ) : null}

            {canManage && !editing ? (
              <div className={styles.resolveBox}>
                {statusMessage ? (
                  <p className={styles.success} role="status">
                    {statusMessage}
                  </p>
                ) : null}
                {formErrors.form ? (
                  <p className={styles.error} role="alert">
                    {formErrors.form}
                  </p>
                ) : null}
                <div className={styles.actions}>
                  {isOpenLostFoundStatus(item.status) ? (
                    <Button
                      type="button"
                      variant="outline"
                      disabled={busy}
                      onClick={() => {
                        setEditing(true);
                        setFields(fields ?? toFormFields(item));
                        setBaseUpdatedAt(baseUpdatedAt ?? item.updatedAt ?? null);
                        setConfirmResolve(false);
                      }}
                    >
                      編輯
                    </Button>
                  ) : null}
                  {isOpenLostFoundStatus(item.status) ? (
                    <Button
                      type="button"
                      variant="primary"
                      disabled={busy}
                      onClick={() => setConfirmResolve(true)}
                    >
                      標示已結案
                    </Button>
                  ) : null}
                  {pending?.action === 'resolve' ? (
                    <Button
                      type="button"
                      variant="primary"
                      loading={busy}
                      onClick={() => void onConfirmResolve()}
                    >
                      重試結案確認
                    </Button>
                  ) : null}
                </div>
                {confirmResolve ? (
                  <div className={styles.notice}>
                    <p>
                      確認將「{item.title}
                      」標示為已結案？結案後一般使用者仍可查看紀錄，但不可再編輯。
                    </p>
                    <div className={styles.actions}>
                      <Button
                        type="button"
                        variant="primary"
                        loading={busy}
                        onClick={() => void onConfirmResolve()}
                      >
                        確認結案
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        disabled={busy}
                        onClick={() => setConfirmResolve(false)}
                      >
                        取消
                      </Button>
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}

            <p className={styles.actions}>
              <Link className="btn" href={listHref}>
                返回列表
              </Link>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setReloadToken((value) => value + 1)}
              >
                重新讀取
              </Button>
            </p>
          </article>
        )}
      </div>
    </SiteShell>
  );
}
