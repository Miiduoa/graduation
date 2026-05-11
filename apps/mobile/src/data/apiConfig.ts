import {
  registerSchoolConfig,
  registerCustomAdapter,
  createNCHUAdapter,
  createPUAdapter,
} from './apiAdapters';

export type ApiEnvironment = 'development' | 'staging' | 'production';

/** 靜宜／PU 適配器：一律打正式 Cloud Functions（與 Firestore 同一專案），不依賴本機 Functions emulator。 */
function twPuCloudFunctionsBaseUrl(): string {
  const trimmedOverride = (process.env.EXPO_PUBLIC_CLOUD_FUNCTION_BASE_URL ?? '').trim();
  if (trimmedOverride) {
    return trimmedOverride.replace(/\/+$/, '');
  }
  const region = (process.env.EXPO_PUBLIC_CLOUD_FUNCTION_REGION ?? 'asia-east1').trim() || 'asia-east1';
  const projectId =
    (process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID ?? 'campus-demo-3a869').trim() || 'campus-demo-3a869';
  return `https://${region}-${projectId}.cloudfunctions.net`;
}

const TW_PU_CF_BASE = twPuCloudFunctionsBaseUrl();

const API_URLS: Record<string, Record<ApiEnvironment, string>> = {
  'tw-nchu': {
    development: 'http://localhost:3000',
    staging: 'https://staging-api.nchu.edu.tw',
    production: 'https://api.nchu.edu.tw',
  },
  'tw-demo-uni': {
    development: 'http://localhost:3001',
    staging: 'https://staging-api.demo.edu.tw',
    production: 'https://api.demo.edu.tw',
  },
  'tw-pu': {
    development: TW_PU_CF_BASE,
    staging: TW_PU_CF_BASE,
    production: TW_PU_CF_BASE,
  },
};

let currentEnvironment: ApiEnvironment = __DEV__ ? 'development' : 'production';

export function setApiEnvironment(env: ApiEnvironment): void {
  currentEnvironment = env;
}

export function getApiEnvironment(): ApiEnvironment {
  return currentEnvironment;
}

export function getApiUrl(schoolId: string): string | null {
  const urls = API_URLS[schoolId];
  if (!urls) return null;
  return urls[currentEnvironment];
}

export function initializeSchoolApis(): void {
  registerCustomAdapter('nchu', () => createNCHUAdapter());
  registerCustomAdapter('pu', () => createPUAdapter());

  const nchuUrl = getApiUrl('tw-nchu');
  if (nchuUrl) {
    registerSchoolConfig({
      schoolId: 'tw-nchu',
      schoolName: '國立中興大學',
      adapterType: 'custom',
      config: {
        baseUrl: nchuUrl,
        timeout: 15000,
        headers: {
          'X-Client-Version': '1.0.0',
          'X-Platform': 'mobile',
        },
      },
      customFactory: createNCHUAdapter,
    });
  }

  const puUrl = getApiUrl('tw-pu');
  if (puUrl) {
    registerSchoolConfig({
      schoolId: 'tw-pu',
      schoolName: '靜宜大學',
      adapterType: 'custom',
      config: {
        baseUrl: puUrl,
        timeout: 15000,
        headers: {
          'X-Client-Version': '1.0.0',
          'X-Platform': 'mobile',
        },
      },
      customFactory: createPUAdapter,
    });
  }

  const demoUrl = getApiUrl('tw-demo-uni');
  if (demoUrl) {
    registerSchoolConfig({
      schoolId: 'tw-demo-uni',
      schoolName: '示範大學',
      adapterType: 'generic',
      config: {
        baseUrl: demoUrl,
        timeout: 10000,
        endpoints: {
          announcements: '/v1/announcements',
          events: '/v1/events',
          menu: '/v1/cafeteria/today',
          pois: '/v1/campus/locations',
          health: '/health',
        },
      },
    });
  }

  console.log(`[ApiConfig] Initialized school APIs for environment: ${currentEnvironment}`);
}

export function addSchoolApiConfig(
  schoolId: string,
  schoolName: string,
  baseUrl: string,
  options?: {
    adapterType?: 'generic' | 'custom';
    timeout?: number;
    apiKey?: string;
    endpoints?: {
      announcements?: string;
      events?: string;
      menu?: string;
      pois?: string;
    };
  },
): void {
  registerSchoolConfig({
    schoolId,
    schoolName,
    adapterType: options?.adapterType || 'generic',
    config: {
      baseUrl,
      timeout: options?.timeout || 10000,
      apiKey: options?.apiKey,
      ...(options?.endpoints && { endpoints: options.endpoints }),
    },
  });
}

export const SUPPORTED_SCHOOLS_WITH_API = [
  {
    id: 'tw-nchu',
    name: '國立中興大學',
    hasRealApi: true,
    capabilities: ['announcements', 'events', 'courses', 'grades', 'menu', 'pois', 'sso'],
  },
  {
    id: 'tw-pu',
    name: '靜宜大學',
    hasRealApi: true,
    capabilities: ['announcements', 'courses', 'grades', 'pois'],
  },
  {
    id: 'tw-demo-uni',
    name: '示範大學',
    hasRealApi: false,
    capabilities: ['announcements', 'events', 'menu', 'pois'],
  },
  {
    id: 'tw-taichung-uni-a',
    name: '台中科技大學（示範A）',
    hasRealApi: false,
    capabilities: [],
  },
  {
    id: 'tw-taichung-uni-b',
    name: '台中大學（示範B）',
    hasRealApi: false,
    capabilities: [],
  },
];

export function getSchoolApiStatus(schoolId: string): {
  hasRealApi: boolean;
  capabilities: string[];
  apiUrl: string | null;
} {
  const school = SUPPORTED_SCHOOLS_WITH_API.find((s) => s.id === schoolId);
  return {
    hasRealApi: school?.hasRealApi ?? false,
    capabilities: school?.capabilities ?? [],
    apiUrl: getApiUrl(schoolId),
  };
}
