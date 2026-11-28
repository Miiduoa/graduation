'use strict';

/** This only selects a private reservation; it grants no write authority. */
function washingReservationIntent(message) {
  const text = String(message || '');
  if (!/洗衣/.test(text) || !/預約|取消|撤銷/.test(text)) return null;
  if (/查|查看|狀態|紀錄|記錄|取消(?:成功|完成|了)|(?:有沒有|是否|已經|已)取消/.test(text)) return 'wash_status';
  if (/取消|撤銷/.test(text)) return 'wash_cancel';
  return null;
}

function taipeiDate(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

function parseWashingReservationTarget(message, now = Date.now()) {
  let rest = String(message || '').normalize('NFKC').trim();
  if (rest.length > 400 || /[\p{Cc}\p{Cf}]/u.test(rest) ||
      /不要|不用|別|勿|不必|不想|怎麼|如何|全部|所有|一起|改成|改為|然後|順便|另外|重新預約|再預約|除了/.test(rest)) return { kind: 'clarify' };
  const labels = /(?:預約)?(?:編號|ID|單號)\s*[:：]?\s*([^\s，。！？,!?；;]+)/gi;
  const ids = [...rest.matchAll(labels)].map((m) => m[1]);
  if (ids.some((id) => !/^[A-Za-z0-9_-]{1,128}$/.test(id)) || new Set(ids).size > 1) return { kind: 'clarify' };
  rest = rest.replace(labels, ' ');
  // Repeating the booking verb can be a second operation; never silently discard it.
  if ((rest.match(/預約/g) || []).length > 1) return { kind: 'clarify' };
  const dates = [];
  rest = rest.replace(/\d{4}-\d{2}-\d{2}/g, (value) => {
    const time = Date.parse(value + 'T00:00:00+08:00');
    dates.push(taipeiDate(time) === value ? value : 'invalid');
    return ' ';
  });
  let evening = false;
  rest = rest.replace(/今天|今日|今晚|明天|後天/g, (value) => {
    const offset = value === '明天' ? 1 : value === '後天' ? 2 : 0;
    if (value === '今晚') evening = true;
    dates.push(taipeiDate(now + offset * 86400000));
    return ' ';
  });
  if (dates.includes('invalid') || dates.includes(null) || new Set(dates).size > 1) return { kind: 'clarify' };
  const clocks = [...rest.matchAll(/\b\d{1,2}:\d{2}\b/g)].map((m) => m[0].padStart(5, '0'));
  rest = rest.replace(/\b\d{1,2}:\d{2}\b/g, ' ');
  if (clocks.some((clock) => !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(clock)) || new Set(clocks).size > 1) return { kind: 'clarify' };
  const machines = [...rest.matchAll(/\b[A-Za-z][A-Za-z0-9_-]*\d[A-Za-z0-9_-]*\b/g)].map((m) => m[0]);
  rest = rest.replace(/\b[A-Za-z][A-Za-z0-9_-]*\d[A-Za-z0-9_-]*\b/g, ' ');
  if (new Set(machines).size > 1) return { kind: 'clarify' };
  // Unknown targets are not silently dropped in favour of the first reservation.
  rest = rest.replace(/取消成功了嗎|取消成功|取消完成|取消了|有沒有取消|是否取消|已經取消|已取消|幫我|替我|麻煩|請問|我的|本人|目前|有效|查看|查詢|狀態|紀錄|記錄|洗衣機|洗衣|機台|預約|取消|撤銷|那一筆|那筆|這一筆|這筆|一筆|謝謝|請|查|的|了|嗎|我|要/g, '')
    .replace(/[\s，。！？,!?；;「」『』()（）]/g, '');
  if (rest) return { kind: 'clarify' };
  return { kind: 'target', reservationId: ids[0], machineId: machines[0], date: dates[0], time: clocks[0], evening };
}

function selectWashingReservation(rows, target) {
  if (target.kind !== 'target') return { issue: 'clarify' };
  const matches = rows.filter((row) => {
    if (target.reservationId && row.reservationId !== target.reservationId) return false;
    if (target.machineId && row.machineId !== target.machineId) return false;
    if (target.date || target.time || target.evening) {
      // A legacy HH:mm without a date cannot prove a request for a particular day.
      const iso = typeof row.startTime === 'string' && /^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(row.startTime);
      const date = iso ? taipeiDate(row.startTime) : null;
      const parts = iso && Number.isFinite(Date.parse(row.startTime))
        ? new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Taipei', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(row.startTime)) : row.startTime;
      if (target.date && date !== target.date) return false;
      if (target.time && parts !== target.time) return false;
      if (target.evening && !(parts >= '18:00' && parts <= '23:59')) return false;
    }
    return true;
  });
  return matches.length === 1 ? { reservation: matches[0] } : { issue: matches.length ? 'ambiguous' : 'not-found' };
}

module.exports = { washingReservationIntent, parseWashingReservationTarget, selectWashingReservation };
