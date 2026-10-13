import { normalizeMerchantMode, safeStorefrontUrl, type MerchantMode } from './merchantMode';

export const DEMO_CAFETERIA_BADGE = '示範';
export const DEMO_CAFETERIA_NOTICE = '這是示範店家，菜單和價格不是真的，不能點餐。';
export const CAFETERIA_EMPTY_SCHOOL_TEXT = '這間學校的餐廳還沒上架';
export const CAFETERIA_NOT_FOUND_TEXT = '找不到這間店。';
export const CAFETERIA_BACK_TO_LIST_TEXT = '回餐廳列表';

const DEMO_SOURCE = /示範|demo|sample|假資料|測試種子|假菜單/i;
const DEMO_NAME = /示範|測試店|校園小棧|第一學生餐廳|第二學生餐廳|紙感小店/;
const DEMO_ID = /^(cafe-\d+|cafeteria-\d+|demo[-_]|sample[-_])/i;
const OFFICIAL_PU_NAME =
  /靜園|宜園|至善|小木屋|路易莎|白鬍子|Morning House|狠犟|川福|小林自助|樂亭|湯才|極壽喜|極咖哩|左撇子|酸菜魚|荳子|遇見雞|吉品|早安山丘|永和豆漿|宜園小廚|四海遊龍|王者香|炸雞大獅|咖喱大叔|YAMI|馨饌|拉亞|全家|好吃鮮果|禾豐|驖人|OK\s*便利|7-ELEVEN|7-11/;

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
  demo: boolean;
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

export function isDemoCafeteria(input: {
  id?: string | null;
  name?: string | null;
  sourceLabel?: string | null;
  menuSource?: string | null;
  source?: string | null;
}): boolean {
  const name = input.name ?? '';
  if (OFFICIAL_PU_NAME.test(name)) return false;
  const notes = [input.sourceLabel, input.menuSource, input.source].filter(Boolean).join(' ');
  if (DEMO_SOURCE.test(notes)) return true;
  if (DEMO_NAME.test(name)) return true;
  if (DEMO_ID.test(input.id ?? '')) return true;
  return false;
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
    demo: isDemoCafeteria({
      id,
      name,
      sourceLabel,
      menuSource: text(row.menuSource, 200),
      source: text(row.source, 200),
    }),
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
