import Constants from 'expo-constants';

import {
  buildReleaseRuntimeConfig,
  normalizeSchoolIntegrationStatus,
  type FeatureAvailability,
  type ReleaseRuntimeConfig,
  type SchoolIntegrationStatus,
  toConfigObject,
} from '@campus/shared/src';

type LegalDocumentType = 'privacy' | 'terms';

type RuntimeReleaseConfig = ReleaseRuntimeConfig;

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
  const expoConfig = toConfigObject(Constants.expoConfig ?? null);
  const manifest = toConfigObject((Constants as unknown as { manifest?: unknown }).manifest);
  return toConfigObject(expoConfig.extra ?? manifest.extra);
}

export function getReleaseConfig(): RuntimeReleaseConfig {
  return buildReleaseRuntimeConfig(getExtra(), {
    developmentFallbackFeatures: DEFAULT_RELEASE_FEATURES,
  });
}

export function areUniversalDevAccountsEnabled(): boolean {
  const extra = getExtra();
  if (typeof extra.enableUniversalDevAccounts === 'boolean') {
    return extra.enableUniversalDevAccounts;
  }

  return getReleaseConfig().appEnv !== 'production';
}

export function getLegalUrl(type: LegalDocumentType): string | null {
  const { legalBaseUrl } = getReleaseConfig();
  if (!legalBaseUrl) return null;
  return `${legalBaseUrl}/${type}`;
}

export function getSchoolIntegrationStatus(
  schoolId: string,
  input?: Partial<SchoolIntegrationStatus> | null,
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

export function isFeatureEnabled(feature: keyof Omit<FeatureAvailability, 'enabled'>): boolean {
  return getReleaseConfig().features[feature];
}

export function isSchoolVisibleInDirectory(
  schoolId: string,
  input?: Partial<SchoolIntegrationStatus> | null,
): boolean {
  return getSchoolIntegrationStatus(schoolId, input).enabled;
}
