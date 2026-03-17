import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";

// ===== Types =====

export type AnalyticsEvent = {
  name: string;
  params?: Record<string, string | number | boolean>;
  timestamp: number;
};

export type ScreenView = {
  screenName: string;
  screenClass?: string;
  timestamp: number;
};

export type UserProperties = {
  userId?: string;
  schoolId?: string;
  role?: string;
  language?: string;
  theme?: string;
  appVersion?: string;
  platform?: string;
  [key: string]: string | undefined;
};

export type AnalyticsConfig = {
  enabled: boolean;
  debugMode: boolean;
  batchSize: number;
  flushInterval: number;
  userId?: string;
};

// ===== Constants =====

const STORAGE_KEY = "@analytics_queue";
const MAX_QUEUE_SIZE = 500; // 最大佇列大小，避免記憶體問題
const DEFAULT_CONFIG: AnalyticsConfig = {
  enabled: true,
  debugMode: __DEV__,
  batchSize: 20,
  flushInterval: 30000,
};

// ===== Analytics Service =====

class AnalyticsService {
  private config: AnalyticsConfig = DEFAULT_CONFIG;
  private queue: AnalyticsEvent[] = [];
  private userProperties: UserProperties = {};
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private currentScreen: string | null = null;

  constructor() {
    this.loadQueue();
    this.startFlushTimer();
    
    this.userProperties = {
      platform: Platform.OS,
      appVersion: "1.0.0",
    };
  }

  // ===== Configuration =====

  configure(config: Partial<AnalyticsConfig>): void {
    this.config = { ...this.config, ...config };
    
    if (config.userId) {
      this.userProperties.userId = config.userId;
    }

    if (this.config.debugMode) {
      console.log("[Analytics] Configured:", this.config);
    }
  }

  setEnabled(enabled: boolean): void {
    this.config.enabled = enabled;
    
    if (!enabled) {
      this.queue = [];
      AsyncStorage.removeItem(STORAGE_KEY).catch(() => {});
    }
  }

  // ===== User Properties =====

  setUserId(userId: string | null): void {
    if (userId) {
      this.userProperties.userId = userId;
    } else {
      delete this.userProperties.userId;
    }
    
    this.logDebug("setUserId", { userId });
  }

  setUserProperty(key: string, value: string | null): void {
    if (value) {
      this.userProperties[key] = value;
    } else {
      delete this.userProperties[key];
    }
    
    this.logDebug("setUserProperty", { key, value });
  }

  setUserProperties(properties: UserProperties): void {
    this.userProperties = { ...this.userProperties, ...properties };
    this.logDebug("setUserProperties", properties);
  }

  // ===== Screen Tracking =====

  logScreenView(screenName: string, screenClass?: string): void {
    if (!this.config.enabled) return;
    
    if (this.currentScreen === screenName) return;
    this.currentScreen = screenName;

    const screenView: ScreenView = {
      screenName,
      screenClass,
      timestamp: Date.now(),
    };

    this.addToQueue({
      name: "screen_view",
      params: {
        screen_name: screenName,
        ...(screenClass && { screen_class: screenClass }),
      },
      timestamp: screenView.timestamp,
    });

    this.logDebug("logScreenView", screenView);
  }

  // ===== Event Logging =====

  logEvent(name: string, params?: Record<string, string | number | boolean>): void {
    if (!this.config.enabled) return;

    const event: AnalyticsEvent = {
      name,
      params,
      timestamp: Date.now(),
    };

    this.addToQueue(event);
    this.logDebug("logEvent", event);
  }

  // Common events
  logLogin(method: string): void {
    this.logEvent("login", { method });
  }

  logSignUp(method: string): void {
    this.logEvent("sign_up", { method });
  }

  logSearch(searchTerm: string): void {
    this.logEvent("search", { search_term: searchTerm });
  }

  logSelectContent(contentType: string, itemId: string): void {
    this.logEvent("select_content", { content_type: contentType, item_id: itemId });
  }

  logShare(contentType: string, itemId: string, method: string): void {
    this.logEvent("share", { content_type: contentType, item_id: itemId, method });
  }

