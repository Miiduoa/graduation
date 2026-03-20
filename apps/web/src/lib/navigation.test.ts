import { describe, expect, it } from "vitest";

import {
  appendSchoolContext,
  buildSsoCallbackPath,
  extractSchoolContextFromPath,
  sanitizeInternalPath,
} from "./navigation";

const SCHOOL_CONTEXT = {
  code: "DEMO",
  id: "tw-demo-uni",
};

describe("navigation school context helpers", () => {
  it("sanitizes unsafe internal paths", () => {
    expect(sanitizeInternalPath("https://example.com")).toBe("/");
    expect(sanitizeInternalPath("//example.com")).toBe("/");
    expect(sanitizeInternalPath("/course/abc?tab=modules")).toBe("/course/abc?tab=modules");
  });

  it("appends school context without dropping existing search params", () => {
    const url = new URL(
      appendSchoolContext("/login?redirect=%2Fcourse%2Fabc", SCHOOL_CONTEXT),
      "https://campus.local"
    );

    expect(url.pathname).toBe("/login");
    expect(url.searchParams.get("redirect")).toBe("/course/abc");
    expect(url.searchParams.get("school")).toBe("DEMO");
    expect(url.searchParams.get("schoolId")).toBe("tw-demo-uni");
  });

  it("builds an SSO callback path with a safe returnUrl", () => {
    const url = new URL(
      buildSsoCallbackPath(SCHOOL_CONTEXT, "oidc", "/course/abc"),
      "https://campus.local"
    );

    expect(url.pathname).toBe("/sso-callback");
    expect(url.searchParams.get("provider")).toBe("oidc");
    expect(url.searchParams.get("school")).toBe("DEMO");
    expect(url.searchParams.get("schoolId")).toBe("tw-demo-uni");
    expect(url.searchParams.get("returnUrl")).toBe("/course/abc");
  });

  it("extracts school context from internal paths", () => {
    expect(extractSchoolContextFromPath("/login?school=DEMO&schoolId=tw-demo-uni")).toEqual({
      school: "DEMO",
      schoolId: "tw-demo-uni",
    });
  });
});
