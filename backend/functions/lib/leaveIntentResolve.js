'use strict';

const { fetchAssistantScheduleSlotsForDay } = require('./assistantFetchers');

const WEEKDAY_CHAR_TO_JS = {
  日: 0,
  天: 0,
  一: 1,
  二: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
};

function todayYmd(timeZone) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

/** 台北該曆日午夜對應的 UTC ms（無 DST） */
function taipeiMidnightUtcMs(y, m, d) {
  return Date.UTC(y, m - 1, d - 1, 16, 0, 0);
}

function addDaysYmd(ymd, deltaDays, timeZone) {
  const [y, m, d] = ymd.split('-').map(Number);
  const ms = taipeiMidnightUtcMs(y, m, d) + deltaDays * 86400000;
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(ms));
}

function ymdWeekdayInZone(ymd, timeZone) {
  const [y, m, d] = ymd.split('-').map(Number);
  const ms = taipeiMidnightUtcMs(y, m, d);
  const wd = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short' }).format(new Date(ms));
  const map = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return map[wd] ?? 0;
}

function parseExplicitNumericDate(text) {
  const t = String(text);
  const m1 = t.match(/(\d{4})[./-](\d{1,2})[./-](\d{1,2})/);
  if (m1) {
    const y = Number(m1[1]);
    const mo = String(m1[2]).padStart(2, '0');
    const da = String(m1[3]).padStart(2, '0');
    return `${y}-${mo}-${da}`;
  }
  const m2 = t.match(/(\d{1,2})\s*月\s*(\d{1,2})\s*日/);
  if (m2) {
    const y = new Date().getFullYear();
    const mo = String(m2[1]).padStart(2, '0');
    const da = String(m2[2]).padStart(2, '0');
    return `${y}-${mo}-${da}`;
  }
  return null;
}

function extractWeekdayFromText(text) {
  const t = String(text);
  const m = t.match(/(?:禮拜|週|周)([日一二三四五六天])/);
  if (m) return WEEKDAY_CHAR_TO_JS[m[1]] ?? null;
  const m2 = t.match(/星期([日一二三四五六天])/);
  if (m2) return WEEKDAY_CHAR_TO_JS[m2[1]] ?? null;
  return null;
}

function isNextWeekish(text) {
  return /下(?:個)?(?:禮拜|週|周)|下禮拜/.test(String(text));
}

function nextWeekdayFromAnchor(anchorYmd, targetDow, timeZone) {
  let ymd = anchorYmd;
  for (let i = 0; i < 7; i += 1) {
    if (ymdWeekdayInZone(ymd, timeZone) === targetDow) return ymd;
    ymd = addDaysYmd(ymd, 1, timeZone);
  }
  return null;
}

function parseLeaveDateYmd(message, timeZone) {
  const t = String(message);
  const explicit = parseExplicitNumericDate(t);
  if (explicit) return explicit;

  const anchor = todayYmd(timeZone);

  if (/明天/.test(t)) return addDaysYmd(anchor, 1, timeZone);
  if (/後天/.test(t)) return addDaysYmd(anchor, 2, timeZone);
  if (/大後天/.test(t)) return addDaysYmd(anchor, 3, timeZone);
  if (/今天|今日/.test(t)) return anchor;

  const targetDow = extractWeekdayFromText(t);
  if (targetDow == null) return null;

  /**
   * 「下禮拜／下週 + 星期幾」：以今天為錨點（台北曆日）先加 7 天，再從該日起往後最多 7 天內找第一個符合的星期。
   * 與口語「下個完整曆法週的週三」或「下一個出現的週三」可能不同；行為以本檔單元測試為準。
   */
  if (isNextWeekish(t)) {
    const start = addDaysYmd(anchor, 7, timeZone);
    return nextWeekdayFromAnchor(start, targetDow, timeZone);
  }
  return nextWeekdayFromAnchor(anchor, targetDow, timeZone);
}

function inferLeaveType(message) {
  const t = String(message);
  if (/病假|不舒服|感冒|掛號|就醫|sick/i.test(t)) return '病假';
  if (/公假|官方|代表學校/.test(t)) return '公假';
  return '事假';
}

function normalizeCourseToken(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/\s/g, '')
    .replace(/（[^）]*）/g, '')
    .slice(0, 40);
}

function pickCourseIdFromSlots(message, slots, contextCourseId) {
  const list = Array.isArray(slots) ? slots : [];
  if (contextCourseId && list.some((s) => s.courseId === contextCourseId)) {
    return contextCourseId;
  }
  const t = normalizeCourseToken(message);
  for (const s of list) {
    const n = normalizeCourseToken(s.name);
    if (
      n &&
      (t.includes(n) || (n.length >= 2 && t.includes(n.slice(0, Math.min(6, n.length)))))
    ) {
      return s.courseId;
    }
  }
  if (list.length === 1) return list[0].courseId;
  return list[0]?.courseId || (contextCourseId ? String(contextCourseId) : '');
}

/**
 * @returns {Promise<{ courseId: string, date: string, type: string, incomplete: boolean }>}
 */
async function resolveLeaveSubmitPayload({
  uid,
  lastUserMessage,
  timeZone,
  prefetchedTodaySchedule,
  contextCourseId,
}) {
  const msg = String(lastUserMessage || '').trim();
  const type = inferLeaveType(msg);
  if (!uid) {
    return { courseId: '', date: '', type, incomplete: true };
  }

  let date = parseLeaveDateYmd(msg, timeZone);
  if (!date) {
    date = addDaysYmd(todayYmd(timeZone), 1, timeZone);
  }

  const targetDow = ymdWeekdayInZone(date, timeZone);
  const remote = await fetchAssistantScheduleSlotsForDay(uid, targetDow, { timeZone });
  let slots = remote.slots || [];
  if (
    slots.length === 0 &&
    prefetchedTodaySchedule &&
    typeof prefetchedTodaySchedule === 'object' &&
    prefetchedTodaySchedule.dayOfWeek === targetDow &&
    Array.isArray(prefetchedTodaySchedule.slots)
  ) {
    slots = prefetchedTodaySchedule.slots;
  }

  const courseId = pickCourseIdFromSlots(msg, slots, contextCourseId);

  return {
    courseId,
    date,
    type,
    incomplete: !courseId || !date,
  };
}

module.exports = {
  resolveLeaveSubmitPayload,
  parseLeaveDateYmd,
  inferLeaveType,
  pickCourseIdFromSlots,
};