  logAddToFavorites(itemType: string, itemId: string): void {
    this.logEvent("add_to_favorites", { item_type: itemType, item_id: itemId });
  }

  logRemoveFromFavorites(itemType: string, itemId: string): void {
    this.logEvent("remove_from_favorites", { item_type: itemType, item_id: itemId });
  }

  logViewItem(itemType: string, itemId: string, itemName?: string): void {
    this.logEvent("view_item", {
      item_type: itemType,
      item_id: itemId,
      ...(itemName && { item_name: itemName }),
    });
  }

  logBeginCheckout(value: number, currency: string = "TWD"): void {
    this.logEvent("begin_checkout", { value, currency });
  }

  logPurchase(transactionId: string, value: number, currency: string = "TWD"): void {
    this.logEvent("purchase", { transaction_id: transactionId, value, currency });
  }

  logError(errorType: string, errorMessage: string): void {
    this.logEvent("error", { error_type: errorType, error_message: errorMessage });
  }

  logFeatureUsed(featureName: string, details?: Record<string, string | number | boolean>): void {
    this.logEvent("feature_used", { feature_name: featureName, ...details });
  }

  // ===== Queue Management =====

  private addToQueue(event: AnalyticsEvent): void {
    this.queue.push(event);
    
    // 如果佇列超過最大大小，移除最舊的事件以避免記憶體問題
    if (this.queue.length > MAX_QUEUE_SIZE) {
      const eventsToRemove = this.queue.length - MAX_QUEUE_SIZE;
      this.queue.splice(0, eventsToRemove);
      this.logDebug("addToQueue", { droppedEvents: eventsToRemove, reason: "max_queue_size_exceeded" });
    }
    
    if (this.queue.length >= this.config.batchSize) {
      this.flush();
    } else {
      this.saveQueue();
    }
  }

  private async loadQueue(): Promise<void> {
    try {
      const stored = await AsyncStorage.getItem(STORAGE_KEY);
      if (stored) {
        this.queue = JSON.parse(stored);
        this.logDebug("loadQueue", { count: this.queue.length });
      }
    } catch (e) {
      console.error("[Analytics] Failed to load queue:", e);
    }
  }

  private async saveQueue(): Promise<void> {
    try {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(this.queue));
    } catch (e) {
      console.error("[Analytics] Failed to save queue:", e);
    }
  }

  private startFlushTimer(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
    }
    
    this.flushTimer = setInterval(() => {
      if (this.queue.length > 0) {
        this.flush();
      }
    }, this.config.flushInterval);
  }

  async flush(): Promise<void> {
    if (this.queue.length === 0) return;
    
    const eventsToSend = [...this.queue];
    this.queue = [];
    
    try {
      await this.sendEvents(eventsToSend);
      await AsyncStorage.removeItem(STORAGE_KEY);
      this.logDebug("flush", { count: eventsToSend.length });
    } catch (e) {
      this.queue = [...eventsToSend, ...this.queue];
      await this.saveQueue();
      console.error("[Analytics] Failed to flush:", e);
    }
  }

  private async sendEvents(events: AnalyticsEvent[]): Promise<void> {
    if (this.config.debugMode) {
      console.log("[Analytics] Would send events:", events);
      return;
    }

    // Events are stored locally. Firebase Analytics requires native setup with expo-dev-client.
    // To enable: 1) npx expo prebuild  2) Configure GoogleService-Info.plist / google-services.json
    if (__DEV__) {
      console.log("[Analytics] Events logged locally:", events.length);
    }
  }

  setFirebaseUserId(userId: string | null): void {
    this.setUserId(userId);
  }

  setFirebaseUserProperties(properties: Record<string, string>): void {
    this.setUserProperties(properties as UserProperties);
  }

  private logDebug(method: string, data: unknown): void {
    if (this.config.debugMode) {
      console.log(`[Analytics] ${method}:`, data);
    }
  }

  // ===== Cleanup =====

  destroy(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    this.flush();
  }
}

// ===== Singleton Instance =====

export const analytics = new AnalyticsService();

export function trackEvent(name: string, params?: Record<string, string | number | boolean>) {
  analytics.logEvent(name, params);
}

// ===== React Hook =====

export function useAnalytics() {
  return analytics;
}
