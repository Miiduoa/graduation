'use client';

import Link from 'next/link';
import { createTronClassBindingConsent, type TronClassBindingConsent } from '@campus/shared/src/tronClassBindingConsent';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { useAuth } from '@/components/AuthGuard';
import { SiteShell } from '@/components/SiteShell';
import { useOptionalNuniSession } from '@/features/nuni/Session';
import {
  createTronClassClient,
  safeTronClassHref,
  tronClassUploadKey,
  tronClassErrorMessage,
  TronClassRequestError,
  type TronClassClient,
  type TronClassIdentity,
} from '@/lib/tronClassIntegrationClient';
import type {
  TronClassConnection,
  TronClassCourseIndex,
  TronClassHomeworkItem,
  TronClassSnapshot,
} from '@/lib/tronClassIntegrationTypes';
import { TronClassAssignment } from './TronClassAssignment';
import { SourceLink, tronClassTime } from './TronClassSource';
import { TronClassMaterialDownload } from './TronClassMaterialDownload';
import { TronClassAgentAccess } from './TronClassAgentAccess';
import { createTronClassAgentClient } from '@/lib/tronClassAgentClient';
import { sameTronClassDraftScope, type TronClassLocalDraft } from './tronClassLocalDraft';
import styles from './tronclass.module.css';

type SchoolDraft = { studentKey: string; draft: TronClassLocalDraft };
const MAX_LOCAL_DRAFTS = 5;
type HomeworkFilter = 'all' | 'pending' | 'unknown' | 'submitted';
const homeworkFilters: { value: HomeworkFilter; label: string }[] = [
  { value: 'all', label: '全部作業' },
  { value: 'pending', label: '待繳交' },
  { value: 'unknown', label: '狀態待確認' },
  { value: 'submitted', label: '已繳交' },
];

function homeworkState(item: TronClassHomeworkItem): Exclude<HomeworkFilter, 'all'> {
  return item.submitted === true ? 'submitted' : item.submitted === false ? 'pending' : 'unknown';
}

function homeworkDeadline(item: TronClassHomeworkItem): number {
  const value = item.deadline ? Date.parse(item.deadline) : NaN;
  return Number.isFinite(value) ? value : Infinity;
}

function homeworkOrder(left: TronClassHomeworkItem, right: TronClassHomeworkItem): number {
  // Unknown school status remains visible alongside unfinished work. A missing
  // deadline sorts last without inventing a due date or submission permission.
  const completed = Number(left.submitted === true) - Number(right.submitted === true);
  if (completed) return completed;
  const leftDeadline = homeworkDeadline(left);
  const rightDeadline = homeworkDeadline(right);
  return leftDeadline === rightDeadline ? 0 : leftDeadline < rightDeadline ? -1 : 1;
}

function verifiedStudentKey(connection: TronClassConnection | null): string | null {
  return connection?.connected && typeof connection.studentKey === 'string' &&
    /^[a-f0-9]{64}$/.test(connection.studentKey) ? connection.studentKey : null;
}

