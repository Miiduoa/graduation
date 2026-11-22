'use client';

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { extractStudySourceTables, type StudySourceTable } from './studySourceTables';
import { hasVisibleStudyContent } from './courseStudySession';
import styles from './CourseStudyPanel.module.css';


// Software release labels are identifiers, not ratio-scale measurements:
// version 4 is not twice version 2, and build 300 is not three times build 100.
// Explicit counts of versions/releases are measured quantities, however.
const NON_RATIO_RELEASE_COLUMN =
  /(?:版本|版次|修訂(?:版|號)|發行版|發行號|編譯號|\b(?:version|revision|edition|release)\b|\bbuild\s+(?:number|no\.?|id)\b)/iu;
const RELEASE_COUNT_COLUMN = /(?:版本(?:數量|總數|數)|修訂(?:次數|總數)|發行(?:次數|總數))/u;
const ENGLISH_RELEASE_COUNT_COLUMN =
  /\b(?:number\s+of\s+(?:versions|revisions|editions|releases)|(?:version|revision|edition|release)\s+(?:count|total))\b/iu;

// Binary and categorical state codes are labels, not measurements:
// a status code of 2 is not twice the status of 1. Only explicit counts
// (e.g. 通過人數 / Status Count) may use a zero-based quantity chart.
const NON_RATIO_STATUS_COLUMN = /(?:是否|有無|與否|狀態|狀況|標記|布林|真假|開關|啟用|停用|有效性)/u;
const ENGLISH_NON_RATIO_STATUS_COLUMN =
  /(?:\b(?:status|flag|boolean|bool)\b|\b(?:is|has)\s+(?:active|completed|enabled|present|passed|valid|access|permission)\b|\bstate(?:\s*\([^)]{1,40}\))?$|^(?:enabled|disabled|active|inactive|checked)(?:\s*\([^)]{1,40}\))?$)/iu;
const STATUS_COUNT_COLUMN = /(?:人數|數量|總數|次數|筆數|件數|個數|數目)/u;
const ENGLISH_STATUS_COUNT_COLUMN = /\b(?:count|total|number\s+of|quantity)\b/iu;

