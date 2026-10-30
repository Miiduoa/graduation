'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { NuniError, nuniErrorMessage } from '@campus/shared/src/nuni';
import { AppHeader } from '@/components/AppHeader';
import { QuickCampusEntry } from '@/components/QuickCampusEntry';
import { SiteFooter } from '@/components/SiteFooter';
import { useAuth } from '@/components/AuthGuard';
import { AccountIdentity } from '@/components/AccountIdentity';
import { browserRequest, useNuniSession } from '@/features/nuni/Session';
import type { HomeCourse, HomeData } from '@/lib/homeOverview';
import { loadNuniHomeData } from '@/lib/nuniHomeOverview';
import { useClientHydrated } from '@/lib/useClientHydrated';
import { useOptionalSelectedSchool } from '@/components/SelectedSchoolProvider';
import { isTeacherRole, useSchoolRole } from '@/lib/useSchoolRole';
import { StudentTodayPage } from '@/components/today/StudentToday';
import { todayTodosFromHomeTasks } from '@/lib/todayScreen';
import styles from './home.module.css';

const teachingRoles = ['owner', 'instructor', 'moderator', 'owner-teacher', 'co-teacher'];
const courseHref = (course: HomeCourse) =>
  course.href ?? `/course/${encodeURIComponent(course.id)}`;

