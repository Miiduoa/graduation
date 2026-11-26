import { NuniError, parseNuniPrincipal } from '@campus/shared/src/nuni';
import { createNuniLostFound } from '@campus/shared/src/nuniLostFound';

type Access = {
  accountId: string;
  context: string;
  isCurrent: () => boolean;
  request: (path: string, context: string, input?: Record<string, unknown>) => Promise<unknown>;
};

/** Keeps the native session transport; a feature's availability never creates a school identity. */
export function createPlatformLostFoundClient(access: Access) {
  const assertCurrent = () => {
    if (!access.isCurrent()) throw new NuniError(409, 'SESSION_CHANGED');
  };
  return createNuniLostFound(async (path, input) => {
    assertCurrent();
    try {
      const result = await access.request(path, access.context, input);
      assertCurrent();
      return result;
    } catch (error) {
      assertCurrent();
      if (!(error instanceof NuniError) || error.status !== 401) throw error;

      // Older APIs can send unknown platform routes through the campus guard.
      // The controller already refreshes on 401, but a failed refresh may keep an
      // unexpired session in memory. Prove the same principal with a fresh read
      // before identifying this as an unavailable feature. Never replay a write.
      try {
        const value = await access.request('sessions/current', access.context);
        assertCurrent();
        const principal = parseNuniPrincipal(value);
        if (principal.platformAccountId !== access.accountId) {
          throw new NuniError(502, 'INVALID_RESPONSE');
        }
      } catch (probeError) {
        assertCurrent();
        throw probeError;
      }
      throw new NuniError(503, 'LOST_FOUND_UNAVAILABLE');
    }
  });
}
