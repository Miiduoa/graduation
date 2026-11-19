'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { extractStudySourceTables, type StudySourceTable } from './studySourceTables';
import styles from './CourseStudyPanel.module.css';


type SourceValueRow = { label: string; original: string; amount: number };

// A mobile WebView can leave clipboard.writeText() unresolved indefinitely.
// After this limit, restore a clear manual-copy route without changing the source.
const SOURCE_CLIPBOARD_CONFIRM_MS = 5000;

const SOURCE_PERCENT_COLUMN = /(?:百分比|百分率|佔比|占比|完成率|正確率|出席率|通過率|達成率|合格率|參與率|缺席率|進度|完成度|[%％])/u;
const ENGLISH_PERCENT_COLUMN =
  /\b(?:percent(?:age)?|progress(?:\s+rate)?|completion\s+rate|accuracy(?:\s+rate)?|attendance\s+rate|participation\s+rate|retention\s+rate|conversion\s+rate|error\s+rate|dropout\s+rate|pass(?:ing)?\s+rate|success\s+rate)\b/iu;

// An English rate header must not quietly use max-of-column scaling, and
// raw numbers without an explicit percent sign remain ambiguous.
// A generic rate/ratio header is not a quantity even if it contains bare
// numbers. Never scale 75 to a 100%-looking bar just because it is the maximum.
const SOURCE_RATE_OR_RATIO_COLUMN = /(?:率|比例|比率|佔比|占比)/u;
const ENGLISH_RATE_OR_RATIO_COLUMN = /\b(?:rate|ratio|share)\b/iu;
// Changes, investment returns and interest can exceed 100% or be negative.
// A fixed 100% meter would claim a ceiling that the lesson never established.
const SOURCE_UNBOUNDED_RATE_COLUMN =
  /(?:成長|增長|變化|變動|增減|漲幅|跌幅|年增|月增|報酬|回報|利率|通膨|年化|殖利率|利潤|毛利|盈餘|虧損|淨利)/u;
const ENGLISH_UNBOUNDED_RATE_COLUMN =
  /\b(?:growth|change|increase|decrease|return|yield|interest|inflation|profit|loss|margin|appreciation|depreciation)\b/iu;

// Celsius/Fahrenheit temperatures, pH, decibels and earthquake magnitudes
// have an arbitrary zero or logarithmic scale. A zero-based meter would
// falsely imply that a 40 °C reading is twice as hot as 20 °C, or that
// pH 8 is twice pH 4. Keep exact source cells, but omit a ratio-style bar.
// Textbook headers often abbreviate temperature as 氣溫、Temp or °C/℃,
// and sound level as dBA/dBFS. These still cannot use zero-based ratio bars.
// Keep the case-sensitive dB unit separate so "DB Record Count" is not
// misclassified as a decibel measurement.
const NON_RATIO_SCIENCE_COLUMN =
  /(?:溫度|氣溫|室溫|體溫|水溫|攝氏|華氏|酸鹼值|酸鹼度|地震規模|震級|分貝|[℃℉]|°\s*[CF]\b)/iu;
const ENGLISH_NON_RATIO_SCIENCE_COLUMN =
  /\b(?:temperature|temp\.?|celsius|fahrenheit|pH|decibels?|richter)\b/iu;
const DECIBEL_UNIT_COLUMN = /\bdB(?:A|C|FS|m|W)?\b/u;
// Clock readings and geographic coordinates have conventional origins.
// Even positive bare figures (8 vs 12 o'clock, 24 vs 25 degrees east)
// are not ratios; retain the original table without a zero-based chart.
// Do not blacklist elapsed study hours or distances, which can be quantities.
// Calendar ordinals, Unix/POSIX timestamps and UTC offsets also have no
// meaningful multiplicative zero. A "Due Date" of 20 is not twice a "Due Date"
// of 10; elapsed days and explicit durations remain eligible.
const NON_RATIO_CLOCK_POSITION_COLUMN =
  /(?:時刻|當地時間|臺北時間|台北時間|標準時間|時間點|鐘點|開課時間|上課時間|下課時間|開始時間|結束時間|發車時間|抵達時間|到站時間|截止時間|時間戳(?:記)?|時區(?:偏移)?|日期|截止日|到期日|經度|緯度|經緯度|座標|坐標|海拔|標高)/u;
