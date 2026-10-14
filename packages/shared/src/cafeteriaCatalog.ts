import { normalizeMerchantMode, safeStorefrontUrl, type MerchantMode } from './merchantMode';

export const CAFETERIA_REVIEW_STATUSES = ['verified', 'unverified', 'demo'] as const;
export type CafeteriaReviewStatus = (typeof CAFETERIA_REVIEW_STATUSES)[number];
export const CAFETERIA_REVIEW_STATUS_DEFAULT: CafeteriaReviewStatus = 'unverified';
export const DEMO_CAFETERIA_BADGE = '示範';
export const DEMO_CAFETERIA_NOTICE = '這是示範店家，菜單和價格不是真的，不能點餐。';
export const UNVERIFIED_CAFETERIA_BADGE = '未核對';
export const UNVERIFIED_CAFETERIA_NOTICE =
  '這間店的菜單和價格還沒跟店家核對過，可能跟現場不一樣，目前不能點餐。';
export const CAFETERIA_EMPTY_SCHOOL_TEXT = '這間學校的餐廳還沒上架';
export const CAFETERIA_NOT_FOUND_TEXT = '找不到這間店。';
export const CAFETERIA_BACK_TO_LIST_TEXT = '回餐廳列表';
export const STOREFRONT_PAGE_SUBTITLE = '店家自己的主頁。';
export const CAFETERIA_PAYMENT_DISCLAIMER =
  '價格、是否賣完、是否接單以店家訂餐頁為準，付款與退款由店家處理。';

export type CafeteriaCatalogRecord = {
  id: string;
  name: string;
  schoolId: string;
  location?: string;
  openingHours?: string;
  intro?: string;
  websiteUrl?: string;
  orderingUrl?: string;
  merchantMode: MerchantMode;
  sourceLabel?: string;
  menuSyncedAt?: string;
  reviewStatus: CafeteriaReviewStatus;
};

export type CafeteriaCatalogMenuItem = {
  id: string;
  name: string;
  cafeteria: string;
  cafeteriaId: string;
  availableOn: string;
  price?: number;
  category?: string;
  description?: string;
  available?: boolean;
  soldOut?: boolean;
  schoolId: string;
};

function text(value: unknown, max = 400): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed && trimmed.length <= max ? trimmed : undefined;
}

function moneyTwd(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100000) {
    return Math.round(value);
  }
  if (!value || typeof value !== 'object') return undefined;
  const amount = (value as { amountMinor?: unknown }).amountMinor;
  if (typeof amount === 'number' && Number.isSafeInteger(amount) && amount >= 0 && amount <= 100000) {
    return amount;
  }
  return undefined;
}

function merchantModeOf(value: unknown): MerchantMode {
  if (value === 'full' || value === 'native_order') return 'native_order';
  return normalizeMerchantMode(value);
}

export function parseCafeteriaReviewStatus(value: unknown): CafeteriaReviewStatus {
  if (value === 'verified' || value === '已核對') return 'verified';
  if (value === 'demo' || value === '示範') return 'demo';
  return CAFETERIA_REVIEW_STATUS_DEFAULT;
}

export function cafeteriaReviewBadge(status: unknown): string | null {
  const parsed = parseCafeteriaReviewStatus(status);
  if (parsed === 'demo') return DEMO_CAFETERIA_BADGE;
  if (parsed === 'unverified') return UNVERIFIED_CAFETERIA_BADGE;
  return null;
}

export function cafeteriaReviewNotice(status: unknown): string | null {
  const parsed = parseCafeteriaReviewStatus(status);
  if (parsed === 'demo') return DEMO_CAFETERIA_NOTICE;
  if (parsed === 'unverified') return UNVERIFIED_CAFETERIA_NOTICE;
  return null;
}

