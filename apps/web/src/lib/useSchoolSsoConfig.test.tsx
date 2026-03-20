import { describe, expect, it } from "vitest";

import {
  getSchoolSsoFallbackConfig,
  toSchoolSsoState,
} from "./useSchoolSsoConfig";

describe("useSchoolSsoConfig contract helpers", () => {
  it("derives the hook contract from a loaded config", () => {
    const state = toSchoolSsoState(
      {
        schoolId: "tw-demo-uni",
        allowEmailLogin: false,
        ssoConfig: {
          provider: "oidc",
          enabled: true,
          name: "示範大學 SSO",
          authorizationEndpoint: "https://sso.demo.edu.tw/authorize",
        },
      },
      false
    );

    expect(state).toEqual({
      config: {
        schoolId: "tw-demo-uni",
        allowEmailLogin: false,
        ssoConfig: {
          provider: "oidc",
          enabled: true,
          name: "示範大學 SSO",
          authorizationEndpoint: "https://sso.demo.edu.tw/authorize",
        },
      },
      ssoConfig: {
        provider: "oidc",
        enabled: true,
        name: "示範大學 SSO",
        authorizationEndpoint: "https://sso.demo.edu.tw/authorize",
      },
      allowEmailLogin: false,
      availability: {
        provider: "oidc",
        setupStatus: "testing",
        reason: "incomplete",
        message: "此學校的學校登入設定尚未完成",
        missingFields: ["clientId", "clientSecret", "tokenEndpoint"],
        isConfigured: true,
        isEnabled: true,
        isComplete: false,
        isLoginReady: false,
        isProductionReady: false,
      },
      ssoReady: false,
      loading: false,
    });
  });

  it("builds the default fallback config for email login", () => {
    expect(getSchoolSsoFallbackConfig("tw-demo-uni")).toEqual({
      schoolId: "tw-demo-uni",
      allowEmailLogin: true,
      ssoConfig: null,
    });

    expect(
      toSchoolSsoState(getSchoolSsoFallbackConfig("tw-demo-uni"), false)
    ).toEqual({
      config: {
        schoolId: "tw-demo-uni",
        allowEmailLogin: true,
        ssoConfig: null,
      },
      ssoConfig: null,
      allowEmailLogin: true,
      availability: {
        provider: null,
        setupStatus: "draft",
        reason: "not-configured",
        message: "此學校尚未設定學校登入",
        missingFields: [],
        isConfigured: false,
        isEnabled: false,
        isComplete: false,
        isLoginReady: false,
        isProductionReady: false,
      },
      ssoReady: false,
      loading: false,
    });
  });

  it("supports a null fallback when the caller disables email fallback", () => {
    expect(getSchoolSsoFallbackConfig("tw-demo-uni", true)).toBeNull();
    expect(toSchoolSsoState(null, false)).toEqual({
      config: null,
      ssoConfig: null,
      allowEmailLogin: true,
      availability: {
        provider: null,
        setupStatus: "draft",
        reason: "not-configured",
        message: "此學校尚未設定學校登入",
        missingFields: [],
        isConfigured: false,
        isEnabled: false,
        isComplete: false,
        isLoginReady: false,
        isProductionReady: false,
      },
      ssoReady: false,
      loading: false,
    });
  });

  it("marks complete testing configs as ready for login", () => {
    const state = toSchoolSsoState(
      {
        schoolId: "ntust",
        schoolName: "台灣科技大學",
        allowEmailLogin: true,
        setupStatus: "testing",
        ssoConfig: {
          provider: "oidc",
          enabled: true,
          name: "台科大單一登入",
          clientId: "campus-app",
          clientSecret: "secret",
          authorizationEndpoint: "https://portal.ntust.edu.tw/oauth/authorize",
          tokenEndpoint: "https://portal.ntust.edu.tw/oauth/token",
        },
      },
      false
    );

    expect(state.ssoReady).toBe(true);
    expect(state.availability.reason).toBe("not-live");
    expect(state.availability.isLoginReady).toBe(true);
    expect(state.availability.isProductionReady).toBe(false);
  });

  it("marks live and complete SSO configs as production-ready", () => {
    const state = toSchoolSsoState(
      {
        schoolId: "ntust",
        schoolName: "台灣科技大學",
        allowEmailLogin: true,
        setupStatus: "live",
        ssoConfig: {
          provider: "oidc",
          enabled: true,
          name: "台科大單一登入",
          clientId: "campus-app",
          clientSecret: "secret",
          authorizationEndpoint: "https://portal.ntust.edu.tw/oauth/authorize",
          tokenEndpoint: "https://portal.ntust.edu.tw/oauth/token",
        },
      },
      false
    );

    expect(state.ssoReady).toBe(true);
    expect(state.availability.reason).toBe("ready");
    expect(state.availability.isLoginReady).toBe(true);
    expect(state.availability.isProductionReady).toBe(true);
  });
});
