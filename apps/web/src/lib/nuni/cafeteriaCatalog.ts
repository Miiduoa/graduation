import { NextRequest } from 'next/server';
import { NuniError } from '@campus/shared/src/nuni';
import {
  parseCafeteriaLocations,
  parseCafeteriaMenu,
  type CafeteriaCatalogMenuItem,
  type CafeteriaCatalogRecord,
} from '@campus/shared/src/cafeteriaCatalog';
import {
  errorResponse,
  fetchJson,
  jsonResponse,
  platformRequest,
  readSession,
  apiOrigin,
} from './server';

const TENANT = /^[a-z0-9][a-z0-9-]{0,78}[a-z0-9]$/;
const LOCATION = /^[A-Za-z0-9_-]{1,100}$/;

function schoolIdOf(request: NextRequest): string {
  const value = request.nextUrl.searchParams.get('schoolId') || '';
  if (!TENANT.test(value)) throw new NuniError(400, 'INVALID_INPUT');
  return value;
}

async function loadLocations(schoolId: string, request: NextRequest) {
  const session = readSession(request);
  const path = `realms/${schoolId}/food/locations`;
  const value = session
    ? await platformRequest(path, session)
    : await fetchJson(`${apiOrigin()}/v1/auth/platform/${path}`, {
        headers: { Accept: 'application/json' },
      });
  return parseCafeteriaLocations(value, schoolId);
}

async function loadMenu(
  schoolId: string,
  cafeteria: CafeteriaCatalogRecord,
  request: NextRequest,
): Promise<CafeteriaCatalogMenuItem[]> {
  const session = readSession(request);
  const path = `realms/${schoolId}/food/locations/${cafeteria.id}/menu`;
  try {
    const value = session
      ? await platformRequest(path, session)
      : await fetchJson(`${apiOrigin()}/v1/auth/platform/${path}`, {
          headers: { Accept: 'application/json' },
        });
    return parseCafeteriaMenu(value, schoolId, cafeteria.id, cafeteria.name);
  } catch {
    return [];
  }
}

export async function handleCafeteriaCatalog(request: NextRequest) {
  try {
    if (request.method !== 'GET') throw new NuniError(405, 'METHOD_NOT_ALLOWED');
    const schoolId = schoolIdOf(request);
    const extra = [...request.nextUrl.searchParams.keys()].filter((key) => key !== 'schoolId');
    if (extra.length) throw new NuniError(400, 'INVALID_INPUT');
    const locations = await loadLocations(schoolId, request);
    const menus = (
      await Promise.all(locations.slice(0, 40).map((row) => loadMenu(schoolId, row, request)))
    ).flat();
    return jsonResponse({ schoolId, cafeterias: locations, menus });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function handleCafeteriaDetail(request: NextRequest, cafeteriaId: string) {
  try {
    if (request.method !== 'GET') throw new NuniError(405, 'METHOD_NOT_ALLOWED');
    if (!LOCATION.test(cafeteriaId)) throw new NuniError(400, 'INVALID_INPUT');
    const schoolId = schoolIdOf(request);
    const extra = [...request.nextUrl.searchParams.keys()].filter((key) => key !== 'schoolId');
    if (extra.length) throw new NuniError(400, 'INVALID_INPUT');
    const locations = await loadLocations(schoolId, request);
    const cafeteria = locations.find((row) => row.id === cafeteriaId) ?? null;
    if (!cafeteria) return jsonResponse({ schoolId, cafeteria: null, menus: [] });
    return jsonResponse({
      schoolId,
      cafeteria,
      menus: await loadMenu(schoolId, cafeteria, request),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
