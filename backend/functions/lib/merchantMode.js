'use strict';

const MERCHANT_MODES = ['native_order', 'showcase_link', 'info_only'];
const PRICE_DISCLAIMER =
  '價格、是否賣完、是否接單以店家訂餐頁為準，付款與退款由店家處理。';
const EXTERNAL_ORDER_HONEST_TEXT =
  '訂單在店家系統，請到店家查看。我們沒有這筆的訂單號碼、餐點明細或付款狀態。';
const MENU_STALE_TEXT = '菜單可能過期，價格以店家頁面為準。';
const SHOWCASE_ORDER_BUTTON_TEXT = '到店家網站訂餐';
const SHOWCASE_ORDER_CAPTION =
  '會開啟店家自己的網站，訂單和付款由店家處理，Campus One 查不到這筆訂單';
const SHOWCASE_LEAVE_NOTICE = SHOWCASE_ORDER_CAPTION;
const NATIVE_ORDERING_CLOSED_TEXT = '這間店目前不能在 App 點餐';
const MENU_STALE_AFTER_HOURS = 24;

function normalizeMerchantMode(value) {
  return MERCHANT_MODES.includes(value) ? value : 'info_only';
}

function resolveStoredMerchantMode(cafeteria = {}) {
  if (MERCHANT_MODES.includes(cafeteria.merchantMode)) return cafeteria.merchantMode;
  return cafeteria.orderingEnabled === true ? 'native_order' : 'info_only';
}

const STOREFRONT_URL_MAX_LENGTH = 2048;
const STOREFRONT_URL_HTTPS_TEXT = '請貼 https:// 開頭的網址';
const STOREFRONT_URL_CREDENTIALS_TEXT = '網址裡不能有帳號或密碼';
const STOREFRONT_URL_TOO_LONG_TEXT = '網址太長，請改用店家網站首頁或訂餐頁的網址';

function storefrontUrlHasForbiddenChars(value) {
  if (value !== value.trim()) return true;
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code <= 0x20 || code === 0x7f) return true;
  }
  return false;
}

function inspectHttpsStorefrontUrl(value) {
  if (value.length > STOREFRONT_URL_MAX_LENGTH) return 'length';
  if (storefrontUrlHasForbiddenChars(value)) return 'chars';
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') return 'https';
    if (url.username || url.password) return 'credentials';
    return 'ok';
  } catch {
    return 'https';
  }
}

function isHttpsOrderingUrl(value) {
  return (
    typeof value === 'string' &&
    value !== '' &&
    value === value.trim() &&
    storefrontUrlIssue(value) === null
  );
}

function trimStorefrontUrl(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function storefrontUrlIssue(value) {
  const trimmed = trimStorefrontUrl(value);
  if (!trimmed) return null;
  const issue = inspectHttpsStorefrontUrl(trimmed);
  if (issue === 'ok') return null;
  if (issue === 'length') return STOREFRONT_URL_TOO_LONG_TEXT;
  if (issue === 'credentials') return STOREFRONT_URL_CREDENTIALS_TEXT;
  return STOREFRONT_URL_HTTPS_TEXT;
}

function isStoredStorefrontUrlAllowed(value) {
  if (value == null || value === '') return true;
  return isHttpsOrderingUrl(value);
}

function safeStorefrontUrl(value) {
  return isHttpsOrderingUrl(value) ? value : undefined;
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
  if (
    mode === 'showcase_link' &&
    storefrontUrlIssue(input.orderingUrl) === null &&
    isHttpsOrderingUrl(input.orderingUrl)
  ) {
    return { kind: 'showcase', label: SHOWCASE_ORDER_BUTTON_TEXT };
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
  SHOWCASE_ORDER_BUTTON_TEXT,
  SHOWCASE_ORDER_CAPTION,
  SHOWCASE_LEAVE_NOTICE,
  NATIVE_ORDERING_CLOSED_TEXT,
  MENU_STALE_AFTER_HOURS,
  normalizeMerchantMode,
  resolveStoredMerchantMode,
  isHttpsOrderingUrl,
  safeStorefrontUrl,
  STOREFRONT_URL_MAX_LENGTH,
  STOREFRONT_URL_HTTPS_TEXT,
  STOREFRONT_URL_CREDENTIALS_TEXT,
  STOREFRONT_URL_TOO_LONG_TEXT,
  trimStorefrontUrl,
  storefrontUrlIssue,
  isStoredStorefrontUrlAllowed,
  buildShowcaseOrderingUrl,
  isMenuStale,
  parseMenuCsv,
  studentCafeteriaAction,
};
