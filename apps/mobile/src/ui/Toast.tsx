import React, { createContext, useContext, useState, useCallback, useRef, useEffect, useMemo } from "react";
import { Animated, Pressable, StyleSheet, Text, View, Dimensions } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { theme, softShadowStyle } from "./theme";
import { SafeAreaInsetsContext } from "react-native-safe-area-context";

type ToastType = "success" | "error" | "warning" | "info";

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
  if (!context) throw new Error("useToast must be used within a ToastProvider");
  return context;
}

const TYPE_CONFIG: Record<ToastType, { color: string; icon: string }> = {
  success: { color: theme.colors.success, icon: "checkmark-circle" },
  error: { color: theme.colors.danger, icon: "close-circle" },
  warning: { color: theme.colors.warning, icon: "warning" },
  info: { color: theme.colors.accent, icon: "information-circle" },
};

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: (id: string) => void }) {
  const translateY = useRef(new Animated.Value(-80)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(0.9)).current;
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const config = TYPE_CONFIG[toast.type ?? "info"];
  const color = config.color;
  const displayIcon = toast.icon || config.icon;

  const show = useCallback(() => {
    Animated.parallel([
      Animated.spring(translateY, { toValue: 0, friction: 9, tension: 80, useNativeDriver: true }),
      Animated.timing(opacity, { toValue: 1, duration: 200, useNativeDriver: true }),
      Animated.spring(scale, { toValue: 1, friction: 9, tension: 80, useNativeDriver: true }),
    ]).start();
  }, []);

  const hide = useCallback(() => {
    Animated.parallel([
      Animated.timing(translateY, { toValue: -80, duration: 250, useNativeDriver: true }),
      Animated.timing(opacity, { toValue: 0, duration: 200, useNativeDriver: true }),
      Animated.timing(scale, { toValue: 0.9, duration: 200, useNativeDriver: true }),
    ]).start(() => onDismiss(toast.id));
  }, [onDismiss, toast.id]);

  useEffect(() => {
    show();
    const duration = toast.duration ?? 3500;
    if (duration > 0) timerRef.current = setTimeout(hide, duration);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, []);

  return (
    <Animated.View
      style={{
        backgroundColor: theme.colors.surface,
        borderRadius: theme.radius.lg,
        borderWidth: 1,
        borderColor: theme.colors.border,
        borderLeftWidth: 3,
        borderLeftColor: color,
        ...softShadowStyle(theme.shadows.soft),
        transform: [{ translateY }, { scale }],
        opacity,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", padding: 14, gap: 12 }}>
        <View
          style={{
            width: 34,
            height: 34,
            borderRadius: 10,
            backgroundColor: `${color}12`,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Ionicons name={displayIcon as any} size={18} color={color} />
        </View>

        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 14, color: theme.colors.text, fontWeight: "500", lineHeight: 20 }} numberOfLines={2}>
            {toast.message}
          </Text>
          {toast.action && (
            <Pressable onPress={toast.action.onPress} style={{ marginTop: 4 }}>
              <Text style={{ fontSize: 13, fontWeight: "600", color }}>{toast.action.text}</Text>
            </Pressable>
          )}
        </View>

        {toast.dismissible !== false && (
          <Pressable
            onPress={() => { if (timerRef.current) clearTimeout(timerRef.current); hide(); }}
            style={({ pressed }) => ({
              width: 28,
              height: 28,
              borderRadius: 14,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: pressed ? theme.colors.surface2 : "transparent",
            })}
            hitSlop={8}
          >
            <Ionicons name="close" size={16} color={theme.colors.muted} />
          </Pressable>
        )}
      </View>
    </Animated.View>
  );
}

function useSafeInsets() {
  const context = React.useContext(SafeAreaInsetsContext);
  return context ?? { top: 0, bottom: 0, left: 0, right: 0 };
}

export function ToastProvider({ children, maxToasts = 3 }: { children: React.ReactNode; maxToasts?: number }) {
  const insets = useSafeInsets();
  const [toasts, setToasts] = useState<Toast[]>([]);
  const idCounter = useRef(0);

  const show = useCallback((config: ToastConfig): string => {
    const id = `toast-${++idCounter.current}`;
    setToasts((prev) => {
      const updated = [...prev, { ...config, id }];
      return updated.length > maxToasts ? updated.slice(-maxToasts) : updated;
    });
    return id;
  }, [maxToasts]);

  const success = useCallback((message: string, config?: Partial<ToastConfig>) => show({ ...config, message, type: "success" }), [show]);
  const error = useCallback((message: string, config?: Partial<ToastConfig>) => show({ ...config, message, type: "error" }), [show]);
  const warning = useCallback((message: string, config?: Partial<ToastConfig>) => show({ ...config, message, type: "warning" }), [show]);
  const info = useCallback((message: string, config?: Partial<ToastConfig>) => show({ ...config, message, type: "info" }), [show]);
  const dismiss = useCallback((id: string) => setToasts((prev) => prev.filter((t) => t.id !== id)), []);
  const dismissAll = useCallback(() => setToasts([]), []);

  const contextValue = useMemo(
    () => ({ show, success, error, warning, info, dismiss, dismissAll }),
    [show, success, error, warning, info, dismiss, dismissAll]
  );

  return (
    <ToastContext.Provider value={contextValue}>
      {children}
      <View style={{ position: "absolute", top: insets.top + 8, left: 16, right: 16, zIndex: 9999, gap: 8 }} pointerEvents="box-none">
        {toasts.map((toast) => (
          <ToastItem key={toast.id} toast={toast} onDismiss={dismiss} />
        ))}
      </View>
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
  if (!context) throw new Error("useSnackbar must be used within a SnackbarProvider");
  return context;
}

export function SnackbarProvider({ children }: { children: React.ReactNode }) {
  const insets = useSafeInsets();
  const [config, setConfig] = useState<SnackbarConfig | null>(null);
  const [visible, setVisible] = useState(false);
  const translateY = useRef(new Animated.Value(100)).current;
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const dismiss = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    Animated.timing(translateY, { toValue: 100, duration: 200, useNativeDriver: true })
      .start(() => { setVisible(false); setConfig(null); });
  }, [translateY]);

  const show = useCallback((newConfig: SnackbarConfig) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setConfig(newConfig);
    setVisible(true);
    Animated.spring(translateY, { toValue: 0, friction: 9, tension: 80, useNativeDriver: true }).start();
    const duration = newConfig.duration ?? 4000;
    if (duration > 0) timerRef.current = setTimeout(dismiss, duration);
  }, [translateY, dismiss]);

  return (
    <SnackbarContext.Provider value={{ show, dismiss }}>
      {children}
      {visible && config && (
        <Animated.View
          style={{
            position: "absolute",
            left: 16,
            right: 16,
            bottom: insets.bottom + 90,
            flexDirection: "row",
            alignItems: "center",
            backgroundColor: theme.colors.text,
            borderRadius: theme.radius.md,
            paddingVertical: 14,
            paddingHorizontal: 18,
            ...softShadowStyle(theme.shadows.soft),
            zIndex: 9999,
            transform: [{ translateY }],
          }}
        >
          <Text style={{ flex: 1, fontSize: 14, color: theme.colors.bg, fontWeight: "500" }} numberOfLines={2}>
            {config.message}
          </Text>
          {config.action && (
            <Pressable onPress={() => { config.action?.onPress(); dismiss(); }} style={{ marginLeft: 14 }}>
              <Text style={{ fontSize: 14, fontWeight: "700", color: theme.colors.accent }}>{config.action.text}</Text>
            </Pressable>
          )}
        </Animated.View>
      )}
    </SnackbarContext.Provider>
  );
}
