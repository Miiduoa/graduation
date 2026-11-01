'use client';
import { clubRoleLabel } from './clubService';
import { use, useEffect, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { SiteShell } from '@/components/SiteShell';
import { useAuth } from '@/components/AuthGuard';
import { useBrowsingSchoolPageContext } from '@/lib/useBrowsingSchoolPageContext';
import { SchoolScopePlaceholder } from '@/components/SchoolScopePlaceholder';
import { callClub, loadClubView, clubEnabled, type ClubView } from './clubService';
import styles from './groups.module.css';

export function ClubBoard({
  uid,
  schoolId,
  groupId,
}: {
  uid: string;
  schoolId: string;
  groupId: string;
}) {
  const [clock, setClock] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setClock(Date.now()), 15000);
    return () => clearInterval(timer);
  }, []);
  const [view, setView] = useState<ClubView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const current = useRef(false);
  const lock = useRef(false);
  const creationId = useRef<string | null>(null);
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    let active = true;
    current.current = true;
    loadClubView(uid, schoolId, groupId).then(
      (data) => {
        if (active) setView(data);
      },
      (reason: Error) => {
        if (active) setError(reason.message);
      },
    );
    return () => {
      active = false;
      current.current = false;
    };
  }, [uid, schoolId, groupId]);
  async function perform(input: Record<string, unknown>, exported = false) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result =
        input.action === 'read'
          ? ((await loadClubView(uid, schoolId, groupId)) as ClubView & { csv?: string })
          : await callClub<ClubView & { csv?: string }>(uid, schoolId, groupId, input);
      if (!current.current) return;
      if (exported && result.csv) {
        const url = URL.createObjectURL(new Blob([result.csv], { type: 'text/csv;charset=utf-8' }));
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = '社團名單與活動.csv';
        anchor.click();
        URL.revokeObjectURL(url);
      }
      const data =
        input.action === 'read' || exported
          ? result
          : await callClub<ClubView>(uid, schoolId, groupId);
      if (current.current) {
        setView(data);
        setNotice(data.rosterOnly ? '已重新讀取社員名單' : '已由伺服器確認');
      }
    } catch (reason) {
      if (current.current) {
        setView(null);
        setError(reason instanceof Error ? reason.message : '尚未確認，請重新整理');
      }
    } finally {
      lock.current = false;
      if (current.current) setBusy(false);
    }
  }
  function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    creationId.current ??= crypto.randomUUID();
    void perform({
      action: 'create',
      eventId: creationId.current,
      title: data.get('title'),
      location: data.get('location'),
      startsAt: new Date(String(data.get('startsAt'))).getTime(),
      endsAt: new Date(String(data.get('endsAt'))).getTime(),
    });
  }
  const officer = view?.role === 'owner' || view?.role === 'admin';
  return (
    <div className={styles.page}>
      <button className="btn" disabled={busy} onClick={() => void perform({ action: 'read' })}>
        重新整理
      </button>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {!view && !error && <p role="status">正在讀取社團資料…</p>}
      {view && (
        <>
          <p>
            身分：{view.role === 'owner' ? '會長' : officer ? '幹部' : '社員'} · 社員{' '}
            {view.members.length} 位{!view.rosterOnly && <> · 活動 {view.events.length} 場</>}
          </p>
          {officer && (
            <button
              className="btn"
              disabled={busy}
              onClick={() => void perform({ action: 'export' }, true)}
            >
              匯出社員與活動 CSV
            </button>
          )}
          <h2>社員名單</h2>
          {view.members.length === 0 ? (
            <p>尚無社員</p>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table className={styles.roster}>
                <thead>
                  <tr>
                    <th>姓名</th>
                    <th>角色</th>
                    {officer && (
                      <>
                        <th>學號</th>
                        <th>電話</th>
                      </>
                    )}
                    {view.role === 'owner' && <th>幹部設定</th>}
                  </tr>
                </thead>
                <tbody>
                  {view.members.map((m) => (
                    <tr key={m.id}>
                      <td>{m.name}</td>
                      <td>{clubRoleLabel(m.role)}</td>
                      {officer && (
                        <>
                          <td>{m.studentId || '未提供'}</td>
                          <td>{m.phone || '未提供'}</td>
                        </>
                      )}
                      {view.role === 'owner' && (
                        <td>
                          {m.role !== '會長' && (
                            <button
                              className="btn"
                              disabled={busy}
                              onClick={() =>
                                void perform({
                                  action: 'role',
                                  targetUid: m.id,
                                  role: m.role === '幹部' ? 'member' : 'admin',
                                })
                              }
                            >
                              {m.role === '幹部' ? '改為社員' : '設為幹部'}
                            </button>
                          )}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {officer && (
            <form ref={form} className={styles.compose} onSubmit={create}>
              <h2>建立活動</h2>
              <label className={styles.field}>
                活動名稱
                <input name="title" required maxLength={120} />
              </label>
              <label className={styles.field}>
                地點
                <input name="location" maxLength={200} />
              </label>
              <label className={styles.field}>
                開始時間
                <input name="startsAt" type="datetime-local" required />
              </label>
              <label className={styles.field}>
                結束時間
                <input name="endsAt" type="datetime-local" required />
              </label>
              <button className="btn" disabled={busy} type="submit">
                建立活動
              </button>
              <button
                className="btn"
                disabled={busy}
                type="button"
                onClick={() => {
                  creationId.current = null;
                  form.current?.reset();
                  setNotice('可開始填寫另一場活動');
                }}
              >
                填寫另一場活動
              </button>
            </form>
          )}
          {view.rosterOnly ? (
            <p>活動後台暫時無法使用，社員名單仍可查閱。</p>
          ) : (
            <>
              <h2>活動與報名</h2>
              <p>活動開始前可報名或取消；活動期間由幹部核對本人後簽到。人數僅計有效社員。</p>
              {view.events.length === 0 && <p>尚無活動</p>}
              {view.events.map((e) => (
                <article className={styles.group} key={e.id}>
                  <h3>{e.title}</h3>
                  <p>
                    {new Date(e.startsAt).toLocaleString('zh-TW')} —{' '}
                    {new Date(e.endsAt).toLocaleString('zh-TW')} · {e.location || '未指定地點'}
                  </p>
                  <p>
                    報名 {e.registered} 人 · 簽到 {e.checkedIn} 人 · 簽到率{' '}
                    {e.registered
                      ? `${Math.round((e.checkedIn / e.registered) * 100)}%`
                      : '尚無報名'}
                  </p>
                  <p>我的狀態：{e.myCheckIn ? '已簽到' : e.mine ? '已報名' : '未報名'}</p>
                  <button
                    className="btn"
                    disabled={busy || clock >= e.startsAt}
                    onClick={() =>
                      void perform({ action: e.mine ? 'cancel' : 'register', eventId: e.id })
                    }
                  >
                    {e.mine ? '取消報名' : '報名'}
                  </button>
                  {officer && (
                    <ul>
                      {e.registrations?.map((r) => (
                        <li key={r.uid}>
                          {view.members.find((m) => m.id === r.uid)?.name} ·{' '}
                          {r.checkedIn ? (
                            '已簽到'
                          ) : (
                            <button
                              className="btn"
                              disabled={busy || clock < e.startsAt || clock > e.endsAt}
                              onClick={() =>
                                void perform({ action: 'checkIn', eventId: e.id, targetUid: r.uid })
                              }
                            >
                              確認簽到
                            </button>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </article>
              ))}
            </>
          )}
        </>
      )}
    </div>
  );
}
export function ClubAdmin({
  groupId,
  searchParams,
}: {
  groupId: string;
  searchParams?: Promise<{ school?: string; schoolId?: string; campus?: string }>;
}) {
  const params = searchParams ? use(searchParams) : undefined;
  const { school, ready } = useBrowsingSchoolPageContext(params);
  const { user, loading } = useAuth();
  return (
    <SiteShell title="社團後台" schoolName={ready ? school.name : undefined}>
      {!clubEnabled() ? (
        <p>社團後台尚未啟用</p>
      ) : !ready ? (
        <SchoolScopePlaceholder />
      ) : loading ? (
        <p>正在確認帳號…</p>
      ) : !user ? (
        <Link href="/login">請先登入</Link>
      ) : (
        <ClubBoard
          key={JSON.stringify([user.uid, school.id, groupId])}
          uid={user.uid}
          schoolId={school.id}
          groupId={groupId}
        />
      )}
    </SiteShell>
  );
}
