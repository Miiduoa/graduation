'use client';

import { useMemo } from 'react';
import { extractStudySourceTables } from './studySourceTables';
import styles from './CourseStudyPanel.module.css';

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
                  <td key={column}>{cell}</td>)}</tr>)}
            </tbody>
          </table>
        </div>
      ))}
    </section>
  );
}
