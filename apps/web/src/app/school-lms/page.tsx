'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/components/AuthGuard';
import { SchoolAccountRequired } from '@/components/SchoolAccountRequired';
import { SiteShell } from '@/components/SiteShell';
import { AcademicConnectionError } from '@/lib/academicClient';
import { isOfficialAcademicSchool } from '@/lib/academicOfficialSchool';
import { useCampusBrowseContext } from '@/lib/useCampusBrowseContext';
import { useSignInOptions } from '@/lib/signInOptions';
import {
  lmsDeadlineAxis,
  loadTronClassLms,
  type LmsHomeworkItem,
  type LmsReadonlySnapshot,
} from '@/lib/tronClassLms';
import {
  isLmsConnectingRetryReason,
  LMS_CONNECTING_RETRY_LIMIT,
  lmsConnectingRetryDelayMs,
} from '@/lib/lmsConnectingRetry';
import { loadFailureCopy } from '@campus/shared/src/loadFailureCopy';
import styles from '@/components/academic/academic.module.css';
import lmsStyles from './schoolLms.module.css';
type View = 'axis' | 'homework' | 'announcements' | 'materials';
const VIEW_LABELS: Record<View, string> = {
  axis: '今天／七天內', homework: '全部作業', announcements: '公告', materials: '教材',
};
const VIEWS: View[] = ['axis', 'homework', 'announcements', 'materials'];

type ReadState = {
  scope: string;
  status: 'loading' | 'ready' | 'error';
  snapshot?: LmsReadonlySnapshot;
  refreshing?: boolean;
  error?: unknown;
};

function areaLabel(area: string) {
  return area === 'homework' ? '作業' : area === 'announcements' ? '公告' : '教材';
}

function HomeworkCard({ item }: { item: LmsHomeworkItem }) {
  return (
    <li>
      <div className={lmsStyles.heading}>
        <h3>{item.title}</h3>
        <span className={`${lmsStyles.badge} ${item.submitted ? lmsStyles.done : lmsStyles.todo}`}>
          {item.submitted ? '已交' : '未交'}
        </span>
      </div>
      <p className={lmsStyles.meta}>{item.courseName} · {item.deadlineLabel || '截止時間未提供'}</p>
      <div className={lmsStyles.actions}>
        <Link href={`/school-lms/homework/${item.courseId}/${item.id}`}>查看說明</Link>
        <a href={item.href} target="_blank" rel="noopener noreferrer">玩課雲同一筆 ↗</a>
      </div>
    </li>
  );
}

