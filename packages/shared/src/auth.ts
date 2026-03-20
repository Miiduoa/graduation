export type SSOProvider = "oidc" | "cas" | "saml";

export type AuthRole = "student" | "teacher" | "admin" | "staff";

export type SchoolMemberRole = "member" | "editor" | "admin";

export type SSOSetupStatus = "draft" | "testing" | "live";

export type SchoolSsoAvailabilityReason =
  | "not-configured"
  | "disabled"
  | "not-live"
  | "incomplete"
  | "ready";

export type SchoolSSOProviderConfig = {
  provider: SSOProvider;
  name?: string;
  enabled: boolean;
  clientId?: string;
  clientSecret?: string;
  authUrl?: string;
  authorizationEndpoint?: string;
  tokenEndpoint?: string;
  tokenUrl?: string;
  userInfoEndpoint?: string;
  userInfoUrl?: string;
  casServerUrl?: string;
  samlEntryPoint?: string;
  samlIssuer?: string;
  idpSsoUrl?: string;
  idpSloUrl?: string;
  idpCertificate?: string;
  spEntityId?: string;
  spPrivateKey?: string;
  spCertificate?: string;
  assertConsumerUrl?: string;
  scopes?: string[];
  customParams?: Record<string, string>;
  courseApiUrl?: string;
};

export type SchoolSSOConfig = {
  schoolId?: string;
  schoolName?: string;
  emailDomain?: string;
  allowEmailLogin: boolean;
  setupStatus?: SSOSetupStatus;
  ssoConfig: SchoolSSOProviderConfig | null;
};

export type SchoolSsoAvailability = {
  provider: SSOProvider | null;
  setupStatus: SSOSetupStatus;
  reason: SchoolSsoAvailabilityReason;
  message: string;
  missingFields: string[];
  isConfigured: boolean;
  isEnabled: boolean;
  isComplete: boolean;
  isLoginReady: boolean;
  isProductionReady: boolean;
};

export type SSOUserInfo = {
  sub: string;
  email?: string;
  name?: string;
  displayName?: string;
  given_name?: string;
  family_name?: string;
  picture?: string;
  studentId?: string;
  student_id?: string;
  employee_id?: string;
  department?: string;
  ou?: string;
  affiliation?: string;
  userType?: string;
  role?: AuthRole;
};

export type SSOCallbackResult = {
  success: boolean;
  customToken: string;
  uid: string;
  isNewUser: boolean;
  userInfo?: Partial<SSOUserInfo>;
};

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
  return items.length > 0 ? items : undefined;
}

function asStringRecord(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== "object") return undefined;

  const entries = Object.entries(value).filter(
    (entry): entry is [string, string] => typeof entry[0] === "string" && typeof entry[1] === "string"
  );

  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function normalizeSetupStatus(
  value: unknown,
  hasSsoConfig: boolean
): SSOSetupStatus {
  if (value === "draft" || value === "testing" || value === "live") {
    return value;
  }

  return hasSsoConfig ? "testing" : "draft";
}

