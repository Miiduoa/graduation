'use client';

import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { APPEAL_STATUS_COPY, type AppealStatus } from '@campus/shared';
import { SiteShell } from '@/components/SiteShell';
import { SchoolAccountRequired } from '@/components/SchoolAccountRequired';
import { SchoolScopePlaceholder } from '@/components/SchoolScopePlaceholder';
import { useAuth } from '@/components/AuthGuard';
import { useSelectedSchool } from '@/components/SelectedSchoolProvider';
import { useDemoRole } from '@/lib/demoRole';
import {
  decideCourseAppeal,
  listTeacherAppeals,
  type TeacherAppealRow,
} from '@/lib/timetable/store';
import styles from '@/components/academic/academic.module.css';
import local from './teacherDesk.module.css';

const PAGE_TITLE = '課務申訴審核';
const PAGE_SUBTITLE = '先處理待審申訴，再查詢已完成的回覆。';
const UNCONFIRMED_DECISION = '尚未確認這次處理結果，請先重新讀取申訴。';

function ClassroomEntry() {
  return (
    <p className={styles.note}>
      <Link href="/classroom">前往授課課程（課程與作業）→</Link>
    </p>
  );
}

/** 「測試學生甲（S0000001）· 資料庫 · 期中考成績」 */
function appealHeading(item: TeacherAppealRow) {
  const who = item.studentNumber
    ? `${item.studentName}（${item.studentNumber}）`
    : item.studentName;
  return `${who} · ${item.courseName} · ${item.title}`;
}

