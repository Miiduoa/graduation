export const ACCOUNT_API_ORIGIN = 'https://api.nuni.tw';
export const PLATFORM_LOGIN_TRANSACTION_KEY = 'campus.platform-login.transaction';
export const ACCOUNT_LOGIN_TRANSACTION_KEY = 'campus.account-login.transaction';
export const ACCOUNT_EXPIRES_AT_KEY = 'campus.account.expires-at';
export const AUTH_SOURCE_KEY = 'campus.auth.source';

export const CLASS_WORKSPACE_HREF = '/auth/platform/class-workspace/join';

export const SCHOOL_PROVIDER_LABELS: Record<string, string> = {
  'google-workspace': '使用學校 Google 帳號',
  'microsoft-entra': '使用學校 Microsoft 帳號',
  'campus-oidc': '使用學校原有登入',
};

export const DISCOVER_REASON_COPY: Record<string, string> = {
  'invalid-email': '請輸入學校配發的完整信箱。',
  'unknown-school': '目前還找不到這所學校。請改用學校原有入口，或請資訊中心協助。',
  'school-not-open': '這所學校還沒有開放建立帳號。開放的時間要看學校那邊的安排。',
  'school-suspended': '這所學校目前暫停新登入，請聯絡學校資訊中心。',
};

const ALLOWED_RETURN_PATHS = new Set([
  '/',
  '/account-deletion',
  '/admin',
  '/ai-assistant',
  '/announcements',
  '/appeals',
  '/auth/platform',
  '/auth/platform/class-workspace/join',
  '/auth/platform/class-workspace/new',
  '/auth/platform/ops',
  '/auth/platform/school-review',
  '/bus',
  '/bus/registered',
  '/cafeteria',
  '/calendar',
  '/career',
  '/classroom',
  '/classroom/account',
  '/classroom/grades',
  '/clubs',
  '/community',
  '/credit-planner',
  '/dms',
  '/food',
  '/friends',
  '/grades',
  '/groups',
  '/import',
  '/join',
  '/library',
  '/life',
  '/lms-admin',
  '/lost-found',
  '/map',
  '/me',
  '/merchant',
  '/messages',
  '/orders',
  '/privacy',
  '/privacy/deletion-status',
  '/profile',
  '/search',
  '/settings',
  '/shops',
  '/social',
  '/support',
  '/teacher',
  '/terms',
  '/timetable',
  '/today-v2',
]);

const ALLOWED_RETURN_PREFIXES = [
  '/admin/students',
  '/announcements',
  '/auth/platform/class-workspace',
  '/auth/platform/ops',
  '/auth/platform/school-review',
  '/cafeteria',
  '/classroom/course',
  '/community',
  '/course',
  '/dms',
  '/groups',
  '/lms-admin',
  '/lost-found',
  '/teacher/course',
  '/timetable/s',
];

const BLOCKED_RETURN_PATHS = new Set([
  '/login',
  '/admin/login',
  '/classroom/login',
  '/auth/account',
  '/sso-callback',
  '/sso/acs',
]);

const CLASS_WORKSPACE_PATH = /^\/auth\/platform\/class-workspace\/cw_[0-9a-fA-F-]{36}$/u;
const MICROSOFT_HOSTS = new Set([
  'login.microsoftonline.com',
  'login.microsoftonline.us',
  'login.chinacloudapi.cn',
  'login.microsoftonline.de',
]);

export class AccountLoginError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(message: string, status = 0, code = 'ACCOUNT_LOGIN_FAILED') {
    super(message);
    this.name = 'AccountLoginError';
    this.status = status;
    this.code = code;
  }
}

export class PasskeyCeremonyCancelled extends Error {
  constructor() {
    super('passkey ceremony cancelled by the user');
    this.name = 'PasskeyCeremonyCancelled';
  }
}

export type DiscoveredSchool = {
  available: boolean;
  tenantId?: string;
  displayName?: string;
  providerKinds?: string[];
  reason?: string;
};

