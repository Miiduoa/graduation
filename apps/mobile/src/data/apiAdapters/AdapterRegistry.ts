import type { SchoolApiAdapter, ApiConfig, AdapterCapabilities } from "./types";
import { GenericRestAdapter, type GenericRestConfig } from "./GenericRestAdapter";

export type AdapterFactory = (schoolId: string, schoolName: string) => SchoolApiAdapter;

export type SchoolApiConfig = {
  schoolId: string;
  schoolName: string;
  adapterType: "generic" | "custom";
  config: ApiConfig | GenericRestConfig;
  customFactory?: AdapterFactory;
};

const adapterRegistry = new Map<string, SchoolApiAdapter>();
const configRegistry = new Map<string, SchoolApiConfig>();
const factoryRegistry = new Map<string, AdapterFactory>();

export function registerCustomAdapter(adapterType: string, factory: AdapterFactory): void {
  factoryRegistry.set(adapterType, factory);
}

export function registerSchoolConfig(config: SchoolApiConfig): void {
  configRegistry.set(config.schoolId, config);
}

export async function getAdapter(schoolId: string): Promise<SchoolApiAdapter | null> {
  if (adapterRegistry.has(schoolId)) {
    return adapterRegistry.get(schoolId)!;
  }
  
  const config = configRegistry.get(schoolId);
  if (!config) {
    console.warn(`[AdapterRegistry] No config found for school: ${schoolId}`);
    return null;
  }
  
  const adapter = await createAdapter(config);
  if (adapter) {
    adapterRegistry.set(schoolId, adapter);
  }
  
  return adapter;
}

async function createAdapter(config: SchoolApiConfig): Promise<SchoolApiAdapter | null> {
  let adapter: SchoolApiAdapter;
  
  switch (config.adapterType) {
    case "generic":
      adapter = new GenericRestAdapter(config.schoolId, config.schoolName);
      break;
      
    case "custom":
      if (config.customFactory) {
        adapter = config.customFactory(config.schoolId, config.schoolName);
      } else {
        const factory = factoryRegistry.get(config.schoolId);
        if (!factory) {
          console.error(`[AdapterRegistry] No custom factory for: ${config.schoolId}`);
          return null;
        }
        adapter = factory(config.schoolId, config.schoolName);
      }
      break;
      
    default:
      console.error(`[AdapterRegistry] Unknown adapter type: ${config.adapterType}`);
      return null;
  }
  
  try {
    await adapter.initialize(config.config);
    return adapter;
  } catch (error) {
    console.error(`[AdapterRegistry] Failed to initialize adapter for ${config.schoolId}:`, error);
    return null;
  }
}

export function hasAdapter(schoolId: string): boolean {
  return adapterRegistry.has(schoolId) || configRegistry.has(schoolId);
}

export function getAdapterCapabilities(schoolId: string): AdapterCapabilities | null {
  const adapter = adapterRegistry.get(schoolId);
  if (adapter) {
    return adapter.getCapabilities();
  }
  return null;
}

export function clearAdapter(schoolId: string): void {
  adapterRegistry.delete(schoolId);
}

export function clearAllAdapters(): void {
  adapterRegistry.clear();
}

export function listRegisteredSchools(): string[] {
  return Array.from(new Set([
    ...adapterRegistry.keys(),
    ...configRegistry.keys(),
  ]));
}

export async function checkAdapterHealth(schoolId: string): Promise<boolean> {
  const adapter = await getAdapter(schoolId);
  if (!adapter) {
    return false;
  }
  
  return adapter.isHealthy();
}

export async function checkAllAdaptersHealth(): Promise<Map<string, boolean>> {
  const results = new Map<string, boolean>();
  const schools = listRegisteredSchools();
  
  await Promise.all(
    schools.map(async (schoolId) => {
      const healthy = await checkAdapterHealth(schoolId);
      results.set(schoolId, healthy);
    })
  );
  
  return results;
}