const ENGLISH_NON_RATIO_CLOCK_POSITION_COLUMN =
  /\b(?:time\s+of\s+day|clock\s+time|(?:local|utc|gmt|standard)\s+time|time\s+of\s+(?:arrival|departure)|(?:start|end|departure|arrival|class|due)\s+time|day\s+of\s+month|dates?|datetime|timestamp|(?:unix|posix)\s+(?:time|timestamp|epoch)|epoch\s+(?:seconds?|milliseconds?|time)|(?:utc|gmt)\s+offset|time\s*zone|timezone|latitude|longitude|coordinates?|altitude|elevation)\b/iu;

// An unqualified "時間" / "Time" column can mean a clock reading or elapsed
// duration. A zero-based bar silently assumes duration, which the material
// has not established. Only explicitly named durations (e.g. 學習時數,
// Study Hours) are eligible for a quantitative comparison.
const AMBIGUOUS_TIME_COLUMN =
  /^(?:時間|時段|日|日期|日期時間|time|date|day)(?:\s*[（(][^）)]{1,40}[）)])?$/iu;

// GPA, exam scores, Likert ratings, IQ and index numbers are scale readings,
// not quantities with a meaningful ratio to zero. A 4.0 GPA does not indicate
// twice the achievement of a 2.0 GPA. Counts *of* ratings, however, are real
// quantities and should remain available to compare.
const NON_RATIO_SCORE_SCALE_COLUMN =
  /(?:成績|分數|得分|評分|評級|星等|滿意度|績點|智商|指數)/u;
const ENGLISH_NON_RATIO_SCORE_SCALE_COLUMN =
  /\b(?:gpa|grades?|scores?|ratings?|likert|satisfaction|iq|index|indices)\b/iu;
const SCORE_COUNT_COLUMN =
  /(?:人數|筆數|次數|數量|總數|件數|\b(?:count|number\s+of|quantity|entries)\b)/iu;

function isPercentageColumn(header: string): boolean {
  return SOURCE_PERCENT_COLUMN.test(header) || ENGLISH_PERCENT_COLUMN.test(header) ||
    SOURCE_RATE_OR_RATIO_COLUMN.test(header) || ENGLISH_RATE_OR_RATIO_COLUMN.test(header);
}

// Only columns with an established 0–100 interpretation receive a 100% meter.
// A bare "Rate", ratio, growth or return stays as a source table, not a graph.
function isBoundedPercentageColumn(header: string): boolean {
  return (SOURCE_PERCENT_COLUMN.test(header) || ENGLISH_PERCENT_COLUMN.test(header)) &&
    !SOURCE_UNBOUNDED_RATE_COLUMN.test(header) &&
    !ENGLISH_UNBOUNDED_RATE_COLUMN.test(header);
}

/**
 * Optional, source-grounded comparison of plain non-negative values only.
 * A number with units, a percentage, a date or an expression is not a scalar
 * measure we can safely turn into a bar. No AI inference or source rewriting.
 */
