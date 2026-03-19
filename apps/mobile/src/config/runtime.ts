import {
  createCachedSource,
  configureHybridSource,
  firebaseSource,
  hybridSource,
  initializeSchoolApis,
  mockSource,
  setApiEnvironment,
  setDataSource,
  type ApiEnvironment,
  type DataSource,
} from "../data";

export type DataSourceMode = "mock" | "firebase" | "hybrid";

function parseDataSourceMode(raw?: string): DataSourceMode {
  const value = (raw ?? "").trim().toLowerCase();
  if (value === "firebase" || value === "hybrid" || value === "mock") return value;
  return __DEV__ ? "mock" : "firebase";
}

function parseApiEnvironment(raw?: string): ApiEnvironment {
  const value = (raw ?? "").trim().toLowerCase();
  if (value === "development" || value === "staging" || value === "production") return value;
  return __DEV__ ? "development" : "production";
}

const REQUESTED_DATA_SOURCE_MODE = parseDataSourceMode(process.env.EXPO_PUBLIC_DATA_SOURCE_MODE);
const API_ENV = parseApiEnvironment(process.env.EXPO_PUBLIC_API_ENV);
const HYBRID_TIMEOUT_MS = Number(process.env.EXPO_PUBLIC_HYBRID_TIMEOUT_MS ?? 10000);
const HYBRID_FALLBACK_TO_MOCK = (process.env.EXPO_PUBLIC_HYBRID_FALLBACK_TO_MOCK ?? "true") !== "false";
const HYBRID_PREFER_REAL_API = (process.env.EXPO_PUBLIC_PREFER_REAL_API ?? "true") !== "false";

function createConfiguredSource(mode: DataSourceMode): DataSource {
  if (mode === "mock") return mockSource;
  if (mode === "firebase") return firebaseSource;

  setApiEnvironment(API_ENV);
  initializeSchoolApis();
  configureHybridSource({
    preferRealApi: HYBRID_PREFER_REAL_API,
    fallbackToMock: HYBRID_FALLBACK_TO_MOCK,
    realApiTimeout: Number.isFinite(HYBRID_TIMEOUT_MS) ? HYBRID_TIMEOUT_MS : 10000,
  });
  return hybridSource;
}

export function initializeRuntimeDataSource() {
  try {
    const source = createConfiguredSource(REQUESTED_DATA_SOURCE_MODE);
    setDataSource(createCachedSource(source));

    console.log(`[DataSource] Using mode: ${REQUESTED_DATA_SOURCE_MODE}`);
    return {
      usingFirebase: REQUESTED_DATA_SOURCE_MODE !== "mock",
    };
  } catch (error) {
    console.warn(
      `[DataSource] Failed to initialize "${REQUESTED_DATA_SOURCE_MODE}", fallback to mock.`,
      error
    );
    setDataSource(createCachedSource(mockSource));
    return {
      usingFirebase: false,
    };
  }
}
