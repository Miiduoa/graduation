import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useRef,
  useEffect,
  useMemo,
} from 'react';
import {
  AccessibilityInfo,
  Animated,
  AppState,
  Easing,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { theme, softShadowStyle } from './theme';
import { useThemeMode } from '../state/theme';
import { useReducedMotion } from '../hooks/useReducedMotion';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';

type ToastType = 'success' | 'error' | 'warning' | 'info';

type ToastConfig = {
  message: string;
  type?: ToastType;
  duration?: number;
  action?: { text: string; onPress: () => void };
  icon?: string;
  dismissible?: boolean;
};

type Toast = ToastConfig & { id: string };

type ToastContextType = {
  show: (config: ToastConfig) => string;
  success: (message: string, config?: Partial<ToastConfig>) => string;
  error: (message: string, config?: Partial<ToastConfig>) => string;
  warning: (message: string, config?: Partial<ToastConfig>) => string;
  info: (message: string, config?: Partial<ToastConfig>) => string;
  dismiss: (id: string) => void;
  dismissAll: () => void;
};

const ToastContext = createContext<ToastContextType | null>(null);

export function useToast(): ToastContextType {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast must be used within a ToastProvider');
  return context;
}

const TYPE_CONFIG: Record<ToastType, { color: string; icon: string }> = {
  success: {
    get color() {
      return theme.colors.success;
    },
    icon: 'checkmark-circle',
  },
  error: {
    get color() {
      return theme.colors.danger;
    },
    icon: 'close-circle',
  },
  warning: {
    get color() {
      return theme.colors.warning;
    },
    icon: 'warning',
  },
  info: {
    get color() {
      return theme.colors.accent;
    },
    icon: 'information-circle',
  },
};

type NotificationActivity = { active: boolean; screenReader: boolean | null };

function useNotificationActivity(): NotificationActivity {
  const [active, setActive] = useState(() => AppState.currentState === 'active');
  const [screenReader, setScreenReader] = useState<boolean | null>(null);
  useEffect(() => {
    let mounted = true;
    let readerChanged = false;
    const appSubscription = AppState.addEventListener('change', (state) => {
      if (mounted) setActive(state === 'active');
    });
    const readerSubscription = AccessibilityInfo.addEventListener(
      'screenReaderChanged',
      (enabled) => {
        readerChanged = true;
        if (mounted) setScreenReader(enabled);
      },
    );
    void AccessibilityInfo.isScreenReaderEnabled().then(
      (enabled) => {
        if (mounted && !readerChanged) setScreenReader(enabled);
      },
      () => {
        // Keep the notification available if the reading preference is unknown.
      },
    );
    return () => {
      mounted = false;
      appSubscription.remove();
      readerSubscription.remove();
    };
  }, []);
  return { active, screenReader };
}

/** Only visible, uninterrupted reading time consumes the notification's duration. */
function useForegroundExpiry(duration: number, running: boolean, onExpire: () => void) {
  const remaining = useRef(duration);
  useEffect(() => {
    if (!running || duration <= 0) return;
    const started = Date.now();
    const timeout = setTimeout(onExpire, Math.max(0, remaining.current));
    return () => {
      clearTimeout(timeout);
      remaining.current = Math.max(0, remaining.current - Math.max(0, Date.now() - started));
    };
  }, [duration, running, onExpire]);
}

function notificationDuration(toast: Toast): number {
  if (toast.duration !== undefined) {
    return Number.isFinite(toast.duration) && toast.duration > 0
      ? Math.min(toast.duration, 2_147_483_647)
      : 0;
  }
  // An action stays available until it is taken or the person closes the card.
  if (toast.action) return 0;
  return Math.max(3500, Math.min(12000, toast.message.length * 80));
}

function ToastItem({
  toast,
  onDismiss,
  activity,
  reducedMotion,
  maxMessageHeight,
  canExpire = true,
  snackbar = false,
}: {
  toast: Toast;
  onDismiss: (id: string) => void;
  activity: NotificationActivity;
  reducedMotion: boolean;
  maxMessageHeight: number;
  canExpire?: boolean;
  snackbar?: boolean;
}) {
  const translateY = useRef(new Animated.Value(reducedMotion ? 0 : snackbar ? 8 : -8)).current;
  const opacity = useRef(new Animated.Value(reducedMotion ? 1 : 0)).current;
  const [exiting, setExiting] = useState(false);
  const [touching, setTouching] = useState(false);
  const [focused, setFocused] = useState(false);
  const [messageHeight, setMessageHeight] = useState(0);
  const closing = useRef(false);
  const announced = useRef(false);
  const hide = useCallback(() => {
    if (closing.current) return;
    closing.current = true;
    setExiting(true);
  }, []);

  useEffect(() => {
    let current = true;
    if (reducedMotion) {
      translateY.setValue(0);
      opacity.setValue(exiting ? 0 : 1);
      if (exiting) onDismiss(toast.id);
      return;
    }
    const animation = Animated.parallel([
      Animated.timing(translateY, {
        toValue: exiting ? (snackbar ? 6 : -6) : 0,
        duration: exiting ? 160 : 180,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(opacity, {
        toValue: exiting ? 0 : 1,
        duration: exiting ? 160 : 180,
        useNativeDriver: true,
      }),
    ]);
    animation.start(({ finished }) => {
      if (current && finished && exiting) onDismiss(toast.id);
    });
    return () => {
      current = false;
      animation.stop();
    };
  }, [exiting, reducedMotion, translateY, opacity, onDismiss, toast.id, snackbar]);

  useForegroundExpiry(
    notificationDuration(toast),
    canExpire &&
      activity.active &&
      activity.screenReader === false &&
      !touching &&
      !focused &&
      messageHeight <= maxMessageHeight &&
      !exiting,
    hide,
  );

  useEffect(() => {
    if (Platform.OS !== 'ios' || !activity.active || !activity.screenReader || announced.current)
      return;
    announced.current = true;
    AccessibilityInfo.announceForAccessibility(toast.message);
  }, [activity.active, activity.screenReader, toast.message]);

  const config = TYPE_CONFIG[toast.type ?? 'info'];
  const color = config.color;
  const textColor = snackbar ? theme.colors.bg : theme.colors.text;
  const actionColor = snackbar ? theme.colors.bg : color;
  const displayIcon = toast.icon || config.icon;

  return (
    <Animated.View
      accessibilityElementsHidden={exiting}
      importantForAccessibility={exiting ? 'no-hide-descendants' : 'auto'}
      pointerEvents={exiting ? 'none' : 'auto'}
      onTouchStart={() => setTouching(true)}
      onTouchEnd={() => setTouching(false)}
      onTouchCancel={() => setTouching(false)}
      style={{
        borderRadius: theme.radius.lg,
        overflow: 'hidden',
        ...softShadowStyle(theme.shadows.soft),
        transform: [{ translateY }],
        opacity,
      }}
    >
      <BlurView
        intensity={snackbar ? 0 : 80}
        tint={theme.mode === 'dark' ? 'dark' : 'light'}
        style={{
          backgroundColor: snackbar ? theme.colors.text : theme.colors.chromeTabBar,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: theme.colors.border,
          borderLeftWidth: snackbar ? StyleSheet.hairlineWidth : 3,
          borderLeftColor: snackbar ? theme.colors.border : color,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', padding: 12, gap: 8 }}>
          {!snackbar && (
            <View
              accessible={false}
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              style={{
                width: 30,
                height: 30,
                borderRadius: 9,
                marginTop: 5,
                backgroundColor: `${color}12`,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Ionicons
                name={displayIcon as React.ComponentProps<typeof Ionicons>['name']}
                size={18}
                color={color}
              />
            </View>
          )}
          <View style={{ flex: 1, minWidth: 0, paddingTop: 8 }}>
            <ScrollView
              style={{ maxHeight: maxMessageHeight, flexGrow: 0 }}
              showsVerticalScrollIndicator
              nestedScrollEnabled
              onContentSizeChange={(_width, contentHeight) => setMessageHeight(contentHeight)}
            >
              <Text
                accessibilityLiveRegion={activity.active ? 'polite' : 'none'}
                style={{ fontSize: 14, color: textColor, fontWeight: '500', lineHeight: 21 }}
              >
                {toast.message}
              </Text>
            </ScrollView>
            {toast.action && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={toast.action.text}
                accessibilityState={{ disabled: exiting }}
                disabled={exiting}
                onFocus={() => setFocused(true)}
                onBlur={() => setFocused(false)}
                onPress={() => {
                  if (closing.current) return;
                  hide();
                  toast.action?.onPress();
                }}
                style={({ pressed }) => ({
                  alignSelf: 'flex-start',
                  minHeight: 44,
                  minWidth: 44,
                  maxWidth: '100%',
                  paddingVertical: 10,
                  justifyContent: 'center',
                  opacity: pressed ? 0.65 : 1,
                })}
              >
                <Text
                  style={{
                    fontSize: 14,
                    fontWeight: '600',
                    color: actionColor,
                    textDecorationLine: 'underline',
                  }}
                >
                  {toast.action.text}
                </Text>
              </Pressable>
            )}
          </View>
          {toast.dismissible !== false && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="關閉通知"
              accessibilityState={{ disabled: exiting }}
              disabled={exiting}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              onPress={hide}
              style={({ pressed }) => ({
                width: 44,
                height: 44,
                borderRadius: 22,
                alignItems: 'center',
                justifyContent: 'center',
                opacity: pressed ? 0.6 : 1,
              })}
            >
              <Ionicons name="close" size={18} color={snackbar ? textColor : theme.colors.muted} />
            </Pressable>
          )}
        </View>
      </BlurView>
    </Animated.View>
  );
}

function useSafeInsets() {
  const context = React.useContext(SafeAreaInsetsContext);
  return context ?? { top: 0, bottom: 0, left: 0, right: 0 };
}

function ToastStack({
  toasts,
  onDismiss,
  activity,
  reducedMotion,
  maxHeight,
}: {
  toasts: Toast[];
  onDismiss: (id: string) => void;
  activity: NotificationActivity;
  reducedMotion: boolean;
  maxHeight: number;
}) {
  const [scrolled, setScrolled] = useState(false);
  return (
    <ScrollView
      style={{ flexGrow: 0 }}
      contentContainerStyle={{ gap: 8 }}
      keyboardShouldPersistTaps="handled"
      scrollEventThrottle={16}
      onScroll={({ nativeEvent }) => setScrolled(nativeEvent.contentOffset.y > 1)}
    >
      {toasts.map((toast, index) => (
        <ToastItem
          key={toast.id}
          toast={toast}
          onDismiss={onDismiss}
          activity={activity}
          reducedMotion={reducedMotion}
          maxMessageHeight={Math.max(44, maxHeight * 0.4)}
          // Later cards may be below the fold. They receive their full reading
          // time only after reaching the front of the stack.
          canExpire={index === 0 && !scrolled}
        />
      ))}
    </ScrollView>
  );
}

export function ToastProvider({
  children,
  maxToasts = 3,
}: {
  children: React.ReactNode;
  maxToasts?: number;
}) {
  useThemeMode();
  const insets = useSafeInsets();
  const { height } = useWindowDimensions();
  const reducedMotion = useReducedMotion();
  const activity = useNotificationActivity();
  const [toasts, setToasts] = useState<Toast[]>([]);
  const idCounter = useRef(0);

  const show = useCallback(
    (config: ToastConfig): string => {
      const id = `toast-${++idCounter.current}`;
      setToasts((prev) => {
        const updated = [...prev, { ...config, id }];
        return updated.length > maxToasts ? updated.slice(-maxToasts) : updated;
      });
      return id;
    },
    [maxToasts],
  );
  const success = useCallback(
    (message: string, config?: Partial<ToastConfig>) =>
      show({ ...config, message, type: 'success' }),
    [show],
  );
  const error = useCallback(
    (message: string, config?: Partial<ToastConfig>) => show({ ...config, message, type: 'error' }),
    [show],
  );
  const warning = useCallback(
    (message: string, config?: Partial<ToastConfig>) =>
      show({ ...config, message, type: 'warning' }),
    [show],
  );
  const info = useCallback(
    (message: string, config?: Partial<ToastConfig>) => show({ ...config, message, type: 'info' }),
    [show],
  );
  const dismiss = useCallback(
    (id: string) => setToasts((prev) => prev.filter((t) => t.id !== id)),
    [],
  );
  const dismissAll = useCallback(() => setToasts([]), []);
  const contextValue = useMemo(
    () => ({ show, success, error, warning, info, dismiss, dismissAll }),
    [show, success, error, warning, info, dismiss, dismissAll],
  );
  const maxHeight = Math.max(44, height - insets.top - insets.bottom - 24);

  return (
    <ToastContext.Provider value={contextValue}>
      {children}
      {toasts.length > 0 && (
        <View
          style={{
            position: 'absolute',
            top: insets.top + 8,
            left: 16,
            right: 16,
            zIndex: 9999,
            maxHeight,
          }}
          pointerEvents="box-none"
        >
          <ToastStack
            toasts={toasts}
            onDismiss={dismiss}
            activity={activity}
            reducedMotion={reducedMotion}
            maxHeight={maxHeight}
          />
        </View>
      )}
    </ToastContext.Provider>
  );
}

type SnackbarConfig = {
  message: string;
  action?: { text: string; onPress: () => void };
  duration?: number;
};

type SnackbarContextType = { show: (config: SnackbarConfig) => void; dismiss: () => void };
const SnackbarContext = createContext<SnackbarContextType | null>(null);

export function useSnackbar(): SnackbarContextType {
  const context = useContext(SnackbarContext);
  if (!context) throw new Error('useSnackbar must be used within a SnackbarProvider');
  return context;
}

export function SnackbarProvider({ children }: { children: React.ReactNode }) {
  useThemeMode();
  const insets = useSafeInsets();
  const { height } = useWindowDimensions();
  const reducedMotion = useReducedMotion();
  const activity = useNotificationActivity();
  const [notification, setNotification] = useState<Toast | null>(null);
  const sequence = useRef(0);
  const show = useCallback((config: SnackbarConfig) => {
    setNotification({
      ...config,
      duration:
        config.duration ??
        (config.action ? 0 : Math.max(4000, Math.min(12000, config.message.length * 80))),
      id: `snackbar-${++sequence.current}`,
    });
  }, []);
  const dismiss = useCallback(() => setNotification(null), []);
  const dismissNotification = useCallback((id: string) => {
    setNotification((current) => (current?.id === id ? null : current));
  }, []);
  const context = useMemo(() => ({ show, dismiss }), [show, dismiss]);

  return (
    <SnackbarContext.Provider value={context}>
      {children}
      {notification && (
        <View
          style={{
            position: 'absolute',
            left: 16,
            right: 16,
            bottom: insets.bottom + 90,
            zIndex: 9999,
          }}
        >
          <ToastItem
            key={notification.id}
            toast={notification}
            onDismiss={dismissNotification}
            activity={activity}
            reducedMotion={reducedMotion}
            maxMessageHeight={Math.max(44, (height - insets.top - insets.bottom - 180) * 0.5)}
            snackbar
          />
        </View>
      )}
    </SnackbarContext.Provider>
  );
}
