'use strict';

/**
 * Verified, read-only cards for voice tasks. No generated text or model-supplied
 * tool arguments are trusted here. Every reader uses the authenticated uid and
 * the one actively verified school membership.
 */
const SAFE_DATA_ROUTES = new Set([
  '/timetable', '/classroom', '/announcements', '/events', '/map',
  '/cafeteria', '/library', '/dormitory', '/food', '/messages', '/dms', '/lost-found', '/groups',
]);
const CONNECTABLE_LABELS = Object.freeze({
  '/timetable': '個人課表',
  '/classroom': '課程作業',
  '/announcements': '公告',
  '/events': '活動',
  '/map': '校園地點',
  '/cafeteria': '餐廳',
  '/library': '平台借閱紀錄',
  '/dormitory': '平台報修紀錄',
  '/food': '平台訂單',
  '/messages': '帳號通知',
  '/dms': '私人對話',
  '/lost-found': '失物招領',
  '/groups': '已加入群組',
});
const ROUTE_HINTS = Object.freeze({
  '/bus': '公車到站需要先選路線與站牌，請到公車頁查詢實際到站資訊。',
  '/grades': '正式成績需要學校授權的個人資料連線，請至成績頁確認來源及登入狀態。',
  '/school-courses': '請到 WOW Class 課程頁使用學校帳號讀取課堂；此入口不會代為交作業，也不代表已取得正式學分。',
  '/credit-planner': '學分規劃需要本人修課紀錄，請在學分規劃頁匯入或查核資料。',
  '/calendar': '個人行事曆由裝置端管理，伺服器不會讀取未同步的行程。',
  '/messages': '私人訊息需在登入帳號後，從訊息頁讀取。',
  '/lost-found': '請開啟失物招領頁，依目前選擇的學校查詢刊登。',
  '/friends': '好友與私人課表分享只會在經授權的帳號中顯示。',
});
const MAX_ITEMS = 4;
function text(value, max = 90) {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '';
}
function safeDate(value) {
  try {
    if (value && typeof value.toDate === 'function') {
      const d = value.toDate();
      return d instanceof Date && Number.isFinite(d.getTime()) ? d.toISOString() : null;
    }
    if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString();
    if (typeof value === 'string') {
      const ms = Date.parse(value);
      return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
    }
  } catch { /* data can be malformed */ }
  return null;
}
function item(title, detail = '') {
  const name = text(title, 120);
  return name ? { title: name, detail: text(detail, 180) } : null;
}
function summary(destination, status, message, items = []) {
  return {
    destination,
    status,
    source: status === 'available' || status === 'empty' ? 'campus-platform' : 'none',
    message: text(message, 240),
    items: items.filter(Boolean).slice(0, MAX_ITEMS),
  };
}
function openOnly(destination, override = null) {
  return summary(destination, 'open-service',
    override || ROUTE_HINTS[destination] || '請在對應服務頁查看；目前沒有可安全讀取的專用資料接口。');
}

function createReaders() {
  const { runTool } = require('./tools/registry');
  const { fetchAssistantEvents } = require('../lib/assistantFetchers');
  const { createAuthzHelpers } = require('../authz');
  const { getFirestore } = require('firebase-admin/firestore');
  return {
    verify: (uid, schoolId) => createAuthzHelpers(getFirestore()).assertActiveSchoolMember(schoolId, uid),
    tool: runTool,
    events: fetchAssistantEvents,
    records: async (kind, ctx) => {
      const db = getFirestore();
      const school = db.collection('schools').doc(ctx.schoolId);
      const user = db.collection('users').doc(ctx.uid);
      let ref;
      if (kind === 'orders') {
        ref = user.collection('schools').doc(ctx.schoolId).collection('orders')
          .orderBy('createdAt', 'desc').limit(15);
      } else if (kind === 'notifications') {
        ref = user.collection('notifications').orderBy('createdAt', 'desc').limit(20);
      } else if (kind === 'conversations') {
        ref = db.collection('conversations').where('memberIds', 'array-contains', ctx.uid).limit(30);
      } else if (kind === 'lostFound') {
        ref = school.collection('lostFound').limit(25);
      } else if (kind === 'groups') {
        ref = user.collection('groups').where('schoolId', '==', ctx.schoolId).limit(25);
      } else {
        throw new Error('Unsupported read-only service');
      }
      const snapshot = await ref.get();
      return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    },
  };
}

