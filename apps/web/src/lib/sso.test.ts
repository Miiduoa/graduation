import { describe, expect, it } from "vitest";

import {
  buildCurrentSsoRedirectUri,
  buildWebSsoStartUrl,
  getSsoTransactionState,
  readWebSsoCallbackParams,
} from "./sso";

describe("web SSO helpers", () => {
  it("builds an OIDC authorization url", () => {
    const url = new URL(
      buildWebSsoStartUrl(
        {
          provider: "oidc",
          enabled: true,
          clientId: "campus-web",
          authorizationEndpoint: "https://sso.demo.edu.tw/oauth2/authorize",
          scopes: ["openid", "profile", "email"],
          customParams: {
            prompt: "login",
          },
        },
        {
          redirectUri: "https://campus-app.web.app/sso-callback?school=DEMO&schoolId=tw-demo-uni&provider=oidc",
          state: "tx-state",
          nonce: "tx-nonce",
          codeChallenge: "pkce-challenge",
        }
      )
    );

    expect(url.origin).toBe("https://sso.demo.edu.tw");
    expect(url.pathname).toBe("/oauth2/authorize");
    expect(url.searchParams.get("client_id")).toBe("campus-web");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("scope")).toBe("openid profile email");
    expect(url.searchParams.get("prompt")).toBe("login");
    expect(url.searchParams.get("state")).toBe("tx-state");
    expect(url.searchParams.get("nonce")).toBe("tx-nonce");
    expect(url.searchParams.get("code_challenge")).toBe("pkce-challenge");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
  });

  it("builds a CAS login url", () => {
    const url = new URL(
      buildWebSsoStartUrl(
        {
          provider: "cas",
          enabled: true,
          casServerUrl: "https://cas.demo.edu.tw",
        },
        {
          redirectUri: "https://campus-app.web.app/sso-callback?school=DEMO&schoolId=tw-demo-uni&provider=cas",
        }
      )
    );

    expect(url.origin).toBe("https://cas.demo.edu.tw");
    expect(url.pathname).toBe("/login");
    expect(url.searchParams.get("service")).toContain("/sso-callback");
  });

  it("reads callback params from the query string", () => {
    const params = readWebSsoCallbackParams(
      new URLSearchParams({
        provider: "oidc",
        code: "auth-code",
      })
    );

    expect(params).toEqual({
      provider: "oidc",
      code: "auth-code",
      ticket: null,
      samlResponse: null,
      hasCallbackPayload: true,
    });
  });

  it("reconstructs the original redirect uri without callback params", () => {
    const redirectUri = buildCurrentSsoRedirectUri(
      new URL(
        "https://campus-app.web.app/sso-callback?school=DEMO&schoolId=tw-demo-uni&provider=oidc&returnUrl=%2Fcourse%2F123&code=abc&state=oauth-state&error=ignored"
      )
    );

    expect(redirectUri).toBe(
      "https://campus-app.web.app/sso-callback?school=DEMO&schoolId=tw-demo-uni&provider=oidc&returnUrl=%2Fcourse%2F123"
    );
  });

  it("prefers OAuth state and falls back to tx_state", () => {
    expect(
      getSsoTransactionState(
        new URLSearchParams({
          state: "oauth-state",
          tx_state: "fallback-state",
        })
      )
    ).toBe("oauth-state");

    expect(
      getSsoTransactionState(
        new URLSearchParams({
          tx_state: "fallback-state",
        })
      )
    ).toBe("fallback-state");
  });
});
