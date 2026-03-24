/* eslint-disable */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

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

const STORAGE_KEY = '@analytics_queue';
const MAX_QUEUE_SIZE = 500; // 最大佇列大小，避免記憶體問題
const SENSITIVE_KEY_PATTERN = /(token|password|authorization|samlresponse|studentid|phone)/i;
const SENSITIVE_VALUE_PATTERN =
  /(bearer\s+[a-z0-9._-]+|eyJ[a-zA-Z0-9._-]{10,}|samlresponse=|authorization:|password=)/i;
const SAFE_USER_PROPERTY_KEYS = new Set([
  'userId',
  'schoolId',
  'role',
  'language',
  'theme',
  'appVersion',
  'platform',
]);
const DEFAULT_CONFIG: AnalyticsConfig = {
  enabled: true,
  debugMode: __DEV__,
  batchSize: 20,
  flushInterval: 30000,
};

function sanitizeAnalyticsValue(
  key: string,
  value: string | number | boolean,
): string | number | boolean {
  if (SENSITIVE_KEY_PATTERN.test(key)) {
    return '[REDACTED]';
  }

  if (typeof value === 'string' && SENSITIVE_VALUE_PATTERN.test(value)) {
    return '[REDACTED]';
  }

  return value;
}

function sanitizeAnalyticsParams(
  params?: Record<string, string | number | boolean>,
): Record<string, string | number | boolean> | undefined {
  if (!params) return undefined;

  const sanitized = Object.fromEntries(
    Object.entries(params)
      .filter(([key]) => !SENSITIVE_KEY_PATTERN.test(key))
      .map(([key, value]) => [key, sanitizeAnalyticsValue(key, value)]),
  );

  return Object.keys(sanitized).length > 0 ? sanitized : undefined;
}

function sanitizeUserProperties(properties: UserProperties): UserProperties {
  return Object.fromEntries(
    Object.entries(properties)
      .filter(
        ([key, value]) =>
          SAFE_USER_PROPERTY_KEYS.has(key) &&
          typeof value === 'string' &&
          !SENSITIVE_KEY_PATTERN.test(key),
      )
      .map(([key, value]) => [key, sanitizeAnalyticsValue(key, value as string)]),
  ) as UserProperties;
}

// ===== Analytics Service =====

class AnalyticsService {
  private config: AnalyticsConfig = DEFAULT_CONFIG;
  private queue: AnalyticsEvent[] = [];
  private userProperties: UserProperties = {};
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private currentScreen: string | null = null;
  private analyticsClient:
    | {
        logEvent: (name: string, params?: Record<string, unknown>) => Promise<void>;
        setUserId?: (userId: string | null) => Promise<void>;
        setUserProperties?: (properties: Record<string, string>) => Promise<void>;
      }
    | null
    | undefined = undefined;

  constructor() {
    this.loadQueue();
    this.startFlushTimer();

    this.userProperties = {
      platform: Platform.OS,
      appVersion: '1.0.0',
    };
  }

  // ===== Configuration =====

  configure(config: Partial<AnalyticsConfig>): void {
    this.config = { ...this.config, ...config };

    if (config.userId) {
      this.userProperties.userId = config.userId;
    }

    if (this.config.debugMode) {
      console.log('[Analytics] Configured:', this.config);
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

    const client = this.getAnalyticsClient();
    if (client?.setUserId) {
      void client.setUserId(userId ?? null);
    }

    this.logDebug('setUserId', { userId });
  }

  setUserProperty(key: string, value: string | null): void {
    if (!SAFE_USER_PROPERTY_KEYS.has(key) || SENSITIVE_KEY_PATTERN.test(key)) {
      return;
    }

    if (value) {
      this.userProperties[key] = String(sanitizeAnalyticsValue(key, value));
    } else {
      delete this.userProperties[key];
    }

    this.logDebug('setUserProperty', { key, value });
  }

  setUserProperties(properties: UserProperties): void {
    this.userProperties = {
      ...this.userProperties,
      ...sanitizeUserProperties(properties),
    };
    const client = this.getAnalyticsClient();
    if (client?.setUserProperties) {
      const serializableProperties = Object.fromEntries(
        Object.entries(this.userProperties).filter(
          (entry): entry is [string, string] => typeof entry[1] === 'string',
        ),
      );
      void client.setUserProperties(serializableProperties);
    }
    this.logDebug('setUserProperties', properties);
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
      name: 'screen_view',
      params: {
        screen_name: screenName,
        ...(screenClass && { screen_class: screenClass }),
      },
      timestamp: screenView.timestamp,
    });

