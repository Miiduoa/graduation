import { SSOUserInfo, getSchoolSSOConfig, SSOError } from "./sso";
import {
  secureDeleteMany,
  secureGetItem,
  secureSetItem,
} from "./secureStorage";

const SSO_SESSION_KEY = "campus.sso.session.v1";
const SSO_CREDENTIALS_KEY = "campus.sso.credentials.v1";

export type SSOSession = {
  schoolId: string;
  userInfo: SSOUserInfo;
  firebaseUid: string;
  linkedAt: number;
  lastRefreshed: number;
  expiresAt?: number;
};

export type SSOCredentials = {
  schoolId: string;
  accessToken?: string;
  refreshToken?: string;
  idToken?: string;
  expiresAt?: number;
};

let currentSession: SSOSession | null = null;
let currentCredentials: SSOCredentials | null = null;
const sessionListeners = new Set<(session: SSOSession | null) => void>();

export async function loadSSOSession(): Promise<SSOSession | null> {
  try {
    const sessionJson = await secureGetItem(SSO_SESSION_KEY);
    if (!sessionJson) return null;
    
    currentSession = JSON.parse(sessionJson);
    
    if (currentSession?.expiresAt && currentSession.expiresAt < Date.now()) {
      console.log("[SSOSession] Session expired, clearing");
      await clearSSOSession();
      return null;
    }
    
    return currentSession;
  } catch (error) {
    console.warn("[SSOSession] Failed to load session:", error);
    return null;
  }
}

export async function saveSSOSession(session: SSOSession): Promise<void> {
  try {
    currentSession = session;
    await secureSetItem(SSO_SESSION_KEY, JSON.stringify(session));
    notifySessionListeners(session);
  } catch (error) {
    console.error("[SSOSession] Failed to save session:", error);
    throw error;
  }
}

export async function clearSSOSession(): Promise<void> {
  try {
    currentSession = null;
    currentCredentials = null;
    await secureDeleteMany([SSO_SESSION_KEY, SSO_CREDENTIALS_KEY]);
    notifySessionListeners(null);
  } catch (error) {
    console.error("[SSOSession] Failed to clear session:", error);
  }
}

export function getCurrentSSOSession(): SSOSession | null {
  return currentSession;
}

export async function loadSSOCredentials(): Promise<SSOCredentials | null> {
  try {
    const credentialsJson = await secureGetItem(SSO_CREDENTIALS_KEY);
    if (!credentialsJson) return null;
    
    currentCredentials = JSON.parse(credentialsJson);
    return currentCredentials;
  } catch (error) {
    console.warn("[SSOSession] Failed to load credentials:", error);
    return null;
  }
}

export async function saveSSOCredentials(credentials: SSOCredentials): Promise<void> {
  try {
    currentCredentials = credentials;
    const sanitizedCredentials = { ...credentials };
    await secureSetItem(SSO_CREDENTIALS_KEY, JSON.stringify(sanitizedCredentials));
  } catch (error) {
    console.error("[SSOSession] Failed to save credentials:", error);
  }
}

export function getCurrentSSOCredentials(): SSOCredentials | null {
  return currentCredentials;
}

export function isTokenExpired(credentials: SSOCredentials | null): boolean {
  if (!credentials?.expiresAt) return false;
  return credentials.expiresAt < Date.now() + 60000;
}

export function shouldRefreshToken(credentials: SSOCredentials | null): boolean {
  if (!credentials?.expiresAt || !credentials.refreshToken) return false;
  return credentials.expiresAt < Date.now() + 5 * 60 * 1000;
}

