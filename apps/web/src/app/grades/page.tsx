'use client';

import { useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { AcademicPage } from '@/components/academic/AcademicPage';
import { GradesTabs, isGradesFeedbackTab } from '@/components/academic/GradesTabs';
import { SchoolSemesterSummary } from '@/components/academic/SchoolSemesterSummary';
import { StudentGradesPage } from '@/features/nuni/StudentGrades';
import {
  calculateGradeSummary,
  formatSemester,
  type AcademicGradeResponse,
} from '@/lib/academicRecords';
import styles from '@/components/academic/academic.module.css';
import transcriptStyles from './transcript.module.css';
import {
  buildTranscriptCsv,
  selectTranscriptRows,
  type TranscriptScoreKind,
  type TranscriptSort,
} from '@/lib/gradeTranscript';

function Grades({ records, fetchedAt }: { records: AcademicGradeResponse; fetchedAt: string }) {
  const [semester, setSemester] = useState('');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<TranscriptSort>('semester');
  const [courseType, setCourseType] = useState('');
  const [scoreKind, setScoreKind] = useState<TranscriptScoreKind>('all');
  const [visibleCount, setVisibleCount] = useState(40);
  const [exportNotice, setExportNotice] = useState('');
  const courseTypes = useMemo(
    () => [...new Set(records.grades.map((grade) => grade.courseType).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, 'zh-TW')),
    [records],
  );
  const selected = useMemo(
    () => records.grades.filter((grade) => !semester || grade.semester === semester),
    [records, semester],
  );
  const summary = useMemo(() => calculateGradeSummary(selected), [selected]);
  const rows = useMemo(
    () => selectTranscriptRows(records.grades, { semester, search, courseType, scoreKind, sort }),
    [records, semester, search, courseType, scoreKind, sort],
  );
  const visibleRows = rows.slice(0, visibleCount);
  const hasFilter = Boolean(search.trim() || semester || courseType || scoreKind !== 'all');
  const resetList = () => { setVisibleCount(40); setExportNotice(''); };
  const clearFilters = () => {
    setSearch(''); setSemester(''); setCourseType(''); setScoreKind('all'); resetList();
  };
  const exportRows = () => {
    setExportNotice('');
    let objectUrl: string | undefined;
    let anchor: HTMLAnchorElement | undefined;
    try {
      const csv = buildTranscriptCsv({ rows, fetchedAt, coverage: records.coverage });
      objectUrl = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
      anchor = document.createElement('a');
      anchor.href = objectUrl;
      anchor.download = 'campus-one-grades.csv';
      document.body.appendChild(anchor);
      anchor.click();
      setExportNotice(`已產生 ${rows.length} 筆成績的 CSV，請查看瀏覽器下載項目。`);
    } catch {
      setExportNotice('目前無法產生檔案，請重新讀取資料後再試。');
    } finally {
      anchor?.remove();
      if (objectUrl) {
        const url = objectUrl;
        // 讓瀏覽器完成下載交接後釋放暫存，資料不會上傳至其他服務。
        setTimeout(() => URL.revokeObjectURL(url), 10_000);
      }
    }
  };
  return (
    <>
      <div className={styles.toolbar}>
        <h2>你的成績紀錄</h2>
        <label className={styles.field}>
          學期
          <select value={semester} onChange={(event) => { setSemester(event.target.value); resetList(); }}>
            <option value="">全部學期</option>
            {[...records.semesters].sort((a, b) => b.localeCompare(a, undefined, { numeric: true })).map((code) => (
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
          <strong>{summary.courseCount ? summary.totalCredits : '—'}</strong>
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
      <SchoolSemesterSummary records={records} semester={semester} />
      <p className={transcriptStyles.notice}>
        上方學分與平均按所選學期計算；下方搜尋、修別與成績類型只篩選明細，不改變學期合計。
      </p>
      <div className={transcriptStyles.filters}>
        <label className={styles.field}>
          搜尋科目
          <input
            type="search"
            placeholder="中英文科目、班級或學期"
            value={search}
            onChange={(event) => { setSearch(event.target.value); resetList(); }}
          />
        </label>
        <label className={styles.field}>
          修別
          <select value={courseType} onChange={(event) => { setCourseType(event.target.value); resetList(); }}>
            <option value="">全部修別</option>
            {courseTypes.map((type) => <option key={type} value={type}>{type}</option>)}
          </select>
        </label>
        <label className={styles.field}>
          成績類型
          <select value={scoreKind} onChange={(event) => {
            setScoreKind(event.target.value as TranscriptScoreKind); resetList();
          }}>
            <option value="all">全部結果</option>
            <option value="numeric">數字成績（含 0 分）</option>
            <option value="text">文字成績</option>
            <option value="missing">尚未提供</option>
          </select>
        </label>
        <label className={styles.field}>
          排序
          <select value={sort} onChange={(event) => { setSort(event.target.value as TranscriptSort); resetList(); }}>
            <option value="semester">學期，由新到舊</option>
            <option value="name">科目名稱</option>
            <option value="score">數字成績，由高到低</option>
          </select>
        </label>
      </div>
      <div className={transcriptStyles.results}>
        <p role="status" aria-live="polite">符合 {rows.length} 筆 · 已顯示 {visibleRows.length} 筆</p>
        <div className={transcriptStyles.actions}>
          {hasFilter && <button className="btn" type="button" onClick={clearFilters}>清除篩選</button>}
          <button className="btn" type="button" disabled={!rows.length} onClick={exportRows}>
            匯出符合條件的 {rows.length} 筆 CSV
          </button>
        </div>
      </div>
      <p className={transcriptStyles.notice}>
        匯出包含全部符合條件的明細，不限畫面已展開的筆數。檔案會註明來源、讀取時間與資料範圍，並非正式成績單。
      </p>
      {exportNotice && <p role="status">{exportNotice}</p>}
      {rows.length ? (
        <ul className={styles.list} aria-label="成績明細">
          {visibleRows.map((grade) => (
            <li key={grade.id}>
              <div>
                <h3>{grade.courseName}</h3>
                {grade.courseNameEn && <p className={transcriptStyles.secondary}>{grade.courseNameEn}</p>}
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
      {rows.length > visibleRows.length && <div className={transcriptStyles.more}>
        <button className="btn" type="button" onClick={() => setVisibleCount((count) => count + 40)}>
          再顯示 {Math.min(40, rows.length - visibleRows.length)} 筆成績
        </button>
      </div>}
      <p className={styles.note}>
        成績按學校回傳內容顯示。「通過」、未定成績與其他文字結果保留原文，不換算成零分或
        GPA。平均分數僅供查看紀錄，正式平均、排名與畢業資格請以學校公告為準。
      </p>
    </>
  );
}

export default function GradesPage() {
  const tab = useSearchParams()?.get('tab');
  if (isGradesFeedbackTab(tab)) {
    return <StudentGradesPage />;
  }
  return (
    <AcademicPage
      kind="grades"
      title="成績"
      subtitle="查看各學期結果，保留學校提供的原始成績。"
      closedAlternative="成績請先到學校的 e 校園查看。"
      lead={<GradesTabs active="semester" />}
    >
      {({ records, fetchedAt }) => <Grades records={records} fetchedAt={fetchedAt} />}
    </AcademicPage>
  );
}
