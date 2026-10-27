'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/components/AuthGuard';
import { SchoolAccountRequired } from '@/components/SchoolAccountRequired';
import { SiteShell } from '@/components/SiteShell';
import { AcademicNavigation } from '@/components/academic/AcademicNavigation';
import { AcademicConnectionError } from '@/lib/academicClient';
import { formatSemester } from '@/lib/academicRecords';
import { isOfficialAcademicSchool } from '@/lib/academicOfficialSchool';
import { useCampusBrowseContext } from '@/lib/useCampusBrowseContext';
import { useSignInOptions } from '@/lib/signInOptions';
import { loadTronClassCourses, type SchoolLmsSnapshot, type TronClassCourseStatus } from '@/lib/tronClassCourses';
import { loadFailureCopy } from '@campus/shared/src/loadFailureCopy';
import styles from '@/components/academic/academic.module.css';
import courseStyles from './schoolCourses.module.css';

const STATUS_LABELS: Record<TronClassCourseStatus, string> = {
  ongoing: '進行中', completed: '已結束', upcoming: '未開始',
};
const COURSE_STATUSES: TronClassCourseStatus[] = ['ongoing', 'completed', 'upcoming'];
type CourseReadState = {
  scope: string;
  status: 'loading' | 'ready' | 'error';
  snapshot?: SchoolLmsSnapshot;
  refreshing?: boolean;
  error?: unknown;
};

function Courses({ uid, schoolId, returnUrl }: { uid: string; schoolId: 'pu'; returnUrl: string }) {
  const options = useSignInOptions();
  const [status, setStatus] = useState<TronClassCourseStatus>('ongoing');
  const [search, setSearch] = useState('');
  const [reload, setReload] = useState(0);
  const [state, setState] = useState<CourseReadState | null>(null);
  const scope = JSON.stringify([uid, schoolId, status, reload]);

  useEffect(() => {
    let active = true;
    void loadTronClassCourses(uid, status, schoolId).then((snapshot) => {
      if (!active) return;
      if (snapshot.ownerUid !== uid || snapshot.schoolId !== schoolId || snapshot.status !== status) {
        throw new AcademicConnectionError('unavailable');
      }
      setState({ scope, status: 'ready', snapshot });
    }).catch((error: unknown) => {
      if (active) setState({ scope, status: 'error', error });
    });
    return () => { active = false; };
  }, [uid, schoolId, status, scope, reload]);

  const visible = state?.scope === scope ? state : null;
  const snapshot = visible?.status === 'ready' ? visible.snapshot : undefined;
  const rows = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return snapshot?.courses.filter((course) => !query || [course.name, course.code, ...course.teachers]
      .some((value) => value.toLocaleLowerCase().includes(query))) ?? [];
  }, [snapshot, search]);
  const error = visible?.error;
  const reason = error instanceof AcademicConnectionError ? error.reason : 'unavailable';
  const needsLogin = reason === 'reconnect' || reason === 'permission';
  function selectStatus(next: TronClassCourseStatus) {
    if (next === status) return;
    setStatus(next);
    setReload((value) => value + 1);
  }
  function refreshCourses() {
    const next = reload + 1;
    const nextScope = JSON.stringify([uid, schoolId, status, next]);
    setState((previous) => previous?.scope === scope && previous.status === 'ready'
      ? { ...previous, scope: nextScope, refreshing: true }
      : { scope: nextScope, status: 'loading' });
    setReload(next);
  }

  return (
    <>
      <div className={courseStyles.toolbar}>
        <div className={styles.segment} role="tablist" aria-label="WOW Class 課程狀態">
          {(Object.entries(STATUS_LABELS) as [TronClassCourseStatus, string][]).map(([value, label]) => (
            <button key={value} id={`courses-tab-${value}`} type="button" role="tab"
              aria-selected={status === value} aria-controls="school-course-results"
              tabIndex={status === value ? 0 : -1}
              onKeyDown={(event) => {
                const index = COURSE_STATUSES.indexOf(value);
                const next = event.key === 'ArrowRight' ? COURSE_STATUSES[(index + 1) % COURSE_STATUSES.length]
                  : event.key === 'ArrowLeft' ? COURSE_STATUSES[(index + COURSE_STATUSES.length - 1) % COURSE_STATUSES.length]
                  : event.key === 'Home' ? COURSE_STATUSES[0]
                  : event.key === 'End' ? COURSE_STATUSES[COURSE_STATUSES.length - 1] : null;
                if (!next) return;
                event.preventDefault();
                selectStatus(next);
                document.getElementById(`courses-tab-${next}`)?.focus();
              }}
              onClick={() => selectStatus(value)}>{label}</button>
          ))}
        </div>
        <label className={styles.field}>
          搜尋課程、代碼或老師
          <input type="search" placeholder="例如：統計學、王老師" value={search}
            onChange={(event) => setSearch(event.target.value)} />
        </label>
      </div>
      <section id="school-course-results" role="tabpanel" aria-labelledby={`courses-tab-${status}`}>
        {!visible || visible.status === 'loading' ? (
          <div className={styles.status} role="status">正在讀取 WOW Class 課程…</div>
        ) : visible.status === 'error' ? (
          needsLogin && !options.loading && !options.studentId ? (
            <SchoolAccountRequired returnUrl={returnUrl} alternative="請先至 WOW Class 查看課程。" />
          ) : (
            <section className={styles.status} role="alert">
              <h2>{needsLogin ? '請重新連線 WOW Class' : '暫時無法讀取 WOW Class 課程'}</h2>
              <p>{needsLogin
                ? '這次學號登入未能建立 WOW Class 連線，或連線已到期。你可以重新連線；若學校服務仍無回應，可先前往 WOW Class 查看課堂。'
                : `${loadFailureCopy(error, { online: navigator.onLine })}。成績與學分可從 e 校園資料頁分別查看。`}</p>
              <div className={styles.actions}>
                {needsLogin && options.studentId ? (
                  <Link className="btn primary" href={`/login?reconnect=school&returnUrl=${encodeURIComponent(returnUrl)}`}>重新連線學校帳號</Link>
                ) : <button type="button" className="btn primary" onClick={refreshCourses}>重新讀取課程</button>}
                <a className="btn" href="https://tronclass.pu.edu.tw/" target="_blank" rel="noopener noreferrer">前往 WOW Class ↗</a>
              </div>
            </section>
          )
        ) : snapshot ? (
          <>
            <div className={courseStyles.source} aria-busy={visible.refreshing || undefined}>
              <div>
                <p className={courseStyles.count}>{STATUS_LABELS[status]} · 已讀取 {snapshot.courses.length} 門課程</p>
                <p>來源：靜宜大學 WOW Class · {new Date(snapshot.fetchedAt).toLocaleString('zh-TW', {
                  timeZone: 'Asia/Taipei', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
                })} 讀取</p>
              </div>
              <button type="button" className="btn" disabled={visible.refreshing} onClick={refreshCourses}>
                {visible.refreshing ? '更新中…' : '更新課程'}
              </button>
            </div>
            {search.trim() && <p className={styles.resultCount} role="status">
              找到 {rows.length} 門課程
              <button type="button" onClick={() => setSearch('')}>清除搜尋</button>
            </p>}
            {rows.length ? <ul className={courseStyles.courses}>
              {rows.map((course) => <li key={course.id}>
                <p className={courseStyles.code}>{course.code || '課程代碼未提供'}</p>
                <h2>{course.name}</h2>
                <dl>
                  <div><dt>授課教師</dt><dd>{course.teachers.length ? course.teachers.join('、') : '未提供'}</dd></div>
                  <div><dt>學期</dt><dd>{formatSemester(course.semester)}</dd></div>
                </dl>
                <a href={course.href} target="_blank" rel="noopener noreferrer" aria-label={`前往 ${course.name} 的 WOW Class 課堂`}>開啟課堂 ↗</a>
              </li>)}
            </ul> : <div className={styles.status} role="status">
              <h2>{snapshot.courses.length ? '沒有符合搜尋條件的課程' : `WOW Class 這次未回傳${STATUS_LABELS[status]}課程`}</h2>
              <p>{snapshot.courses.length ? '試試課程名稱、四碼代碼或老師姓名。' : '可以切換課程狀態，或至學校平臺核對；這不表示沒有正式選課紀錄。'}</p>
            </div>}
          </>
        ) : null}
      </section>
      <p className={styles.note}>這裡顯示 WOW Class 課堂清單。正式選課、歷年成績及畢業採計學分請分別查看「我的課表」、「成績紀錄」與「學分規劃」。</p>
    </>
  );
}