export function parseCafeteriaLocation(
  value: unknown,
  schoolId: string,
): CafeteriaCatalogRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const id = text(row.id, 100);
  const name = text(row.name, 160);
  if (!id || id.includes('/') || !name) return null;
  if (typeof row.schoolId === 'string' && row.schoolId && row.schoolId !== schoolId) return null;
  const sourceLabel = text(row.sourceLabel, 200) ?? text(row.source, 200);
  return {
    id,
    name,
    schoolId,
    location: text(row.zoneLabel, 120) ?? text(row.location, 120),
    openingHours: text(row.openingHours, 120),
    intro: text(row.description, 500) ?? text(row.intro, 500),
    websiteUrl: safeStorefrontUrl(row.sourceUrl ?? row.websiteUrl),
    orderingUrl: safeStorefrontUrl(row.externalOrderUrl ?? row.orderingUrl),
    merchantMode: merchantModeOf(row.merchantMode),
    sourceLabel,
    menuSyncedAt: text(row.sourceUpdatedAt, 40) ?? text(row.menuSyncedAt, 40),
    reviewStatus: parseCafeteriaReviewStatus(
      row.reviewStatus ?? row.verificationStatus ?? row.catalogReview,
    ),
  };
}

export function parseCafeteriaLocations(value: unknown, schoolId: string): CafeteriaCatalogRecord[] {
  const rows = Array.isArray(value)
    ? value
    : value && typeof value === 'object' && Array.isArray((value as { locations?: unknown }).locations)
      ? (value as { locations: unknown[] }).locations
      : [];
  const seen = new Set<string>();
  const result: CafeteriaCatalogRecord[] = [];
  for (const row of rows.slice(0, 100)) {
    const parsed = parseCafeteriaLocation(row, schoolId);
    if (!parsed || seen.has(parsed.id)) continue;
    seen.add(parsed.id);
    result.push(parsed);
  }
  return result.sort((a, b) => a.name.localeCompare(b.name, 'zh-TW'));
}

function parseMenuItem(
  value: unknown,
  schoolId: string,
  cafeteriaId: string,
  cafeteriaName: string,
  sectionName?: string,
  generatedAt?: string,
): CafeteriaCatalogMenuItem | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const id = text(row.id, 100);
  const name = text(row.name, 160);
  if (!id || id.includes('/') || !name) return null;
  const available = row.available === true ? true : row.available === false ? false : undefined;
  const soldOut = row.soldOut === true || available === false;
  return {
    id,
    name,
    cafeteria: cafeteriaName,
    cafeteriaId,
    availableOn: text(row.availableOn, 40) ?? generatedAt ?? '',
    price: moneyTwd(row.basePrice ?? row.price),
    category: text(row.category, 80) ?? sectionName,
    description: text(row.description, 400),
    available,
    soldOut,
    schoolId,
  };
}

export function parseCafeteriaMenu(
  value: unknown,
  schoolId: string,
  cafeteriaId: string,
  cafeteriaName = '',
): CafeteriaCatalogMenuItem[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  const row = value as Record<string, unknown>;
  const location = parseCafeteriaLocation(row.location, schoolId);
  const name = location?.name || cafeteriaName;
  const id = location?.id || cafeteriaId;
  if (location && location.id !== cafeteriaId) return [];
  const generatedAt = text(row.generatedAt, 40);
  const items: CafeteriaCatalogMenuItem[] = [];
  const sections = Array.isArray(row.sections) ? row.sections : [];
  for (const section of sections.slice(0, 40)) {
    if (!section || typeof section !== 'object') continue;
    const sectionName = text((section as { name?: unknown }).name, 80);
    const sectionItems = Array.isArray((section as { items?: unknown }).items)
      ? ((section as { items: unknown[] }).items)
      : [];
    for (const item of sectionItems.slice(0, 200)) {
      const parsed = parseMenuItem(item, schoolId, id, name, sectionName, generatedAt);
      if (parsed) items.push(parsed);
    }
  }
  if (items.length === 0 && Array.isArray(row.items)) {
    for (const item of row.items.slice(0, 200)) {
      const parsed = parseMenuItem(item, schoolId, id, name, undefined, generatedAt);
      if (parsed) items.push(parsed);
    }
  }
  return items;
}

export function cafeteriaListHref(schoolId: string): string {
  return `/cafeteria?schoolId=${encodeURIComponent(schoolId)}`;
}

export function cafeteriaHref(schoolId: string, cafeteriaId: string): string {
  return `/cafeteria/${encodeURIComponent(cafeteriaId)}?schoolId=${encodeURIComponent(schoolId)}`;
}
