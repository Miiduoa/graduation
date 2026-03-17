import * as AuthSession from "expo-auth-session";
import * as WebBrowser from "expo-web-browser";
import { makeRedirectUri } from "expo-auth-session";
import { signInWithCustomToken } from "firebase/auth";
import { doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";
import Constants from "expo-constants";
import { getAuthInstance, getDb } from "../firebase";

function getCloudFunctionUrl(functionName: string): string {
  const extra = (Constants.expoConfig as any)?.extra ?? {};
  const projectId = extra.firebase?.projectId;
  const region = extra.cloudFunctionRegion ?? "asia-east1";
  
  if (!projectId) {
    throw new Error(
      "Firebase projectId not configured. Set EXPO_PUBLIC_FIREBASE_PROJECT_ID in env."
    );
  }
  
  return `https://${region}-${projectId}.cloudfunctions.net/${functionName}`;
}

WebBrowser.maybeCompleteAuthSession();

export type SSOProvider = "oidc" | "saml" | "cas";

export type SSOConfig = {
  provider: SSOProvider;
  name: string;
  enabled: boolean;
  clientId?: string;
  authorizationEndpoint?: string;
  tokenEndpoint?: string;
  userInfoEndpoint?: string;
  casServerUrl?: string;
  samlEntryPoint?: string;
  samlIssuer?: string;
  scopes?: string[];
  customParams?: Record<string, string>;
};

export type SchoolSSOConfig = {
  schoolId: string;
  schoolName: string;
  ssoConfig: SSOConfig | null;
  emailDomain?: string;
  allowEmailLogin: boolean;
};

const MOCK_SSO_CONFIGS: Record<string, SchoolSSOConfig> = {
  nchu: {
    schoolId: "nchu",
    schoolName: "國立中興大學",
    ssoConfig: {
      provider: "oidc",
      name: "中興大學 SSO",
      enabled: true,
      clientId: "campus-app-nchu",
      authorizationEndpoint: "https://sso.nchu.edu.tw/oauth2/authorize",
      tokenEndpoint: "https://sso.nchu.edu.tw/oauth2/token",
      userInfoEndpoint: "https://sso.nchu.edu.tw/oauth2/userinfo",
      scopes: ["openid", "profile", "email", "student_id"],
    },
    emailDomain: "nchu.edu.tw",
    allowEmailLogin: true,
  },
  nthu: {
    schoolId: "nthu",
    schoolName: "國立清華大學",
    ssoConfig: {
      provider: "cas",
      name: "清華大學 CAS",
      enabled: true,
      casServerUrl: "https://cas.nthu.edu.tw",
    },
    emailDomain: "nthu.edu.tw",
    allowEmailLogin: true,
  },
  ntu: {
    schoolId: "ntu",
    schoolName: "國立臺灣大學",
    ssoConfig: {
      provider: "saml",
      name: "臺大 SAML",
      enabled: true,
      samlEntryPoint: "https://web2.cc.ntu.edu.tw/sso/saml",
      samlIssuer: "campus-app",
    },
    emailDomain: "ntu.edu.tw",
    allowEmailLogin: true,
  },
  demo: {
    schoolId: "demo",
    schoolName: "Demo 學校",
    ssoConfig: null,
    allowEmailLogin: true,
  },
};

function getSchoolConfigLookupKeys(schoolId: string): string[] {
  const normalized = schoolId.trim().toLowerCase();
  const parts = normalized.split("-").filter(Boolean);
  const keys = new Set<string>([normalized]);

  if (parts.length > 1) {
    keys.add(parts.slice(1).join("-"));
    keys.add(parts[parts.length - 1]);
  }

  return [...keys];
}

export async function getSchoolSSOConfig(schoolId: string): Promise<SchoolSSOConfig | null> {
  const db = getDb();
  
  try {
    const configDoc = await getDoc(doc(db, "schools", schoolId, "settings", "sso"));
    if (configDoc.exists()) {
      return configDoc.data() as SchoolSSOConfig;
    }
  } catch (error) {
    console.log("No SSO config in Firestore, using mock:", error);
  }

  for (const key of getSchoolConfigLookupKeys(schoolId)) {
    if (MOCK_SSO_CONFIGS[key]) {
      return MOCK_SSO_CONFIGS[key];
    }
  }

  return null;
}

export function getSSORedirectUri(): string {
  return makeRedirectUri({
    scheme: "campus-app",
    path: "auth/callback",
  });
}

export type OIDCTokenResponse = {
  access_token: string;
  id_token?: string;
  token_type: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
};

export type SSOUserInfo = {
  sub: string;
  email?: string;
  name?: string;
  given_name?: string;
  family_name?: string;
  picture?: string;
  student_id?: string;
  department?: string;
  role?: "student" | "teacher" | "staff";
};

async function performOIDCLogin(config: SSOConfig): Promise<SSOUserInfo | null> {
  if (!config.clientId || !config.authorizationEndpoint) {
    throw new Error("OIDC configuration incomplete");
  }

  const redirectUri = getSSORedirectUri();
  const scopes = config.scopes ?? ["openid", "profile", "email"];

  const discovery = {
    authorizationEndpoint: config.authorizationEndpoint,
    tokenEndpoint: config.tokenEndpoint,
  };

  const request = new AuthSession.AuthRequest({
    clientId: config.clientId,
    scopes,
    redirectUri,
    responseType: AuthSession.ResponseType.Code,
    usePKCE: true,
    extraParams: config.customParams,
  });

  const result = await request.promptAsync(discovery);

  if (result.type !== "success" || !result.params.code) {
    console.log("OIDC auth failed:", result);
    return null;
  }

  if (!config.tokenEndpoint) {
    throw new Error("Token endpoint not configured");
  }

  const tokenResponse = await AuthSession.exchangeCodeAsync(
    {
      clientId: config.clientId,
      code: result.params.code,
      redirectUri,
      extraParams: {
        code_verifier: request.codeVerifier ?? "",
      },
    },
    discovery
  );

  if (!tokenResponse.accessToken) {
    throw new Error("Failed to get access token");
  }

  if (config.userInfoEndpoint) {
    const userInfoResponse = await fetchWithTimeout(config.userInfoEndpoint, {
      headers: {
        Authorization: `Bearer ${tokenResponse.accessToken}`,
      },
    });

    if (userInfoResponse.ok) {
      return await userInfoResponse.json();
    }
  }

  if (tokenResponse.idToken) {
    const payload = decodeJWTPayload(tokenResponse.idToken);
    return payload as SSOUserInfo;
  }

  return {
    sub: "unknown",
    email: undefined,
  };
}

async function performCASLogin(config: SSOConfig): Promise<SSOUserInfo | null> {
  if (!config.casServerUrl) {
    throw new Error("CAS server URL not configured");
  }

  const redirectUri = getSSORedirectUri();
  const serviceUrl = encodeURIComponent(redirectUri);
  const casLoginUrl = `${config.casServerUrl}/login?service=${serviceUrl}`;

  const result = await WebBrowser.openAuthSessionAsync(casLoginUrl, redirectUri);

  if (result.type !== "success" || !result.url) {
    console.log("CAS auth failed:", result);
    return null;
  }

  const url = new URL(result.url);
  const ticket = url.searchParams.get("ticket");

  if (!ticket) {
    throw new Error("No CAS ticket received");
  }

  const validateUrl = `${config.casServerUrl}/serviceValidate?service=${serviceUrl}&ticket=${ticket}&format=json`;
  const validateResponse = await fetchWithTimeout(validateUrl);
  
  if (!validateResponse.ok) {
    throw new SSOError("CAS 票證驗證失敗", "SSO_VALIDATION_FAILED");
  }

  const validateData = await validateResponse.json();
  const serviceResponse = validateData?.serviceResponse;

  if (serviceResponse?.authenticationFailure) {
    throw new Error(serviceResponse.authenticationFailure.description || "CAS authentication failed");
  }

  const attributes = serviceResponse?.authenticationSuccess?.attributes || {};
  const user = serviceResponse?.authenticationSuccess?.user;

  return {
    sub: user || attributes.uid || "unknown",
    email: attributes.email || attributes.mail,
    name: attributes.displayName || attributes.cn,
    student_id: attributes.studentId || attributes.employeeNumber,
    department: attributes.department || attributes.ou,
    role: attributes.eduPersonAffiliation?.includes("student") ? "student" : 
          attributes.eduPersonAffiliation?.includes("faculty") ? "teacher" : "staff",
  };
}

async function performSAMLLogin(config: SSOConfig): Promise<SSOUserInfo | null> {
  if (!config.samlEntryPoint) {
    throw new Error("SAML entry point not configured");
  }

  const redirectUri = getSSORedirectUri();
  
  const samlRequest = btoa(`
    <samlp:AuthnRequest
      xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol"
      xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion"
      ID="_${generateRandomId()}"
      Version="2.0"
      IssueInstant="${new Date().toISOString()}"
      AssertionConsumerServiceURL="${redirectUri}">
      <saml:Issuer>${config.samlIssuer || "campus-app"}</saml:Issuer>
    </samlp:AuthnRequest>
  `.trim());

  const samlLoginUrl = `${config.samlEntryPoint}?SAMLRequest=${encodeURIComponent(samlRequest)}`;

  const result = await WebBrowser.openAuthSessionAsync(samlLoginUrl, redirectUri);

  if (result.type !== "success" || !result.url) {
    console.log("SAML auth failed:", result);
    return null;
  }

  const url = new URL(result.url);
  const samlResponse = url.searchParams.get("SAMLResponse");

  if (!samlResponse) {
    throw new Error("No SAML response received");
  }

  const decodedResponse = atob(samlResponse);
  const userInfo = parseSAMLResponse(decodedResponse);

  return userInfo;
}

function parseSAMLResponse(xml: string): SSOUserInfo {
  const getAttributeValue = (name: string): string | undefined => {
    const regex = new RegExp(`<saml:Attribute Name="${name}"[^>]*>\\s*<saml:AttributeValue[^>]*>([^<]+)</saml:AttributeValue>`, "i");
    const match = xml.match(regex);
    return match?.[1];
  };

  const nameIdMatch = xml.match(/<saml:NameID[^>]*>([^<]+)<\/saml:NameID>/i);
  const sub = nameIdMatch?.[1] || "unknown";

  return {
    sub,
    email: getAttributeValue("email") || getAttributeValue("mail"),
    name: getAttributeValue("displayName") || getAttributeValue("cn"),
    student_id: getAttributeValue("studentId") || getAttributeValue("employeeNumber"),
    department: getAttributeValue("department") || getAttributeValue("ou"),
  };
}

function decodeJWTPayload(token: string): Record<string, any> {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return {};
    
    const payload = parts[1];
    const decoded = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
    return JSON.parse(decoded);
  } catch {
    return {};
  }
}