function LmsBody({ uid, schoolId, returnUrl }: { uid: string; schoolId: 'pu'; returnUrl: string }) {
  const options = useSignInOptions();
  const params = useSearchParams();
  const [view, setView] = useState<View>('axis');
  const courseFilter = params.get('course');
  const [reload, setReload] = useState(0);
  const [refresh, setRefresh] = useState(false);
  const [autoTries, setAutoTries] = useState(0);
  const [now, setNow] = useState(() => new Date());
  const [state, setState] = useState<ReadState | null>(null);
  const courseId = courseFilter && /^[1-9]\d*$/.test(courseFilter) ? Number(courseFilter) : null;
  const scope = JSON.stringify([uid, schoolId, reload, refresh, courseId]);

  useEffect(() => {
    let active = true;
    void loadTronClassLms(uid, {
      refresh, expectedSchool: schoolId, ...(courseId ? { courseId } : {}),
    }).then((snapshot) => {
      if (!active) return;
      if (snapshot.ownerUid !== uid || snapshot.schoolId !== schoolId) {
        throw new AcademicConnectionError('unavailable');
      }
      setNow(new Date());
      setState({ scope, status: 'ready', snapshot });
    }).catch((error: unknown) => {
      if (active) setState({ scope, status: 'error', error });
    });
    return () => { active = false; };
  }, [uid, schoolId, scope, refresh, courseId]);

  const visible = state?.scope === scope ? state : null;
  const snapshot = visible?.status === 'ready' ? visible.snapshot : undefined;
  const error = visible?.error;
  const reason = error instanceof AcademicConnectionError ? error.reason : (visible?.status === 'error' ? 'unavailable' : '');
  const connecting = isLmsConnectingRetryReason(reason);
  const needsLogin = reason === 'reconnect' || reason === 'permission';
  const homework = useMemo(() => snapshot?.homework.filter((item) => !courseId || item.courseId === courseId) ?? [], [snapshot, courseId]);
  const announcements = useMemo(() => snapshot?.announcements.filter((item) => !courseId || item.courseId === courseId) ?? [], [snapshot, courseId]);
  const materials = useMemo(() => snapshot?.materials.filter((item) => !courseId || item.courseId === courseId) ?? [], [snapshot, courseId]);
  const axis = useMemo(
    () => (snapshot ? lmsDeadlineAxis({ ...snapshot, homework }, now) : { overdue: [], today: [], next7Days: [] }),
    [snapshot, homework, now],
  );
  const contentsReady = Boolean(snapshot && (
    courseId ? snapshot.contentsLoadedFor.includes(courseId) : snapshot.contentsLoadedFor.length > 0 || announcements.length > 0 || materials.length > 0
  ));

  useEffect(() => {
    if (!connecting || autoTries >= LMS_CONNECTING_RETRY_LIMIT) return;
    const timer = window.setTimeout(() => {
      setAutoTries((value) => value + 1);
      setReload((value) => value + 1);
    }, lmsConnectingRetryDelayMs(autoTries));
    return () => window.clearTimeout(timer);
  }, [connecting, autoTries, scope]);

  function refreshLms() {
    const next = reload + 1;
    const nextScope = JSON.stringify([uid, schoolId, next, true, courseId]);
    setAutoTries(0);
    setRefresh(true);
    setState((previous) => previous?.scope === scope && previous.status === 'ready'
      ? { ...previous, scope: nextScope, refreshing: true }
      : { scope: nextScope, status: 'loading' });
    setReload(next);
  }

  return (
    <>
      <div className={lmsStyles.toolbar}>
        <div className={styles.segment} role="tablist" aria-label="玩課雲資料">
          {VIEWS.map((value) => (
            <button key={value} id={`lms-tab-${value}`} type="button" role="tab"
              aria-selected={view === value} aria-controls="school-lms-results"
              onClick={() => setView(value)}>{VIEW_LABELS[value]}</button>
          ))}
        </div>
      </div>
      <section id="school-lms-results" role="tabpanel" aria-labelledby={`lms-tab-${view}`}>
        {!visible || visible.status === 'loading' ? (
          <div className={styles.status} role="status">正在讀取玩課雲作業與教材…</div>
        ) : visible.status === 'error' ? (
          connecting ? (
            <section className={styles.status} role="status">
              <h2>正在連線玩課雲</h2>
              <p>{autoTries >= LMS_CONNECTING_RETRY_LIMIT
                ? '還沒連上玩課雲，請稍後按重新讀取。'
                : '正在連線玩課雲。登入後會在背景接上課堂，完成後會自動再讀取。'}</p>
              <div className={styles.actions}>
                <button type="button" className="btn primary" onClick={refreshLms}>重新讀取</button>
                <a className="btn" href="https://tronclass.pu.edu.tw/" target="_blank" rel="noopener noreferrer">前往玩課雲 ↗</a>
              </div>
            </section>
          ) : needsLogin && !options.loading && !options.studentId ? (
            <SchoolAccountRequired returnUrl={returnUrl} alternative="請先至玩課雲查看作業。" />
          ) : (
            <section className={styles.status} role="alert">
              <h2>{needsLogin ? '請重新連線 WOW Class' : '暫時無法讀取玩課雲資料'}</h2>
              <p>{needsLogin
                ? '這次學號登入未能建立 WOW Class 連線，或連線已到期。請重新連線學校帳號。'
                : `${loadFailureCopy(error, { online: navigator.onLine })}。成績與學分可從 e 校園資料頁分別查看。`}</p>
              <div className={styles.actions}>
                {needsLogin && options.studentId ? (
                  <Link className="btn primary" href={`/login?reconnect=school&returnUrl=${encodeURIComponent(returnUrl)}`}>重新連線學校帳號</Link>
                ) : <button type="button" className="btn primary" onClick={refreshLms}>重新讀取</button>}
                <a className="btn" href="https://tronclass.pu.edu.tw/" target="_blank" rel="noopener noreferrer">前往玩課雲 ↗</a>
              </div>
            </section>
          )
        ) : snapshot ? (
          <>
            <div className={lmsStyles.source} aria-busy={visible.refreshing || undefined}>
              <div>
                <p className={lmsStyles.count}>已讀取 {snapshot.homework.length} 筆作業 · {snapshot.materials.length} 份教材</p>
                <p>來源：靜宜大學玩課雲 · {new Date(snapshot.fetchedAt).toLocaleString('zh-TW', {
                  timeZone: 'Asia/Taipei', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
                })} {snapshot.cache.hit ? '快取' : '讀取'} · 快取約 10 分鐘</p>
              </div>
              <button type="button" className="btn" disabled={visible.refreshing} onClick={refreshLms}>
                {visible.refreshing ? '更新中…' : '重新整理'}
              </button>
            </div>
            {snapshot.courseErrors.length || snapshot.siteAnnouncementError || snapshot.upcomingCoursesError ? (
              <section className={lmsStyles.errors} role="status">
                <h2>部分資料未能讀取</h2>
                <ul>
                  {snapshot.upcomingCoursesError ? <li>尚未開始的課程清單這次沒有完整回傳，進行中課程的作業仍會顯示。</li> : null}
                  {snapshot.siteAnnouncementError ? <li>全校公告這次無法讀取，不會顯示空白充數。</li> : null}
                  {snapshot.courseErrors.map((item) => (
                    <li key={`${item.courseId}:${item.area}`}>
                      {item.courseName}的{areaLabel(item.area)}暫時無法讀取
                      {item.status ? `（學校回應 ${item.status}）` : ''}，
                      <a href={`https://tronclass.pu.edu.tw/course/${item.courseId}/content`} target="_blank" rel="noopener noreferrer">改到玩課雲查看 ↗</a>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
            {view === 'axis' ? (
              <div className={lmsStyles.axis}>
                <section>
                  <h2>已逾期</h2>
                  {axis.overdue.length ? (
                    <ul className={lmsStyles.list}>
                      {axis.overdue.map((item) => (
                        <HomeworkCard key={`${item.courseId}:${item.id}`} item={item} />
                      ))}
                    </ul>
                  ) : <p className={styles.note}>目前沒有逾期未交的作業。</p>}
                </section>
                <section>
                  <h2>今天截止</h2>
                  {axis.today.length ? (
                    <ul className={lmsStyles.list}>
                      {axis.today.map((item) => (
                        <HomeworkCard key={`${item.courseId}:${item.id}`} item={item} />
                      ))}
                    </ul>
                  ) : <p className={styles.note}>今天沒有未交且尚未截止的作業。</p>}
                </section>
                <section>
                  <h2>七天內截止</h2>
                  {axis.next7Days.length ? (
                    <ul className={lmsStyles.list}>
                      {axis.next7Days.map((item) => (
                        <HomeworkCard key={`${item.courseId}:${item.id}`} item={item} />
                      ))}
                    </ul>
                  ) : <p className={styles.note}>七天內沒有其他未交作業。</p>}
                </section>
              </div>
            ) : null}
            {view === 'homework' ? (
              homework.length ? (
                <ul className={lmsStyles.list}>
                  {homework.map((item) => (
                    <HomeworkCard key={`${item.courseId}:${item.id}`} item={item} />
                  ))}
                </ul>
              ) : <div className={styles.status} role="status"><h2>目前沒有作業資料</h2><p>若上方有讀取錯誤，請改到玩課雲核對，不要把這當成「沒有作業」。</p></div>
            ) : null}
            {view === 'announcements' || view === 'materials' ? (
              !contentsReady && !courseId ? (
                <div className={styles.status} role="status">
                  <h2>{view === 'announcements' ? '進入課程後才讀取公告' : '進入課程後才讀取教材'}</h2>
                  <p>為減少對學校的請求，公告與教材不會在打開清單時一次抓完全部課程。請點一門課再查看。</p>
                  {snapshot?.courses.length ? (
                    <ul className={lmsStyles.list}>
                      {snapshot.courses.map((course) => (
                        <li key={course.id}>
                          <h3>{course.name}</h3>
                          <div className={lmsStyles.actions}>
                            <Link href={`/school-lms?course=${course.id}`}>{view === 'announcements' ? '讀取此課公告' : '讀取此課教材'}</Link>
                          </div>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              ) : view === 'announcements' ? (
                announcements.length ? (
                  <ul className={lmsStyles.list}>
                    {announcements.map((item) => (
                      <li key={item.id}>
                        <h3>{item.title}</h3>
                        <p className={lmsStyles.meta}>{item.courseName || '全校'} · {item.content ? item.content.slice(0, 160) : '沒有內文'}</p>
                        <div className={lmsStyles.actions}>
                          <a href={item.href} target="_blank" rel="noopener noreferrer">玩課雲同一筆 ↗</a>
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : <div className={styles.status} role="status"><h2>目前沒有公告資料</h2><p>若學校端未開放公告或這次讀取失敗，這裡不會用空白清單冒充。</p></div>
              ) : materials.length ? (
                <ul className={lmsStyles.list}>
                  {materials.map((item) => (
                    <li key={`${item.courseId}:${item.id}`}>
                      <h3>{item.title}</h3>
                      <p className={lmsStyles.meta}>{item.courseName} · {item.type}</p>
                      {item.files.length ? (
                        <ul>
                          {item.files.map((file) => (
                            <li key={file.name}>
                              {file.allowDownload && file.downloadHref ? (
                                <a href={file.downloadHref} target="_blank" rel="noopener noreferrer">{file.name}（下載）</a>
                              ) : <span>{file.name}（學校未開放下載，請到玩課雲查看）</span>}
                            </li>
                          ))}
                        </ul>
                      ) : null}
                      <div className={lmsStyles.actions}>
                        <a href={item.href} target="_blank" rel="noopener noreferrer">玩課雲同一筆 ↗</a>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : <div className={styles.status} role="status"><h2>目前沒有教材資料</h2><p>未開放下載的檔案不會提供下載連結。</p></div>
            ) : null}
          </>
        ) : null}
      </section>
      <p className={styles.note}>這裡只讀取玩課雲的作業、公告與教材，不會上傳或繳交。已交的作業不會出現在待辦；逾期未交會列在「已逾期」，不會混進今天截止。</p>
    </>
  );
}

export default function SchoolLmsPage() {
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
    <SiteShell title="玩課雲作業與教材" subtitle="跨課程查看截止、已交狀態、公告與可下載教材。">
      {loading || browse.status === 'loading' ? (
        <div className={styles.status} role="status">正在確認學校與帳號…</div>
      ) : browse.status === 'error' || error ? (
        <section className={styles.status} role="alert"><h2>暫時無法確認學校與帳號</h2><p>請重新整理後再讀取。</p></section>
      ) : browse.status !== 'ready' || !browse.schoolId ? (
        <section className={styles.status}><h2>請先選擇一所學校</h2><p>選擇校園後，再連線該校的學習平臺。</p></section>
      ) : !isOfficialAcademicSchool(browse.schoolId) ? (
        <section className={styles.status}><h2>這所學校的課堂連線尚未接通</h2><p>目前無法讀取「{browse.schoolName}」的學習平臺。</p></section>
      ) : !user ? (
        <SchoolAccountRequired returnUrl={returnUrl} alternative="請先至玩課雲查看作業。" />
      ) : <LmsBody key={`${user.uid}:${browse.schoolId}`} uid={user.uid} schoolId={browse.schoolId} returnUrl={returnUrl} />}
    </SiteShell>
  );
}
