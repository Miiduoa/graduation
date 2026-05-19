/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
import Constants from 'expo-constants';
import { initializeApp, getApps, type FirebaseApp } from 'firebase/app';
import {
  getFirestore,
  initializeFirestore,
  memoryLocalCache,
  connectFirestoreEmulator,
} from 'firebase/firestore';
import { getFunctions, connectFunctionsEmulator, type Functions } from 'firebase/functions';
import { getStorage, ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import {
  getAuth,
  initializeAuth,
  onIdTokenChanged,
  connectAuthEmulator,
  type Auth,
  type User,
} from 'firebase/auth';
import AsyncStorage from '@react-native-async-storage/async-storage';

// ── Firebase Emulator wiring（demo / 本機口試環境） ──
// 啟用條件：EXPO_PUBLIC_USE_FIREBASE_EMULATOR = '1' | 'true'
// iOS Simulator → localhost；Android Emulator → 10.0.2.2；實體手機 → 開發機 LAN IP
const USE_FIREBASE_EMULATOR =
  process.env.EXPO_PUBLIC_USE_FIREBASE_EMULATOR === '1' ||
  process.env.EXPO_PUBLIC_USE_FIREBASE_EMULATOR === 'true';
const EMULATOR_HOST = process.env.EXPO_PUBLIC_FIREBASE_EMULATOR_HOST || 'localhost';
const EMULATOR_FUNCTIONS_PORT = Number(
  process.env.EXPO_PUBLIC_FIREBASE_EMULATOR_FUNCTIONS_PORT || '5001',
);
const EMULATOR_FIRESTORE_PORT = Number(
  process.env.EXPO_PUBLIC_FIREBASE_EMULATOR_FIRESTORE_PORT || '8080',
);
const EMULATOR_AUTH_PORT = Number(
  process.env.EXPO_PUBLIC_FIREBASE_EMULATOR_AUTH_PORT || '9099',
);
let _emulatorWired = { functions: false, firestore: false, auth: false };

const { getReactNativePersistence } = require('@firebase/auth/dist/rn/index.js') as {
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

const FALLBACK_FIREBASE_CONFIG = {
  apiKey: "mock-api-key",
  authDomain: "mock-project.firebaseapp.com",
  projectId: "mock-project",
  storageBucket: "mock-project.appspot.com",
  messagingSenderId: "000000000000",
  appId: "1:000000000000:web:mock",
} as const;

function getFirebaseConfig(): FirebaseWebConfig {
  const extra = (Constants.expoConfig as any)?.extra ?? (Constants as any)?.manifest?.extra ?? {};
  return (extra.firebase ?? {}) as FirebaseWebConfig;
}

function isMockRuntimeMode(): boolean {
  const mode = String(process.env.EXPO_PUBLIC_DATA_SOURCE_MODE ?? '').toLowerCase();
  const useMockData = String(process.env.EXPO_PUBLIC_USE_MOCK_DATA ?? '').toLowerCase() === 'true';
  return mode === 'mock' || useMockData;
}

function hasRealFirebaseValue(value?: string): boolean {
  if (!value) return false;
  const normalized = value.trim();
  if (!normalized) return false;

  const placeholders = new Set([
    'your_firebase_api_key',
    'your-project.firebaseapp.com',
    'your-project-id',
    'your-project.appspot.com',
    '123456789012',
    '1:123456789012:web:abcdef123456',
  ]);

  return !placeholders.has(normalized);
}

export function hasUsableFirebaseConfig(): boolean {
  const cfg = getFirebaseConfig();
  return (
    hasRealFirebaseValue(cfg.apiKey) &&
    hasRealFirebaseValue(cfg.projectId) &&
    hasRealFirebaseValue(cfg.appId)
  );
}

export function getFirebaseApp() {
  if (getApps().length) return getApps()[0]!;
  const cfg = getFirebaseConfig();

  if (!hasUsableFirebaseConfig()) {
    console.warn(
      '[firebase] Missing Firebase env config. Using local fallback Firebase config for app bootstrap.',
    );

    return initializeApp({
      apiKey: 'mock-api-key',
      authDomain: 'mock-project.firebaseapp.com',
      projectId: 'mock-project',
      storageBucket: 'mock-project.appspot.com',
      messagingSenderId: '000000000000',
      appId: '1:000000000000:web:mock',
    });
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

let _db: ReturnType<typeof getFirestore> | null = null;

export function isFirebaseMockMode(): boolean {
  return !hasUsableFirebaseConfig();
}

export function getDb() {
  if (_db) return _db;
  const app = getFirebaseApp();
  try {
    _db = initializeFirestore(app, {
      experimentalForceLongPolling: true,
      localCache: memoryLocalCache(),
    });
  } catch {
    // Already initialized
    _db = getFirestore(app);
  }
  if (USE_FIREBASE_EMULATOR && !_emulatorWired.firestore) {
    try {
      connectFirestoreEmulator(_db, EMULATOR_HOST, EMULATOR_FIRESTORE_PORT);
      _emulatorWired.firestore = true;
      console.info(`[firebase] Firestore emulator @ ${EMULATOR_HOST}:${EMULATOR_FIRESTORE_PORT}`);
    } catch (e) {
      console.warn('[firebase] Firestore emulator wire failed:', e);
    }
  }
  return _db;
}

export function getCloudFunctionRegion(): string {
  const extra = (Constants.expoConfig as any)?.extra ?? (Constants as any)?.manifest?.extra ?? {};
  return String(
    extra.cloudFunctionRegion ?? process.env.EXPO_PUBLIC_CLOUD_FUNCTION_REGION ?? 'asia-east1',
  );
}

export function getFunctionsInstance(): Functions {
  const functions = getFunctions(getFirebaseApp(), getCloudFunctionRegion());
  if (USE_FIREBASE_EMULATOR && !_emulatorWired.functions) {
    try {
      connectFunctionsEmulator(functions, EMULATOR_HOST, EMULATOR_FUNCTIONS_PORT);
      _emulatorWired.functions = true;
      console.info(`[firebase] Functions emulator @ ${EMULATOR_HOST}:${EMULATOR_FUNCTIONS_PORT}`);
    } catch (e) {
      console.warn('[firebase] Functions emulator wire failed:', e);
    }
  }
  return functions;
}

export function getStorageInstance() {
  return getStorage(getFirebaseApp());
}

export async function uploadAvatar(userId: string, uri: string): Promise<string> {
  const storage = getStorageInstance();
  const fileExtension = uri.split('.').pop()?.toLowerCase() || 'jpg';
  const storageRef = ref(storage, `avatars/${userId}.${fileExtension}`);

  const mimeTypes: Record<string, string> = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    gif: 'image/gif',
    webp: 'image/webp',
    heic: 'image/heic',
  };
  const contentType = mimeTypes[fileExtension] ?? 'image/jpeg';

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
    console.log('[firebase] Token refresh already in progress, skipping');
    return false;
  }

  // 如果在冷卻期內，跳過刷新
  if (lastExhaustedTime > 0) {
    const timeSinceExhausted = Date.now() - lastExhaustedTime;
    if (timeSinceExhausted < TOKEN_REFRESH_CONFIG.cooldownAfterExhausted) {
      console.log('[firebase] In cooldown period, skipping refresh');
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
        console.log('[firebase] Token refreshed successfully');
        return true;
      } catch (e) {
        const isLastAttempt = attempt === TOKEN_REFRESH_CONFIG.maxRetries;
        const delay = TOKEN_REFRESH_CONFIG.retryDelayMs * Math.pow(2, attempt);

        console.warn(`[firebase] Token refresh attempt ${attempt + 1} failed:`, e);

        // 檢查是否是不可恢復的錯誤
        const errorCode = (e as any)?.code;
        const isUnrecoverable = [
          'auth/user-disabled',
          'auth/user-not-found',
          'auth/invalid-user-token',
          'auth/user-token-expired',
        ].includes(errorCode);

        if (isUnrecoverable) {
          console.error('[firebase] Unrecoverable auth error:', errorCode);
          tokenRefreshListeners.forEach((cb) => cb(user, new Error('TOKEN_REFRESH_EXHAUSTED')));
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
            console.error('[firebase] Token refresh failed repeatedly, user may need to re-login');
            tokenRefreshListeners.forEach((cb) => cb(user, new Error('TOKEN_REFRESH_EXHAUSTED')));
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
    console.error('[firebase] Token check failed:', e);
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
    if (e.code === 'auth/already-initialized') {
      _auth = getAuth(app);
    } else {
      throw e;
    }
  }

  if (USE_FIREBASE_EMULATOR && !_emulatorWired.auth && _auth) {
    try {
      connectAuthEmulator(_auth, `http://${EMULATOR_HOST}:${EMULATOR_AUTH_PORT}`, {
        disableWarnings: true,
      });
      _emulatorWired.auth = true;
      console.info(`[firebase] Auth emulator @ ${EMULATOR_HOST}:${EMULATOR_AUTH_PORT}`);
    } catch (err) {
      console.warn('[firebase] Auth emulator wire failed:', err);
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
        console.error('[firebase] Token change error:', error);
        tokenRefreshListeners.forEach((cb) => cb(null, error));
      },
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
    console.error('[firebase] Force refresh token failed:', e);
    throw e;
  }
}
