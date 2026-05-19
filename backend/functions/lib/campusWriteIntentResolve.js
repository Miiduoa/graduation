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

function addHoursToHHmm(hhmm, hoursToAdd) {
  const [h, m] = hhmm.split(':').map(Number);
  const total = h * 60 + m + hoursToAdd * 60;
  const nh = Math.floor(total / 60) % 24;
  const nm = total % 60;
  return `${pad2(nh)}:${pad2(nm)}`;
}

/**
 * @param {string} lastUserMessage
 * @param {string} timeZone
 * @returns {{ seatId: string, date: string, startTime: string, endTime: string } | null}
 */
function resolveReserveSeatInput(lastUserMessage, timeZone) {
  const raw = String(lastUserMessage ?? '');
  const date = resolveDateFromText(raw, timeZone);
  const startTime = parseTimeToHHmm(raw);
  if (!date || !startTime) return null;

  let seatId = null;
  const libSeat = raw.match(/(?:圖書館|自習)?\s*(?:三|3)\s*[樓Ff]\s*[AaＡ-]\s*(\d{1,3})/i);
  if (libSeat) seatId = `lib-3F-A${libSeat[1]}`;
  const explicit = raw.match(/([A-Za-z]+[-]?[0-9A-Za-z]+[-]?[0-9A-Za-z]+)/);
  if (!seatId && explicit && /lib|seat|F|樓/i.test(raw)) seatId = explicit[1].replace(/\s+/g, '');

  if (!seatId && (/隨便|任一|任意|都可以/.test(raw) || /圖書館三樓/.test(raw))) {
    seatId = 'lib-3F-A01';
  }
  if (!seatId) return null;

  const endTime = addHoursToHHmm(startTime, 2);
  return { seatId, date, startTime, endTime };
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

/**
 * @param {string} lastUserMessage
 * @param {string} schoolId
 * @returns {Promise<{ dormitory: string, machineId: string, startTime: string } | null>}
 */
async function resolveWashReserveInput(lastUserMessage, schoolId) {
  const raw = String(lastUserMessage ?? '');
  if (!/洗衣機|洗衣/.test(raw) || !/預約|幫我|訂/.test(raw)) return null;

  const db = getFirestore();
  const snap = await db
    .collection('schools')
    .doc(schoolId)
    .collection('washingMachines')
    .where('status', '==', 'available')
    .limit(5)
    .get()
    .catch(() => null);

  let machineId = null;
  if (snap && !snap.empty) {
    machineId = snap.docs[0].id;
  } else {
    const anySnap = await db.collection('schools').doc(schoolId).collection('washingMachines').limit(1).get();
    if (anySnap.empty) return null;
    machineId = anySnap.docs[0].id;
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

  const dormM = raw.match(/([ABCDE一二三四五六七八九十]+棟)/);
  const dormitory = dormM ? dormM[1] : '宿舍';

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