export function normalizeSchoolSSOConfig(
  value: unknown,
  fallback: Partial<Pick<SchoolSSOConfig, "schoolId" | "schoolName" | "emailDomain">> = {}
): SchoolSSOConfig {
  const input = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const rawConfig =
    input.ssoConfig && typeof input.ssoConfig === "object"
      ? (input.ssoConfig as Record<string, unknown>)
      : null;

  return {
    schoolId: asString(input.schoolId) ?? fallback.schoolId,
    schoolName: asString(input.schoolName) ?? fallback.schoolName,
    emailDomain: asString(input.emailDomain) ?? fallback.emailDomain,
    allowEmailLogin: input.allowEmailLogin !== false,
    setupStatus: normalizeSetupStatus(input.setupStatus, Boolean(rawConfig)),
    ssoConfig: rawConfig
      ? {
          provider: ((asString(rawConfig.provider) as SSOProvider | undefined) ?? "oidc"),
          name: asString(rawConfig.name),
          enabled: rawConfig.enabled !== false,
          clientId: asString(rawConfig.clientId),
          clientSecret: asString(rawConfig.clientSecret),
          authUrl: asString(rawConfig.authUrl) ?? asString(rawConfig.authorizationEndpoint),
          authorizationEndpoint:
            asString(rawConfig.authorizationEndpoint) ?? asString(rawConfig.authUrl),
          tokenEndpoint: asString(rawConfig.tokenEndpoint) ?? asString(rawConfig.tokenUrl),
          tokenUrl: asString(rawConfig.tokenUrl) ?? asString(rawConfig.tokenEndpoint),
          userInfoEndpoint: asString(rawConfig.userInfoEndpoint) ?? asString(rawConfig.userInfoUrl),
          userInfoUrl: asString(rawConfig.userInfoUrl) ?? asString(rawConfig.userInfoEndpoint),
          casServerUrl: asString(rawConfig.casServerUrl),
          samlEntryPoint: asString(rawConfig.samlEntryPoint) ?? asString(rawConfig.idpSsoUrl),
          samlIssuer: asString(rawConfig.samlIssuer),
          idpSsoUrl: asString(rawConfig.idpSsoUrl) ?? asString(rawConfig.samlEntryPoint),
          idpSloUrl: asString(rawConfig.idpSloUrl),
          idpCertificate: asString(rawConfig.idpCertificate),
          spEntityId: asString(rawConfig.spEntityId),
          spPrivateKey: asString(rawConfig.spPrivateKey),
          spCertificate: asString(rawConfig.spCertificate),
          assertConsumerUrl: asString(rawConfig.assertConsumerUrl),
          scopes: asStringArray(rawConfig.scopes),
          customParams: asStringRecord(rawConfig.customParams),
          courseApiUrl: asString(rawConfig.courseApiUrl),
        }
      : null,
  };
}

type RequiredSchoolSsoField = keyof Pick<
  SchoolSSOProviderConfig,
  | "clientId"
  | "clientSecret"
  | "authorizationEndpoint"
  | "tokenEndpoint"
  | "casServerUrl"
  | "samlEntryPoint"
  | "spEntityId"
  | "spPrivateKey"
  | "spCertificate"
  | "assertConsumerUrl"
  | "idpCertificate"
>;

const REQUIRED_PROVIDER_FIELDS: Record<SSOProvider, RequiredSchoolSsoField[]> = {
  oidc: ["clientId", "clientSecret", "authorizationEndpoint", "tokenEndpoint"],
  cas: ["casServerUrl"],
  saml: [
    "samlEntryPoint",
    "spEntityId",
    "spPrivateKey",
    "spCertificate",
    "assertConsumerUrl",
    "idpCertificate",
  ],
};

function hasConfigValue(value: unknown): boolean {
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return Boolean(value);
}

export function getRequiredSchoolSsoFields(
  provider?: SSOProvider | null
): RequiredSchoolSsoField[] {
  if (!provider) return [];
  return [...REQUIRED_PROVIDER_FIELDS[provider]];
}

export function getMissingSchoolSsoFields(
  config?: SchoolSSOProviderConfig | null
): string[] {
  if (!config) return [];

  const requiredFields = getRequiredSchoolSsoFields(config.provider);
  return requiredFields.filter((field) => !hasConfigValue(config[field]));
}

export function getSchoolSsoAvailability(
  config?: SchoolSSOConfig | null
): SchoolSsoAvailability {
  const ssoConfig = config?.ssoConfig ?? null;
  const provider = ssoConfig?.provider ?? null;
  const setupStatus = normalizeSetupStatus(config?.setupStatus, Boolean(ssoConfig));
  const missingFields = getMissingSchoolSsoFields(ssoConfig);
  const isConfigured = Boolean(ssoConfig);
  const isEnabled = Boolean(ssoConfig?.enabled);
  const isComplete = isConfigured && missingFields.length === 0;
  const isLoginReady = isComplete && isEnabled && setupStatus !== "draft";
  const isProductionReady = isComplete && isEnabled && setupStatus === "live";

  if (!ssoConfig) {
    return {
      provider,
      setupStatus,
      reason: "not-configured",
      message: "此學校尚未設定學校登入",
      missingFields,
      isConfigured,
      isEnabled,
      isComplete,
      isLoginReady,
      isProductionReady,
    };
  }

  if (!ssoConfig.enabled) {
    return {
      provider,
      setupStatus,
      reason: "disabled",
      message: "此學校的學校登入已停用",
      missingFields,
      isConfigured,
      isEnabled,
      isComplete,
      isLoginReady,
      isProductionReady,
    };
  }

  if (!isComplete) {
    return {
      provider,
      setupStatus,
      reason: "incomplete",
      message: "此學校的學校登入設定尚未完成",
      missingFields,
      isConfigured,
      isEnabled,
      isComplete,
      isLoginReady,
      isProductionReady,
    };
  }

  if (setupStatus === "draft") {
    return {
      provider,
      setupStatus,
      reason: "not-live",
      message: "此學校的學校登入尚未正式開通",
      missingFields,
      isConfigured,
      isEnabled,
      isComplete,
      isLoginReady,
      isProductionReady,
    };
  }

  if (setupStatus === "testing") {
    return {
      provider,
      setupStatus,
      reason: "not-live",
      message: "此學校的學校登入仍在測試中",
      missingFields,
      isConfigured,
      isEnabled,
      isComplete,
      isLoginReady,
      isProductionReady,
    };
  }

  return {
    provider,
    setupStatus,
    reason: "ready",
    message: "此學校已開通學校登入",
    missingFields,
    isConfigured,
    isEnabled,
    isComplete,
    isLoginReady,
    isProductionReady,
  };
}