    this.logDebug('logScreenView', screenView);
  }

  // ===== Event Logging =====

  logEvent(name: string, params?: Record<string, string | number | boolean>): void {
    if (!this.config.enabled) return;

    const event: AnalyticsEvent = {
      name,
      params: sanitizeAnalyticsParams(params),
      timestamp: Date.now(),
    };

    this.addToQueue(event);
    this.logDebug('logEvent', event);
  }

  // Common events
  logLogin(method: string): void {
    this.logEvent('login', { method });
  }

  logSignUp(method: string): void {
    this.logEvent('sign_up', { method });
  }

  logSearch(searchTerm: string): void {
    this.logEvent('search', { search_term: searchTerm });
  }

  logSelectContent(contentType: string, itemId: string): void {
    this.logEvent('select_content', { content_type: contentType, item_id: itemId });
  }

  logShare(contentType: string, itemId: string, method: string): void {
    this.logEvent('share', { content_type: contentType, item_id: itemId, method });
  }

  logAddToFavorites(itemType: string, itemId: string): void {
    this.logEvent('add_to_favorites', { item_type: itemType, item_id: itemId });
  }

  logRemoveFromFavorites(itemType: string, itemId: string): void {
    this.logEvent('remove_from_favorites', { item_type: itemType, item_id: itemId });
  }

  logViewItem(itemType: string, itemId: string, itemName?: string): void {
    this.logEvent('view_item', {
      item_type: itemType,
      item_id: itemId,
      ...(itemName && { item_name: itemName }),
    });
  }

  logBeginCheckout(value: number, currency: string = 'TWD'): void {
    this.logEvent('begin_checkout', { value, currency });
  }

  logPurchase(transactionId: string, value: number, currency: string = 'TWD'): void {
    this.logEvent('purchase', { transaction_id: transactionId, value, currency });
  }

  logError(errorType: string, errorMessage: string): void {
    this.logEvent('error', { error_type: errorType, error_message: errorMessage });
  }

  logFeatureUsed(featureName: string, details?: Record<string, string | number | boolean>): void {
    this.logEvent('feature_used', { feature_name: featureName, ...details });
  }

  // ===== Queue Management =====

  private addToQueue(event: AnalyticsEvent): void {
    this.queue.push(event);

    // 如果佇列超過最大大小，移除最舊的事件以避免記憶體問題
    if (this.queue.length > MAX_QUEUE_SIZE) {
      const eventsToRemove = this.queue.length - MAX_QUEUE_SIZE;
      this.queue.splice(0, eventsToRemove);
      this.logDebug('addToQueue', {
        droppedEvents: eventsToRemove,
        reason: 'max_queue_size_exceeded',
      });
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
        this.logDebug('loadQueue', { count: this.queue.length });
      }
    } catch (e) {
      console.error('[Analytics] Failed to load queue:', e);
    }
  }

  private async saveQueue(): Promise<void> {
    try {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(this.queue));
    } catch (e) {
      console.error('[Analytics] Failed to save queue:', e);
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
      this.logDebug('flush', { count: eventsToSend.length });
    } catch (e) {
      this.queue = [...eventsToSend, ...this.queue];
      await this.saveQueue();
      console.error('[Analytics] Failed to flush:', e);
    }
  }

  private async sendEvents(events: AnalyticsEvent[]): Promise<void> {
    if (this.config.debugMode) {
      console.log('[Analytics] Would send events:', events);
      return;
    }

    const client = this.getAnalyticsClient();
    if (!client) {
      this.logDebug('sendEvents skipped: no analytics provider', { count: events.length });
      return;
    }

    for (const event of events) {
      await client.logEvent(event.name, {
        ...this.userProperties,
        ...(event.params ?? {}),
      });
    }
  }

  private getAnalyticsClient() {
    if (this.analyticsClient !== undefined) {
      return this.analyticsClient;
    }

    try {
      const dynamicRequire = (globalThis as { require?: (name: string) => any }).require;
      const moduleName = ['@react-native-firebase', 'analytics'].join('/');
      const analyticsFactory = dynamicRequire?.(moduleName)?.default;
      this.analyticsClient = typeof analyticsFactory === 'function' ? analyticsFactory() : null;
    } catch (error) {
      this.analyticsClient = null;
      this.logDebug('analytics provider unavailable', error);
    }

    return this.analyticsClient;
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
