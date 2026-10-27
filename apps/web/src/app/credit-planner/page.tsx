'use client';

import Link from 'next/link';
import { useMemo } from 'react';
import { AcademicPage } from '@/components/academic/AcademicPage';
import { CreditPlannerWorkspace } from '@/components/academic/CreditPlannerWorkspace';
import {
  calculateGradeSummary,
  formatSemester,
  type AcademicGradeResponse,
} from '@/lib/academicRecords';
import styles from '@/components/academic/academic.module.css';

function SchoolCreditRecords({ records }: { records: AcademicGradeResponse }) {
  const summary = useMemo(() => calculateGradeSummary(records.grades), [records]);
  const categories = useMemo(() => {
    const groups = new Map<string, { count: number; credits: number }>();
    for (const grade of records.grades) {
      const label = grade.courseType || '未分類';
      const entry = groups.get(label) ?? { count: 0, credits: 0 };
      groups.set(label, { count: entry.count + 1, credits: entry.credits + grade.credits });
    }
    return [...groups.entries()];
  }, [records]);

  return (
    <section aria-label="學校成績紀錄參考" className={styles.section}>
      <h2>學校成績紀錄參考</h2>
      <p className={styles.note}>
        以下是目前連線學校回傳的原始修課紀錄，包含未通過與重修，不等於已採計學分。
        為避免重複採計，不會自動將它們加到上方的個人規劃。
      </p>
      <div className={styles.overview}>
        <div className={styles.metric}>
          <p>已取得的學期</p>
          <strong>{records.semesters.length}</strong>
          <small>依學校回傳的成績資料</small>
        </div>
        <div className={styles.metric}>
          <p>課程紀錄</p>
          <strong>{summary.courseCount}</strong>
          <small>包含重修與未通過的紀錄</small>
        </div>
        <div className={styles.metric}>
          <p>紀錄中的修課學分</p>
          <strong>{summary.totalCredits}</strong>
          <small>不代表畢業可採計學分</small>
        </div>
      </div>
      <div className={styles.categories}>
        <section className={styles.section}>
          <h2>依課程類別整理</h2>
          {categories.length ? (
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">類別</th>
                  <th scope="col">紀錄數</th>
                  <th scope="col">修課學分</th>
                </tr>
              </thead>
              <tbody>
                {categories.map(([category, totals]) => (
                  <tr key={category}>
                    <th scope="row">{category}</th>
                    <td>{totals.count}</td>
                    <td>{totals.credits}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <p className={styles.empty}>尚無課程紀錄可整理。</p>}
        </section>
        <section className={styles.section}>
          <h2>依學期整理</h2>
          {records.semesters.length ? (
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">學期</th>
                  <th scope="col">紀錄數</th>
                  <th scope="col">修課學分</th>
                </tr>
              </thead>
              <tbody>
                {records.semesters.map((semester) => {
                  const totals = calculateGradeSummary(
                    records.grades.filter((grade) => grade.semester === semester),
                  );
                  return (
                    <tr key={semester}>
                      <th scope="row">{formatSemester(semester)}</th>
                      <td>{totals.courseCount}</td>
                      <td>{totals.totalCredits}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : <p className={styles.empty}>尚無可確認的學期。</p>}
        </section>
      </div>
    </section>
  );
}

export default function CreditPlannerPage() {
  return (
    <AcademicPage
      kind="grades"
      title="學分規劃"
      subtitle="從學分目標到每學期課程，建立屬於自己的修課安排。"
      closedAlternative="學分請先到學校的 e 校園或向系辦確認；上方個人試算仍可使用。"
      workspace={({ userId, schoolId, schoolName }) => (
        <>
          {schoolId === 'pu' ? (
            <Link className="btn" href={`/credit-planner/review?school=${encodeURIComponent(schoolId)}`}>
              從成績核對並帶入已修學分
            </Link>
          ) : null}
          <CreditPlannerWorkspace
            key={JSON.stringify([userId, schoolId])}
            userId={userId}
            schoolId={schoolId}
            schoolName={schoolName}
          />
        </>
      )}
    >
      {({ records }) => <SchoolCreditRecords records={records} />}
    </AcademicPage>
  );
}
