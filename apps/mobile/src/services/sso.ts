/* eslint-disable @typescript-eslint/no-explicit-any */
import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import { makeRedirectUri } from 'expo-auth-session';
import { signInWithCustomToken } from 'firebase/auth';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import Constants from 'expo-constants';
import {
  getSSOProviderName as getSharedSSOProviderName,
  getSchoolSsoAvailability as getSharedSchoolSsoAvailability,
  isSchoolSsoLoginReady,
  normalizeSSOUserInfo,
  normalizeSchoolSSOConfig,
  type SchoolSSOConfig,
  type SchoolSsoAvailability,
  type SSOCallbackResult,
  type SSOProvider,
  type SSOUserInfo,
} from '@campus/shared/src/auth';
import { getAuthInstance, getDb } from '../firebase';
import { getReleaseConfig } from './release';

export type { SchoolSSOConfig, SSOProvider, SSOUserInfo } from '@campus/shared/src/auth';

function getCloudFunctionUrl(functionName: string): string {
  const extra = (Constants.expoConfig as any)?.extra ?? {};
  const projectId = extra.firebase?.projectId;
  const region = extra.cloudFunctionRegion ?? 'asia-east1';

  if (!projectId) {
    throw new Error(
      'Firebase projectId not configured. Set EXPO_PUBLIC_FIREBASE_PROJECT_ID in env.',
    );
  }

  return `https://${region}-${projectId}.cloudfunctions.net/${functionName}`;
}

WebBrowser.maybeCompleteAuthSession();
type SSOConfig = NonNullable<SchoolSSOConfig['ssoConfig']>;

const MOCK_SSO_CONFIGS: Record<string, SchoolSSOConfig> = {
  nchu: {
    schoolId: 'nchu',
    schoolName: '國立中興大學',
    setupStatus: 'testing',
    ssoConfig: {
      provider: 'oidc',
      name: '中興大學 SSO',
      enabled: true,
      clientId: 'campus-app-nchu',
      authorizationEndpoint: 'https://sso.nchu.edu.tw/oauth2/authorize',
      tokenEndpoint: 'https://sso.nchu.edu.tw/oauth2/token',
      userInfoEndpoint: 'https://sso.nchu.edu.tw/oauth2/userinfo',
      scopes: ['openid', 'profile', 'email', 'student_id'],
    },
    emailDomain: 'nchu.edu.tw',
    allowEmailLogin: true,
  },
  nthu: {
    schoolId: 'nthu',
    schoolName: '國立清華大學',
    setupStatus: 'testing',
    ssoConfig: {
      provider: 'cas',
      name: '清華大學 CAS',
      enabled: true,
      casServerUrl: 'https://cas.nthu.edu.tw',
    },
    emailDomain: 'nthu.edu.tw',
    allowEmailLogin: true,
  },
  ntu: {
    schoolId: 'ntu',
    schoolName: '國立臺灣大學',
    setupStatus: 'testing',
    ssoConfig: {
      provider: 'saml',
      name: '臺大 SAML',
      enabled: true,
      samlEntryPoint: 'https://web2.cc.ntu.edu.tw/sso/saml',
      samlIssuer: 'campus-app',
    },
    emailDomain: 'ntu.edu.tw',
    allowEmailLogin: true,
  },
  demo: {
    schoolId: 'demo',
    schoolName: 'Demo 學校',
    setupStatus: 'draft',
    ssoConfig: null,
    allowEmailLogin: true,
  },
};

const CONFIG_LOAD_TIMEOUT_MS = 4000;

function getAppScheme(): string {
  const expoConfig = (Constants.expoConfig as any) ?? {};
  const manifest = (Constants as any)?.manifest ?? {};
  const configuredScheme = expoConfig.scheme ?? manifest.scheme;
  const scheme = Array.isArray(configuredScheme) ? configuredScheme[0] : configuredScheme;

  return typeof scheme === 'string' && scheme.trim().length > 0 ? scheme.trim() : 'campus';
}

