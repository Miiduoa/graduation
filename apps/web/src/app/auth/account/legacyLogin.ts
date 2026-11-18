import { mockSchools, normalizeSchoolQuery, searchSchools } from '@campus/shared/src/schools';
import { classroomLoginHref, CREATE_PATH, JOIN_PATH } from '@/features/platform/constants';
import { collapseInternalPathHash, loginHref, sanitizeInternalPath } from '@/lib/navigation';
import { SERVICE_JOURNEY_GROUPS } from '@/lib/serviceJourneys';

export const ACCOUNT_API_ORIGIN = 'https://api.nuni.tw';
export const PLATFORM_LOGIN_TRANSACTION_KEY = 'campus.platform-login.transaction';
export const ACCOUNT_LOGIN_TRANSACTION_KEY = 'campus.account-login.transaction';
export const ACCOUNT_EXPIRES_AT_KEY = 'campus.account.expires-at';
export const AUTH_SOURCE_KEY = 'campus.auth.source';

const SCHOOL_CALLBACK_PATH = '/auth/account/callback';

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
  '/account-deletion/status',
  '/admin',
  '/ai-assistant',
  '/announcements',
  '/appeals',
  '/auth/platform',
  '/auth/platform/class-workspace/join',
  '/auth/platform/class-workspace/new',
  '/auth/platform/ops',
  '/auth/platform/school-review',
  '/admin/ops',
  '/admin/school-review',
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
  '/connect',
  '/credit-planner',
  '/dms',
  '/events',
  '/food',
  '/friends',
  '/grades',
  '/groups',
  '/import',
  '/library',
  '/life',
  '/lms-admin',
  '/lost-found',
  '/map',
  '/me',
  '/merchant',
  '/merchant/apply',
  '/merchant/workspace',
  '/messages',
  '/orders',
  '/privacy',
  '/privacy/deletion-status',
  '/profile',
  '/search',
  '/school-info',
  '/school/account',
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
  '/admin/ops',
  '/admin/school-review',
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
  '/join',
  '/admin/login',
  '/classroom/login',
  '/auth/account',
  '/sso-callback',
  '/sso/acs',
]);

// Only page state travels through login; credentials and nested return URLs do not.
const RETURN_CONTEXT_KEYS = new Set([
  'school',
  'schoolId',
  'campus',
  'tab',
  'section',
  'source',
  'q',
  'category',
  'week',
  'view',
  'semester',
  'courseId',
  'groupId',
  'boardId',
  'poiId',
  'create',
  'kind',
]);

// These simple destinations are also understood by the retained login callbacks.
const LEGACY_SIMPLE_RETURN_PATHS = new Set([
  '/',
  '/account-deletion',
  '/calendar',
  '/career',
  '/connect',
  '/food',
  '/life',
  '/search',
  '/social',
]);

function isServiceListPath(pathname: string): boolean {
  return ['announcements', 'events', 'lost-found'].includes(pathname.split('/')[1]);
}

function isServiceListContext(pathname: string, key: string, value: string): boolean {
  const service = pathname.split('/')[1];
  if (!isServiceListPath(pathname)) return false;
  if (key === 'page') return /^(?:[1-9]\d?|100)$/.test(value);
  if (service === 'announcements' && key === 'pinned') return value === '1';
  if (service === 'lost-found') {
    if (key === 'mine') return value === '1';
    if (key === 'type') return value === 'lost' || value === 'found';
    if (key === 'status') return value === 'open' || value === 'resolved';
  }
  return false;
}
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

function hasUnsafeReturnCharacters(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 31 || code === 92 || code === 127) return true;
  }
  return false;
}

function returnFragment(hash: string): string {
  try {
    // A fragment may identify page content, never carry another URL or auth payload.
    const anchor = collapseInternalPathHash(hash);
    return /^[\p{L}\p{N}_.:-]+$/u.test(decodeURIComponent(anchor.slice(1))) ? anchor : '';
  } catch {
    return '';
  }
}

