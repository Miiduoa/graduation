'use client';

import Link from 'next/link';
import { use } from 'react';
import { AppHeader } from '@/components/AppHeader';
import { resolveSchoolPageContext } from '@/lib/pageContext';
import { useTeacherCourse } from '@/lib/useTeacherCourse';
import styles from '../../../../home.module.css';
import local from '../teacherCourse.module.css';

export default function TeacherGradebookPage(props: {
  params: Promise<{ courseId: string }>;
  searchParams?: Promise<{ school?: string; schoolId?: string }>;
}) {
  const { courseId } = use(props.params);
  const searchParams = props.searchParams ? use(props.searchParams) : undefined;
  const { schoolId, schoolName, schoolSearch: q } = resolveSchoolPageContext(searchParams);
  const { state, refresh, authLoading, signedIn } = useTeacherCourse(
    schoolId,
    courseId,
    'gradebook',
  );
  const gradebook =
    state?.status === 'ready' && state.data && 'rows' in state.data ? state.data : null;
  const path = `/teacher/course/${encodeURIComponent(courseId)}`;
  const scores =
    gradebook?.rows.flatMap((row) => (row.finalScore === null ? [] : [row.finalScore])) ?? [];
  const average = scores.length
    ? (scores.reduce((total, value) => total + value, 0) / scores.length).toFixed(1)
    : '—';
  return (
    <div className={styles.page}>
      <AppHeader />
      <main className={styles.main}>
        <header className={styles.heading}>
          <div>
            <p className={styles.eyebrow}>{schoolName} · 教學工作台</p>
            <h1>{gradebook ? `${gradebook.course.name} · 成績簿` : '成績簿'}</h1>
            <p className={styles.intro}>查看課程已儲存的成績與發布狀態。</p>
          </div>
        </header>
        <nav className={local.actions}>
          <Link className={styles.secondary} href={`${path}${q}`}>
            回課程工作台
          </Link>
        </nav>
        {authLoading ? (
          <p role="status">確認登入狀態…</p>
        ) : !signedIn ? (
          <section className={styles.section}>
            <h2>請登入課程教師帳號</h2>
            <Link
              className={styles.primary}
              href={`/login?redirect=${encodeURIComponent(path + '/gradebook' + q)}`}
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
        ) : !gradebook ? (
          <p role="status">讀取成績紀錄…</p>
        ) : (
          <>
            <section className={styles.section}>
              <div className={styles.sectionHeading}>
                <h2>成績紀錄</h2>
                <button className={styles.secondary} onClick={() => void refresh()}>
                  更新資料
                </button>
              </div>
              {gradebook.rows.length === 0 ? (
                <p>目前沒有成績紀錄。</p>
              ) : (
                <>
                  <p className={local.muted}>
                    共 {gradebook.rows.length} 筆紀錄，其中 {scores.length} 筆已登錄分數，平均{' '}
                    {average} 分。未登錄分數不列入平均。
                  </p>
                  <div
                    className={local.tableWrap}
                    tabIndex={0}
                    role="region"
                    aria-label="課程成績紀錄"
                  >
                    <table className={local.table}>
                      <thead>
                        <tr>
                          <th scope="col">學生</th>
                          <th scope="col">總分</th>
                          <th scope="col">結果</th>
                          <th scope="col">發布狀態</th>
                          <th scope="col">發布時間</th>
                        </tr>
                      </thead>
                      <tbody>
                        {gradebook.rows.map((row) => (
                          <tr key={row.id}>
                            <th scope="row">
                              {row.name ?? '未提供姓名'}
                              <span className={local.identity}>使用者編號：{row.uid}</span>
                            </th>
                            <td>{row.finalScore ?? '未登錄'}</td>
                            <td>
                              {row.result === 'passed'
                                ? '通過'
                                : row.result === 'failed'
                                  ? '未通過'
                                  : row.result === 'incomplete'
                                    ? '尚未完成'
                                    : row.result || '未提供'}
                            </td>
                            <td>
                              {row.published === true
                                ? '已發布'
                                : row.published === false
                                  ? '未發布'
                                  : '未提供'}
                            </td>
                            <td>
                              {row.publishedAt
                                ? new Date(row.publishedAt).toLocaleString('zh-TW', {
                                    timeZone: 'Asia/Taipei',
                                  })
                                : '—'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </section>
            <p className={local.muted}>
              成績以課程儲存的紀錄為準。此頁尚未提供成績修改、發布與撤回操作。
            </p>
          </>
        )}
      </main>
    </div>
  );
}