function sourceValueRows(table: StudySourceTable): SourceValueRow[] | null {
  if (table.headers.length !== 2 || table.rows.length < 2 || table.rows.length > 10) return null;
  // Numeric-looking years and identifiers are not scalar measures; comparing
  // them as bars would imply a magnitude that the source does not support.
  const column = table.headers[1].trim();
  // An unlabeled number in a percentage column is ambiguous: do not scale it to the largest row.
  if (isPercentageColumn(column) ||
      AMBIGUOUS_TIME_COLUMN.test(column) ||
      NON_RATIO_SCIENCE_COLUMN.test(column) || ENGLISH_NON_RATIO_SCIENCE_COLUMN.test(column) ||
      DECIBEL_UNIT_COLUMN.test(column) ||
      NON_RATIO_CLOCK_POSITION_COLUMN.test(column) ||
      ENGLISH_NON_RATIO_CLOCK_POSITION_COLUMN.test(column) ||
      ((NON_RATIO_SCORE_SCALE_COLUMN.test(column) ||
        ENGLISH_NON_RATIO_SCORE_SCALE_COLUMN.test(column)) &&
       !SCORE_COUNT_COLUMN.test(column))) return null;
  // A question number identifies an exercise; its magnitude is not a measured result.
  // Keep the exact table, but never turn "第 2 題" vs "第 4 題" into a 2× bar.
  if (/(?:日期|年份|學年度|學號|學籍號|課號|座號|題號|題次|編號|序號|識別碼|身分證|護照號|郵遞區號|電話|手機|帳號|代碼|代號)/u.test(column) ||
      /\b(?:question|problem|exercise|item)\s+(?:id|number|no\.?)(?:\b|$)/iu.test(column) ||
      /^(?:年度|year|date|id|uuid|no\.?|number)$/iu.test(column) ||
      // A number identifying a term, page, floor or class is an ordinal or
      // category, not a comparable measure. Parenthetical source qualifiers
      // (e.g. 學年（民國）) must not turn it into a bar.
      /^(?:學年|學期|年級|班級|頁碼|頁次|週次|樓層|排名|名次|月份|民國年|西元年)(?:\s*[（(][^）)]*[）)])?$/u.test(column) ||
      /^(?:semester|term|month|rank|ranking|floor|grade|page)$/iu.test(column) ||
      /\b(?:academic\s+(?:year|term|semester)|student\s+(?:id|number)|course\s+(?:id|code|number)|postal\s+code|zip\s+code|phone\s+number|account\s+(?:id|number)|page\s+(?:no\.?|number)|sequence\s+number|floor\s+number)\b/iu.test(column)) return null;
  // A textbook's week, chapter or lesson ordinal is a position, not a
  // measurement. "Chapter 4" must not appear twice as large as "Chapter 2".
  // Count headers (e.g. Number of Chapters / 章節數量) remain eligible.
  if (/^(?:章節|章次|章號|單元|單元號|單元編號|課次|講次|節次|第幾週)(?:\\s*[（(][^）)]{1,40}[）)])?$/u.test(column) ||
      /^(?:week|chapter|unit|lesson|module|section|lecture|session)(?:\\s+(?:number|no\\.?|id|#))?(?:\\s*\\([^)]{1,40}\\))?$/iu.test(column)) return null;
  // Numeric room and seat labels identify where a student belongs, not
  // quantities: classroom 301 is not 1.5 times classroom 205. A real
  // "教室數" / "Room Count" header remains a valid measured quantity.
  if (/^(?:教室|實驗室|房號|寢室|寢室號|宿舍房號|房間號碼|校舍|大樓|座位|座位號|位置|地點)(?:\s*[（(][^）)]{1,40}[）)])?$/u.test(column) ||
      /^(?:classroom|room|dorm(?:itory)?\s+room|lab(?:oratory)?|building|location|seat)(?:\s+(?:no\.?|number|id|code))?(?:\s*\([^)]{1,40}\))?$/iu.test(column)) return null;
  // Repeated "學分" is an explicit source unit, not a value to infer.
  // Accept it only in a credit column and when ALL rows use the same format.
  const plainNumber = /^(?:0|[1-9]\d{0,5})(?:\.\d{1,2})?$/u;
  const creditNumber = /^((?:0|[1-9]\d{0,5})(?:\.\d{1,2})?) ?學分$/u;
  const creditsColumn = /(?:學分|credits?)/iu.test(column);
  let rowFormat: 'plain' | 'credits' | null = null;
  const rows: SourceValueRow[] = [];
  const labels = new Set<string>();
  for (const [label, original] of table.rows) {
    if (!label?.trim() || !original || labels.has(label.trim())) return null;
    const creditMatch = creditsColumn ? creditNumber.exec(original) : null;
    const format = plainNumber.test(original) ? 'plain' : creditMatch ? 'credits' : null;
    if (!format || (rowFormat !== null && format !== rowFormat)) return null;
    rowFormat = format;
    const amount = Number(creditMatch?.[1] ?? original);
    if (!Number.isFinite(amount)) return null;
    labels.add(label.trim());
    rows.push({ label, original, amount });
  }
  return rows.some((row) => row.amount > 0) ? rows : null;
}

/**
 * Only an explicitly percentage-labelled column containing literal 0–100%
 * source values can be shown on a fixed 100% scale. Do not reinterpret raw
 * scores, relative growth over 100%, dates, IDs or unit-bearing quantities.
 */
