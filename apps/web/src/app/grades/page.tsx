'use client';

import { useMemo, useState } from 'react';
import { AcademicPage } from '@/components/academic/AcademicPage';
import {
  calculateGradeSummary,
  formatSemester,
  type AcademicGradeResponse,
} from '@/lib/academicRecords';
import styles from '@/components/academic/academic.module.css';

function Grades({ records }: { records: AcademicGradeResponse }) {
  const [semester, setSemester] = useState('');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('semester');
  const selected = useMemo(
    () => records.grades.filter((grade) => !semester || grade.semester === semester),
    [records, semester],
  );
  const summary = useMemo(() => calculateGradeSummary(selected), [selected]);
  const rows = useMemo(
    () =>
      selected
        .filter((grade) =>
          grade.courseName.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()),
        )
        .sort((a, b) => {
          if (sort === 'name') return a.courseName.localeCompare(b.courseName, 'zh-TW');
          if (sort === 'score')
            return (
              (typeof b.score === 'number' ? b.score : -Infinity) -
                (typeof a.score === 'number' ? a.score : -Infinity) ||
              a.courseName.localeCompare(b.courseName, 'zh-TW')
            );
          return (
            b.semester.localeCompare(a.semester, undefined, { numeric: true }) ||
            a.courseName.localeCompare(b.courseName, 'zh-TW')
          );
        }),
    [selected, search, sort],
  );
  return (
    <>
      <div className={styles.toolbar}>
        <h2>你的成績紀錄</h2>
        <label className={styles.field}>
          學期
          <select value={semester} onChange={(event) => setSemester(event.target.value)}>
            <option value="">全部學期</option>
            {records.semesters.map((code) => (
              <option key={code} value={code}>
                {formatSemester(code)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className={styles.overview}>
        <div className={styles.metric}>
          <p>課程紀錄</p>
          <strong>{summary.courseCount}</strong>
          <small>{semester ? formatSemester(semester) : '所有已取得的學期'}</small>
        </div>
        <div className={styles.metric}>
          <p>紀錄中的修課學分</p>
          <strong>{summary.totalCredits}</strong>
          <small>含未通過與重修紀錄，不是畢業採計學分</small>
        </div>
        <div className={styles.metric}>
          <p>數字成績加權平均</p>
          <strong>
            {summary.weightedAverage === null ? '—' : summary.weightedAverage.toFixed(2)}
          </strong>
          <small>僅計 {summary.numericCredits} 學分的數字成績</small>
        </div>
      </div>
      <div className={styles.toolbar}>
        <label className={styles.field}>
          搜尋科目
          <input
            type="search"
            placeholder="輸入科目名稱"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <label className={styles.field}>
          排序
          <select value={sort} onChange={(event) => setSort(event.target.value)}>
            <option value="semester">學期，由新到舊</option>
            <option value="name">科目名稱</option>
            <option value="score">數字成績，由高到低</option>
          </select>
        </label>
      </div>
      {rows.length ? (
        <ul className={styles.list}>
          {rows.map((grade) => (
            <li key={grade.id}>
              <div>
                <h3>{grade.courseName}</h3>
                <p>
                  {formatSemester(grade.semester)} · {grade.courseType || '類別未提供'} ·{' '}
                  {grade.credits} 學分
                </p>
                {grade.class && <p>{grade.class}</p>}
              </div>
              <div
                className={`${styles.score} ${typeof grade.score === 'string' && grade.score.length > 3 ? styles.scoreText : ''}`}
              >
                {typeof grade.score === 'number' ? grade.score : grade.score || '未提供'}
                {typeof grade.score === 'number' && <small>分</small>}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className={styles.empty}>
          {records.grades.length
            ? '沒有符合條件的成績。'
            : '學校這次回傳的成績清單是空的，請稍後更新或至 e 校園確認。'}
        </p>
      )}
      <p className={styles.note}>
        成績按學校回傳內容顯示。「通過」、未定成績與其他文字結果保留原文，不換算成零分或
        GPA。平均分數僅供查看紀錄，正式平均、排名與畢業資格請以學校公告為準。
      </p>
    </>
  );
}
export default function GradesPage() {
  return (
    <AcademicPage
      kind="grades"
      title="成績紀錄"
      subtitle="查看各學期結果，保留學校提供的原始成績。"
    >
      {({ records }) => <Grades records={records} />}
    </AcademicPage>
  );
}
