// Dedicated account-link flow. Never route it through ordinary sign-in or change SESSION_COOKIE.
import { createHash, randomBytes } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { NuniError, nuniRecord } from '@campus/shared/src/nuni';
import {
  apiOrigin, boundedBytes, equalSecret, fetchJson, jsonResponse, nuniEnabled,
  openCookie, publicOrigin, readSession, requireSameOrigin, sessionContext, setCookie,
  type PlatformSession,
} from './server';

const GOOGLE_AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN = 'https://oauth2.googleapis.com/token';
const GOOGLE_ISSUER = 'https://accounts.google.com';
export const GOOGLE_LINK_PAGE = '/auth/platform/link/google';
export const GOOGLE_LINK_COOKIE =
  process.env.NODE_ENV === 'production' ? '__Host-campus-google-link' : 'campus-google-link';
const TOKEN = /^[A-Za-z0-9_-]{43}$/u;
const TRANSACTION = /^gl_[A-Za-z0-9_-]{43}$/u;
const CLIENT_ID = /^[A-Za-z0-9._-]{1,240}\.apps\.googleusercontent\.com$/u;
const ACCOUNT_ID = /^pa_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
type Outcome = 'acknowledged' | 'cancelled' | 'unknown' | 'reauth' | 'conflict' | 'unavailable' | 'invalid';
type LinkTransaction = {
  transactionId: string; nonce: string; clientId: string; state: string;
  verifier: string; context: string; callback: string; expiresAt: number;
};

// Read access remains available when the provider cannot accept new linking requests.
export function googleAccountManagementEnabled(): boolean {
  return nuniEnabled() && process.env.NUNI_GOOGLE_ACCOUNT_LINK_ENABLED === 'true';
}

// Separate, default-off server flag. The candidate API and approved OAuth redirect must also be ready.
export function googleAccountLinkEnabled(): boolean {
  return googleAccountManagementEnabled() &&
    process.env.PLATFORM_GOOGLE_LOGIN_ENABLED === 'true' &&
    !!process.env.PLATFORM_GOOGLE_CLIENT_SECRET?.trim();
}

