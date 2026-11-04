import type { NextRequest } from 'next/server';
import { NuniError } from '@campus/shared/src/nuni';
import { boundedJson, jsonResponse, requireSameOrigin, requireSession } from './server';
import { assistantInput, projectAssistant } from './assistantContracts';
import { assistantRequest } from './assistantTransport';
export async function handleAssistant(request: NextRequest, segments: string[]) {
  if (process.env.CAMPUS_ASSISTANT_ENABLED !== 'true') throw new NuniError(404, 'NOT_FOUND');
  const action = segments[1];
  if (
    segments.length !== 2 ||
    !['capability', 'preview', 'ask', 'route', 'execute', 'enqueue'].includes(action)
  )
    throw new NuniError(404, 'NOT_FOUND');
  if (request.method !== (action === 'capability' ? 'GET' : 'POST'))
    throw new NuniError(405, 'METHOD_NOT_ALLOWED');
  if (request.nextUrl.search) throw new NuniError(400, 'INVALID_INPUT');
  if (request.method !== 'GET') requireSameOrigin(request);
  const session = requireSession(request);
  if (action === 'execute' || action === 'enqueue')
    throw new NuniError(403, 'ASSISTANT_WRITE_UNAVAILABLE');
  const input =
    action === 'capability' ? undefined : assistantInput(action, await boundedJson(request, 8192));
  const value = projectAssistant(action, await assistantRequest(action, session, input));
  if (input && (value.schoolId !== input.schoolId || value.intent !== input.intent))
    throw new NuniError(502, 'INVALID_RESPONSE');
  return jsonResponse(value);
}
