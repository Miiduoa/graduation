'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { NuniError, nuniErrorMessage } from '@campus/shared/src/nuni';
import { AppHeader } from '@/components/AppHeader';
import { SiteFooter } from '@/components/SiteFooter';
import { useAuth } from '@/components/AuthGuard';
import { AccountIdentity } from '@/components/AccountIdentity';
import { NextClassCard, TodayTimetable } from '@/components/timetable/TodayTimetable';
import { browserRequest, useNuniSession } from '@/features/nuni/Session';
import { FeedbackList } from '@/components/home/FeedbackList';
import { loadHomeData, type HomeCourse, type HomeData, type HomeMaterial, type HomeTask } from '@/lib/homeOverview';
import { loadNuniHomeData } from '@/lib/nuniHomeOverview';
import { CourseMaterialSearch } from '@/features/nuni/CourseMaterialSearch';
import { isMaterialNew, isMaterialUnread } from '@/lib/courseMaterials';
import { publicCampusServices } from '@/lib/publicCampusServices';
import { useOptionalSelectedSchool } from '@/components/SelectedSchoolProvider';
import { isTeacherRole, useSchoolRole } from '@/lib/useSchoolRole';
import { TodaySensePanel } from '@/components/TodaySensePanel';
import { HomeCampusBusCard } from '@/components/HomeCampusBusCard';
import { CampusIcon, type CampusIconName } from '@/components/CampusIcon';
import { CampusWeek } from '@/components/CampusWeek';
import { hasCampusNext } from '@/lib/transit';
import {
  LATER_WORK_TITLE,
  TODAY_WORK_EMPTY,
  TODAY_WORK_NO_CLASS,
  TODAY_WORK_NOTE,
  TODAY_WORK_TITLE,
  TODAY_WORK_UNSIGNED,
  courseTaskHref,
  selectLaterCourseWork,
  selectTodayCourseWork,
} from '@/lib/todayCourseWork';
import {
  emptySenseState,
  selectSenseCards,
  type SenseInputItem,
  type SensePhase,
} from '@campus/shared/src/todaySense';
import styles from './home.module.css';

const teachingRoles = ['owner', 'instructor', 'moderator', 'owner-teacher', 'co-teacher'];
const courseHref = (course: HomeCourse) =>
  course.href ?? `/course/${encodeURIComponent(course.id)}`;
const serviceIcons: Record<string, CampusIconName> = {
  '/map': 'map',
  '/bus': 'bus',
  '/announcements': 'announcements',
  '/cafeteria': 'cafeteria',
  '/library': 'library',
};

