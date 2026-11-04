'use client';

/**
 * 校園社群 — 看板（Web）
 *
 * 對應 mobile/BoardsScreen.tsx：
 *  - 依類型分組（系所/課程/主題/匿名）
 *  - 訂閱 toggle（不必進詳情）
 *  - 建立看板 Modal
 */

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { Modal } from '@/components/ui/Modal';
import { useBoardCreationAccess } from './useBoardCreationAccess';
import { BoardCreationStatus } from './BoardCreationStatus';
import { CommunityLoadError, useCommunityLoad } from './useCommunityLoad';
import { useAuth } from '@/components/AuthGuard';
import {
  listBoards,
  listSubscribedBoardIds,
  subscribeToBoard,
  unsubscribeFromBoard,
  groupBoardsByType,
  createBoard,
  CAMPUS_BOARD_TYPE_LABEL,
  type CampusBoard,
  type CampusBoardType,
} from '@/lib/community/firestore';

type CreationFailure = 'permission' | 'unconfirmed';

function focusRecoveryControl(area: HTMLElement) {
  const target = area.querySelector<HTMLButtonElement>('button:not(:disabled)') ?? area;
  target.focus({ preventScroll: true });
  target.scrollIntoView?.({ block: 'center', behavior: 'auto' });
}

const TYPE_ICON: Record<CampusBoardType, string> = {
  department: '🏛',
  course: '📘',
  topic: '🏷',
  anon: '🫥',
};

export function BoardsTab(props: { schoolId: string; schoolSearch: string }) {
  const { user, loading } = useAuth();
  const access = useBoardCreationAccess(props.schoolId);
  return <BoardsContent key={JSON.stringify([user?.uid, loading, props.schoolId])} {...props} access={access} />;
}

