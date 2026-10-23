import { NextRequest, NextResponse } from 'next/server';
import { isCampusOneCallback, legacyCallbackUrl, legacyEnabled } from './lib/legacy-routing';
import { LOGIN_COOKIE, openCookie } from './lib/nuni/server';

export function proxy(request: NextRequest) {
  if (!legacyEnabled()) return NextResponse.next();
  let transaction: Record<string, unknown> | null = null;
  try {
    transaction = openCookie(LOGIN_COOKIE, request.cookies.get(LOGIN_COOKIE)?.value);
  } catch {
    // Keep configuration failures with the new handler; it reports them without
    // treating an unverifiable transaction as an authenticated session.
    return NextResponse.next();
  }
  if (isCampusOneCallback(request.nextUrl.searchParams.get('state'), transaction)) {
    return NextResponse.next();
  }
  return NextResponse.rewrite(legacyCallbackUrl(request.nextUrl.search));
}

export const config = { matcher: ['/auth/platform/callback'] };