export function isSchoolSsoLoginReady(
  config?: SchoolSSOConfig | null
): boolean {
  return getSchoolSsoAvailability(config).isLoginReady;
}

export function isProductionSSOReady(
  config?: SchoolSSOConfig | null
): boolean {
  return getSchoolSsoAvailability(config).isProductionReady;
}

export function normalizeSSOUserInfo(value: unknown): SSOUserInfo | null {
  const input = value && typeof value === "object" ? (value as Record<string, unknown>) : null;
  if (!input) return null;

  const sub = asString(input.sub);
  if (!sub) return null;

  const normalizedRole = normalizeAuthRole(
    asString(input.role) ?? asString(input.userType) ?? asString(input.affiliation)
  );

  return {
    sub,
    email: asString(input.email),
    name: asString(input.name),
    displayName: asString(input.displayName),
    given_name: asString(input.given_name),
    family_name: asString(input.family_name),
    picture: asString(input.picture),
    studentId: asString(input.studentId) ?? asString(input.student_id),
    student_id: asString(input.student_id) ?? asString(input.studentId),
    employee_id: asString(input.employee_id),
    department: asString(input.department) ?? asString(input.ou),
    ou: asString(input.ou) ?? asString(input.department),
    affiliation: asString(input.affiliation),
    userType: asString(input.userType),
    role: normalizedRole,
  };
}

export function normalizeAuthRole(value?: string | null): AuthRole {
  const normalized = (value ?? "").trim().toLowerCase();

  if (normalized.includes("admin") || normalized.includes("principal")) {
    return "admin";
  }
  if (
    normalized.includes("teacher") ||
    normalized.includes("faculty") ||
    normalized.includes("professor")
  ) {
    return "teacher";
  }
  if (normalized.includes("staff") || normalized.includes("employee")) {
    return "staff";
  }

  return "student";
}

export function determineAuthRole(
  userInfo: Pick<SSOUserInfo, "role" | "email" | "department" | "ou" | "affiliation" | "userType">
): AuthRole {
  if (userInfo.role) {
    return normalizeAuthRole(userInfo.role);
  }

  const email = (userInfo.email ?? "").toLowerCase();
  const department = (userInfo.department ?? userInfo.ou ?? "").toLowerCase();
  const type = (userInfo.userType ?? userInfo.affiliation ?? "").toLowerCase();

  if (type.includes("faculty") || type.includes("teacher") || type.includes("staff") || type.includes("employee")) {
    if (department.includes("admin") || department.includes("行政")) {
      return "admin";
    }
    return type.includes("staff") || type.includes("employee") ? "staff" : "teacher";
  }

  if (email.includes("teacher") || email.includes("prof")) {
    return "teacher";
  }

  return "student";
}

export function toSchoolMemberRole(role: AuthRole): SchoolMemberRole {
  if (role === "admin") return "admin";
  if (role === "teacher" || role === "staff") return "editor";
  return "member";
}

export function getSSOProviderName(schoolConfig?: SchoolSSOConfig | null): string {
  if (!schoolConfig?.ssoConfig) return "";
  return schoolConfig.ssoConfig.name || `${schoolConfig.schoolName ?? schoolConfig.schoolId ?? "學校"} SSO`;
}
