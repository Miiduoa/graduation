import {
  createCachedSource,
  configureHybridSource,
  firebaseSource,
  hybridSource,
  initializeSchoolApis,
  mockSource,
  setApiEnvironment,
  setDataSource,
  setDataSourceEvidence,
  type ApiEnvironment,
  type DataSource,
} from '../data';

export type DataSourceMode = 'mock' | 'firebase' | 'hybrid';

export const DATA_SOURCE_DESIGN_TARGET_MODE: DataSourceMode = 'hybrid';
// In dev we still want real integration paths (PU scraper, adapters) to run,
// otherwise student-id login succeeds but the app keeps reading demo/mock data.
export const DEFAULT_RUNTIME_DATA_SOURCE_MODE: DataSourceMode = __DEV__ ? 'hybrid' : 'firebase';

export function parseDataSourceMode(raw?: string): DataSourceMode {
  const value = (raw ?? '').trim().toLowerCase();
  if (value === 'firebase' || value === 'hybrid' || value === 'mock') return value;
  return DEFAULT_RUNTIME_DATA_SOURCE_MODE;
}

export function parseApiEnvironment(raw?: string): ApiEnvironment {
  const value = (raw ?? '').trim().toLowerCase();
  if (value === 'development' || value === 'staging' || value === 'production') return value;
  return __DEV__ ? 'development' : 'production';
}

const REQUESTED_DATA_SOURCE_MODE = parseDataSourceMode(process.env.EXPO_PUBLIC_DATA_SOURCE_MODE);
const API_ENV = parseApiEnvironment(process.env.EXPO_PUBLIC_API_ENV);
const HYBRID_TIMEOUT_MS = Number(process.env.EXPO_PUBLIC_HYBRID_TIMEOUT_MS ?? 10000);
const HYBRID_FALLBACK_TO_MOCK =
  (process.env.EXPO_PUBLIC_HYBRID_FALLBACK_TO_MOCK ?? 'true') !== 'false';
const HYBRID_PREFER_REAL_API = (process.env.EXPO_PUBLIC_PREFER_REAL_API ?? 'true') !== 'false';
const FORCE_REAL_DATA = (process.env.EXPO_PUBLIC_FORCE_REAL_DATA ?? 'false') === 'true';

function shouldForceRealDataPath() {
  return API_ENV === 'production' || FORCE_REAL_DATA;
}

function resolveRuntimeMode(): DataSourceMode {
  if (shouldForceRealDataPath() && REQUESTED_DATA_SOURCE_MODE === 'mock') {
    return 'hybrid';
  }
  return REQUESTED_DATA_SOURCE_MODE;
}

const RESOLVED_DATA_SOURCE_MODE = resolveRuntimeMode();

export function getRuntimeDataSourcePolicy() {
  const forceRealDataPath = shouldForceRealDataPath();
  return {
    designTargetMode: DATA_SOURCE_DESIGN_TARGET_MODE,
    defaultRuntimeMode: DEFAULT_RUNTIME_DATA_SOURCE_MODE,
    requestedMode: REQUESTED_DATA_SOURCE_MODE,
    resolvedMode: RESOLVED_DATA_SOURCE_MODE,
    apiEnvironment: API_ENV,
    forceRealDataPath,
    hybridFallbackToMock: forceRealDataPath ? false : HYBRID_FALLBACK_TO_MOCK,
    hybridPreferRealApi: HYBRID_PREFER_REAL_API,
  };
}

function createConfiguredSource(mode: DataSourceMode): DataSource {
  if (mode === 'mock') return mockSource;
  if (mode === 'firebase') return firebaseSource;

  setApiEnvironment(API_ENV);
  initializeSchoolApis();
  const forceRealDataPath = shouldForceRealDataPath();
  configureHybridSource({
    preferRealApi: HYBRID_PREFER_REAL_API,
    fallbackToMock: forceRealDataPath ? false : HYBRID_FALLBACK_TO_MOCK,
    enforceRealDataForCriticalDomains: forceRealDataPath,
    realApiTimeout: Number.isFinite(HYBRID_TIMEOUT_MS) ? HYBRID_TIMEOUT_MS : 10000,
  });
  return hybridSource;
}

export function initializeRuntimeDataSource() {
  const selectedMode = RESOLVED_DATA_SOURCE_MODE;
  try {
    const source = createConfiguredSource(selectedMode);
    setDataSource(createCachedSource(source));
    setDataSourceEvidence({
      mode: selectedMode,
      requestedMode: REQUESTED_DATA_SOURCE_MODE,
      sourceLabel: selectedMode === 'mock' ? 'mock' : 'real',
      forceRealDataPath: shouldForceRealDataPath(),
    });

    console.log(`[DataSource] Using mode: ${selectedMode}`);
    return {
      usingFirebase: selectedMode !== 'mock',
      mode: selectedMode,
      requestedMode: REQUESTED_DATA_SOURCE_MODE,
      forceRealDataPath: shouldForceRealDataPath(),
    };
  } catch (error) {
    console.warn(`[DataSource] Failed to initialize "${selectedMode}".`, error);
    if (shouldForceRealDataPath()) {
      throw error;
    }
    setDataSource(createCachedSource(mockSource));
    setDataSourceEvidence({
      mode: 'mock',
      requestedMode: REQUESTED_DATA_SOURCE_MODE,
      sourceLabel: 'mock',
      forceRealDataPath: false,
    });
    return {
      usingFirebase: false,
      mode: 'mock' as const,
      requestedMode: REQUESTED_DATA_SOURCE_MODE,
      forceRealDataPath: false,
    };
  }
}
