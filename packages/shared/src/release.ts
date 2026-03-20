export type AppEnvironment = "development" | "preview" | "production";

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

type FeatureAvailabilityInput = Partial<FeatureAvailability> | null | undefined;
type SchoolIntegrationStatusInput = Partial<SchoolIntegrationStatus> | null | undefined;

const FEATURE_KEYS = [
  "enabled",
  "sso",
  "courses",
  "grades",
  "payments",
  "widgets",
  "deeplinks",
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

export function normalizeFeatureAvailability(
  input?: FeatureAvailabilityInput,
  fallback?: FeatureAvailabilityInput
): FeatureAvailability {
  const resolved = { ...DEFAULT_FEATURE_AVAILABILITY };

  for (const key of FEATURE_KEYS) {
    const primary = input?.[key];
    const secondary = fallback?.[key];
    resolved[key] =
      typeof primary === "boolean"
        ? primary
        : typeof secondary === "boolean"
          ? secondary
          : DEFAULT_FEATURE_AVAILABILITY[key];
  }

  return resolved;
}

export function normalizeSchoolIntegrationStatus(
  input?: SchoolIntegrationStatusInput,
  fallback?: SchoolIntegrationStatusInput
): SchoolIntegrationStatus {
  return {
    ...normalizeFeatureAvailability(input, fallback),
    verified:
      typeof input?.verified === "boolean"
        ? input.verified
        : typeof fallback?.verified === "boolean"
          ? fallback.verified
          : false,
    acceptanceCompleted:
      typeof input?.acceptanceCompleted === "boolean"
        ? input.acceptanceCompleted
        : typeof fallback?.acceptanceCompleted === "boolean"
          ? fallback.acceptanceCompleted
          : false,
    lastValidatedAt:
      typeof input?.lastValidatedAt === "string"
        ? input.lastValidatedAt
        : typeof fallback?.lastValidatedAt === "string"
          ? fallback.lastValidatedAt
          : null,
  };
}
