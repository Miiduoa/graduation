'use client';

import Link from 'next/link';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { ConfirmModal } from '@/components/ui/Modal';
import {
  campusEventIntentsStorageKey,
  finalizeCampusEventIntent,
  prepareCampusEventIntent,
  readPendingCampusEventIntent,
  submitCampusEventIntent,
  type CampusEventRegistrationIntent,
} from '@/lib/campusEventIntents';
import {
  campusEventRegistrationCallableSupported,
  loadEventRegistrationStates,
  type EventRegistrationState,
} from '@/lib/campusEventRegistration';
import type { CampusEvent } from '@/lib/campusEvents';
import { useSignInOptions } from '@/lib/signInOptions';
import {
  buildCampusEventLoginHref,
  campusEventAvailabilityCopy,
  campusEventRegistrationCountLabel,
  campusEventSourceLabel,
  formatCampusEventDateTime,
  userFacingCampusEventError,
} from './eventPresentation';
import {
  schoolEventMembershipCurrent,
  useSchoolEventMembership,
  type SchoolEventMembership,
} from './useSchoolEventMembership';
import styles from './events.module.css';

type RegistrationView =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; state: EventRegistrationState }
  | { status: 'error'; message: string }
  | { status: 'informational' };

type MutationView =
  | { status: 'reading' }
  | { status: 'idle' }
  | { status: 'pending'; intent: CampusEventRegistrationIntent }
  | { status: 'submitting'; intent: CampusEventRegistrationIntent }
  | { status: 'unknown'; intent: CampusEventRegistrationIntent; message: string }
  | { status: 'blocked'; message: string }
  | { status: 'read-error'; message: string }
  | { status: 'done'; message: string; state: EventRegistrationState };

type CancelConfirmation = {
  uid: string;
  schoolId: string;
  eventId: string;
  action: 'cancel';
  title: string;
};

/** Login school form currently supports Providence (`pu`) only when studentId is enabled. */
const PROVIDENCE_SCHOOL_ID = 'pu';

function GuestRegistrationNotice({
  returnPath,
  selectedSchoolId,
}: {
  returnPath: string;
  selectedSchoolId: string;
}) {
  const options = useSignInOptions();
  const loginHref = buildCampusEventLoginHref(returnPath);

  if (options.loading) {
    return (
      <p className={styles.notice} role="status">
        正在確認學校登入方式…
      </p>
    );
  }
  if (options.error) {
    return (
      <section className={styles.panel} role="alert">
        <h3>暫時無法確認學校登入方式</h3>
        <p>還沒取得登入服務回應，還不能判斷這所學校能否報名。</p>
        <button type="button" className="btn" onClick={options.retry}>
          重新確認
        </button>
        <p className={styles.notice}>返回目標仍會保留：可稍後再回到這個活動頁。</p>
        <Link className="btn" href={loginHref}>
          保留此頁並前往登入說明
        </Link>
      </section>
    );
  }

  if (!options.studentId) {
    if (!options.google) {
      return (
        <section className={styles.panel} role="status">
          <h3>目前無法新辦學校活動報名資格</h3>
          <p>
            這所學校目前沒有開放可用的學校帳號登入方式，因此無法透過本頁取得新的報名資格。若你先前已完成學校資格驗證且伺服器仍確認有效，仍可在支援的活動使用報名。
          </p>
          <Link className="btn" href={loginHref}>
            保留此活動頁並查看登入說明
          </Link>
        </section>
      );
    }
    return (
      <section className={styles.panel} role="status">
        <h3>目前無法用 Google 取得學校活動報名資格</h3>
        <p>
          目前公開登入只提供 Google，無法取得學校活動報名所需的學校帳號資格；新的學校帳號登入也尚未開放。若你先前已完成學校資格驗證且伺服器仍確認有效，仍可在支援的活動使用報名。
        </p>
        <p className={styles.notice}>
          瀏覽中的學校若與你的有效學校資格不同，也不會因此取得報名資格。
        </p>
        <Link className="btn" href={loginHref}>
          保留此活動頁並查看登入說明
        </Link>
      </section>
    );
  }

  if (selectedSchoolId !== PROVIDENCE_SCHOOL_ID) {
    return (
      <section className={styles.panel} role="status">
        <h3>這所學校目前不能靠登入表單取得報名資格</h3>
        <p>
          目前學校帳號登入表單只支援靜宜大學，不會把其他學校的瀏覽狀態授權成可報名資格。若你已有與此瀏覽學校相符、且伺服器確認有效的學校資格，仍可在支援的活動使用報名。
        </p>
        <Link className="btn" href={loginHref}>
          保留此活動頁並查看登入說明
        </Link>
      </section>
    );
  }

  return (
    <section className={styles.panel}>
      <h3>需要有效的學校帳號資格</h3>
      <p>瀏覽活動不需登入。若要報名，請先連線與目前瀏覽學校相符的學校帳號。</p>
      <Link className="btn primary" href={loginHref}>
        連線學校帳號後回到此活動
      </Link>
    </section>
  );
}

