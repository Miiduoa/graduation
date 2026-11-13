import type { NextRequest } from 'next/server';
import { NuniError, parseNuniPrincipal } from '@campus/shared/src/nuni';
import {
  platformRequest, publicOrigin, readPlatformAuthorization, requireSameOrigin, requireSession,
  type PlatformSession,
} from '../nuni/server';
import { getFirebaseAdmin } from './firebaseAdmin';

export type TronClassActor = { ownerKey: string; provider: 'platform' | 'firebase' };
type FirebaseAuthRuntime = {
  verifyIdToken(token: string, checkRevoked: boolean): Promise<{ uid: string } & Record<string, unknown>>;
  db: { doc(path: string): { get(): Promise<{ exists: boolean; data(): Record<string, unknown> | undefined }> } };
};
export type TronClassIntegrationAuthDependencies = {
  verifyPlatformSession?: (session: PlatformSession) => Promise<unknown>;
  getAdmin?: () => Promise<FirebaseAuthRuntime | null>;
};

function browserOrigin(request: NextRequest): void {
  // Same-origin browser GET normally has no Origin header. Fetch metadata and the
  // session-view token still bind it to this origin; writes always require Origin.
  if (['GET', 'HEAD'].includes(request.method) && !request.headers.has('origin')) {
    if (request.headers.get('sec-fetch-site') !== 'same-origin' || request.nextUrl.origin !== publicOrigin()) {
      throw new NuniError(403, 'ORIGIN_REJECTED');
    }
    return;
  }
  requireSameOrigin(request);
}

/** Resolve one explicit identity. A bad Authorization header never falls back to a different cookie account. */
export async function authenticateTronClassActor(
  request: NextRequest,
  dependencies: TronClassIntegrationAuthDependencies = {},
): Promise<TronClassActor> {
  const authorization = request.headers.get('authorization');
  const platform = readPlatformAuthorization(request);
  if (authorization !== null && !platform) {
    const match = /^Bearer ([^\s]+)$/.exec(authorization);
    if (!match || match[1].length > 8192) throw new NuniError(401, 'SIGN_IN_REQUIRED');
    const admin = await (dependencies.getAdmin ?? getFirebaseAdmin)();
    if (!admin) throw new NuniError(503, 'TRONCLASS_AUTH_UNAVAILABLE');
    let identity: { uid: string } & Record<string, unknown>;
    try { identity = await admin.verifyIdToken(match[1], true); }
    catch { throw new NuniError(401, 'SIGN_IN_REQUIRED'); }
    const firebase = identity.firebase && typeof identity.firebase === 'object'
      ? identity.firebase as Record<string, unknown> : {};
    if (typeof identity.uid !== 'string' || !/^[^\s/\x00-\x1f\x7f]{1,128}$/.test(identity.uid) ||
      firebase.sign_in_provider === 'anonymous') throw new NuniError(401, 'SIGN_IN_REQUIRED');
    let profile: Record<string, unknown> | undefined;
    try { profile = (await admin.db.doc(`users/${identity.uid}`).get()).data(); }
    catch { throw new NuniError(503, 'TRONCLASS_AUTH_UNAVAILABLE'); }
    if (profile?.accountDeletionInProgress === true || ['deleted', 'disabled', 'suspended', 'inactive'].includes(String(profile?.status))) {
      throw new NuniError(403, 'ACCOUNT_UNAVAILABLE');
    }
    return { ownerKey: `firebase:${identity.uid}`, provider: 'firebase' };
  }
  if (!platform) browserOrigin(request);
  const session = platform ?? requireSession(request);
  try {
    const value = await (dependencies.verifyPlatformSession ?? ((current) => platformRequest('sessions/current', current)))(session);
    const principal = parseNuniPrincipal(value);
    return { ownerKey: `platform:${principal.platformAccountId}`, provider: 'platform' };
  } catch (error) {
    if (error instanceof NuniError && [401, 403, 409].includes(error.status)) throw error;
    throw new NuniError(503, 'TRONCLASS_AUTH_UNAVAILABLE');
  }
}
