import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

// ===== Types =====

export type ErrorSeverity = "fatal" | "error" | "warning" | "info";

export type ErrorContext = {
  userId?: string;
  schoolId?: string;
  screen?: string;
  action?: string;
  [key: string]: string | number | boolean | undefined;
};

export type ErrorReport = {
  id: string;
  timestamp: number;
  severity: ErrorSeverity;
  message: string;
  stack?: string;
  name: string;
  context: ErrorContext;
  deviceInfo: DeviceInfo;
  breadcrumbs: Breadcrumb[];
};

export type DeviceInfo = {
  platform: string;
  osVersion: string;
  appVersion: string;
  buildNumber: string;
  deviceModel?: string;
  screenWidth?: number;
  screenHeight?: number;
  locale?: string;
  timezone?: string;
  memoryUsage?: number;
};

export type Breadcrumb = {
  timestamp: number;
  category: "navigation" | "user" | "network" | "console" | "error";
  message: string;
  data?: Record<string, unknown>;
};

export type ErrorReportingConfig = {
  enabled: boolean;
  debugMode: boolean;
  maxBreadcrumbs: number;
  maxStoredErrors: number;
  endpoint?: string;
  userId?: string;
};

// ===== Constants =====

const STORAGE_KEY = "@error_reports";
const MAX_BREADCRUMBS = 50;
const MAX_STORED_ERRORS = 20;

const DEFAULT_CONFIG: ErrorReportingConfig = {
  enabled: true,
  debugMode: __DEV__,
  maxBreadcrumbs: MAX_BREADCRUMBS,
  maxStoredErrors: MAX_STORED_ERRORS,
};

// ===== Error Reporting Service =====

class ErrorReportingService {
  private config: ErrorReportingConfig = DEFAULT_CONFIG;
  private context: ErrorContext = {};
  private breadcrumbs: Breadcrumb[] = [];
  private deviceInfo: DeviceInfo;
  private originalConsoleError: typeof console.error;
  private isInitialized = false;

  constructor() {
    this.deviceInfo = this.getDeviceInfo();
    this.originalConsoleError = console.error;
  }

  // ===== Initialization =====

  init(config?: Partial<ErrorReportingConfig>): void {
    if (this.isInitialized) return;

    if (config) {
      this.config = { ...this.config, ...config };
    }

    if (this.config.enabled) {
      this.setupGlobalErrorHandler();
      this.setupUnhandledPromiseRejection();
      this.interceptConsoleError();
    }

    this.isInitialized = true;
    this.logDebug("Initialized with config:", this.config);
  }

  private setupGlobalErrorHandler(): void {
    const originalHandler = ErrorUtils.getGlobalHandler();

    ErrorUtils.setGlobalHandler((error: Error, isFatal?: boolean) => {
      this.captureException(error, {
        severity: isFatal ? "fatal" : "error",
        context: { isFatal: Boolean(isFatal) },
      });

      if (originalHandler) {
        originalHandler(error, isFatal);
      }
    });
  }

  private setupUnhandledPromiseRejection(): void {
    const originalRejectionTracker = (global as any).__promiseRejectionTrackingOptions?.onUnhandled;

    (global as any).__promiseRejectionTrackingOptions = {
      ...((global as any).__promiseRejectionTrackingOptions || {}),
      onUnhandled: (id: string, rejection: Error) => {
        this.captureException(rejection, {
          severity: "error",
          context: { type: "unhandled_promise_rejection", id },
        });

        if (originalRejectionTracker) {
          originalRejectionTracker(id, rejection);
        }
      },
    };
  }

  private interceptConsoleError(): void {
    console.error = (...args: unknown[]) => {
      this.addBreadcrumb({
        category: "console",
        message: args.map((arg) => String(arg)).join(" "),
      });

      this.originalConsoleError.apply(console, args);
    };
  }

  // ===== Configuration =====

  configure(config: Partial<ErrorReportingConfig>): void {
    this.config = { ...this.config, ...config };
  }

  setUser(userId: string | null, properties?: Record<string, string>): void {
    if (userId) {
      this.context.userId = userId;
      if (properties) {
        Object.assign(this.context, properties);
      }
    } else {
      delete this.context.userId;
    }
  }

  setContext(context: ErrorContext): void {
    this.context = { ...this.context, ...context };
  }

  clearContext(): void {
    this.context = {};
  }

  // ===== Breadcrumbs =====

  addBreadcrumb(breadcrumb: Omit<Breadcrumb, "timestamp">): void {
    const newBreadcrumb: Breadcrumb = {
      ...breadcrumb,
      timestamp: Date.now(),
    };

    this.breadcrumbs.push(newBreadcrumb);

    if (this.breadcrumbs.length > this.config.maxBreadcrumbs) {
      this.breadcrumbs.shift();
    }
  }