function trimPath(path: string): string {
  if (!path.startsWith('/') || path.startsWith('//')) return '/';
  const trimmed = path.replace(/\/+$/u, '');
  return trimmed === '' ? '/' : trimmed;
}

export function sanitizeReturnPath(value: string | null | undefined): string {
  const raw = (value ?? '').trim();
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\')) return '/';
  let parsed: URL;
  try {
    parsed = new URL(raw, 'https://nuni.invalid');
  } catch {
    return '/';
  }
  if (
    parsed.origin !== 'https://nuni.invalid' ||
    parsed.username ||
    parsed.password ||
    parsed.hash ||
    `${parsed.pathname}${parsed.search}` !== raw
  ) {
    return '/';
  }
  const normalized = trimPath(parsed.pathname);
  if (BLOCKED_RETURN_PATHS.has(normalized)) return '/';
  if (CLASS_WORKSPACE_PATH.test(normalized) && parsed.search === '') return normalized;
  const allowed =
    normalized === '/' ||
    ALLOWED_RETURN_PATHS.has(normalized) ||
    ALLOWED_RETURN_PREFIXES.some((prefix) => normalized === prefix || normalized.startsWith(`${prefix}/`));
  if (!allowed) return '/';
  return normalized;
}

export function readReturnPath(search: string | { get(name: string): string | null }): string {
  const params =
    typeof search === 'string'
      ? new URLSearchParams(search.startsWith('?') ? search.slice(1) : search)
      : search;
  return sanitizeReturnPath(params.get('returnUrl') ?? params.get('next'));
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/u, '');
}

function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.replace(/-/gu, '+').replace(/_/gu, '/');
  const binary = atob(padded.padEnd(padded.length + ((4 - (padded.length % 4)) % 4), '='));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export async function createPkce(): Promise<{ verifier: string; challenge: string }> {
  const verifier = bytesToBase64Url(crypto.getRandomValues(new Uint8Array(64)));
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return { verifier, challenge: bytesToBase64Url(new Uint8Array(digest)) };
}

export function randomState(): string {
  return bytesToBase64Url(crypto.getRandomValues(new Uint8Array(32)));
}

export function loginErrorMessage(error: unknown, fallback: string): string {
  return error instanceof AccountLoginError && error.message ? error.message : fallback;
}

export function usableSchoolProviders(kinds: readonly string[] | undefined): string[] {
  return (kinds ?? []).filter((kind) => kind !== 'campus-oidc');
}

export function passkeyAvailable(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.PublicKeyCredential === 'function' &&
    typeof navigator !== 'undefined' &&
    typeof navigator.credentials?.create === 'function' &&
    typeof navigator.credentials?.get === 'function'
  );
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  return (await response.json().catch(() => ({}))) as Record<string, unknown>;
}

export async function listPlatformProviderKinds(): Promise<string[]> {
  const response = await fetch('/auth/platform/providers', { cache: 'no-store' });
  if (!response.ok) {
    throw new AccountLoginError('目前無法確認可用的登入方式。', response.status, 'PLATFORM_PROVIDER_UNAVAILABLE');
  }
  const body = await readJson(response);
  if (!Array.isArray(body.kinds)) {
    throw new AccountLoginError('登入服務回傳的可用方式不完整。', 502, 'PLATFORM_PROVIDER_UNAVAILABLE');
  }
  const allowed = new Set(['google-consumer', 'apple']);
  return body.kinds.filter((kind): kind is string => typeof kind === 'string' && allowed.has(kind));
}

