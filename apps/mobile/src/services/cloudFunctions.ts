import Constants from 'expo-constants';
import { Platform } from 'react-native';

import { getAuthInstance, hasUsableFirebaseConfig } from '../firebase';

const DEFAULT_DEV_PROJECT_ID = 'campus-demo-3a869';

type CloudFunctionConfig = {
  firebase?: { projectId?: string };
  cloudFunctionRegion?: string;
  cloudFunctionBaseUrl?: string;
  functionsBaseUrl?: string;
  useCloudFunctionEmulator?: boolean | string;
  appEnv?: string;
  allowLocalMockAuth?: boolean;
};

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

function getExpoExtra(): CloudFunctionConfig {
  return ((Constants.expoConfig as { extra?: CloudFunctionConfig } | null)?.extra ??
    {}) as CloudFunctionConfig;
}

function getProjectId(extra: CloudFunctionConfig): string {
  return String(
    extra.firebase?.projectId ?? process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID ?? '',
  ).trim();
}

function getRegion(extra: CloudFunctionConfig): string {
  return String(
    extra.cloudFunctionRegion ?? process.env.EXPO_PUBLIC_CLOUD_FUNCTION_REGION ?? 'asia-east1',
  ).trim();
}

function shouldUseEmulator(extra: CloudFunctionConfig, _projectId: string): boolean {
  const explicit = String(
    extra.useCloudFunctionEmulator ?? process.env.EXPO_PUBLIC_USE_CLOUD_FUNCTION_EMULATOR ?? '',
  )
    .trim()
    .toLowerCase();
  if (explicit === 'true' || explicit === '1') return true;

  const firebaseEmulator = String(process.env.EXPO_PUBLIC_USE_FIREBASE_EMULATOR || '')
    .trim()
    .toLowerCase();
  if (firebaseEmulator === 'true' || firebaseEmulator === '1') return true;

  return false;
}

function getEmulatorHost(): string {
  return Platform.OS === 'android' ? '10.0.2.2' : '127.0.0.1';
}

export function getCloudFunctionBaseUrl(): string {
  const extra = getExpoExtra();
  const projectId = getProjectId(extra);
  const region = getRegion(extra);

  if (shouldUseEmulator(extra, projectId)) {
    return `http://${getEmulatorHost()}:5001/${projectId || DEFAULT_DEV_PROJECT_ID}/${region}`;
  }

  const configuredBaseUrl = String(
    extra.functionsBaseUrl ??
      process.env.EXPO_PUBLIC_FUNCTIONS_BASE_URL ??
      extra.cloudFunctionBaseUrl ??
      process.env.EXPO_PUBLIC_CLOUD_FUNCTION_BASE_URL ??
      '',
  ).trim();

  if (configuredBaseUrl) {
    const trimmed = trimTrailingSlash(configuredBaseUrl);
    return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  }

  const effectiveProjectId = projectId || DEFAULT_DEV_PROJECT_ID;

  if (!effectiveProjectId) {
    throw new Error('Firebase projectId not configured. 無法使用 Cloud Functions。');
  }

  return `https://${region}-${effectiveProjectId}.cloudfunctions.net`;
}

export function getCloudFunctionUrl(functionName: string): string {
  return `${getCloudFunctionBaseUrl()}/${functionName}`;
}

/** 僅用於未部署端點的 404；本機測試不得把輸入的校務帳密送到正式服務。 */
export function canUseHostedSchoolFallback(primaryUrl: string): boolean {
  const extra = getExpoExtra();
  const projectId = getProjectId(extra);
  if (shouldUseEmulator(extra, projectId)) return false;
  if (projectId && projectId !== 'campus-one-tw') return false;
  if (extra.appEnv === 'development' && extra.allowLocalMockAuth === true) return false;
  try {
    const url = new URL(primaryUrl);
    return (
      url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      !['localhost', '[::1]', '::1', '10.0.2.2'].includes(url.hostname) &&
      !url.hostname.endsWith('.localhost') &&
      !/^127\./.test(url.hostname)
    );
  } catch {
    return false;
  }
}

export async function getFirebaseAuthHeaders(): Promise<Record<string, string>> {
  if (!hasUsableFirebaseConfig()) {
    return {};
  }

  const currentUser = getAuthInstance().currentUser;
  if (!currentUser) {
    return {};
  }

  const token = await currentUser.getIdToken();
  return {
    Authorization: `Bearer ${token}`,
  };
}

export function getAIServerBaseUrl(): string {
  const extra = getExpoExtra();
  const configured = String(
    (extra as any).aiServerBaseUrl ?? process.env.EXPO_PUBLIC_AI_SERVER_URL ?? '',
  ).trim();
  if (configured) return trimTrailingSlash(configured);
  const host = Platform.OS === 'android' ? '10.0.2.2' : '127.0.0.1';
  return `http://${host}:8100`;
}
