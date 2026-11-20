import {
  parseCafeteriaLocations,
  parseCafeteriaMenu,
  toPublicCafeteriaMenuItem,
  toPublicCafeteriaRecord,
  type CafeteriaCatalogMenuItem,
  type CafeteriaCatalogRecord,
} from '@campus/shared/src/cafeteriaCatalog';
import { publicDiningCafeterias } from '@campus/shared/src/publicDiningCatalog';
import { nuniPublicRequest } from './nuniClient';

const TENANT = /^[a-z0-9][a-z0-9-]{0,78}[a-z0-9]$/;
const LOCATION = /^[A-Za-z0-9_-]{1,100}$/;

function asCatalog(value: unknown, schoolId: string): {
  cafeterias: CafeteriaCatalogRecord[];
  menus: CafeteriaCatalogMenuItem[];
} {
  const row =
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const cafeterias = parseCafeteriaLocations(row.cafeterias ?? row.locations ?? value, schoolId).map(
    (shop) => parseCafeteriaLocations([toPublicCafeteriaRecord(shop)], schoolId)[0]!,
  );
  const menus: CafeteriaCatalogMenuItem[] = [];
  if (Array.isArray(row.menus)) {
    for (const item of row.menus) {
      if (!item || typeof item !== 'object') continue;
      const cafeteriaId = String((item as { cafeteriaId?: unknown }).cafeteriaId || '');
      if (!cafeteriaId) continue;
      const cafeteria = cafeterias.find((shop) => shop.id === cafeteriaId);
      const parsed = parseCafeteriaMenu(
        { items: [item] },
        schoolId,
        cafeteriaId,
        cafeteria?.name || '',
      );
      for (const menu of parsed) {
        const published = parseCafeteriaMenu(
          { items: [toPublicCafeteriaMenuItem(menu)] },
          schoolId,
          cafeteriaId,
          menu.cafeteria,
        )[0];
        if (published) menus.push(published);
      }
    }
  }
  return { cafeterias, menus };
}

export async function fetchCafeteriaCatalog(schoolId: string): Promise<{
  cafeterias: CafeteriaCatalogRecord[];
  menus: CafeteriaCatalogMenuItem[];
}> {
  if (!TENANT.test(schoolId)) return { cafeterias: [], menus: [] };
  const fallback = {
    cafeterias: publicDiningCafeterias(schoolId),
    menus: [] as CafeteriaCatalogMenuItem[],
  };
  try {
    const catalog = asCatalog(await nuniPublicRequest(`schools/${schoolId}/cafeterias`), schoolId);
    if (catalog.cafeterias.length) return catalog;
    return fallback.cafeterias.length ? fallback : catalog;
  } catch (error) {
    if (fallback.cafeterias.length) return fallback;
    throw error;
  }
}

export async function fetchCafeteriaLocations(
  schoolId: string,
): Promise<CafeteriaCatalogRecord[]> {
  return (await fetchCafeteriaCatalog(schoolId)).cafeterias;
}

export async function fetchCafeteriaMenu(
  schoolId: string,
  cafeteria: CafeteriaCatalogRecord,
): Promise<CafeteriaCatalogMenuItem[]> {
  if (!TENANT.test(schoolId) || !LOCATION.test(cafeteria.id)) return [];
  return (await fetchCafeteriaCatalog(schoolId)).menus.filter(
    (item) => item.cafeteriaId === cafeteria.id,
  );
}

export async function fetchCafeteriaDetail(
  schoolId: string,
  cafeteriaId: string,
): Promise<{ cafeteria: CafeteriaCatalogRecord | null; menus: CafeteriaCatalogMenuItem[] }> {
  if (!TENANT.test(schoolId) || !LOCATION.test(cafeteriaId)) {
    return { cafeteria: null, menus: [] };
  }
  const catalog = await fetchCafeteriaCatalog(schoolId);
  const cafeteria = catalog.cafeterias.find((row) => row.id === cafeteriaId) ?? null;
  return {
    cafeteria,
    menus: cafeteria ? catalog.menus.filter((row) => row.cafeteriaId === cafeteriaId) : [],
  };
}
