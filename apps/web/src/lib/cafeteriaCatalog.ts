import type { Cafeteria, MenuItem } from '@/lib/firebase';
import {
  parseCafeteriaLocations,
  type CafeteriaCatalogMenuItem,
  type CafeteriaCatalogRecord,
  type CafeteriaReviewStatus,
} from '@campus/shared/src/cafeteriaCatalog';

export type CatalogCafeteria = Cafeteria & {
  sourceLabel?: string | undefined;
  reviewStatus?: CafeteriaReviewStatus;
};

function toCafeteria(row: CafeteriaCatalogRecord): CatalogCafeteria {
  return {
    id: row.id,
    name: row.name,
    schoolId: row.schoolId,
    location: row.location,
    openingHours: row.openingHours,
    intro: row.intro,
    websiteUrl: row.websiteUrl,
    orderingUrl: row.orderingUrl,
    merchantMode: row.merchantMode,
    menuSyncedAt: row.menuSyncedAt,
    sourceLabel: row.sourceLabel,
    reviewStatus: row.reviewStatus,
  };
}

function toMenu(row: CafeteriaCatalogMenuItem): MenuItem {
  return {
    id: row.id,
    name: row.name,
    cafeteria: row.cafeteria,
    cafeteriaId: row.cafeteriaId,
    availableOn: row.availableOn,
    price: row.price,
    category: row.category,
    description: row.description,
    available: row.available,
    soldOut: row.soldOut,
    schoolId: row.schoolId,
  };
}

function asMenu(value: unknown, schoolId: string): MenuItem | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (typeof row.id !== 'string' || typeof row.name !== 'string') return null;
  if (typeof row.cafeteriaId !== 'string' || !row.cafeteriaId) return null;
  if (typeof row.schoolId === 'string' && row.schoolId && row.schoolId !== schoolId) return null;
  return toMenu({
    id: row.id,
    name: row.name,
    cafeteria: typeof row.cafeteria === 'string' ? row.cafeteria : '',
    cafeteriaId: row.cafeteriaId,
    availableOn: typeof row.availableOn === 'string' ? row.availableOn : '',
    price: typeof row.price === 'number' ? row.price : undefined,
    category: typeof row.category === 'string' ? row.category : undefined,
    description: typeof row.description === 'string' ? row.description : undefined,
    available: typeof row.available === 'boolean' ? row.available : undefined,
    soldOut: typeof row.soldOut === 'boolean' ? row.soldOut : undefined,
    schoolId,
  });
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  if (!response.ok) throw new Error('unavailable');
  const value: unknown = await response.json();
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('unavailable');
  return value as Record<string, unknown>;
}

export async function fetchCafeteriaCatalog(schoolId: string): Promise<{
  cafeterias: CatalogCafeteria[];
  menus: MenuItem[];
}> {
  if (!schoolId) return { cafeterias: [], menus: [] };
  const response = await fetch(`/api/cafeterias?schoolId=${encodeURIComponent(schoolId)}`, {
    cache: 'no-store',
    credentials: 'same-origin',
    redirect: 'error',
    signal: AbortSignal.timeout(15000),
  });
  const value = await readJson(response);
  if (value.schoolId !== schoolId) throw new Error('unavailable');
  return {
    cafeterias: parseCafeteriaLocations(value.cafeterias ?? value, schoolId).map(toCafeteria),
    menus: Array.isArray(value.menus)
      ? value.menus.flatMap((row) => {
          const menu = asMenu(row, schoolId);
          return menu ? [menu] : [];
        })
      : [],
  };
}

export async function fetchCafeteriaDetail(
  schoolId: string,
  cafeteriaId: string,
): Promise<{ cafeteria: CatalogCafeteria | null; menus: MenuItem[] }> {
  if (!schoolId || !cafeteriaId || cafeteriaId.includes('/')) {
    return { cafeteria: null, menus: [] };
  }
  const response = await fetch(
    `/api/cafeterias/${encodeURIComponent(cafeteriaId)}?schoolId=${encodeURIComponent(schoolId)}`,
    {
      cache: 'no-store',
      credentials: 'same-origin',
      redirect: 'error',
      signal: AbortSignal.timeout(15000),
    },
  );
  const value = await readJson(response);
  if (value.schoolId !== schoolId) throw new Error('unavailable');
  const cafeteria = value.cafeteria
    ? (parseCafeteriaLocations([value.cafeteria], schoolId).map(toCafeteria)[0] ?? null)
    : null;
  return {
    cafeteria,
    menus: Array.isArray(value.menus)
      ? value.menus.flatMap((row) => {
          const menu = asMenu(row, schoolId);
          return menu && menu.cafeteriaId === cafeteriaId ? [menu] : [];
        })
      : [],
  };
}
