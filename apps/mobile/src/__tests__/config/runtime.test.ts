jest.mock("../../data", () => ({
  createCachedSource: jest.fn((source) => source),
  configureHybridSource: jest.fn(),
  firebaseSource: { kind: "firebase" },
  hybridSource: { kind: "hybrid" },
  initializeSchoolApis: jest.fn(),
  mockSource: { kind: "mock" },
  setApiEnvironment: jest.fn(),
  setDataSource: jest.fn(),
}));

import {
  DATA_SOURCE_DESIGN_TARGET_MODE,
  DEFAULT_RUNTIME_DATA_SOURCE_MODE,
  getRuntimeDataSourcePolicy,
  parseApiEnvironment,
  parseDataSourceMode,
} from "../../config/runtime";

describe("runtime data source policy", () => {
  it("keeps hybrid as the long-term design target", () => {
    expect(DATA_SOURCE_DESIGN_TARGET_MODE).toBe("hybrid");
  });

  it("uses the runtime default when the mode env is absent or invalid", () => {
    expect(parseDataSourceMode(undefined)).toBe(DEFAULT_RUNTIME_DATA_SOURCE_MODE);
    expect(parseDataSourceMode("invalid-mode")).toBe(DEFAULT_RUNTIME_DATA_SOURCE_MODE);
  });

  it("parses supported data source and api environment values", () => {
    expect(parseDataSourceMode("mock")).toBe("mock");
    expect(parseDataSourceMode("firebase")).toBe("firebase");
    expect(parseDataSourceMode("hybrid")).toBe("hybrid");
    expect(parseApiEnvironment("development")).toBe("development");
    expect(parseApiEnvironment("staging")).toBe("staging");
    expect(parseApiEnvironment("production")).toBe("production");
  });

  it("publishes a policy snapshot for diagnostics", () => {
    const policy = getRuntimeDataSourcePolicy();

    expect(policy.designTargetMode).toBe("hybrid");
    expect(policy.defaultRuntimeMode).toBe(DEFAULT_RUNTIME_DATA_SOURCE_MODE);
    expect(["mock", "firebase", "hybrid"]).toContain(policy.requestedMode);
    expect(["development", "staging", "production"]).toContain(policy.apiEnvironment);
  });
});
