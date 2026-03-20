import type { SchoolSSOConfig, SSOProvider } from "@campus/shared/src";

type WebSearchParams = Pick<URLSearchParams, "get">;
type SSOConfig = NonNullable<SchoolSSOConfig["ssoConfig"]>;

export const PENDING_SAML_RESPONSE_KEY = "campus.web.sso.pendingSamlResponse";
const PENDING_WEB_SSO_TRANSACTION_PREFIX = "campus.web.sso.tx.";

export type PendingWebSsoTransaction = {
  transactionId: string;
  provider: SSOProvider;
  callbackUrl: string;
  codeVerifier?: string;
  expiresAt?: string | null;
  createdAt: number;
};

export type WebSsoCallbackParams = {
  provider: SSOProvider | null;
  code: string | null;
  ticket: string | null;
  samlResponse: string | null;
  hasCallbackPayload: boolean;
};

function toBase64(value: string): string {
  if (typeof window !== "undefined" && typeof window.btoa === "function") {
    return window.btoa(value);
  }

  return Buffer.from(value, "utf8").toString("base64");
}

function generateSamlRequestId(): string {
  return `_${Math.random().toString(16).slice(2)}${Date.now().toString(16)}`;
}

export function buildWebSsoStartUrl(
  config: SSOConfig,
  options: {
    redirectUri: string;
    samlAcsUrl?: string;
    samlRelayState?: string;
    state?: string;
    nonce?: string;
    codeChallenge?: string;
  }
): string {
  switch (config.provider) {
    case "oidc": {
      if (!config.clientId || !config.authorizationEndpoint) {
        throw new Error("OIDC 設定不完整");
      }

      const url = new URL(config.authorizationEndpoint);
      url.searchParams.set("client_id", config.clientId);
      url.searchParams.set("redirect_uri", options.redirectUri);
      url.searchParams.set("response_type", "code");
      url.searchParams.set("scope", (config.scopes ?? ["openid", "profile", "email"]).join(" "));

      for (const [key, value] of Object.entries(config.customParams ?? {})) {
        url.searchParams.set(key, value);
      }

      if (options.state) {
        url.searchParams.set("state", options.state);
      }
      if (options.nonce) {
        url.searchParams.set("nonce", options.nonce);
      }
      if (options.codeChallenge) {
        url.searchParams.set("code_challenge", options.codeChallenge);
        url.searchParams.set("code_challenge_method", "S256");
      }

      return url.toString();
    }

    case "cas": {
      if (!config.casServerUrl) {
        throw new Error("CAS 設定不完整");
      }

      const url = new URL("/login", config.casServerUrl);
      url.searchParams.set("service", options.redirectUri);
      return url.toString();
    }

    case "saml": {
      if (!config.samlEntryPoint || !options.samlAcsUrl) {
        throw new Error("SAML 設定不完整");
      }

      const samlRequest = toBase64(
        [
          '<samlp:AuthnRequest xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol"',
          ' xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion"',
          ` ID="${generateSamlRequestId()}"`,
          ' Version="2.0"',
          ` IssueInstant="${new Date().toISOString()}"`,
          ` AssertionConsumerServiceURL="${options.samlAcsUrl}">`,
          `  <saml:Issuer>${config.samlIssuer || "campus-web"}</saml:Issuer>`,
          "</samlp:AuthnRequest>",
        ].join("")
      );

      const url = new URL(config.samlEntryPoint);
      url.searchParams.set("SAMLRequest", samlRequest);
      if (options.samlRelayState) {
        url.searchParams.set("RelayState", options.samlRelayState);
      }
      return url.toString();
    }

    default:
      throw new Error("不支援的 SSO 協議");
  }
}

export function readWebSsoCallbackParams(searchParams: WebSearchParams): WebSsoCallbackParams {
  const providerValue = searchParams.get("provider");
  const provider =
    providerValue === "oidc" || providerValue === "cas" || providerValue === "saml"
      ? providerValue
      : null;
  const code = searchParams.get("code");
  const ticket = searchParams.get("ticket");
  const samlResponse = searchParams.get("SAMLResponse");

  return {
    provider,
    code,
    ticket,
    samlResponse,
    hasCallbackPayload: Boolean(code || ticket || samlResponse),
  };
}

export function getSsoTransactionState(searchParams: WebSearchParams): string | null {
  return searchParams.get("state") || searchParams.get("tx_state");
}

export function buildCurrentSsoRedirectUri(url: URL): string {
  const redirectUrl = new URL(url.toString());
  redirectUrl.searchParams.delete("code");
  redirectUrl.searchParams.delete("ticket");
  redirectUrl.searchParams.delete("SAMLResponse");
  redirectUrl.searchParams.delete("state");
  redirectUrl.searchParams.delete("error");
  return redirectUrl.toString();
}

export function createRandomString(length = 32): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("").slice(0, length);
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });

  return toBase64(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

export async function createPkcePair(): Promise<{ codeVerifier: string; codeChallenge: string }> {
  const verifierBytes = new Uint8Array(48);
  crypto.getRandomValues(verifierBytes);
  const codeVerifier = toBase64Url(verifierBytes);
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(codeVerifier)
  );
  const codeChallenge = toBase64Url(new Uint8Array(digest));

  return {
    codeVerifier,
    codeChallenge,
  };
}

function getPendingTransactionStorageKey(state: string): string {
  return `${PENDING_WEB_SSO_TRANSACTION_PREFIX}${state}`;
}

export function savePendingWebSsoTransaction(
  state: string,
  transaction: Omit<PendingWebSsoTransaction, "createdAt">
): void {
  if (typeof window === "undefined") return;

  window.sessionStorage.setItem(
    getPendingTransactionStorageKey(state),
    JSON.stringify({
      ...transaction,
      createdAt: Date.now(),
    } satisfies PendingWebSsoTransaction)
  );
}

export function clearPendingWebSsoTransaction(state: string): void {
  if (typeof window === "undefined") return;
  window.sessionStorage.removeItem(getPendingTransactionStorageKey(state));
}

export function consumePendingWebSsoTransaction(state: string): PendingWebSsoTransaction | null {
  if (typeof window === "undefined") return null;

  const key = getPendingTransactionStorageKey(state);
  const raw = window.sessionStorage.getItem(key);
  window.sessionStorage.removeItem(key);

  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as PendingWebSsoTransaction;
    if (!parsed?.transactionId || !parsed?.callbackUrl || !parsed?.provider) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function consumePendingSamlResponse(callbackUrl: string): string | null {
  if (typeof window === "undefined") return null;

  try {
    const raw = window.name;
    if (!raw) return null;

    const payload = JSON.parse(raw) as {
      marker?: string;
      callbackUrl?: string;
      samlResponse?: string;
    };

    window.name = "";

    if (
      payload.marker !== PENDING_SAML_RESPONSE_KEY ||
      payload.callbackUrl !== callbackUrl ||
      typeof payload.samlResponse !== "string" ||
      !payload.samlResponse
    ) {
      return null;
    }

    return payload.samlResponse;
  } catch {
    window.name = "";
    return null;
  }
}
