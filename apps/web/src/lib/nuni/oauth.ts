import { createHash, randomBytes } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { NuniError, nuniRecord } from '@campus/shared/src/nuni';
import {
  HANDLE,
  LOGIN_COOKIE,
  SESSION_COOKIE,
  equalSecret,
  errorResponse,
  fetchJson,
  nuniEnabled,
  openCookie,
  platformRequest,
  publicOrigin,
  readSession,
  requireSameOrigin,
  revokeSession,
  setCookie,
} from './server';

const GOOGLE_AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN = 'https://oauth2.googleapis.com/token';

function enabled(): void {
  if (
    !nuniEnabled() ||
    process.env.PLATFORM_GOOGLE_LOGIN_ENABLED !== 'true' ||
    !process.env.PLATFORM_GOOGLE_CLIENT_SECRET?.trim()
  ) {
    throw new NuniError(503, 'SIGN_IN_UNAVAILABLE');
  }
}

function redirect(path: string): NextResponse {
  const response = NextResponse.redirect(new URL(path, publicOrigin()), 303);
  response.headers.set('Cache-Control', 'no-store');
  response.headers.set('Referrer-Policy', 'no-referrer');
  return response;
}

export async function startGoogle(request: NextRequest): Promise<NextResponse> {
  try {
    enabled();
    requireSameOrigin(request);
    // Account changes must finish revoking the previous handle before another login starts.
    const previous = readSession(request);
    if (previous) {
      try {
        await revokeSession(previous);
      } catch (error) {
        const response = errorResponse(error);
        setCookie(
          response,
          SESSION_COOKIE,
          { ...previous, pendingLogout: true },
          previous.expiresAt,
        );
        return response;
      }
    }
    const tx = nuniRecord(
      await platformRequest('login-transactions', undefined, { kind: 'google-consumer' }),
    );
    if (
      tx.kind !== 'google-consumer' ||
      typeof tx.transactionId !== 'string' ||
      !/^pt_[A-Za-z0-9_-]{43}$/.test(tx.transactionId) ||
      typeof tx.nonce !== 'string' ||
      !/^[A-Za-z0-9_-]{43}$/.test(tx.nonce) ||
      typeof tx.clientId !== 'string' ||
      !/^[A-Za-z0-9._-]{1,240}\.apps\.googleusercontent\.com$/.test(tx.clientId) ||
      tx.issuer !== 'https://accounts.google.com' ||
      tx.authorizationEndpoint !== GOOGLE_AUTH ||
      tx.tokenEndpoint !== GOOGLE_TOKEN ||
      typeof tx.expiresInSeconds !== 'number' ||
      !Number.isInteger(tx.expiresInSeconds) ||
      tx.expiresInSeconds < 1 ||
      tx.expiresInSeconds > 600
    ) {
      throw new NuniError(502, 'INVALID_RESPONSE');
    }
    const state = randomBytes(32).toString('base64url');
    const verifier = randomBytes(32).toString('base64url');
    const expiresAt = Date.now() + tx.expiresInSeconds * 1000;
    const callback = `${publicOrigin()}/auth/platform/callback`;
    const url = new URL(GOOGLE_AUTH);
    url.search = new URLSearchParams({
      client_id: tx.clientId,
      redirect_uri: callback,
      response_type: 'code',
      scope: 'openid email profile',
      state,
      nonce: tx.nonce,
      code_challenge: createHash('sha256').update(verifier).digest('base64url'),
      code_challenge_method: 'S256',
      prompt: 'select_account',
    }).toString();
    const response = redirect('/classroom/login');
    response.headers.set('Location', url.href);
    setCookie(response, SESSION_COOKIE, null);
    setCookie(
      response,
      LOGIN_COOKIE,
      {
        transactionId: tx.transactionId,
        nonce: tx.nonce,
        clientId: tx.clientId,
        state,
        verifier,
        callback,
        expiresAt,
      },
      expiresAt,
    );
    return response;
  } catch {
    try {
      return redirect('/classroom/login?issue=unavailable');
    } catch (error) {
      return errorResponse(error);
    }
  }
}

export async function finishGoogle(request: NextRequest): Promise<NextResponse> {
  try {
    enabled();
    const tx = openCookie(LOGIN_COOKIE, request.cookies.get(LOGIN_COOKIE)?.value);
    const params = request.nextUrl.searchParams;
    if (
      !tx ||
      typeof tx.expiresAt !== 'number' ||
      tx.expiresAt <= Date.now() ||
      tx.expiresAt > Date.now() + 600_000 ||
      typeof tx.state !== 'string' ||
      !equalSecret(params.get('state'), tx.state) ||
      params.getAll('state').length !== 1 ||
      params.getAll('code').length !== 1 ||
      params.has('error') ||
      !params.get('code') ||
      params.get('code')!.length > 4000 ||
      typeof tx.verifier !== 'string' ||
      !/^[A-Za-z0-9_-]{43}$/.test(tx.verifier) ||
      typeof tx.clientId !== 'string' ||
      typeof tx.transactionId !== 'string' ||
      typeof tx.nonce !== 'string' ||
      tx.callback !== `${publicOrigin()}/auth/platform/callback`
    )
      throw new NuniError(400, 'LOGIN_EXPIRED');
    // A login completed in another tab must not silently replace its active account.
    if (readSession(request)) throw new NuniError(409, 'SESSION_CHANGED');
    const token = nuniRecord(
      await fetchJson(GOOGLE_TOKEN, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code: params.get('code')!,
          client_id: tx.clientId,
          redirect_uri: tx.callback,
          code_verifier: tx.verifier,
          client_secret: process.env.PLATFORM_GOOGLE_CLIENT_SECRET!.trim(),
        }).toString(),
      }),
    );
    if (typeof token.id_token !== 'string' || token.id_token.length > 16384)
      throw new NuniError(502, 'INVALID_RESPONSE');
    const result = nuniRecord(
      await platformRequest('sessions', undefined, {
        kind: 'google-consumer',
        transactionId: tx.transactionId,
        nonce: tx.nonce,
        idToken: token.id_token,
      }),
    );
    if (
      typeof result.sessionHandle !== 'string' ||
      !HANDLE.test(result.sessionHandle) ||
      typeof result.expiresInSeconds !== 'number' ||
      !Number.isInteger(result.expiresInSeconds) ||
      result.expiresInSeconds < 1 ||
      result.expiresInSeconds > 86400
    )
      throw new NuniError(502, 'INVALID_RESPONSE');
    const session = {
      sessionHandle: result.sessionHandle,
      expiresAt: Date.now() + result.expiresInSeconds * 1000,
    };
    const response = redirect('/classroom');
    setCookie(response, SESSION_COOKIE, session, session.expiresAt);
    setCookie(response, LOGIN_COOKIE, null);
    return response;
  } catch {
    try {
      const response = redirect('/classroom/login?issue=expired');
      setCookie(response, LOGIN_COOKIE, null);
      return response;
    } catch (error) {
      return errorResponse(error);
    }
  }
}
