'use client';

import Link from 'next/link';
import { use } from 'react';
import { AppHeader } from '@/components/AppHeader';
import { resolveSchoolPageContext } from '@/lib/pageContext';
import { useTeacherCourse } from '@/lib/useTeacherCourse';
import styles from '../../../home.module.css';
import local from './teacherCourse.module.css';

export default function TeacherCoursePage(props: {
  params: Promise<{ courseId: string }>;
  searchParams?: Promise<{ school?: string; schoolId?: string }>;
}) {
  const { courseId } = use(props.params);
  const searchParams = props.searchParams ? use(props.searchParams) : undefined;
  const { schoolId, schoolName, schoolSearch: q } = resolveSchoolPageContext(searchParams);
  const { state, refresh, authLoading, signedIn } = useTeacherCourse(
    schoolId,
    courseId,
    'workspace',
  );
  const workspace =
    state?.status === 'ready' && state.data && 'modules' in state.data ? state.data : null;
  const path = `/teacher/course/${encodeURIComponent(courseId)}`;
  const studentPath = `/course/${encodeURIComponent(courseId)}`;
  return (
    <div className={styles.page}>
      <AppHeader />
      <main className={styles.main}>
        <header className={styles.heading}>
          <div>
            <p className={styles.eyebrow}>{schoolName} · 教學工作台</p>
            <h1>{workspace?.course.name ?? '課程工作台'}</h1>
            <p className={styles.intro}>查看課程教材、作業與成績，接續課堂點名。</p>
          </div>
        </header>
        {authLoading ? (
          <p role="status">確認登入狀態…</p>
        ) : !signedIn ? (
          <section className={styles.section}>
            <h2>請登入課程教師帳號</h2>
            <Link
              className={styles.primary}
              href={`/login?redirect=${encodeURIComponent(path + q)}`}
            >
              前往登入
            </Link>
          </section>
        ) : state?.status === 'error' ? (
          <section className={styles.section}>
            <p role="alert">{state.error}</p>
            <button className={styles.primary} onClick={() => void refresh()}>
              重新讀取
            </button>
          </section>
        ) : !workspace ? (
          <p role="status">讀取課程資料…</p>
        ) : (
          <>
            <nav className={local.actions} aria-label="課程工具">
              <Link className={styles.primary} href={`${studentPath}${q}`}>
                開啟課程內容
              </Link>
              <Link className={styles.secondary} href={`${path}/attendance${q}`}>
                課堂點名
              </Link>
              <Link className={styles.secondary} href={`${path}/gradebook${q}`}>
                查看成績簿
              </Link>
              <button className={styles.secondary} onClick={() => void refresh()}>
                更新資料
              </button>
            </nav>
            {workspace.course.description ? (
              <p className={local.description}>{workspace.course.description}</p>
            ) : null}
            <div className={local.columns}>
              <section className={styles.section}>
                <div className={styles.sectionHeading}>
                  <h2>課程教材</h2>
                  <span>{workspace.modules.length} 個單元</span>
                </div>
                {workspace.modules.length === 0 ? (
                  <p>目前沒有可查看的教材。</p>
                ) : (
                  workspace.modules.map((module) => (
                    <article key={module.id} className={local.row}>
                      <h3>{module.title}</h3>
                      {module.description ? (
                        <p className={local.description}>{module.description}</p>
                      ) : null}
                      {module.resourceUrl ? (
                        <a
                          className={local.resource}
                          href={module.resourceUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {module.resourceLabel || '開啟教材'} ↗
                        </a>
                      ) : (
                        <p className={local.muted}>此單元未附教材連結。</p>
                      )}
                    </article>
                  ))
                )}
              </section>
              <section className={styles.section}>
                <div className={styles.sectionHeading}>
                  <h2>課程作業</h2>
                  <span>{workspace.assignments.length} 項</span>
                </div>
                {workspace.assignments.length === 0 ? (
                  <p>目前沒有可查看的作業。</p>
                ) : (
                  workspace.assignments.map((assignment) => (
                    <article key={assignment.id} className={local.row}>
                      <h3>{assignment.title}</h3>
                      {assignment.description ? (
                        <p className={local.description}>{assignment.description}</p>
                      ) : null}
                      <p className={local.muted}>
                        {assignment.dueAt
                          ? `截止 ${new Date(assignment.dueAt).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' })}`
                          : '未設截止時間'}
                        {assignment.points !== null ? ` · ${assignment.points} 分` : ''}
                      </p>
                      <Link
                        className={local.resource}
                        href={`${studentPath}${q}#assignment-${encodeURIComponent(assignment.id)}`}
                      >
                        查看作業內容 →
                      </Link>
                    </article>
                  ))
                )}
              </section>
            </div>
            <p className={local.muted}>此頁提供課程資料查閱。新增作業與發布成績尚未開放。</p>
          </>
        )}
      </main>
    </div>
  );
}