function allowedReturnPath(value: string | null | undefined): string | null {
  const raw = sanitizeInternalPath(value && value.length <= 4096 ? value : null, '');
  if (!raw) return null;
  let parsed: URL;
  try {
    parsed = new URL(raw, 'https://nuni.invalid');
  } catch {
    return null;
  }
  if (
    parsed.origin !== 'https://nuni.invalid' ||
    parsed.username ||
    parsed.password ||
    `${parsed.pathname}${parsed.search}${parsed.hash}` !== raw ||
    /%(?:2f|5c|0[0-9a-f]|1[0-9a-f]|7f)/i.test(parsed.pathname)
  ) {
    return null;
  }
  const normalized = trimPath(parsed.pathname);
  // Up to 200 Chinese search characters can exceed 1,200 bytes after URL encoding.
  // Keep the original bound for every other destination.
  if ((value?.length ?? 0) > 1200 && !isServiceListPath(normalized)) return null;
  if (BLOCKED_RETURN_PATHS.has(normalized)) return null;
  if (normalized === '/admin/ops') {
    const tabs = new Set(['schools', 'people', 'merchants', 'affiliation', 'audit']);
    const queryTabs = parsed.searchParams.getAll('tab');
    const hashTab = parsed.hash.slice(1);
    if (queryTabs.length > 1 || queryTabs.some((tab) => !tabs.has(tab)) ||
      (parsed.hash && !tabs.has(hashTab)) ||
      (queryTabs[0] && hashTab && queryTabs[0] !== hashTab)) return null;
  }
  const allowed =
    normalized === '/' ||
    ALLOWED_RETURN_PATHS.has(normalized) ||
    /^\/events\/[^/]+$/u.test(normalized) ||
    ALLOWED_RETURN_PREFIXES.some((prefix) => normalized === prefix || normalized.startsWith(`${prefix}/`));
  if (!allowed) return null;
  const journey = normalized === '/life' ? 'life' : normalized === '/connect' ? 'connect' : null;
  const context = new URLSearchParams();
  for (const [key, value] of parsed.searchParams) {
    if (journey) {
      if (key === 'group') {
        if (!context.has(key) && SERVICE_JOURNEY_GROUPS[journey].some((group) => group.id === value)) {
          context.set(key, value);
        }
        continue;
      }
      if (!['school', 'schoolId', 'campus', 'q'].includes(key)) continue;
      if (key === 'q' && value.length > 100) continue;
    }
    if (isServiceListPath(normalized) && key === 'q' && value.length > 200) continue;
    if ((RETURN_CONTEXT_KEYS.has(key) || isServiceListContext(normalized, key, value)) &&
      !context.has(key) && !hasUnsafeReturnCharacters(value)) {
      context.set(key, value);
    }
  }
  const query = context.toString();
  return `${normalized}${query ? `?${query}` : ''}${returnFragment(parsed.hash)}`;
}

export function sanitizeReturnPath(value: string | null | undefined): string {
  const destination = allowedReturnPath(value);
  if (!destination) return '/';
  const parsed = new URL(destination, 'https://nuni.invalid');
  // Retained legacy pages keep their existing path-only return policy.
  if (isLegacyAccountPath(parsed.pathname)) return parsed.hash ? '/' : parsed.pathname;
  return destination;
}

export function adminLoginReturnPath(value: string | null | undefined): string {
  const allowed = allowedReturnPath(value);
  if (!allowed) return '/admin';
  const sanitized = sanitizeReturnPath(value);
  return sanitized === '/' && allowed !== '/' ? '/admin' : sanitized;
}

type ReturnSearch = string | { get(name: string): string | null };

function returnSearchParams(search: ReturnSearch): { get(name: string): string | null } {
  return typeof search === 'string'
    ? new URLSearchParams(search.startsWith('?') ? search.slice(1) : search)
    : search;
}

export function readReturnPath(search: ReturnSearch): string {
  const params = returnSearchParams(search);
  return sanitizeReturnPath(params.get('returnUrl') ?? params.get('next'));
}

function isLegacyAccountPath(pathname: string): boolean {
  return pathname === '/auth/platform' ||
    pathname.startsWith('/auth/platform/') ||
    pathname === '/privacy/deletion-status';
}

