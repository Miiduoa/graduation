import { 
  registerSchoolConfig, 
  registerCustomAdapter,
  createNCHUAdapter,
} from "./apiAdapters";

export type ApiEnvironment = "development" | "staging" | "production";

const API_URLS: Record<string, Record<ApiEnvironment, string>> = {
  "tw-nchu": {
    development: "http://localhost:3000",
    staging: "https://staging-api.nchu.edu.tw",
    production: "https://api.nchu.edu.tw",
  },
  "tw-demo-uni": {
    development: "http://localhost:3001",
    staging: "https://staging-api.demo.edu.tw",
    production: "https://api.demo.edu.tw",
  },
};

let currentEnvironment: ApiEnvironment = __DEV__ ? "development" : "production";

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
  registerCustomAdapter("nchu", () => createNCHUAdapter());
  
  const nchuUrl = getApiUrl("tw-nchu");
  if (nchuUrl) {
    registerSchoolConfig({
      schoolId: "tw-nchu",
      schoolName: "國立中興大學",
      adapterType: "custom",
      config: {
        baseUrl: nchuUrl,
        timeout: 15000,
        headers: {
          "X-Client-Version": "1.0.0",
          "X-Platform": "mobile",
        },
      },
      customFactory: createNCHUAdapter,
    });
  }
  
  const demoUrl = getApiUrl("tw-demo-uni");
  if (demoUrl) {
    registerSchoolConfig({
      schoolId: "tw-demo-uni",
      schoolName: "示範大學",
      adapterType: "generic",
      config: {
        baseUrl: demoUrl,
        timeout: 10000,
        endpoints: {
          announcements: "/v1/announcements",
          events: "/v1/events",
          menu: "/v1/cafeteria/today",
          pois: "/v1/campus/locations",
          health: "/health",
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
    adapterType?: "generic" | "custom";
    timeout?: number;
    apiKey?: string;
    endpoints?: {
      announcements?: string;
      events?: string;
      menu?: string;
      pois?: string;
    };
  }
): void {
  registerSchoolConfig({
    schoolId,
    schoolName,
    adapterType: options?.adapterType || "generic",
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
    id: "tw-nchu",
    name: "國立中興大學",
    hasRealApi: true,
    capabilities: ["announcements", "events", "courses", "grades", "menu", "pois", "sso"],
  },
  {
    id: "tw-demo-uni",
    name: "示範大學",
    hasRealApi: false,
    capabilities: ["announcements", "events", "menu", "pois"],
  },
  {
    id: "tw-taichung-uni-a",
    name: "台中科技大學（示範A）",
    hasRealApi: false,
    capabilities: [],
  },
  {
    id: "tw-taichung-uni-b",
    name: "台中大學（示範B）",
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
