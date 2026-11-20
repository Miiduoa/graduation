'use client';

import { formatSemester, type AcademicGradeResponse } from '@/lib/academicRecords';
import styles from './academic.module.css';

const FIELDS = [
  ['semesterAverage', '學校平均'],
  ['classRanking', '班級排名'],
  ['departmentRanking', '系排名'],
  ['behaviorScore', '操行成績'],
] as const;

export function SchoolSemesterSummary({
  records,
  semester,
}: {
  records: AcademicGradeResponse;
  semester: string;
}) {
  const available = Object.entries(records.summary)
    .filter(([, summary]) => FIELDS.some(([key]) => summary[key] !== undefined))
    .sort(([a], [b]) => b.localeCompare(a, undefined, { numeric: true }));
  if (!available.length) return null;
  const rows = semester ? available.filter(([code]) => code === semester) : available;
  return (
    <section className={styles.schoolSummary} aria-label="學校提供的學期摘要">
      <header>
        <h2>學校提供的學期摘要</h2>
        <p>依 e 校園原值顯示；各學期平均與排名分開保留。</p>
      </header>
      {rows.length ? rows.map(([code, summary]) => (
        <div className={styles.schoolSummaryRow} key={code}>
          <h3>{formatSemester(code)}</h3>
          <dl>
            {FIELDS.map(([key, label]) => (
              <div key={key}>
                <dt>{label}</dt>
                <dd>{summary[key] === undefined ? '未提供' : String(summary[key])}</dd>
              </div>
            ))}
          </dl>
        </div>
      )) : <p className={styles.notice}>學校這次未提供所選學期的平均或排名。</p>}
    </section>
  );
}