/** 「10 月 12 日 10:00 送出」，台北時間 */
function submittedAt(item: TeacherAppealRow) {
  if (!item.createdAt) return '';
  const when = new Date(item.createdAt);
  const parts = new Intl.DateTimeFormat('zh-TW', {
    timeZone: 'Asia/Taipei',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(when);
  const get = (type: string) => parts.find((part) => part.type === type)?.value || '';
  return `${get('month')} 月 ${get('day')} 日 ${get('hour')}:${get('minute')} 送出`;
}

export default function TeacherDeskPage() {
  const { user, loading: authLoading } = useAuth();
  const school = useSelectedSchool();
  const [demoRole] = useDemoRole();
  const schoolId = school.selectedSchoolId;

  if (authLoading) {
    return (
      <SiteShell title={PAGE_TITLE} subtitle={PAGE_SUBTITLE}>
        <p role="status">正在確認登入狀態…</p>
      </SiteShell>
    );
  }

  if (
    school.loading ||
    school.catalogStatus === 'loading' ||
    school.catalogStatus === 'error' ||
    !schoolId
  ) {
    return (
      <SiteShell title={PAGE_TITLE} subtitle={PAGE_SUBTITLE}>
        <SchoolScopePlaceholder />
      </SiteShell>
    );
  }

  if (!user) {
    return (
      <SiteShell title={PAGE_TITLE} subtitle={PAGE_SUBTITLE}>
        <ClassroomEntry />
        <SchoolAccountRequired
          returnUrl={`/teacher?schoolId=${encodeURIComponent(schoolId)}&campus=${encodeURIComponent(schoolId)}`}
          alternative="授課請先到課程與作業，從你負責的那門課進去。"
        />
      </SiteShell>
    );
  }

  return <TeacherDeskContent key={`${user.uid}:${schoolId}:${demoRole}`} schoolId={schoolId} />;
}

function TeacherDeskContent({ schoolId }: { schoolId: string }) {
  const [items, setItems] = useState<TeacherAppealRow[] | null>(null);
  const [courses, setCourses] = useState<string[] | null>(null);
  const [denied, setDenied] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState('');
  const [notice, setNotice] = useState('');
  const [view, setView] = useState<'pending' | 'done'>('pending');
  const [refreshing, setRefreshing] = useState(false);
  const [mustRefresh, setMustRefresh] = useState(false);
  const mounted = useRef(false);
  const generation = useRef(0);
  const opLock = useRef(false);
  const freshRead = useRef(false);
  const queueHeading = useRef<HTMLHeadingElement>(null);

  const load = useCallback(async () => {
    if (!mounted.current) return;
    const run = ++generation.current;
    freshRead.current = false;
    setRefreshing(true);
    try {
      const result = await listTeacherAppeals(schoolId);
      if (!mounted.current || run !== generation.current) return;
      const rows = [...result.rows];
      rows.sort(
        (a, b) =>
          Date.parse(b.updatedAt || b.createdAt || '') -
          Date.parse(a.updatedAt || a.createdAt || ''),
      );
      setCourses(result.courses);
      setItems(rows);
      setDenied(false);
      setLoadError(false);
      setMustRefresh(false);
      setNotice((current) =>
        current === UNCONFIRMED_DECISION ? '已重新讀取申訴，請依最新處理狀態繼續。' : current,
      );
      freshRead.current = true;
      return true;
    } catch (error) {
      if (!mounted.current || run !== generation.current) return;
      const code = (error as { code?: string })?.code || '';
      if (code.includes('permission-denied')) setDenied(true);
      else setLoadError(true);
    } finally {
      if (mounted.current && run === generation.current) setRefreshing(false);
    }
  }, [schoolId]);

  useLayoutEffect(() => {
    mounted.current = true;
    void Promise.resolve().then(load);
    return () => {
      mounted.current = false;
      generation.current += 1;
      opLock.current = false;
      freshRead.current = false;
    };
  }, [load]);

  const decide = async (id: string, status: 'approved' | 'rejected') => {
    if (opLock.current || !mounted.current || !freshRead.current) return;
    opLock.current = true;
    freshRead.current = false;
    setBusyId(id);
    setNotice('');
    try {
      // Server rules authorize via resource.data.schoolId; only id/status/note are written.
      await decideCourseAppeal(id, status, notes[id] || '');
      if (!mounted.current) return;
      setNotice(
        status === 'approved' ? '已核准，學生那邊會看到「老師已核准。」' : '已標成不核准。',
      );
      if (await load()) queueHeading.current?.focus();
    } catch {
      if (mounted.current) {
        setMustRefresh(true);
        setNotice(UNCONFIRMED_DECISION);
      }
    } finally {
      if (mounted.current) {
        setBusyId('');
        opLock.current = false;
      }
    }
  };

  if (denied) {
    return (
      <SiteShell title={PAGE_TITLE} subtitle={PAGE_SUBTITLE}>
        <ClassroomEntry />
        <section className={styles.panel} aria-label="確認申訴審核權限">
          <h2>目前帳號沒有這所學校的申訴審核權限</h2>
          <p className={styles.notice}>若校方剛完成授課指派，可以重新確認目前帳號的權限。</p>
          {loadError && (
            <p className={styles.notice} role="alert">
              目前無法確認授課權限，請稍後重試。
            </p>
          )}
          <button className="btn" type="button" disabled={refreshing} onClick={() => void load()}>
            {refreshing ? '正在確認權限…' : '重新確認授課權限'}
          </button>
        </section>
      </SiteShell>
    );
  }

  const open = (items || []).filter(
    (item) => item.status === 'pending' || item.status === 'reviewing',
  );
  const done = (items || []).filter(
    (item) => item.status === 'approved' || item.status === 'rejected',
  );
  const countsReady = items !== null && !loadError && !mustRefresh && !refreshing;

  return (
    <SiteShell title={PAGE_TITLE} subtitle={PAGE_SUBTITLE}>
      <ClassroomEntry />
      {notice && (
        <p className={styles.note} role="status">
          {notice}
        </p>
      )}
      <div className={local.toolbar}>
        <div className={styles.segment} role="group" aria-label="申訴狀態">
          <button
            type="button"
            aria-pressed={view === 'pending'}
            disabled={Boolean(busyId)}
            onClick={() => setView('pending')}
          >
            待處理{countsReady ? ` ${open.length}` : ''}
          </button>
          <button
            type="button"
            aria-pressed={view === 'done'}
            disabled={Boolean(busyId)}
            onClick={() => setView('done')}
          >
            已處理{countsReady ? ` ${done.length}` : ''}
          </button>
        </div>
        <button
          className="btn"
          type="button"
          disabled={refreshing || Boolean(busyId)}
          onClick={() => void load()}
        >
          {refreshing ? '讀取中…' : loadError || mustRefresh ? '重新讀取申訴' : '更新申訴'}
        </button>
      </div>
      <section
        className={styles.panel}
        aria-label={view === 'pending' ? '待處理申訴' : '處理過的申訴'}
        aria-busy={refreshing}
      >
        <h2 ref={queueHeading} tabIndex={-1}>
          {view === 'pending' ? '待處理申訴' : '處理過的申訴'}
        </h2>
        {courses && courses.length > 0 && (
          <p className={styles.notice}>你教的課：{courses.join('、')}</p>
        )}
        {loadError ? (
          <p className={styles.notice} role="alert">
            現在讀不到申訴。請重新讀取，已填寫的回覆會保留。
          </p>
        ) : items === null ? (
          <p className={styles.notice} role="status">
            正在讀取申訴…
          </p>
        ) : mustRefresh ? (
          <p className={styles.notice}>重新讀取後，再確認這筆申訴是否需要處理。</p>
        ) : courses && courses.length === 0 ? (
          <p className={styles.notice}>
            你還沒有對應到任何一門課，所以看不到申訴。請學校管理者把你加到你教的課。
          </p>
        ) : view === 'done' ? (
          done.length === 0 ? (
            <p className={styles.notice}>目前沒有已處理的申訴。</p>
          ) : (
            <ul className={styles.list}>
              {done.map((item) => (
                <li key={item.id}>
                  <div>
                    <h3>{appealHeading(item)}</h3>
                    <p>{submittedAt(item)}</p>
                    <p>{APPEAL_STATUS_COPY[item.status as AppealStatus]?.detail}</p>
                    {item.teacherNote && <p>給學生的回覆：{item.teacherNote}</p>}
                  </div>
                </li>
              ))}
            </ul>
          )
        ) : open.length === 0 ? (
          <p className={styles.notice}>現在沒有待處理的申訴。</p>
        ) : (
          <ul className={styles.list}>
            {open.map((item) => (
              <li key={item.id} className={local.row}>
                <div>
                  <h3>{appealHeading(item)}</h3>
                  <p>
                    <time dateTime={item.createdAt || undefined}>{submittedAt(item)}</time>
                  </p>
                  <p>{item.body}</p>
                  <label className={styles.field}>
                    給學生的話（可不填）
                    <input
                      maxLength={500}
                      disabled={refreshing || Boolean(busyId)}
                      value={notes[item.id] || ''}
                      onChange={(event) =>
                        setNotes((current) => ({ ...current, [item.id]: event.target.value }))
                      }
                    />
                  </label>
                </div>
                <div className={local.decisions}>
                  <button
                    type="button"
                    className="btn primary"
                    disabled={Boolean(busyId) || refreshing}
                    onClick={() => void decide(item.id, 'approved')}
                  >
                    核准
                  </button>
                  <button
                    type="button"
                    className="btn"
                    disabled={Boolean(busyId) || refreshing}
                    onClick={() => void decide(item.id, 'rejected')}
                  >
                    不核准
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </SiteShell>
  );
}