export function TronClassWorkspace() {
  const [bindingConsent] = useState(createTronClassBindingConsent);
  const platform = useOptionalNuniSession();
  const firebase = useAuth();
  const platformSession = platform?.session;
  const platformAccountId = platformSession?.platformAccountId ?? null;
  const platformContext = platformSession?.context ?? null;
  const firebaseOwner = platformSession ? null : firebase.user?.uid ?? null;
  const latestFirebaseUser = useRef(firebase.user);
  useLayoutEffect(() => { latestFirebaseUser.current = firebase.user; }, [firebase.user]);
  const identity = useMemo<TronClassIdentity | null>(() => {
    if (platformAccountId !== null && platformContext !== null)
      return { kind: 'platform', context: platformContext };
    if (firebaseOwner) return { kind: 'firebase', getIdToken: async () => {
      const user = latestFirebaseUser.current;
      if (!user || user.uid !== firebaseOwner)
        throw new TronClassRequestError('SESSION_CHANGED', '登入帳號已變更，請重新開啟此頁面。', 409);
      return user.getIdToken();
    } };
    return null;
  }, [platformAccountId, platformContext, firebaseOwner]);
  const platformBlocked =
    !!platform && (platform.loading || !!platform.error || platform.pendingLogout);
  const loading = platform?.loading || (!platformSession && firebase.loading);
  const owner = platformSession
    ? `platform:${platformSession.platformAccountId}`
    : firebase.user
      ? `firebase:${firebase.user.uid}`
      : null;
  const workspaceKey = platformSession ? `${owner}:${platformSession.context}` : owner;
  const ready =
    (platformContext !== null || !!firebaseOwner) && !!owner && !platformBlocked && !loading &&
    (platformSession || !firebase.error);
  // A platform refresh retains its previously verified account/context while
  // loading. Keep only that identity's page-memory drafts, not the private UI or
  // its active requests. Error, logout or a different key destroys the boundary.
  const retainDuringPlatformRefresh = !!platformSession && platform?.loading &&
    !platform.error && !platform.pendingLogout;

  return (
    <SiteShell
      title="TronClass"
      schoolName="靜宜大學"
    >
      <div className={styles.workspace}>
        <Link className={styles.back} href="/classroom">
          返回課程空間
        </Link>
        {!ready && (
          <section className={styles.panel}>
            {loading ? (
              <p role="status">正在確認登入狀態…</p>
            ) : (
              <>
                <h2>連接你的學校課程</h2>
                <p>
                  {platform?.pendingLogout
                    ? '請先完成登出，再登入要連接課程的帳號。'
                    : platform?.error || '登入 nuni 後，使用學校帳號連接 TronClass。'}
                </p>
                <div className={styles.actions}>
                  <Link className="btn primary" href="/classroom/login?returnUrl=%2Ftronclass">
                    登入 nuni
                  </Link>
                  {platform?.error && (
                    <button className="btn" onClick={() => void platform.refresh()}>
                      重新確認登入
                    </button>
                  )}
                  {platform?.pendingLogout && (
                    <button className="btn" onClick={() => void platform.logout()}>
                      完成登出
                    </button>
                  )}
                </div>
              </>
            )}
          </section>
        )}
        {(ready || retainDuringPlatformRefresh) && (
          <AccountDraftRetention key={workspaceKey} identity={identity!} owner={owner!} active={!!ready} bindingConsent={bindingConsent} />
        )}
      </div>
    </SiteShell>
  );
}

function AccountDraftRetention({ identity, owner, active, bindingConsent }: {
  identity: TronClassIdentity; owner: string; active: boolean; bindingConsent: TronClassBindingConsent;
}) {
  const [recoveryDrafts, setRecoveryDrafts] = useState<SchoolDraft[]>([]);
  // No hidden editor/DOM remains during verification. Remounting the account
  // requires a fresh school status; recovery still requires the same studentKey
  // and a fresh prepare before the retained text or File handles become visible.
  return active ? <AccountWorkspace identity={identity} owner={owner}
    recoveryDrafts={recoveryDrafts} setRecoveryDrafts={setRecoveryDrafts} bindingConsent={bindingConsent} /> : null;
}

