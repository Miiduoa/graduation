/**
 * Firebase Performance Monitoring Service
 * 效能監控服務
 * 
 * 功能：
 * - 自動追蹤網路請求效能
 * - 自訂追蹤（Screen render、Data fetch 等）
 * - 效能屬性標註
 * - 效能資料分析
 */

import React from "react";
import { Platform } from "react-native";

// Performance trace interface
interface PerformanceTrace {
  start(): void;
  stop(): void;
  putAttribute(name: string, value: string): void;
  putMetric(name: string, value: number): void;
  getAttribute(name: string): string | undefined;
  getMetric(name: string): number;
  incrementMetric(name: string, value?: number): void;
}

// Mock trace for development
class MockTrace implements PerformanceTrace {
  private name: string;
  private startTime: number = 0;
  private attributes: Map<string, string> = new Map();
  private metrics: Map<string, number> = new Map();
  private stopped: boolean = false;

  constructor(name: string) {
    this.name = name;
  }

  start(): void {
    this.startTime = Date.now();
    if (__DEV__) {
      console.log(`[Perf] Trace started: ${this.name}`);
    }
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    const duration = Date.now() - this.startTime;
    
    if (__DEV__) {
      console.log(`[Perf] Trace stopped: ${this.name} (${duration}ms)`);
      if (this.attributes.size > 0) {
        console.log(`[Perf]   Attributes:`, Object.fromEntries(this.attributes));
      }
      if (this.metrics.size > 0) {
        console.log(`[Perf]   Metrics:`, Object.fromEntries(this.metrics));
      }
    }

    // Store for analytics
    performanceDataStore.addTrace({
      name: this.name,
      duration,
      attributes: Object.fromEntries(this.attributes),
      metrics: Object.fromEntries(this.metrics),
      timestamp: Date.now(),
    });
  }

  putAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  putMetric(name: string, value: number): void {
    this.metrics.set(name, value);
  }

  getAttribute(name: string): string | undefined {
    return this.attributes.get(name);
  }

  getMetric(name: string): number {
    return this.metrics.get(name) ?? 0;
  }

  incrementMetric(name: string, value: number = 1): void {
    const current = this.metrics.get(name) ?? 0;
    this.metrics.set(name, current + value);
  }
}

// HTTP Metric interface
interface HttpMetric {
  setHttpResponseCode(code: number): void;
  setRequestPayloadSize(bytes: number): void;
  setResponsePayloadSize(bytes: number): void;
  setResponseContentType(contentType: string): void;
  putAttribute(name: string, value: string): void;
  start(): Promise<void>;
  stop(): Promise<void>;
}

// Mock HTTP metric
class MockHttpMetric implements HttpMetric {
  private url: string;
  private method: string;
  private startTime: number = 0;
  private responseCode: number = 0;
  private requestSize: number = 0;
  private responseSize: number = 0;
  private contentType: string = "";
  private attributes: Map<string, string> = new Map();

  constructor(url: string, method: string) {
    this.url = url;
    this.method = method;
  }

  setHttpResponseCode(code: number): void {
    this.responseCode = code;
  }

  setRequestPayloadSize(bytes: number): void {
    this.requestSize = bytes;
  }

  setResponsePayloadSize(bytes: number): void {
    this.responseSize = bytes;
  }

  setResponseContentType(contentType: string): void {
    this.contentType = contentType;
  }

  putAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  async start(): Promise<void> {
    this.startTime = Date.now();
  }

  async stop(): Promise<void> {
    const duration = Date.now() - this.startTime;
    
    if (__DEV__) {
      console.log(`[Perf] HTTP: ${this.method} ${this.url}`);
      console.log(`[Perf]   Status: ${this.responseCode}, Duration: ${duration}ms`);
      console.log(`[Perf]   Request: ${this.requestSize}B, Response: ${this.responseSize}B`);
    }

    performanceDataStore.addHttpMetric({
      url: this.url,
      method: this.method,
      duration,
      responseCode: this.responseCode,
      requestSize: this.requestSize,
      responseSize: this.responseSize,
      contentType: this.contentType,
      attributes: Object.fromEntries(this.attributes),
      timestamp: Date.now(),
    });
  }
}

// Trace data types
interface TraceData {
  name: string;
  duration: number;
  attributes: Record<string, string>;
  metrics: Record<string, number>;
  timestamp: number;
}

interface HttpMetricData {
  url: string;
  method: string;
  duration: number;
  responseCode: number;
  requestSize: number;
  responseSize: number;
  contentType: string;
  attributes: Record<string, string>;
  timestamp: number;
}

// Performance data store for analytics
class PerformanceDataStore {
  private traces: TraceData[] = [];
  private httpMetrics: HttpMetricData[] = [];
  private maxItems = 100;

