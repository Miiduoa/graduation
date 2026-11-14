'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
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
  TronClassHomeworkItem,
  TronClassSnapshot,
} from '@/lib/tronClassIntegrationTypes';
import { TronClassAssignment } from './TronClassAssignment';
import { SourceLink, tronClassTime } from './TronClassSource';
import { TronClassMaterialDownload } from './TronClassMaterialDownload';
import { TronClassAgentAccess } from './TronClassAgentAccess';
import { createTronClassAgentClient } from '@/lib/tronClassAgentClient';
import styles from './tronclass.module.css';

export function TronClassWorkspace() {
  const platform = useOptionalNuniSession();
  const firebase = useAuth();
  const platformSession = platform?.session;
  const identity = useMemo<TronClassIdentity | null>(() => {
    if (platformSession) return { kind: 'platform', context: platformSession.context };
    if (firebase.user) return { kind: 'firebase', getIdToken: () => firebase.user!.getIdToken() };
    return null;
  }, [platformSession, firebase.user]);
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
    !!identity && !!owner && !platformBlocked && !loading && (platformSession || !firebase.error);

  return (
    <SiteShell
      title="TronClass"
      subtitle="課程、作業與教材，在同一個地方處理。"
      schoolName="靜宜大學"
    >
      <div className={styles.workspace}>
        <Link className={styles.back} href="/classroom">
          返回課程空間
        </Link>
        {!ready ? (
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
        ) : (
          <AccountWorkspace key={workspaceKey} identity={identity!} owner={owner!} />
        )}
      </div>
    </SiteShell>
  );
}