function sourcePercentRows(table: StudySourceTable): SourceValueRow[] | null {
  if (table.headers.length !== 2 || table.rows.length < 2 || table.rows.length > 10) return null;
  if (!isBoundedPercentageColumn(table.headers[1])) return null;
  const rows: SourceValueRow[] = [];
  const labels = new Set<string>();
  for (const [label, original] of table.rows) {
    if (!label?.trim() || !original ||
        !/^(?:0|[1-9]\d?|100)(?:\.\d{1,2})?[%％]$/u.test(original) ||
        labels.has(label.trim())) return null;
    const amount = Number(original.slice(0, -1));
    if (!Number.isFinite(amount) || amount > 100) return null;
    labels.add(label.trim());
    rows.push({ label, original, amount });
  }
  return rows;
}

function StudySourcePercentComparison({ table }: { table: StudySourceTable }) {
  const rows = sourcePercentRows(table);
  if (!rows) return null;
  return (
    <details className={styles.sourceValueComparison}>
      <summary>展開第 2 欄「{table.headers[1]}」的原文百分比（100% 滿格）</summary>
      <p className={styles.note}>
        僅顯示原表格明確標示的 0–100% 百分比，滿格固定為 100%，不是以最高一筆重新縮放。
        不補值、不推斷成績好壞或圖像內容，請對照上方教材原文。
      </p>
      <ul className={styles.sourceValueList} aria-label={table.headers[1] + ' 原文百分比'}>
        {rows.map((row) => (
          <li key={row.label}>
            <div className={styles.sourceValueRow}>
              <span>{row.label}</span>
              <span>{row.original}</span>
            </div>
            <meter min={0} max={100} value={row.amount}
              aria-label={row.label + '：' + row.original}
              aria-valuetext={row.original + '；滿格 100%'} />
          </li>
        ))}
      </ul>
    </details>
  );
}

/** Keep the original table visible; numeric bars are an opt-in derived view. */
function StudySourceValueComparison({ table }: { table: StudySourceTable }) {
  const rows = sourceValueRows(table);
  if (!rows) return null;
  const maxRow = rows.reduce((best, row) => row.amount > best.amount ? row : best);
  const max = maxRow.amount;
  return (
    <details className={styles.sourceValueComparison}>
      <summary>展開第 2 欄「{table.headers[1]}」的原文數值比較</summary>
      <p className={styles.note}>
        只比較明確的非負純數字，或學分欄每列都寫出「學分」的非負數；以本欄最大值為滿格。
        不換算單位、不混用純數字與附單位數值，也不比較日期或編號；請核對上方原文。
      </p>
      <ul className={styles.sourceValueList} aria-label={table.headers[1] + ' 原文數值比較'}>
        {rows.map((row) => (
          <li key={row.label}>
            <div className={styles.sourceValueRow}>
              <span>{row.label}</span>
              <span>{row.original}</span>
            </div>
            <meter min={0} max={max} value={row.amount}
              aria-label={row.label + '：' + row.original}
              aria-valuetext={row.original + '；本欄最大值 ' + maxRow.original} />
          </li>
        ))}
      </ul>
    </details>
  );
}

/** Keep every original newline separately so CR-only Mac files and mixed files
 * can be exported verbatim. HTML textarea.value may normalize these delimiters. */
type OriginalSourceLine = { text: string; separator: string };
function splitOriginalSourceLines(source: string): OriginalSourceLine[] {
  const lines: OriginalSourceLine[] = [];
  let from = 0;
  for (const boundary of source.matchAll(/\r\n|\r|\n/gu)) {
    const offset = boundary.index;
    lines.push({ text: source.slice(from, offset), separator: boundary[0] });
    from = offset + boundary[0].length;
  }
  lines.push({ text: source.slice(from), separator: '' });
  return lines;
}

/** Select only the source's original table lines; never reserialize hidden cells. */
function tableSourceSelection(lines: OriginalSourceLine[], table: StudySourceTable, rowIndex: number | null = null): string {
  const start = table.startLine - 1;
  if (rowIndex !== null) {
    // A single data row is copied as its exact source line, without
    // synthesizing headers, omitting a hidden cell or joining non-adjacent rows.
    if (!Number.isInteger(rowIndex) || rowIndex < 0 || rowIndex >= table.rows.length) return '';
    return lines[start + 2 + rowIndex]?.text ?? '';
  }
  const end = start + table.rows.length + 2;
  const selected = lines.slice(start, end);
  // Preserve each interior newline byte-for-byte, but not the delimiter
  // AFTER the last row. Do not add a later paragraph or a hidden source line.
  return selected.map((line, index) =>
    line.text + (index < selected.length - 1 ? line.separator : '')).join('');
}

