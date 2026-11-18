'use strict';

const { getFirestore } = require('firebase-admin/firestore');

function todayYmd(timeZone) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timeZone || 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function addDaysYmd(ymd, deltaDays, timeZone) {
  const [y, m, d] = ymd.split('-').map(Number);
  const ms = Date.UTC(y, m - 1, d) + deltaDays * 86400000;
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timeZone || 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(ms));
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
  const m2 = t.match(/(\d{1,2})\s*[\/月]\s*(\d{1,2})/);
  if (m2) {
    const y = new Date().getFullYear();
    const mo = String(m2[1]).padStart(2, '0');
    const da = String(m2[2]).padStart(2, '0');
    return `${y}-${mo}-${da}`;
  }
  return null;
}

function resolveDateFromText(text, timeZone) {
  const t = String(text);
  const explicit = parseExplicitNumericDate(t);
  if (explicit) return explicit;
  if (/明天|翌日/.test(t)) return addDaysYmd(todayYmd(timeZone), 1, timeZone);
  if (/今天|今日/.test(t)) return todayYmd(timeZone);
  if (/後天/.test(t)) return addDaysYmd(todayYmd(timeZone), 2, timeZone);
  return null;
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

const CN_HOUR = {
  零: 0,
  一: 1,
  二: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
  十: 10,
  兩: 2,
};

function parseCnHourToken(tok) {
  const s = String(tok || '').trim();
  if (/^\d{1,2}$/.test(s)) return Number(s);
  if (CN_HOUR[s] != null) return CN_HOUR[s];
  const m = s.match(/^十([一二三四五六七八九])?$/);
  if (m) return 10 + (m[1] ? CN_HOUR[m[1]] : 0);
  const m2 = s.match(/^([一二三四五六七八九])十([一二三四五六七八九])?$/);
  if (m2) return CN_HOUR[m2[1]] * 10 + (m2[2] ? CN_HOUR[m2[2]] : 0);
  return NaN;
}

function parseTimeToHHmm(text) {
  const t = String(text);
  const m24 = t.match(/(\d{1,2})\s*[:：]\s*(\d{2})/);
  if (m24) return `${pad2(Number(m24[1]))}:${m24[2]}`;

  const mCn = t.match(
    /(?:早上|上午|凌晨)\s*(\d{1,2}|[零一二三四五六七八九十兩]+)\s*(?:點|時)(?:(\d{1,2}|[零一二三四五六七八九十]+)\s*分)?/,
  );
  if (mCn) {
    let h = parseCnHourToken(mCn[1]);
    if (!Number.isFinite(h)) h = Number(mCn[1]);
    const mmRaw = mCn[2];
    const mm = mmRaw != null ? pad2(parseCnHourToken(mmRaw) || Number(mmRaw) || 0) : '00';
    if (/凌晨/.test(t) && h === 12) h = 0;
    return `${pad2(h)}:${mm}`;
  }
  const mPm = t.match(
    /(?:下午|晚上|傍晚)\s*(\d{1,2}|[零一二三四五六七八九十兩]+)\s*(?:點|時)(?:(\d{1,2}|[零一二三四五六七八九十]+)\s*分)?/,
  );
  if (mPm) {
    let h = parseCnHourToken(mPm[1]);
    if (!Number.isFinite(h)) h = Number(mPm[1]);
    if (/下午/.test(t) && h < 12) h += 12;
    else if ((/晚上|傍晚/.test(t)) && h < 12) h += 12;
    const mmRaw = mPm[2];
    const mm = mmRaw != null ? pad2(parseCnHourToken(mmRaw) || Number(mmRaw) || 0) : '00';
    return `${pad2(h)}:${mm}`;
  }
  return null;
}

function seatClockMinutes(match, inheritedPeriod) {
  let hour = parseCnHourToken(match[2]);
  const minute = match[3] !== undefined ? Number(match[3])
    : match[4] === '半' ? 30 : match[4] ? parseCnHourToken(match[4]) : 0;
  if (!Number.isInteger(hour) || hour < 0 || hour > 23 ||
      !Number.isInteger(minute) || minute < 0 || minute > 59) return null;
  const period = match[1] || inheritedPeriod;
  if (period) {
    if ((hour === 0 && period !== '凌晨') || (hour === 12 && /晚上|傍晚/.test(period))) return null;
    if (/凌晨|早上|上午/.test(period)) {
      if (hour > 12) return null;
      if (period === '凌晨' && hour === 12) hour = 0;
    } else if (period === '中午') {
      if (hour === 1) hour = 13;
      else if (hour !== 11 && hour !== 12) return null;
    } else if (hour < 12) hour += 12;
  }
  return hour * 60 + minute;
}

/** Seat-only grammar: never change the parsing policy of other write tools. */
function seatTimeRange(raw, consume) {
  const clocks = [...raw.matchAll(/(?:(凌晨|早上|上午|中午|下午|傍晚|晚上)\s*)?([0-9零一二三四五六七八九十兩]{1,3})\s*(?::\s*(\d{2})|(?:點|時)(?:\s*(半|[0-9零一二三四五六七八九十兩]{1,3})\s*分?)?)/g)];
  if (clocks.length < 1 || clocks.length > 2) return null;
  for (const clock of clocks) {
    // Reject partial matches such as 14:000, 1.5點, 3點一刻 or 14:00:30.
    const before = raw[clock.index - 1] || '';
    const after = raw[clock.index + clock[0].length] || '';
    if (/[0-9零一二三四五六七八九十兩.]/.test(before) || /[0-9零一二三四五六七八九十兩:刻秒鐘半]/.test(after)) return null;
  }
  const start = seatClockMinutes(clocks[0]);
  if (start === null) return null;
  const durations = [...raw.matchAll(/(?<![0-9零一二三四五六七八九十兩.個])(?:(半)\s*小時|([0-9零一二三四五六七八九十兩]{1,4})\s*(?:個)?小時(?:\s*([0-9零一二三四五六七八九十兩]{1,3})\s*分(?:鐘)?)?|([0-9零一二三四五六七八九十兩]{1,4})\s*分鐘)(?![0-9.])/g)];
  if (durations.length > 1) return null;
  let duration = null;
  if (durations.length) {
    const value = durations[0];
    if (/[+\-−]/.test(raw[value.index - 1] || '') ||
        /^\s*(?:又|再)?\s*(?:半|[0-9零一二三四五六七八九十兩百千]|秒|刻)/.test(raw.slice(value.index + value[0].length))) return null;
    const count = token => /^\d+$/.test(token) ? Number(token) : parseCnHourToken(token);
    duration = value[1] ? 30 : value[2] ? count(value[2]) * 60 + (value[3] ? count(value[3]) : 0) : count(value[4]);
    if (!Number.isInteger(duration) || duration <= 0 || duration >= 1440) return null;
  }
  let end;
  if (clocks.length === 2) {
    const connector = raw.slice(clocks[0].index + clocks[0][0].length, clocks[1].index).trim();
    if (!/^(?:到|至|[-~–—])$/.test(connector)) return null;
    end = seatClockMinutes(clocks[1], clocks[0][1]);
    if (duration !== null && end - start !== duration) return null;
  } else {
    if (duration === null || /到|至|[~–—]/.test(raw)) return null;
    end = start + duration;
  }
  if (end === null || end <= start || end >= 1440) return null;
  for (const match of [...clocks, ...durations]) consume(match.index, match[0].length);
  if (clocks.length === 2) consume(clocks[0].index + clocks[0][0].length,
    clocks[1].index - clocks[0].index - clocks[0][0].length);
  const clock = minutes => `${pad2(Math.floor(minutes / 60))}:${pad2(minutes % 60)}`;
  return { startTime: clock(start), endTime: clock(end) };
}

function explicitSeatId(raw, consume) {
  const ids = new Set();
  const labels = [...raw.matchAll(/(?:座位(?:編號|代碼|ID)?|seat(?:Id|\s+id)?)\s*[:#]\s*([^\s,，。；;]+)/gi)];
  for (const match of labels) {
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(match[1])) return null;
    ids.add(match[1]);
    consume(match.index, match[0].length);
  }
  for (const match of raw.matchAll(/\b((?:lib|seat)[-_][A-Za-z0-9_-]+)\b/gi)) {
    if (/[A-Za-z0-9_./%\\-]/.test(raw[match.index - 1] || '') ||
        !/^(?:[\s,，。;；!?！？、）)]|$)/.test(raw.slice(match.index + match[0].length))) return null;
    ids.add(match[1]);
    consume(match.index, match[0].length);
  }
  // Preserve the existing explicit third-floor A-row convention, including A-15.
  // Merely naming a floor never selects a seat.
  for (const match of raw.matchAll(/(?:三|3)\s*(?:樓|F)\s*A\s*-?\s*(\d{1,3})(?!\d)/gi)) {
    if (/[A-Za-z0-9_.]/.test(raw[match.index - 1] || '') ||
        !/^(?:[\s,，。;；!?！？、）)]|$)/.test(raw.slice(match.index + match[0].length))) return null;
    ids.add(`lib-3F-A${match[1]}`);
    consume(match.index, match[0].length);
  }
  return ids.size === 1 ? [...ids][0] : null;
}

function explicitSeatDate(raw, seatId, timeZone, consume) {
  // A date embedded in an exact seat ID is never a requested reservation date.
  const source = raw.replaceAll(seatId, ' '.repeat(seatId.length));
  if (/\d{4}\s*年|隔天|隔日|次日/.test(source)) return null;
  const dates = [...source.matchAll(/\d{4}[./-]\d{1,2}[./-]\d{1,2}|\d{1,2}\s*[/月]\s*\d{1,2}(?:日|號)?|明天|翌日|今天|今日|後天/g)];
  if (dates.length !== 1) return null;
  const mention = dates[0], after = source.slice(mention.index + mention[0].length);
  if (/\d/.test(mention[0]) && (/[A-Za-z0-9_./-]/.test(source[mention.index - 1] || '') || /^[A-Za-z0-9_./-]/.test(after))) return null;
  if (/^\s*(?:到|至|和|與|及|、|[-~–—])\s*\d/.test(after)) return null;
  const monthDay = mention[0].match(/^(\d{1,2})\s*[/月]\s*(\d{1,2})(?:日|號)?$/);
  // Omitted years belong to the selected timezone, not the server's local year.
  const date = monthDay
    ? `${todayYmd(timeZone).slice(0, 4)}-${pad2(Number(monthDay[1]))}-${pad2(Number(monthDay[2]))}`
    : resolveDateFromText(mention[0], timeZone);
  if (!date) return null;
  const day = new Date(`${date}T00:00:00.000Z`);
  if (!Number.isFinite(day.getTime()) || day.toISOString().slice(0, 10) !== date) return null;
  consume(mention.index, mention[0].length);
  return date;
}

/**
 * @param {string} lastUserMessage
 * @param {string} timeZone
 * @returns {{ seatId: string, date: string, startTime: string, endTime: string } | null}
 */
function resolveReserveSeatInput(lastUserMessage, timeZone) {
  const raw = String(lastUserMessage ?? '').normalize('NFKC');
  let remainder = raw;
  const consume = (index, length) => {
    remainder = remainder.slice(0, index) + ' '.repeat(length) + remainder.slice(index + length);
  };
  const seatId = explicitSeatId(raw, consume);
  if (!seatId) return null;
  const date = explicitSeatDate(raw, seatId, timeZone, consume), range = seatTimeRange(raw, consume);
  if (!date || !range) return null;
  // Accept a small positive request grammar only. Unconsumed qualifiers, dates,
  // IDs, time zones, negations and conditions must never silently change intent.
  remainder = remainder.replace(/我想要|我想|我要|幫我|幫忙|請|預約|訂位|座位|圖書館|自習室|自習|從|開始|借用|使用|一下|謝謝|於|的/g, '')
    .replace(/[\s,，。:;；!?！？、（）()]/g, '');
  return remainder ? null : { seatId, date, ...range };
}

/**
 * @param {string} lastUserMessage
 * @param {string} schoolId
 * @returns {Promise<{ bookId: string } | null>}
 */
async function resolveBorrowBookInput(lastUserMessage, schoolId) {
  const raw = String(lastUserMessage ?? '');
  const mTitle = raw.match(/[《「『]([^》」』]{1,40})[》」』]/);
  const titleNeedle = mTitle ? mTitle[1].trim() : null;
  const mId = raw.match(/\b([a-zA-Z0-9_-]{6,})\b/);
  if (mId && /book|isbn|lib/i.test(raw)) return { bookId: mId[1] };

  const db = getFirestore();
  if (titleNeedle) {
    const col = db.collection('schools').doc(schoolId).collection('libraryBooks');
    const snap = await col.limit(25).get().catch(() => null);
    if (snap && !snap.empty) {
      const t = titleNeedle.toLowerCase();
      for (const doc of snap.docs) {
        const data = doc.data() || {};
        const title = String(data.title || '');
        if (title.includes(titleNeedle) || title.toLowerCase().includes(t)) {
          return { bookId: doc.id };
        }
      }
    }
  }
  return null;
}

/**
 * 與 {@link ../agent/classifyIntent.js} `dorm`／`health`→報修、`assistantFormat` 的 submit 觸發保持同步：
 * 避免 intent 已判成報修卻因這裡過嚴而拿不到草稿參數。
 * @param {string} rawText
 * @returns {boolean}
 */
function messageLooksLikeDormRepairActionMessage(rawText) {
  const raw = String(rawText ?? '').trim();
  if (!raw) return false;
  const m = raw.toLowerCase();

  if (/報修|維修|送\s*修|送.*報修|送.*單|送一個.*單|維修單/.test(m)) return true;

  const hasFacility =
    /宿舍|冷氣|空調|房間|房號|馬桶|水龍頭|燈|浴室|門|窗|插座|洗衣|排水|抽風|[abcde一二三四五六七八九十百]+棟/.test(m);
  const symptomCluster =
    /壞了|故障|不冷|不會轉|漏水|怪怪的|不大正常|不太對|好熱|太熱|熱爆|不涼|沒風|異音|忽冷忽熱|溫度|滴水|關不起來|打不開|不亮|跳電|滲水|堵塞|塞住|燈不亮|沒反應|不運轉|壓縮機/.test(m);
  if (symptomCluster && hasFacility) return true;

  if (/怪怪的|不大正常|不太對/.test(m) && /冷氣|空調|房|宿舍/.test(m)) return true;
  if (/(好熱|太熱|熱爆|像烤箱)/.test(m) && /(房|冷氣|空調|宿舍)/.test(m)) return true;

  return false;
}

/**
 * @param {string} lastUserMessage
 * @returns {{ dormitory: string, room: string, category: string, description: string, urgency?: string } | null}
 */
function resolveRepairInput(lastUserMessage) {
  const raw = String(lastUserMessage ?? '');
  if (!messageLooksLikeDormRepairActionMessage(raw)) return null;
  let category = 'other';
  if (/冷氣|空調/.test(raw)) category = 'hvac';
  if (/熱水|漏水|水龍頭|馬桶/.test(raw)) category = 'plumbing';
  if (/燈|電/.test(raw)) category = 'electrical';
  if (/(好熱|太熱|熱爆|不涼|沒風|怪怪的|忽冷忽熱)/.test(raw) && /冷氣|空調/.test(raw)) category = 'hvac';

  const roomM = raw.match(/(\d{3,4})\s*號?房?/);
  const room = roomM ? roomM[1] : '待確認房號';
  const dormM = raw.match(/([ABCDE一二三四五六七八九十]+棟|宿舍\s*[AB]\d?)/);
  const dormitory = dormM ? dormM[1] : '宿舍';

  const urgency = /很嚴重|緊急|立刻|馬上/.test(raw) ? 'high' : 'normal';

  return {
    dormitory,
    room,
    category,
    description: raw.slice(0, 400),
    urgency,
  };
}

/** Return exact document IDs, or null for an unsupported explicit selector. */
function washingMachineIdsFromText(raw) {
  // Dates such as 11月18號 describe the requested time, not a machine number.
  raw = raw.replace(/(?:[0-9]{4}年)?[0-9]{1,2}月[0-9]{1,2}[日號]?/g, ' ');
  // Ordinals and display numbers are not document IDs. Ask for the ID instead of guessing.
  if (/(?:第\s*[0-9０-９零一二三四五六七八九十兩]+\s*[台部個]|[0-9０-９零一二三四五六七八九十兩]+\s*號)/.test(raw)) return null;
  const ids = new Set();
  for (const match of raw.matchAll(/(?:洗衣機|機台(?:編號)?|機號|編號)\s*[:：#]?\s*[「『《"]([^」』》"]+)[」』》"]/g)) {
    if (!/^[A-Za-z0-9_.-]{1,128}$/.test(match[1])) return null;
    ids.add(match[1]);
  }
  for (const match of raw.matchAll(/(?:機台(?:編號)?|機號|編號)\s*[:：#]?\s*([^\s:：#])/g)) {
    if (!/[A-Za-z0-9Ａ-Ｚａ-ｚ０-９_「『《"]/.test(match[1])) return null;
  }
  for (const match of raw.matchAll(/[A-Za-zＡ-Ｚａ-ｚ0-9０-９_./-]+/g)) {
    const token = match[0];
    const before = raw.slice(0, match.index);
    const after = raw.slice(match.index + token.length);
    if (/^\s*[棟樓層]/.test(after)) continue;
    const labeled = /(?:洗衣機|機台(?:編號)?|機器|機號|編號)\s*[:：#]?\s*$/.test(before) ||
      /^\s*(?:號)?(?:洗衣機|機台)/.test(after);
    const inList = /(?:或|和|及|跟|與|、|,|，|\+)\s*$/.test(before) ||
      /^\s*(?:或|和|及|跟|與|、|,|，|\+)/.test(after);
    const isTimeOrDate = /^(?:[0-9]{4}[./-])?[0-9]{1,2}[./-][0-9]{1,2}$/.test(token) ||
      (/^[0-9]+$/.test(token) && (/^\s*(?:[:：][0-9]{2}|[點時分年月日])/.test(after) || /[0-9]{1,2}\s*[:：]\s*$/.test(before)));
    if ((/[A-Za-zＡ-Ｚａ-ｚ]/.test(token) && /[0-9０-９_-]/.test(token)) || ((labeled || inList) && !isTimeOrDate)) {
      // Keep case and the complete token: A2 is not A20, a2, or a path ending in A2.
      if (token.includes('/') || token.length > 128 || token === '.' || token === '..') return null;
      ids.add(token);
    }
  }
  if (/號\s*(?:洗衣機|機台)/.test(raw)) return null;
  if (ids.size === 0 && /指定|編號|機號|機台\s*[:：]|洗衣機\s*[「『《"]/.test(raw)) return null;
  return [...ids];
}

/**
 * @param {string} lastUserMessage
 * @param {string} schoolId
 * @returns {Promise<{ dormitory: string, machineId: string, startTime: string } | null>}
 */
async function resolveWashReserveInput(lastUserMessage, schoolId) {
  const raw = String(lastUserMessage ?? '');
  if (!/洗衣機|洗衣/.test(raw) || !/預約|幫我|訂/.test(raw)) return null;

  const machineIds = washingMachineIdsFromText(raw);
  if (!machineIds || machineIds.length > 1) return null;
  const db = getFirestore();
  const machines = db.collection('schools').doc(schoolId).collection('washingMachines');
  let machineId;
  let machineDormitory = null;
  if (machineIds.length === 1) {
    const machine = await machines.doc(machineIds[0]).get().catch(() => null);
    if (!machine || !machine.exists || machine.data()?.status !== 'available') return null;
    machineId = machine.id;
    const dormitory = machine.data()?.dormitory;
    if (typeof dormitory === 'string' && dormitory.trim()) machineDormitory = dormitory;
  } else {
    const snap = await machines.where('status', '==', 'available').limit(5).get().catch(() => null);
    if (snap && !snap.empty) {
      machineId = snap.docs[0].id;
    } else {
      const anySnap = await machines.limit(1).get().catch(() => null);
      if (!anySnap || anySnap.empty) return null;
      machineId = anySnap.docs[0].id;
    }
  }

  const timeZone = 'Asia/Taipei';
  const hhmm = parseTimeToHHmm(raw);
  let startIso = null;
  if (hhmm) {
    const ymd = resolveDateFromText(raw, timeZone) || todayYmd(timeZone);
    const [y, mo, da] = ymd.split('-').map(Number);
    const [h, mi] = hhmm.split(':').map(Number);
    const d = new Date(y, mo - 1, da, h, mi, 0, 0);
    startIso = d.toISOString();
  } else if (/今晚|今天晚上/.test(raw)) {
    const d = new Date();
    d.setHours(20, 0, 0, 0);
    startIso = d.toISOString();
  }
  if (!startIso) return null;

  const dormM = raw.match(/([A-Za-zＡ-Ｚａ-ｚ一二三四五六七八九十]+棟)/);
  if (machineDormitory && dormM && machineDormitory.trim().replace(/棟$/, '') !== dormM[1].replace(/棟$/, '')) return null;
  const dormitory = machineDormitory || (dormM ? dormM[1] : '宿舍');

  return { dormitory, machineId, startTime: startIso };
}

/**
 * @param {string} lastUserMessage
 * @param {string} schoolId
 * @returns {Promise<{ cafeteriaId: string, items: Array<{ menuItemId: string, name: string, price: number, quantity: number }>, note?: string } | null>}
 */
async function resolveFoodOrderInput(lastUserMessage, schoolId) {
  const raw = String(lastUserMessage ?? '');
  const db = getFirestore();
  const cafSnap = await db.collection('schools').doc(schoolId).collection('cafeterias').limit(5).get();
  if (cafSnap.empty) return null;

  let cafeteriaId = cafSnap.docs[0].id;
  let cafeteriaName = (cafSnap.docs[0].data() || {}).name || '';
  for (const d of cafSnap.docs) {
    const nm = String((d.data() || {}).name || '');
    if (/學生餐廳|學餐/.test(raw) && (/學生餐廳|學餐/.test(nm) || nm.includes('學生'))) {
      cafeteriaId = d.id;
      cafeteriaName = nm;
      break;
    }
  }

  const menus = await db.collection('schools').doc(schoolId).collection('menus').limit(40).get();
  const items = [];
  const chunks = raw.split(/[,，、跟和與\+]|還有|再來|一杯|一份/g).map((s) => s.trim()).filter(Boolean);
  const keywords = chunks
    .map((c) => c.replace(/幫我|請|在學生餐廳|學生餐廳|點|來|一份|一杯|我要|訂餐|下單/g, '').trim())
    .filter((c) => c.length >= 2 && c.length <= 20);

  for (const kw of keywords) {
    if (/餐廳|訂餐|點餐|^餐$|^飯$/.test(kw)) continue;
    let hit = null;
    if (!menus.empty) {
      for (const doc of menus.docs) {
        const data = doc.data() || {};
        const name = String(data.name || data.title || '');
        if (name && (name.includes(kw) || kw.includes(name))) {
          hit = { id: doc.id, name, price: Number(data.price ?? data.unitPrice ?? 0) };
          break;
        }
      }
    }
    if (hit) {
      items.push({
        menuItemId: hit.id,
        name: hit.name,
        price: Number.isFinite(hit.price) ? hit.price : 0,
        quantity: 1,
      });
    } else {
      items.push({
        menuItemId: `custom-${kw.slice(0, 12)}`,
        name: kw,
        price: 0,
        quantity: 1,
      });
    }
  }

  if (items.length === 0) return null;
  return { cafeteriaId, items, note: cafeteriaName ? `取餐：${cafeteriaName}` : undefined };
}

module.exports = {
  resolveReserveSeatInput,
  resolveBorrowBookInput,
  resolveRepairInput,
  resolveWashReserveInput,
  resolveFoodOrderInput,
  messageLooksLikeDormRepairActionMessage,
};