function isMockSsoEnabled(): boolean {
  if (getReleaseConfig().isReleaseLike) {
    return false;
  }

  const extra = (Constants.expoConfig as any)?.extra ?? {};
  return extra.enableMockSSO === true;
}

function getSchoolConfigLookupKeys(schoolId: string): string[] {
  const normalized = schoolId.trim().toLowerCase();
  const parts = normalized.split('-').filter(Boolean);
  const keys = new Set<string>([normalized]);

  if (parts.length > 1) {
    keys.add(parts.slice(1).join('-'));
    keys.add(parts[parts.length - 1]);
  }

  if (parts.length > 2) {
    keys.add(parts[1]);
    keys.add(parts.slice(1, -1).join('-'));
  }

  return [...keys];
}

function getMockSchoolSSOConfig(schoolId: string): SchoolSSOConfig | null {
  for (const key of getSchoolConfigLookupKeys(schoolId)) {
    if (MOCK_SSO_CONFIGS[key]) {
      return normalizeSchoolSSOConfig(MOCK_SSO_CONFIGS[key], { schoolId });
    }
  }

  return null;
}

export async function getSchoolSSOConfig(schoolId: string): Promise<SchoolSSOConfig | null> {
  console.log('[sso] Loading SSO config for school:', schoolId);

  try {
    const response = await fetchWithTimeout(
      `${getCloudFunctionUrl('getSSOConfig')}?schoolId=${encodeURIComponent(schoolId)}`,
      {},
      CONFIG_LOAD_TIMEOUT_MS,
    );
    const data = (await response.json()) as Record<string, unknown>;

    if (response.ok) {
      console.log('[sso] Loaded SSO config from cloud function for school:', schoolId);
      return normalizeSchoolSSOConfig(data, { schoolId });
    }
  } catch (error) {
    console.log('[sso] Cloud function SSO config lookup failed:', error);
  }

  if (isMockSsoEnabled()) {
    const mockConfig = getMockSchoolSSOConfig(schoolId);
    if (mockConfig) {
      console.log('[sso] Using local mock SSO config for school:', schoolId);
      return mockConfig;
    }
  }

  console.log('[sso] No SSO config found for school:', schoolId);
  return null;
}

export function makeAppRedirectUri(path: string): string {
  return makeRedirectUri({
    scheme: getAppScheme(),
    path,
  });
}

export function getSSORedirectUri(): string {
  return makeAppRedirectUri('auth/callback');
}

const CALLBACK_STATE_PARAM = 'ssoState';

type AppSSOCallbackPayload = {
  provider: SSOProvider;
  redirectUri: string;
  transactionId: string;
  state: string;
  codeVerifier?: string;
  code?: string;
  ticket?: string;
  samlResponse?: string;
};

type StartSSOAuthResult = {
  transactionId: string;
  expiresAt?: string | null;
};

function withCallbackState(redirectUri: string, state: string): string {
  const url = new URL(redirectUri);
  url.searchParams.set(CALLBACK_STATE_PARAM, state);
  return url.toString();
}

