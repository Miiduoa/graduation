import {
  assertNoPrivateCafeteriaFields,
  parseCafeteriaLocations,
  parseCafeteriaMenu,
  toPublicCafeteriaMenuItem,
  toPublicCafeteriaRecord,
  type CafeteriaCatalogMenuItem,
  type CafeteriaCatalogRecord,
} from './cafeteriaCatalog';

export class PublicCafeteriaError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'PublicCafeteriaError';
  }
}

export type PublicCafeteriaSql = {
  query<Row = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<{ rows: Row[] }>;
};

export type PublicCafeteriaCatalog = {
  schoolId: string;
  cafeterias: ReturnType<typeof toPublicCafeteriaRecord>[];
  menus: ReturnType<typeof toPublicCafeteriaMenuItem>[];
};

const TENANT = /^[a-z0-9][a-z0-9-]{0,78}[a-z0-9]$/;
const CACHE_MS = 60_000;
const cache = new Map<string, { expiresAt: number; value: PublicCafeteriaCatalog }>();

export function publicCafeteriaCacheTtlMs() {
  return CACHE_MS;
}

export function resetPublicCafeteriaCache() {
  cache.clear();
}

export function requirePublicSchoolId(value: unknown): string {
  if (typeof value !== 'string' || !TENANT.test(value)) {
    throw new PublicCafeteriaError(400, 'SCHOOL_ID_REQUIRED', '請指定學校');
  }
  return value;
}

type TenantRow = { id: string; state: string };
type LocationRow = {
  id: string;
  name: string;
  zone_label: string | null;
  opening_hours: string | null;
  description: string | null;
  merchant_mode: string | null;
  review_status: string | null;
  source_url: string | null;
  external_order_url: string | null;
  source_label: string | null;
  source_updated_at: string | Date | null;
};
type MenuRow = {
  id: string;
  location_id: string;
  name: string;
  section_name: string | null;
  description: string | null;
  price_minor: number | null;
  available: boolean | null;
  sold_out: boolean | null;
};

function asIso(value: string | Date | null): string | undefined {
  if (!value) return undefined;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : undefined;
}

function projectLocation(row: LocationRow, schoolId: string): CafeteriaCatalogRecord | null {
  return parseCafeteriaLocations(
    [
      {
        id: row.id,
        name: row.name,
        schoolId,
        zoneLabel: row.zone_label,
        openingHours: row.opening_hours,
        description: row.description,
        merchantMode: row.merchant_mode,
        reviewStatus: row.review_status,
        sourceUrl: row.source_url,
        externalOrderUrl: row.external_order_url,
        sourceLabel: row.source_label,
        sourceUpdatedAt: asIso(row.source_updated_at),
      },
    ],
    schoolId,
  )[0] ?? null;
}

function projectMenus(
  rows: MenuRow[],
  locations: CafeteriaCatalogRecord[],
  schoolId: string,
): CafeteriaCatalogMenuItem[] {
  const byId = new Map(locations.map((row) => [row.id, row]));
  const items: CafeteriaCatalogMenuItem[] = [];
  for (const row of rows) {
    const location = byId.get(row.location_id);
    if (!location) continue;
    const parsed = parseCafeteriaMenu(
      {
        location: { id: location.id, name: location.name },
        items: [
          {
            id: row.id,
            name: row.name,
            category: row.section_name,
            description: row.description,
            basePrice: { amountMinor: row.price_minor },
            available: row.available,
            soldOut: row.sold_out,
          },
        ],
      },
      schoolId,
      location.id,
      location.name,
    );
    items.push(...parsed);
  }
  return items;
}

export class PublicCafeteriaService {
  constructor(private readonly db: PublicCafeteriaSql) {}

  async list(schoolIdInput: unknown, now = Date.now()): Promise<PublicCafeteriaCatalog> {
    const schoolId = requirePublicSchoolId(schoolIdInput);
    const hit = cache.get(schoolId);
    if (hit && hit.expiresAt > now) return hit.value;
    const tenant = (
      await this.db.query<TenantRow>('SELECT id, state FROM tenants WHERE id=$1', [schoolId])
    ).rows[0];
    if (!tenant || tenant.state !== 'open') {
      const empty = { schoolId, cafeterias: [], menus: [] };
      cache.set(schoolId, { expiresAt: now + CACHE_MS, value: empty });
      return empty;
    }
    const locations = (
      await this.db.query<LocationRow>(
        `SELECT id, name, zone_label, opening_hours, description, merchant_mode, review_status,
                source_url, external_order_url, source_label, source_updated_at
           FROM food_locations
          WHERE tenant_id=$1
          ORDER BY name
          LIMIT 100`,
        [schoolId],
      )
    ).rows
      .map((row) => projectLocation(row, schoolId))
      .filter((row): row is CafeteriaCatalogRecord => row !== null);
    const menus =
      locations.length === 0
        ? []
        : projectMenus(
            (
              await this.db.query<MenuRow>(
                `SELECT id, location_id, name, section_name, description, price_minor, available, sold_out
                   FROM food_menu_items
                  WHERE tenant_id=$1
                  LIMIT 400`,
                [schoolId],
              )
            ).rows,
            locations,
            schoolId,
          );
    const value: PublicCafeteriaCatalog = {
      schoolId,
      cafeterias: locations.map(toPublicCafeteriaRecord),
      menus: menus.map(toPublicCafeteriaMenuItem),
    };
    assertNoPrivateCafeteriaFields(value.cafeterias);
    assertNoPrivateCafeteriaFields(value.menus);
    cache.set(schoolId, { expiresAt: now + CACHE_MS, value });
    return value;
  }
}

export function createWindowLimiter(options: { max: number; windowMs: number }) {
  const hits = new Map<string, number[]>();
  return {
    allow(key: string, now = Date.now()) {
      const recent = (hits.get(key) ?? []).filter((stamp) => now - stamp < options.windowMs);
      if (recent.length >= options.max) {
        hits.set(key, recent);
        return false;
      }
      recent.push(now);
      hits.set(key, recent);
      return true;
    },
    reset() {
      hits.clear();
    },
  };
}
