'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import QRCode from 'qrcode';
import { useAuth } from './AuthGuard';
import { SchoolAccountRequired } from './SchoolAccountRequired';
import { SiteShell } from './SiteShell';
import { Button } from './ui/Button';
import { Input } from './ui/Input';
import { resolveSchoolPageContext, type SchoolSearchParams } from '@/lib/pageContext';
import {
  attendanceCsv,
  attendanceError,
  endCourseAttendance,
  hasOwnActiveAttendance,
  joinCourseAttendance,
  loadAttendanceCode,
  loadAttendanceRecords,
  loadCourseAttendance,
  startCourseAttendance,
  studentAttendanceHeading,
  studentCheckInSession,
  watchCourseMembership,
  type AttendanceRecord,
  type AttendanceSession,
  type CourseAttendance as AttendanceData,
} from '@/lib/courseAttendance';
import service from '@/app/servicePages.module.css';
import styles from './course-attendance.module.css';

function date(value: string | null) {
  return value
    ? new Date(value).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' })
    : '時間尚未確認';
}

function Session({
  session,
  courseId,
  courseName,
  uid,
  canReadRoster,
  canStart,
  checkInEnabled,
  reload,
}: {
  session: AttendanceSession;
  courseId: string;
  courseName: string;
  uid: string;
  canReadRoster: boolean;
  canStart: boolean;
  checkInEnabled: boolean;
  reload: () => Promise<void>;
}) {
  const [token, setToken] = useState('');
  const [teacherCode, setTeacherCode] = useState('');
  const [qr, setQr] = useState('');
  const [records, setRecords] = useState<AttendanceRecord[] | null>(null);
  const [rosterQuery, setRosterQuery] = useState('');
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
  const [clock, setClock] = useState<number | null>(null);
  const deadline = session.qrExpiresAt ? Date.parse(session.qrExpiresAt) : NaN;
  const remainingSeconds = Number.isFinite(deadline) && clock !== null
    ? Math.max(0, Math.ceil((deadline - clock) / 1000))
    : null;
  const expired = session.active && remainingSeconds === 0;
  const visibleRecords = records?.filter((row) =>
    [row.displayName, row.studentId, row.uid].some((value) =>
      value.toLocaleLowerCase().includes(rosterQuery.trim().toLocaleLowerCase()),
    ),
  ) ?? [];

  useEffect(() => {
    if (!session.active || (!canStart && !checkInEnabled)) return;
    const tick = () => setClock(Date.now());
    const initial = window.setTimeout(tick, 0);
    const timer = window.setInterval(tick, 1000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(timer);
    };
  }, [session.active, canStart, checkInEnabled]);

  useEffect(() => {
    if (!teacherCode) return;
    const hideSecret = () => {
      setTeacherCode('');
      setQr('');
    };
    const hideOnBackground = () => {
      if (document.visibilityState !== 'visible') hideSecret();
    };
    document.addEventListener('visibilitychange', hideOnBackground);
    const ttl = Number.isFinite(deadline) ? Math.max(0, deadline - Date.now()) : 0;
    const timer = window.setTimeout(hideSecret, ttl);
    return () => {
      document.removeEventListener('visibilitychange', hideOnBackground);
      window.clearTimeout(timer);
    };
  }, [teacherCode, deadline]);

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
    if (!Number.isFinite(deadline) || deadline <= Date.now()) {
      throw Object.assign(new Error('簽到期限已結束'), { code: 'functions/deadline-exceeded' });
    }
    const image = await QRCode.toDataURL(
      JSON.stringify({ groupId: courseId, sessionId: session.id, qrToken: code }),
      { width: 260, margin: 2 },
    );
    if (live.current && document.visibilityState === 'visible' && Date.now() < deadline) {
      setTeacherCode(code);
      setQr(image);
    }
  }
  function download() {
    if (!records || visibleRecords.length === 0) return;
    const url = URL.createObjectURL(
      new Blob([attendanceCsv(visibleRecords)], { type: 'text/csv;charset=utf-8' }),
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
          <p className={styles.label}>{studentAttendanceHeading(courseName, session.active)}</p>
          <h3>{date(session.startedAt)}</h3>
          <span className={session.active ? styles.activeTag : styles.endedTag}>
            {session.active ? (expired ? '簽到期限已到' : '點名進行中') : '已結束'}
          </span>
        </div>
        {canReadRoster && (
          <p className={styles.count}>
            <strong>{session.attendeeCount}</strong> 人已簽到
          </p>
        )}
      </div>
      {session.active && (
        <p className={styles.detail}>
          簽到期限：{date(session.qrExpiresAt)}
          {remainingSeconds !== null && !expired && (canStart || checkInEnabled)
            ? ` · 剩餘 ${Math.floor(remainingSeconds / 60)} 分 ${String(remainingSeconds % 60).padStart(2, '0')} 秒`
            : null}
          {expired ? ' · 期限已過，請由老師重新開啟' : null}
        </p>
      )}
      {confirmed && (
        <p role="status" className={styles.confirmed}>
          已簽到 · {date(confirmed)}
        </p>
      )}
      {!canReadRoster &&
        !confirmed &&
        (session.active && checkInEnabled ? (
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
            <Input
              id={`code-${session.id}`}
              label="教師提供的簽到碼"
              hint="也可以在手機版課堂頁掃描教師的 QR Code。"
              value={token}
              onChange={(event) => setToken(event.target.value)}
              required
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              maxLength={512}
              disabled={busy}
            />
            <Button type="submit" variant="primary" disabled={busy || !token.trim()}>
              {busy ? '確認中…' : '確認簽到'}
            </Button>
          </form>
        ) : (
          <p className={styles.detail}>沒有你的簽到紀錄。如需更正，請聯絡授課教師。</p>
        ))}
      <div className={styles.actions}>
        {canStart && session.active && (
          <Button variant="outline" disabled={busy} onClick={() => void run(showCode)}>
            顯示簽到碼
          </Button>
        )}
        {canReadRoster && (
          <Button
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const next = await loadAttendanceRecords(courseId, session.id);
                if (live.current) setRecords(next);
              })
            }
          >
            {records ? '更新簽到名單' : '查看簽到名單'}
          </Button>
        )}
        {canStart && session.active && session.teacherId === uid && (
          <Button
            variant="danger"
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
          </Button>
        )}
      </div>
      {teacherCode && session.active && !expired && (
        <div className={styles.codePanel}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={qr} width={260} height={260} alt="本次課堂簽到 QR Code" />
          <div>
            <p>請向這堂課的學生出示。</p>
            <code>{teacherCode}</code>
            <Button
              variant="outline"
              onClick={() =>
                void run(async () => {
                  await navigator.clipboard.writeText(teacherCode);
                  if (live.current) setNotice('簽到碼已複製。');
                })
              }
            >
              複製簽到碼
            </Button>
            <p className={styles.detail}>簽到碼過期後，請結束本次點名，再開啟新的點名。</p>
          </div>
        </div>
      )}
      {records && (
        <div className={styles.roster}>
          <div className={styles.sessionHeading}>
            <h4>已確認的簽到紀錄</h4>
            <Button disabled={!visibleRecords.length} onClick={download}>
              匯出目前名單
            </Button>
          </div>
          {records.length > 0 && (
            <div className={styles.rosterSearch}>
              <label htmlFor={`roster-search-${session.id}`}>搜尋簽到學生</label>
              <input
                id={`roster-search-${session.id}`}
                type="search"
                value={rosterQuery}
                onChange={(event) => setRosterQuery(event.target.value)}
                placeholder="輸入姓名、學號或帳號"
                autoComplete="off"
              />
              <span>{visibleRecords.length} / {records.length} 筆</span>
            </div>
          )}
          {records.length ? (
            <>
              <p className={styles.detail}>
                顯示最近 {records.length} 筆紀錄，最多 200 筆。未簽到不會自動計為缺席。
              </p>
              <ul>
                {visibleRecords.map((row) => (
                  <li key={row.uid}>
                    <span>
                      <strong>{row.displayName || row.studentId || row.uid}</strong>
                      {row.displayName && <small>{row.studentId || row.uid}</small>}
                    </span>
                    <time>{date(row.checkedInAt)}</time>
                  </li>
                ))}
              </ul>
              {visibleRecords.length === 0 && (
                <p className={styles.detail}>沒有符合搜尋條件的學生。</p>
              )}
            </>
          ) : (
            <p>目前還沒有人簽到。</p>
          )}
        </div>
      )}
      {error && (
        <p role="alert" className={service.errorNotice}>
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className={styles.confirmed}>
          {notice}
        </p>
      )}
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
  const [historyFilter, setHistoryFilter] = useState<'all' | 'active' | 'ended'>('all');
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
  const visibleSessions = data?.sessions.filter(
    (session) =>
      (data.canReadRoster ||
        !session.active ||
        session.id === studentCheckInSession(data.sessions)?.id) &&
      (historyFilter === 'all' ||
        (historyFilter === 'active' ? session.active : !session.active)),
  ) ?? [];
  return (
    <>
      <div className={styles.workspaceHeading}>
        <div>
          <h2>{data?.courseName ?? '課堂出席'}</h2>
        </div>
        <Button
          disabled={loading || starting}
          onClick={() => {
            if (permission.current) void reload();
            else setAccessAttempt((attempt) => attempt + 1);
          }}
        >
          {loading ? '讀取中…' : '更新紀錄'}
        </Button>
      </div>
      {error && (
        <p role="alert" className={service.errorNotice}>
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className={styles.confirmed}>
          {notice}
        </p>
      )}
      {loading && !data && (
        <p role="status" className={service.loading}>
          讀取點名紀錄…
        </p>
      )}
      {data && (
        <>
          <section className={styles.overview} aria-label="課堂點名概況">
            <div>
              <span>已保存的點名</span>
              <strong>{data.sessions.length}</strong>
              <small>最近最多 50 場</small>
            </div>
            <div>
              <span>目前進行中</span>
              <strong>{data.sessions.filter((session) => session.active).length}</strong>
              <small>由教師開啟的場次</small>
            </div>
            <div>
              <span>{data.canReadRoster ? '已確認簽到筆數' : '我的已確認簽到'}</span>
              <strong>
                {data.canReadRoster
                  ? data.sessions.reduce((sum, session) => sum + session.attendeeCount, 0)
                  : data.sessions.filter((session) => session.ownRecord).length}
              </strong>
              <small>僅包含可查的紀錄</small>
            </div>
          </section>
          {data.canStart && (
            <section className={styles.startPanel}>
              <div>
                <h2>開啟這堂課的點名</h2>
                <p>學生掃碼或輸入簽到碼後，才會列入出席名單。簽到碼有效 10 分鐘。</p>
              </div>
              <Button
                variant="primary"
                disabled={
                  starting ||
                  loading ||
                  hasOwnActiveAttendance(data.sessions, uid)
                }
                onClick={() => void start()}
              >
                {starting ? '開啟中…' : '開啟點名'}
              </Button>
              {hasOwnActiveAttendance(data.sessions, uid) ? (
                <p className={styles.detail}>請先結束你開啟的點名，再開啟下一次。</p>
              ) : data.sessions.some((session) => session.active) ? (
                <p className={styles.detail}>這堂課已有進行中的點名，開啟新場次會先結束舊場。</p>
              ) : null}
            </section>
          )}
          <div className={styles.historyHeading}>
            <div>
              <h2 className={styles.history}>點名紀錄</h2>
              <p className={styles.detail}>最近 50 場已保存的點名；未簽到不會自動視為缺席。</p>
            </div>
            <div className={styles.filters} role="group" aria-label="篩選點名紀錄">
              {([
                ['all', '全部'],
                ['active', '進行中'],
                ['ended', '已結束'],
              ] as const).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={historyFilter === value}
                  onClick={() => setHistoryFilter(value)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          {visibleSessions.length ? (
            visibleSessions.map((session) => (
              <Session
                key={`${session.id}:${data.canStart}:${data.canReadRoster}`}
                session={session}
                courseId={courseId}
                courseName={data.courseName}
                uid={uid}
                canStart={data.canStart}
                canReadRoster={data.canReadRoster}
                checkInEnabled={studentCheckInSession(data.sessions)?.id === session.id}
                reload={reload}
              />
            ))
          ) : (
            <div className={styles.empty}>
              <h3>{data.sessions.length ? '沒有符合條件的點名' : '還沒有點名紀錄'}</h3>
              <p>
                {data.sessions.length
                  ? '改選「全部」查看其他場次，或更新紀錄確認最新狀態。'
                  : data.canStart
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
export function CourseAttendance({
  courseId,
  audience = 'student',
  searchParams,
}: {
  courseId: string;
  audience?: 'student' | 'teacher';
  searchParams?: SchoolSearchParams;
}) {
  const { user, loading } = useAuth();
  const { schoolSearch } = resolveSchoolPageContext(searchParams);
  const path = `${audience === 'teacher' ? '/teacher' : ''}/course/${encodeURIComponent(courseId)}`;
  return (
    <SiteShell title="點名" subtitle="查看課堂簽到與已保存的出席紀錄。">
      <nav className={styles.navigation} aria-label="課程導覽">
        <Link href={`${path}${schoolSearch}`}>
          <span aria-hidden="true">←</span>
          {audience === 'teacher' ? '回課程工作台' : '回課程內容'}
        </Link>
      </nav>
      <div className={styles.workspace}>
        {loading ? (
          <p role="status" className={service.loading}>
            確認登入狀態…
          </p>
        ) : user ? (
          <Workspace key={`${user.uid}:${courseId}`} uid={user.uid} courseId={courseId} />
        ) : (
          <SchoolAccountRequired
            returnUrl={`${path}/attendance${schoolSearch}`}
            alternative="出缺席請先在課堂上向老師確認。"
          />
        )}
      </div>
    </SiteShell>
  );
}
