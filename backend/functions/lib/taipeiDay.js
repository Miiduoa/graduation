'use strict';

/**
 * 以台灣日期當分區鍵（號碼牌、每日簡報、週報、匿名回報雜湊…）。
 * 伺服器跑在 UTC，直接用 toISOString().slice(0, 10) 會在台灣早上 8 點才換日。
 */

const TAIPEI_TIME_ZONE = 'Asia/Taipei';
const taipeiDateParts = new Intl.DateTimeFormat('en-CA', {
  timeZone: TAIPEI_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** 台灣日期 YYYY-MM-DD。 */
function taipeiDateKey(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) throw new RangeError('Invalid date');
  const parts = {};
  for (const part of taipeiDateParts.formatToParts(d)) parts[part.type] = part.value;
  return `${parts.year}-${parts.month}-${parts.day}`;
}

/** 台灣某一天 00:00 的時間點。台灣沒有日光節約，固定 +08:00。 */
function taipeiDayStart(dateKey) {
  return new Date(`${dateKey}T00:00:00+08:00`);
}

/** 日期鍵往前或往後幾天。 */
function shiftDateKey(dateKey, days) {
  const d = new Date(`${dateKey}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

module.exports = { TAIPEI_TIME_ZONE, taipeiDateKey, taipeiDayStart, shiftDateKey };