function MembershipNotice({
  membership,
  returnPath,
  selectedSchoolId,
}: {
  membership: SchoolEventMembership;
  returnPath: string;
  selectedSchoolId: string;
}) {
  if (membership.status === 'auth-loading' || membership.status === 'membership-loading') {
    return (
      <p className={styles.notice} role="status">
        正在確認學校帳號資格…
      </p>
    );
  }
  if (membership.status === 'guest') {
    return <GuestRegistrationNotice returnPath={returnPath} selectedSchoolId={selectedSchoolId} />;
  }
  if (membership.status === 'stale') {
    return (
      <section className={styles.panel} role="status">
        <h3>學校資格尚待伺服器確認</h3>
        <p>目前只讀到本機快取，還不能確定可否報名。請稍後再試，或重新連線學校帳號。</p>
        <Link className="btn" href={buildCampusEventLoginHref(returnPath)}>
          重新連線學校帳號
        </Link>
      </section>
    );
  }
  if (membership.status === 'permission') {
    return (
      <section className={styles.panel} role="status">
        <h3>目前帳號沒有這所學校的有效成員資格</h3>
        <p>瀏覽中的學校與伺服器確認的學校成員資格不符，或資格已失效。不會送出報名請求。</p>
        <Link className="btn" href={buildCampusEventLoginHref(returnPath)}>
          重新連線學校帳號
        </Link>
      </section>
    );
  }
  if (membership.status === 'mismatch') {
    return (
      <section className={styles.panel} role="status">
        <h3>瀏覽學校與帳號學校不一致</h3>
        <p>
          你的學校帳號與目前瀏覽的學校不符。請切換到相符的學校後再報名；其他學校的登入不會授權這所學校的活動。
        </p>
      </section>
    );
  }
  return (
    <section className={styles.panel} role="alert">
      <h3>暫時無法確認學校資格</h3>
      <p>還沒取得伺服器確認的學校成員資料，暫不開放報名操作。</p>
    </section>
  );
}

function InformationalRegistrationPanel({ event }: { event: CampusEvent }) {
  const titleId = useId();
  return (
    <section className={styles.panel} aria-labelledby={titleId}>
      <h3 id={titleId}>僅供瀏覽</h3>
      <p>
        這筆來自「{campusEventSourceLabel(event.source)}
        」，目前只提供資訊瀏覽，不能用本系統報名或取消。相同編號若出現在其他資料來源，也不會自動對應到可報名活動。
      </p>
    </section>
  );
}

