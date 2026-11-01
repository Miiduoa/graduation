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
import { loadHomeData, type HomeCourse, type HomeData } from '@/lib/homeOverview';
import { loadNuniHomeSections } from '@/lib/nuniHomeOverview';
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
    context && accountId
      ? `nuni:${context}:${accountId}:school:${uid ?? ''}`
      : uid
        ? `school:${uid}`
        : null;
  const sessionLoading = !hydrated || authLoading || nuni.loading;
  const blocked = nuni.pendingLogout || (!!nuni.error && !uid);
  type Source = 'nuni' | 'school';
  type Section = { data?: HomeData; error?: string; loading: boolean; updatedAt?: Date };
  const [sections, setSections] = useState<{
    owner: string;
    rows: Partial<Record<Source, Section>>;
  } | null>(null);
  const [now, setNow] = useState<Date | null>(null);
  const [leavingTodoIds, setLeavingTodoIds] = useState<string[]>([]);
  const previousTodos = useRef<string[]>([]);
  const generation = useRef(0);
  const attempts = useRef({ nuni: 0, school: 0 });
  const inFlight = useRef<Partial<Record<Source, number>>>({});
  const rows = useMemo(
    () => (!sessionLoading && !blocked && sections?.owner === owner ? sections.rows : {}),
    [sessionLoading, blocked, sections, owner],
  );
  const data = useMemo<HomeData | null>(() => {
    const books = Object.values(rows).flatMap((row) => (row.data ? [row.data] : []));
    return books.length
      ? {
          ...books[0],
          courses: books.flatMap((book) => book.courses),
          tasks: books.flatMap((book) => book.tasks),
          recentFeedback: books.flatMap((book) => book.recentFeedback ?? []),
          unreadCount: books.reduce((sum, book) => sum + book.unreadCount, 0),
          tasksError: books
            .map((book) => book.tasksError)
            .filter(Boolean)
            .join('；'),
        }
      : null;
  }, [rows]);
  const loading = Object.values(rows).some((row) => row.loading);
  const failed = Object.values(rows).some((row) => row.error);
  const error = failed ? '部分課程資料尚未讀到，請重試。' : '';
  const updatedAt = Object.values(rows).find((row) => row.updatedAt)?.updatedAt ?? null;
  const readSource = useCallback(
    async (source: Source, request: number) => {
      if (!owner || sessionLoading || blocked) return;
      if (inFlight.current[source] === request) return;
      inFlight.current[source] = request;
      const attempt = ++attempts.current[source];
      const update = (change: Partial<Section>, initial = false) => {
        if (request !== generation.current || attempt !== attempts.current[source]) return;
        setSections((current) => ({
          owner,
          rows: {
            ...(current?.owner === owner ? current.rows : {}),
            [source]: {
              ...(current?.owner === owner ? current.rows[source] : {}),
              loading: false,
              ...change,
              ...(initial && current?.owner === owner && current.rows[source]?.data
                ? { data: current.rows[source]?.data }
                : {}),
            },
          },
        }));
      };
      update({ loading: true, error: undefined });
      try {
        const next =
          source === 'nuni'
            ? await loadNuniHomeSections(
                (path, input) => browserRequest(path, context!, input),
                accountId!,
                (courses) => update({ data: courses, loading: true }, true),
              )
            : await loadHomeData(uid!);
        update({ data: next, updatedAt: new Date(), error: undefined });
      } catch (failure) {
        const schoolCode =
          source === 'school' && failure && typeof failure === 'object' && 'code' in failure
            ? failure.code
            : undefined;
        const accessRevoked =
          source === 'nuni'
            ? failure instanceof NuniError &&
              (failure.status === 401 ||
                failure.status === 403 ||
                failure.code === 'SESSION_CHANGED')
            : schoolCode === 'permission-denied' || schoolCode === 'unauthenticated';
        const recoverable =
          source === 'school'
            ? [
                'unavailable',
                'deadline-exceeded',
                'aborted',
                'resource-exhausted',
                'internal',
                'unknown',
              ].includes(String(schoolCode))
            : failure instanceof NuniError &&
              (failure.status >= 500 || failure.code === 'NETWORK_ERROR');
        update({
          ...(accessRevoked || !recoverable ? { data: undefined, updatedAt: undefined } : {}),
          error:
            source === 'nuni'
              ? nuniErrorMessage(failure)
              : schoolCode === 'permission-denied'
                ? '校園課程存取權限已失效，請確認課程權限後重試。'
                : schoolCode === 'unauthenticated'
                  ? '校園登入驗證已失效，請重新登入後重試。'
                  : '課程暫時讀不到，請再試一次。',
        });
        if (
          request === generation.current &&
          attempt === attempts.current[source] &&
          source === 'nuni' &&
          failure instanceof NuniError &&
          (failure.status === 401 || failure.code === 'SESSION_CHANGED')
        )
          void refreshSession();
      } finally {
        if (inFlight.current[source] === request) delete inFlight.current[source];
      }
    },
    [owner, sessionLoading, blocked, context, accountId, uid, refreshSession],
  );
  const refresh = useCallback(async () => {
    const request = generation.current;
    if (!owner || sessionLoading || blocked) {
      setSections(null);
      return;
    }
    await Promise.all([
      ...(context && accountId ? [readSource('nuni', request)] : []),
      ...(uid ? [readSource('school', request)] : []),
    ]);
  }, [owner, sessionLoading, blocked, context, accountId, uid, readSource]);
  useEffect(() => {
    generation.current += 1;
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
  const [presentation, setPresentation] = useState<{ owner: string; teacherOnly: boolean } | null>(
    null,
  );
  const presentationReady = presentation?.owner === owner;
  const sources: Source[] = [
    ...(context && accountId ? ['nuni' as const] : []),
    ...(uid ? ['school' as const] : []),
  ];
  if (!owner || sessionLoading || blocked || !sources.length) {
    if (presentation) setPresentation(null);
  } else if (sources.every((source) => rows[source] && !rows[source]?.loading)) {
    const nextTeacherOnly =
      !!teaching.length &&
      !studying.length &&
      !data?.tasks.length &&
      (!failed || presentationReady);
    if (!presentationReady || presentation.teacherOnly !== nextTeacherOnly)
      setPresentation({ owner, teacherOnly: nextTeacherOnly });
  }
  const teacherOnly = presentationReady && presentation.teacherOnly;
  const todos = useMemo(() => todayTodosFromHomeTasks(data?.tasks ?? []), [data]);
  useEffect(() => {
    const current = todos.map((item) => item.id);
    const gone = previousTodos.current.filter((id) => !current.includes(id));
    previousTodos.current = current;
    if (!gone.length) return;
    setLeavingTodoIds(gone);
    const timer = window.setTimeout(() => setLeavingTodoIds([]), 200);
    return () => window.clearTimeout(timer);
  }, [todos]);
  const lmsUnconnected =
    signedIn && !!data && !error && !loading && !failed && data.courses.length === 0;

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
            onRetryTodos={() => {
              const incomplete = Object.entries(rows).filter(
                ([, row]) => !row.loading && (row.error || row.data?.tasksError),
              );
              incomplete.forEach(
                ([source]) => void readSource(source as Source, generation.current),
              );
            }}
          />
        )}
        {signedIn ? (
          <div className={styles.sourceStatuses} aria-label="課程來源狀態">
            {(['nuni', 'school'] as const)
              .filter((source) => (source === 'nuni' ? context && accountId : uid))
              .map((source) => {
                const row = rows[source];
                return (
                  <section
                    key={source}
                    className={styles.sourceStatus}
                    aria-label={source === 'nuni' ? 'nuni 課程讀取狀態' : '校園課程讀取狀態'}
                    aria-busy={row?.loading ?? true}
                  >
                    <div aria-live="polite">
                      {!row || row.loading ? (
                        <>
                          <p>
                            {source === 'nuni' ? 'nuni' : '校園'}課程還在讀取，其他內容可以先看。
                          </p>
                        </>
                      ) : row.error ? (
                        <>
                          <p>{row.error}</p>
                          <button
                            type="button"
                            onClick={() => void readSource(source, generation.current)}
                          >
                            重試{source === 'nuni' ? ' nuni ' : '校園'}課程
                          </button>
                        </>
                      ) : (
                        <p>{source === 'nuni' ? 'nuni' : '校園'}課程已讀取。</p>
                      )}
                    </div>
                  </section>
                );
              })}
          </div>
        ) : null}
        {data?.recentFeedback?.length ? (
          <section className={styles.section} aria-labelledby="feedback-title">
            <h2 id="feedback-title">最近公布的成績與回饋</h2>
            {data.recentFeedback.map((item) => (
              <Link key={item.href} href={item.href} className={styles.course}>
                <span>
                  {item.courseName} · {item.title}
                </span>
                {item.score !== null ? <span>成績：{item.score}</span> : null}
                {item.feedback ? <span>老師評語：{item.feedback}</span> : null}
              </Link>
            ))}
          </section>
        ) : null}
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
