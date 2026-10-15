import { NextRequest } from 'next/server';
import { NuniError } from '@campus/shared/src/nuni';
import {
  assertNoPrivateCafeteriaFields,
  parseCafeteriaLocations,
  parseCafeteriaMenu,
  toPublicCafeteriaMenuItem,
  toPublicCafeteriaRecord,
  type CafeteriaCatalogMenuItem,
  type CafeteriaCatalogRecord,
} from '@campus/shared/src/cafeteriaCatalog';
import { errorResponse, jsonResponse, publicRequest } from './server';

const TENANT = /^[a-z0-9][a-z0-9-]{0,78}[a-z0-9]$/;
const LOCATION = /^[A-Za-z0-9_-]{1,100}$/;
const limiterHits = new Map<string, number[]>();
const LIMIT = 60;
const WINDOW_MS = 60_000;

function clientKey(request: NextRequest): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  return request.headers.get('x-real-ip') || 'anon';
}

function allowPublicRead(request: NextRequest, now = Date.now()): boolean {
  const key = clientKey(request);
  const recent = (limiterHits.get(key) ?? []).filter((stamp) => now - stamp < WINDOW_MS);
  if (recent.length >= LIMIT) {
    limiterHits.set(key, recent);
    return false;
  }
  recent.push(now);
  limiterHits.set(key, recent);
  return true;
}

function requestedSchoolId(request: NextRequest): string {
  const extra = [...request.nextUrl.searchParams.keys()].filter((key) => key !== 'schoolId');
  if (extra.length) throw new NuniError(400, 'INVALID_INPUT');
  const value = request.nextUrl.searchParams.get('schoolId');
  if (value === null || value === '') throw new NuniError(400, 'INVALID_INPUT');
  if (!TENANT.test(value)) throw new NuniError(400, 'INVALID_INPUT');
  return value;
}

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
      const parsed = parseCafeteriaMenu({ items: [item] }, schoolId, cafeteriaId, cafeteria?.name || '');
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
  assertNoPrivateCafeteriaFields(cafeterias);
  assertNoPrivateCafeteriaFields(menus);
  return { cafeterias, menus };
}

async function loadPublicCatalog(schoolId: string) {
  return asCatalog(await publicRequest(`schools/${schoolId}/cafeterias`), schoolId);
}

export async function handleCafeteriaCatalog(request: NextRequest) {
  try {
    if (request.method !== 'GET') throw new NuniError(405, 'METHOD_NOT_ALLOWED');
    if (!allowPublicRead(request)) throw new NuniError(429, 'RATE_LIMITED');
    const schoolId = requestedSchoolId(request);
    const catalog = await loadPublicCatalog(schoolId);
    return jsonResponse(
      { schoolId, cafeterias: catalog.cafeterias, menus: catalog.menus },
      200,
      'public',
    );
  } catch (error) {
    return errorResponse(error);
  }
}

export async function handleCafeteriaDetail(request: NextRequest, cafeteriaId: string) {
  try {
    if (request.method !== 'GET') throw new NuniError(405, 'METHOD_NOT_ALLOWED');
    if (!LOCATION.test(cafeteriaId)) throw new NuniError(400, 'INVALID_INPUT');
    if (!allowPublicRead(request)) throw new NuniError(429, 'RATE_LIMITED');
    const schoolId = requestedSchoolId(request);
    const catalog = await loadPublicCatalog(schoolId);
    const cafeteria = catalog.cafeterias.find((row) => row.id === cafeteriaId) ?? null;
    return jsonResponse(
      {
        schoolId,
        cafeteria,
        menus: cafeteria ? catalog.menus.filter((row) => row.cafeteriaId === cafeteriaId) : [],
      },
      200,
      'public',
    );
  } catch (error) {
    return errorResponse(error);
  }
}
