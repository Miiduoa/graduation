const { HttpsError } = require("firebase-functions/v2/https");
const {
  normalizeCafeteriaPilotStatus,
  resolveCafeteriaOrderingMetadata,
} = require("./cafeterias");

describe("cafeteria ordering helpers", () => {
  test("normalizeCafeteriaPilotStatus only accepts pilot/live", () => {
    expect(normalizeCafeteriaPilotStatus("pilot")).toBe("pilot");
    expect(normalizeCafeteriaPilotStatus("live")).toBe("live");
    expect(normalizeCafeteriaPilotStatus("draft")).toBe("inactive");
  });

  test("resolveCafeteriaOrderingMetadata rejects unopened cafeterias", () => {
    expect(() =>
      resolveCafeteriaOrderingMetadata(
        { orderingEnabled: false, pilotStatus: "live" },
        { cafeteriaId: "cafeteria-1", hasActiveOperator: true, HttpsError }
      )
    ).toThrow("店家尚未開通接單");
  });

  test("resolveCafeteriaOrderingMetadata rejects cafeterias without active operators", () => {
    expect(() =>
      resolveCafeteriaOrderingMetadata(
        { orderingEnabled: true, pilotStatus: "pilot", merchantId: "merchant-1" },
        { cafeteriaId: "cafeteria-1", hasActiveOperator: false, HttpsError }
      )
    ).toThrow("店家尚未開通接單");
  });

  test("resolveCafeteriaOrderingMetadata returns canonical merchant and cafeteria names when enabled", () => {
    expect(
      resolveCafeteriaOrderingMetadata(
        {
          orderingEnabled: true,
          pilotStatus: "live",
          merchantId: "merchant-1",
          name: "第一餐廳",
        },
        { cafeteriaId: "cafeteria-1", hasActiveOperator: true, HttpsError }
      )
    ).toEqual({
      pilotStatus: "live",
      orderingEnabled: true,
      merchantId: "merchant-1",
      cafeteriaName: "第一餐廳",
    });
  });
});