  addTrace(trace: TraceData): void {
    this.traces.push(trace);
    if (this.traces.length > this.maxItems) {
      this.traces.shift();
    }
  }

  addHttpMetric(metric: HttpMetricData): void {
    this.httpMetrics.push(metric);
    if (this.httpMetrics.length > this.maxItems) {
      this.httpMetrics.shift();
    }
  }

  getTraces(): TraceData[] {
    return [...this.traces];
  }

  getHttpMetrics(): HttpMetricData[] {
    return [...this.httpMetrics];
  }

  getAverageTraceDuration(traceName: string): number {
    const matching = this.traces.filter(t => t.name === traceName);
    if (matching.length === 0) return 0;
    return matching.reduce((sum, t) => sum + t.duration, 0) / matching.length;
  }

  getSlowestTraces(limit: number = 10): TraceData[] {
    return [...this.traces]
      .sort((a, b) => b.duration - a.duration)
      .slice(0, limit);
  }

  getSlowHttpRequests(thresholdMs: number = 1000): HttpMetricData[] {
    return this.httpMetrics.filter(m => m.duration > thresholdMs);
  }

  getErrorHttpRequests(): HttpMetricData[] {
    return this.httpMetrics.filter(m => m.responseCode >= 400);
  }

  clear(): void {
    this.traces = [];
    this.httpMetrics = [];
  }

  getReport(): PerformanceReport {
    const tracesByName = new Map<string, TraceData[]>();
    this.traces.forEach(t => {
      const existing = tracesByName.get(t.name) ?? [];
      existing.push(t);
      tracesByName.set(t.name, existing);
    });

    const traceStats = Array.from(tracesByName.entries()).map(([name, traces]) => {
      const durations = traces.map(t => t.duration);
      return {
        name,
        count: traces.length,
        avgDuration: durations.reduce((a, b) => a + b, 0) / durations.length,
        minDuration: Math.min(...durations),
        maxDuration: Math.max(...durations),
        p95Duration: percentile(durations, 95),
      };
    });

    const httpStats = {
      totalRequests: this.httpMetrics.length,
      avgDuration: this.httpMetrics.length > 0
        ? this.httpMetrics.reduce((sum, m) => sum + m.duration, 0) / this.httpMetrics.length
        : 0,
      errorRate: this.httpMetrics.length > 0
        ? this.httpMetrics.filter(m => m.responseCode >= 400).length / this.httpMetrics.length
        : 0,
      slowRequests: this.httpMetrics.filter(m => m.duration > 1000).length,
    };

    return {
      traceStats,
      httpStats,
      generatedAt: new Date().toISOString(),
    };
  }
}

interface PerformanceReport {
  traceStats: Array<{
    name: string;
    count: number;
    avgDuration: number;
    minDuration: number;
    maxDuration: number;
    p95Duration: number;
  }>;
  httpStats: {
    totalRequests: number;
    avgDuration: number;
    errorRate: number;
    slowRequests: number;
  };
  generatedAt: string;
}

function percentile(arr: number[], p: number): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, index)];
}

// Global store instance
const performanceDataStore = new PerformanceDataStore();

// Performance monitoring service
class PerformanceService {
  private enabled: boolean = true;
  private dataCollectionEnabled: boolean = true;

  setPerformanceCollectionEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  setDataCollectionEnabled(enabled: boolean): void {
    this.dataCollectionEnabled = enabled;
  }

  isPerformanceCollectionEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Create a new trace
   */
  newTrace(traceName: string): PerformanceTrace {
    return new MockTrace(traceName);
  }

  /**
   * Create a new HTTP metric
   */
  newHttpMetric(url: string, httpMethod: string): HttpMetric {
    return new MockHttpMetric(url, httpMethod);
  }

  /**
   * Start a trace and return it
   */
  startTrace(traceName: string): PerformanceTrace {
    const trace = this.newTrace(traceName);
    trace.start();
    return trace;
  }

  /**
   * Measure async function execution time
   */
  async measureAsync<T>(
    traceName: string,
    fn: () => Promise<T>,
    attributes?: Record<string, string>
  ): Promise<T> {
    const trace = this.startTrace(traceName);
    
    if (attributes) {
      Object.entries(attributes).forEach(([key, value]) => {
        trace.putAttribute(key, value);
      });
    }

    try {
      const result = await fn();
      trace.putAttribute("success", "true");
      return result;
    } catch (error) {
      trace.putAttribute("success", "false");
      trace.putAttribute("error", String(error));
      throw error;
    } finally {
      trace.stop();
    }
  }

