'use client';

import { useMemo, useState } from 'react';
import { AcademicPage } from '@/components/academic/AcademicPage';
import {
  calculateGradeSummary,
  formatSemester,
  type AcademicGradeResponse,
} from '@/lib/academicRecords';
import styles from '@/components/academic/academic.module.css';

function nonnegativeNumber(value: string) {
  if (!value.trim()) return null;
  const result = Number(value);
  return Number.isFinite(result) && result >= 0 && result <= 1000 ? result : null;
}
function CreditPlanner({ records }: { records: AcademicGradeResponse }) {
  const [recognized, setRecognized] = useState('');
  const [target, setTarget] = useState('');
  const [planned, setPlanned] = useState('');
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
  const approved = nonnegativeNumber(recognized);
  const goal = nonnegativeNumber(target);
  const next = planned.trim() ? nonnegativeNumber(planned) : 0;
  const canCalculate = approved !== null && goal !== null && next !== null;
  const missing = canCalculate ? Math.max(0, goal - approved - next) : null;
  return (
    <>
      <div className={styles.overview}>
        <div className={styles.metric}>
          <p>已取得的學期</p>
          <strong>{records.semesters.length}</strong>
          <small>依學校回傳的成績資料</small>
        </div>
        <div className={styles.metric}>
          <p>課程紀錄</p>
          <strong>{summary.courseCount}</strong>
          <small>包含重修及未通過科目</small>
        </div>
        <div className={styles.metric}>
          <p>紀錄中的修課學分</p>
          <strong>{summary.totalCredits}</strong>
          <small>不等於已取得或畢業採計學分</small>
        </div>
      </div>
      <p className={styles.note}>
        成績紀錄無法單獨判定畢業資格。重修採計、抵免、必修與通識規定，仍需核對你的入學年度與學校學分審查結果。
      </p>
      <section className={styles.planner} aria-labelledby="plan-title">
        <h2 id="plan-title">算一算接下來的修課負擔</h2>
        <p>先填入你已向學校確認的學分，再試算自己的規劃。這裡不會替你選課，也不會改動學校紀錄。</p>
        <div className={styles.planFields}>
          <label className={styles.field}>
            已確認可採計學分（自行填寫）
            <input
              type="number"
              min="0"
              max="1000"
              step="any"
              inputMode="decimal"
              value={recognized}
              onChange={(event) => setRecognized(event.target.value)}
              placeholder="依學分審查結果填寫"
            />
          </label>
          <label className={styles.field}>
            希望累計的學分
            <input
              type="number"
              min="0"
              max="1000"
              step="any"
              inputMode="decimal"
              value={target}
              onChange={(event) => setTarget(event.target.value)}
              placeholder="填入你的目標"
            />
          </label>
          <label className={styles.field}>
            預計再修學分
            <input
              type="number"
              min="0"
              max="1000"
              step="any"
              inputMode="decimal"
              value={planned}
              onChange={(event) => setPlanned(event.target.value)}
              placeholder="可先留空"
            />
          </label>
        </div>
        <div className={styles.planResult} role="status">
          {missing === null ? (
            '填入已確認的學分與目標，就能開始試算。'
          ) : (
            <>
              假設預計修讀的 {next} 學分都通過且可採計，距離你填寫的目標還差{' '}
              <strong>{Number(missing.toFixed(2))}</strong> 學分。
            </>
          )}
        </div>
        <p>這是本頁的個人試算，離開後不保留；不代表已滿足畢業條件。</p>
      </section>
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
          ) : (
            <p className={styles.empty}>尚無課程紀錄可整理。</p>
          )}
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
          ) : (
            <p className={styles.empty}>尚無可確認的學期。</p>
          )}
        </section>
      </div>
    </>
  );
}
export default function CreditPlannerPage() {
  return (
    <AcademicPage kind="grades" title="學分規劃" subtitle="整理修課紀錄，替下一個學期留好空間。">
      {({ records }) => <CreditPlanner records={records} />}
    </AcademicPage>
  );
}