async function connectOne(destination, input, readers) {
  const ctx = {
    uid: input.uid, schoolId: input.schoolId,
    timeZone: 'Asia/Taipei', prefetched: {},
  };
  const spoken = input.utterance || '';
  switch (destination) {
    case '/timetable': {
      // This reader explicitly signals unavailable until the separate academic
      // records identity bridge is authorized. An empty timetable is NEVER implied.
      if (/明天|後天|下週|下禮拜|下星期|週末|周末/.test(spoken)) {
        return openOnly(destination, '目前助理沒有該日期的正式課表來源，請開啟課表確認，不能判定有沒有空堂。');
      }
      const data = await readers.tool('getTodaySchedule', ctx, {});
      if (data?.status === 'unavailable' || !Array.isArray(data?.slots)) {
        return summary(destination, 'unavailable',
          text(data?.message, 220) || '正式課表來源尚未接通，無法確認今天有沒有課。');
      }
      const rows = data.slots.slice(0, MAX_ITEMS).map(x =>
        item(x.title || x.name || x.courseName, x.time || x.startTime || x.location || ''));
      return summary(destination, rows.length ? 'available' : 'empty',
        rows.length ? '已讀取目前可用的課表資料。' : '該課表來源未回傳任何課程；請再次確認是否已完成匯入。', rows);
    }
    case '/classroom': {
      const data = await readers.tool('getAssignments', ctx, {});
      if (!Array.isArray(data)) return summary(destination, 'unavailable', '無法確認目前待處理的作業，請到課程頁重試。');
      const rows = data.slice(0, MAX_ITEMS).map(x => item(x.title, [
        text(x.groupName, 60), safeDate(x.dueAt) ? '截止 ' + safeDate(x.dueAt) : '截止時間未提供',
      ].filter(Boolean).join(' · ')));
      return summary(destination, rows.some(Boolean) ? 'available' : 'empty',
        data.length ? '已核對目前平台中尚未繳交的作業，尚未代為提交。'
          : '目前這個帳號沒有從已加入課程讀到待交作業；未連線的校外 LMS 不包含在內。',
        rows);
    }
    case '/announcements': {
      const data = await readers.tool('getAnnouncements', ctx, { schoolId: input.schoolId });
      if (!Array.isArray(data)) return summary(destination, 'unavailable', '公告來源無法讀取，請查看校方原站。');
      const rows = data.slice(0, MAX_ITEMS).map(x => item(x.title, x.office || x.sourceLabel || ''));
      return summary(destination, rows.some(Boolean) ? 'available' : 'empty',
        data.length ? '已讀取目前平台收錄的校園公告，時效以來源頁面為準。'
          : '此校公告資料尚未有可用的公告，不能當作學校沒有公告。',
        rows);
    }
    case '/events': {
      const all = await readers.events(input.schoolId);
      if (!Array.isArray(all)) return summary(destination, 'unavailable', '無法讀取目前學校的活動列表。');
      const eligible = all.filter(x => x && x.published !== false && !['draft', 'cancelled'].includes(String(x.status || '').toLowerCase()));
      const rows = eligible.slice(0, MAX_ITEMS).map(x => item(x.title, safeDate(x.startsAt) || text(x.location || x.venue)));
      return summary(destination, rows.some(Boolean) ? 'available' : 'empty',
        eligible.length ? '顯示目前校園平台可用的活動紀錄，請開啟活動頁核對報名狀態。'
          : '目前平台沒有取得可公開顯示的活動紀錄。',
        rows);
    }
    case '/map': {
      // Do not call the POI tool with the entire user's multi-task utterance.
      // A place must be explicitly named for accurate matching.
      const place = (spoken.match(/圖書館|體育館|行政大樓|主顧樓|任垣樓|校門|宿舍|餐廳|停車場|教室/) || [])[0];
      if (!place) return openOnly(destination, '請先選擇目的地；校園地圖會使用所選學校已登錄的地點資料。');
      const result = await readers.tool('findCampusPoi', ctx, { query: place, limit: MAX_ITEMS });
      if (!result?.success || !Array.isArray(result.pois)) {
        return summary(destination, 'unavailable', '目前無法讀取該校地點資料，請到地圖查看。');
      }
      const rows = result.pois.slice(0, MAX_ITEMS).map(x =>
        item(x.name, [x.floor, x.code].map(v=>text(v, 50)).filter(Boolean).join(' · ')));
      return summary(destination, rows.some(Boolean) ? 'available' : 'empty',
        rows.length ? '已從目前選擇學校的地點資料找到相關項目，路線請在地圖確認。'
          : '目前校園資料庫沒有這個地點的相符紀錄。',
        rows);
    }
    case '/cafeteria': {
      const data = await readers.tool('listCafeterias', ctx, {});
      if (!data?.success || !Array.isArray(data.cafeterias)) {
        return summary(destination, 'unavailable', '目前無法讀取餐廳資料；實際營業狀態仍以店家公告為準。');
      }
      const rows = data.cafeterias.slice(0, MAX_ITEMS).map(x => item(x.name, x.location || x.openingHours || ''));
      return summary(destination, rows.some(Boolean) ? 'available' : 'empty',
        rows.length ? '已讀取平台收錄的餐廳資料，不代表店家目前營業或可以下單。'
          : '目前平台尚未收錄此校餐廳資料。',
        rows);
    }
    case '/library': {
      if (!/借閱紀錄|我借|借了|未還|逾期|續借|還書/.test(spoken)) {
        return openOnly(destination, '找書及預約請開啟圖書館頁。平台借閱紀錄不等於學校官方館藏狀態。');
      }
      const data = await readers.tool('getLibraryLoans', ctx, {});
      if (!data?.ok || !Array.isArray(data.loans)) {
        return summary(destination, 'unavailable', '平台借閱紀錄目前無法讀取，不代表校方已歸還或沒有借書。');
      }
      const rows = data.loans.slice(0, MAX_ITEMS).map(x=>item(x.bookTitle, safeDate(x.dueAt) ? '到期 ' + safeDate(x.dueAt) : text(x.status)));
      return summary(destination, rows.some(Boolean) ? 'available' : 'empty',
        rows.length ? '已讀取 Campus One 保存的借閱資料；仍需到官方圖書館帳戶查核。'
          : '平台沒有讀到借閱紀錄；不能據此判定官方圖書館沒有借閱。',
        rows);
    }
    case '/dormitory': {
      if (!/進度|處理了嗎|上次|之前|報修單|報修紀錄|維修紀錄/.test(spoken)) {
        return openOnly(destination, '可在宿舍頁用一句話產生設備問題草稿，正式報修仍須走學校指定管道。');
      }
      const data = await readers.tool('listMyDormRepairs', ctx, { limit: 10 });
      if (!Array.isArray(data?.items)) {
        return summary(destination, 'unavailable', '無法讀取平台報修紀錄，請向住宿服務單位確認。');
      }
      const rows = data.items.slice(0, MAX_ITEMS).map(x=>item(x.description || x.category || '設備問題', x.status || '狀態未提供'));
      return summary(destination, rows.some(Boolean) ? 'available' : 'empty',
        rows.length ? '已讀取平台報修紀錄，不能代表校方已正式受理。'
          : '平台尚未讀到報修紀錄，不代表校方不存在紀錄。',
        rows);
    }
    case '/food': {
      if (!/訂單|取餐|取餐號|排隊|等候|出餐|取消訂單/.test(spoken)) {
        return openOnly(destination,
          '查看菜單請先開啟餐廳；實際點餐要在店家服務頁確認，不能從語音直接付款或下單。');
      }
      const all = await readers.records('orders', ctx);
      if (!Array.isArray(all)) return summary(destination, 'unavailable', '目前無法查詢帳號的訂單副本。');
      const rows = all.filter(x => !x.schoolId || x.schoolId === input.schoolId).slice(0, MAX_ITEMS)
        .map(x => item(x.cafeteria || x.merchantName || '校園餐廳',
          [x.status, Number.isSafeInteger(x.queueNumber) && x.queueNumber > 0 ? '取餐號 ' + x.queueNumber : '']
            .filter(Boolean).join(' · ')));
      return summary(destination, rows.some(Boolean) ? 'available' : 'empty',
        rows.length ? '已讀取本人 Campus One 訂單副本，實際取餐與取消仍以商家最新狀態為準。'
          : '平台尚未讀到本人的訂單，不能推定其他店家網站沒有訂單。',
        rows);
    }
    case '/messages': {
      const data = await readers.records('notifications', ctx);
      if (!Array.isArray(data)) return summary(destination, 'unavailable', '目前無法讀取帳號通知。');
      const eligible = data.filter(x => {
        const rowSchool = x.schoolId || (x.data && x.data.schoolId);
        return x.userId === undefined || x.userId === input.uid
          ? rowSchool === input.schoolId
          : false;
      });
      const rows = eligible.slice(0, MAX_ITEMS).map(x => item(x.title, x.body || ''));
      return summary(destination, rows.some(Boolean) ? 'available' : 'empty',
        rows.length ? '已讀取目前學校的本人通知，不包括其他學校或未同步平台。'
          : '此校尚未讀到本人通知，不代表校方各系統沒有新訊息。',
        rows);
    }
    case '/dms': {
      const data = await readers.records('conversations', ctx);
      if (!Array.isArray(data)) return summary(destination, 'unavailable', '目前無法讀取本人對話。');
      const eligible = data.filter(x =>
        x.schoolId === input.schoolId && x.type === 'dm' && Array.isArray(x.memberIds) &&
        x.memberIds.length === 2 && x.memberIds.includes(input.uid));
      const rows = eligible.slice(0, MAX_ITEMS).map((x, i) =>
        item('私人對話 ' + (i + 1), x.lastMessageText || '請開啟訊息頁查看對話'));
      return summary(destination, rows.some(Boolean) ? 'available' : 'empty',
        rows.length ? '已讀取本人參與的校內對話摘要，未顯示其他人的帳號識別。'
          : '此校沒有讀到本人參與的私人對話。',
        rows);
    }
    case '/lost-found': {
      const data = await readers.records('lostFound', ctx);
      if (!Array.isArray(data)) return summary(destination, 'unavailable', '失物招領目前無法讀取。');
      const active = data.filter(x =>
        (!x.schoolId || x.schoolId === input.schoolId) &&
        ['open', 'active'].includes(String(x.status || '')) &&
        ['lost', 'found'].includes(String(x.type || '')));
      const rows = active.slice(0, MAX_ITEMS).map(x =>
        item((x.type === 'found' ? '拾獲：' : '遺失：') + text(x.title, 100), x.location || ''));
      return summary(destination, rows.some(Boolean) ? 'available' : 'empty',
        rows.length ? '已從目前學校的公開刊登取得項目，聯絡方式不會由語音助理顯示。'
          : '平台沒有讀到目前公開的刊登，可能仍有學校官方獨立失物資料。',
        rows);
    }
    case '/groups': {
      const data = await readers.records('groups', ctx);
      if (!Array.isArray(data)) return summary(destination, 'unavailable', '無法核對目前加入的課程與群組。');
      const members = data.filter(x =>
        x.schoolId === input.schoolId && x.status === 'active' &&
        (!x.groupId || x.groupId === x.id));
      const rows = members.length ? [item('已連結 ' + members.length + ' 筆有效群組',
        '詳細課程權限與最新內容請進入群組確認')] : [];
      return summary(destination, rows.length ? 'available' : 'empty',
        rows.length ? '已核對目前帳號的群組連結數量；不代表所有校方 LMS 課程都已匯入。'
          : '未讀到本人有效群組，請確認學校或課程連線狀態。',
        rows);
    }
    default:
      return openOnly(destination);
  }
}