// Network port numbers, radio channels and OSI protocol layers identify a
// position in a namespace, not an amount: TCP port 443 is not 5.5 times
// port 80. Keep source rows, copying and exporting unchanged. Explicit counts
// of ports/channels/layers remain measurable quantities.
// Match whole identifier headers. A numeric channel or port label is not a
// ratio-scale measurement, but "頻道頻寬" and "連接埠吞吐量" describe real
// measured quantities and must not be rejected just for containing the noun.
const NON_RATIO_NETWORK_IDENTIFIER_COLUMN =
  /^(?:(?:tcp|udp|wi-?fi|osi|無線|網路)\s*)?(?:埠號|連接埠|通訊埠|通信埠|網路埠|服務埠|來源埠|目的埠|頻道|通道|網路層級|協定號碼)(?:\s*(?:編號|號碼|號|id|no\.?|#))?(?:\s*[（(][^）)]{1,40}[）)])?$/iu;
const ENGLISH_NON_RATIO_NETWORK_IDENTIFIER_COLUMN =
  /^(?:(?:(?:tcp|udp|src|dst|source|destination|service|network)\s+)?ports?(?:\s+(?:number|no\.?|id|#))?|(?:(?:wi-?fi|wireless|radio|network)\s+)?channels?(?:\s+(?:number|no\.?|id|#))?|(?:(?:osi|network|protocol)\s+)?layers?(?:\s+(?:number|no\.?|id|#))?|protocol\s+(?:number|no\.?|id))(?:\s*[（(][^）)]{1,40}[）)])?$/iu;
// A VLAN tag / ASN and a database key are identifiers, not measured
// magnitudes. Numeric key 200 is not twice numeric key 100. Match complete
// headers to avoid hiding real VLAN traffic or counts of primary keys.
const NON_RATIO_NETWORK_NAMESPACE_COLUMN =
  /^(?:vlan(?:\s*(?:id|number|no\.?|#|編號))?|asn|as\s+(?:number|no\.?|id)|autonomous\s+system(?:\s+(?:number|no\.?|id))?|虛擬區域網路?(?:編號|識別碼|號碼|號)?|自治系統(?:編號|號碼|號)?)(?:\s*[（(][^）)]{1,40}[）)])?$/iu;
const NON_RATIO_DATABASE_KEY_COLUMN =
  /^(?:(?:主鍵|外鍵|候選鍵|代理鍵)(?:值|編號|識別碼)?|(?:primary|foreign|candidate|surrogate)\s+key(?:\s+(?:id|number|no\.?|value))?)(?:\s*[（(][^）)]{1,40}[）)])?$/iu;

const NETWORK_IDENTIFIER_COUNT_COLUMN =
  /(?:埠(?:號)?(?:數量|總數|個數|數)|通道(?:數量|總數|個數|數)|頻道(?:數量|總數|個數|數)|層(?:數量|總數|個數|數)|\b(?:count|total|number\s+of|quantity)\b)/iu;

// Carry the exact Markdown source line through both derived views, so students
// can cross-check every bar against the original authorized lesson table.
// Unicode direction controls can visually reorder an otherwise readable label.
// Keep the authorized table byte-for-byte, but never derive a chart whose
// labels a student or screen reader cannot reliably compare to that source.
const STUDY_CHART_BIDI_CONTROL = /\p{Bidi_Control}/u;
// Cc control bytes can disrupt assistive labels; unpaired UTF-16 surrogates
// display as replacement glyphs, unlike their exact original source bytes.
// Unicode-mode Cs testing does not reject intact emoji surrogate pairs.
const STUDY_CHART_INVALID_CODE_UNIT = /[\p{Cc}\p{Cs}]/u;
function hasUnambiguousChartLabel(label: string): boolean {
  return hasVisibleStudyContent(label) &&
    !STUDY_CHART_BIDI_CONTROL.test(label) &&
    !STUDY_CHART_INVALID_CODE_UNIT.test(label);
}

type SourceValueRow = { label: string; original: string; amount: number; sourceLine: number };

// A mobile WebView can leave clipboard.writeText() unresolved indefinitely.
// After this limit, restore a clear manual-copy route without changing the source.
const SOURCE_CLIPBOARD_CONFIRM_MS = 5000;

const ORIGINAL_SOURCE_PERCENT_COLUMN = /(?:百分比|百分率|佔比|占比|完成率|正確率|出席率|通過率|達成率|合格率|參與率|缺席率|進度|完成度|[%％])/u;
const SOURCE_PERCENT_COLUMN = new RegExp(ORIGINAL_SOURCE_PERCENT_COLUMN.source + '|正答率', 'u');
const ENGLISH_PERCENT_COLUMN =
  /\b(?:percent(?:age)?|progress(?:\s+rate)?|completion\s+rate|accuracy(?:\s+rate)?|attendance\s+rate|participation\s+rate|retention\s+rate|conversion\s+rate|error\s+rate|dropout\s+rate|pass(?:ing)?\s+rate|success\s+rate)\b/iu;

// English transfer/bit/data rates are measurable speeds rather than
// dimensionless percentages. Accept only complete, explicit speed labels;
// generic rates (error, interest, conversion, success) remain ambiguous.
// A trailing percent unit still takes precedence over this exemption.
const ENGLISH_MEASURED_SPEED_RATE_COLUMN =
  /^(?:data|bit|transfer|transmission|download|upload|network|link|baud|sample|sampling)\s+rate(?:\s*[（(][^）)]{1,40}[）)])?$/iu;
// An English rate header must not quietly use max-of-column scaling, and
// raw numbers without an explicit percent sign remain ambiguous.
// A generic rate/ratio header is not a quantity even if it contains bare
// numbers. Never scale 75 to a 100%-looking bar just because it is the maximum.
// A speed (速率) is a measured quantity, unlike an unqualified rate or
// proportion. Do not interpret plain speed figures as 0–100% percentages.
// Avoid lookbehind here so older mobile Safari/WebViews can parse this file.
const SOURCE_RATE_OR_RATIO_COLUMN = /(?:比例|比率|佔比|占比|(?:^|[^速])率)/u;
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
// A weekday number is a calendar position, not an elapsed duration or
// quantity: Friday (5) is not five times Monday (1). Counts of teaching days
// and actual study hours must remain eligible for measured comparisons.
const NON_RATIO_WEEKDAY_COLUMN =
  /^(?:(?:上課|開課|考試|測驗|授課)?(?:星期|禮拜|週|周)(?:幾|別|序號|編號|次序)?|(?:class|course|exam)\s+(?:weekday|day[\s-]*of[\s-]*(?:the[\s-]*)?week)|(?:weekday|week[\s-]*day|day[\s-]*of[\s-]*(?:the[\s-]*)?week)(?:\s+(?:number|no\.?|index|code|id))?)(?:\s*[（(][^）)]{1,40}[）)])?$/iu;

// A fiscal/calendar quarter NUMBER is a position in a year, not a quantity.
// In a lesson table, Q4 must not appear four times Q1. Explicit quarter counts
// (季度數量 / Quarter Count) still represent measured quantities.
const NON_RATIO_QUARTER_POSITION_COLUMN =
  /^(?:(?:(?:會計|財政|財務|營運|學年|曆年)\s*)?(?:季度|季別|季次|第幾季|第幾季度|季序號|季度序號|季度編號|季度代碼)|(?:(?:fiscal|calendar|academic)\s+)?(?:quarter|qtr)(?:\s+(?:number|no\.?|index|code|id))?)(?:\s*[（(][^）)]{1,40}[）)])?$/iu;

// Postal codes identify delivery areas rather than measured amounts. A 200
// postcode is not twice a 100 postcode. Keep the licensed lesson's original
// cells and exports; require an exact header so "寄送件數" remains measurable.
const NON_RATIO_POSTAL_IDENTIFIER_COLUMN =
  /^(?:郵遞區碼|郵遞編碼|郵政區碼|郵政編碼|郵編)(?:\s*[（(][^）)]{1,40}[）)])?$/u;
const ENGLISH_NON_RATIO_POSTAL_IDENTIFIER_COLUMN =
  /^(?:post[\s-]*code|postcode|zip(?:[\s-]*code)?)(?:\s*[（(][^）)]{1,40}[）)])?$/iu;

// Invoice, purchase, tracking and serial identifiers are opaque labels.
// Order No. 200 is not twice Order No. 100. Match whole headers only;
// real counts and monetary amounts stay eligible for measured comparisons.
const NON_RATIO_DOCUMENT_IDENTIFIER_COLUMN =
  /^(?:(?:serial|invoice|order|transaction|receipt|ticket|tracking|reference)\s+(?:number|no\.?|id|#)|(?:發票|訂單|交易|收據|票券|物流單|追蹤|序列|流水)\s*(?:號碼|編號|序號|識別碼|代碼|號))(?:\s*[（(][^）)]{1,40}[）)])?$/iu;

// Identify catalogue fields when applying the newer chart formats.
const NON_RATIO_CATALOG_IDENTIFIER_COLUMN = /^(?:(?:商品|產品|貨品|物料|零件|品項)?(?:貨號|料號|品號|條碼)|(?:商品|產品|貨品|物料|零件)(?:編號|識別碼)|(?:SKU|ASIN|ISBN(?:-1[03])?|ISSN|(?:EAN|UPC|GTIN)(?:-?(?:8|12|13|14|A|E))?)(?:\s+(?:number|no\.?|id|code|編號|條碼))?)(?:\s*[（(][^）)]{1,40}[）)])?$/iu;

// One-time sign-in, card verification and pickup codes are opaque tokens.
// A PIN of 2468 is not twice a PIN of 1234. Match complete field names so
// actual numbers of failed logins / OTP attempts can still be compared.
const NON_RATIO_AUTH_TOKEN_COLUMN =
  /^(?:(?:驗證碼|認證碼|安全碼|動態密碼|一次性密碼|登入碼|交易密碼|取件碼|核銷碼|信用卡安全碼|卡片驗證碼|卡片安全碼)(?:\s*(?:編號|號碼|數值|值))?|(?:(?:(?:credit[\s-]*card|bank|card|sms|email)\s+)?(?:otp|totp|hotp|pin|cvv2?|cvc2?|one[\s-]*time\s+(?:password|passcode)|(?:(?:verification|authentication|security|recovery|access|login|transaction|pickup|redemption|2fa|mfa)\s+(?:code|pin|passcode|otp)))(?:\s*(?:number|value|digits?))?))(?:(?:\s*[（(][^）)]{1,40}[）)])?)$/iu;

// A source line, spreadsheet row or exercise step number marks a position
// in a document or procedure, not a quantity with a meaningful ratio zero.
// Do not imply that line 4 is twice line 2. Counts of lines/rows/steps
// remain eligible for a source-grounded comparison.
const NON_RATIO_SOURCE_POSITION_COLUMN =
  /^(?:(?:(?:教材|程式碼|原始碼|來源|資料|表格|檔案)?(?:行號|列號|行序號|列序號))|(?:(?:操作|解題|實驗|作業)?(?:步驟|步序)(?:號|次|編號|序號)?)|(?:(?:(?:source|code|text|file|table|data)\s+)?(?:line|row|step|record)\s+(?:number|no\.?|index|id|#))|(?:(?:source|code)\s+line))(?:\s*[（(][^）)]{1,40}[）)])?$/iu;

// Clock readings and geographic coordinates have conventional origins.
// Even positive bare figures (8 vs 12 o'clock, 24 vs 25 degrees east)
// are not ratios; retain the original table without a zero-based chart.
// Do not blacklist elapsed study hours or distances, which can be quantities.
// Calendar ordinals, Unix/POSIX timestamps and UTC offsets also have no
// meaningful multiplicative zero. A "Due Date" of 20 is not twice a "Due Date"
// of 10; elapsed days and explicit durations remain eligible.
const NON_RATIO_CLOCK_POSITION_COLUMN =
  /(?:時刻|當地時間|臺北時間|台北時間|標準時間|時間點|鐘點|開課時間|上課時間|下課時間|開始時間|結束時間|發車時間|抵達時間|到站時間|截止時間|時間戳(?:記)?|時區(?:偏移)?|日期|截止日|到期日)/u;
const ENGLISH_NON_RATIO_CLOCK_POSITION_COLUMN =
  /\b(?:time\s+of\s+day|clock\s+time|(?:local|utc|gmt|standard)\s+time|time\s+of\s+(?:arrival|departure)|(?:start|end|departure|arrival|class|due)\s+time|day\s+of\s+month|dates?|datetime|timestamp|(?:unix|posix)\s+(?:time|timestamp|epoch)|epoch\s+(?:seconds?|milliseconds?|time)|(?:utc|gmt)\s+offset|time\s*zone|timezone)\b/iu;

const COORDINATE_COLUMN =
  /(?:經度|緯度|經緯度|座標|坐標|海拔|標高)|\b(?:latitude|longitude|coordinates?|altitude|elevation)\b/iu;

// An unqualified "時間" / "Time" column can mean a clock reading or elapsed
// duration. A zero-based bar silently assumes duration, which the material
// has not established. Only explicitly named durations (e.g. 學習時數,
// Study Hours) are eligible for a quantitative comparison.
const AMBIGUOUS_TIME_COLUMN =
  /^(?:時間|時段|日|日期|日期時間|time|date|day)(?:\s*[（(][^）)]{1,40}[）)])?$/iu;

// Percentile ranks name a position in a distribution, not a ratio-scale
// quantity: the 80th percentile is not twice the 40th percentile. Preserve
// exact lesson values; an explicitly counted population of percentiles is a
// separate quantity and may still have a source-grounded count comparison.
const NON_RATIO_PERCENTILE_COLUMN =
  /(?:百分位(?:數|階|等級|排名|序|次)?|百分等級|百分排名|百分秩|百分順位|\bpercentiles?\b)/iu;
const PERCENTILE_COUNT_COLUMN =
  /(?:百分(?:位(?:數|階|等級|排名|序|次)?|等級|排名|秩|順位)(?:的)?(?:人數|數量|總數|筆數|個數)|\b(?:count|total|number\s+of)\s+percentiles?\b|\bpercentile(?:\s+rank)?\s+(?:count|total)\b)/iu;

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

// Ranked priority, severity and difficulty levels are ORDINAL, not quantities.
// Do not imply that level 4 is twice level 2; counts OF levels remain measurable.
const NON_RATIO_ORDINAL_LEVEL_COLUMN =
  /(?:優先(?:順序|序位|級別|等級|級)|優先度|嚴重(?:程度|度|等級)|風險(?:等級|級別|程度)|難度(?:等級|級別)?|危險(?:等級|程度)|等級|級別)/u;
const ENGLISH_NON_RATIO_ORDINAL_LEVEL_COLUMN =
  /\b(?:priority|severity|difficulty|tier|level|risk\s+(?:level|grade|category))\b/iu;
const ORDINAL_COUNT_COLUMN =
  /(?:人數|數量|總數|次數|筆數|件數|個數|級數|\b(?:count|total|number\s+of|quantity|entries)\b)/iu;

// Exam and class ranks are ordinal positions, not ratio-scale quantities:
// rank 4 is not four times rank 1. Counts *of* ranks are still quantities.
const NON_RATIO_RANK_POSITION_COLUMN = /(?:排名|名次|名列)/u;
const ENGLISH_NON_RATIO_RANK_POSITION_COLUMN =
  /\b(?:rank(?:ing)?s?|(?:position|place)\s+in\s+(?:class|school|cohort|exam))\b/iu;
const RANK_RANGE_COLUMN = /(?:排名|名次|名列|前[一二三四五六七八九十百千\d０-９]+名)/u;
const RANK_LABEL_END = /(?:排名|名次|名列|\b(?:rank(?:ing)?s?(?:\s+position)?|(?:position|place)\s+in\s+(?:class|school|cohort|exam)))$/iu;
const RANK_COUNT_COLUMN =
  /(?:人數|數量|總數|次數|筆數|件數|個數|數目|\b(?:count|total|number\s+of|quantity|entries)\b)/iu;

const SOURCE_PERCENT_LABEL_END = new RegExp(
  `(?:${SOURCE_PERCENT_COLUMN.source})(?:\\s*[（(]\\s*[%％]\\s*[）)])?$`, 'u',
);
const SOURCE_PERCENT_GROUP_SUFFIX = new RegExp(
  `^(.*?(?:${SOURCE_PERCENT_COLUMN.source}))(?:依|按).+$`, 'u',
);
const PERCENT_UNIT_END = /(?:[（(]\s*[%％]\s*[）)]|[%％])$/u;

function measuredColumnLabel(header: string): string {
  const label = header.trim();
  // Keep an explicit trailing percent unit even when it follows a group name.
  const unit = PERCENT_UNIT_END.exec(label)?.[0];
  const [measure] = label.split(/\s+(?:by|per|each)\s+|\s*[（(]\s*(?:依|按)|\s+(?:依|按)/iu, 1);
  if (measure !== label) return unit && !PERCENT_UNIT_END.test(measure) ? measure + ' ' + unit : measure;
  if (!/^(?:依|按)/u.test(label)) return SOURCE_PERCENT_GROUP_SUFFIX.exec(label)?.[1] ?? label;
  const groupedPrefix = /^(?:依|按).+?(?:分組(?:統計)?|統計|計算|[：:])[\s，、：:]*/u;
  if (groupedPrefix.test(label)) return label.replace(groupedPrefix, '') || label;
  // Without a separator, keep any return or growth qualifier attached.
  if (SOURCE_UNBOUNDED_RATE_COLUMN.test(label)) return label;
  const percent = SOURCE_PERCENT_LABEL_END.exec(label)?.[0];
  return percent && percent !== '%' && percent !== '％' ? percent : label;
}

function isPercentageColumn(header: string): boolean {
  return SOURCE_PERCENT_COLUMN.test(header) || ENGLISH_PERCENT_COLUMN.test(header) ||
    SOURCE_RATE_OR_RATIO_COLUMN.test(header) ||
    (ENGLISH_RATE_OR_RATIO_COLUMN.test(header) && !ENGLISH_MEASURED_SPEED_RATE_COLUMN.test(header));
}

// Only columns with an established 0–100 interpretation receive a 100% meter.
// A bare "Rate", ratio, growth or return stays as a source table, not a graph.
function hasUnboundedRateLabel(header: string): boolean {
  return SOURCE_UNBOUNDED_RATE_COLUMN.test(header) || ENGLISH_UNBOUNDED_RATE_COLUMN.test(header);
}

function isBoundedPercentageColumn(header: string): boolean {
  return (SOURCE_PERCENT_COLUMN.test(header) || ENGLISH_PERCENT_COLUMN.test(header) ||
    (RANK_RANGE_COLUMN.test(header) && /比例$/u.test(header.trim()))) && !hasUnboundedRateLabel(header);
}

const IDENTIFIER_WORDS =
  /(?:日期|年份|學年度|學號|學籍號|課號|座號|編號|序號|識別碼|身分證|護照號|郵遞區號|電話|手機|帳號|代碼|代號|題號|題次)|\b(?:academic\s+(?:year|term|semester)|student\s+(?:id|number)|course\s+(?:id|code|number)|postal\s+code|zip\s+code|phone\s+number|account\s+(?:id|number)|page\s+(?:no\.?|number)|sequence\s+number|floor\s+number|(?:question|problem|exercise|item)\s+(?:id|number|no\.?))(?!\w)/iu;
const IDENTIFIER_LABEL_END = new RegExp(`(?:${IDENTIFIER_WORDS.source})$`, 'iu');

function withoutPercentUnit(header: string): string {
  return header.trim().replace(PERCENT_UNIT_END, '').trim();
}

function isNonRatioColumn(
  header: string,
  { percentage = false, allowPlainCatalogValues = false } = {},
): boolean {
  const column = withoutPercentUnit(header);
  const unqualifiedColumn = column.replace(/(?:\s*[（(][^）)]*[）)])+$/u, '').trim();
  const measuredLabel = percentage ? unqualifiedColumn : column;
  const statusMatch = NON_RATIO_STATUS_COLUMN.exec(measuredLabel) ?? ENGLISH_NON_RATIO_STATUS_COLUMN.exec(measuredLabel);
  const hasBoundedPercentValues = percentage && isBoundedPercentageColumn(header);
  const describesBoundedRate = hasBoundedPercentValues &&
    (isBoundedPercentageColumn(measuredLabel) || /率|\brate\b/iu.test(measuredLabel));
  const measuresRankShare = hasBoundedPercentValues && !RANK_LABEL_END.test(measuredLabel);
  const isIdentifier = percentage
    ? !describesBoundedRate && IDENTIFIER_LABEL_END.test(measuredLabel)
    : IDENTIFIER_WORDS.test(column);
  if (((NON_RATIO_NETWORK_IDENTIFIER_COLUMN.test(column) ||
         ENGLISH_NON_RATIO_NETWORK_IDENTIFIER_COLUMN.test(column)) &&
        !NETWORK_IDENTIFIER_COUNT_COLUMN.test(column)) ||
      NON_RATIO_NETWORK_NAMESPACE_COLUMN.test(column) ||
      NON_RATIO_DATABASE_KEY_COLUMN.test(column) ||
      NON_RATIO_POSTAL_IDENTIFIER_COLUMN.test(column) ||
      ENGLISH_NON_RATIO_POSTAL_IDENTIFIER_COLUMN.test(column) ||
      NON_RATIO_DOCUMENT_IDENTIFIER_COLUMN.test(column) ||
      NON_RATIO_AUTH_TOKEN_COLUMN.test(column) ||
      (!allowPlainCatalogValues && NON_RATIO_CATALOG_IDENTIFIER_COLUMN.test(column)) ||
      AMBIGUOUS_TIME_COLUMN.test(column) ||
      NON_RATIO_WEEKDAY_COLUMN.test(column) ||
      NON_RATIO_QUARTER_POSITION_COLUMN.test(column) ||
      NON_RATIO_SOURCE_POSITION_COLUMN.test(column) ||
      (NON_RATIO_PERCENTILE_COLUMN.test(column) &&
       (percentage || !PERCENTILE_COUNT_COLUMN.test(column))) ||
      NON_RATIO_SCIENCE_COLUMN.test(column) || ENGLISH_NON_RATIO_SCIENCE_COLUMN.test(column) ||
      DECIBEL_UNIT_COLUMN.test(column) ||
      COORDINATE_COLUMN.test(column) ||
      // Percentage rows verify literal percent values separately. A date or
      // time in the header may describe how those values are grouped.
      (!percentage && (NON_RATIO_CLOCK_POSITION_COLUMN.test(column) ||
        ENGLISH_NON_RATIO_CLOCK_POSITION_COLUMN.test(column))) ||
      (!describesBoundedRate &&
       statusMatch && (!percentage || statusMatch[0] === measuredLabel) &&
       !STATUS_COUNT_COLUMN.test(column) &&
       !ENGLISH_STATUS_COUNT_COLUMN.test(column)) ||
      (!hasBoundedPercentValues && (NON_RATIO_SCORE_SCALE_COLUMN.test(column) ||
        ENGLISH_NON_RATIO_SCORE_SCALE_COLUMN.test(column)) &&
       !SCORE_COUNT_COLUMN.test(column)) ||
      (!hasBoundedPercentValues &&
       (NON_RATIO_ORDINAL_LEVEL_COLUMN.test(column) ||
        ENGLISH_NON_RATIO_ORDINAL_LEVEL_COLUMN.test(column)) &&
       !ORDINAL_COUNT_COLUMN.test(column)) ||
      (!measuresRankShare && (NON_RATIO_RANK_POSITION_COLUMN.test(column) ||
         ENGLISH_NON_RATIO_RANK_POSITION_COLUMN.test(column)) &&
        !RANK_COUNT_COLUMN.test(column))) return true;
  if (/(?:^|[^0-9０-９])(?:[0０]\s*(?:[/／]|\bor\b)\s*[1１]|[1１]\s*(?:[/／]|\bor\b)\s*[0０])(?:$|[^0-9０-９])/iu.test(column)) return true;
  // "Lines of Code" is a count, not an identifying code. Keep
  // "Course Code", "Verification Code", and standalone "Code" excluded.
  // Recognize only explicit count phrases, never arbitrary headers ending in Code.
  if (!allowPlainCatalogValues && !describesBoundedRate &&
      /(?:^|\s)(?:id|uuid|code|no\.?|#)$/iu.test(measuredLabel) &&
      !/^(?:(?:number|count)\s+of\s+)?lines?\s+of\s+code$/iu.test(unqualifiedColumn)) return true;
  if (isIdentifier ||
      /^(?:年度|year|number)$/iu.test(column) ||
      /^(?:學年|學期|年級|班級|頁碼|頁次|週次|樓層|排名|名次|月份|民國年|西元年)(?:\s*[（(][^）)]*[）)])?$/u.test(column) ||
      /^(?:semester|term|month|rank|ranking|floor|grade|page)$/iu.test(column)) return true;
  // A textbook's week, chapter or lesson ordinal is a position, not a
  // measurement. "Chapter 4" must not appear twice as large as "Chapter 2".
  // Count headers (e.g. Number of Chapters / 章節數量) remain eligible.
  if (/^(?:章節|章次|章號|單元|單元號|單元編號|課次|講次|節次|第幾週)(?:\s*[（(][^）)]{1,40}[）)])?$/u.test(column) ||
      /^(?:week|chapter|unit|lesson|module|section|lecture|session)(?:\s+(?:number|no\.?|id|#))?(?:\s*\([^)]{1,40}\))?$/iu.test(column)) return true;
  // Numeric room and seat labels identify where a student belongs, not
  // quantities: classroom 301 is not 1.5 times classroom 205. A real
  // "教室數" / "Room Count" header remains a valid measured quantity.
  if (/^(?:教室|實驗室|房號|寢室|寢室號|宿舍房號|房間號碼|校舍|大樓|座位|座位號|位置|地點)(?:\s*[（(][^）)]{1,40}[）)])?$/u.test(column) ||
      /^(?:classroom|room|dorm(?:itory)?\s+room|lab(?:oratory)?|building|location|seat)(?:\s+(?:no\.?|number|id|code|#))?(?:\s*\([^)]{1,40}\))?$/iu.test(column)) return true;
  return /^build(?:\s+number)?$/iu.test(unqualifiedColumn) || (!describesBoundedRate && NON_RATIO_RELEASE_COLUMN.test(column) &&
    !RELEASE_COUNT_COLUMN.test(column) && !ENGLISH_RELEASE_COUNT_COLUMN.test(column));
}

/**
 * Optional, source-grounded comparison of non-negative source numbers only.
 * Strict comma-grouped thousands are accepted only when every row shares that
 * format. Units, percentages, dates, expressions and mixed formats are omitted.
 * No AI inference or source rewriting.
 */
function sourceValueRows(table: StudySourceTable): SourceValueRow[] | null {
  if (table.headers.length !== 2 || table.rows.length < 2 || table.rows.length > 10) return null;
  const column = measuredColumnLabel(table.headers[1]);
  const plainNumber = /^(?:0|[1-9]\d{0,5})(?:\.\d{1,2})?$/u;
  // Keep merge-base scaling for catalogue headers with legacy plain values.
  // The identifier-word guard still applies to headers such as 物料編號.
  const allowPlainCatalogValues = NON_RATIO_CATALOG_IDENTIFIER_COLUMN.test(column) &&
    table.rows.every(([, value]) => plainNumber.test(value));
  // An unlabeled number in a percentage column is ambiguous: do not scale it to the largest row.
  if (!hasUnambiguousChartLabel(table.headers[1]) || isPercentageColumn(column) ||
      isNonRatioColumn(column, { allowPlainCatalogValues })) return null;
  // Course finance tables often use commas for thousands. Require every
  // source row to use strict three-digit grouping before comparing any bar;
  // mixing 1,000 with 200, or malformed 1,20, remains unverified source text.
  const groupedNumber = /^[1-9]\d{0,2}(?:,\d{3})+(?:\.\d{1,2})?$/u;
  // Accept the explicit credit unit only in a credit column with a uniform format.
  const creditNumber = /^((?:0|[1-9]\d{0,5})(?:\.\d{1,2})?) ?學分$/u;
  const creditsColumn = /(?:學分|credits?)/iu.test(column);
  let rowFormat: 'plain' | 'grouped' | 'credits' | null = null;
  const exactAmounts = new Map<number, bigint>();
  const rows: SourceValueRow[] = [];
  // Invisible row labels cannot identify a derived bar to students or screen readers.
  // Keep the exact original table, but skip optional graphs without readable keys.
  for (const [rowIndex, [label, original]] of table.rows.entries()) {
    if (!hasUnambiguousChartLabel(label ?? '') || !original) return null;
    const creditMatch = creditsColumn ? creditNumber.exec(original) : null;
    const format = plainNumber.test(original) ? 'plain'
      : groupedNumber.test(original) ? 'grouped' : creditMatch ? 'credits' : null;
    if (!format || (rowFormat !== null && format !== rowFormat)) return null;
    rowFormat = format;
    // Parsing a long decimal directly as Number can silently round away a
    // source cent (e.g. 1,000,000,000,000,000.01). Only graph quantities
    // whose integer minor units are exactly representable; keep every other
    // source row verbatim in the original table without a derived bar.
    const [whole, fraction = ''] = (creditMatch?.[1] ?? original).replace(/,/gu, '').split('.');
    const minorUnits = BigInt(whole + fraction);
    if (minorUnits > BigInt(Number.MAX_SAFE_INTEGER)) return null;
    const amount = Number(minorUnits) / 10 ** fraction.length;
    // Distinct exact decimals can collapse to one Number after division.
    const exactCents = BigInt(whole + fraction.padEnd(2, '0'));
    const previous = exactAmounts.get(amount);
    if (previous !== undefined && previous !== exactCents) return null;
    exactAmounts.set(amount, exactCents);
    rows.push({ label, original, amount, sourceLine: table.startLine + 2 + rowIndex });
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
  const header = table.headers[1];
  const column = measuredColumnLabel(header);
  if (!hasUnambiguousChartLabel(header) || NON_RATIO_AUTH_TOKEN_COLUMN.test(withoutPercentUnit(header)) ||
      NON_RATIO_AUTH_TOKEN_COLUMN.test(withoutPercentUnit(column))) return null;
  // Preserve fixed-scale eligibility for the original header. Apply the
  // additional label checks only to formats recognized by the newer rules.
  const originallyBounded = (ORIGINAL_SOURCE_PERCENT_COLUMN.test(header) || ENGLISH_PERCENT_COLUMN.test(header)) &&
    !hasUnboundedRateLabel(header);
  if (!originallyBounded &&
      (!isBoundedPercentageColumn(column) || isNonRatioColumn(column, { percentage: true }))) return null;
  const rows: SourceValueRow[] = [];
  // Taiwanese lesson materials sometimes use fullwidth digits and decimal
  // punctuation throughout an explicitly bounded percentage column.
  // Convert only these known glyphs for the meter's quantity; the original
  // source, export, citation and accessible reading must remain untouched.
  // Course handouts may place one regular or no-break space before the %
  // sign (e.g. "75 %" or "７５ ％"). Preserve every original character in
  // source cells, screen-reader labels, clipboard text and TXT exports.
  // Do not accept tabs, multiple spaces, mixed digit scripts or missing %.
  const asciiPercent = /^(?:0|[1-9]\d?|100)(?:\.\d{1,2})?[ \u00a0\u202f]?[%％]$/u;
  const fullwidthPercent = /^(?:０|[１-９][０-９]?|１００)(?:．[０-９]{1,2})?[ \u00a0\u202f]?[%％]$/u;
  let digitFormat: 'ascii' | 'fullwidth' | null = null;
  for (const [rowIndex, [label, original]] of table.rows.entries()) {
    if (!hasUnambiguousChartLabel(label ?? '') || !original) return null;
    const format = asciiPercent.test(original) ? 'ascii'
      : fullwidthPercent.test(original) ? 'fullwidth' : null;
    // A mixed digit script could represent copied or transcribed source
    // errors: keep the complete table, but do not infer a derived graph.
    if (!format || (digitFormat !== null && format !== digitFormat)) return null;
    digitFormat = format;
    const printedNumber = original.slice(0, -1);
    const normalizedNumber = format === 'fullwidth'
      ? printedNumber.replace(/[０-９]/gu, (digit) =>
          String.fromCharCode(digit.charCodeAt(0) - 0xfee0)).replace('．', '.')
      : printedNumber;
    const amount = Number(normalizedNumber);
    if (!Number.isFinite(amount) || amount > 100) return null;
    rows.push({ label, original, amount, sourceLine: table.startLine + 2 + rowIndex });
  }
  return rows;
}

// Repeated row labels are valid in source textbooks (e.g. two "必修" rows).
// Distinguish their accessible meters by the exact source line, rather than
// silently hiding the chart or merging values from different rows.
function chartRowAccessibleLabel(row: SourceValueRow, rows: SourceValueRow[]): string {
  const label = row.label + '：' + row.original;
  return rows.some((other) => other !== row && other.label.trim() === row.label.trim())
    ? label + '；教材原文第 ' + row.sourceLine + ' 行'
    : label;
}

function StudySourcePercentComparison({ table, onJumpToSource }: {
  table: StudySourceTable;
  onJumpToSource: (rowIndex: number, origin: HTMLButtonElement) => void;
}) {
  const rows = sourcePercentRows(table);
  const sourceDescriptionPrefix = useId();
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
          <li key={row.sourceLine}>
            <div className={styles.sourceValueRow}>
              <span>{row.label}</span>
              <span>{row.original}</span>
            </div>
            <button type="button" className={styles.sourceLineJump}
              id={`${sourceDescriptionPrefix}-row-${row.sourceLine}`}
              onClick={(event) => onJumpToSource(row.sourceLine - table.startLine - 2, event.currentTarget)}>
              原文第 {row.sourceLine} 行 · 回表格核對
            </button>
            <meter min={0} max={100} value={row.amount}
              aria-describedby={`${sourceDescriptionPrefix}-row-${row.sourceLine}`}
              aria-label={chartRowAccessibleLabel(row, rows)}
              aria-valuetext={row.original + '；滿格 100%'} />
          </li>
        ))}
      </ul>
    </details>
  );
}

/** Keep the original table visible; numeric bars are an opt-in derived view. */
function StudySourceValueComparison({ table, onJumpToSource }: {
  table: StudySourceTable;
  onJumpToSource: (rowIndex: number, origin: HTMLButtonElement) => void;
}) {
  const rows = sourceValueRows(table);
  const sourceDescriptionPrefix = useId();
  if (!rows) return null;
  const maxRow = rows.reduce((best, row) => row.amount > best.amount ? row : best);
  const max = maxRow.amount;
  return (
    <details className={styles.sourceValueComparison}>
      <summary>展開第 2 欄「{table.headers[1]}」的原文數值比較</summary>
      <p className={styles.note}>
        只比較格式一致的非負純數字（包含每列皆以逗號正確分隔千位），或學分欄每列都寫出「學分」的非負數；以本欄最大值為滿格。
        不換算單位、不混用不同數字格式或附單位數值，也不比較日期或編號；請核對上方原文。
      </p>
      <ul className={styles.sourceValueList} aria-label={table.headers[1] + ' 原文數值比較'}>
        {rows.map((row) => (
          <li key={row.sourceLine}>
            <div className={styles.sourceValueRow}>
              <span>{row.label}</span>
              <span>{row.original}</span>
            </div>
            <button type="button" className={styles.sourceLineJump}
              id={`${sourceDescriptionPrefix}-row-${row.sourceLine}`}
              onClick={(event) => onJumpToSource(row.sourceLine - table.startLine - 2, event.currentTarget)}>
              原文第 {row.sourceLine} 行 · 回表格核對
            </button>
            <meter min={0} max={max} value={row.amount}
              aria-describedby={`${sourceDescriptionPrefix}-row-${row.sourceLine}`}
              aria-label={chartRowAccessibleLabel(row, rows)}
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
function tableSourceSelection(lines: OriginalSourceLine[], table: StudySourceTable, rowIndex: number | null = null, includeHeader = false): string {
  const start = table.startLine - 1;
  if (rowIndex !== null) {
    // The default remains the exact data row. Students can explicitly include
    // its literal header and Markdown separator for a meaningful study excerpt.
    // Take only authorized source lines, never reserialize cells or include
    // intervening answers from another row.
    if (!Number.isInteger(rowIndex) || rowIndex < 0 || rowIndex >= table.rows.length) return '';
    const chosen = lines[start + 2 + rowIndex];
    if (!includeHeader) return chosen?.text ?? '';
    const header = lines[start];
    const divider = lines[start + 1];
    if (!header || !divider || !chosen) return '';
    return header.text + header.separator + divider.text + divider.separator + chosen.text;
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
function selectOriginalTableText(field: HTMLTextAreaElement | null): boolean {
  if (!field) return false;
  try { field.focus(); } catch { /* The student can still long-press the source. */ }
  try { field.select(); } catch { /* Try the explicit selection range below. */ }
  try { field.setSelectionRange(0, field.value.length); }
  catch { /* The unchanged source remains available for native selection. */ }
  // Some in-app WebViews silently ignore both APIs. A successful method call
  // is not evidence that text was selected. Even reported selection bounds
  // cannot guarantee a native menu, so the message must remain cautious.
  try {
    return document.activeElement === field &&
      field.selectionStart === 0 && field.selectionEnd === field.value.length &&
      field.value.length > 0;
  } catch { return false; }
}

/** Keep per-table selection local and reset it when the authorized source changes. */
function StudySourceSelection({ table, index, sourceLines }: {
  table: StudySourceTable;
  index: number;
  sourceLines: OriginalSourceLine[];
}) {
  const [rowIndex, setRowIndex] = useState(-1);
  const [includeHeader, setIncludeHeader] = useState(false);
  const [includeSourceCitation, setIncludeSourceCitation] = useState(false);
  // Keep original excerpt bytes separate from optional, visibly marked metadata.
  // Neither the Markdown source nor its cell order is ever rewritten.
  const originalRowLine = table.startLine + rowIndex + 2;
  const originalExcerpt = tableSourceSelection(sourceLines, table, rowIndex < 0 ? null : rowIndex, includeHeader);
  const citation = rowIndex < 0
    ? `教材原文第 ${table.startLine} 至 ${table.startLine + table.rows.length + 1} 行`
    : !includeHeader
      ? `教材原文第 ${originalRowLine} 行`
      : rowIndex === 0
        ? `教材原文第 ${table.startLine} 至 ${originalRowLine} 行`
        : `教材原文第 ${table.startLine}、${table.startLine + 1}、${originalRowLine} 行（非連續）`;
  const citationNewline = sourceLines[table.startLine - 1]?.separator || '\n';
  // The selectable fallback, clipboard and TXT must use identical payloads.
  const selectedSource = includeSourceCitation
    ? `[${citation}]${citationNewline}${originalExcerpt}`
    : originalExcerpt;
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
    setIncludeHeader(false);
    setIncludeSourceCitation(false);
    setCopyFeedback('');
  }, [sourceLines, invalidateCopy]);
  useEffect(() => () => { invalidateCopy(); }, [invalidateCopy]);

  const manualCopy = (request: number) => {
    if (copyRequest.current === request) {
      invalidateCopy();
      setCopyFeedback('瀏覽器未確認複製；原文仍保留在下方，請長按選取或使用鍵盤複製。');
    }
  };
  const selectSelectedOriginal = (): boolean => {
    const field = originalText.current;
    if (!field) return false;
    // Readonly DOM values can still drift after an embedded WebView glitch.
    // Repair the long-press fallback before selection and clipboard access.
    if (field.value !== selectedSource.replace(/\r\n?/gu, '\n')) field.value = selectedSource;
    return selectOriginalTableText(field);
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
          // Native Clipboard.writeText() is Promise<void>: only undefined
          // is its standard fulfillment value. In-app WebView bridges may
          // resolve true or { success: true } without copying any bytes.
          // Keep the verbatim selectable source on every nonstandard value.
          if (acknowledged !== undefined) manualCopy(request);
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

  // Tell screen readers exactly which original lines an excerpt covers.
  // A single row with its header skips intervening lesson rows.
  const selectionAnnouncement = rowIndex < 0
    ? `目前選取整張表格：原文第 ${table.startLine} 至 ${table.startLine + table.rows.length + 1} 行，包含欄名、分隔列與全部資料列。`
    : includeHeader
      ? `目前選取第 ${rowIndex + 1} 列：原文第 ${table.startLine}、${table.startLine + 1} 行欄名與分隔列，以及第 ${originalRowLine} 行資料列；不包含其他資料列。`
      : `目前只選取第 ${rowIndex + 1} 列：原文第 ${originalRowLine} 行資料列，未包含欄名與分隔列。`;

  return (
    <details className={styles.sourceTableSelection}>
      <summary>選取第 {index + 1} 張表格的原文（可複製）</summary>
      <p className={styles.note}>
        可選整張表格或單一資料列的原始 Markdown 行，不重新編造欄位內容。
        單列預設不包含欄名；可勾選附上原始欄名及分隔列，或在摘錄開頭另加教材行號註記。
        行號註記不屬於教材原文，未勾選時逐字不變；若瀏覽器阻擋剪貼簿權限，仍可長按或鍵盤選取下方文字。
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
              setIncludeHeader(false);
            }
          }}>
          <option value={-1}>整張表格（含欄名）</option>
          {table.rows.map((row, number) =>
            <option key={number} value={number}>
              第 {number + 1} 列（原文第 {table.startLine + 2 + number} 行：{row[0]}）
            </option>)}
        </select>
      </label>
      {rowIndex >= 0 && (
        <label>
          <input type="checkbox" checked={includeHeader} onChange={(event) => {
            invalidateCopy();
            setCopyFeedback('');
            setIncludeHeader(event.target.checked);
          }} />
          連同原文欄名與分隔列
        </label>
      )}
      <label>
        <input type="checkbox" checked={includeSourceCitation} onChange={(event) => {
          invalidateCopy();
          setCopyFeedback('');
          setIncludeSourceCitation(event.target.checked);
        }} />
        摘錄開頭加上教材原文行號（註記非原文）
      </label>
      <p className={styles.note} aria-live="polite" aria-atomic="true">
        {selectionAnnouncement}
      </p>
      <button type="button" onClick={() => {
        const selected = selectSelectedOriginal();
        setCopyFeedback(selected
          ? '瀏覽器回報已全選下方原文；可用鍵盤複製，或長按原文使用系統複製選單。'
          : '瀏覽器未確認全選；下方原文仍保留，請長按重新選取或使用鍵盤複製。');
      }}>
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
        rows={rowIndex < 0 ? Math.min(8, table.rows.length + 2) : includeHeader ? 4 : 2}
        value={selectedSource}
      />
    </details>
  );
}

/** Optional accessible table layout derived solely from the exact source text. */
export function StudySourceTables({ text }: { text: string }) {
  const tables = useMemo(() => extractStudySourceTables(text), [text]);
  const sourceLines = useMemo(() => splitOriginalSourceLines(text), [text]);
  const sourceRowRefs = useRef(new Map<string, HTMLTableRowElement>());
  const [returnTarget, setReturnTarget] = useState<{
    sourceLines: OriginalSourceLine[];
    startLine: number;
    rowIndex: number;
    origin: HTMLButtonElement;
  } | null>(null);
  // A replaced lesson must never retain the previous chart's DOM button or text.
  useEffect(() => { setReturnTarget(null); }, [sourceLines]);
  // Focus the original row; some Safari/WebViews cannot focus table rows, so
  // fall back to its first cell without adding a normal Tab stop.
  const jumpToSource = (startLine: number, rowIndex: number, origin: HTMLButtonElement) => {
    const row = sourceRowRefs.current.get(`${startLine}:${rowIndex}`);
    if (!row) return;
    setReturnTarget({ sourceLines, startLine, rowIndex, origin });
    try { row.focus(); } catch { /* Try a focusable source cell below. */ }
    if (document.activeElement !== row && !row.contains(document.activeElement)) {
      try { row.querySelector<HTMLElement>('th, td')?.focus(); }
      catch { /* Try the keyboard-focusable original table region below. */ }
    }
    if (document.activeElement !== row && !row.contains(document.activeElement)) {
      // Some WebViews silently ignore focus() on both <tr> and its cells.
      // Keep students near the original row instead of leaving focus in the
      // comparison below the table. The source region already has tabindex=0.
      try { row.closest<HTMLElement>('[role="region"]')?.focus(); }
      catch { /* The source and return control must remain available. */ }
    }
    try { row.scrollIntoView?.({ block: 'nearest', inline: 'nearest' }); }
    catch { /* A failed scroll must not prevent keyboard focus. */ }
  };
  const returnToChart = () => {
    const origin = returnTarget?.origin;
    if (!origin?.isConnected) {
      setReturnTarget(null);
      return;
    }
    // The student may close the comparison disclosure while checking the
    // source row. Reopen it before returning focus: a hidden chart button
    // cannot reliably receive focus in Safari, WebView or keyboard navigation.
    const disclosure = origin.closest('details');
    if (disclosure && !disclosure.open) disclosure.open = true;
    try { origin.focus(); } catch { /* Fall back to the disclosure heading. */ }
    const summary = disclosure?.querySelector<HTMLElement>('summary');
    if (document.activeElement !== origin) {
      try { summary?.focus(); } catch { /* The return control must remain available. */ }
    }
    const destination = document.activeElement === origin ? origin : summary;
    // Keep the retry in view if the WebView refuses both focus attempts.
    if (!destination || document.activeElement !== destination) return;
    try { destination.scrollIntoView?.({ block: 'nearest', inline: 'nearest' }); }
    catch { /* A failed scroll must not prevent keyboard focus. */ }
    setReturnTarget(null);
  };
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
                <tr key={rowIndex} tabIndex={-1}
                  ref={(element) => {
                    const key = `${table.startLine}:${rowIndex}`;
                    if (element) sourceRowRefs.current.set(key, element);
                    else sourceRowRefs.current.delete(key);
                  }}>{row.map((cell, column) =>
                  column === 0 && cell.trim()
                    ? <th scope="row" key={column} tabIndex={-1}>{cell}</th>
                    : <td key={column} tabIndex={column === 0 ? -1 : undefined}>{cell}</td>)}</tr>)}
            </tbody>
          </table>
          {returnTarget?.sourceLines === sourceLines && returnTarget.startLine === table.startLine && (
            <button type="button" className={styles.sourceLineJump} onClick={returnToChart}>
              返回原文第 {table.startLine + 2 + returnTarget.rowIndex} 行的圖表
            </button>
          )}
          <StudySourceSelection table={table} index={index} sourceLines={sourceLines} />
          <StudySourceValueComparison table={table}
            onJumpToSource={(rowIndex, origin) => jumpToSource(table.startLine, rowIndex, origin)} />
          <StudySourcePercentComparison table={table}
            onJumpToSource={(rowIndex, origin) => jumpToSource(table.startLine, rowIndex, origin)} />
        </div>
      ))}
    </section>
  );
}