/**
 * 產生加密安全的隨機 ID
 * 使用 crypto.getRandomValues 而非 Math.random
 */
function generateRandomId(): string {
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    const array = new Uint8Array(16);
    crypto.getRandomValues(array);
    return Array.from(array, byte => byte.toString(16).padStart(2, "0")).join("");
  }
  // 降級方案：在不支援 crypto 的環境中使用 Math.random
  // 並使用時間戳增加熵
  const timestamp = Date.now().toString(36);
  const random1 = Math.random().toString(36).substring(2, 15);
  const random2 = Math.random().toString(36).substring(2, 15);
  return `${timestamp}${random1}${random2}`;
}

// 請求超時配置
const REQUEST_TIMEOUT_MS = 30000; // 30 秒

/**
 * 帶超時的 fetch 請求
 */
async function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
  timeoutMs: number = REQUEST_TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    return response;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new SSOError("請求逾時，請稍後再試", "SSO_TIMEOUT");
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

export type SSOErrorCode = 
  | "SSO_NOT_CONFIGURED"
  | "SSO_DISABLED"
  | "SSO_CANCELLED"
  | "SSO_TIMEOUT"
  | "SSO_NETWORK_ERROR"
  | "SSO_INVALID_RESPONSE"
  | "SSO_TOKEN_ERROR"
  | "SSO_VALIDATION_FAILED"
  | "SSO_UNSUPPORTED_PROVIDER"
  | "SSO_UNKNOWN_ERROR";

