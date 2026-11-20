import type { NextRequest } from 'next/server';
import { NuniError } from '@campus/shared/src/nuni';
import { PERSONAL_IMPORT_SYNC_BODY_LIMIT, parsePersonalImportSnapshot, validatePersonalImportSyncRecords } from '@campus/shared/src/imports/sync';
import { apiOrigin, boundedJson, errorResponse, fetchJson, jsonResponse, requireSameOrigin, requireSession } from './server';

export async function handlePersonalImportSync(request: NextRequest, action: 'read' | 'write') {
  try {
    if (request.method !== 'POST') throw new NuniError(405, 'METHOD_NOT_ALLOWED');
    if (request.nextUrl.search) throw new NuniError(400, 'INVALID_INPUT');
    requireSameOrigin(request);
    const session = requireSession(request);
    const raw = await boundedJson(request, PERSONAL_IMPORT_SYNC_BODY_LIMIT);
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new NuniError(422, 'INVALID_INPUT');
    const input = raw as Record<string, unknown>;
    const fields = action === 'read' ? ['schoolId'] : ['schoolId', 'expectedRevision', 'records', 'mutationId'];
    if (Object.keys(input).length !== fields.length || Object.keys(input).some((key) => !fields.includes(key)) ||
      typeof input.schoolId !== 'string' || !/^[a-z0-9][a-z0-9-]{0,79}$/.test(input.schoolId) || input.schoolId === 'personal')
      throw new NuniError(422, 'INVALID_INPUT');
    if (action === 'write') {
      if (!Number.isSafeInteger(input.expectedRevision) || (input.expectedRevision as number) < 0 ||
        typeof input.mutationId !== 'string' || !/^[A-Za-z0-9_-]{8,100}$/.test(input.mutationId)) throw new NuniError(422, 'INVALID_INPUT');
      try { input.records = validatePersonalImportSyncRecords(input.records, input.schoolId); }
      catch { throw new NuniError(422, 'PERSONAL_IMPORT_INVALID_INPUT'); }
    }
    const value = await fetchJson(`${apiOrigin()}/v1/auth/platform/personal-imports/${action}`, {
      method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: `Platform ${session.sessionHandle}` },
      body: JSON.stringify(input),
    }, PERSONAL_IMPORT_SYNC_BODY_LIMIT);
    return jsonResponse(parsePersonalImportSnapshot(value, input.schoolId));
  } catch (error) { return errorResponse(error); }
}
