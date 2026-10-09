'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { NuniError, nuniErrorMessage } from '@campus/shared/src/nuni';
import { AppHeader } from '@/components/AppHeader';
import { SiteFooter } from '@/components/SiteFooter';
import { useAuth } from '@/components/AuthGuard';
import { browserRequest, useNuniSession } from '@/features/nuni/Session';
import { loadHomeData, type HomeCourse, type HomeData, type HomeTask } from '@/lib/homeOverview';
import { loadNuniHomeData } from '@/lib/nuniHomeOverview';
import styles from './home.module.css';

const teachingRoles = ['owner', 'instructor', 'moderator', 'owner-teacher', 'co-teacher'];
const courseHref = (course: HomeCourse) =>
  course.href ?? `/course/${encodeURIComponent(course.id)}`;
const taskHref = (task: HomeTask) =>
  task.href ??
  `/course/${encodeURIComponent(task.courseId)}#assignment-${encodeURIComponent(task.id)}`;

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
              ? '已過參考期限・仍可繳交'
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
    const tick = () => setNow(new Date());
    tick();
    const timer = setInterval(tick, 60_000);
    return () => clearInterval(timer);
  }, []);

  const teaching = data?.courses.filter((course) => teachingRoles.includes(course.role)) ?? [];
  const studying = data?.courses.filter((course) => !teachingRoles.includes(course.role)) ?? [];
  const nextTask =
    data?.tasks.find((task) => task.dueAt && now && Date.parse(task.dueAt) >= now.getTime()) ??
    data?.tasks[0];
  const signedIn = !!owner && !blocked;
  const busy = sessionLoading || (!!owner && loading);
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
        <div className={styles.heading}>
          <div>
            <p className={styles.eyebrow}>CAMPUS ONE</p>
            <h1>
              {signedIn
                ? teaching.length && !studying.length
                  ? '今天的教學'
                  : '今天的課程與待辦'
                : '今天，從這裡開始'}
            </h1>
            <p className={styles.intro}>
              {signedIn
                ? '作業、課程與上課地點，接著處理。'
                : '進入課程繳交作業，或查看課表與校園資訊。'}
            </p>
          </div>
          <div className={styles.date}>
            {now?.toLocaleDateString('zh-TW', {
              timeZone: 'Asia/Taipei',
              month: 'long',
              day: 'numeric',
            }) ?? '今日'}
            <span>
              {now?.toLocaleDateString('zh-TW', { timeZone: 'Asia/Taipei', weekday: 'long' })}
            </span>
          </div>
        </div>
        <div className={styles.columns}>
          <div>
            {blocked ? (
              <section className={styles.focus} aria-labelledby="session-title">
                <h2 id="session-title">
                  {nuni.pendingLogout ? '登出尚未完成' : '暫時無法確認課程帳號'}
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
              <section className={styles.focus} aria-busy="true">
                <p role="status">正在讀取課程與待辦…</p>
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
            ) : (
              <section className={styles.focus} aria-labelledby="focus-title">
                <div className={styles.focusLabel}>
                  {nextTask
                    ? '接下來要處理'
                    : teaching.length && !studying.length
                      ? '教學安排'
                      : '課程與待辦'}
                </div>
                <h2 id="focus-title">
                  {nextTask
                    ? nextTask.title
                    : signedIn
                      ? teaching.length && !studying.length
                        ? `${teaching.length} 門課正在進行`
                        : data?.courses.length
                          ? '目前沒有待繳作業'
                          : '加入你的第一門課'
                      : '先回到你的課程'}
                </h2>
                {nextTask ? (
                  <p>
                    {nextTask.courseName}
                    <span className={styles.focusDeadline}>
                      <Deadline task={nextTask} now={now} />
                    </span>
                  </p>
                ) : (
                  <p>
                    {signedIn
                      ? teaching.length && !studying.length
                        ? '從授課課程查看學生繳交內容，安排教材與下一次作業。'
                        : data?.courses.length
                          ? '可以回到課程查看教材與回饋，或安排今天的上課路線。'
                          : context
                            ? '向老師取得邀請碼後加入課程；授課者也可以建立課程。'
                            : '前往課程空間加入課程，或查看學校課表。'
                      : '使用課程帳號登入，查看老師的教材、作業與回饋。'}
                  </p>
                )}
                <div className={styles.focusActions}>
                  <Link
                    className={styles.primary}
                    href={
                      nextTask
                        ? taskHref(nextTask)
                        : teaching.length && !studying.length
                          ? '#teaching-courses'
                          : signedIn
                            ? context || !data?.courses.length
                              ? '/classroom'
                              : '#courses'
                            : '/classroom/login'
                    }
                  >
                    {nextTask
                      ? '查看並繳交作業'
                      : teaching.length && !studying.length
                        ? '查看授課課程'
                        : signedIn
                          ? context || !data?.courses.length
                            ? '進入課程空間'
                            : '查看我的課程'
                          : '登入課程帳號'}{' '}
                    <span aria-hidden>→</span>
                  </Link>
                  <Link className={styles.secondary} href="/timetable">
                    查看課表
                  </Link>
                </div>
              </section>
            )}
            {data && (
              <>
                {!!studying.length && (
                  <section className={styles.section} aria-labelledby="tasks-title">
                    <div className={styles.sectionHeading}>
                      <h2 id="tasks-title">
                        待繳作業 <span>{data.tasks.length}</span>
                      </h2>
                      <button
                        type="button"
                        className={styles.textButton}
                        onClick={() => void refresh()}
                        disabled={loading}
                      >
                        更新課程
                      </button>
                    </div>
                    <p className={styles.sectionNote}>
                      {context
                        ? '只列出修習課程中仍開放收件、尚未繳交的作業。時間皆為台灣時間。'
                        : '依截止時間排序；已繳交的作業會在更新後移除。時間皆為台灣時間。'}
                    </p>
                    {data.tasks.length ? (
                      <ul className={styles.list}>
                        {data.tasks.map((task) => (
                          <li key={`${task.courseId}-${task.id}`}>
                            <Link href={taskHref(task)} className={styles.task}>
                              <span className={styles.taskContent}>
                                <strong>{task.title}</strong>
                                <span>{task.courseName}</span>
                              </span>
                              <Deadline task={task} now={now} />
                              <span aria-hidden className={styles.arrow}>
                                →
                              </span>
                            </Link>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className={styles.empty}>目前沒有待繳作業。</p>
                    )}
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
            <section className={styles.services} aria-labelledby="daily-links-title">
              <h2 id="daily-links-title">今天會用到</h2>
              {[
                ['/timetable', '我的課表', '上課時間與教室'],
                ['/map', '校園地圖', '找教室與校園設施'],
                ['/bus', '公車資訊', '路線與到站時間'],
                ['/cafeteria', '餐廳', '菜單與營業資訊'],
                ['/library', '圖書館', '借閱與館藏查詢'],
              ].map(([href, title, detail]) => (
                <Link key={href} href={href}>
                  <span>
                    <strong>{title}</strong>
                    <small>{detail}</small>
                  </span>
                  <span aria-hidden>→</span>
                </Link>
              ))}
            </section>
            <section className={styles.schoolAccess}>
              <h2>學校課表與成績</h2>
              <p>
                課程空間的加入紀錄與學校正式選課分開管理。查詢課表、成績時，請連線自己的學校帳號。
              </p>
              <Link href={user ? '/grades' : '/login?returnUrl=%2Ftimetable'}>
                {user ? '查看學校成績' : '連線學校帳號'} →
              </Link>
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