async function startSSOAuthTransaction(params: {
  schoolId: string;
  provider: SSOProvider;
  redirectUri: string;
  state: string;
  codeChallenge?: string;
  nonce?: string;
}): Promise<StartSSOAuthResult> {
  const response = await fetchWithTimeout(`${getCloudFunctionUrl('startSSOAuth')}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      schoolId: params.schoolId,
      provider: params.provider,
      redirectUri: params.redirectUri,
      state: params.state,
      source: 'mobile',
      ...(params.codeChallenge ? { codeChallenge: params.codeChallenge } : {}),
      ...(params.nonce ? { nonce: params.nonce } : {}),
    }),
  });

  const data = (await response.json()) as {
    transactionId?: string;
    expiresAt?: string | null;
    error?: string;
    correlationId?: string;
  };

  if (!response.ok || typeof data.transactionId !== 'string') {
    throw new SSOError(
      data.correlationId
        ? `${data.error || '無法初始化學校登入流程'}（追蹤碼：${data.correlationId}）`
        : data.error || '無法初始化學校登入流程',
      'SSO_INVALID_RESPONSE',
    );
  }

  return {
    transactionId: data.transactionId,
    expiresAt: data.expiresAt ?? null,
  };
}

async function performOIDCLogin(
  schoolId: string,
  config: SSOConfig,
): Promise<AppSSOCallbackPayload | null> {
  if (!config.clientId || !config.authorizationEndpoint) {
    throw new Error('OIDC configuration incomplete');
  }

  const redirectUri = getSSORedirectUri();
  const scopes = config.scopes ?? ['openid', 'profile', 'email'];
  const nonce = generateRandomId();

  const discovery = {
    authorizationEndpoint: config.authorizationEndpoint,
    tokenEndpoint: config.tokenEndpoint,
  };

  const request = new AuthSession.AuthRequest({
    clientId: config.clientId,
    scopes,
    redirectUri,
    responseType: AuthSession.ResponseType.Code,
    usePKCE: true,
    extraParams: {
      ...(config.customParams ?? {}),
      nonce,
    },
  });
  await request.makeAuthUrlAsync(discovery);

  if (!request.state || !request.codeVerifier || !request.codeChallenge) {
    throw new Error('OIDC request did not initialize PKCE correctly');
  }

  const transaction = await startSSOAuthTransaction({
    schoolId,
    provider: 'oidc',
    redirectUri,
    state: request.state,
    codeChallenge: request.codeChallenge,
    nonce,
  });

  const result = await request.promptAsync(discovery);

  if (result.type !== 'success' || !result.params.code) {
    console.log('OIDC auth failed:', result);
    return null;
  }

  const payload: AppSSOCallbackPayload = {
    provider: 'oidc',
    redirectUri,
    transactionId: transaction.transactionId,
    state: request.state,
    codeVerifier: request.codeVerifier,
    code: result.params.code,
  };
  return payload;
}

async function performCASLogin(
  schoolId: string,
  config: SSOConfig,
): Promise<AppSSOCallbackPayload | null> {
  if (!config.casServerUrl) {
    throw new Error('CAS server URL not configured');
  }

  const state = generateRandomId();
  const redirectUri = withCallbackState(getSSORedirectUri(), state);
  const transaction = await startSSOAuthTransaction({
    schoolId,
    provider: 'cas',
    redirectUri,
    state,
  });
  const serviceUrl = encodeURIComponent(redirectUri);
  const casLoginUrl = `${config.casServerUrl}/login?service=${serviceUrl}`;

  const result = await WebBrowser.openAuthSessionAsync(casLoginUrl, redirectUri);

  if (result.type !== 'success' || !result.url) {
    console.log('CAS auth failed:', result);
    return null;
  }

  const url = new URL(result.url);
  const ticket = url.searchParams.get('ticket');

  if (!ticket) {
    throw new Error('No CAS ticket received');
  }

  const payload: AppSSOCallbackPayload = {
    provider: 'cas',
    redirectUri,
    transactionId: transaction.transactionId,
    state: url.searchParams.get(CALLBACK_STATE_PARAM) ?? state,
    ticket,
  };
  return payload;
}

async function performSAMLLogin(
  schoolId: string,
  config: SSOConfig,
): Promise<AppSSOCallbackPayload | null> {
  if (!config.samlEntryPoint) {
    throw new Error('SAML entry point not configured');
  }

  const state = generateRandomId();
  const redirectUri = withCallbackState(getSSORedirectUri(), state);
  const transaction = await startSSOAuthTransaction({
    schoolId,
    provider: 'saml',
    redirectUri,
    state,
  });

  const samlRequest = btoa(
    `
    <samlp:AuthnRequest
      xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol"
      xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion"
      ID="_${generateRandomId()}"
      Version="2.0"
      IssueInstant="${new Date().toISOString()}"
      AssertionConsumerServiceURL="${redirectUri}">
      <saml:Issuer>${config.samlIssuer || 'campus-app'}</saml:Issuer>
    </samlp:AuthnRequest>
  `.trim(),
  );

  const samlLoginUrl = `${config.samlEntryPoint}?SAMLRequest=${encodeURIComponent(samlRequest)}`;

  const result = await WebBrowser.openAuthSessionAsync(samlLoginUrl, redirectUri);

  if (result.type !== 'success' || !result.url) {
    console.log('SAML auth failed:', result);
    return null;
  }

  const url = new URL(result.url);
  const samlResponse = url.searchParams.get('SAMLResponse');

  if (!samlResponse) {
    throw new Error('No SAML response received');
  }

  const payload: AppSSOCallbackPayload = {
    provider: 'saml',
    redirectUri,
    transactionId: transaction.transactionId,
    state: url.searchParams.get(CALLBACK_STATE_PARAM) ?? state,
    samlResponse,
  };
  return payload;
}

/**
 * 產生加密安全的隨機 ID
 * 使用 crypto.getRandomValues 而非 Math.random
 */
function generateRandomId(): string {
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const array = new Uint8Array(16);
    crypto.getRandomValues(array);
    return Array.from(array, (byte) => byte.toString(16).padStart(2, '0')).join('');
  }
  // 降級方案：在不支援 crypto 的環境中使用 Math.random
  // 並使用時間戳增加熵
  const timestamp = Date.now().toString(36);
  const random1 = Math.random().toString(36).substring(2, 15);
  const random2 = Math.random().toString(36).substring(2, 15);
  return `${timestamp}${random1}${random2}`;
}

// 請求超時配置
const REQUEST_TIMEOUT_MS = 30000; // 30 秒

/**
 * 帶超時的 fetch 請求
 */
async function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
  timeoutMs: number = REQUEST_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    return response;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new SSOError('請求逾時，請稍後再試', 'SSO_TIMEOUT');
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

export type SSOErrorCode =
  | 'SSO_NOT_CONFIGURED'
  | 'SSO_DISABLED'
  | 'SSO_NOT_READY'
  | 'SSO_CANCELLED'
  | 'SSO_TIMEOUT'
  | 'SSO_NETWORK_ERROR'
  | 'SSO_INVALID_RESPONSE'
  | 'SSO_TOKEN_ERROR'
  | 'SSO_VALIDATION_FAILED'
  | 'SSO_UNSUPPORTED_PROVIDER'
  | 'SSO_UNKNOWN_ERROR';

export class SSOError extends Error {
  constructor(
    message: string,
    public readonly code: SSOErrorCode,
    public readonly originalError?: unknown,
  ) {
    super(message);
    this.name = 'SSOError';
  }

  static fromUnknown(error: unknown): SSOError {
    if (error instanceof SSOError) return error;

    const message = error instanceof Error ? error.message : String(error);

    if (message.includes('cancelled') || message.includes('dismiss')) {
      return new SSOError('登入已取消', 'SSO_CANCELLED', error);
    }
    if (message.includes('network') || message.includes('fetch')) {
      return new SSOError('網路連線失敗，請檢查網路狀態', 'SSO_NETWORK_ERROR', error);
    }
    if (message.includes('timeout')) {
      return new SSOError('登入逾時，請稍後再試', 'SSO_TIMEOUT', error);
    }

    return new SSOError(message || '登入失敗，請稍後再試', 'SSO_UNKNOWN_ERROR', error);
  }

  get userFriendlyMessage(): string {
    switch (this.code) {
      case 'SSO_NOT_CONFIGURED':
        return '此學校尚未設定單一登入';
      case 'SSO_DISABLED':
        return '此學校的單一登入功能已停用';
      case 'SSO_NOT_READY':
        return this.message || '此學校的學校登入尚未正式開通';
      case 'SSO_CANCELLED':
        return '登入已取消';
      case 'SSO_TIMEOUT':
        return '登入逾時，請稍後再試';
      case 'SSO_NETWORK_ERROR':
        return '網路連線失敗，請檢查網路狀態';
      case 'SSO_INVALID_RESPONSE':
        return '伺服器回應異常，請稍後再試';
      case 'SSO_TOKEN_ERROR':
        return '身份驗證失敗，請稍後再試';
      case 'SSO_VALIDATION_FAILED':
        return '身份驗證失敗，請確認帳號密碼是否正確';
      case 'SSO_UNSUPPORTED_PROVIDER':
        return '不支援的登入方式';
      default:
        return this.message || '登入失敗，請稍後再試';
    }
  }

  get isRetryable(): boolean {
    return ['SSO_TIMEOUT', 'SSO_NETWORK_ERROR', 'SSO_UNKNOWN_ERROR'].includes(this.code);
  }
}

async function completeSSOCallback(
  schoolId: string,
  payload: AppSSOCallbackPayload,
): Promise<SSOCallbackResult> {
  const requestBody = {
    provider: payload.provider,
    schoolId,
    redirectUri: payload.redirectUri,
    transactionId: payload.transactionId,
    state: payload.state,
    ...(payload.codeVerifier ? { codeVerifier: payload.codeVerifier } : {}),
    ...(payload.code ? { code: payload.code } : {}),
    ...(payload.ticket ? { ticket: payload.ticket } : {}),
    ...(payload.samlResponse ? { SAMLResponse: payload.samlResponse } : {}),
  };

  const response = await fetchWithTimeout(`${getCloudFunctionUrl('verifySSOCallback')}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(requestBody),
  });

  const data = (await response.json()) as Partial<SSOCallbackResult> & {
    error?: string;
    correlationId?: string;
  };

  if (!response.ok || typeof data.customToken !== 'string' || typeof data.uid !== 'string') {
    throw new SSOError(
      data.correlationId
        ? `${data.error || '身份驗證失敗'}（追蹤碼：${data.correlationId}）`
        : data.error || '身份驗證失敗',
      'SSO_TOKEN_ERROR',
    );
  }

  return data as SSOCallbackResult;
}