export async function startGoogleContinue(returnPath: string): Promise<void> {
  const { verifier, challenge } = await createPkce();
  const response = await fetch('/auth/platform/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ grantType: 'start', kind: 'google-consumer' }),
  });
  const body = await readJson(response);
  if (!response.ok) {
    throw new AccountLoginError(
      typeof body.error === 'string' ? body.error : '目前無法開始登入。',
      response.status,
      'PLATFORM_LOGIN_FAILED',
    );
  }
  if (body.kind !== 'google-consumer' || body.authorizationEndpoint !== 'https://accounts.google.com/o/oauth2/v2/auth') {
    throw new AccountLoginError('這次平台登入已失效，請重新開始。', 401, 'PLATFORM_CALLBACK_INVALID');
  }
  const transaction = {
    ...body,
    state: randomState(),
    codeVerifier: verifier,
    createdAt: Date.now(),
    returnPath: sanitizeReturnPath(returnPath),
  };
  sessionStorage.setItem(PLATFORM_LOGIN_TRANSACTION_KEY, JSON.stringify(transaction));
  const destination = new URL(String(body.authorizationEndpoint));
  destination.search = new URLSearchParams({
    response_type: 'code',
    client_id: String(body.clientId),
    redirect_uri: String(body.redirectUri),
    scope: Array.isArray(body.scopes) ? body.scopes.join(' ') : '',
    state: transaction.state,
    nonce: String(body.nonce),
    code_challenge: challenge,
    code_challenge_method: 'S256',
    prompt: 'select_account',
  }).toString();
  window.location.assign(destination.toString());
}

