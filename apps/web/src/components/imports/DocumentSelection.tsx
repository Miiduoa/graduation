'use client';

import { useId, useMemo, useState } from 'react';
import type { PersonalImportDocument, PersonalImportDocumentSection } from '@campus/shared/src/imports/documents';
import type { PersonalImportOptions, PersonalImportRow, ImportIssue } from '@campus/shared/src/imports/types';
import {
  documentImportColumnLabel,
  reviewDocumentImportSelection,
  suggestDocumentImportHeader,
  type DocumentImportSelection,
  type DocumentSectionReview,
} from '@campus/shared/src/imports/documentReview';
import { periodLabelAt } from '@campus/shared/src/timetable/periods';
import styles from './DocumentSelection.module.css';

type Props = {
  document: PersonalImportDocument;
  options: PersonalImportOptions;
  initialSelection?: DocumentImportSelection | null;
  onSelectionChange?: (selection: DocumentImportSelection) => void;
  onConfirm: (rows: PersonalImportRow[], issues: ImportIssue[]) => void;
  onCancel: () => void;
  onAi?: (selection: DocumentImportSelection) => void;
  aiDisabled?: boolean;
  aiNote?: string;
};

function rowDetail(row: PersonalImportRow, options: PersonalImportOptions): string {
  if (row.kind === 'grades') return `${row.credits ?? '待補'} 學分 · 成績 ${row.grade || '待補'}`;
  if (row.kind === 'events') return `${row.date || '日期待補'} · ${row.allDay ? '全天' : `${row.startTime || '?'}–${row.endTime || '?'}`}`;
  const day = ['', '一', '二', '三', '四', '五', '六', '日'][row.dayOfWeek ?? 0];
  const label = (value: number | undefined) => value === undefined ? '?'
    : options.periodProfile ? periodLabelAt(value, options.periodProfile) ?? '?' : String(value);
  const time = row.startTime && row.endTime ? `${row.startTime}–${row.endTime}`
    : `第 ${label(row.startPeriod)}–${label(row.endPeriod)} 節`;
  return `星期${day || '待補'} · ${time}${row.location ? ` · ${row.location}` : ''}`;
}

