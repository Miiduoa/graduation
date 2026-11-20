import { NuniError } from '@campus/shared/src/nuni';
import { apiOrigin, boundedJson, type PlatformSession } from './server';
export async function assistantRequest(
  action: string,
  session: PlatformSession,
  input?: object,
): Promise<unknown> {
  try {
    const response = await fetch(`${apiOrigin()}/v1/auth/platform/assistant/${action}`, {
      method: input ? 'POST' : 'GET',
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(18000),
      headers: {
        Accept: 'application/json',
        Authorization: `Platform ${session.sessionHandle}`,
        ...(input ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(input ? { body: JSON.stringify(input) } : {}),
    });
    const value = await boundedJson(response, 16384);
    if (!response.ok) {
      const error = value && typeof value === 'object' && 'error' in value ? value.error : null;
      const code =
        typeof error === 'string'
          ? error
          : error && typeof error === 'object' && 'code' in error
            ? error.code
            : '';
      throw new NuniError(
        response.status,
        typeof code === 'string' && /^[A-Z_]{1,80}$/.test(code) ? code : 'ASSISTANT_UNAVAILABLE',
      );
    }
    return value;
  } catch (error) {
    if (error instanceof NuniError) throw error;
    throw new NuniError(503, 'ASSISTANT_UNAVAILABLE');
  }
}