export async function refreshSSOToken(): Promise<SSOCredentials | null> {
  const credentials = currentCredentials || await loadSSOCredentials();
  if (!credentials?.refreshToken) {
    console.log("[SSOSession] No refresh token available");
    return null;
  }
  
  const config = await getSchoolSSOConfig(credentials.schoolId);
  if (!config?.ssoConfig) {
    throw new SSOError("SSO configuration not found", "SSO_NOT_CONFIGURED");
  }
  
  if (config.ssoConfig.provider !== "oidc" || !config.ssoConfig.tokenEndpoint) {
    console.log("[SSOSession] Token refresh not supported for this provider");
    return credentials;
  }
  
  try {
    const response = await fetch(config.ssoConfig.tokenEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: credentials.refreshToken,
        client_id: config.ssoConfig.clientId || "",
      }).toString(),
    });
    
    if (!response.ok) {
      throw new Error(`Token refresh failed: ${response.status}`);
    }
    
    const tokenData = await response.json();
    
    const newCredentials: SSOCredentials = {
      schoolId: credentials.schoolId,
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token || credentials.refreshToken,
      idToken: tokenData.id_token,
      expiresAt: tokenData.expires_in 
        ? Date.now() + (tokenData.expires_in * 1000)
        : undefined,
    };
    
    await saveSSOCredentials(newCredentials);
    
    if (currentSession) {
      currentSession.lastRefreshed = Date.now();
      await saveSSOSession(currentSession);
    }
    
    return newCredentials;
  } catch (error) {
    console.error("[SSOSession] Token refresh failed:", error);
    throw SSOError.fromUnknown(error);
  }
}

export function subscribeSSOSession(listener: (session: SSOSession | null) => void): () => void {
  sessionListeners.add(listener);
  listener(currentSession);
  
  return () => {
    sessionListeners.delete(listener);
  };
}

function notifySessionListeners(session: SSOSession | null): void {
  sessionListeners.forEach((listener) => {
    try {
      listener(session);
    } catch (error) {
      console.error("[SSOSession] Listener error:", error);
    }
  });
}

export async function createSSOSession(
  schoolId: string,
  userInfo: SSOUserInfo,
  firebaseUid: string,
  credentials?: Partial<SSOCredentials>
): Promise<SSOSession> {
  const session: SSOSession = {
    schoolId,
    userInfo,
    firebaseUid,
    linkedAt: Date.now(),
    lastRefreshed: Date.now(),
    expiresAt: credentials?.expiresAt,
  };
  
  await saveSSOSession(session);
  
  if (credentials) {
    await saveSSOCredentials({
      schoolId,
      ...credentials,
    });
  }
  
  return session;
}

export async function updateSSOUserInfo(userInfo: Partial<SSOUserInfo>): Promise<void> {
  if (!currentSession) {
    console.warn("[SSOSession] No active session to update");
    return;
  }
  
  currentSession = {
    ...currentSession,
    userInfo: {
      ...currentSession.userInfo,
      ...userInfo,
    },
    lastRefreshed: Date.now(),
  };
  
  await saveSSOSession(currentSession);
}

export function getSSOSessionAge(): number | null {
  if (!currentSession) return null;
  return Date.now() - currentSession.linkedAt;
}

export function getTimeSinceLastRefresh(): number | null {
  if (!currentSession) return null;
  return Date.now() - currentSession.lastRefreshed;
}

let tokenRefreshInterval: ReturnType<typeof setInterval> | null = null;

export function startTokenRefreshMonitor(intervalMs: number = 5 * 60 * 1000): void {
  if (tokenRefreshInterval) {
    clearInterval(tokenRefreshInterval);
  }
  
  tokenRefreshInterval = setInterval(async () => {
    const credentials = getCurrentSSOCredentials();
    if (shouldRefreshToken(credentials)) {
      console.log("[SSOSession] Auto-refreshing token");
      try {
        await refreshSSOToken();
      } catch (error) {
        console.error("[SSOSession] Auto-refresh failed:", error);
      }
    }
  }, intervalMs);
}

export function stopTokenRefreshMonitor(): void {
  if (tokenRefreshInterval) {
    clearInterval(tokenRefreshInterval);
    tokenRefreshInterval = null;
  }
}

export async function validateSSOSession(): Promise<boolean> {
  const session = currentSession || await loadSSOSession();
  if (!session) return false;
  
  if (session.expiresAt && session.expiresAt < Date.now()) {
    await clearSSOSession();
    return false;
  }
  
  const credentials = currentCredentials || await loadSSOCredentials();
  if (credentials && isTokenExpired(credentials)) {
    if (credentials.refreshToken) {
      try {
        await refreshSSOToken();
        return true;
      } catch {
        await clearSSOSession();
        return false;
      }
    }
    await clearSSOSession();
    return false;
  }
  
  return true;
}