export default function HomePage() {
  const hydrated = useClientHydrated();
  const { user, loading: authLoading } = useAuth();
  const nuni = useNuniSession();
  const refreshSession = nuni.refresh;
  const context = hydrated ? nuni.session?.context : undefined;
  const accountId = hydrated ? nuni.session?.platformAccountId : undefined;
  const uid = hydrated ? user?.uid : undefined;
  const school = useOptionalSelectedSchool();
  const role = useSchoolRole(uid, school?.selectedSchoolId || 'pu');
  const owner =
    context && accountId ? `nuni:${context}:${accountId}` : uid ? `school:${uid}` : null;
  const sessionLoading = !hydrated || authLoading || nuni.loading;
  const blocked = nuni.pendingLogout || (!!nuni.error && !uid);
  const [result, setResult] = useState<{
    owner: string;
    data: HomeData;
    updatedAt: Date;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [failure, setFailure] = useState<{ owner: string; message: string } | null>(null);
  const [now, setNow] = useState<Date | null>(null);
  const [leavingTodoIds, setLeavingTodoIds] = useState<string[]>([]);
  const previousTodos = useRef<string[]>([]);
  const generation = useRef(0);
  const data = !sessionLoading && !blocked && result?.owner === owner ? result?.data : null;
  const updatedAt = data ? result!.updatedAt : null;
  const error = failure?.owner === owner ? (failure?.message ?? '') : '';
  const refresh = useCallback(async () => {
    const request = ++generation.current;
    setFailure(null);
    if (!owner || sessionLoading || blocked) {
      setResult(null);
      setLoading(false);
      return;
    }
    setResult((current) => (current?.owner === owner ? current : null));
    setLoading(true);
    try {
      const next =
        context && accountId
          ? await loadNuniHomeData((path, input) => browserRequest(path, context, input), accountId)
          : { courses: [], tasks: [], unreadCount: 0 };
      if (request === generation.current) {
        setResult({ owner, data: next, updatedAt: new Date() });
      }
    } catch (failure) {
      if (request === generation.current) {
        setResult(null);
        setFailure({
          owner,
          message: context ? nuniErrorMessage(failure) : '無法讀取課程資料，請確認連線後重試。',
        });
        if (
          context &&
          failure instanceof NuniError &&
          (failure.status === 401 || failure.code === 'SESSION_CHANGED')
        )
          void refreshSession();
      }
    } finally {
      if (request === generation.current) setLoading(false);
    }
  }, [owner, context, accountId, sessionLoading, blocked, refreshSession]);
  useEffect(() => {
    void refresh();
    return () => {
      generation.current += 1;
    };
  }, [refresh]);
  useEffect(() => {
    const onShow = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    window.addEventListener('pageshow', onShow);
    document.addEventListener('visibilitychange', onShow);
    return () => {
      window.removeEventListener('pageshow', onShow);
      document.removeEventListener('visibilitychange', onShow);
    };
  }, [refresh]);
  useEffect(() => {
    const tick = () => setNow(new Date());
    tick();
    const timer = setInterval(tick, 60_000);
    return () => clearInterval(timer);
  }, []);

  const teaching = data?.courses.filter((course) => teachingRoles.includes(course.role)) ?? [];
  const studying = data?.courses.filter((course) => !teachingRoles.includes(course.role)) ?? [];
  const signedIn = !!owner && !blocked;
  const busy = sessionLoading || (!!owner && !data && !error);
  const teacherOnly = !!teaching.length && !studying.length;
  const todos = useMemo(() => (data ? todayTodosFromHomeTasks(data.tasks) : []), [data]);
  useEffect(() => {
    const current = todos.map((item) => item.id);
    const gone = previousTodos.current.filter((id) => !current.includes(id));
    previousTodos.current = current;
    if (!gone.length) return;
    setLeavingTodoIds(gone);
    const timer = window.setTimeout(() => setLeavingTodoIds([]), 200);
    return () => window.clearTimeout(timer);
  }, [todos]);
  const lmsUnconnected = signedIn && !!data && !error && data.courses.length === 0;

  return (
    <div className={styles.page}>
      <a href="#today-content" className={styles.skip}>
        跳到主要內容
      </a>
      <AppHeader />
      <main id="today-content" className={styles.main} tabIndex={-1}>
        <QuickCampusEntry />
        {!sessionLoading && uid && !context ? (
          <p className={styles.notice}>
            E 校園與 TronClass 的學校來源已停用。<Link href="/classroom">前往 nuni 課程</Link>
          </p>
        ) : null}
        {isTeacherRole(role) && (
          <p className={styles.notice}>
            <Link href="/teacher">老師工作台 →</Link> 看學生送來的課程申訴。
          </p>
        )}
        {blocked ? (
          <section className={styles.focus} aria-labelledby="session-title">
            <h2 id="session-title">
              {nuni.pendingLogout ? '登出尚未完成' : '暫時無法確認 Google 帳號'}
            </h2>
            <p role="alert">{nuni.error || '請重試登出，再切換帳號。'}</p>
            <div className={styles.focusActions}>
              <button
                type="button"
                className={styles.primary}
                onClick={() => void (nuni.pendingLogout ? nuni.logout() : nuni.refresh())}
                disabled={sessionLoading}
              >
                {nuni.pendingLogout ? '重試登出' : '重新確認登入'}
              </button>
            </div>
          </section>
        ) : teacherOnly ? (
          <section className={styles.focus} aria-labelledby="focus-title">
            <div className={styles.focusLabel}>教學安排</div>
            <h2 id="focus-title">{`${teaching.length} 門課正在進行`}</h2>
            <p>從授課課程查看學生繳交內容，安排教材與下一次作業。</p>
            <div className={styles.focusActions}>
              <Link className={styles.primary} href="#teaching-courses">
                查看授課課程 <span aria-hidden>→</span>
              </Link>
              <Link className={styles.secondary} href="/timetable">
                查看課表
              </Link>
            </div>
          </section>
        ) : (
          <StudentTodayPage
            now={now}
            updatedAt={updatedAt}
            signedIn={signedIn}
            unsigned={!signedIn}
            skeleton={busy}
            refreshing={loading && !!data}
            todos={todos}
            courses={data?.courses ?? []}
            todosError={error || data?.tasksError || ''}
            lmsUnconnected={lmsUnconnected}
            leavingTodoIds={leavingTodoIds}
            onRetryTodos={() => void refresh()}
          />
        )}
        {data && teaching.length > 0 ? (
          <section
            id="teaching-courses"
            className={styles.section}
            aria-labelledby="teaching-title"
          >
            <div className={styles.sectionHeading}>
              <h2 id="teaching-title">
                授課與協作 <span>{teaching.length}</span>
              </h2>
            </div>
            <div className={styles.courses}>
              {teaching.map((course) => (
                <Link key={course.id} href={courseHref(course)} className={styles.course}>
                  <span>
                    {course.role === 'owner-teacher'
                      ? '課程建立者'
                      : course.role === 'co-teacher'
                        ? '協同教師'
                        : '授課成員'}
                  </span>
                  <h3>{course.name}</h3>
                </Link>
              ))}
            </div>
          </section>
        ) : null}
        {signedIn && context && accountId ? (
          <AccountIdentity
            key={`identity:${accountId}:${context}`}
            context={context}
            accountId={accountId}
          />
        ) : null}
        <SiteFooter />
      </main>
    </div>
  );
}