/** Keep nuni task context out of legacy callbacks that discard it. */
export function campusOneLoginHref(search: ReturnSearch): string | null {
  const params = returnSearchParams(search);
  const destination = allowedReturnPath(params.get('returnUrl') ?? params.get('next'));
  if (!destination) return null;
  const parsed = new URL(destination, 'https://nuni.invalid');
  if (parsed.pathname === JOIN_PATH || parsed.pathname === CREATE_PATH) {
    return classroomLoginHref(destination);
  }
  if (
    isLegacyAccountPath(parsed.pathname) ||
    (!parsed.search && !parsed.hash && LEGACY_SIMPLE_RETURN_PATHS.has(parsed.pathname))
  ) return null;
  return loginHref(
    destination,
    params.get('reconnect') === 'school' ? { reconnect: 'school' } : undefined,
  );
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
  if (row.available === false || (typeof row.status === 'string' && row.status !== 'open')) return { available: false, tenantId, displayName, providerKinds, reason };
  if (tenantId) return { available: true, tenantId, displayName, providerKinds, reason };
  return null;
}

async function fetchSchoolSearch(query: string): Promise<DiscoveredSchool[]> {
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

/** Search metadata never grants login availability; only endpoint rows do. */
export async function searchSchoolsByName(query: string): Promise<DiscoveredSchool[]> {
  const normalized = normalizeSchoolQuery(query);
  const compact = normalized.replace(/\s+/g, '');
  // Preserve endpoint spelling; shared normalization is only for local matching.
  const rows = await fetchSchoolSearch(query.replace(/\s+/g, ''));
  const directorySchool = (row: DiscoveredSchool) => mockSchools.find((school) =>
    school.id === row.tenantId ||
    normalizeSchoolQuery(school.code) === normalizeSchoolQuery(row.tenantId ?? '') ||
    (row.displayName && normalizeSchoolQuery(school.name) === normalizeSchoolQuery(row.displayName)),
  );
  // The retained endpoint may only search names. Resolve exact codes there too,
  // keeping server availability (including explicit denials) authoritative.
  const exact = compact ? searchSchools(normalized).filter((school) =>
    [school.id, school.code].some((value) => normalizeSchoolQuery(value).replace(/\s+/g, '') === compact),
  ) : [];
  for (const school of exact) {
    if (rows.some((row) => directorySchool(row)?.id === school.id)) continue;
    const supplemental = await fetchSchoolSearch(school.name);
    for (const row of supplemental) {
      if (directorySchool(row)?.id !== school.id) continue;
      if (row.tenantId && rows.some((existing) => existing.tenantId === row.tenantId)) continue;
      rows.push(row);
    }
  }
  return searchSchools(normalized, rows.map((row) => {
    const school = directorySchool(row);
    return {
      ...school,
      id: row.tenantId,
      name: row.displayName ?? school?.name ?? '',
      row,
    };
  })).map(({ row }) => row);
}

export function looksLikeSchoolEmail(value: string): boolean {
  return value.includes('@');
}

function sessionLooksSignedIn(body: Record<string, unknown>): boolean {
  if (body.authenticated === false || body.pendingLogout === true) return false;
  if (body.authenticated === true) return true;
  return typeof body.platformAccountId === 'string' && body.platformAccountId.length > 0;
}

export type SchoolAccountSession = { status: 'active' | 'pending'; context: string | null };

export async function readSchoolAccountSession(signal?: AbortSignal): Promise<SchoolAccountSession | null> {
  const response = await fetch('/auth/session', { cache: 'no-store', credentials: 'same-origin', signal });
  const session = await readJson(response);
  if (!response.ok && response.status !== 401) throw new Error('School session unavailable');
  const context = typeof session?.sessionContext === 'string' && session.sessionContext.trim() ? session.sessionContext : null;
  if (session?.logoutPending === true || session?.pendingLogout === true) {
    if (session.family !== 'campus-account') throw new Error('Unknown logout session');
    return { status: 'pending', context };
  }
  if (session?.authenticated === false) return null;
  if (!response.ok || session?.authenticated !== true) throw new Error('Invalid school session');
  if (session.family !== 'campus-account') return null;
  return { status: 'active', context };
}

export async function logoutSchoolAccount(expected: SchoolAccountSession): Promise<void> {
  const current = await readSchoolAccountSession();
  if (current) {
    if (current.status !== expected.status || current.context !== expected.context ||
        (current.status === 'active' && !current.context)) {
      throw new Error('School account changed');
    }
    const receipt = await accountToken({ grantType: 'logout' });
    if (receipt?.revoked !== true || await readSchoolAccountSession()) throw new Error('School logout unconfirmed');
  }
  try {
    sessionStorage.removeItem(ACCOUNT_EXPIRES_AT_KEY);
    if (sessionStorage.getItem(AUTH_SOURCE_KEY) === 'campus-account') sessionStorage.removeItem(AUTH_SOURCE_KEY);
  } catch {
    // The server already revoked the session even if browser storage is disabled.
  }
}

async function readSessionAt(path: string): Promise<boolean> {
  const response = await fetch(path, { cache: 'no-store', credentials: 'same-origin' });
  return response.ok && sessionLooksSignedIn(await readJson(response));
}

export async function readExistingSession(schoolOnly = false): Promise<boolean> {
  if (!schoolOnly) {
    try {
      if (await readSessionAt('/api/nuni/session')) return true;
    } catch {
      // School-issued sessions still live on the old /auth/session endpoint.
    }
  }
  try {
    return schoolOnly ? (await readSchoolAccountSession())?.status === 'active' : await readSessionAt('/auth/session');
  } catch {
    return false;
  }
}

function microsoftAuthorizeUrl(issuer: string): string {
  const url = new URL(issuer);
  if (
    url.protocol !== 'https:' ||
    !MICROSOFT_HOSTS.has(url.hostname) ||
    url.username || url.password || url.port ||
    url.search ||
    url.hash ||
    !/^\/[0-9a-f-]{36}\/v2\.0$/i.test(url.pathname)
  ) {
    throw new AccountLoginError('學校登入設定無法驗證，請聯絡資訊中心。', 503, 'ACCOUNT_PROVIDER_INVALID');
  }
  return `${url.origin}${url.pathname.replace(/\/v2\.0$/, '/oauth2/v2.0/authorize')}`;
}

function schoolAuthorizationEndpoint(transaction: Record<string, unknown>): string {
  if (transaction.kind === 'google-workspace') {
    if (transaction.issuer !== 'https://accounts.google.com') {
      throw new AccountLoginError('學校登入設定無法驗證，請聯絡資訊中心。', 503, 'ACCOUNT_PROVIDER_INVALID');
    }
    return 'https://accounts.google.com/o/oauth2/v2/auth';
  } else if (transaction.kind === 'microsoft-entra') {
    return microsoftAuthorizeUrl(String(transaction.issuer));
  } else {
    throw new AccountLoginError(
      '這所學校的登入入口仍在完成安全設定，請先使用學校原有入口。',
      503,
      'CAMPUS_OIDC_DISCOVERY_REQUIRED',
    );
  }
}

function schoolAuthorizeUrl(transaction: Record<string, unknown>, challenge: string): string {
  const destination = new URL(schoolAuthorizationEndpoint(transaction));
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
    redirectUri: `${window.location.origin}${SCHOOL_CALLBACK_PATH}`,
    createdAt: Date.now(),
    returnPath: sanitizeReturnPath(returnPath),
  };
  sessionStorage.setItem(ACCOUNT_LOGIN_TRANSACTION_KEY, JSON.stringify(transaction));
  window.location.assign(schoolAuthorizeUrl(transaction, challenge));
}

