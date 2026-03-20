import type { SchoolSSOConfig, SSOProvider } from "@campus/shared/src";

type WebSearchParams = Pick<URLSearchParams, "get">;
type SSOConfig = NonNullable<SchoolSSOConfig["ssoConfig"]>;

export const PENDING_SAML_RESPONSE_KEY = "campus.web.sso.pendingSamlResponse";

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

export function buildCurrentSsoRedirectUri(url: URL): string {
  const redirectUrl = new URL(url.toString());
  redirectUrl.searchParams.delete("code");
  redirectUrl.searchParams.delete("ticket");
  redirectUrl.searchParams.delete("SAMLResponse");
  redirectUrl.searchParams.delete("error");
  return redirectUrl.toString();
}