function AccountWorkspace({ identity, owner, recoveryDrafts, setRecoveryDrafts, bindingConsent }: {
  identity: TronClassIdentity;
  owner: string;
  recoveryDrafts: SchoolDraft[];
  setRecoveryDrafts: Dispatch<SetStateAction<SchoolDraft[]>>;
  bindingConsent: TronClassBindingConsent;
}) {
  const client = useMemo(() => createTronClassClient(identity), [identity]);
  const agentClient = useMemo(() => createTronClassAgentClient(identity), [identity]);
  const [connection, setConnection] = useState<TronClassConnection | null>(null);
  const [loading, setLoading] = useState(true);
  const [epoch, setEpoch] = useState(0);
  const [awaitingBindingConsent, setAwaitingBindingConsent] = useState(false);
  const [error, setError] = useState('');
  const [account, setAccount] = useState('');
  const [password, setPassword] = useState('');
  const [editing, setEditing] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [submissionBusy, setSubmissionBusy] = useState(false);
  const draftScope = useRef<{ studentKey: string; revision: string } | null>(null);
  const alive = useRef(true);
  const lock = useRef(false);
  const connectionRequest = useRef(0);
  const connectController = useRef<AbortController | null>(null);
  const acceptConnection = useCallback((value: TronClassConnection) => {
    const studentKey = verifiedStudentKey(value);
    draftScope.current = studentKey && value.revision ? { studentKey, revision: value.revision } : null;
    if (value.connected || !value.account) {
      setRecoveryDrafts((drafts) => studentKey ? drafts.filter((draft) => draft.studentKey === studentKey) : []);
    }
    if (value.connected) bindingConsent.accept(owner, value.revision);
    setAwaitingBindingConsent(false);
    setConnection(value);
  }, [bindingConsent, owner, setRecoveryDrafts]);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      connectController.current?.abort();
      connectController.current = null;
      lock.current = false;
      draftScope.current = null;
    };
  }, [client]);
  useEffect(() => {
    let current = true;
    const request = ++connectionRequest.current;
    void client.status().then(
      (value) => {
        if (!current || request !== connectionRequest.current) return;
        setBusy(false);
        const pause = value.connected && !bindingConsent.permits(owner, value.revision);
        if (pause) {
          setAwaitingBindingConsent(true);
          setConnection(value);
        } else acceptConnection(value);
        setEditing(!value.connected);
        setAccount(value.account ?? '');
        setError(pause ? 'TronClass 連接已變更。請確認目前的學校帳號，再繼續讀取課程。' :
          !value.connected && value.account ? 'TronClass 登入已失效，請重新連接後繼續。' : '');
        setLoading(false);
      },
      (reason) => {
        if (!current || request !== connectionRequest.current) return;
        setBusy(false);
        setError(tronClassErrorMessage(reason));
        setLoading(false);
      },
    );
    return () => {
      current = false;
    };
  }, [client, epoch, acceptConnection, bindingConsent, owner]);

  function suspendDraft() {
    // Keep page-memory drafts sealed until the same school identity is verified.
    draftScope.current = null;
  }

  function retainDraft(revision: string, studentKey: string | null, draft: TronClassLocalDraft | null,
    courseId: number, homeworkId: number) {
    const current = draftScope.current;
    if (!alive.current || !studentKey || !current ||
      current.revision !== revision || current.studentKey !== studentKey) return;
    setRecoveryDrafts((values) => {
      const otherDrafts = values.filter((value) => value.studentKey === studentKey &&
        !sameTronClassDraftScope(value.draft, courseId, homeworkId));
      if (!draft) return otherDrafts;
      // The list stops opening a sixth new editor; never evict an existing draft.
      if (otherDrafts.length >= MAX_LOCAL_DRAFTS) return values;
      return [...otherDrafts, { studentKey, draft }];
    });
  }

  function reloadStatus(sourceRevision?: string | null, reason?: unknown) {
    ++connectionRequest.current;
    suspendDraft();
    setPassword('');
    setDisconnecting(false);
    if (reason instanceof TronClassRequestError && reason.code === 'TRONCLASS_BINDING_CHANGED')
      bindingConsent.changed(owner, sourceRevision ?? null);
    if (reason instanceof TronClassRequestError && reason.code === 'TRONCLASS_RECONNECT_REQUIRED') {
      // The local binding TTL may still be valid after the school has rejected
      // its session. Keep the CAS revision, but retire every dependent view.
      setConnection((value) => value ? { ...value, connected: false } : value);
      setEditing(true);
      setLoading(false);
      setError('TronClass 登入已失效，請重新連接後繼續。');
      return;
    }
    setConnection(null);
    setLoading(true);
    setError('');
    setEpoch((value) => value + 1);
  }

  function onWorkspaceConnectionChanged(reason?: unknown) {
    // A refresh from a revision-scoped view can discover a replacement binding.
    // Keep that status separate from accepting it for coursework and Agent access.
    reloadStatus(connection?.revision, reason);
  }

  async function connect(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (lock.current || submissionBusy || !account.trim() || !password || !connection) return;
    lock.current = true;
    const request = ++connectionRequest.current;
    const controller = new AbortController();
    connectController.current = controller;
    const expectedRevision = connection.revision;
    setBusy(true);
    setError('');
    const suppliedPassword = password;
    setPassword('');
    suspendDraft();
    // Retire old reads, downloads and grants before starting a replacement login.
    setConnection({ ...connection, connected: false });
    try {
      const value = await client.connect(account.trim(), suppliedPassword, expectedRevision, controller.signal);
      if (!alive.current || controller.signal.aborted || request !== connectionRequest.current) return;
      acceptConnection(value);
      setAccount(value.account ?? '');
      setEditing(!value.connected);
      setDisconnecting(false);
    } catch (reason) {
      if (!alive.current || controller.signal.aborted || request !== connectionRequest.current) return;
      if (reason instanceof TronClassRequestError && reason.code === 'TRONCLASS_BINDING_CHANGED')
        reloadStatus(expectedRevision, reason);
      else setError(tronClassErrorMessage(reason));
    } finally {
      // A late response from a canceled attempt must not unlock a newer one.
      if (connectController.current === controller) {
        connectController.current = null;
        lock.current = false;
        if (alive.current) setBusy(false);
      }
    }
  }

  function cancelConnect() {
    const controller = connectController.current;
    if (!controller) return;
    connectController.current = null;
    ++connectionRequest.current;
    controller.abort();
    lock.current = false;
    setBusy(false);
    // Cancellation cannot reverse a binding committed just before the abort.
    // Read its current revision before allowing another login or showing data.
    reloadStatus();
  }

  async function disconnect() {
    if (lock.current || submissionBusy || !connection) return;
    lock.current = true;
    setBusy(true);
    setError('');
    // Explicit unlink also discards local work even if the request later fails.
    draftScope.current = null;
    setRecoveryDrafts([]);
    setConnection({ ...connection, connected: false });
    try {
      const value = await client.disconnect(connection.revision);
      if (!alive.current) return;
      bindingConsent.accept(owner, value.revision);
      acceptConnection(value);
      setAccount('');
      setPassword('');
      setEditing(true);
      setDisconnecting(false);
    } catch (reason) {
      if (alive.current) {
        reloadStatus(connection.revision, reason instanceof TronClassRequestError &&
          reason.code === 'TRONCLASS_BINDING_CHANGED' ? reason : undefined);
        setError(tronClassErrorMessage(reason));
      }
    } finally {
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  }

  return (
    <div className={styles.stack}>
      <section className={styles.panel} aria-labelledby="tronclass-connection-heading">
        <div className={styles.heading}>
          <div>
            <p className={styles.eyebrow}>學校連接</p>
            <h2 id="tronclass-connection-heading">靜宜大學・玩課雲</h2>
            {connection?.connected && (
              <p className={styles.muted}>
                {connection.userName ? `${connection.userName} · ` : ''}
                {connection.account}
              </p>
            )}
          </div>
          {connection?.connected && <span className={styles.connected}>已連接</span>}
        </div>
        {loading && <p role="status">正在確認 TronClass 連接…</p>}
        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
        {recoveryDrafts.length > 0 && !connection?.connected && <div className={styles.notice} role="status">
          <p>本頁暫時保留了作業文字與附件。重新連接同一個學校帳號後，可以回到剛才的作業。</p>
          <p>關閉或重新整理頁面會清除保留的草稿。</p>
          <button className={styles.textButton} onClick={() => setRecoveryDrafts([])}>
            清除保留的草稿
          </button>
        </div>}
        {!loading && !connection && (
          <button className="btn" onClick={() => reloadStatus()}>
            重新確認連接
          </button>
        )}
        {awaitingBindingConsent && connection?.connected && !editing && !disconnecting && (
          <button className="btn" onClick={() => {
            acceptConnection(connection);
            setError('');
          }}>
            繼續讀取目前帳號的課程
          </button>
        )}
        {connection && editing && (
          <form onSubmit={(event) => void connect(event)} className={styles.form}>
            <p className={styles.muted}>使用 E 校園服務網的帳號與密碼，連接後載入你的課程。</p>
            <fieldset disabled={busy || submissionBusy}>
              <div className={styles.credentials}>
                <label htmlFor="tronclass-account">
                  學校帳號
                  <input
                    id="tronclass-account"
                    autoComplete="username"
                    autoCapitalize="none"
                    spellCheck={false}
                    maxLength={120}
                    required
                    value={account}
                    onChange={(event) => setAccount(event.target.value)}
                  />
                </label>
                <label htmlFor="tronclass-password">
                  學校密碼
                  <input
                    id="tronclass-password"
                    type="password"
                    autoComplete="current-password"
                    maxLength={512}
                    required
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                  />
                </label>
              </div>
              <div className={styles.actions}>
                <button className="btn primary" type="submit">
                  {busy ? '連接中…' : connection.connected ? '更新連接' : '連接 TronClass'}
                </button>
                {connection.connected && (
                  <button
                    className="btn"
                    type="button"
                    onClick={() => {
                      setEditing(false);
                      setPassword('');
                    }}
                  >
                    取消
                  </button>
                )}
              </div>
            </fieldset>
            {busy && (
              <div className={styles.actions}>
                <p role="status" className={styles.muted}>
                  正在登入學校平台，這可能需要一點時間。
                </p>
                <button className="btn" type="button" onClick={cancelConnect}>
                  取消連接
                </button>
              </div>
            )}
          </form>
        )}
        {connection?.connected && !editing && !disconnecting && (
          <div className={styles.actions}>
            <button
              className="btn"
              disabled={busy || submissionBusy}
              onClick={() => {
                setEditing(true);
                setError('');
              }}
            >
              重新連接／更換帳號
            </button>
            <button
              className={styles.textButton}
              disabled={busy || submissionBusy}
              onClick={() => setDisconnecting(true)}
            >
              解除連接
            </button>
          </div>
        )}
        {disconnecting && (
          <div className={styles.notice}>
            <p>解除後會停止同步，已繳交的作業仍會留在 TronClass。</p>
            <div className={styles.actions}>
              <button
                className="btn"
                disabled={busy || submissionBusy}
                onClick={() => void disconnect()}
              >
                {busy ? '處理中…' : '確認解除連接'}
              </button>
              <button
                className={styles.textButton}
                disabled={busy}
                onClick={() => setDisconnecting(false)}
              >
                保留連接
              </button>
            </div>
          </div>
        )}
      </section>
      {connection?.connected && connection.revision && !awaitingBindingConsent && (
        <TronClassAgentAccess key={`agent:${connection.revision}`} client={agentClient}
          revision={connection.revision} onConnectionChanged={onWorkspaceConnectionChanged} />
      )}
      {connection?.connected && connection.revision && !awaitingBindingConsent && (
        <ConnectedWorkspace
          key={connection.revision}
          client={client}
          revision={connection.revision}
          owner={owner}
          onConnectionChanged={onWorkspaceConnectionChanged}
          onSubmissionBusy={setSubmissionBusy}
          recoveryDrafts={recoveryDrafts.filter((value) => value.studentKey === verifiedStudentKey(connection))
            .map((value) => value.draft)}
          onDiscardDraft={(courseId, homeworkId) =>
            retainDraft(connection.revision!, verifiedStudentKey(connection), null, courseId, homeworkId)}
          onDraftChange={(draft, courseId, homeworkId) =>
            retainDraft(connection.revision!, verifiedStudentKey(connection), draft, courseId, homeworkId)}
        />
      )}
    </div>
  );
}

