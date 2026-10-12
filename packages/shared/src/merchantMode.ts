export const MERCHANT_MODES = ['native_order', 'showcase_link', 'info_only'] as const;
export type MerchantMode = (typeof MERCHANT_MODES)[number];

export const PRICE_DISCLAIMER = '價格、是否賣完、是否接單以店家訂餐頁為準。Nuni 不處理這筆的付款與退款。';
export const EXTERNAL_ORDER_HONEST_TEXT =
  '訂單在店家系統，請到店家查看。我們沒有這筆的訂單號碼、餐點明細或付款狀態。';
export const MENU_STALE_TEXT = '菜單可能過期，價格以店家頁面為準。';
export const SHOWCASE_ORDER_BUTTON_TEXT = '到店家網站訂餐';
export const SHOWCASE_ORDER_CAPTION =
  '會開啟店家自己的網站，訂單和付款由店家處理，Campus One 查不到這筆訂單';
export const SHOWCASE_LEAVE_NOTICE = SHOWCASE_ORDER_CAPTION;
export const NATIVE_ORDERING_CLOSED_TEXT = '這間店目前不能在 App 點餐';
export const MENU_STALE_AFTER_HOURS = 24;

export function normalizeMerchantMode(value: unknown): MerchantMode {
  return MERCHANT_MODES.includes(value as MerchantMode) ? (value as MerchantMode) : 'info_only';
}

export function resolveStoredMerchantMode(cafeteria: {
  merchantMode?: unknown;
  orderingEnabled?: boolean;
} = {}): MerchantMode {
  if (MERCHANT_MODES.includes(cafeteria.merchantMode as MerchantMode)) {
    return cafeteria.merchantMode as MerchantMode;
  }
  return cafeteria.orderingEnabled === true ? 'native_order' : 'info_only';
}

export function isHttpsOrderingUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password;
  } catch {
    return false;
  }
}

export const STOREFRONT_URL_MAX_LENGTH = 500;
export const STOREFRONT_URL_HTTPS_TEXT = '請貼 https:// 開頭的網址';
export const STOREFRONT_URL_CREDENTIALS_TEXT = '網址裡不能有帳號或密碼';
export const STOREFRONT_URL_TOO_LONG_TEXT = '網址太長，請改用店家網站首頁或訂餐頁的網址';

export function trimStorefrontUrl(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** 畫面用：先去掉前後空白再檢查。空白本身不報錯；空字串表示沒填。 */
export function storefrontUrlIssue(value: unknown): string | null {
  const trimmed = trimStorefrontUrl(value);
  if (!trimmed) return null;
  if (trimmed.length > STOREFRONT_URL_MAX_LENGTH) return STOREFRONT_URL_TOO_LONG_TEXT;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== 'https:') return STOREFRONT_URL_HTTPS_TEXT;
    if (url.username || url.password) return STOREFRONT_URL_CREDENTIALS_TEXT;
    return null;
  } catch {
    return STOREFRONT_URL_HTTPS_TEXT;
  }
}

/** 後端／規則用：帶空白的值直接擋，不先 trim。空字串可以。 */
export function isStoredStorefrontUrlAllowed(value: unknown): boolean {
  if (value == null || value === '') return true;
  if (typeof value !== 'string') return false;
  if (value !== value.trim() || /\s/.test(value)) return false;
  return storefrontUrlIssue(value) === null;
}

export function buildShowcaseOrderingUrl(
  orderingUrl: string,
  schoolId: string,
  cafeteriaId: string,
): string {
  const url = new URL(orderingUrl);
  url.searchParams.set('utm_source', 'nuni');
  url.searchParams.set('utm_campaign', 'campus');
  url.searchParams.set('ref', `nuni-${schoolId}-${cafeteriaId}`);
  return url.toString();
}

export function isMenuStale(menuSyncedAt: string | Date | null | undefined, now = new Date()): boolean {
  if (!menuSyncedAt) return true;
  const date = menuSyncedAt instanceof Date ? menuSyncedAt : new Date(menuSyncedAt);
  if (!Number.isFinite(date.getTime())) return true;
  return now.getTime() - date.getTime() > MENU_STALE_AFTER_HOURS * 60 * 60 * 1000;
}

export function parseMenuCsv(text: string): { name: string; price: number | null; category: string }[] {
  const lines = String(text || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) return [];
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

function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      if (quoted && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === ',' && !quoted) {
      cells.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  cells.push(current);
  return cells.map((cell) => cell.trim());
}

export function studentCafeteriaAction(input: {
  merchantMode?: unknown;
  orderingEnabled?: boolean;
  onlineOrderingEnabled?: boolean;
  orderingUrl?: unknown;
}): { kind: 'native' | 'showcase' | 'info' | 'native_closed'; label: string } {
  const mode = resolveStoredMerchantMode(input);
  if (mode === 'showcase_link' && isHttpsOrderingUrl(input.orderingUrl)) {
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