function BoardsContent(props: {
  schoolId: string;
  schoolSearch: string;
  access: ReturnType<typeof useBoardCreationAccess>;
}) {
  const { schoolId, access } = props;
  const { user } = useAuth();
  const [boards, setBoards] = useState<CampusBoard[]>([]);
  const [subscribed, setSubscribed] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState('');
  const [composeEpoch, setComposeEpoch] = useState<number | null>(null);
  const [notice, setNotice] = useState('');
  const [createPending, setCreatePending] = useState(false);
  const [closedPending, setClosedPending] = useState(false);
  const [recovery, setRecovery] = useState<CreationFailure | null>(null);
  const [permissionRetryEpoch, setPermissionRetryEpoch] = useState<number | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [focusRecovery, setFocusRecovery] = useState(0);
  const focusedRecovery = useRef(0);
  const recoveryArea = useRef<HTMLElement>(null);
  const recoveryReadError = useRef<HTMLDivElement>(null);
  const reviewLock = useRef(false);
  const createPendingRef = useRef(false);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const load = useCallback(async () => {
    if (!schoolId) {
      setBoards([]);
      setSubscribed(new Set());
      return;
    }
    const [rows, subs] = await Promise.all([
      listBoards(schoolId, 120),
      user?.uid ? listSubscribedBoardIds(user.uid, schoolId) : Promise.resolve([] as string[]),
    ]);
    setBoards(rows);
    setSubscribed(new Set(subs));
  }, [schoolId, user]);

  const { loading, error, refresh } = useCommunityLoad(
    load,
    '暫時無法讀取看板，請確認連線後重試。',
  );

  const permissionRetryFinished = permissionRetryEpoch !== null
    && access.authorizationEpoch !== permissionRetryEpoch
    && (access.status === 'allowed' || access.status === 'denied');
  const permissionRechecked = recovery === 'permission' && permissionRetryFinished && access.status === 'allowed';
  const needsRecovery = recovery !== null && !permissionRechecked;
  const creationBlocked = createPending || closedPending || needsRecovery || reviewing || loading || !!error;
  const composeVisible = access.status === 'allowed' && composeEpoch === access.authorizationEpoch && !!user;

  useEffect(() => {
    if (!focusRecovery || focusedRecovery.current === focusRecovery || composeVisible) return;
    const area = recoveryArea.current;
    if (!area) return;
    focusRecoveryControl(area);
    focusedRecovery.current = focusRecovery;
  }, [focusRecovery, composeVisible]);

  useEffect(() => {
    if (permissionRetryEpoch === null || access.status === 'loading' || composeVisible) return;
    const area = recoveryArea.current;
    if (area?.contains(area.ownerDocument.activeElement)) focusRecoveryControl(area);
  }, [permissionRetryEpoch, access.status, access.authorizationEpoch, composeVisible]);

  function keepRecoveryFocus() {
    const area = recoveryArea.current;
    const focused = area?.ownerDocument.activeElement;
    if (focused && (area?.contains(focused) || recoveryReadError.current?.contains(focused))) {
      setFocusRecovery((current) => current + 1);
    }
  }

  function retryPermission() {
    keepRecoveryFocus();
    setPermissionRetryEpoch(access.authorizationEpoch);
    access.retry();
  }

  async function reviewBoards(confirmResult = true) {
    // 未確認結果的恢復流程仍避開與寫入重疊；關閉待決的重讀可進行，但寫入期間發起的重讀不解除阻擋
    if (reviewLock.current || (confirmResult && createPendingRef.current)) return;
    keepRecoveryFocus();
    reviewLock.current = true;
    setReviewing(true);
    const authorized = access.isAuthorized;
    const reloadDuringCreate = !confirmResult && createPendingRef.current;
    try {
      const loaded = await refresh();
      // 寫入期間發起的重讀（或完成時寫入仍在進行）清單可能仍舊：保留 closedPending，須寫入結束後再重讀才解除
      if (mounted.current && loaded && authorized() && !createPendingRef.current && !reloadDuringCreate) {
        // 關閉待決寫入後，必須重讀成功才解除建立阻擋，避免晚到成功後尚未確認清單又再建一筆
        setClosedPending(false);
        if (confirmResult) {
          setRecovery((current) => current === 'unconfirmed' ? null : current);
          setNotice('已重新讀取清單。請先檢查是否已有剛才的看板，再決定是否建立。');
        }
      }
    } finally {
      reviewLock.current = false;
      if (mounted.current) {
        if (authorized()) keepRecoveryFocus();
        setReviewing(false);
      }
    }
  }

  const q = filter.trim().toLowerCase();
  const filtered = useMemo(
    () =>
      q
        ? boards.filter((b) =>
            `${b.name} ${b.slug ?? ''} ${b.rules ?? ''}`.toLowerCase().includes(q),
          )
        : boards,
    [boards, q],
  );

  const grouped = useMemo(() => groupBoardsByType(filtered), [filtered]);

  const onToggleSub = async (b: CampusBoard) => {
    if (!user?.uid || !schoolId) {
      alert('請先登入');
      return;
    }
    const wasSub = subscribed.has(b.id);
    setSubscribed((prev) => {
      const next = new Set(prev);
      if (wasSub) next.delete(b.id);
      else next.add(b.id);
      return next;
    });
    try {
      if (wasSub) await unsubscribeFromBoard(user.uid, schoolId, b.id);
      else await subscribeToBoard(user.uid, schoolId, b.id);
    } catch {
      alert('這次未能訂閱，請稍後再試。');
      setSubscribed((prev) => {
        const next = new Set(prev);
        if (wasSub) next.add(b.id);
        else next.delete(b.id);
        return next;
      });
    }
  };

  return (
    <div>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 8,
          marginBottom: 14,
          alignItems: 'center',
        }}
      >
        <input
          type="search"
          className="input"
          placeholder="搜尋看板"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          style={{ flex: '1 1 160px', minWidth: 0, maxWidth: 420 }}
        />
        {access.status === 'allowed' && (
          <button
            type="button"
            className="btn primary"
            disabled={creationBlocked}
            onClick={() => {
              if (!creationBlocked && access.isAuthorized()) {
                setNotice('');
                setClosedPending(false);
                setRecovery(null);
                setPermissionRetryEpoch(null);
                setComposeEpoch(access.authorizationEpoch);
              }
            }}
            style={{ fontSize: 13, padding: '8px 16px' }}
          >
            ＋ 建立看板
          </button>
        )}
      </div>

      <section ref={recoveryArea} tabIndex={-1} aria-label="看板建立狀態"
        hidden={!notice && !closedPending && !needsRecovery && !permissionRetryFinished && access.status !== 'loading' && access.status !== 'error'}>
      <BoardCreationStatus access={{ ...access, retry: retryPermission }} />
      {notice && <p role="status">{notice}</p>}
      {permissionRetryFinished && <p role="status">{access.status === 'allowed'
        ? '已重新確認管理權限，可以繼續建立看板。'
        : '你目前沒有這所學校的看板管理權限。'}</p>}
      {closedPending && !needsRecovery && <button type="button" className="btn" disabled={loading || reviewing} onClick={() => void reviewBoards(false)}>重新讀取看板</button>}
      {needsRecovery && !composeVisible && access.status === 'allowed' && (
        <div>
          <p role="alert">{recovery === 'permission'
            ? '這次建立未獲允許，請重新確認這所學校的管理權限。'
            : '尚未確認是否建立。請重新讀取並檢視看板清單，再決定下一步。'}</p>
          <button type="button" className="btn" disabled={reviewing || createPending}
            onClick={() => recovery === 'permission' ? retryPermission() : void reviewBoards()}>
            {recovery === 'permission' ? '重新確認權限' : reviewing ? '正在讀取看板…' : '重新讀取並檢視清單'}
          </button>
        </div>
      )}

      </section>

      {error ? (
        <div ref={recoveryReadError}>
          <CommunityLoadError message={error} retry={recovery === 'unconfirmed' ? reviewBoards : closedPending ? () => reviewBoards(false) : refresh} />
        </div>
      ) : loading ? (
        <div className="card" style={{ padding: 24, textAlign: 'center', color: 'var(--muted)' }}>
          載入中…
        </div>
      ) : boards.length === 0 ? (
        <div className="card" style={{ padding: 32, textAlign: 'center', color: 'var(--muted)' }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>🗂</div>
          <div style={{ fontWeight: 700, color: 'var(--text)' }}>尚無任何看板</div>
          <div style={{ marginTop: 6, fontSize: 12 }}>
            {access.status === 'allowed'
              ? '建立看板，開始一個校園話題。'
              : '看板由學校管理者建立，開放後就能在這裡參與討論。'}
          </div>
          {access.status !== 'allowed' && <p><Link className="btn" href={`/community?schoolId=${encodeURIComponent(schoolId)}`}>看校園動態</Link></p>}
        </div>
      ) : (
        (['department', 'course', 'topic', 'anon'] as CampusBoardType[]).map((t) => {
          const arr = grouped[t];
          if (!arr || arr.length === 0) return null;
          return (
            <section key={t} style={{ marginBottom: 24 }}>
              <h3
                style={{
                  margin: '4px 0 10px',
                  fontSize: 12,
                  letterSpacing: 0.6,
                  color: 'var(--muted)',
                  fontWeight: 700,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                <span>{TYPE_ICON[t]}</span>
                {CAMPUS_BOARD_TYPE_LABEL[t]}
              </h3>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill,minmax(min(100%, 280px),1fr))',
                  gap: 10,
                }}
              >
                {arr.map((b) => {
                  const isSub = subscribed.has(b.id);
                  return (
                    <div
                      key={b.id}
                      className="card"
                      style={{ padding: 14, display: 'flex', gap: 12, alignItems: 'center' }}
                    >
                      <div
                        style={{
                          width: 48,
                          height: 48,
                          borderRadius: 8,
                          background: 'var(--panel2)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: 22,
                          flexShrink: 0,
                        }}
                      >
                        {TYPE_ICON[(b.type ?? 'topic') as CampusBoardType]}
                      </div>
                      <Link
                        href={`/community/board/${b.id}?schoolId=${encodeURIComponent(schoolId)}`}
                        style={{
                          flex: 1,
                          minWidth: 0,
                          color: 'var(--text)',
                          textDecoration: 'none',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ fontSize: 14, fontWeight: 700 }}>{b.name}</span>
                          {b.defaultAnonymous && (
                            <span
                              style={{
                                fontSize: 10,
                                color: 'var(--muted)',
                                background: 'var(--panel2)',
                                padding: '1px 6px',
                                borderRadius: 999,
                                border: '1px solid var(--border)',
                              }}
                            >
                              匿名
                            </span>
                          )}
                        </div>
                        {b.rules ? (
                          <div
                            style={{
                              fontSize: 12,
                              color: 'var(--muted)',
                              marginTop: 4,
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              display: '-webkit-box',
                              WebkitLineClamp: 2,
                              WebkitBoxOrient: 'vertical',
                              lineHeight: 1.4,
                            }}
                          >
                            {b.rules}
                          </div>
                        ) : (
                          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
                            {CAMPUS_BOARD_TYPE_LABEL[(b.type ?? 'topic') as CampusBoardType]}板
                          </div>
                        )}
                      </Link>
                      <button
                        type="button"
                        onClick={() => onToggleSub(b)}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 4,
                          padding: '6px 10px',
                          borderRadius: 999,
                          border: '1px solid var(--brand)',
                          background: isSub ? 'var(--brand)' : 'transparent',
                          color: isSub ? 'var(--on-brand)' : 'var(--brand)',
                          fontSize: 11,
                          fontWeight: 700,
                          cursor: 'pointer',
                          flexShrink: 0,
                        }}
                      >
                        {isSub ? '🔔 已訂閱' : '訂閱'}
                      </button>
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })
      )}

      {composeVisible && user && (
        <CreateBoardModal
          key={composeEpoch}
          schoolId={schoolId}
          uid={user.uid}
          isAuthorized={access.isAuthorized}
          onPendingChange={(pending) => {
            createPendingRef.current = pending;
            if (mounted.current) setCreatePending(pending);
          }}
          onFailure={(kind) => {
            if (!mounted.current) return;
            keepRecoveryFocus();
            setRecovery(kind);
            setPermissionRetryEpoch(null);
            setClosedPending(false);
            setNotice('');
          }}
          onClose={(pending) => {
            setComposeEpoch(null);
            if (pending || recovery) setFocusRecovery((current) => current + 1);
            if (pending) {
              setClosedPending(true);
              setNotice('已關閉視窗，沒有撤回建立要求。請重新讀取看板確認結果。');
            }
          }}
          onRecover={(permissionDenied) => {
            setComposeEpoch(null);
            setFocusRecovery((current) => current + 1);
            if (permissionDenied) retryPermission();
            else void reviewBoards();
          }}
          onCreated={(name) => {
            if (!access.isAuthorized()) return;
            setComposeEpoch(null);
            setNotice(`已建立「${name}」看板。`);
            setFocusRecovery((current) => current + 1);
            void refresh();
          }}
          onClosedSuccess={() => {
            if (!mounted.current || !access.isAuthorized()) return;
            // Modal 已關時晚到成功：重新設回待確認並重讀清單（不經 reviewBoards，以免在確認前解鎖）
            setClosedPending(true);
            setNotice('已關閉視窗，沒有撤回建立要求。請重新讀取看板確認結果。');
            setFocusRecovery((current) => current + 1);
            void refresh();
          }}
        />
      )}
    </div>
  );
}

function CreateBoardModal(props: {
  schoolId: string;
  uid: string;
  isAuthorized: () => boolean;
  onClose: (pending: boolean) => void;
  onPendingChange: (pending: boolean) => void;
  onFailure: (kind: CreationFailure) => void;
  onCreated: (name: string) => void;
  onClosedSuccess: () => void;
  onRecover: (permissionDenied: boolean) => void;
}) {
  const [name, setName] = useState('');
  const [type, setType] = useState<CampusBoardType>('topic');
  const [rules, setRules] = useState('');
  const [anon, setAnon] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<CreationFailure | null>(null);
  const [validation, setValidation] = useState('');
  const inFlight = useRef(false);
  const active = useRef(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const id = useId();

  useEffect(() => {
    active.current = true;
    return () => { active.current = false; };
  }, []);

  function requestClose() {
    props.onClose(inFlight.current);
  }

  const submit = async () => {
    if (inFlight.current || failure || !active.current || !props.isAuthorized()) return;
    const boardName = name.trim();
    if (boardName.length < 2) {
      setValidation('看板名稱至少 2 個字。');
      nameRef.current?.focus();
      return;
    }
    inFlight.current = true;
    props.onPendingChange(true);
    setBusy(true);
    setValidation('');
    let created = false;
    try {
      await createBoard({
        schoolId: props.schoolId,
        name: boardName,
        type,
        rules: rules.trim(),
        defaultAnonymous: anon,
        createdBy: props.uid,
      });
      created = true;
      if (active.current && props.isAuthorized()) props.onCreated(boardName);
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error ? error.code : null;
      const kind = code === 'permission-denied' || code === 'firestore/permission-denied' ? 'permission' : 'unconfirmed';
      props.onFailure(kind);
      if (active.current && props.isAuthorized()) setFailure(kind);
    } finally {
      inFlight.current = false;
      props.onPendingChange(false);
      // 先清 createPending，再回報關閉後的晚到成功，才能接著觸發清單重讀
      if (created && !active.current && props.isAuthorized()) props.onClosedSuccess();
      if (active.current && props.isAuthorized()) setBusy(false);
    }
  };

  return (
    <Modal
      isOpen
      title="建立看板"
      onClose={requestClose}
      initialFocusRef={nameRef}
      footer={failure ? (
        <button type="button" className="btn primary" onClick={() => props.onRecover(failure === 'permission')}>
          {failure === 'permission' ? '重新確認權限' : '回看板清單確認'}
        </button>
      ) : (
        <>
          <button type="button" className="btn" onClick={requestClose}>{busy ? '關閉視窗' : '取消'}</button>
          <button type="button" className="btn primary" disabled={busy} onClick={() => void submit()}>
            {busy ? '建立中…' : '建立'}
          </button>
        </>
      )}
    >
      <label htmlFor={`${id}-name`} style={{ display: 'block', fontWeight: 700, marginBottom: 6 }}>看板名稱</label>
      <input
        ref={nameRef}
        id={`${id}-name`}
        className="input"
        value={name}
        disabled={busy || !!failure}
        onChange={(e) => setName(e.target.value)}
        placeholder="例：資工系 / 程式甘苦談 / 校隊招新"
        maxLength={32}
        style={{ width: '100%', boxSizing: 'border-box' }}
      />
      <fieldset disabled={busy || !!failure} style={{ border: 0, padding: 0, margin: '16px 0' }}>
        <legend style={{ fontWeight: 700, marginBottom: 6 }}>類型</legend>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {(['department', 'course', 'topic', 'anon'] as CampusBoardType[]).map((kind) => (
            <button
              key={kind}
              type="button"
              className="btn"
              aria-pressed={type === kind}
              onClick={() => { setType(kind); setAnon(kind === 'anon'); }}
            >
              {TYPE_ICON[kind]} {CAMPUS_BOARD_TYPE_LABEL[kind]}
            </button>
          ))}
        </div>
      </fieldset>
      <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 16 }}>
        <input type="checkbox" checked={anon} disabled={busy || !!failure} onChange={(e) => setAnon(e.target.checked)} />
        預設匿名發文
      </label>
      <label htmlFor={`${id}-rules`} style={{ display: 'block', fontWeight: 700, marginBottom: 6 }}>看板規則（選填）</label>
      <textarea
        id={`${id}-rules`}
        className="input"
        value={rules}
        disabled={busy || !!failure}
        onChange={(e) => setRules(e.target.value)}
        rows={4}
        maxLength={400}
        placeholder="例：請以友善與尊重為原則，請勿張貼商業廣告。"
        style={{ width: '100%', boxSizing: 'border-box', resize: 'vertical', fontFamily: 'inherit' }}
      />
      {busy && <p role="status">正在建立看板，請勿重複送出。關閉視窗不會撤回建立要求。</p>}
      {validation && <p role="alert">{validation}</p>}
      {failure && <p role="alert">{failure === 'permission'
        ? '這次建立未獲允許，請重新確認這所學校的管理權限。'
        : '尚未確認是否建立。請回到看板清單重新讀取，確認結果後再操作。'}</p>}
    </Modal>
  );
}