function ConnectedWorkspace({
  client,
  revision,
  owner,
  onConnectionChanged,
  onSubmissionBusy,
  recoveryDrafts,
  onDiscardDraft,
  onDraftChange,
}: {
  client: TronClassClient;
  revision: string;
  owner: string;
  onConnectionChanged: (reason?: unknown) => void;
  onSubmissionBusy: (busy: boolean) => void;
  recoveryDrafts: TronClassLocalDraft[];
  onDiscardDraft: (courseId: number, homeworkId: number) => void;
  onDraftChange: (draft: TronClassLocalDraft | null, courseId: number, homeworkId: number) => void;
}) {
  const [snapshot, setSnapshot] = useState<TronClassSnapshot | null>(null);
  const [courseIndex, setCourseIndex] = useState<TronClassCourseIndex | null>(null);
  const [indexError, setIndexError] = useState('');
  const [indexLoading, setIndexLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [course, setCourse] = useState('all');
  const [tab, setTab] = useState<'homework' | 'announcements' | 'materials'>('homework');
  const [query, setQuery] = useState('');
  const [homeworkFilter, setHomeworkFilter] = useState<HomeworkFilter>('all');
  const [submissionBusy, setSubmissionBusy] = useState(false);
  const [selected, setSelected] = useState<TronClassHomeworkItem | null>(null);
  const [selectedDraft, setSelectedDraft] = useState<TronClassLocalDraft | undefined>();
  const alive = useRef(true);
  const generation = useRef(0);
  const indexGeneration = useRef(0);
  const directorySequence = useRef(0);
  const acceptedDirectorySequence = useRef(0);
  const syncController = useRef<AbortController | null>(null);
  const indexController = useRef<AbortController | null>(null);
  const currentConnectionChanged = useRef(onConnectionChanged);
  useEffect(() => {
    currentConnectionChanged.current = onConnectionChanged;
  }, [onConnectionChanged]);

  async function sync(scope = course, replace = false) {
    const request = ++generation.current;
    const directoryOrder = ++directorySequence.current;
    syncController.current?.abort();
    const controller = new AbortController();
    syncController.current = controller;
    setLoading(true);
    setError('');
    if (replace) setSnapshot(null);
    try {
      const value = await client.sync(scope === 'all' ? undefined : Number(scope), controller.signal, courseIndex?.revision ?? snapshot?.revision ?? revision);
      if (!alive.current || request !== generation.current) return;
      if (value.revision !== revision) {
        ++generation.current;
        setSnapshot(null);
        currentConnectionChanged.current();
        return;
      }
      setSnapshot(value);
      if (directoryOrder >= acceptedDirectorySequence.current) {
        acceptedDirectorySequence.current = directoryOrder;
        const errors = value.errors.filter((issue) => issue.area === 'courses' && issue.courseId === null)
          .map((issue) => ({ courseId: null, area: 'courses' as const, message: issue.message }));
        setCourseIndex({ kind: 'course-index', revision: value.revision, fetchedAt: value.fetchedAt,
          courses: value.courses, errors, partial: errors.length > 0 });
        setIndexError('');
      }
    } catch (reason) {
      if (!alive.current || request !== generation.current) return;
      if (reason instanceof TronClassRequestError &&
        ['TRONCLASS_BINDING_CHANGED', 'TRONCLASS_RECONNECT_REQUIRED'].includes(reason.code)) {
        ++generation.current;
        setSnapshot(null);
        currentConnectionChanged.current(reason);
      } else setError(tronClassErrorMessage(reason));
    } finally {
      if (alive.current && request === generation.current) setLoading(false);
    }
  }

  async function loadCourseIndex() {
    const request = ++indexGeneration.current;
    const directoryOrder = ++directorySequence.current;
    indexController.current?.abort();
    const controller = new AbortController();
    indexController.current = controller;
    setIndexLoading(true);
    setIndexError('');
    try {
      const value = await client.courses(controller.signal, courseIndex?.revision ?? snapshot?.revision ?? revision);
      if (!alive.current || request !== indexGeneration.current) return;
      if (value.revision !== revision) { currentConnectionChanged.current(); return; }
      if (directoryOrder >= acceptedDirectorySequence.current) {
        acceptedDirectorySequence.current = directoryOrder;
        setCourseIndex(value);
      }
    } catch (reason) {
      if (!alive.current || request !== indexGeneration.current) return;
      if (reason instanceof TronClassRequestError &&
        ['TRONCLASS_BINDING_CHANGED', 'TRONCLASS_RECONNECT_REQUIRED'].includes(reason.code)) {
        currentConnectionChanged.current(reason);
      } else if (directoryOrder >= acceptedDirectorySequence.current) setIndexError(tronClassErrorMessage(reason));
    } finally {
      if (alive.current && request === indexGeneration.current) setIndexLoading(false);
    }
  }

  useEffect(() => {
    alive.current = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- a new account/binding starts independent external reads
    void loadCourseIndex();
    void sync('all');
    return () => {
      alive.current = false;
      syncController.current?.abort();
      indexController.current?.abort();
    };
    // The enclosing key is the verified account/binding revision.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, revision]);

  const courses = courseIndex?.courses ?? snapshot?.courses ?? [];
  const includes = (item: { courseId: number | null; title: string; courseName: string }) =>
    (course === 'all' || String(item.courseId) === course) &&
    `${item.title} ${item.courseName}`
      .toLocaleLowerCase()
      .includes(query.trim().toLocaleLowerCase());
  const matchingHomework = snapshot?.homework.filter(includes) ?? [];
  const homeworkCounts: Record<HomeworkFilter, number> = { all: matchingHomework.length, pending: 0, unknown: 0, submitted: 0 };
  for (const item of matchingHomework) homeworkCounts[homeworkState(item)]++;
  const homework = matchingHomework
    .filter((item) => homeworkFilter === 'all' || homeworkState(item) === homeworkFilter)
    .sort(homeworkOrder);
  const announcements = snapshot?.announcements.filter(includes) ?? [];
  const materials = snapshot?.materials.filter(includes) ?? [];
  const count =
    tab === 'homework'
      ? homework.length
      : tab === 'announcements'
        ? announcements.length
        : materials.length;
  function openHomework(item: TronClassHomeworkItem) {
    if (submissionBusy) return;
    const draft = recoveryDrafts.find((value) => sameTronClassDraftScope(value, item.courseId, item.id));
    if (!draft && recoveryDrafts.length >= MAX_LOCAL_DRAFTS) {
      setError(`本頁已保留 ${MAX_LOCAL_DRAFTS} 份草稿。請先繼續或清除其中一份，再開啟其他作業。`);
      return;
    }
    setError('');
    setSelectedDraft(draft);
    setSelected(item);
  }

  return (
    <>
      <section className={styles.panel}>
        <div className={styles.heading}>
          <div>
            <h2 id="tronclass-courses-heading" tabIndex={-1}>我的課程</h2>
            <p className={styles.muted}>
              {courseIndex || snapshot
                ? `${courses.length} 門課程 · 清單更新於 ${tronClassTime(courseIndex?.fetchedAt ?? snapshot!.fetchedAt)}`
                : '載入學校目前提供的課程與學習資料。'}
            </p>
          </div>
          <button className="btn" disabled={loading || submissionBusy} onClick={() => void sync()}>
            {loading ? '同步中…' : '同步最新資料'}
          </button>
        </div>
        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
        {indexError && <div className={styles.notice}>
          <p role="alert">課程清單：{indexError}</p>
          <button className="btn" disabled={indexLoading || submissionBusy} onClick={() => void loadCourseIndex()}>
            重新讀取課程清單
          </button>
        </div>}
        {courseIndex?.partial && <p className={styles.notice} role="status">
          部分課程清單尚未取得，可先選擇已顯示的課程。
        </p>}
        {loading && <p role="status" className={styles.muted}>
          正在同步課程、作業、公告與教材…{courses.length > 0 ? '可以先選一門課查看，不必等候全部同步。' : ''}
        </p>}
        {!snapshot && !loading && courses.length > 0 && <p className={styles.notice}>
          課程清單已載入。請選一門課讀取作業、公告與教材，或重新同步。
        </p>}
        {snapshot?.partial && (
          <div className={styles.notice} role="status">
            <p>部分資料尚未更新，已取得的內容仍可查看。</p>
            <ul>
              {snapshot.errors.map((item, index) => (
                <li key={`${item.area}:${item.courseId}:${index}`}>{item.message}</li>
              ))}
            </ul>
          </div>
        )}
        {recoveryDrafts.length > 0 && !selected && <div className={styles.notice}>
          <h3>本頁保留的作業草稿</h3>
          <p>文字與附件會保留到離開或重新整理本頁；繳交結果請開啟作業查證。最多保留 {MAX_LOCAL_DRAFTS} 份。</p>
          {recoveryDrafts.map((draft) => {
            const recoveryHomework = snapshot?.revision === revision
              ? snapshot.homework.find((item) => sameTronClassDraftScope(draft, item.courseId, item.id)) : undefined;
            return <div key={`${draft.courseId}:${draft.homeworkId}`}>
              <p>{recoveryHomework
                ? `「${recoveryHomework.title}」的文字與附件已保留。`
                : '正在等候重新取得原作業；取得後才能恢復草稿。可同步最新資料或清除草稿。'}</p>
              <div className={styles.actions}>
                <button className="btn" disabled={loading || !recoveryHomework}
                  onClick={() => { if (recoveryHomework) openHomework(recoveryHomework); }}>
                  {recoveryDrafts.length === 1 ? '繼續編輯保留的草稿' : `繼續編輯 ${recoveryHomework?.title ?? '待確認的作業'}`}
                </button>
                <button className={styles.textButton} onClick={() => onDiscardDraft(draft.courseId, draft.homeworkId)}>
                  {recoveryDrafts.length === 1 ? '清除保留的草稿' : `清除 ${recoveryHomework?.title ?? '待確認的作業'} 的草稿`}
                </button>
              </div>
            </div>;
          })}
        </div>}
        {(courseIndex || snapshot) && (
          <>
            <div className={styles.filters}>
              <label htmlFor="tronclass-course">
                課程
                <select
                  id="tronclass-course"
                  value={course}
                  disabled={submissionBusy}
                  onChange={(event) => {
                    const value = event.target.value;
                    setCourse(value);
                    void sync(value, true);
                  }}
                >
                  <option value="all">所有課程</option>
                  {courses.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>
              <label htmlFor="tronclass-search">
                搜尋
                <input
                  id="tronclass-search"
                  type="search"
                  placeholder="作業、公告或教材名稱"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
              </label>
            </div>
            <div className={styles.tabs} role="group" aria-label="課程資料類型">
              {(['homework', 'announcements', 'materials'] as const).map((value) => (
                <button
                  key={value}
                  className={tab === value ? styles.tabActive : ''}
                  aria-pressed={tab === value}
                  onClick={() => setTab(value)}
                >
                  {value === 'homework' ? '作業' : value === 'announcements' ? '公告' : '教材'}
                </button>
              ))}
            </div>
          </>
        )}
        {snapshot && (
          <>
            {tab === 'homework' && <>
              <div className={styles.homeworkFilters} role="group" aria-label="作業繳交狀態">
                {homeworkFilters.map(({ value, label }) => (
                  <button key={value} aria-pressed={homeworkFilter === value}
                    aria-label={`${label}，${homeworkCounts[value]} 份`}
                    onClick={() => setHomeworkFilter(value)}>
                    {label} <span aria-hidden="true">{homeworkCounts[value]}</span>
                  </button>
                ))}
              </div>
              <p className={styles.sortHint}>待繳交與狀態待確認優先，按截止時間排列。</p>
            </>}
            {course === 'all' && tab !== 'homework' ? (
              <p className={styles.empty}>
                請先選擇一門課程，查看該課程的{tab === 'announcements' ? '公告' : '教材'}。
              </p>
            ) : (
              <>
                <div aria-live="polite" className={styles.resultCount}>
                  {count} 筆{query ? '符合搜尋條件' : ''}
                </div>
                {count === 0 && !loading && (
                  <p className={styles.empty}>
                    {snapshot.partial
                      ? '這次沒有取得符合條件的資料，可重新同步或到 TronClass 查看。'
                      : '目前沒有符合條件的資料。'}
                  </p>
                )}
              </>
            )}
            {tab === 'homework' && (
              <ul className={styles.list} aria-label="作業清單">
                {homework.map((item) => (
                  <li className={styles.homeworkRow} key={`${item.courseId}:${item.id}`}>
                    <div className={styles.itemContent}>
                      <p className={styles.eyebrow}>{item.courseName}</p>
                      <h3>{item.title}</h3>
                      <p className={styles.muted}>
                        {item.deadline
                          ? `${tronClassTime(item.deadline)} 截止`
                          : item.deadlineLabel || '未提供截止時間'}
                      </p>
                    </div>
                    <div className={styles.rowActions}>
                      <span className={item.submitted === true ? styles.submitted : styles.state}>
                        {item.submitted === true
                          ? 'TronClass 已繳交'
                          : item.submitted === false
                            ? '待繳交'
                            : '狀態待確認'}
                      </span>
                      <button
                        id={`tronclass-homework-${item.courseId}-${item.id}`}
                        className="btn"
                        disabled={submissionBusy}
                        onClick={() => openHomework(item)}
                      >
                        {item.submitted ? '查看作業' : '準備作業'}
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {tab === 'announcements' && (
              <ul className={styles.list}>
                {announcements.map((item) => (
                  <li key={`${item.courseId}:${item.id}`}>
                    <article className={styles.contentRow}>
                      <p className={styles.eyebrow}>
                        {item.courseName || '學校公告'}
                        {item.publishedAt ? ` · ${tronClassTime(item.publishedAt)}` : ''}
                      </p>
                      <h3>{item.title}</h3>
                      <p className={styles.bodyText}>{item.content}</p>
                      <SourceLink href={item.href}>查看原始公告</SourceLink>
                    </article>
                  </li>
                ))}
              </ul>
            )}
            {tab === 'materials' && (
              <ul className={styles.list}>
                {materials.map((item) => (
                  <li key={`${item.courseId}:${item.id}`}>
                    <article className={styles.contentRow}>
                      <p className={styles.eyebrow}>{item.courseName}</p>
                      <h3>{item.title}</h3>
                      {item.files.length > 0 && (
                        <ul className={styles.fileLinks}>
                          {item.files.map((file, index) => (
                            <li key={`${file.name}:${index}`}>
                              {file.allowDownload &&
                              tronClassUploadKey(file.downloadHref) &&
                              item.courseId &&
                              typeof item.id === 'number' ? (
                                <TronClassMaterialDownload
                                  key={`${revision}:${item.courseId}:${item.id}:${tronClassUploadKey(file.downloadHref)}`}
                                  client={client}
                                  revision={revision}
                                  courseId={item.courseId}
                                  activityId={item.id}
                                  uploadKey={tronClassUploadKey(file.downloadHref)!}
                                  name={file.name}
                                  onConnectionChanged={onConnectionChanged}
                                />
                              ) : file.allowDownload && safeTronClassHref(file.downloadHref) ? (
                                <SourceLink href={file.downloadHref}>
                                  在 TronClass 下載 {file.name}
                                </SourceLink>
                              ) : (
                                <span>
                                  {file.name}
                                  {!file.allowDownload ? ' · 僅供線上閱覽' : ''}
                                </span>
                              )}
                            </li>
                          ))}
                        </ul>
                      )}
                      <SourceLink href={item.href}>開啟原始教材</SourceLink>
                    </article>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </section>
      {selected && (
        <TronClassAssignment
          key={`${revision}:${selected.courseId}:${selected.id}`}
          client={client}
          revision={revision}
          owner={owner}
          homework={selected}
          initialDraft={selectedDraft}
          onDraftChange={(draft) => onDraftChange(draft, selected.courseId, selected.id)}
          onClose={() => {
            const returnTarget = document.getElementById(`tronclass-homework-${selected.courseId}-${selected.id}`)
              ?? document.getElementById('tronclass-courses-heading');
            returnTarget?.focus();
            setSelected(null);
            setSelectedDraft(undefined);
          }}
          onBusy={(value) => {
            setSubmissionBusy(value);
            onSubmissionBusy(value);
          }}
          onConnectionChanged={onConnectionChanged}
          onSubmitted={() => {
            // An overview request started before the confirmation can contain
            // the old "not submitted" state. Retire it before updating the list;
            // an explicit later sync may still return a newer school status.
            ++generation.current;
            setLoading(false);
            setSnapshot((value) =>
              value
                ? {
                    ...value,
                    homework: value.homework.map((item) =>
                      item.id === selected.id && item.courseId === selected.courseId
                        ? { ...item, submitted: true }
                        : item,
                    ),
                  }
                : value,
            );
          }}
        />
      )}
    </>
  );
}