function MaterialList({ items }: { items: HomeMaterial[] }) {
  return (
    <ul className={styles.list} data-testid="today-material-list">
      {items.map((item) => (
        <li key={`${item.courseId}-${item.id}`}>
          <Link href={item.href} className={styles.task}>
            <span className={styles.taskMarker} aria-hidden="true">
              <CampusIcon name="course" size={20} />
            </span>
            <span className={styles.taskContent}>
              <strong>{item.title}</strong>
              <span>
                {item.courseName}
                {item.unitTitle ? ` · ${item.unitTitle}` : ''}
                {' · 教材'}
              </span>
            </span>
            <span className={styles.deadline}>開啟這份教材</span>
            <span aria-hidden className={styles.arrow}>
              →
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function WorkList({ tasks, now, testId }: { tasks: HomeTask[]; now: Date | null; testId: string }) {
  return (
    <ul className={styles.list} data-testid={testId}>
      {tasks.map((task) => (
        <li key={`${task.courseId}-${task.id}`}>
          <Link href={courseTaskHref(task)} className={styles.task}>
            <span className={styles.taskMarker} aria-hidden="true">
              <CampusIcon name={task.kind === 'quiz' ? 'course' : 'calendar'} size={20} />
            </span>
            <span className={styles.taskContent}>
              <strong>{task.title}</strong>
              <span>
                {task.courseName} · {task.kind === 'quiz' ? '測驗' : '作業'}
              </span>
            </span>
            <Deadline task={task} now={now} />
            <span aria-hidden className={styles.arrow}>
              →
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function Deadline({ task, now }: { task: HomeTask; now: Date | null }) {
  const due = task.dueAt ? new Date(task.dueAt) : null;
  const overdue = !!(due && now && due.getTime() < now.getTime());
  return (
    <span className={overdue ? styles.overdue : styles.deadline}>
      {due ? (
        <time dateTime={task.dueAt!}>
          {due.toLocaleString('zh-TW', {
            timeZone: 'Asia/Taipei',
            month: 'numeric',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
          })}
        </time>
      ) : (
        '未設期限'
      )}
      <small>
        {due
          ? overdue
            ? task.acceptsLate
              ? task.kind === 'quiz'
                ? '已過參考期限・仍可作答'
                : '已過參考期限・仍可繳交'
              : '已截止'
            : task.acceptsLate
              ? '參考期限'
              : '截止'
          : ''}
      </small>
    </span>
  );
}

export default function HomePage() {
  const { user, loading: authLoading } = useAuth();
  const nuni = useNuniSession();
  const refreshSession = nuni.refresh;
  const context = nuni.session?.context;
  const accountId = nuni.session?.platformAccountId;
  const uid = user?.uid;
  const school = useOptionalSelectedSchool();
  const role = useSchoolRole(uid, school?.selectedSchoolId || 'pu');
  const owner =
    context && accountId ? `nuni:${context}:${accountId}` : uid ? `school:${uid}` : null;
  const sessionLoading = authLoading || nuni.loading;
  const blocked = nuni.pendingLogout || (!!nuni.error && !uid);
  const [result, setResult] = useState<{ owner: string; data: HomeData } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [now, setNow] = useState<Date | null>(null);
  const generation = useRef(0);
  const data = !sessionLoading && !blocked && result?.owner === owner ? result?.data : null;
  const refresh = useCallback(async () => {
    const request = ++generation.current;
    setResult(null);
    setError('');
    if (!owner || sessionLoading || blocked) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const next =
        context && accountId
          ? await loadNuniHomeData((path, input) => browserRequest(path, context, input), accountId)
          : await loadHomeData(uid!);
      if (request === generation.current) setResult({ owner, data: next });
    } catch (failure) {
      if (request === generation.current) {
        setError(context ? nuniErrorMessage(failure) : '無法讀取課程資料，請確認連線後重試。');
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
  }, [owner, context, accountId, uid, sessionLoading, blocked, refreshSession]);
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
  const busy = sessionLoading || (!!owner && loading);
  const todayTasks = data ? selectTodayCourseWork(data.tasks, now ?? new Date()) : [];
  const laterTasks = data ? selectLaterCourseWork(data.tasks, now ?? new Date()) : [];
  const recentFeedback = data?.recentFeedback ?? [];
  const materialAccount = accountId || uid || '';
  const newMaterials = (data?.materials ?? []).filter(
    (item) =>
      isMaterialNew(item.createdAt, (now ?? new Date()).getTime()) ||
      isMaterialUnread(
        materialAccount,
        item.id,
        typeof localStorage === 'undefined' ? null : localStorage,
      ),
  );
  const teacherOnly = !!teaching.length && !studying.length;
  const sensePhase: SensePhase = blocked
    ? 'hidden'
    : !signedIn
      ? 'unsigned'
      : busy
        ? 'loading'
        : error
          ? 'error'
          : 'ready';
  const todayIds = new Set(todayTasks.map((task) => `${task.courseId}:${task.id}`));
  const senseItems: SenseInputItem[] =
    data?.tasks
      .filter((task) => !todayIds.has(`${task.courseId}:${task.id}`))
      .map((task) => ({
        id: task.id,
        kind: task.kind === 'quiz' ? 'quiz' : 'assignment',
        courseId: task.courseId,
        courseName: task.courseName,
        title: task.title,
        dueAt: task.dueAt,
        href: courseTaskHref(task),
      })) ?? [];
  const uniqueSenseCards =
    sensePhase === 'ready' && now
      ? selectSenseCards({ now, items: senseItems, state: emptySenseState() }).cards.length
      : 0;
  const showSense =
    sensePhase === 'unsigned' ||
    uniqueSenseCards > 0 ||
    (sensePhase === 'ready' && !todayTasks.length);
  const courseSections = [
    { title: '修習課程', items: studying, description: '查看教材、繳交作業與老師回饋。' },
    {
      title: '授課與協作',
      items: teaching,
      description: '進入課程，發佈教材、查看收件與回覆學生。',
    },
  ];

  return (
    <div className={styles.page}>
      <a href="#today-content" className={styles.skip}>
        跳到主要內容
      </a>
      <AppHeader />
      <main id="today-content" className={styles.main} tabIndex={-1}>
        <header className={styles.homeHeading}>
          <div>
            <p className={styles.homeDate}>
              <span className={styles.dayDot} aria-hidden="true" />
              {now?.toLocaleDateString('zh-TW', {
                timeZone: 'Asia/Taipei',
                month: 'long',
                day: 'numeric',
                weekday: 'long',
              }) ?? '今日'}
            </p>
            <h1>今天的校園日常</h1>
            <p className={styles.homeIntro}>課表、待辦，還有校園裡的大小事。</p>
          </div>
          <CampusWeek now={now} />
        </header>
        {isTeacherRole(role) && (
          <p className={styles.notice}>
            <Link href="/teacher">老師工作台 →</Link> 看學生送來的課程申訴。
          </p>
        )}
        <div className={styles.todayFacts}>
          <NextClassCard now={now} />
          {!school?.selectedSchoolId || hasCampusNext(school.selectedSchoolId) ? (
            <HomeCampusBusCard schoolId={school?.selectedSchoolId || 'pu'} />
          ) : null}
        </div>
        <div className={styles.columns}>
          <div className={styles.dayContent}>
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
            ) : busy ? (
              <section className={styles.focus} aria-busy="true" data-testid="today-work">
                <p role="status">正在讀取課程與待辦…</p>
                <div className={styles.loadingLines} aria-hidden="true">
                  <span />
                  <span />
                  <span />
                </div>
              </section>
            ) : error ? (
              <section className={styles.focus}>
                <h2>課程資料尚未讀取完成</h2>
                <p role="alert">{error}</p>
                <div className={styles.focusActions}>
                  <button type="button" className={styles.primary} onClick={() => void refresh()}>
                    重試
                  </button>
                  <Link className={styles.secondary} href={context ? '/classroom' : '/#courses'}>
                    查看課程
                  </Link>
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
              <section
                className={styles.workPanel}
                aria-labelledby="today-work-title"
                data-testid="today-work"
              >
                <div className={styles.panelLabel}>
                  <CampusIcon name="calendar" size={17} />
                  <span>{signedIn ? '課程待辦' : '課程空間'}</span>
                </div>
                <div className={styles.sectionHeading}>
                  <h2 id="today-work-title">
                    {signedIn ? TODAY_WORK_TITLE : '課程與作業'}
                    {signedIn ? <span>{todayTasks.length}</span> : null}
                  </h2>
                  {signedIn ? (
                    <button
                      type="button"
                      className={styles.textButton}
                      onClick={() => void refresh()}
                      disabled={loading}
                    >
                      更新課程
                    </button>
                  ) : null}
                </div>
                <p className={styles.sectionNote}>
                  {signedIn ? TODAY_WORK_NOTE : TODAY_WORK_UNSIGNED}
                </p>
                {!signedIn ? (
                  <div className={styles.guestWelcome}>
                    <div className={styles.focusActions}>
                      <Link className={styles.primary} href="/classroom/login?returnUrl=%2F">
                        用 Google 帳號登入 <CampusIcon name="arrow" size={18} />
                      </Link>
                      <Link className={styles.secondary} href="#public-services">
                        先瀏覽校園資訊
                      </Link>
                    </div>
                  </div>
                ) : todayTasks.length ? (
                  <WorkList tasks={todayTasks} now={now} testId="today-work-list" />
                ) : (
                  <p className={styles.empty}>
                    {data?.courses.length ? TODAY_WORK_EMPTY : TODAY_WORK_NO_CLASS}
                  </p>
                )}
                {signedIn && !data?.courses.length ? (
                  <div className={styles.focusActions}>
                    <Link className={styles.primary} href="/classroom">
                      進入課程空間 <span aria-hidden>→</span>
                    </Link>
                    <Link className={styles.secondary} href="/import?kind=timetable">
                      匯入課表
                    </Link>
                  </div>
                ) : null}
              </section>
            )}
            {signedIn && !!context && !busy && !error ? <CourseMaterialSearch compact /> : null}
            {signedIn && newMaterials.length > 0 ? (
              <section className={styles.section} aria-labelledby="new-materials-title">
                <div className={styles.sectionHeading}>
                  <h2 id="new-materials-title">
                    新教材 <span>{newMaterials.length}</span>
                  </h2>
                </div>
                <p className={styles.sectionNote}>
                  近兩週發布、這台裝置尚未開啟，或七天內的新教材。點一下落到該份教材，有留白與高亮。
                </p>
                <MaterialList items={newMaterials} />
              </section>
            ) : null}
            <TodayTimetable now={now} />
            {showSense ? (
              <TodaySensePanel
                ownerId={owner}
                schoolId={school?.selectedSchoolId}
                items={senseItems}
                now={now}
                phase={sensePhase}
                hideWhenEmpty={todayTasks.length > 0}
              />
            ) : null}
            {data && (
              <>
                {!!laterTasks.length && (
                  <section className={styles.section} aria-labelledby="later-work-title">
                    <div className={styles.sectionHeading}>
                      <h2 id="later-work-title">
                        {LATER_WORK_TITLE} <span>{laterTasks.length}</span>
                      </h2>
                    </div>
                    <p className={styles.sectionNote}>{TODAY_WORK_NOTE}</p>
                    <WorkList tasks={laterTasks} now={now} testId="later-work-list" />
                  </section>
                )}
                {!!recentFeedback.length && (
                  <section
                    className={styles.section}
                    aria-labelledby="recent-feedback-title"
                    data-testid="recent-feedback"
                  >
                    <div className={styles.sectionHeading}>
                      <h2 id="recent-feedback-title">
                        最近老師回饋 <span>{recentFeedback.length}</span>
                      </h2>
                    </div>
                    <p className={styles.sectionNote}>
                      只顯示已公布的評分或回饋；點進去可看完整內容。
                    </p>
                    <FeedbackList items={recentFeedback} />
                  </section>
                )}
                {courseSections.map(
                  ({ title, items, description }, index) =>
                    items.length > 0 && (
                      <section
                        key={title}
                        id={index ? 'teaching-courses' : 'courses'}
                        className={styles.section}
                        aria-labelledby={`courses-title-${index}`}
                      >
                        <div className={styles.sectionHeading}>
                          <h2 id={`courses-title-${index}`}>
                            {title} <span>{items.length}</span>
                          </h2>
                          {!!context && <Link href="/classroom">我的課程 →</Link>}
                        </div>
                        <p className={styles.sectionNote}>{description}</p>
                        <div className={styles.courses}>
                          {items.map((course) => (
                            <Link
                              key={course.id}
                              href={courseHref(course)}
                              className={styles.course}
                            >
                              <span>
                                {course.role === 'owner-teacher'
                                  ? '課程建立者'
                                  : course.role === 'co-teacher'
                                    ? '協同教師'
                                    : index
                                      ? '授課成員'
                                      : '學生'}
                              </span>
                              <h3>{course.name}</h3>
                              <p>
                                {course.unreadCount
                                  ? `${course.unreadCount} 則新動態`
                                  : index
                                    ? '教材、收件與回饋'
                                    : '教材與作業'}
                              </p>
                              <span className={styles.courseArrow} aria-hidden>
                                →
                              </span>
                            </Link>
                          ))}
                        </div>
                      </section>
                    ),
                )}
                {!!data.archivedCount && (
                  <p className={styles.sectionNote}>
                    另有 {data.archivedCount} 門已封存課程，可到
                    <Link href="/classroom">課程空間</Link>查看過往紀錄。
                  </p>
                )}
                {teaching.length > 0 && !studying.length && (
                  <button
                    type="button"
                    className={styles.textButton}
                    onClick={() => void refresh()}
                    disabled={loading}
                  >
                    更新課程
                  </button>
                )}
              </>
            )}
          </div>
          <aside className={styles.sidebar}>
            <section
              id="public-services"
              className={styles.services}
              aria-labelledby="daily-links-title"
            >
              <div className={styles.servicesHeading}>
                <h2 id="daily-links-title">校園生活</h2>
                <Link href="/life" aria-label="查看所有校園生活服務">
                  所有服務 <span aria-hidden="true">↗</span>
                </Link>
              </div>
              <p className={styles.sectionNote}>這些入口不需登入；個人校務資料需另行驗證。</p>
              {publicCampusServices.map(({ href, title, detail }) => (
                <Link key={href} href={href}>
                  <span className={styles.serviceIcon}>
                    <CampusIcon name={serviceIcons[href] ?? 'support'} size={21} />
                  </span>
                  <span>
                    <strong>{title}</strong>
                    <small>{detail}</small>
                  </span>
                  <CampusIcon name="arrow" size={17} className={styles.serviceArrow} />
                </Link>
              ))}
            </section>
            {signedIn && context && accountId ? (
              <AccountIdentity
                key={`identity:${accountId}:${context}`}
                context={context}
                accountId={accountId}
              />
            ) : null}
            <section className={styles.schoolAccess}>
              <span className={styles.recordIcon}>
                <CampusIcon name="import" size={22} />
              </span>
              <h2>課表與成績紀錄</h2>
              <p>
                可匯入課表或成績，核對後存在這台瀏覽器。學校資料尚未自動同步，正式紀錄請到校方系統確認。
              </p>
              <Link href="/import">匯入與備份個人資料 →</Link>
            </section>
            <Link className={styles.supportLink} href="/ai-assistant">
              校園助理 →
            </Link>
          </aside>
        </div>
        <SiteFooter />
      </main>
    </div>
  );
}