export class SSOError extends Error {
  constructor(
    message: string,
    public readonly code: SSOErrorCode,
    public readonly originalError?: unknown
  ) {
    super(message);
    this.name = "SSOError";
  }

  static fromUnknown(error: unknown): SSOError {
    if (error instanceof SSOError) return error;
    
    const message = error instanceof Error ? error.message : String(error);
    
    if (message.includes("cancelled") || message.includes("dismiss")) {
      return new SSOError("登入已取消", "SSO_CANCELLED", error);
    }
    if (message.includes("network") || message.includes("fetch")) {
      return new SSOError("網路連線失敗，請檢查網路狀態", "SSO_NETWORK_ERROR", error);
    }
    if (message.includes("timeout")) {
      return new SSOError("登入逾時，請稍後再試", "SSO_TIMEOUT", error);
    }
    
    return new SSOError(message || "登入失敗，請稍後再試", "SSO_UNKNOWN_ERROR", error);
  }

  get userFriendlyMessage(): string {
    switch (this.code) {
      case "SSO_NOT_CONFIGURED":
        return "此學校尚未設定單一登入";
      case "SSO_DISABLED":
        return "此學校的單一登入功能已停用";
      case "SSO_CANCELLED":
        return "登入已取消";
      case "SSO_TIMEOUT":
        return "登入逾時，請稍後再試";
      case "SSO_NETWORK_ERROR":
        return "網路連線失敗，請檢查網路狀態";
      case "SSO_INVALID_RESPONSE":
        return "伺服器回應異常，請稍後再試";
      case "SSO_TOKEN_ERROR":
        return "身份驗證失敗，請稍後再試";
      case "SSO_VALIDATION_FAILED":
        return "身份驗證失敗，請確認帳號密碼是否正確";
      case "SSO_UNSUPPORTED_PROVIDER":
        return "不支援的登入方式";
      default:
        return this.message || "登入失敗，請稍後再試";
    }
  }