export async function discoverSchool(email: string): Promise<DiscoveredSchool> {
  let response: Response;
  try {
    response = await fetch(`${ACCOUNT_API_ORIGIN}/v1/auth/account/registration-start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
      cache: 'no-store',
    });
  } catch {
    throw new AccountLoginError('目前連不上校園服務，請稍後再試。', 0, 'NETWORK_UNAVAILABLE');
  }
  const body = await readJson(response);
  if (!response.ok) {
    const error = body.error && typeof body.error === 'object' ? (body.error as Record<string, unknown>) : {};
    throw new AccountLoginError(
      typeof error.message === 'string' ? error.message : '這次登入沒有完成，請重新開始。',
      response.status,
      typeof error.code === 'string' ? error.code : 'ACCOUNT_LOGIN_FAILED',
    );
  }
  return body as DiscoveredSchool;
}

function asSchool(value: unknown): DiscoveredSchool | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  const tenantId = typeof row.tenantId === 'string' ? row.tenantId : undefined;
  const displayName = typeof row.displayName === 'string' ? row.displayName : undefined;
  const providerKinds = Array.isArray(row.providerKinds)
    ? row.providerKinds.filter((kind): kind is string => typeof kind === 'string')
    : undefined;
  const reason = typeof row.reason === 'string' ? row.reason : undefined;
  if (row.available === false) return { available: false, tenantId, displayName, providerKinds, reason };
  if (tenantId) return { available: true, tenantId, displayName, providerKinds, reason };
  return null;
}

export async function searchSchoolsByName(query: string): Promise<DiscoveredSchool[]> {
  let response: Response;
  try {
    response = await fetch('/auth/find-school/search?q=' + encodeURIComponent(query), {
      cache: 'no-store',
    });
  } catch {
    throw new AccountLoginError('目前連不上校園服務，請稍後再試。', 0, 'NETWORK_UNAVAILABLE');
  }
  const body = await readJson(response);
  if (!response.ok) {
    throw new AccountLoginError(
      typeof body.error === 'string' ? body.error : '目前無法確認學校，請稍後再試。',
      response.status,
      'SCHOOL_SEARCH_FAILED',
    );
  }
  // Old route handler GET /auth/find-school/search?q= returns
  // { schools: [{ tenantId, displayName, status }] }; POST is 405.
  const rows = Array.isArray(body.schools) ? body.schools : [];
  return rows.map(asSchool).filter((school): school is DiscoveredSchool => school !== null);
}

export function looksLikeSchoolEmail(value: string): boolean {
  return value.includes('@');
}

function sessionLooksSignedIn(body: Record<string, unknown>): boolean {
  if (body.authenticated === false || body.pendingLogout === true) return false;
  if (body.authenticated === true) return true;
  return typeof body.platformAccountId === 'string' && body.platformAccountId.length > 0;
}

async function readSessionAt(path: string): Promise<boolean> {
  const response = await fetch(path, { cache: 'no-store', credentials: 'same-origin' });
  if (!response.ok) return false;
  return sessionLooksSignedIn(await readJson(response));
}

export async function readExistingSession(): Promise<boolean> {
  try {
    if (await readSessionAt('/api/nuni/session')) return true;
  } catch {
    // School-issued sessions still live on the old /auth/session endpoint.
  }
  try {
    return await readSessionAt('/auth/session');
  } catch {
    return false;
  }
}

function microsoftAuthorizeUrl(issuer: string): string {
  const url = new URL(issuer);
  if (
    url.protocol !== 'https:' ||
    !MICROSOFT_HOSTS.has(url.hostname) ||
    url.search ||
    url.hash ||
    !/^\/[0-9a-f-]{36}\/v2\.0$/i.test(url.pathname)
  ) {
    throw new AccountLoginError('學校登入設定無法驗證，請聯絡資訊中心。', 503, 'ACCOUNT_PROVIDER_INVALID');
  }
  return `${url.origin}${url.pathname.replace(/\/v2\.0$/, '/oauth2/v2.0/authorize')}`;
}

function schoolAuthorizeUrl(transaction: Record<string, unknown>, challenge: string): string {
  let endpoint: string;
  if (transaction.kind === 'google-workspace') {
    if (transaction.issuer !== 'https://accounts.google.com') {
      throw new AccountLoginError('學校登入設定無法驗證，請聯絡資訊中心。', 503, 'ACCOUNT_PROVIDER_INVALID');
    }
    endpoint = 'https://accounts.google.com/o/oauth2/v2/auth';
  } else if (transaction.kind === 'microsoft-entra') {
    endpoint = microsoftAuthorizeUrl(String(transaction.issuer));
  } else {
    throw new AccountLoginError(
      '這所學校的登入入口仍在完成安全設定，請先使用學校原有入口。',
      503,
      'CAMPUS_OIDC_DISCOVERY_REQUIRED',
    );
  }
  const destination = new URL(endpoint);
  destination.search = new URLSearchParams({
    response_type: 'code',
    client_id: String(transaction.clientId),
    redirect_uri: String(transaction.redirectUri),
    scope: Array.isArray(transaction.scopes) ? transaction.scopes.join(' ') : '',
    state: String(transaction.state),
    nonce: String(transaction.nonce),
    code_challenge: challenge,
    code_challenge_method: 'S256',
    prompt: 'select_account',
  }).toString();
  return destination.toString();
}

export async function startSchoolProvider(tenantId: string, kind: string, returnPath: string): Promise<void> {
  if (kind === 'campus-oidc') {
    throw new AccountLoginError(
      '這個登入方式目前尚未開放，請使用學校已核准的入口。',
      503,
      'CAMPUS_OIDC_DISCOVERY_REQUIRED',
    );
  }
  const { verifier, challenge } = await createPkce();
  const response = await fetch('/auth/account/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ grantType: 'start', tenantId, kind }),
  });
  const body = await readJson(response);
  if (!response.ok) {
    throw new AccountLoginError(
      typeof body.error === 'string' ? body.error : '這次登入沒有完成，請重新開始。',
      response.status,
      'ACCOUNT_LOGIN_FAILED',
    );
  }
  const transaction = {
    ...body,
    state: randomState(),
    codeVerifier: verifier,
    redirectUri: `${window.location.origin}/auth/account/callback`,
    createdAt: Date.now(),
    returnPath: sanitizeReturnPath(returnPath),
  };
  sessionStorage.setItem(ACCOUNT_LOGIN_TRANSACTION_KEY, JSON.stringify(transaction));
  window.location.assign(schoolAuthorizeUrl(transaction, challenge));
}

async function accountToken(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const response = await fetch('/auth/account/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    cache: 'no-store',
  });
  const payload = await readJson(response);
  if (!response.ok) {
    throw new AccountLoginError(
      typeof payload.error === 'string' ? payload.error : '這次登入沒有完成，請再試一次。',
      response.status,
      'ACCOUNT_PASSKEY_LOGIN_FAILED',
    );
  }
  return payload;
}

function rememberAccountSession(expiresIn: unknown): void {
  if (!Number.isFinite(expiresIn) || Number(expiresIn) <= 0) {
    throw new AccountLoginError('這次登入已失效，請重新開始。', 401, 'ACCOUNT_CALLBACK_INVALID');
  }
  sessionStorage.removeItem('campus.oidc.transaction');
  sessionStorage.removeItem('campus.oidc.access-token');
  sessionStorage.removeItem('campus.oidc.id-token');
  sessionStorage.removeItem('campus.oidc.expires-at');
  sessionStorage.removeItem('campus.account.access-token');
  sessionStorage.setItem(ACCOUNT_EXPIRES_AT_KEY, String(Date.now() + Number(expiresIn) * 1000));
  sessionStorage.setItem(AUTH_SOURCE_KEY, 'campus-account');
}

async function passkeyAssertion(challenge: Record<string, unknown>): Promise<{
  credentialId: string;
  clientDataJson: string;
  authenticatorData: string;
  signature: string;
}> {
  const publicKey = challenge.publicKey as Record<string, unknown> | undefined;
  if (!publicKey) throw new AccountLoginError('這次登入沒有完成，請再試一次。', 502, 'ACCOUNT_PASSKEY_LOGIN_FAILED');
  let credential: Credential | null;
  try {
    credential = await navigator.credentials.get({
      publicKey: {
        challenge: base64UrlToBytes(String(publicKey.challenge)),
        rpId: typeof publicKey.rpId === 'string' ? publicKey.rpId : undefined,
        timeout: typeof publicKey.timeout === 'number' ? publicKey.timeout : undefined,
        userVerification: publicKey.userVerification as UserVerificationRequirement | undefined,
      },
    });
  } catch (error) {
    if (error instanceof DOMException && (error.name === 'NotAllowedError' || error.name === 'AbortError')) {
      throw new PasskeyCeremonyCancelled();
    }
    throw error;
  }
  if (!(credential instanceof PublicKeyCredential) || !(credential.response instanceof AuthenticatorAssertionResponse)) {
    throw new Error('passkey assertion returned no signature');
  }
  const response = credential.response;
  return {
    credentialId: credential.id,
    clientDataJson: bytesToBase64Url(new Uint8Array(response.clientDataJSON)),
    authenticatorData: bytesToBase64Url(new Uint8Array(response.authenticatorData)),
    signature: bytesToBase64Url(new Uint8Array(response.signature)),
  };
}

async function finishSignedIn(returnPath: string): Promise<void> {
  const href = sanitizeReturnPath(returnPath);
  let role = 'student';
  try {
    const response = await fetch('/auth/platform/session', { cache: 'no-store' });
    const session = response.ok ? await readJson(response) : null;
    if (session?.hasSchoolIssuedRole === true) {
      await fetch('/auth/platform/school-issued-session', { method: 'POST', cache: 'no-store' }).catch(() => undefined);
    }
    if (session?.hasApprovedMerchant === true && session?.hasSchoolIssuedRole !== true) role = 'merchant';
    else if (session?.hasSchoolIssuedRole === true) role = 'teacher';
  } catch {
    role = 'student';
  }
  const form = new FormData();
  form.set('role', role);
  form.set('returnUrl', href);
  try {
    await fetch('/auth/shell-role', { method: 'POST', body: form, redirect: 'manual' });
  } catch {
    /* keep the destination even if the shell cookie cannot be written */
  }
  window.location.replace(href);
}

export async function signInWithPasskey(tenantId: string, returnPath: string): Promise<void> {
  const challenge = await accountToken({ grantType: 'passkey-challenge', tenantId });
  const assertion = await passkeyAssertion(challenge);
  const result = await accountToken({
    grantType: 'passkey',
    tenantId,
    challengeId: challenge.challengeId,
    credentialId: assertion.credentialId,
    clientDataJson: assertion.clientDataJson,
    authenticatorData: assertion.authenticatorData,
    signature: assertion.signature,
  });
  rememberAccountSession(result.expiresIn);
  await finishSignedIn(returnPath);
}