function result(outcome: Outcome): NextResponse {
  const response = NextResponse.redirect(new URL(GOOGLE_LINK_PAGE + '?result=' + outcome, publicOrigin()), 303);
  response.headers.set('Cache-Control', 'private, no-store');
  response.headers.set('Referrer-Policy', 'no-referrer');
  // Never clear or set the platform session, ordinary login cookie, or another tab's link cookie.
  return response;
}
function failure(error: unknown): NextResponse {
  try {
    if (error instanceof NuniError) {
      if (error.code === 'ORIGIN_REJECTED') return jsonResponse({ error: 'ORIGIN_REJECTED' }, 403);
      if (error.code === 'GOOGLE_LINK_CONFLICT') return result('conflict');
      if (error.status === 401 || error.code === 'SESSION_CHANGED') return result('reauth');
      if (error.status === 400 || error.status === 413 || error.status === 422) return result('invalid');
    }
    // A write may have committed before its response was lost. No automatic replay.
    return result('unknown');
  } catch {
    return jsonResponse({ error: 'GOOGLE_LINK_UNAVAILABLE' }, 503);
  }
}
function callbackUrl(): string { return publicOrigin() + GOOGLE_LINK_PAGE + '/callback'; }
function hasPattern(value: unknown, pattern: RegExp): value is string {
  return typeof value === 'string' && pattern.test(value);
}
function currentSession(request: NextRequest): PlatformSession {
  const session = readSession(request);
  if (!session || session.pendingLogout) throw new NuniError(401, 'SIGN_IN_REQUIRED');
  return session;
}
function linkRequest(action: 'start' | 'complete' | 'cancel', session: PlatformSession, input: Record<string, unknown>) {
  // Only this link operation opts out of wake retry. A timeout is an unknown result, not permission to repeat.
  return fetchJson(apiOrigin() + '/v1/auth/platform/account-links/google/' + action, {
    method: 'POST',
    headers: { Accept: 'application/json', Authorization: 'Platform ' + session.sessionHandle, 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  }, 32 * 1024, { retry: false });
}

export async function startGoogleLink(request: NextRequest): Promise<NextResponse> {
  if (!googleAccountManagementEnabled()) return jsonResponse({ error: 'GOOGLE_LINK_UNAVAILABLE' }, 404);
  try {
    requireSameOrigin(request);
    if (request.nextUrl.search || request.headers.get('content-type')?.split(';')[0]?.trim() !== 'application/x-www-form-urlencoded')
      throw new NuniError(400, 'INVALID_INPUT');
    const session = currentSession(request);
    const form = new URLSearchParams((await boundedBytes(request, 4096)).toString('utf8'));
    if ([...form.keys()].sort().join(',') !== 'confirm,context' || form.get('confirm') !== 'link-google')
      throw new NuniError(400, 'INVALID_INPUT');
    const context = sessionContext(session);
    if (!equalSecret(form.get('context'), context)) throw new NuniError(409, 'SESSION_CHANGED');
    if (!googleAccountLinkEnabled()) return result('unavailable');

    const startedAt = Date.now();
    const tx = nuniRecord(await linkRequest('start', session, {}));
    if (!hasPattern(tx.transactionId, TRANSACTION) || !hasPattern(tx.nonce, TOKEN) ||
        !hasPattern(tx.clientId, CLIENT_ID) || tx.issuer !== GOOGLE_ISSUER ||
        tx.authorizationEndpoint !== GOOGLE_AUTH || tx.tokenEndpoint !== GOOGLE_TOKEN ||
        typeof tx.expiresInSeconds !== 'number' || !Number.isSafeInteger(tx.expiresInSeconds) ||
        tx.expiresInSeconds < 1 || tx.expiresInSeconds > 300)
      throw new NuniError(502, 'INVALID_RESPONSE');

    const expiresAt = Math.min(startedAt + tx.expiresInSeconds * 1000, session.expiresAt);
    if (expiresAt <= Date.now()) return result('reauth');
    const state = randomBytes(32).toString('base64url');
    const verifier = randomBytes(32).toString('base64url');
    const callback = callbackUrl();
    const pending: LinkTransaction = {
      transactionId: tx.transactionId, nonce: tx.nonce, clientId: tx.clientId,
      context, state, verifier, callback, expiresAt,
    };
    const url = new URL(GOOGLE_AUTH);
    url.search = new URLSearchParams({
      client_id: pending.clientId, redirect_uri: callback, response_type: 'code',
      scope: 'openid email profile', state, nonce: pending.nonce,
      code_challenge: createHash('sha256').update(verifier).digest('base64url'),
      code_challenge_method: 'S256', prompt: 'select_account',
    }).toString();
    const response = result('unknown');
    response.headers.set('Location', url.href);
    setCookie(response, GOOGLE_LINK_COOKIE, pending, expiresAt);
    return response;
  } catch (error) { return failure(error); }
}

function readTransaction(request: NextRequest, session: PlatformSession): LinkTransaction | null {
  const tx = openCookie(GOOGLE_LINK_COOKIE, request.cookies.get(GOOGLE_LINK_COOKIE)?.value);
  if (!tx || !hasPattern(tx.transactionId, TRANSACTION) || !hasPattern(tx.nonce, TOKEN) ||
      !hasPattern(tx.state, TOKEN) || !hasPattern(tx.verifier, TOKEN) || !hasPattern(tx.clientId, CLIENT_ID) ||
      !hasPattern(tx.context, TOKEN) || !equalSecret(tx.context, sessionContext(session)) ||
      tx.callback !== callbackUrl() || typeof tx.expiresAt !== 'number' || !Number.isSafeInteger(tx.expiresAt) ||
      tx.expiresAt <= Date.now() || tx.expiresAt > Date.now() + 300_000) return null;
  return {
    transactionId: tx.transactionId, nonce: tx.nonce, clientId: tx.clientId, state: tx.state,
    verifier: tx.verifier, context: tx.context, callback: callbackUrl(), expiresAt: tx.expiresAt,
  };
}

export async function finishGoogleLink(request: NextRequest): Promise<NextResponse> {
  if (!googleAccountManagementEnabled()) return jsonResponse({ error: 'GOOGLE_LINK_UNAVAILABLE' }, 404);
  try {
    const session = currentSession(request);
    const tx = readTransaction(request, session);
    const query = request.nextUrl.searchParams;
    if (!tx || query.getAll('state').length !== 1 || !equalSecret(query.get('state'), tx.state))
      return result('invalid');
    // The account-management read stays available if new linking was paused during OAuth.
    if (!googleAccountLinkEnabled()) return result('unavailable');
    // A stale or mismatched callback cannot delete a newer cookie or cancel a different transaction.
    const linkInput = { transactionId: tx.transactionId, nonce: tx.nonce };
    if (query.has('error')) {
      if (query.getAll('error').length !== 1 || query.get('error') !== 'access_denied' || query.has('code'))
        return result('invalid');
      const cancelled = nuniRecord(await linkRequest('cancel', session, linkInput));
      // not-pending can mean completed, expired, or already cancelled; do not guess.
      return result(cancelled.status === 'cancelled' ? 'cancelled' : 'unknown');
    }
    const code = query.get('code');
    if (query.getAll('code').length !== 1 || !code || code.length > 4000)
      return result('invalid');
    const token = nuniRecord(await fetchJson(GOOGLE_TOKEN, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code', code, client_id: tx.clientId,
        redirect_uri: tx.callback, code_verifier: tx.verifier,
        client_secret: process.env.PLATFORM_GOOGLE_CLIENT_SECRET!.trim(),
      }).toString(),
    }, 32 * 1024, { retry: false }));
    if (typeof token.id_token !== 'string' || token.id_token.length < 32 || token.id_token.length > 16384)
      throw new NuniError(502, 'INVALID_RESPONSE');
    if (tx.expiresAt <= Date.now() || session.expiresAt <= Date.now()) return result('reauth');
    const completed = nuniRecord(await linkRequest('complete', session, { ...linkInput, idToken: token.id_token }));
    if ((completed.status !== 'linked' && completed.status !== 'already-linked') ||
        !hasPattern(completed.platformAccountId, ACCOUNT_ID)) return result('unknown');
    // The page treats result as non-authoritative navigation copy, not a credential inventory.
    return result('acknowledged');
  } catch (error) { return failure(error); }
}
