'use client';

import { useId, useState } from 'react';
import {
  parsePersonalImportDocument,
  PERSONAL_IMPORT_MAX_ROWS,
  type PersonalImportDocument,
  type PersonalImportOptions,
  type PersonalImportRow,
  type ImportIssue,
} from '@campus/shared';
import styles from './PersonalImport.module.css';

export function DocumentSelection({
  document,
  options,
  initialSelection,
  onSelectionChange,
  onConfirm,
  onCancel,
  onAi,
  aiDisabled = false,
  aiNote,
}: {
  document: PersonalImportDocument;
  options: PersonalImportOptions;
  initialSelection?: { selected: string[]; headers: Record<string, number> } | null;
  onSelectionChange?: (selection: { selected: string[]; headers: Record<string, number> }) => void;
  onConfirm: (rows: PersonalImportRow[], issues: ImportIssue[]) => void;
  onCancel: () => void;
  onAi?: (selection: { selected: string[]; headers: Record<string, number> }) => void;
  aiDisabled?: boolean;
  aiNote?: string;
}) {
  const aiNoteId = useId();
  const first = document.sections.find((section) => !section.needsOcr && section.rows.length);
  const [selected, setSelected] = useState<string[]>(
    initialSelection?.selected ?? (first ? [first.id] : []),
  );
  const [headers, setHeaders] = useState<Record<string, number>>(
    () =>
      initialSelection?.headers ??
      Object.fromEntries(
        document.sections.map((section) => [section.id, section.rows[0]?.line ?? 1]),
      ),
  );
  const [error, setError] = useState('');
  return (
    <section className={styles.panel} aria-label="選擇文件內容">
      <h3>{document.name}</h3>
      <p>
        選擇要匯入的{document.format === 'xlsx' ? '工作表' : '頁面'}
        ，再指定欄位標題所在的列。每次最多整理 500 筆；尚未寫入個人紀錄。
      </p>
      {document.warnings.map((warning, index) => (
        <p key={index} role="status">
          {warning}
        </p>
      ))}
      {document.sections.map((section) => (
        <div key={section.id} className={styles.source}>
          <label className={styles.check}>
            <input
              type="checkbox"
              checked={selected.includes(section.id)}
              disabled={section.needsOcr || !section.rows.length}
              onChange={(event) => {
                const next = event.target.checked
                  ? [...selected, section.id]
                  : selected.filter((id) => id !== section.id);
                setSelected(next);
                onSelectionChange?.({ selected: next, headers });
              }}
            />
            {section.label} · {section.rows.length} 列
          </label>
          {section.warnings.map((warning, index) => (
            <p key={index}>{warning}</p>
          ))}
          {section.needsOcr && <p>這一頁仍無法讀取文字，請將該頁截圖後重新辨識。</p>}
          {selected.includes(section.id) && (
            <>
              <label className={styles.field}>
                「{section.label}」的標題列
                <select
                  value={headers[section.id]}
                  onChange={(event) => {
                    const next = {
                      ...headers,
                      [section.id]: Number(event.target.value),
                    };
                    setHeaders(next);
                    onSelectionChange?.({ selected, headers: next });
                  }}
                >
                  {section.rows.map((row) => (
                    <option key={row.line} value={row.line}>
                      第 {row.line} 列：{row.cells.join(' ｜ ').slice(0, 100)}
                    </option>
                  ))}
                </select>
              </label>
              <div style={{ overflowX: 'auto', maxWidth: '100%' }}>
                <table>
                  <caption>{section.label}：從標題列開始預覽前 6 列</caption>
                  <tbody>
                    {section.rows
                      .filter((row) => row.line >= headers[section.id])
                      .slice(0, 6)
                      .map((row) => (
                        <tr key={row.line}>
                          <th scope="row">{row.line}</th>
                          {row.cells.map((cell, index) => (
                            <td
                              key={index}
                              style={{
                                padding: 8,
                                whiteSpace: 'pre-wrap',
                                minWidth: 72,
                                maxWidth: 280,
                                overflowWrap: 'anywhere',
                              }}
                            >
                              {cell || '—'}
                            </td>
                          ))}
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      ))}
      {error && <p role="alert">{error}</p>}
      {onAi && (
        <div className={styles.aiTools}>
          <div>
            <strong>標題或欄位沒有對上？</strong>
            <p>
              AI 不需要固定欄位名稱。請將上方的標題列設為資料起始列，AI
              會整理選取內容從該列開始的文字，完成後再由你核對。
            </p>
            {aiNote && (
              <p id={aiNoteId} className={styles.note}>
                {aiNote}
              </p>
            )}
          </div>
          <button
            type="button"
            className="btn"
            disabled={!selected.length || aiDisabled}
            aria-describedby={aiNote ? aiNoteId : undefined}
            onClick={() => {
              setError('');
              onAi({ selected, headers });
            }}
          >
            用 AI 整理選取內容
          </button>
        </div>
      )}
      <div className={styles.actions}>
        <button
          type="button"
          className="btn primary"
          disabled={!selected.length}
          onClick={() => {
            try {
              const parsed = selected.map((id) =>
                parsePersonalImportDocument(document, id, headers[id], options),
              );
              const rows = parsed.flatMap((result) => result.rows);
              if (rows.length > PERSONAL_IMPORT_MAX_ROWS)
                throw new Error('選取的內容超過 500 筆，請減少工作表或頁面，分次匯入。');
              if (!rows.length)
                throw new Error('沒有整理出資料，請確認匯入類型、標題列與欄位名稱。');
              onConfirm(
                rows,
                parsed.flatMap((result) => result.issues),
              );
            } catch (cause) {
              setError(cause instanceof Error ? cause.message : '無法整理這份文件，請確認標題列。');
            }
          }}
        >
          整理選取內容
        </button>
        <button type="button" className="btn" onClick={onCancel}>
          取消這份文件
        </button>
      </div>
    </section>
  );
}