  clearBreadcrumbs(): void {
    this.breadcrumbs = [];
  }

  // Navigation breadcrumbs
  logNavigation(from: string, to: string): void {
    this.addBreadcrumb({
      category: "navigation",
      message: `${from} -> ${to}`,
      data: { from, to },
    });
    this.context.screen = to;
  }

  // User action breadcrumbs
  logUserAction(action: string, data?: Record<string, unknown>): void {
    this.addBreadcrumb({
      category: "user",
      message: action,
      data,
    });
    this.context.action = action;
  }

  // Network breadcrumbs
  logNetworkRequest(method: string, url: string, status?: number): void {
    this.addBreadcrumb({
      category: "network",
      message: `${method} ${url}${status ? ` -> ${status}` : ""}`,
      data: { method, url, status },
    });
  }

  // ===== Error Capture =====

  captureException(
    error: Error | unknown,
    options?: {
      severity?: ErrorSeverity;
      context?: ErrorContext;
      tags?: Record<string, string>;
    }
  ): string {
    if (!this.config.enabled) return "";

    const err = this.normalizeError(error);
    const report = this.createErrorReport(err, options?.severity ?? "error", {
      ...this.context,
      ...options?.context,
    });

    this.storeError(report);
    this.sendError(report);

    this.logDebug("Captured exception:", report);

    return report.id;
  }

  captureMessage(
    message: string,
    severity: ErrorSeverity = "info",
    context?: ErrorContext
  ): string {
    if (!this.config.enabled) return "";

    const report = this.createErrorReport(
      new Error(message),
      severity,
      { ...this.context, ...context }
    );

    this.storeError(report);
    this.sendError(report);

    this.logDebug("Captured message:", report);

    return report.id;
  }

  // ===== Error Processing =====

  private normalizeError(error: unknown): Error {
    if (error instanceof Error) {
      return error;
    }

    if (typeof error === "string") {
      return new Error(error);
    }

    return new Error(String(error));
  }

  private createErrorReport(
    error: Error,
    severity: ErrorSeverity,
    context: ErrorContext
  ): ErrorReport {
    return {
      id: this.generateId(),
      timestamp: Date.now(),
      severity,
      message: error.message,
      stack: error.stack,
      name: error.name,
      context,
      deviceInfo: this.deviceInfo,
      breadcrumbs: [...this.breadcrumbs],
    };
  }

  private generateId(): string {
    return `err_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private getDeviceInfo(): DeviceInfo {
    const { Dimensions } = require("react-native");
    const screen = Dimensions.get("window");

    return {
      platform: Platform.OS,
      osVersion: Platform.Version.toString(),
      appVersion: "1.0.0",
      buildNumber: "1",
      screenWidth: screen.width,
      screenHeight: screen.height,
      locale: "zh-TW",
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    };
  }

  // ===== Storage =====

  private async storeError(report: ErrorReport): Promise<void> {
    try {
      const stored = await AsyncStorage.getItem(STORAGE_KEY);
      let errors: ErrorReport[] = stored ? JSON.parse(stored) : [];

      errors.push(report);

      if (errors.length > this.config.maxStoredErrors) {
        errors = errors.slice(-this.config.maxStoredErrors);
      }

      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(errors));
    } catch (e) {
      this.originalConsoleError("[ErrorReporting] Failed to store error:", e);
    }
  }

  async getStoredErrors(): Promise<ErrorReport[]> {
    try {
      const stored = await AsyncStorage.getItem(STORAGE_KEY);
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  }

  async clearStoredErrors(): Promise<void> {
    await AsyncStorage.removeItem(STORAGE_KEY);
  }

  // ===== Sending =====

  private async sendError(report: ErrorReport): Promise<void> {
    if (!this.config.endpoint) return;

    try {
      await fetch(this.config.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(report),
      });
    } catch (e) {
      this.logDebug("Failed to send error:", e);
    }
  }

  async flushStoredErrors(): Promise<void> {
    if (!this.config.endpoint) return;

    const errors = await this.getStoredErrors();
    if (errors.length === 0) return;

    try {
      await fetch(this.config.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ errors }),
      });

      await this.clearStoredErrors();
    } catch (e) {
      this.logDebug("Failed to flush errors:", e);
    }
  }

  // ===== Debug =====

  private logDebug(message: string, data?: unknown): void {
    if (this.config.debugMode) {
      console.log(`[ErrorReporting] ${message}`, data);
    }
  }
}

// ===== Singleton Instance =====

export const errorReporting = new ErrorReportingService();

// ===== React Error Boundary Integration =====

export function captureReactError(error: Error, componentStack: string): void {
  errorReporting.captureException(error, {
    severity: "error",
    context: {
      componentStack,
      type: "react_error_boundary",
    },
  });
}