  get isRetryable(): boolean {
    return [
      "SSO_TIMEOUT",
      "SSO_NETWORK_ERROR",
      "SSO_UNKNOWN_ERROR",
    ].includes(this.code);
  }
}

export async function performSSOLogin(schoolId: string): Promise<SSOUserInfo | null> {
  let config: SchoolSSOConfig | null;
  
  try {
    config = await getSchoolSSOConfig(schoolId);
  } catch (error) {
    throw new SSOError(
      "無法載入學校 SSO 設定",
      "SSO_NETWORK_ERROR",
      error
    );
  }
  
  if (!config?.ssoConfig) {
    throw new SSOError(
      "此學校尚未設定單一登入",
      "SSO_NOT_CONFIGURED"
    );
  }

  if (!config.ssoConfig.enabled) {
    throw new SSOError(
      "此學校的單一登入功能已停用",
      "SSO_DISABLED"
    );
  }

  const ssoConfig = config.ssoConfig;

  try {
    switch (ssoConfig.provider) {
      case "oidc":
        return await performOIDCLogin(ssoConfig);
      case "cas":
        return await performCASLogin(ssoConfig);
      case "saml":
        return await performSAMLLogin(ssoConfig);
      default:
        throw new SSOError(
          `不支援的 SSO 協議: ${ssoConfig.provider}`,
          "SSO_UNSUPPORTED_PROVIDER"
        );
    }
  } catch (error) {
    throw SSOError.fromUnknown(error);
  }
}

