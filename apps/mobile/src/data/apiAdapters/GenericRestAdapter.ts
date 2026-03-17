import { BaseApiAdapter } from "./BaseAdapter";
import type { AdapterCapabilities, ApiConfig, RawAnnouncementData, RawEventData, RawMenuData, RawPoiData } from "./types";
import type { Announcement, ClubEvent, MenuItem, Poi } from "../types";

export type GenericRestConfig = ApiConfig & {
  endpoints?: {
    announcements?: string;
    events?: string;
    menu?: string;
    pois?: string;
    health?: string;
  };
  dataExtractor?: {
    announcements?: (response: unknown) => RawAnnouncementData[];
    events?: (response: unknown) => RawEventData[];
    menu?: (response: unknown) => RawMenuData[];
    pois?: (response: unknown) => RawPoiData[];
  };
};

export class GenericRestAdapter extends BaseApiAdapter {
  readonly schoolId: string;
  readonly schoolName: string;
  readonly apiVersion: string = "1.0";
  
  private endpoints: NonNullable<GenericRestConfig["endpoints"]>;
  private extractors: NonNullable<GenericRestConfig["dataExtractor"]>;
  
  constructor(schoolId: string, schoolName: string) {
    super();
    this.schoolId = schoolId;
    this.schoolName = schoolName;
    
    this.endpoints = {
      announcements: "/announcements",
      events: "/events",
      menu: "/menu",
      pois: "/pois",
      health: "/health",
    };
    
    this.extractors = {};
  }
  
  async initialize(config: GenericRestConfig): Promise<void> {
    await super.initialize(config);
    
    if (config.endpoints) {
      this.endpoints = { ...this.endpoints, ...config.endpoints };
    }
    
    if (config.dataExtractor) {
      this.extractors = config.dataExtractor;
    }
  }
  
  private extractData<T>(response: unknown, extractor?: (data: unknown) => T[]): T[] {
    if (extractor) {
      return extractor(response);
    }
    
    if (Array.isArray(response)) {
      return response as T[];
    }
    
    if (typeof response === "object" && response !== null) {
      const obj = response as Record<string, unknown>;
      
      if (Array.isArray(obj.data)) {
        return obj.data as T[];
      }
      if (Array.isArray(obj.items)) {
        return obj.items as T[];
      }
      if (Array.isArray(obj.results)) {
        return obj.results as T[];
      }
      if (Array.isArray(obj.list)) {
        return obj.list as T[];
      }
      
      for (const key of Object.keys(obj)) {
        if (Array.isArray(obj[key])) {
          return obj[key] as T[];
        }
      }
    }
    
    return [];
  }
  
  async listAnnouncements(): Promise<Announcement[]> {
    const response = await this.request<unknown>(this.endpoints.announcements!);
    
    if (!response.success) {
      console.warn(`[${this.schoolId}] Failed to fetch announcements:`, response.error);
      return [];
    }
    
    const raw = this.extractData<RawAnnouncementData>(
      response.data,
      this.extractors.announcements
    );
    
    return this.normalizeAnnouncements(raw);
  }
  
  async listEvents(): Promise<ClubEvent[]> {
    const response = await this.request<unknown>(this.endpoints.events!);
    
    if (!response.success) {
      console.warn(`[${this.schoolId}] Failed to fetch events:`, response.error);
      return [];
    }
    
    const raw = this.extractData<RawEventData>(
      response.data,
      this.extractors.events
    );
    
    return this.normalizeEvents(raw);
  }
  
  async listMenu(): Promise<MenuItem[]> {
    const response = await this.request<unknown>(this.endpoints.menu!);
    
    if (!response.success) {
      console.warn(`[${this.schoolId}] Failed to fetch menu:`, response.error);
      return [];
    }
    
    const raw = this.extractData<RawMenuData>(
      response.data,
      this.extractors.menu
    );
    
    return this.normalizeMenuItems(raw);
  }
  
  async listPois(): Promise<Poi[]> {
    const response = await this.request<unknown>(this.endpoints.pois!);
    
    if (!response.success) {
      console.warn(`[${this.schoolId}] Failed to fetch POIs:`, response.error);
      return [];
    }
    
    const raw = this.extractData<RawPoiData>(
      response.data,
      this.extractors.pois
    );
    
    return this.normalizePois(raw);
  }
  
  async isHealthy(): Promise<boolean> {
    try {
      const response = await this.request(this.endpoints.health!, { 
        timeout: 5000, 
        retry: 1 
      });
      return response.success;
    } catch {
      return false;
    }
  }
  
  getCapabilities(): AdapterCapabilities {
    return {
      announcements: true,
      events: true,
      courses: false,
      grades: false,
      menu: true,
      pois: true,
      library: false,
      bus: false,
      sso: false,
      realtime: false,
    };
  }
}