export async function performSSOLogin(
  schoolId: string,
): Promise<{ uid: string; isNewUser: boolean; userInfo: SSOUserInfo | null } | null> {
  let config: SchoolSSOConfig | null;

  try {
    config = await getSchoolSSOConfig(schoolId);
  } catch (error) {
    throw new SSOError('無法載入學校 SSO 設定', 'SSO_NETWORK_ERROR', error);
  }

  const availability = getSharedSchoolSsoAvailability(config);

  if (!availability.isConfigured) {
    throw new SSOError(availability.message, 'SSO_NOT_CONFIGURED');
  }

  if (!availability.isEnabled) {
    throw new SSOError(availability.message, 'SSO_DISABLED');
  }

  if (!availability.isLoginReady) {
    throw new SSOError(availability.message, 'SSO_NOT_READY');
  }

  const ssoConfig = config.ssoConfig;

  try {
    let payload: AppSSOCallbackPayload | null;
    switch (ssoConfig.provider) {
      case 'oidc':
        payload = await performOIDCLogin(schoolId, ssoConfig);
        break;
      case 'cas':
        payload = await performCASLogin(schoolId, ssoConfig);
        break;
      case 'saml':
        payload = await performSAMLLogin(schoolId, ssoConfig);
        break;
      default:
        throw new SSOError(`不支援的 SSO 協議: ${ssoConfig.provider}`, 'SSO_UNSUPPORTED_PROVIDER');
    }

    if (!payload) {
      return null;
    }

    const result = await completeSSOCallback(schoolId, payload);
    const auth = getAuthInstance();

    try {
      await signInWithCustomToken(auth, result.customToken);
    } catch (error) {
      throw new SSOError('登入失敗，請稍後再試', 'SSO_TOKEN_ERROR', error);
    }

    return {
      uid: result.uid,
      isNewUser: result.isNewUser,
      userInfo: normalizeSSOUserInfo(result.userInfo ?? null),
    };
  } catch (error) {
    throw SSOError.fromUnknown(error);
  }
}