/**
 * This is bounded to three read-only sources. The verification is applied once
 * to the account/school pair; no client-selected school can be treated as a
 * private-data authorization.
 */
async function connectCampusServiceData(input, deps = createReaders()) {
  const destinations = Array.isArray(input.destinations)
    ? input.destinations.filter(v => typeof v === 'string').slice(0, 3)
    : [];
  if (!destinations.length) return [];
  const schoolId = text(input.schoolId, 40);
  const uid = text(input.uid, 140);
  if (!schoolId || !uid) {
    return destinations.map(d => summary(d, 'connection-required', '需要登入並確認學校身分，才可讀取個人校園紀錄。'));
  }
  try {
    await deps.verify(uid, schoolId);
  } catch {
    return destinations.map(d => summary(d, 'connection-required',
      '帳號尚未驗證為目前學校的有效成員；請先完成學校身分連線。'));
  }
  const ctx = { ...input, uid, schoolId };
  const results = await Promise.all(destinations.map(async (d) => {
    if (!SAFE_DATA_ROUTES.has(d)) return openOnly(d);
    try {
      // Tool failures must not be portrayed as a genuinely empty data set.
      return await connectOne(d, ctx, deps);
    } catch {
      return summary(d, 'unavailable', '這項服務目前無法取得已驗證資料，請前往原服務頁確認。');
    }
  }));
  // A school membership may be revoked while individual read operations run.
  try {
    await deps.verify(uid, schoolId);
  } catch {
    return destinations.map(d => summary(d, 'connection-required',
      '查詢期間校園身分已失效，不能顯示較早讀到的私人資料。'));
  }
  return results;
}

module.exports = {
  CONNECTABLE_LABELS,
  ROUTE_HINTS,
  SAFE_DATA_ROUTES,
  connectCampusServiceData,
  safeDate,
};
