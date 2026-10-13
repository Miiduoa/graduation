import {
  parseCafeteriaLocations,
  parseCafeteriaMenu,
  type CafeteriaCatalogMenuItem,
  type CafeteriaCatalogRecord,
} from '@campus/shared/src/cafeteriaCatalog';
import { nuniPlatformRequest } from './nuniClient';

const TENANT = /^[a-z0-9][a-z0-9-]{0,78}[a-z0-9]$/;
const LOCATION = /^[A-Za-z0-9_-]{1,100}$/;

export async function fetchCafeteriaLocations(
  schoolId: string,
): Promise<CafeteriaCatalogRecord[]> {
  if (!TENANT.test(schoolId)) return [];
  return parseCafeteriaLocations(
    await nuniPlatformRequest(`realms/${schoolId}/food/locations`),
    schoolId,
  );
}

export async function fetchCafeteriaMenu(
  schoolId: string,
  cafeteria: CafeteriaCatalogRecord,
): Promise<CafeteriaCatalogMenuItem[]> {
  if (!TENANT.test(schoolId) || !LOCATION.test(cafeteria.id)) return [];
  try {
    return parseCafeteriaMenu(
      await nuniPlatformRequest(`realms/${schoolId}/food/locations/${cafeteria.id}/menu`),
      schoolId,
      cafeteria.id,
      cafeteria.name,
    );
  } catch {
    return [];
  }
}

export async function fetchCafeteriaDetail(
  schoolId: string,
  cafeteriaId: string,
): Promise<{ cafeteria: CafeteriaCatalogRecord | null; menus: CafeteriaCatalogMenuItem[] }> {
  if (!TENANT.test(schoolId) || !LOCATION.test(cafeteriaId)) {
    return { cafeteria: null, menus: [] };
  }
  const cafeteria =
    (await fetchCafeteriaLocations(schoolId)).find((row) => row.id === cafeteriaId) ?? null;
  if (!cafeteria) return { cafeteria: null, menus: [] };
  return { cafeteria, menus: await fetchCafeteriaMenu(schoolId, cafeteria) };
}