export default function SchoolCoursesPage() {
  const { user, loading, error } = useAuth();
  const path = usePathname();
  const params = useSearchParams();
  const browse = useCampusBrowseContext({
    school: params.get('school') ?? undefined,
    schoolId: params.get('schoolId') ?? undefined,
    campus: params.get('campus') ?? undefined,
  });
  const returnUrl = `${path}${browse.schoolSearch}`;
  return (
    <SiteShell title="WOW Class 課程" subtitle="找到正在上的課，接著查看教材、作業與課堂公告。">
      <AcademicNavigation path={path} schoolSearch={browse.schoolSearch} />
      {loading || browse.status === 'loading' ? (
        <div className={styles.status} role="status">正在確認學校與帳號…</div>
      ) : browse.status === 'error' || error ? (
        <section className={styles.status} role="alert"><h2>暫時無法確認學校與帳號</h2><p>請重新整理後再讀取課程。</p></section>
      ) : browse.status !== 'ready' || !browse.schoolId ? (
        <section className={styles.status}><h2>請先選擇一所學校</h2><p>選擇校園後，再連線該校的學習平臺。</p></section>
      ) : !isOfficialAcademicSchool(browse.schoolId) ? (
        <section className={styles.status}><h2>這所學校的課堂連線尚未接通</h2><p>目前無法讀取「{browse.schoolName}」的學習平臺，不會顯示其他學校的課程。</p></section>
      ) : !user ? (
        <SchoolAccountRequired returnUrl={returnUrl} alternative="請先至 WOW Class 查看課程。" />
      ) : <Courses key={`${user.uid}:${browse.schoolId}`} uid={user.uid} schoolId={browse.schoolId} returnUrl={returnUrl} />}
    </SiteShell>
  );
}
