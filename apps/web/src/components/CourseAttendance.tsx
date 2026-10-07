'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import QRCode from 'qrcode';
import { useAuth } from './AuthGuard';
import { AppHeader } from './AppHeader';
import {
  attendanceCsv,
  attendanceError,
  endCourseAttendance,
  joinCourseAttendance,
  loadAttendanceCode,
  loadAttendanceRecords,
  loadCourseAttendance,
  startCourseAttendance,
  watchCourseMembership,
  type AttendanceRecord,
  type AttendanceSession,
  type CourseAttendance as AttendanceData,
} from '@/lib/courseAttendance';
import home from '@/app/home.module.css';
import styles from './course-attendance.module.css';

function date(value: string | null) {
  return value
    ? new Date(value).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' })
    : '時間尚未確認';
}

function Session({
  session,
  courseId,
  uid,
  canReadRoster,
  canStart,
  reload,
}: {
  session: AttendanceSession;
  courseId: string;
  uid: string;
  canReadRoster: boolean;
  canStart: boolean;
  reload: () => Promise<void>;
}) {
  const [token, setToken] = useState('');
  const [teacherCode, setTeacherCode] = useState('');
  const [qr, setQr] = useState('');
  const [records, setRecords] = useState<AttendanceRecord[] | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const live = useRef(true);
  const [confirmedAt, setConfirmedAt] = useState<string | null>(null);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  const confirmed = session.ownRecord?.checkedInAt ?? confirmedAt;

  async function run(action: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await action();
    } catch (reason) {
      if (live.current) {
        setError(attendanceError(reason));
        setRecords(null);
        setTeacherCode('');
        setQr('');
      }
    } finally {
      lock.current = false;
      if (live.current) setBusy(false);
    }
  }
  async function showCode() {
    const code = await loadAttendanceCode(courseId, session.id);
    const image = await QRCode.toDataURL(
      JSON.stringify({ groupId: courseId, sessionId: session.id, qrToken: code }),
      { width: 260, margin: 2 },
    );
    if (live.current) {
      setTeacherCode(code);
      setQr(image);
    }
  }
  function download() {
    if (!records) return;
    const url = URL.createObjectURL(
      new Blob([attendanceCsv(records)], { type: 'text/csv;charset=utf-8' }),
    );
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `attendance-${session.id}.csv`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <article className={styles.session}>
      <div className={styles.sessionHeading}>
        <div>
          <p className={styles.label}>{session.active ? '點名進行中' : '點名已結束'}</p>
          <h3>{date(session.startedAt)}</h3>
        </div>
        {canReadRoster && (
          <p className={styles.count}>
            <strong>{session.attendeeCount}</strong> 人已簽到
          </p>
        )}
      </div>
      {session.active && <p className={styles.detail}>簽到期限：{date(session.qrExpiresAt)}</p>}
      {confirmed && (
        <p role="status" className={styles.confirmed}>
          已簽到 · {date(confirmed)}
        </p>
      )}
      {!canReadRoster &&
        !confirmed &&
        (session.active ? (
          <form
            className={styles.form}
            onSubmit={(event) => {
              event.preventDefault();
              void run(async () => {
                const result = await joinCourseAttendance(courseId, session.id, token);
                if (!live.current) return;
                setConfirmedAt(result.checkedInAt);
                setToken('');
                await reload();
              });
            }}
          >
            <label htmlFor={`code-${session.id}`}>教師提供的簽到碼</label>
            <input
              id={`code-${session.id}`}
              value={token}
              onChange={(event) => setToken(event.target.value)}
              required
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              maxLength={512}
              disabled={busy}
            />
            <button type="submit" className={home.primary} disabled={busy || !token.trim()}>
              {busy ? '確認中…' : '確認簽到'}
            </button>
            <p className={styles.detail}>也可以在手機版課堂頁掃描教師的 QR Code。</p>
          </form>
        ) : (
          <p className={styles.detail}>沒有你的簽到紀錄。如需更正，請聯絡授課教師。</p>
        ))}
      <div className={styles.actions}>
        {canStart && session.active && (
          <button className={home.secondary} disabled={busy} onClick={() => void run(showCode)}>
            顯示簽到碼
          </button>
        )}
        {canReadRoster && (
          <button
            className={home.secondary}
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const next = await loadAttendanceRecords(courseId, session.id);
                if (live.current) setRecords(next);
              })
            }
          >
            {records ? '更新簽到名單' : '查看簽到名單'}
          </button>
        )}
        {canStart && session.active && session.teacherId === uid && (
          <button
            className={styles.end}
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await endCourseAttendance(courseId, session.id);
                if (!live.current) return;
                setTeacherCode('');
                setQr('');
                setNotice('點名已結束，簽到紀錄已保留。');
                await reload();
              })
            }
          >
            結束點名
          </button>
        )}
      </div>
      {teacherCode && session.active && (
        <div className={styles.codePanel}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={qr} width={260} height={260} alt="本次課堂簽到 QR Code" />
          <div>
            <p>請向這堂課的學生出示。</p>
            <code>{teacherCode}</code>
            <button
              className={home.secondary}
              onClick={() =>
                void run(async () => {
                  await navigator.clipboard.writeText(teacherCode);
                  if (live.current) setNotice('簽到碼已複製。');
                })
              }
            >
              複製簽到碼
            </button>
            <p className={styles.detail}>簽到碼過期後，請結束本次點名，再開啟新的點名。</p>
          </div>
        </div>
      )}
      {records && (
        <div className={styles.roster}>
          <div className={styles.sessionHeading}>
            <h4>已確認的簽到紀錄</h4>
            <button className={home.secondary} disabled={!records.length} onClick={download}>
              下載這份名單
            </button>
          </div>
          {records.length ? (
            <>
              <p className={styles.detail}>
                顯示最近 {records.length} 筆紀錄，最多 200 筆。未簽到不會自動計為缺席。
              </p>
              <ul>
                {records.map((row) => (
                  <li key={row.uid}>
                    <span>
                      <strong>{row.displayName || row.studentId || row.uid}</strong>
                      {row.displayName && <small>{row.studentId || row.uid}</small>}
                    </span>
                    <time>{date(row.checkedInAt)}</time>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p>目前還沒有人簽到。</p>
          )}
        </div>
      )}
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
    </article>
  );
}

function Workspace({ courseId, uid }: { courseId: string; uid: string }) {
  const [data, setData] = useState<AttendanceData | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [notice, setNotice] = useState('');
  const requestId = useRef<string | null>(null);
  const generation = useRef(0);
  const mounted = useRef(true);
  const startLock = useRef(false);
  const [accessAttempt, setAccessAttempt] = useState(0);
  const permission = useRef<string | null>(null);
  const permissionVersion = useRef(0);
  const reload = useCallback(async () => {
    if (!permission.current) return;
    const request = ++generation.current;
    setLoading(true);
    setError('');
    try {
      const next = await loadCourseAttendance(courseId, uid);
      if (request === generation.current && mounted.current) setData(next);
    } catch {
      if (request === generation.current && mounted.current) {
        setData(null);
        setError('無法讀取點名紀錄。請確認連線與課程資格後重試。');
      }
    } finally {
      if (request === generation.current && mounted.current) setLoading(false);
    }
  }, [courseId, uid]);
  useEffect(() => {
    mounted.current = true;
    let previous: string | null | undefined;
    const stop = watchCourseMembership(courseId, uid, (role) => {
      if (!mounted.current || role === previous) return;
      previous = role;
      permission.current = role;
      permissionVersion.current += 1;
      generation.current += 1;
      setData(null);
      setNotice('');
      if (role) void reload();
      else {
        setLoading(false);
        setError('無法確認目前的課程資格。連線恢復後會重新確認；若資格已變更，請聯絡授課教師。');
      }
    });
    return () => {
      mounted.current = false;
      generation.current += 1;
      stop();
    };
  }, [courseId, uid, reload, accessAttempt]);
  async function start() {
    if (startLock.current || !permission.current) return;
    const access = permissionVersion.current;
    startLock.current = true;
    setStarting(true);
    setError('');
    setNotice('');
    requestId.current ??= crypto.randomUUID();
    try {
      const result = await startCourseAttendance(courseId, requestId.current);
      if (!mounted.current || access !== permissionVersion.current) return;
      requestId.current = null;
      setNotice(
        result.active
          ? '點名已開啟。顯示簽到碼，讓學生完成簽到。'
          : '這次點名已結束。需要再次點名時，請重新開啟。',
      );
      await reload();
    } catch (reason) {
      if (mounted.current && access === permissionVersion.current)
        setError(attendanceError(reason));
    } finally {
      startLock.current = false;
      if (mounted.current) setStarting(false);
    }
  }
  return (
    <>
      <div className={home.heading}>
        <div>
          <p className={home.eyebrow}>課堂出席</p>
          <h1>{data?.courseName ?? '點名與簽到'}</h1>
          <p className={home.intro}>查看課堂簽到與已保存的出席紀錄。</p>
        </div>
        <button
          className={home.secondary}
          disabled={loading || starting}
          onClick={() => {
            if (permission.current) void reload();
            else setAccessAttempt((attempt) => attempt + 1);
          }}
        >
          {loading ? '讀取中…' : '更新紀錄'}
        </button>
      </div>
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {loading && !data && <p role="status">讀取點名紀錄…</p>}
      {data && (
        <>
          {data.canStart && (
            <section className={styles.startPanel}>
              <div>
                <h2>開啟這堂課的點名</h2>
                <p>學生掃碼或輸入簽到碼後，才會列入出席名單。簽到碼有效 10 分鐘。</p>
              </div>
              <button
                className={home.primary}
                disabled={
                  starting ||
                  loading ||
                  data.sessions.some((session) => session.active && session.teacherId === uid)
                }
                onClick={() => void start()}
              >
                {starting ? '開啟中…' : '開啟點名'}
              </button>
              {data.sessions.some((session) => session.active && session.teacherId === uid) && (
                <p className={styles.detail}>請先結束你開啟的點名，再開啟下一次。</p>
              )}
            </section>
          )}
          <h2 className={styles.history}>點名紀錄</h2>
          <p className={styles.detail}>顯示最近 50 次已保存的點名。</p>
          {data.sessions.length ? (
            data.sessions.map((session) => (
              <Session
                key={`${session.id}:${data.canStart}:${data.canReadRoster}`}
                session={session}
                courseId={courseId}
                uid={uid}
                canStart={data.canStart}
                canReadRoster={data.canReadRoster}
                reload={reload}
              />
            ))
          ) : (
            <div className={styles.empty}>
              <h3>還沒有點名紀錄</h3>
              <p>
                {data.canStart
                  ? '開啟點名後，學生就能在自己的課程頁簽到。'
                  : '教師開啟點名後，請更新這個頁面。'}
              </p>
            </div>
          )}
        </>
      )}
    </>
  );
}
export function CourseAttendance({ courseId }: { courseId: string }) {
  const { user, loading } = useAuth();
  return (
    <div className={home.page}>
      <a href="#attendance-content" className={home.skip}>
        跳到主要內容
      </a>
      <AppHeader />
      <main id="attendance-content" className={`${home.main} ${styles.main}`}>
        {loading ? (
          <p role="status">確認登入狀態…</p>
        ) : user ? (
          <Workspace key={`${user.uid}:${courseId}`} uid={user.uid} courseId={courseId} />
        ) : (
          <div className={styles.empty}>
            <h1>登入後查看課堂出席</h1>
            <p>使用這門課的學校帳號登入，即可簽到或查看紀錄。</p>
            <Link
              className={home.primary}
              href={`/login?redirect=${encodeURIComponent(`/course/${courseId}/attendance`)}`}
            >
              登入帳號
            </Link>
          </div>
        )}
      </main>
    </div>
  );
}
