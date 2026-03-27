import Constants from "expo-constants";
import { Platform } from "react-native";

const DEFAULT_DEV_PROJECT_ID = "campus-demo-3a869";

type CloudFunctionConfig = {
  firebase?: { projectId?: string };
  cloudFunctionRegion?: string;
  cloudFunctionBaseUrl?: string;
  useCloudFunctionEmulator?: boolean | string;
};

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function getExpoExtra(): CloudFunctionConfig {
  return ((Constants.expoConfig as { extra?: CloudFunctionConfig } | null)?.extra ??
    {}) as CloudFunctionConfig;
}

function getProjectId(extra: CloudFunctionConfig): string {
  return String(extra.firebase?.projectId ?? process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID ?? "").trim();
}

function getRegion(extra: CloudFunctionConfig): string {
  return String(
    extra.cloudFunctionRegion ?? process.env.EXPO_PUBLIC_CLOUD_FUNCTION_REGION ?? "asia-east1",
  ).trim();
}

function shouldUseEmulator(extra: CloudFunctionConfig, projectId: string): boolean {
  const explicit = String(
    extra.useCloudFunctionEmulator ?? process.env.EXPO_PUBLIC_USE_CLOUD_FUNCTION_EMULATOR ?? "",
  )
    .trim()
    .toLowerCase();

  if (explicit === "true") return true;
  if (explicit === "false") return false;

  return __DEV__ && !projectId;
}

function getEmulatorHost(): string {
  return Platform.OS === "android" ? "10.0.2.2" : "127.0.0.1";
}

export function getCloudFunctionBaseUrl(): string {
  const extra = getExpoExtra();
  const configuredBaseUrl = String(
    extra.cloudFunctionBaseUrl ?? process.env.EXPO_PUBLIC_CLOUD_FUNCTION_BASE_URL ?? "",
  ).trim();

  if (configuredBaseUrl) {
    return trimTrailingSlash(configuredBaseUrl);
  }

  const projectId = getProjectId(extra);
  const region = getRegion(extra);

  if (shouldUseEmulator(extra, projectId)) {
    return `http://${getEmulatorHost()}:5001/${projectId || DEFAULT_DEV_PROJECT_ID}/${region}`;
  }

  if (!projectId) {
    throw new Error("Firebase projectId not configured. 無法使用 Cloud Functions。");
  }

  return `https://${region}-${projectId}.cloudfunctions.net`;
}

export function getCloudFunctionUrl(functionName: string): string {
  return `${getCloudFunctionBaseUrl()}/${functionName}`;
}
