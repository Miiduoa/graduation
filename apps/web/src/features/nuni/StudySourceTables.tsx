'use client';

import { useMemo } from 'react';
import { extractStudySourceTables, type StudySourceTable } from './studySourceTables';
import styles from './CourseStudyPanel.module.css';


type SourceValueRow = { label: string; original: string; amount: number };

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
const NON_RATIO_CLOCK_POSITION_COLUMN =
  /(?:時刻|時間點|鐘點|開課時間|上課時間|下課時間|開始時間|結束時間|發車時間|抵達時間|到站時間|經度|緯度|經緯度|座標|坐標|海拔|標高)/u;
const ENGLISH_NON_RATIO_CLOCK_POSITION_COLUMN =
  /\b(?:time\s+of\s+day|clock\s+time|(?:start|end|departure|arrival|class)\s+time|latitude|longitude|coordinates?|altitude|elevation)\b/iu;

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
      NON_RATIO_SCIENCE_COLUMN.test(column) || ENGLISH_NON_RATIO_SCIENCE_COLUMN.test(column) ||
      DECIBEL_UNIT_COLUMN.test(column) ||
      NON_RATIO_CLOCK_POSITION_COLUMN.test(column) ||
      ENGLISH_NON_RATIO_CLOCK_POSITION_COLUMN.test(column) ||
      ((NON_RATIO_SCORE_SCALE_COLUMN.test(column) ||
        ENGLISH_NON_RATIO_SCORE_SCALE_COLUMN.test(column)) &&
       !SCORE_COUNT_COLUMN.test(column))) return null;
  if (/(?:日期|年份|學年度|學號|學籍號|課號|座號|編號|序號|識別碼|身分證|護照號|郵遞區號|電話|手機|帳號|代碼|代號)/u.test(column) ||
      /^(?:年度|year|date|id|uuid|no\.?|number)$/iu.test(column) ||
      // A number identifying a term, page, floor or class is an ordinal or
      // category, not a comparable measure. Parenthetical source qualifiers
      // (e.g. 學年（民國）) must not turn it into a bar.
      /^(?:學年|學期|年級|班級|頁碼|頁次|週次|樓層|排名|名次|月份|民國年|西元年)(?:\s*[（(][^）)]*[）)])?$/u.test(column) ||
      /^(?:semester|term|month|rank|ranking|floor|grade|page)$/iu.test(column) ||
      /\b(?:academic\s+(?:year|term|semester)|student\s+(?:id|number)|course\s+(?:id|code|number)|postal\s+code|zip\s+code|phone\s+number|account\s+(?:id|number)|page\s+(?:no\.?|number)|sequence\s+number|floor\s+number)\b/iu.test(column)) return null;
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
          <StudySourcePercentComparison table={table} />
        </div>
      ))}
    </section>
  );
}
