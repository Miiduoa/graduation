import { describe, expect, it } from "vitest";

import {
  applyWebAppearancePreferences,
  defaultThemeColor,
  defaultWebPreferences,
  deriveSecondaryThemeColor,
  resolveStoredWebPreferences,
} from "./webPreferences";

describe("webPreferences", () => {
  it("falls back to defaults when stored values are invalid", () => {
    expect(
      resolveStoredWebPreferences({
        general: {
          autoSync: "yes",
          language: "jp",
        },
        appearance: {
          theme: "night",
          fontSize: "x-large",
          themeColor: "blue",
          compactMode: "1",
          animations: null,
        },
        privacy: {
          analytics: "enabled",
        },
      })
    ).toEqual(defaultWebPreferences);
  });

  it("applies appearance preferences to the document root", () => {
    applyWebAppearancePreferences(document, {
      theme: "dark",
      fontSize: "large",
      themeColor: "#FF6B35",
      compactMode: true,
      animations: false,
    });

    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(document.documentElement.getAttribute("data-density")).toBe("compact");
    expect(document.documentElement.getAttribute("data-reduced-motion")).toBe("true");
    expect(document.documentElement.style.getPropertyValue("--brand")).toBe("#FF6B35");
    expect(document.documentElement.style.getPropertyValue("--brand2")).toBe(
      deriveSecondaryThemeColor("#FF6B35")
    );
    expect(document.documentElement.style.getPropertyValue("--font-h1-size")).toBe("26px");
  });

  it("resets to system theme when requested", () => {
    document.documentElement.setAttribute("data-theme", "dark");

    applyWebAppearancePreferences(document, {
      ...defaultWebPreferences.appearance,
      theme: "system",
      themeColor: defaultThemeColor,
    });

    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
  });
});