function SectionPreview({ section, header, review, options }: {
  section: PersonalImportDocumentSection;
  header: number;
  review?: DocumentSectionReview;
  options: PersonalImportOptions;
}) {
  const [visible, setVisible] = useState(6);
  const start = section.rows.findIndex((row) => row.line === header);
  const source = start < 0 ? [] : section.rows.slice(start);
  const columns = source[0]?.cells ?? [];
  return (
    <div className={styles.previewGrid}>
      <div className={styles.source}>
        <div className={styles.scroll} tabIndex={0} role="region" aria-label={`${section.label} 原始表格預覽`}>
          <table className={styles.table}>
            <caption>{section.label}：第 {header} 列起，可左右滑動對照</caption>
            <thead>
              <tr>
                <th scope="col">原始列</th>
                {columns.map((cell, index) => (
                  <th key={index} scope="col">
                    <span>{cell || '空白欄名'}</span>
                    <small data-unmapped={!documentImportColumnLabel(cell)}>
                      {documentImportColumnLabel(cell) || '未對應 · 原文保留'}
                    </small>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {source.slice(1, visible + 1).map((row) => (
                <tr key={row.line}>
                  <th scope="row">{row.line}</th>
                  {row.cells.map((cell, index) => <td key={index}>{cell || '—'}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {source.length > visible + 1 && (
          <button type="button" className="btn" onClick={() => setVisible((value) => value + 20)}>
            再顯示 20 列原始內容
          </button>
        )}
      </div>
      <aside className={styles.result} aria-label={`${section.label} 整理結果預覽`}>
        <strong>整理後會得到什麼</strong>
        {review?.error ? <p className={styles.warning}>{review.error}</p> : (
          <>
            <p>共 {review?.rows.length ?? 0} 筆草稿，先預覽前 6 筆。</p>
            <ol className={styles.records}>
              {review?.rows.slice(0, 6).map((row) => {
                const issues = review.issues.filter((issue) => issue.rowId === row.id && issue.severity === 'error');
                return (
                  <li key={row.id}>
                    <div><strong>{row.title || '名稱待補'}</strong><small>來源第 {row.source.line} 列</small></div>
                    <span>{rowDetail(row, options)}</span>
                    {issues.length > 0 && <small className={styles.warning}>有 {issues.length} 個欄位問題，下一步可修改</small>}
                  </li>
                );
              })}
            </ol>
            {review?.issues.filter((issue) => !issue.rowId).map((issue, index) => (
              <p key={index} className={issue.severity === 'error' ? styles.warning : styles.note}>{issue.message}</p>
            ))}
          </>
        )}
      </aside>
    </div>
  );
}

export function DocumentSelection({
  document, options, initialSelection, onSelectionChange, onConfirm, onCancel,
  onAi, aiDisabled = false, aiNote,
}: Props) {
  const aiNoteId = useId();
  const reviewId = useId();
  const suggestions = useMemo(() => Object.fromEntries(document.sections.map((section) =>
    [section.id, suggestDocumentImportHeader(section, options.kind)],
  )), [document, options.kind]);
  const readable = document.sections.filter((section) => !section.needsOcr && section.rows.length);
  const [selected, setSelected] = useState<string[]>(() =>
    initialSelection ? [...initialSelection.selected] : readable[0] ? [readable[0].id] : [],
  );
  const [headers, setHeaders] = useState<Record<string, number>>(() => Object.fromEntries(
    document.sections.map((section) => [section.id,
      initialSelection?.headers[section.id] ?? suggestions[section.id].line ?? section.rows[0]?.line ?? 1,
    ]),
  ));
  const [error, setError] = useState('');
  const review = useMemo(() => reviewDocumentImportSelection(document, { selected, headers }, options),
    [document, selected, headers, options]);
  const change = (next: DocumentImportSelection) => {
    setError('');
    setSelected(next.selected);
    setHeaders(next.headers);
    onSelectionChange?.({ selected: [...next.selected], headers: { ...next.headers } });
  };
  const sectionLabel = document.format === 'xlsx' ? '工作表' : '頁面';
  return (
    <section className={styles.root} aria-label="選擇文件內容">
      <header className={styles.heading}>
        <div><span className={styles.eyebrow}>文件內容確認</span><h3>{document.name}</h3></div>
        <span className={styles.local}>在裝置上讀取</span>
      </header>
      <p className={styles.intro}>先確認來源，再看整理結果。有明確欄名時會建議標題列；不會自動儲存或啟動 AI。</p>
      {document.warnings.map((warning, index) => <p key={index} role="status" className={styles.warning}>{warning}</p>)}
      <div className={styles.toolbar}>
        <strong>已選 {selected.length}／{document.sections.length} 個{sectionLabel}</strong>
        <div className={styles.actions}>
          <button type="button" className="btn" disabled={!readable.length}
            onClick={() => change({ selected: readable.map((section) => section.id), headers })}>全選可讀取內容</button>
          <button type="button" className="btn" disabled={!selected.length}
            onClick={() => change({ selected: [], headers })}>取消全選</button>
        </div>
      </div>
      {document.sections.map((section) => {
        const suggestion = suggestions[section.id];
        const active = selected.includes(section.id);
        const header = headers[section.id];
        const skipped = section.rows.findIndex((row) => row.line === header);
        const prepared = review.sections.find((item) => item.id === section.id);
        return (
          <article key={section.id} className={styles.section} data-selected={active}>
            <div className={styles.sectionHeading}>
              <label className={styles.check}>
                <input type="checkbox" checked={active} disabled={section.needsOcr || !section.rows.length}
                  onChange={(event) => change({ selected: event.target.checked
                    ? [...selected, section.id] : selected.filter((id) => id !== section.id), headers })} />
                {section.label} · {section.rows.length} 列
              </label>
              <span className={styles.badge}>{section.needsOcr ? '需要截圖辨識' : !section.rows.length ? '沒有資料' : active && !prepared?.error ? `${prepared?.rows.length ?? 0} 筆草稿` : '可讀取'}</span>
            </div>
            {section.warnings.map((warning, index) => <p key={index} className={styles.note}>{warning}</p>)}
            {section.needsOcr && <p className={styles.note}>這一頁仍無法讀取文字，請將該頁截圖後重新辨識。</p>}
            {active && (
              <div className={styles.sectionBody}>
                <div className={styles.headerControl}>
                  <label className={styles.field}>「{section.label}」的標題列
                    <select aria-label={`「${section.label}」的標題列`} value={header} onChange={(event) => change({ selected,
                      headers: { ...headers, [section.id]: Number(event.target.value) } })}>
                      {section.rows.map((row) => <option key={row.line} value={row.line}>
                        第 {row.line} 列：{row.cells.join(' ｜ ').slice(0, 100)}
                      </option>)}
                    </select>
                  </label>
                  {suggestion.line !== undefined ? (
                    suggestion.line === header ? <p className={styles.note}>欄名符合目前匯入類型，建議使用第 {header} 列。仍請對照原檔。</p>
                      : <button type="button" className="btn" onClick={() => change({ selected,
                        headers: { ...headers, [section.id]: suggestion.line! } })}>使用建議：第 {suggestion.line} 列</button>
                  ) : <p className={styles.note}>{suggestion.status === 'ambiguous'
                    ? '找到多個可能的標題列，請自行確認，沒有自動略過中間資料。'
                    : '尚無唯一標題列建議，可手動指定，或改用 AI 整理。'}</p>}
                </div>
                {skipped > 0 && <details className={styles.skipped}>
                  <summary>標題前有 {skipped} 列不會匯入，展開核對</summary>
                  <pre>{section.rows.slice(0, skipped).map((row) => `${row.line}　${row.cells.join(' ｜ ')}`).join('\n')}</pre>
                </details>}
                <SectionPreview key={`${section.id}:${header}`} section={section} header={header} review={prepared} options={options} />
              </div>
            )}
          </article>
        );
      })}
      {onAi && (
        <section className={styles.aiTools} aria-label="AI 輔助整理">
          <strong>欄名不規則或仍整理不出來？使用裝置端 AI</strong>
          <p>將標題列設為資料起始列。AI 只整理已選取的範圍，完成後仍需核對。一般表格可直接按下方「整理選取內容」，不必下載模型。</p>
          {aiNote && <p id={aiNoteId} className={styles.note}>{aiNote}</p>}
          <button type="button" className="btn" disabled={!selected.length || aiDisabled}
            aria-describedby={aiNote ? aiNoteId : undefined} onClick={() => {
              setError('');
              onAi({ selected: [...selected], headers: { ...headers } });
            }}>用 AI 整理選取內容</button>
        </section>
      )}
      <footer className={styles.footer}>
        <div id={reviewId} role={review.blockingMessage && selected.length ? 'alert' : 'status'} aria-live="polite">
          <strong>{review.blockingMessage ? '請先確認選取範圍' : `可整理 ${review.rows.length} 筆 · ${review.correctionCount} 筆待修正`}</strong>
          <p>{review.blockingMessage || '下一步可逐筆修改、取消勾選，再確認儲存；每次最多 500 筆。'}</p>
        </div>
        {error && <p role="alert" className={styles.warning}>{error}</p>}
        <div className={styles.actions}>
          <button type="button" className="btn primary" aria-describedby={reviewId}
            disabled={!selected.length || !!review.blockingMessage}
            onClick={() => {
              if (review.blockingMessage) return;
              try { onConfirm(review.rows, review.issues); }
              catch { setError('無法開啟草稿，選取內容仍保留，請重試。'); }
            }}>整理選取內容</button>
          <button type="button" className="btn" onClick={onCancel}>取消這份文件</button>
        </div>
      </footer>
    </section>
  );
}
