import Constants from "expo-constants";
import { initializeApp, getApps, type FirebaseApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getStorage, ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { 
  getAuth, 
  initializeAuth, 
  onIdTokenChanged,
  type Auth,
  type User,
} from "firebase/auth";
import AsyncStorage from "@react-native-async-storage/async-storage";

const { getReactNativePersistence } = require("@firebase/auth/dist/rn/index.js") as {
  getReactNativePersistence: (storage: typeof AsyncStorage) => unknown;
};

type FirebaseWebConfig = {
  apiKey?: string;
  authDomain?: string;
  projectId?: string;
  storageBucket?: string;
  messagingSenderId?: string;
  appId?: string;
};

function getFirebaseConfig(): FirebaseWebConfig {
  const extra = (Constants.expoConfig as any)?.extra ?? (Constants as any)?.manifest?.extra ?? {};
  return (extra.firebase ?? {}) as FirebaseWebConfig;
}

export function getFirebaseApp() {
  if (getApps().length) return getApps()[0]!;
  const cfg = getFirebaseConfig();

  if (!cfg.apiKey || !cfg.projectId || !cfg.appId) {
    throw new Error(
      "Missing Firebase config. Set EXPO_PUBLIC_FIREBASE_API_KEY / PROJECT_ID / APP_ID (and others) in env and restart expo."
    );
  }

  return initializeApp({
    apiKey: cfg.apiKey,
    authDomain: cfg.authDomain,
    projectId: cfg.projectId,
    storageBucket: cfg.storageBucket,
    messagingSenderId: cfg.messagingSenderId,
    appId: cfg.appId,
  });
}

export function getDb() {
  return getFirestore(getFirebaseApp());
}

export function getStorageInstance() {
  return getStorage(getFirebaseApp());
}

export async function uploadAvatar(userId: string, uri: string): Promise<string> {
  const storage = getStorageInstance();
  const fileExtension = uri.split('.').pop()?.toLowerCase() || 'jpg';
  const storageRef = ref(storage, `avatars/${userId}.${fileExtension}`);

  const mimeTypes: Record<string, string> = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    gif: "image/gif",
    webp: "image/webp",
    heic: "image/heic",
  };
  const contentType = mimeTypes[fileExtension] ?? "image/jpeg";

  const response = await fetch(uri);
  const blob = await response.blob();

  await uploadBytes(storageRef, blob, { contentType });
  const downloadUrl = await getDownloadURL(storageRef);

  return downloadUrl;
}

let _auth: Auth | null = null;
let _tokenRefreshUnsubscribe: (() => void) | null = null;
let _tokenRefreshInterval: ReturnType<typeof setInterval> | null = null;

type TokenRefreshCallback = (user: User | null, error?: Error) => void;
const tokenRefreshListeners = new Set<TokenRefreshCallback>();

const TOKEN_REFRESH_CONFIG = {
  checkIntervalMs: 60 * 1000,
  refreshThresholdMs: 10 * 60 * 1000,
  maxRetries: 3,
  retryDelayMs: 2000,
  cooldownAfterExhausted: 5 * 60 * 1000,
};

let tokenRefreshRetryCount = 0;
let lastExhaustedTime = 0;
let isRefreshing = false;