  /**
   * Measure sync function execution time
   */
  measure<T>(
    traceName: string,
    fn: () => T,
    attributes?: Record<string, string>
  ): T {
    const trace = this.startTrace(traceName);
    
    if (attributes) {
      Object.entries(attributes).forEach(([key, value]) => {
        trace.putAttribute(key, value);
      });
    }

    try {
      const result = fn();
      trace.putAttribute("success", "true");
      return result;
    } catch (error) {
      trace.putAttribute("success", "false");
      trace.putAttribute("error", String(error));
      throw error;
    } finally {
      trace.stop();
    }
  }

  /**
   * Get performance data store for analytics
   */
  getDataStore(): PerformanceDataStore {
    return performanceDataStore;
  }

  /**
   * Get performance report
   */
  getReport(): PerformanceReport {
    return performanceDataStore.getReport();
  }
}

// Export singleton instance
export const performance = new PerformanceService();

// Predefined trace names
export const TraceNames = {
  // Screen rendering
  SCREEN_RENDER_ANNOUNCEMENTS: "screen_render_announcements",
  SCREEN_RENDER_EVENTS: "screen_render_events",
  SCREEN_RENDER_MAP: "screen_render_map",
  SCREEN_RENDER_CAFETERIA: "screen_render_cafeteria",
  SCREEN_RENDER_ME: "screen_render_me",
  
  // Data fetching
  FETCH_ANNOUNCEMENTS: "fetch_announcements",
  FETCH_EVENTS: "fetch_events",
  FETCH_POIS: "fetch_pois",
  FETCH_MENUS: "fetch_menus",
  FETCH_USER_PROFILE: "fetch_user_profile",
  FETCH_GROUPS: "fetch_groups",
  FETCH_GRADES: "fetch_grades",
  
  // User actions
  ACTION_LOGIN: "action_login",
  ACTION_REGISTER: "action_register",
  ACTION_LOGOUT: "action_logout",
  ACTION_SEARCH: "action_search",
  ACTION_FAVORITE: "action_favorite",
  ACTION_REGISTER_EVENT: "action_register_event",
  
  // Features
  FEATURE_AI_CHAT: "feature_ai_chat",
  FEATURE_QR_SCAN: "feature_qr_scan",
  FEATURE_AR_NAVIGATION: "feature_ar_navigation",
  
  // App lifecycle
  APP_STARTUP: "app_startup",
  APP_COLD_START: "app_cold_start",
  APP_WARM_START: "app_warm_start",
} as const;

// Performance hooks for React components
export function usePerformanceTrace(traceName: string, deps: any[] = []) {
  const traceRef = { current: null as PerformanceTrace | null };

  // Start trace on mount
  if (!traceRef.current) {
    traceRef.current = performance.startTrace(traceName);
  }

  return {
    trace: traceRef.current,
    stopTrace: () => {
      if (traceRef.current) {
        traceRef.current.stop();
        traceRef.current = null;
      }
    },
    addAttribute: (name: string, value: string) => {
      traceRef.current?.putAttribute(name, value);
    },
    addMetric: (name: string, value: number) => {
      traceRef.current?.putMetric(name, value);
    },
  };
}

// Screen render performance HOC
export function withScreenPerformance<P extends object>(
  WrappedComponent: React.ComponentType<P>,
  screenName: string
): React.ComponentType<P> {
  return function PerformanceTrackedComponent(props: P) {
    const trace = performance.startTrace(`screen_render_${screenName}`);
    trace.putAttribute("platform", Platform.OS);
    
    // Stop trace after render
    setTimeout(() => trace.stop(), 0);
    
    return React.createElement(WrappedComponent, props);
  };
}

// Fetch wrapper with performance tracking
export async function fetchWithPerformance(
  url: string,
  options: RequestInit = {}
): Promise<Response> {
  const httpMetric = performance.newHttpMetric(url, options.method ?? "GET");
  
  if (options.body) {
    httpMetric.setRequestPayloadSize(
      typeof options.body === "string" ? options.body.length : 0
    );
  }

  await httpMetric.start();

  try {
    const response = await fetch(url, options);
    
    httpMetric.setHttpResponseCode(response.status);
    httpMetric.setResponseContentType(
      response.headers.get("content-type") ?? "unknown"
    );
    
    // Clone response to read size
    const clone = response.clone();
    const text = await clone.text();
    httpMetric.setResponsePayloadSize(text.length);

    await httpMetric.stop();
    return response;
  } catch (error) {
    httpMetric.setHttpResponseCode(0);
    httpMetric.putAttribute("error", String(error));
    await httpMetric.stop();
    throw error;
  }
}

// Export types
export type { PerformanceTrace, HttpMetric, TraceData, HttpMetricData, PerformanceReport };
