'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/components/AuthGuard';
import { loadHomeData, type HomeData } from '@/lib/homeOverview';
import styles from './home.module.css';

export default function HomePage() {
  const { user, loading: authLoading, signOutUser } = useAuth();
  const uid = user?.uid;
  const [result, setResult] = useState<{ uid: string; data: HomeData } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [now, setNow] = useState<Date | null>(null);
  const generation = useRef(0);
  const data = result?.uid === user?.uid ? result?.data : null;
  const refresh = useCallback(async () => {
    const request = ++generation.current;
    if (!uid) {
      setLoading(false);
      setError('');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const next = await loadHomeData(uid);
      if (request === generation.current) setResult({ uid, data: next });
    } catch {
      if (request === generation.current) setError('無法讀取課程資料，請確認連線後重試。');
    } finally {
      if (request === generation.current) setLoading(false);
    }
  }, [uid]);
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
  const courseHref = (id: string) => `/course/${encodeURIComponent(id)}`;

  return (
    <div className={styles.page}>
      <a href="#today-content" className={styles.skip}>
        跳到主要內容
      </a>
      <header className={styles.header}>
        <Link href="/" className={styles.brand}>
          <span className={styles.mark}>
            C<span>1</span>
          </span>{' '}
          Campus One
        </Link>
        <nav aria-label="主要導覽" className={styles.nav}>
          <Link href="/" aria-current="page">
            今日
          </Link>
          <Link href={user ? '#courses' : '/login'}>課程</Link>
          <Link href="/map">校園</Link>
        </nav>
        <div className={styles.account}>
          {user ? (
            <button
              type="button"
              onClick={() => void signOutUser().catch(() => setError('登出失敗，請重試。'))}
            >
              登出
            </button>
          ) : (
            <Link href="/login">登入</Link>
          )}
        </div>
      </header>
      <main id="today-content" className={styles.main}>
        <div className={styles.heading}>
          <div>
            <p className={styles.eyebrow}>你的校園日常</p>
            <h1>{user ? '今天的課程與待辦' : '課程與校園生活'}</h1>
            <p className={styles.intro}>
              {user ? '查看作業期限與課程最新動態。' : '登入學校帳號，查看你的課程與待辦。'}
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
        {error && (
          <div role="alert" className={styles.notice}>
            {error}
            <button type="button" onClick={refresh}>
              重試
            </button>
          </div>
        )}
        {authLoading || (uid && loading && !data) ? (
          <p role="status">正在讀取課程…</p>
        ) : (
          <div className={styles.columns}>
            <div>
              <section className={styles.focus} aria-labelledby="focus-title">
                <div className={styles.focusLabel}>{user ? '課程與待辦' : 'Campus One'}</div>
                <h2 id="focus-title">
                  {user
                    ? data
                      ? data.tasks.length
                        ? `有 ${data.tasks.length} 項作業待處理`
                        : '從你的課程開始。'
                      : '連上課程，再繼續。'
                    : '查看你的課程與待辦'}
                </h2>
                <p>
                  {user
                    ? data
                      ? '作業依截止時間排列，點進課程查看內容。'
                      : '資料讀取完成後，這裡會顯示你的課程安排。'
                    : '課程內容、作業期限與校園資訊，放在同一個地方。'}
                </p>
                <div className={styles.focusActions}>
                  {user ? (
                    <button
                      type="button"
                      className={styles.primary}
                      onClick={refresh}
                      disabled={loading}
                    >
                      {loading ? '更新中…' : '更新課程'} <span aria-hidden>↻</span>
                    </button>
                  ) : (
                    <Link className={styles.primary} href="/login">
                      登入帳號 <span aria-hidden>↗</span>
                    </Link>
                  )}
                </div>
                <span className={styles.focusNumber} aria-hidden>
                  {data ? String(data.courses.length).padStart(2, '0') : '01'}
                </span>
              </section>
              {data && (
                <>
                  <section className={styles.section} aria-labelledby="tasks-title">
                    <div className={styles.sectionHeading}>
                      <h2 id="tasks-title">
                        待處理作業 <span>{data.tasks.length}</span>
                      </h2>
                    </div>
                    <p className={styles.sectionNote}>
                      依截止時間排序；已繳交的作業會在更新後移除。
                    </p>
                    {data.tasks.length ? (
                      <ul className={styles.list}>
                        {data.tasks.map((task) => {
                          const overdue =
                            task.dueAt && now && Date.parse(task.dueAt) < now.getTime();
                          return (
                            <li key={`${task.courseId}-${task.id}`}>
                              <Link
                                href={`${courseHref(task.courseId)}#assignment-${encodeURIComponent(task.id)}`}
                                className={styles.task}
                              >
                                <span className={styles.taskSquare} aria-hidden />
                                <span className={styles.taskContent}>
                                  <strong>{task.title}</strong>
                                  <span>{task.courseName}</span>
                                </span>
                                <span className={overdue ? styles.overdue : styles.deadline}>
                                  {task.dueAt
                                    ? new Date(task.dueAt).toLocaleDateString('zh-TW', {
                                        timeZone: 'Asia/Taipei',
                                        month: 'numeric',
                                        day: 'numeric',
                                      })
                                    : '未設期限'}
                                  <small>{task.dueAt ? (overdue ? '已截止' : '截止') : ''}</small>
                                </span>
                                <span aria-hidden className={styles.arrow}>
                                  ↗
                                </span>
                              </Link>
                            </li>
                          );
                        })}
                      </ul>
                    ) : (
                      <p className={styles.empty}>目前沒有待繳作業。</p>
                    )}
                  </section>
                  <section id="courses" className={styles.section} aria-labelledby="courses-title">
                    <div className={styles.sectionHeading}>
                      <h2 id="courses-title">我的課程</h2>
                    </div>
                    {data.courses.length ? (
                      <div className={styles.courses}>
                        {data.courses.map((course) => (
                          <Link
                            key={course.id}
                            href={courseHref(course.id)}
                            className={styles.course}
                          >
                            <span>
                              {['owner', 'instructor', 'moderator'].includes(course.role)
                                ? '教學課程'
                                : '修習課程'}
                            </span>
                            <h3>{course.name}</h3>
                            <p>
                              {course.unreadCount
                                ? `${course.unreadCount} 則新動態`
                                : '查看課程內容'}
                            </p>
                            <span className={styles.courseArrow} aria-hidden>
                              ↗
                            </span>
                          </Link>
                        ))}
                      </div>
                    ) : (
                      <p className={styles.empty}>
                        帳號尚未加入課程。若已選課，請向授課教師確認課程成員名單。
                      </p>
                    )}
                  </section>
                </>
              )}
            </div>
            <aside className={styles.sidebar}>
              <section className={styles.services}>
                <h2>校園常用</h2>
                {[
                  ['/map', '校園地圖', '找教室與校園設施'],
                  ['/bus', '公車資訊', '路線與到站時間'],
                  ['/cafeteria', '餐廳', '看菜單與營業資訊'],
                  ['/library', '圖書館', '借閱與館藏查詢'],
                ].map(([href, title, detail], index) => (
                  <Link key={href} href={href}>
                    <span className={styles.serviceIndex}>0{index + 1}</span>
                    <span>
                      <strong>{title}</strong>
                      <small>{detail}</small>
                    </span>
                    <span aria-hidden>↗</span>
                  </Link>
                ))}
              </section>
              <section className={styles.assistant}>
                <span className={styles.eyebrow}>需要一起整理？</span>
                <h2>問問校園助理。</h2>
                <p>查找資訊、整理待辦，重要操作由你確認。</p>
                <Link href="/ai-assistant">開啟助理 →</Link>
              </section>
            </aside>
          </div>
        )}
        <footer className={styles.footer}>
          <span>Campus One</span>
          <span>課程與校園生活</span>
          <Link href="/settings">設定</Link>
        </footer>
      </main>
    </div>
  );
}