async function refreshTokenWithRetry(user: User): Promise<boolean> {
  // 防止並發刷新
  if (isRefreshing) {
    console.log("[firebase] Token refresh already in progress, skipping");
    return false;
  }

  // 如果在冷卻期內，跳過刷新
  if (lastExhaustedTime > 0) {
    const timeSinceExhausted = Date.now() - lastExhaustedTime;
    if (timeSinceExhausted < TOKEN_REFRESH_CONFIG.cooldownAfterExhausted) {
      console.log("[firebase] In cooldown period, skipping refresh");
      return false;
    } else {
      // 冷卻期結束，重置狀態
      lastExhaustedTime = 0;
      tokenRefreshRetryCount = 0;
    }
  }

  isRefreshing = true;

  try {
    for (let attempt = 0; attempt <= TOKEN_REFRESH_CONFIG.maxRetries; attempt++) {
      try {
        await user.getIdToken(true);
        tokenRefreshRetryCount = 0;
        console.log("[firebase] Token refreshed successfully");
        return true;
      } catch (e) {
        const isLastAttempt = attempt === TOKEN_REFRESH_CONFIG.maxRetries;
        const delay = TOKEN_REFRESH_CONFIG.retryDelayMs * Math.pow(2, attempt);
        
        console.warn(`[firebase] Token refresh attempt ${attempt + 1} failed:`, e);
        
        // 檢查是否是不可恢復的錯誤
        const errorCode = (e as any)?.code;
        const isUnrecoverable = [
          "auth/user-disabled",
          "auth/user-not-found",
          "auth/invalid-user-token",
          "auth/user-token-expired",
        ].includes(errorCode);

        if (isUnrecoverable) {
          console.error("[firebase] Unrecoverable auth error:", errorCode);
          tokenRefreshListeners.forEach((cb) => 
            cb(user, new Error("TOKEN_REFRESH_EXHAUSTED"))
          );
          lastExhaustedTime = Date.now();
          return false;
        }
        
        if (!isLastAttempt) {
          await new Promise((resolve) => setTimeout(resolve, delay));
        } else {
          tokenRefreshRetryCount++;
          const error = e instanceof Error ? e : new Error(String(e));
          tokenRefreshListeners.forEach((cb) => cb(user, error));
          
          if (tokenRefreshRetryCount >= 3) {
            console.error("[firebase] Token refresh failed repeatedly, user may need to re-login");
            tokenRefreshListeners.forEach((cb) => 
              cb(user, new Error("TOKEN_REFRESH_EXHAUSTED"))
            );
            lastExhaustedTime = Date.now();
          }
          return false;
        }
      }
    }
    return false;
  } finally {
    isRefreshing = false;
  }
}

async function checkAndRefreshToken(user: User | null): Promise<void> {
  if (!user) return;
  
  try {
    const tokenResult = await user.getIdTokenResult();
    const expirationTime = new Date(tokenResult.expirationTime).getTime();
    const now = Date.now();
    
    if (expirationTime - now < TOKEN_REFRESH_CONFIG.refreshThresholdMs) {
      await refreshTokenWithRetry(user);
    }
  } catch (e) {
    console.error("[firebase] Token check failed:", e);
  }
}

export function getAuthInstance(): Auth {
  if (_auth) return _auth;
  const app = getFirebaseApp();
  
  try {
    _auth = initializeAuth(app, {
      persistence: getReactNativePersistence(AsyncStorage) as any,
    });
  } catch (e: any) {
    if (e.code === "auth/already-initialized") {
      _auth = getAuth(app);
    } else {
      throw e;
    }
  }
  
  if (!_tokenRefreshUnsubscribe) {
    _tokenRefreshUnsubscribe = onIdTokenChanged(
      _auth,
      async (user) => {
        if (user) {
          await checkAndRefreshToken(user);
        }
        tokenRefreshListeners.forEach((cb) => cb(user));
      },
      (error) => {
        console.error("[firebase] Token change error:", error);
        tokenRefreshListeners.forEach((cb) => cb(null, error));
      }
    );
  }
  
  if (!_tokenRefreshInterval) {
    _tokenRefreshInterval = setInterval(() => {
      const currentUser = _auth?.currentUser;
      if (currentUser) {
        checkAndRefreshToken(currentUser);
      }
    }, TOKEN_REFRESH_CONFIG.checkIntervalMs);
  }
  
  return _auth;
}

export function cleanupAuth(): void {
  if (_tokenRefreshUnsubscribe) {
    _tokenRefreshUnsubscribe();
    _tokenRefreshUnsubscribe = null;
  }
  if (_tokenRefreshInterval) {
    clearInterval(_tokenRefreshInterval);
    _tokenRefreshInterval = null;
  }
  tokenRefreshListeners.clear();
  tokenRefreshRetryCount = 0;
  lastExhaustedTime = 0;
  isRefreshing = false;
}

export function resetTokenRefreshState(): void {
  tokenRefreshRetryCount = 0;
  lastExhaustedTime = 0;
  isRefreshing = false;
}

export function subscribeToTokenRefresh(callback: TokenRefreshCallback): () => void {
  tokenRefreshListeners.add(callback);
  return () => {
    tokenRefreshListeners.delete(callback);
  };
}

export async function forceRefreshToken(): Promise<string | null> {
  const auth = getAuthInstance();
  const user = auth.currentUser;
  if (!user) return null;
  
  try {
    return await user.getIdToken(true);
  } catch (e) {
    console.error("[firebase] Force refresh token failed:", e);
    throw e;
  }
}