// A few iOS Safari and in-app WebViews throw when select() is called on a
// readonly textarea. Keep the original table text in place and try a precise
// selection range too, so a failed browser selection never breaks copying.
function selectOriginalTableText(field: HTMLTextAreaElement | null) {
  if (!field) return;
  try { field.focus(); } catch { /* The student can still long-press the source. */ }
  try { field.select(); } catch { /* Try the explicit selection range below. */ }
  try { field.setSelectionRange(0, field.value.length); }
  catch { /* The unchanged source remains available for native selection. */ }
}

/** Keep per-table selection local and reset it when the authorized source changes. */
function StudySourceSelection({ table, index, sourceLines }: {
  table: StudySourceTable;
  index: number;
  sourceLines: OriginalSourceLine[];
}) {
  const [rowIndex, setRowIndex] = useState(-1);
  // Use the authorized source, not textarea.value: textareas normalize CRLF
  // to LF, and a stale WebView DOM value is not evidence from the lesson.
  const selectedSource = tableSourceSelection(sourceLines, table, rowIndex < 0 ? null : rowIndex);
  const [copyFeedback, setCopyFeedback] = useState('');
  const originalText = useRef<HTMLTextAreaElement>(null);
  const copyRequest = useRef(0);
  const copyTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const invalidateCopy = useCallback(() => {
    copyRequest.current += 1;
    if (copyTimeout.current !== null) {
      clearTimeout(copyTimeout.current);
      copyTimeout.current = null;
    }
  }, []);
  // An asynchronous clipboard result must not announce success for a row or
  // authorized source that the student has already changed.
  useEffect(() => {
    invalidateCopy();
    setRowIndex(-1);
    setCopyFeedback('');
  }, [sourceLines, invalidateCopy]);
  useEffect(() => () => { invalidateCopy(); }, [invalidateCopy]);

  const manualCopy = (request: number) => {
    if (copyRequest.current === request) {
      invalidateCopy();
      setCopyFeedback('瀏覽器未確認複製；原文仍保留在下方，請長按選取或使用鍵盤複製。');
    }
  };
  const selectSelectedOriginal = () => {
    const field = originalText.current;
    if (!field) return;
    // Readonly DOM values can still drift after an embedded WebView glitch.
    // Repair the long-press fallback before selection and clipboard access.
    if (field.value !== selectedSource.replace(/\r\n?/gu, '\n')) field.value = selectedSource;
    selectOriginalTableText(field);
  };
  const copySelectedOriginal = () => {
    const field = originalText.current;
    if (!field) return;
    invalidateCopy();
    const request = copyRequest.current;
    setCopyFeedback('');
    // Preserve a selectable fallback before any async permission prompt. On
    // mobile, selection can remain useful even if clipboard access is denied.
    selectSelectedOriginal();
    try {
      const clipboard = navigator.clipboard;
      if (typeof clipboard?.writeText !== 'function') {
        manualCopy(request);
        return;
      }
      const result: unknown = clipboard.writeText(selectedSource);
      // A few WebViews return undefined/false rather than a Promise while
      // silently doing nothing. Never report that as a confirmed copy.
      if (!result || typeof (result as PromiseLike<unknown>).then !== 'function') {
        manualCopy(request);
        return;
      }
      setCopyFeedback('正在等待瀏覽器確認複製；若沒有回應，可長按下方原文手動複製。');
      copyTimeout.current = setTimeout(() => manualCopy(request), SOURCE_CLIPBOARD_CONFIRM_MS);
      void Promise.resolve(result as PromiseLike<unknown>).then(
        (acknowledged) => {
          if (copyRequest.current !== request) return;
          if (acknowledged === false) manualCopy(request);
          else {
            invalidateCopy();
            setCopyFeedback('瀏覽器已接受複製指令；若無法貼上，仍可長按下方原文。');
          }
        },
        () => manualCopy(request),
      );
    } catch {
      // Accessing navigator.clipboard itself may throw in some WebViews.
      manualCopy(request);
    }
  };

  const downloadSelectedOriginal = () => {
    // An explicit local TXT export avoids clipboard permission prompts and
    // preserves exact CRLF from the authorized lesson (textarea normalizes it).
    // Do not treat the click as proof that a mobile browser saved the file.
    invalidateCopy();
    selectSelectedOriginal();
    let objectUrl: string | null = null;
    try {
      const createdUrl: unknown = URL.createObjectURL(new Blob([selectedSource], { type: 'text/plain;charset=utf-8' }));
      // Some broken WebViews return undefined, an empty string or a non-Blob
      // URL without throwing. Never click a link to the current page or an
      // unexpected site while the student is exporting private lesson text.
      if (typeof createdUrl !== 'string' || !createdUrl.startsWith('blob:') || createdUrl.length <= 5) {
        throw new Error('Browser did not create a Blob download URL');
      }
      objectUrl = createdUrl;
      const anchor = document.createElement('a');
      anchor.href = objectUrl;
      anchor.download = `nuni-study-table-${index + 1}${rowIndex < 0 ? '' : `-row-${rowIndex + 1}`}.txt`;
      anchor.hidden = true;
      document.body.appendChild(anchor);
      try {
        anchor.click();
        setCopyFeedback('已向瀏覽器送出 TXT 下載，請確認下載項目；若未成功，可長按下方原文複製。');
      } finally {
        anchor.remove();
      }
    } catch {
      setCopyFeedback('無法啟動 TXT 下載；原文仍可在下方長按或使用鍵盤複製。');
    } finally {
      if (objectUrl !== null) {
        // iOS Safari can consume blob URLs after the click returns; do not
        // revoke synchronously, but always release the URL eventually.
        const consumedUrl = objectUrl;
        setTimeout(() => {
          try { URL.revokeObjectURL(consumedUrl); }
          catch { /* Cleanup cannot change the selected source. */ }
        }, 30_000);
      }
    }
  };

  return (
    <details className={styles.sourceTableSelection}>
      <summary>選取第 {index + 1} 張表格的原文（可複製）</summary>
      <p className={styles.note}>
        可選整張表格或單一資料列的原始 Markdown 行，不重新編造欄位內容。
        單列不包含欄名，請對照上方表格；可以直接複製，若瀏覽器阻擋剪貼簿權限，仍可長按或鍵盤選取原文。
      </p>
      <label>
        原文範圍
        <select aria-label={`第 ${index + 1} 張表格的原文選取範圍`}
          value={rowIndex}
          onChange={(event) => {
            const next = Number(event.target.value);
            if (next === -1 || (Number.isInteger(next) && next >= 0 && next < table.rows.length)) {
              invalidateCopy();
              setCopyFeedback('');
              setRowIndex(next);
            }
          }}>
          <option value={-1}>整張表格（含欄名）</option>
          {table.rows.map((row, number) =>
            <option key={number} value={number}>
              第 {number + 1} 列（原文第 {table.startLine + 2 + number} 行：{row[0]}）
            </option>)}
        </select>
      </label>
      <button type="button" onClick={selectSelectedOriginal}>
        {rowIndex < 0
          ? `全選第 ${index + 1} 張表格原文`
          : `全選第 ${index + 1} 張表格第 ${rowIndex + 1} 列原文`}
      </button>
      <button type="button" onClick={copySelectedOriginal}>
        {rowIndex < 0
          ? `複製第 ${index + 1} 張表格原文`
          : `複製第 ${index + 1} 張表格第 ${rowIndex + 1} 列原文`}
      </button>
      <button type="button" onClick={downloadSelectedOriginal}>
        {rowIndex < 0
          ? `下載第 ${index + 1} 張表格原文 TXT`
          : `下載第 ${index + 1} 張表格第 ${rowIndex + 1} 列原文 TXT`}
      </button>
      <p className={styles.note} role="status">{copyFeedback}</p>
      <textarea
        ref={originalText}
        aria-label={`原文表格 ${index + 1} 的可選取文字`}
        readOnly
        spellCheck={false}
        rows={rowIndex < 0 ? Math.min(8, table.rows.length + 2) : 2}
        value={selectedSource}
      />
    </details>
  );
}

/** Optional accessible table layout derived solely from the exact source text. */
export function StudySourceTables({ text }: { text: string }) {
  const tables = useMemo(() => extractStudySourceTables(text), [text]);
  const sourceLines = useMemo(() => splitOriginalSourceLines(text), [text]);
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
          <StudySourceSelection table={table} index={index} sourceLines={sourceLines} />
          <StudySourceValueComparison table={table} />
          <StudySourcePercentComparison table={table} />
        </div>
      ))}
    </section>
  );
}