function AccountWorkspace({ identity, owner }: { identity: TronClassIdentity; owner: string }) {
  const client = useMemo(() => createTronClassClient(identity), [identity]);
  const agentClient = useMemo(() => createTronClassAgentClient(identity), [identity]);
  const [connection, setConnection] = useState<TronClassConnection | null>(null);
  const [loading, setLoading] = useState(true);
  const [epoch, setEpoch] = useState(0);
  const [error, setError] = useState('');
  const [account, setAccount] = useState('');
  const [password, setPassword] = useState('');
  const [editing, setEditing] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [submissionBusy, setSubmissionBusy] = useState(false);
  const alive = useRef(true);
  const lock = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    let current = true;
    void client.status().then(
      (value) => {
        if (!current) return;
        setConnection(value);
        setEditing(!value.connected);
        setAccount(value.account ?? '');
        setLoading(false);
      },
      (reason) => {
        if (!current) return;
        setError(tronClassErrorMessage(reason));
        setLoading(false);
      },
    );
    return () => {
      current = false;
    };
  }, [client, epoch]);

  function reloadStatus() {
    setConnection(null);
    setPassword('');
    setLoading(true);
    setError('');
    setEpoch((value) => value + 1);
  }

  async function connect(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (lock.current || submissionBusy || !account.trim() || !password || !connection) return;
    lock.current = true;
    setBusy(true);
    setError('');
    const suppliedPassword = password;
    setPassword('');
    try {
      const value = await client.connect(account.trim(), suppliedPassword, connection.revision);
      if (!alive.current) return;
      setConnection(value);
      setAccount(value.account ?? '');
      setEditing(!value.connected);
      setDisconnecting(false);
    } catch (reason) {
      if (!alive.current) return;
      if (reason instanceof TronClassRequestError && reason.code.includes('BINDING_CHANGED'))
        reloadStatus();
      else setError(tronClassErrorMessage(reason));
    } finally {
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  }

  async function disconnect() {
    if (lock.current || submissionBusy || !connection) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      const value = await client.disconnect(connection.revision);
      if (!alive.current) return;
      setConnection(value);
      setAccount('');
      setPassword('');
      setEditing(true);
      setDisconnecting(false);
    } catch (reason) {
      if (alive.current) setError(tronClassErrorMessage(reason));
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
        {!loading && !connection && (
          <button className="btn" onClick={reloadStatus}>
            重新確認連接
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
              <p role="status" className={styles.muted}>
                正在登入學校平台，這可能需要一點時間。
              </p>
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
      {connection?.connected && connection.revision && (
        <TronClassAgentAccess key={`agent:${connection.revision}`} client={agentClient}
          revision={connection.revision} onConnectionChanged={reloadStatus} />
      )}
      {connection?.connected && connection.revision && (
        <ConnectedWorkspace
          key={connection.revision}
          client={client}
          revision={connection.revision}
          owner={owner}
          onConnectionChanged={reloadStatus}
          onSubmissionBusy={setSubmissionBusy}
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
}: {
  client: TronClassClient;
  revision: string;
  owner: string;
  onConnectionChanged: () => void;
  onSubmissionBusy: (busy: boolean) => void;
}) {
  const [snapshot, setSnapshot] = useState<TronClassSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [course, setCourse] = useState('all');
  const [tab, setTab] = useState<'homework' | 'announcements' | 'materials'>('homework');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<TronClassHomeworkItem | null>(null);
  const alive = useRef(true);
  const generation = useRef(0);
  const currentConnectionChanged = useRef(onConnectionChanged);
  useEffect(() => {
    currentConnectionChanged.current = onConnectionChanged;
  }, [onConnectionChanged]);

  async function sync(scope = course, replace = false) {
    const request = ++generation.current;
    setLoading(true);
    setError('');
    if (replace)
      setSnapshot((value) =>
        value
          ? { ...value, homework: [], announcements: [], materials: [], errors: [], partial: false }
          : value,
      );
    try {
      const value = await client.sync(scope === 'all' ? undefined : Number(scope));
      if (!alive.current || request !== generation.current) return;
      if (value.revision !== revision) {
        currentConnectionChanged.current();
        return;
      }
      setSnapshot(value);
    } catch (reason) {
      if (!alive.current || request !== generation.current) return;
      if (reason instanceof TronClassRequestError && reason.code.includes('BINDING_CHANGED'))
        currentConnectionChanged.current();
      else setError(tronClassErrorMessage(reason));
    } finally {
      if (alive.current && request === generation.current) setLoading(false);
    }
  }

  useEffect(() => {
    alive.current = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- a new account/binding starts its first external read
    void sync('all');
    return () => {
      alive.current = false;
    };
    // The enclosing key is the verified account/binding revision.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, revision]);

  const includes = (item: { courseId: number | null; title: string; courseName: string }) =>
    (course === 'all' || String(item.courseId) === course) &&
    `${item.title} ${item.courseName}`
      .toLocaleLowerCase()
      .includes(query.trim().toLocaleLowerCase());
  const homework = snapshot?.homework.filter(includes) ?? [];
  const announcements = snapshot?.announcements.filter(includes) ?? [];
  const materials = snapshot?.materials.filter(includes) ?? [];
  const count =
    tab === 'homework'
      ? homework.length
      : tab === 'announcements'
        ? announcements.length
        : materials.length;

  return (
    <>
      <section className={styles.panel}>
        <div className={styles.heading}>
          <div>
            <h2>我的課程</h2>
            <p className={styles.muted}>
              {snapshot
                ? `更新於 ${tronClassTime(snapshot.fetchedAt)} · ${snapshot.courses.length} 門課程`
                : '載入學校目前提供的課程與學習資料。'}
            </p>
          </div>
          <button className="btn" disabled={loading} onClick={() => void sync()}>
            {loading ? '同步中…' : '同步最新資料'}
          </button>
        </div>
        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
        {loading && (
          <p role="status" className={styles.muted}>
            正在同步課程、作業、公告與教材…
          </p>
        )}
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
        {snapshot && (
          <>
            <div className={styles.filters}>
              <label htmlFor="tronclass-course">
                課程
                <select
                  id="tronclass-course"
                  value={course}
                  onChange={(event) => {
                    const value = event.target.value;
                    setCourse(value);
                    void sync(value, true);
                  }}
                >
                  <option value="all">所有課程</option>
                  {snapshot.courses.map((item) => (
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
              <ul className={styles.list}>
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
                        onClick={() => setSelected(item)}
                      >
                        {item.submitted ? '查看繳交內容' : '準備作業'}
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
          onClose={() => {
            document
              .getElementById(`tronclass-homework-${selected.courseId}-${selected.id}`)
              ?.focus();
            setSelected(null);
          }}
          onBusy={onSubmissionBusy}
          onConnectionChanged={onConnectionChanged}
          onSubmitted={() => {
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
