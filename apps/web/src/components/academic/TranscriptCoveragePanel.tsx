'use client';

import { formatSemester } from '@/lib/academicRecords';
import type { TranscriptSemesterCoverage } from '@/lib/transcriptCoverage';
import styles from './transcript-coverage.module.css';

export function TranscriptCoveragePanel({ semesters, selected, onSelect }: {
  semesters: readonly TranscriptSemesterCoverage[];
  selected: string;
  onSelect: (semester: string) => void;
}) {
  if (!semesters.length) return null;
  const withoutRows = semesters.filter(semester => semester.rowCount === 0).length;
  const withRows = semesters.length - withoutRows;
  return (
    <section className={styles.panel} aria-label="學期資料範圍">
      <div className={styles.heading}>
        <h3>學期資料範圍</h3>
        <span>{withRows} 個學期有明細</span>
      </div>
      {withoutRows > 0 && <p className={styles.warning}>
        來源另列出 {withoutRows} 個學期，但這次沒有取得科目明細；不代表沒有修課或已取得 0 學分。
      </p>}
      <details className={styles.details}>
        <summary>查看 {semesters.length} 個學期的讀取結果</summary>
        <ul className={styles.list} aria-label="來源學期">
          {semesters.map(semester => (
            <li key={semester.semester}>
              <button
                type="button"
                aria-pressed={selected === semester.semester}
                aria-label={`查看 ${formatSemester(semester.semester)}，${semester.rowCount ? `已讀取 ${semester.rowCount} 筆` : '尚無明細'}`}
                onClick={() => onSelect(semester.semester)}
              >
                <span>{formatSemester(semester.semester)}</span>
                <small>
                  {semester.rowCount ? `${semester.rowCount} 筆科目` : '尚無明細，需核對'}
                  {semester.missingScoreCount > 0 && ` · ${semester.missingScoreCount} 筆尚無成績`}
                </small>
              </button>
            </li>
          ))}
        </ul>
        <p className={styles.note}>僅列出來源提及的學期。有明細不代表已取得該學期或歷年全部紀錄。</p>
      </details>
    </section>
  );
}