function AuthorizedRegistrationPanel({
  event,
  uid,
  schoolId,
  isAuthorized,
  authorizationEpoch,
}: {
  event: CampusEvent;
  uid: string;
  schoolId: string;
  isAuthorized: () => boolean;
  authorizationEpoch: number;
}) {
  const [view, setView] = useState<RegistrationView>({ status: 'loading' });
  const [mutation, setMutation] = useState<MutationView>({ status: 'reading' });
  const [cancelConfirm, setCancelConfirm] = useState<CancelConfirmation | null>(null);
  const [busy, setBusy] = useState(false);
  const generation = useRef(0);
  const mounted = useRef(false);
  const mutationPhase = useRef<'idle' | 'submitting'>('idle');
  const cancelTriggerRef = useRef<HTMLButtonElement | null>(null);
  const titleId = useId();
  const homeEpoch = useRef(authorizationEpoch);
  const ledgerKey = campusEventIntentsStorageKey({ uid, schoolId });

  const scopeAlive = useCallback(() => {
    return mounted.current && homeEpoch.current === authorizationEpoch;
  }, [authorizationEpoch]);

  const current = useCallback(() => {
    return scopeAlive() && isAuthorized();
  }, [scopeAlive, isAuthorized]);

  const loadState = useCallback(async () => {
    const scope = { uid, schoolId };
    const request = ++generation.current;
    setView({ status: 'loading' });
    try {
      const [state] = await loadEventRegistrationStates(scope, [event.id], () => current());
      if (!scopeAlive() || request !== generation.current) return;
      // Ordinary status reads never clear a pending mutation receipt.
      setView({ status: 'ready', state });
    } catch (error) {
      if (!scopeAlive() || request !== generation.current) return;
      setView({
        status: 'error',
        message: userFacingCampusEventError(error, '暫時無法確認報名狀態，請稍後重試。'),
      });
    }
  }, [uid, schoolId, event.id, current, scopeAlive]);

  const restorePending = useCallback(
    async (options?: { force?: boolean }) => {
      const scope = { uid, schoolId };
      const request = generation.current;
      try {
        const pending = await readPendingCampusEventIntent(scope, event.id, () => current());
        if (!scopeAlive() || request !== generation.current) return;
        setMutation((currentMutation) => {
          // Storage refresh must not replace an in-flight submit with an older snapshot.
          if (!options?.force && mutationPhase.current === 'submitting') {
            return currentMutation;
          }
          if (
            !options?.force &&
            currentMutation.status === 'submitting' &&
            pending &&
            pending.requestId === currentMutation.intent.requestId
          ) {
            return currentMutation;
          }
          if (pending) {
            if (
              currentMutation.status === 'submitting' &&
              pending.requestId !== currentMutation.intent.requestId
            ) {
              // Newer/replaced ledger entry wins; drop obsolete in-flight UI.
              mutationPhase.current = 'idle';
              return { status: 'pending', intent: pending };
            }
            return { status: 'pending', intent: pending };
          }
          if (currentMutation.status === 'done' || currentMutation.status === 'blocked') {
            return currentMutation;
          }
          if (currentMutation.status === 'submitting') {
            return currentMutation;
          }
          return { status: 'idle' };
        });
      } catch (error) {
        if (!mounted.current || request !== generation.current) return;
        if (mutationPhase.current === 'submitting' && !options?.force) return;
        setMutation({
          status: 'read-error',
          message: userFacingCampusEventError(
            error,
            '這份待確認的報名暫時讀不到，原始資料仍保留。請勿清除瀏覽器資料。',
          ),
        });
      }
    },
    [uid, schoolId, event.id, current, scopeAlive],
  );

  useEffect(() => {
    mounted.current = true;
    homeEpoch.current = authorizationEpoch;
    return () => {
      mounted.current = false;
      generation.current += 1;
      mutationPhase.current = 'idle';
    };
  }, [authorizationEpoch]);

  useEffect(() => {
    mutationPhase.current = 'idle';
    void loadState();
    void restorePending({ force: true });
  }, [uid, schoolId, event.id, event.source, authorizationEpoch, loadState, restorePending]);

  useEffect(() => {
    const onStorage = (storageEvent: StorageEvent) => {
      if (storageEvent.key !== ledgerKey) return;
      void restorePending();
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [ledgerKey, restorePending]);

  // Cancel confirmation is scoped to this keyed mount; parent unmounts on auth loss.
  const activeCancel =
    cancelConfirm &&
    cancelConfirm.uid === uid &&
    cancelConfirm.schoolId === schoolId &&
    cancelConfirm.eventId === event.id
      ? cancelConfirm
      : null;

  async function refreshAfterStaleFinalize(scope: { uid: string; schoolId: string }) {
    const pending = await readPendingCampusEventIntent(scope, event.id, () => current());
    if (!mounted.current || !current()) return;
    if (pending) {
      setMutation({ status: 'pending', intent: pending });
    } else {
      setMutation({ status: 'idle' });
    }
    try {
      const [state] = await loadEventRegistrationStates(scope, [event.id], () => current());
      if (!mounted.current || !current()) return;
      setView({ status: 'ready', state });
    } catch {
      if (!mounted.current || !current()) return;
      // Keep neutral pending/idle; avoid applying the obsolete mutation reply.
    }
  }

  async function runMutation(intent: CampusEventRegistrationIntent) {
    if (busy || !current()) return;
    const scope = { uid, schoolId };
    const request = generation.current;
    setBusy(true);
    mutationPhase.current = 'submitting';
    setMutation({ status: 'submitting', intent });
    try {
      if (!current()) throw new Error('Event registration session changed');
      const result = await submitCampusEventIntent(scope, intent, () => current());
      if (!mounted.current || request !== generation.current) return;
      if (!current()) throw new Error('Event registration session changed');
      let finalized = false;
      try {
        finalized = await finalizeCampusEventIntent(scope, intent, result, () => current());
      } catch (cleanupError) {
        if (!mounted.current || request !== generation.current) return;
        mutationPhase.current = 'idle';
        setView({ status: 'ready', state: result.state });
        setMutation({
          status: 'unknown',
          intent,
          message: userFacingCampusEventError(
            cleanupError,
            '報名已確認，但此裝置的紀錄尚未更新，請重試',
          ),
        });
        return;
      }
      if (!mounted.current || request !== generation.current) return;
      if (!finalized) {
        mutationPhase.current = 'idle';
        // Matching pending already gone/replaced — never apply the old reply as current UI.
        await refreshAfterStaleFinalize(scope);
        return;
      }
      mutationPhase.current = 'idle';
      setView({ status: 'ready', state: result.state });
      setMutation({
        status: 'done',
        state: result.state,
        message:
          intent.action === 'register'
            ? result.state.status === 'cancelled'
              ? '這次待確認的報名已對應到目前狀態：已取消報名。'
              : '報名已確認。'
            : '取消報名已確認。',
      });
    } catch (error) {
      if (!mounted.current || request !== generation.current) return;
      mutationPhase.current = 'idle';
      setMutation({
        status: 'unknown',
        intent,
        message: userFacingCampusEventError(
          error,
          '還不能確認這次操作結果。請用「繼續確認」重送同一筆待確認的報名，不要另開新的報名。',
        ),
      });
    } finally {
      if (mounted.current && request === generation.current) setBusy(false);
    }
  }

  async function recoverExistingPending() {
    const scope = { uid, schoolId };
    try {
      const pending = await readPendingCampusEventIntent(scope, event.id, () => current());
      if (!mounted.current || !current()) return false;
      if (pending) {
        setMutation({ status: 'pending', intent: pending });
        return true;
      }
    } catch {
      // Fall through to blocked messaging.
    }
    return false;
  }

  async function startRegister() {
    if (busy || !current()) return;
    if (mutation.status === 'reading' || mutation.status === 'read-error') return;
    const scope = { uid, schoolId };
    const request = generation.current;
    setBusy(true);
    try {
      const intent = await prepareCampusEventIntent(
        scope,
        { eventId: event.id, action: 'register' },
        () => current(),
      );
      if (!mounted.current || request !== generation.current || !current()) {
        if (mounted.current && request === generation.current) setBusy(false);
        return;
      }
      setMutation({ status: 'pending', intent });
      setBusy(false);
      await runMutation(intent);
    } catch (error) {
      if (!mounted.current || request !== generation.current) return;
      if (await recoverExistingPending()) {
        setBusy(false);
        return;
      }
      setMutation({
        status: 'blocked',
        message: userFacingCampusEventError(
          error,
          '這次沒有建立報名紀錄，也尚未送出網路請求。',
        ),
      });
      setBusy(false);
    }
  }

  function requestCancel() {
    if (!current() || busy) return;
    if (mutation.status === 'reading' || mutation.status === 'read-error') return;
    setCancelConfirm({
      uid,
      schoolId,
      eventId: event.id,
      action: 'cancel',
      title: event.title,
    });
  }

  async function confirmCancel() {
    const confirmation = cancelConfirm;
    setCancelConfirm(null);
    if (
      !confirmation ||
      confirmation.uid !== uid ||
      confirmation.schoolId !== schoolId ||
      confirmation.eventId !== event.id ||
      !current()
    ) {
      return;
    }
    const scope = { uid, schoolId };
    const request = generation.current;
    setBusy(true);
    try {
      const intent = await prepareCampusEventIntent(
        scope,
        { eventId: event.id, action: 'cancel' },
        () => current(),
      );
      if (!mounted.current || request !== generation.current || !current()) {
        if (mounted.current && request === generation.current) setBusy(false);
        return;
      }
      setMutation({ status: 'pending', intent });
      setBusy(false);
      await runMutation(intent);
    } catch (error) {
      if (!mounted.current || request !== generation.current) return;
      if (await recoverExistingPending()) {
        setBusy(false);
        return;
      }
      setMutation({
        status: 'blocked',
        message: userFacingCampusEventError(
          error,
          '這次沒有建立取消報名紀錄，也尚未送出網路請求。',
        ),
      });
      setBusy(false);
    } finally {
      cancelTriggerRef.current?.focus();
    }
  }

  const state = view.status === 'ready' ? view.state : mutation.status === 'done' ? mutation.state : null;
  const pendingIntent =
    mutation.status === 'pending' ||
    mutation.status === 'submitting' ||
    mutation.status === 'unknown'
      ? mutation.intent
      : null;
  const ledgerReady = mutation.status !== 'reading' && mutation.status !== 'read-error';
  // Auth loss unmounts this keyed panel; avoid ref-backed current() during render.
  const canRegister = ledgerReady && !pendingIntent && !busy && state?.canRegister === true;
  const canCancel = ledgerReady && !pendingIntent && !busy && state?.canCancel === true;

  return (
    <section className={styles.panel} aria-labelledby={titleId}>
      <h3 id={titleId}>報名</h3>
      {view.status === 'loading' && !state ? (
        <p className={styles.notice} role="status">
          正在向伺服器確認報名狀態…
        </p>
      ) : null}
      {view.status === 'error' ? (
        <div role="alert">
          <p>{view.message}</p>
          <button type="button" className="btn" onClick={() => void loadState()} disabled={busy}>
            重新確認報名狀態
          </button>
        </div>
      ) : null}
      {state ? (
        <div className={styles.registrationMeta}>
          <p>
            <strong>{campusEventAvailabilityCopy(state)}</strong>
          </p>
          {campusEventRegistrationCountLabel(state) ? (
            <p>{campusEventRegistrationCountLabel(state)}</p>
          ) : (
            <p className={styles.notice}>本系統報名人數尚無法確認。</p>
          )}
          {state.availability === 'unavailable' ? (
            <p className={styles.notice}>目前未開放線上報名。</p>
          ) : null}
          {state.opensAt ? <p>報名開始：{formatCampusEventDateTime(state.opensAt)}</p> : null}
          {state.closesAt ? <p>報名截止：{formatCampusEventDateTime(state.closesAt)}</p> : null}
          {state.cancellationClosesAt ? (
            <p>取消截止：{formatCampusEventDateTime(state.cancellationClosesAt)}</p>
          ) : null}
        </div>
      ) : null}

      {mutation.status === 'done' ? (
        <p className={styles.notice} role="status">
          {mutation.message}
        </p>
      ) : null}

      {mutation.status === 'blocked' ? (
        <p className={styles.notice} role="alert">
          {mutation.message}
        </p>
      ) : null}

      {mutation.status === 'reading' ? (
        <p className={styles.notice} role="status">
          正在讀取待確認的報名紀錄…
        </p>
      ) : null}

      {mutation.status === 'read-error' ? (
        <div role="alert">
          <p>{mutation.message}</p>
          <button
            type="button"
            className="btn"
            disabled={busy}
            onClick={() => {
              setMutation({ status: 'reading' });
              void restorePending({ force: true });
            }}
          >
            重新讀取報名紀錄
          </button>
        </div>
      ) : null}

      {pendingIntent ? (
        <section className={styles.recovery} role="status">
          <h4>
            {pendingIntent.action === 'register' ? '尚有待確認的報名' : '尚有待確認的取消'}
          </h4>
          <p>
            {mutation.status === 'submitting'
              ? '正在確認這次操作，請勿重複送出。'
              : mutation.status === 'unknown'
                ? mutation.message
                : '重新開啟頁面後仍保留同一筆待確認的報名；一般狀態刷新不會清除它。'}
          </p>
          <button
            type="button"
            className="btn primary"
            disabled={busy || mutation.status === 'submitting'}
            onClick={() => void runMutation(pendingIntent)}
          >
            {pendingIntent.action === 'register' ? '繼續確認這次報名' : '繼續確認這次取消'}
          </button>
          <button
            type="button"
            className="btn"
            disabled={busy || mutation.status === 'submitting'}
            onClick={() => void loadState()}
          >
            更新報名狀態
          </button>
        </section>
      ) : mutation.status !== 'reading' && mutation.status !== 'read-error' ? (
        <div className={styles.actions}>
          <button
            type="button"
            className="btn primary"
            disabled={!canRegister}
            onClick={() => void startRegister()}
          >
            報名
          </button>
          <button
            ref={cancelTriggerRef}
            type="button"
            className="btn"
            disabled={!canCancel}
            onClick={requestCancel}
          >
            取消報名
          </button>
          <button type="button" className="btn" disabled={busy} onClick={() => void loadState()}>
            更新報名狀態
          </button>
        </div>
      ) : null}

      <ConfirmModal
        isOpen={!!activeCancel}
        onClose={() => {
          setCancelConfirm(null);
          cancelTriggerRef.current?.focus();
        }}
        onConfirm={() => confirmCancel()}
        title="確認取消報名"
        message={`確定要取消「${activeCancel?.title || event.title}」的報名嗎？取消後若要再參加，需要重新報名。`}
        confirmText="確認取消報名"
        cancelText="返回"
        variant="danger"
        loading={busy}
      />
    </section>
  );
}

export function EventRegistrationPanel({
  event,
  returnPath,
}: {
  event: CampusEvent;
  returnPath: string;
}) {
  const { membership, authorizationEpoch, isAuthorized } = useSchoolEventMembership(event.schoolId);
  const callable = campusEventRegistrationCallableSupported(event.source);

  // Information-only sources stay usable even when the school auth watcher fails.
  if (!callable) {
    return <InformationalRegistrationPanel event={event} />;
  }

  const scopeReady =
    membership.status === 'ready' && schoolEventMembershipCurrent(membership, event.schoolId);

  if (!scopeReady) {
    return (
      <MembershipNotice
        membership={membership}
        returnPath={returnPath}
        selectedSchoolId={event.schoolId}
      />
    );
  }

  return (
    <AuthorizedRegistrationPanel
      key={`${membership.uid}:${membership.schoolId}:${event.id}:${event.source}:${authorizationEpoch}`}
      event={event}
      uid={membership.uid}
      schoolId={membership.schoolId}
      isAuthorized={isAuthorized}
      authorizationEpoch={authorizationEpoch}
    />
  );
}