/**
 * 已改由 verifySSOCallback 完成學校驗證與 Firebase token 簽發。
 * 保留同名函式避免舊呼叫點立即崩潰，但不再允許 client 直接建立 token。
 */
export async function linkSSOToFirebase(
  _schoolId: string,
  _ssoUserInfo: SSOUserInfo,
): Promise<{ uid: string; isNewUser: boolean }> {
  throw new SSOError('請改用 performSSOLogin 完成後端驗證流程', 'SSO_UNSUPPORTED_PROVIDER');
}

export async function unlinkSSO(schoolId: string, uid: string): Promise<void> {
  const db = getDb();

  const userRef = doc(db, 'users', uid);
  const userDoc = await getDoc(userRef);

  if (!userDoc.exists()) {
    throw new Error('User not found');
  }

  // 查詢該使用者在此學校的所有 SSO 連結
  // ssoLinks 文件的 ID 格式是 `${schoolId}_${ssoSub}`，需要通過查詢找到
  const {
    collection,
    query,
    where,
    getDocs,
    deleteDoc: deleteDocFn,
  } = await import('firebase/firestore');

  const ssoLinksRef = collection(db, 'ssoLinks');
  const q = query(ssoLinksRef, where('schoolId', '==', schoolId), where('firebaseUid', '==', uid));

  const ssoLinksSnapshot = await getDocs(q);

  // 刪除所有匹配的 SSO 連結
  const deletePromises = ssoLinksSnapshot.docs.map((doc) => deleteDocFn(doc.ref));
  await Promise.all(deletePromises);

  if (ssoLinksSnapshot.empty) {
    console.warn('[sso] No SSO links found for user:', uid, 'school:', schoolId);
  } else {
    console.log('[sso] Deleted', ssoLinksSnapshot.size, 'SSO link(s) for user:', uid);
  }

  await setDoc(
    userRef,
    {
      ssoLinked: false,
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );
}

export function isSSOAvailable(schoolConfig: SchoolSSOConfig | null): boolean {
  return isSchoolSsoLoginReady(schoolConfig);
}

export function getSSOAvailability(schoolConfig: SchoolSSOConfig | null): SchoolSsoAvailability {
  return getSharedSchoolSsoAvailability(schoolConfig);
}

export function getSSOProviderName(schoolConfig: SchoolSSOConfig | null): string {
  return getSharedSSOProviderName(schoolConfig ?? undefined);
}

export const ssoService = {
  async authenticate(
    provider: SSOProvider,
    config: {
      authUrl: string;
      clientId: string;
      redirectUri: string;
      schoolId: string;
    },
  ): Promise<{ success: boolean; accessToken?: string; error?: string }> {
    try {
      const authUrl = `${config.authUrl}?client_id=${encodeURIComponent(config.clientId)}&redirect_uri=${encodeURIComponent(config.redirectUri)}&response_type=token`;
      const authSession = AuthSession as typeof AuthSession & {
        startAsync?: (options: { authUrl: string; returnUrl?: string }) => Promise<any>;
      };
      const result = authSession.startAsync
        ? await authSession.startAsync({
            authUrl,
            returnUrl: config.redirectUri,
          })
        : await WebBrowser.openAuthSessionAsync(authUrl, config.redirectUri);

      if (result.type !== 'success') {
        return { success: false, error: `${provider.toUpperCase()} 認證未完成` };
      }

      const callbackUrl = (result as any).url;
      const params =
        (result as any).params ??
        (() => {
          if (!callbackUrl) {
            return {};
          }

          const parsedUrl = new URL(callbackUrl);
          const queryParams = new URLSearchParams(parsedUrl.search);
          const hashParams = new URLSearchParams(
            parsedUrl.hash.startsWith('#') ? parsedUrl.hash.slice(1) : parsedUrl.hash,
          );
          return Object.fromEntries([...queryParams.entries(), ...hashParams.entries()]);
        })();

      return {
        success: true,
        accessToken: params.access_token ?? params.token ?? params.code,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'SSO 認證失敗',
      };
    }
  },
};
