import Constants from "expo-constants";

import {
  normalizeFeatureAvailability,
  normalizeSchoolIntegrationStatus,
  type AppEnvironment,
  type FeatureAvailability,
  type SchoolIntegrationStatus,
} from "@campus/shared/src";

type LegalDocumentType = "privacy" | "terms";

type RuntimeReleaseConfig = {
  appEnv: AppEnvironment;
  isReleaseLike: boolean;
  legalBaseUrl: string | null;
  errorReportingEndpoint: string | null;
  releasedSchoolIds: string[];
  deepLinkHost: string | null;
  features: FeatureAvailability;
};

const DEFAULT_RELEASE_FEATURES: FeatureAvailability = {
  enabled: true,
  sso: true,
  courses: true,
  grades: true,
  payments: true,
  widgets: true,
  deeplinks: true,
};

function getExtra(): Record<string, unknown> {
  const expoConfig = Constants.expoConfig as unknown as { extra?: Record<string, unknown> } | null;
  return (
    expoConfig?.extra ??
    ((Constants as unknown as { manifest?: { extra?: Record<string, unknown> } }).manifest?.extra ?? {})
  );
}

function getObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function getString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function getStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function normalizeAppEnv(value: unknown): AppEnvironment {
  if (value === "production" || value === "preview") {
    return value;
  }

  return "development";
}

export function getReleaseConfig(): RuntimeReleaseConfig {
  const extra = getExtra();
  const release = getObject(extra.release);
  const appEnv = normalizeAppEnv(extra.appEnv);
  const isReleaseLike = appEnv === "preview" || appEnv === "production";

  return {
    appEnv,
    isReleaseLike,
    legalBaseUrl: getString(extra.legalBaseUrl),
    errorReportingEndpoint: getString(extra.errorReportingEndpoint),
    releasedSchoolIds: getStringList(release.releasedSchoolIds),
    deepLinkHost: getString(release.deepLinkHost),
    features: normalizeFeatureAvailability(
      getObject(release.features) as Partial<FeatureAvailability>,
      isReleaseLike ? undefined : DEFAULT_RELEASE_FEATURES
    ),
  };
}

export function getLegalUrl(type: LegalDocumentType): string | null {
  const { legalBaseUrl } = getReleaseConfig();
  if (!legalBaseUrl) return null;
  return `${legalBaseUrl}/${type}`;
}

export function getSchoolIntegrationStatus(
  schoolId: string,
  input?: Partial<SchoolIntegrationStatus> | null
): SchoolIntegrationStatus {
  const config = getReleaseConfig();
  const released = !config.isReleaseLike || config.releasedSchoolIds.includes(schoolId);

  return normalizeSchoolIntegrationStatus(input, {
    enabled: released,
    sso: released && config.features.sso,
    courses: released && config.features.courses,
    grades: released && config.features.grades,
    payments: released && config.features.payments,
    widgets: released && config.features.widgets,
    deeplinks: released && config.features.deeplinks,
    verified: released,
    acceptanceCompleted: released,
  });
}

export function isFeatureEnabled(feature: keyof Omit<FeatureAvailability, "enabled">): boolean {
  return getReleaseConfig().features[feature];
}

export function isSchoolVisibleInDirectory(
  schoolId: string,
  input?: Partial<SchoolIntegrationStatus> | null
): boolean {
  return getSchoolIntegrationStatus(schoolId, input).enabled;
}
