'use strict';

const MERCHANT_MODES = ['native_order', 'showcase_link', 'info_only'];
const PRICE_DISCLAIMER =
  '價格、是否賣完、是否接單以店家訂餐頁為準。Nuni 不處理這筆的付款與退款。';
const EXTERNAL_ORDER_HONEST_TEXT =
  '訂單在店家系統，請到店家查看。我們沒有這筆的訂單號碼、餐點明細或付款狀態。';
const MENU_STALE_TEXT = '菜單可能過期，價格以店家頁面為準。';
const NATIVE_ORDERING_CLOSED_TEXT = '這間店目前不能在 App 點餐';
const MENU_STALE_AFTER_HOURS = 24;

function normalizeMerchantMode(value) {
  return MERCHANT_MODES.includes(value) ? value : 'info_only';
}

function resolveStoredMerchantMode(cafeteria = {}) {
  if (MERCHANT_MODES.includes(cafeteria.merchantMode)) return cafeteria.merchantMode;
  return cafeteria.orderingEnabled === true ? 'native_order' : 'info_only';
}

function isHttpsOrderingUrl(value) {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password;
  } catch {
    return false;
  }
}

function buildShowcaseOrderingUrl(orderingUrl, schoolId, cafeteriaId) {
  const url = new URL(orderingUrl);
  url.searchParams.set('utm_source', 'nuni');
  url.searchParams.set('utm_campaign', 'campus');
  url.searchParams.set('ref', `nuni-${schoolId}-${cafeteriaId}`);
  return url.toString();
}

function isMenuStale(menuSyncedAt, now = new Date()) {
  if (!menuSyncedAt) return true;
  const date =
    menuSyncedAt instanceof Date
      ? menuSyncedAt
      : typeof menuSyncedAt.toDate === 'function'
        ? menuSyncedAt.toDate()
        : new Date(menuSyncedAt);
  if (!Number.isFinite(date.getTime())) return true;
  return now.getTime() - date.getTime() > MENU_STALE_AFTER_HOURS * 60 * 60 * 1000;
}

function parseMenuCsv(text) {
  const lines = String(text || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (!lines.length) return [];
  const header = splitCsvLine(lines[0]).map((cell) => cell.toLowerCase());
  const nameIndex = header.findIndex((cell) => /name|品名|名稱/.test(cell));
  const priceIndex = header.findIndex((cell) => /price|價格|售價/.test(cell));
  const categoryIndex = header.findIndex((cell) => /category|分類|類別/.test(cell));
  const start = nameIndex >= 0 ? 1 : 0;
  return lines.slice(start).flatMap((line) => {
    const cells = splitCsvLine(line);
    const name = (nameIndex >= 0 ? cells[nameIndex] : cells[0] || '').trim();
    if (!name) return [];
    const rawPrice = priceIndex >= 0 ? cells[priceIndex] : cells[1];
    const parsed = rawPrice != null && rawPrice !== '' ? Number(String(rawPrice).replace(/[^\d.]/g, '')) : NaN;
    return [
      {
        name: name.slice(0, 80),
        price: Number.isFinite(parsed) && parsed >= 0 ? parsed : null,
        category: ((categoryIndex >= 0 ? cells[categoryIndex] : cells[2]) || '').trim().slice(0, 40),
      },
    ];
  });
}

function splitCsvLine(line) {
  const cells = [];
  let current = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      if (quoted && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else quoted = !quoted;
    } else if (char === ',' && !quoted) {
      cells.push(current);
      current = '';
    } else current += char;
  }
  cells.push(current);
  return cells.map((cell) => cell.trim());
}

function studentCafeteriaAction(input = {}) {
  const mode = resolveStoredMerchantMode(input);
  if (mode === 'showcase_link' && isHttpsOrderingUrl(input.orderingUrl)) {
    return { kind: 'showcase', label: '去訂餐' };
  }
  if (mode === 'native_order') {
    if (input.onlineOrderingEnabled === true && input.orderingEnabled === true) {
      return { kind: 'native', label: '點餐' };
    }
    return { kind: 'native_closed', label: NATIVE_ORDERING_CLOSED_TEXT };
  }
  return { kind: 'info', label: '查看店面' };
}

module.exports = {
  MERCHANT_MODES,
  PRICE_DISCLAIMER,
  EXTERNAL_ORDER_HONEST_TEXT,
  MENU_STALE_TEXT,
  NATIVE_ORDERING_CLOSED_TEXT,
  MENU_STALE_AFTER_HOURS,
  normalizeMerchantMode,
  resolveStoredMerchantMode,
  isHttpsOrderingUrl,
  buildShowcaseOrderingUrl,
  isMenuStale,
  parseMenuCsv,
  studentCafeteriaAction,
};