async function accountToken(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const response = await fetch('/auth/account/token', {
    method: 'POST',
    redirect: 'error',
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
  const previousKeys = [
    'campus.oidc.access-token', 'campus.oidc.id-token', 'campus.oidc.expires-at',
    'campus.account.access-token', ACCOUNT_EXPIRES_AT_KEY,
  ];
  const previousSource = sessionStorage.getItem(AUTH_SOURCE_KEY);
  if (previousSource === 'oidc' || previousSource === 'campus-account' ||
      previousKeys.some((key) => sessionStorage.getItem(key))) {
    // The legacy offline reader checks both the grant and the stamp captured
    // by in-flight downloads. Replacing a school session invalidates both.
    for (const key of ['campus:lms-offline-access-stamp', 'campus:lms-offline-access']) {
      try {
        localStorage.removeItem(key);
      } catch {
        // Browsers that disable local storage cannot read these grants.
      }
    }
  }
  sessionStorage.removeItem('campus.oidc.transaction');
  for (const key of previousKeys) sessionStorage.removeItem(key);
  sessionStorage.setItem(ACCOUNT_EXPIRES_AT_KEY, String(Date.now() + Number(expiresIn) * 1000));
  sessionStorage.setItem(AUTH_SOURCE_KEY, 'campus-account');
}

function invalidSchoolCallback() {
  return new AccountLoginError('這次登入已失效，請重新登入學校帳號。', 401, 'ACCOUNT_CALLBACK_INVALID');
}

function takeSchoolAuthorization(callbackUrl: string) {
  const raw = sessionStorage.getItem(ACCOUNT_LOGIN_TRANSACTION_KEY);
  sessionStorage.removeItem(ACCOUNT_LOGIN_TRANSACTION_KEY);
  if (!raw) throw invalidSchoolCallback();

  let transaction: Record<string, unknown>;
  try {
    transaction = JSON.parse(raw);
  } catch {
    throw invalidSchoolCallback();
  }
  // The server binds the exchange to its sealed provider transaction. Only the
  // one-time code and the original PKCE verifier cross that boundary.
  const callback = new URL(callbackUrl);
  const redirectUri = `${window.location.origin}${SCHOOL_CALLBACK_PATH}`;
  const params = callback.searchParams;
  if (
    !transaction || typeof transaction !== 'object' ||
    callback.origin !== window.location.origin || callback.pathname !== SCHOOL_CALLBACK_PATH ||
    callback.username || callback.password || callback.hash || transaction.redirectUri !== redirectUri ||
    params.getAll('state').length !== 1 || typeof transaction.state !== 'string' ||
    !/^[A-Za-z0-9_-]{43}$/.test(transaction.state) || params.get('state') !== transaction.state
  ) throw invalidSchoolCallback();

  const { createdAt, expiresInSeconds, codeVerifier, issuer } = transaction;
  const now = Date.now();
  if (
    typeof createdAt !== 'number' || !Number.isSafeInteger(createdAt) || createdAt > now ||
    typeof expiresInSeconds !== 'number' || !Number.isInteger(expiresInSeconds) ||
    expiresInSeconds < 1 || expiresInSeconds > 600 || now - createdAt >= expiresInSeconds * 1000
  ) throw invalidSchoolCallback();
  if (
    typeof codeVerifier !== 'string' || !/^[A-Za-z0-9._~-]{43,128}$/.test(codeVerifier) ||
    typeof transaction.tenantId !== 'string' || !transaction.tenantId.trim() ||
    transaction.clientKind !== 'web' || typeof transaction.clientId !== 'string' || !transaction.clientId.trim() ||
    typeof transaction.nonce !== 'string' || transaction.nonce.length < 32 || transaction.nonce.length > 128 ||
    params.getAll('iss').length > 1 || (params.has('iss') && params.get('iss') !== issuer)
  ) throw invalidSchoolCallback();
  schoolAuthorizationEndpoint(transaction);
  if (params.has('error')) {
    if (params.getAll('error').length === 1 && params.get('error') === 'access_denied' && !params.has('code')) {
      throw new AccountLoginError('這次學校登入已取消。', 401, 'ACCOUNT_CALLBACK_CANCELLED');
    }
    throw invalidSchoolCallback();
  }
  const code = params.get('code');
  if (params.getAll('code').length !== 1 || !code?.trim() || code.length > 4000) throw invalidSchoolCallback();
  const returnPath = sanitizeReturnPath(typeof transaction.returnPath === 'string' ? transaction.returnPath : null);
  return { code, codeVerifier, returnPath };
}

export async function completeSchoolCallback(callbackUrl: string): Promise<void> {
  const { code, codeVerifier, returnPath } = takeSchoolAuthorization(callbackUrl);
  const result = await accountToken({ grantType: 'exchange', code, codeVerifier });
  if (result?.authenticated !== true) throw invalidSchoolCallback();
  rememberAccountSession(result.expiresIn);
  window.location.replace(returnPath);
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
  // The passkey exchange already established the school session. A separate
  // platform cookie in this browser can belong to a different person.
  window.location.replace(sanitizeReturnPath(returnPath));
}
