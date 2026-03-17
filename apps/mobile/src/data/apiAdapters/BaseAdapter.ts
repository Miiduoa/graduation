import type {
  SchoolApiAdapter,
  ApiConfig,
  ApiResponse,
  AuthCredentials,
  AdapterCapabilities,
  RawAnnouncementData,
  RawEventData,
  RawMenuData,
  RawPoiData,
} from "./types";
import {
  normalizeAnnouncement,
  normalizeEvent,
  normalizeMenuItem,
  normalizePoi,
} from "./types";
import type { Announcement, ClubEvent, MenuItem, Poi } from "../types";

export type RequestOptions = {
  method?: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
  headers?: Record<string, string>;
  body?: unknown;
  timeout?: number;
  retry?: number;
  retryDelay?: number;
};

export abstract class BaseApiAdapter implements SchoolApiAdapter {
  abstract readonly schoolId: string;
  abstract readonly schoolName: string;
  abstract readonly apiVersion: string;
  
  protected config: ApiConfig | null = null;
  protected credentials: AuthCredentials | null = null;
  
  async initialize(config: ApiConfig): Promise<void> {
    this.config = {
      timeout: 30000,
      ...config,
    };
  }
  
  protected async request<T>(
    endpoint: string,
    options: RequestOptions = {}
  ): Promise<ApiResponse<T>> {
    if (!this.config) {
      throw new Error("Adapter not initialized. Call initialize() first.");
    }
    
    const {
      method = "GET",
      headers = {},
      body,
      timeout = this.config.timeout,
      retry = 3,
      retryDelay = 1000,
    } = options;
    
    const url = this.buildUrl(endpoint);
    const requestHeaders = this.buildHeaders(headers);
    
    let lastError: Error | null = null;
    
    for (let attempt = 0; attempt < retry; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);
        
        const response = await fetch(url, {
          method,
          headers: requestHeaders,
          body: body ? JSON.stringify(body) : undefined,
          signal: controller.signal,
        });
        
        clearTimeout(timeoutId);
        
        if (!response.ok) {
          const errorBody = await response.text().catch(() => "");
          return {
            success: false,
            error: {
              code: `HTTP_${response.status}`,
              message: response.statusText,
              details: errorBody,
            },
          };
        }
        
        const data = await response.json();
        return this.parseResponse<T>(data);
        
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        
        if (error instanceof Error && error.name === "AbortError") {
          return {
            success: false,
            error: {
              code: "TIMEOUT",
              message: "Request timed out",
            },
          };
        }
        
        if (attempt < retry - 1) {
          await this.delay(retryDelay * (attempt + 1));
        }
      }
    }
    
    return {
      success: false,
      error: {
        code: "NETWORK_ERROR",
        message: lastError?.message || "Network request failed",
      },
    };
  }
  
  protected buildUrl(endpoint: string): string {
    const base = this.config!.baseUrl.replace(/\/$/, "");
    const path = endpoint.startsWith("/") ? endpoint : `/${endpoint}`;
    return `${base}${path}`;
  }
  
  protected buildHeaders(customHeaders: Record<string, string>): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "Accept": "application/json",
      ...this.config?.headers,
      ...customHeaders,
    };
    
    if (this.config?.apiKey) {
      headers["X-API-Key"] = this.config.apiKey;
    }
    
    if (this.credentials?.accessToken) {
      headers["Authorization"] = `Bearer ${this.credentials.accessToken}`;
    }
    
    return headers;
  }
  
  protected parseResponse<T>(data: unknown): ApiResponse<T> {
    if (typeof data === "object" && data !== null) {
      const obj = data as Record<string, unknown>;
      
      if ("success" in obj && typeof obj.success === "boolean") {
        return data as ApiResponse<T>;
      }
      
      if ("data" in obj) {
        return {
          success: true,
          data: obj.data as T,
          meta: obj.meta as ApiResponse<T>["meta"],
        };
      }
      
      if ("error" in obj || "message" in obj) {
        return {
          success: false,
          error: {
            code: (obj.code as string) || "UNKNOWN",
            message: (obj.message as string) || (obj.error as string) || "Unknown error",
          },
        };
      }
      
      if (Array.isArray(data)) {
        return {
          success: true,
          data: data as T,
        };
      }
    }
    
    return {
      success: true,
      data: data as T,
    };
  }
  
  protected delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
  
  protected normalizeAnnouncements(raw: RawAnnouncementData[]): Announcement[] {
    return raw.map((item) => normalizeAnnouncement(item, this.schoolId));
  }
  
  protected normalizeEvents(raw: RawEventData[]): ClubEvent[] {
    return raw.map((item) => normalizeEvent(item, this.schoolId));
  }
  
  protected normalizeMenuItems(raw: RawMenuData[]): MenuItem[] {
    return raw.map((item) => normalizeMenuItem(item, this.schoolId));
  }
  
  protected normalizePois(raw: RawPoiData[]): Poi[] {
    return raw.map((item) => normalizePoi(item, this.schoolId));
  }
  
  abstract listAnnouncements(): Promise<Announcement[]>;
  abstract listEvents(): Promise<ClubEvent[]>;
  abstract listMenu(): Promise<MenuItem[]>;
  abstract listPois(): Promise<Poi[]>;
  
  async isHealthy(): Promise<boolean> {
    try {
      const response = await this.request("/health", { timeout: 5000, retry: 1 });
      return response.success;
    } catch {
      return false;
    }
  }
  
  abstract getCapabilities(): AdapterCapabilities;
}