export async function linkSSOToFirebase(
  schoolId: string,
  ssoUserInfo: SSOUserInfo
): Promise<{ uid: string; isNewUser: boolean }> {
  const db = getDb();
  
  // 檢查是否已經有 SSO 連結
  let ssoLinkDoc;
  try {
    const ssoLinkRef = doc(db, "ssoLinks", `${schoolId}_${ssoUserInfo.sub}`);
    ssoLinkDoc = await getDoc(ssoLinkRef);

    if (ssoLinkDoc.exists()) {
      const existingUid = ssoLinkDoc.data().firebaseUid;
      
      // 驗證已連結的使用者是否仍然有效
      const auth = getAuthInstance();
      try {
        const customTokenResponse = await fetchWithTimeout(
          getCloudFunctionUrl("createCustomToken"),
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              schoolId,
              ssoSub: ssoUserInfo.sub,
              email: ssoUserInfo.email,
              existingUid,
            }),
          }
        );

        if (customTokenResponse.ok) {
          const { customToken } = await customTokenResponse.json();
          await signInWithCustomToken(auth, customToken);
          return { uid: existingUid, isNewUser: false };
        }
      } catch (error) {
        console.warn("[sso] Failed to sign in with existing link:", error);
      }
    }
  } catch (error) {
    console.warn("[sso] Failed to check existing SSO link:", error);
  }

  const auth = getAuthInstance();
  
  // 建立新的 custom token
  let customTokenResponse;
  try {
    customTokenResponse = await fetchWithTimeout(
      getCloudFunctionUrl("createCustomToken"),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          schoolId,
          ssoSub: ssoUserInfo.sub,
          email: ssoUserInfo.email,
          name: ssoUserInfo.name,
          studentId: ssoUserInfo.student_id,
          department: ssoUserInfo.department,
          role: ssoUserInfo.role,
        }),
      }
    );
  } catch (error) {
    if (error instanceof SSOError) throw error;
    throw new SSOError(
      "無法連接認證伺服器",
      "SSO_NETWORK_ERROR",
      error
    );
  }

  if (!customTokenResponse.ok) {
    let errorMessage = "身份驗證失敗";
    try {
      const errorData = await customTokenResponse.json();
      errorMessage = errorData.error || errorMessage;
    } catch {}
    
    throw new SSOError(
      errorMessage,
      "SSO_TOKEN_ERROR"
    );
  }

  let tokenData;
  try {
    tokenData = await customTokenResponse.json();
  } catch (error) {
    throw new SSOError(
      "伺服器回應格式錯誤",
      "SSO_INVALID_RESPONSE",
      error
    );
  }

  const { customToken, uid, isNewUser } = tokenData;

  try {
    await signInWithCustomToken(auth, customToken);
  } catch (error) {
    throw new SSOError(
      "登入失敗，請稍後再試",
      "SSO_TOKEN_ERROR",
      error
    );
  }

  // 儲存 SSO 連結（允許失敗但記錄警告）
  try {
    const ssoLinkRef = doc(db, "ssoLinks", `${schoolId}_${ssoUserInfo.sub}`);
    await setDoc(ssoLinkRef, {
      schoolId,
      ssoSub: ssoUserInfo.sub,
      ssoProvider: (await getSchoolSSOConfig(schoolId))?.ssoConfig?.provider,
      firebaseUid: uid,
      email: ssoUserInfo.email,
      linkedAt: serverTimestamp(),
    });
  } catch (error) {
    console.warn("[sso] Failed to save SSO link:", error);
  }

  // 更新使用者資料（允許失敗但記錄警告）
  try {
    const userRef = doc(db, "users", uid);
    await setDoc(
      userRef,
      {
        schoolId,
        email: ssoUserInfo.email,
        displayName: ssoUserInfo.name,
        studentId: ssoUserInfo.student_id,
        department: ssoUserInfo.department,
        role: ssoUserInfo.role === "teacher" ? "teacher" : "student",
        ssoLinked: true,
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
  } catch (error) {
    console.warn("[sso] Failed to update user profile:", error);
  }

  return { uid, isNewUser };
}

export async function unlinkSSO(schoolId: string, uid: string): Promise<void> {
  const db = getDb();
  
  const userRef = doc(db, "users", uid);
  const userDoc = await getDoc(userRef);
  
  if (!userDoc.exists()) {
    throw new Error("User not found");
  }

  // 查詢該使用者在此學校的所有 SSO 連結
  // ssoLinks 文件的 ID 格式是 `${schoolId}_${ssoSub}`，需要通過查詢找到
  const { collection, query, where, getDocs, deleteDoc: deleteDocFn } = await import("firebase/firestore");
  
  const ssoLinksRef = collection(db, "ssoLinks");
  const q = query(
    ssoLinksRef,
    where("schoolId", "==", schoolId),
    where("firebaseUid", "==", uid)
  );
  
  const ssoLinksSnapshot = await getDocs(q);
  
  // 刪除所有匹配的 SSO 連結
  const deletePromises = ssoLinksSnapshot.docs.map((doc) => deleteDocFn(doc.ref));
  await Promise.all(deletePromises);
  
  if (ssoLinksSnapshot.empty) {
    console.warn("[sso] No SSO links found for user:", uid, "school:", schoolId);
  } else {
    console.log("[sso] Deleted", ssoLinksSnapshot.size, "SSO link(s) for user:", uid);
  }

  await setDoc(
    userRef,
    {
      ssoLinked: false,
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
}

export function isSSOAvailable(schoolConfig: SchoolSSOConfig | null): boolean {
  return !!schoolConfig?.ssoConfig?.enabled;
}

export function getSSOProviderName(schoolConfig: SchoolSSOConfig | null): string {
  if (!schoolConfig?.ssoConfig) return "";
  return schoolConfig.ssoConfig.name || `${schoolConfig.schoolName} SSO`;
}

export const ssoService = {
  async authenticate(
    provider: SSOProvider,
    config: {
      authUrl: string;
      clientId: string;
      redirectUri: string;
      schoolId: string;
    }
  ): Promise<{ success: boolean; accessToken?: string; error?: string }> {
    try {
      const authUrl = `${config.authUrl}?client_id=${encodeURIComponent(config.clientId)}&redirect_uri=${encodeURIComponent(config.redirectUri)}&response_type=token`;
      const authSession = AuthSession as typeof AuthSession & {
        startAsync?: (options: { authUrl: string; returnUrl?: string }) => Promise<any>;
      };
      const result = authSession.startAsync
        ? await authSession.startAsync({
            authUrl,
            returnUrl: config.redirectUri,
          })
        : await WebBrowser.openAuthSessionAsync(authUrl, config.redirectUri);

      if (result.type !== "success") {
        return { success: false, error: `${provider.toUpperCase()} 認證未完成` };
      }

      const callbackUrl = (result as any).url;
      const params = (result as any).params ?? (() => {
        if (!callbackUrl) {
          return {};
        }

        const parsedUrl = new URL(callbackUrl);
        const queryParams = new URLSearchParams(parsedUrl.search);
        const hashParams = new URLSearchParams(parsedUrl.hash.startsWith("#") ? parsedUrl.hash.slice(1) : parsedUrl.hash);
        return Object.fromEntries([...queryParams.entries(), ...hashParams.entries()]);
      })();

      return {
        success: true,
        accessToken: params.access_token ?? params.token ?? params.code,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "SSO 認證失敗",
      };
    }
  },
};
