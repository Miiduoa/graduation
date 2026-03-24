export type AppEnvironment = 'development' | 'preview' | 'production';

export type FeatureAvailability = {
  enabled: boolean;
  sso: boolean;
  courses: boolean;
  grades: boolean;
  payments: boolean;
  widgets: boolean;
  deeplinks: boolean;
};

export type SchoolIntegrationStatus = FeatureAvailability & {
  verified: boolean;
  acceptanceCompleted: boolean;
  lastValidatedAt?: string | null;
};

export type ReleaseRuntimeConfig = {
  appEnv: AppEnvironment;
  isReleaseLike: boolean;
  legalBaseUrl: string | null;
  errorReportingEndpoint: string | null;
  releasedSchoolIds: string[];
  deepLinkHost: string | null;
  features: FeatureAvailability;
};

type FeatureAvailabilityInput = Partial<FeatureAvailability> | null | undefined;
type SchoolIntegrationStatusInput = Partial<SchoolIntegrationStatus> | null | undefined;

const FEATURE_KEYS = [
  'enabled',
  'sso',
  'courses',
  'grades',
  'payments',
  'widgets',
  'deeplinks',
] as const;

const DEFAULT_FEATURE_AVAILABILITY: FeatureAvailability = {
  enabled: true,
  sso: false,
  courses: false,
  grades: false,
  payments: false,
  widgets: false,
  deeplinks: false,
};

export function toConfigObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

export function toOptionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

export function toStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  return value
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function normalizeAppEnvironment(value: unknown): AppEnvironment {
  if (value === 'production' || value === 'preview') {
    return value;
  }

  return 'development';
}

export function normalizeFeatureAvailability(
  input?: FeatureAvailabilityInput,
  fallback?: FeatureAvailabilityInput,
): FeatureAvailability {
  const resolved = { ...DEFAULT_FEATURE_AVAILABILITY };

  for (const key of FEATURE_KEYS) {
    const primary = input?.[key];
    const secondary = fallback?.[key];
    resolved[key] =
      typeof primary === 'boolean'
        ? primary
        : typeof secondary === 'boolean'
          ? secondary
          : DEFAULT_FEATURE_AVAILABILITY[key];
  }

  return resolved;
}

export function normalizeSchoolIntegrationStatus(
  input?: SchoolIntegrationStatusInput,
  fallback?: SchoolIntegrationStatusInput,
): SchoolIntegrationStatus {
  return {
    ...normalizeFeatureAvailability(input, fallback),
    verified:
      typeof input?.verified === 'boolean'
        ? input.verified
        : typeof fallback?.verified === 'boolean'
          ? fallback.verified
          : false,
    acceptanceCompleted:
      typeof input?.acceptanceCompleted === 'boolean'
        ? input.acceptanceCompleted
        : typeof fallback?.acceptanceCompleted === 'boolean'
          ? fallback.acceptanceCompleted
          : false,
    lastValidatedAt:
      typeof input?.lastValidatedAt === 'string'
        ? input.lastValidatedAt
        : typeof fallback?.lastValidatedAt === 'string'
          ? fallback.lastValidatedAt
          : null,
  };
}

export function buildReleaseRuntimeConfig(
  input: unknown,
  options: {
    developmentFallbackFeatures?: FeatureAvailabilityInput;
  } = {},
): ReleaseRuntimeConfig {
  const extra = toConfigObject(input);
  const release = toConfigObject(extra.release);
  const appEnv = normalizeAppEnvironment(extra.appEnv);
  const isReleaseLike = appEnv === 'preview' || appEnv === 'production';

  return {
    appEnv,
    isReleaseLike,
    legalBaseUrl: toOptionalString(extra.legalBaseUrl),
    errorReportingEndpoint: toOptionalString(extra.errorReportingEndpoint),
    releasedSchoolIds: toStringList(release.releasedSchoolIds),
    deepLinkHost: toOptionalString(release.deepLinkHost),
    features: normalizeFeatureAvailability(
      toConfigObject(release.features) as Partial<FeatureAvailability>,
      isReleaseLike ? undefined : options.developmentFallbackFeatures,
    ),
  };
}
