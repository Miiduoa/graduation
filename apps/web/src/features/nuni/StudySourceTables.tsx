'use client';

import { useMemo } from 'react';
import { extractStudySourceTables, type StudySourceTable } from './studySourceTables';
import styles from './CourseStudyPanel.module.css';


type SourceValueRow = { label: string; original: string; amount: number };

/**
 * Optional, source-grounded comparison of plain non-negative values only.
 * A number with units, a percentage, a date or an expression is not a scalar
 * measure we can safely turn into a bar. No AI inference or source rewriting.
 */
function sourceValueRows(table: StudySourceTable): SourceValueRow[] | null {
  if (table.headers.length !== 2 || table.rows.length < 2 || table.rows.length > 10) return null;
  const rows: SourceValueRow[] = [];
  const labels = new Set<string>();
  for (const [label, original] of table.rows) {
    if (!label?.trim() || !original ||
        !/^(?:0|[1-9]\d{0,5})(?:\.\d{1,2})?$/u.test(original) ||
        labels.has(label.trim())) return null;
    const amount = Number(original);
    if (!Number.isFinite(amount)) return null;
    labels.add(label.trim());
    rows.push({ label, original, amount });
  }
  return rows.some((row) => row.amount > 0) ? rows : null;
}

/** Keep the original table visible; numeric bars are an opt-in derived view. */
function StudySourceValueComparison({ table }: { table: StudySourceTable }) {
  const rows = sourceValueRows(table);
  if (!rows) return null;
  const max = Math.max(...rows.map((row) => row.amount));
  return (
    <details className={styles.sourceValueComparison}>
      <summary>展開第 2 欄「{table.headers[1]}」的原文數值比較</summary>
      <p className={styles.note}>
        只比較這張文字表格中明確寫出的非負數；以本欄最大值為滿格，不補值、不解讀單位，
        也不是圖片圖表辨識。數字請核對上方原文。
      </p>
      <ul className={styles.sourceValueList} aria-label={table.headers[1] + ' 原文數值比較'}>
        {rows.map((row) => (
          <li key={row.label}>
            <div className={styles.sourceValueRow}>
              <span>{row.label}</span>
              <span>{row.original}</span>
            </div>
            <meter min={0} max={max} value={row.amount}
              aria-label={row.label + '：' + row.original} />
          </li>
        ))}
      </ul>
    </details>
  );
}

/** Optional accessible table layout derived solely from the exact source text. */
export function StudySourceTables({ text }: { text: string }) {
  const tables = useMemo(() => extractStudySourceTables(text), [text]);
  if (!tables.length) return null;

  return (
    <section className={styles.sourceTableGroup} aria-label="教材原文表格">
      <h5>原文表格</h5>
      <p className={styles.note}>
        將本段 Markdown 表格逐格排版，方便比較欄列；原文仍保留在上方。
        沒有補算、推論或辨識圖片中的圖表，請以原教材為準。
      </p>
      {tables.map((table, index) => (
        <div key={table.startLine} className={styles.sourceTableScroll} role="region"
          tabIndex={0}
          aria-label={'原文表格 ' + (index + 1) + '，從第 ' + table.startLine + ' 行開始，可左右捲動'}>
          <table className={styles.sourceTable}>
            <caption>{'原文第 ' + table.startLine + ' 行起的表格'}</caption>
            <thead>
              <tr>{table.headers.map((header, column) =>
                <th scope="col" key={column}>{header}</th>)}</tr>
            </thead>
            <tbody>
              {table.rows.map((row, rowIndex) =>
                <tr key={rowIndex}>{row.map((cell, column) =>
                  column === 0 && cell.trim()
                    ? <th scope="row" key={column}>{cell}</th>
                    : <td key={column}>{cell}</td>)}</tr>)}
            </tbody>
          </table>
          <StudySourceValueComparison table={table} />
        </div>
      ))}
    </section>
  );
}
