/* eslint-disable */
import React, { Component, ErrorInfo, useEffect, useMemo, useRef, useState } from "react";
import { Animated, Pressable, Text, TextInput, View, Easing, ScrollView, ActivityIndicator, Platform, Dimensions, StyleSheet, type StyleProp, type ViewStyle } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { TAB_BAR_CONTENT_BOTTOM_PADDING } from "./navigationTheme";
import { theme, shadowStyle, softShadowStyle } from "./theme";
import { formatCountdown } from "../utils/format";
export { LoadingOverlay } from "./feedback/LoadingOverlay";
export { ToggleSwitch } from "./interactive/ToggleSwitch";

const { width: SCREEN_WIDTH } = Dimensions.get("window");

export function Spinner({ size = 24, color = theme.colors.accent }: { size?: number; color?: string }) {
  return <ActivityIndicator size={size} color={color} />;
}

export function Screen(props: { title?: string; subtitle?: string; children: React.ReactNode; noPadding?: boolean }) {
  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.bg }}>
      <View
        style={{
          flex: 1,
          paddingHorizontal: props.noPadding ? 0 : theme.space.lg,
          paddingTop: props.noPadding ? 0 : theme.space.md,
          paddingBottom: props.noPadding ? 0 : TAB_BAR_CONTENT_BOTTOM_PADDING,
        }}
      >
        {props.children}
      </View>
    </View>
  );
}

export function Card(props: {
  title?: string;
  subtitle?: string;
  children?: React.ReactNode;
  accessibilityLabel?: string;
  variant?: "default" | "elevated" | "outlined" | "filled";
  onPress?: () => void;
}) {
  const variant = props.variant ?? "default";

  const variantStyles = {
    default: {
      shell: shadowStyle(theme.shadows.sm),
      surface: {
        backgroundColor: theme.colors.surface,
        borderWidth: 1,
        borderColor: theme.colors.border,
      },
    },
    elevated: {
      shell: shadowStyle(theme.shadows.md),
      surface: {
        backgroundColor: theme.colors.surface,
        borderWidth: 1,
        borderColor: theme.colors.border,
      },
    },
    outlined: {
      shell: {},
      surface: {
        backgroundColor: "transparent",
        borderWidth: 1.5,
        borderColor: theme.colors.border,
      },
    },
    filled: {
      shell: {},
      surface: {
        backgroundColor: theme.colors.surface2,
        borderWidth: 1,
        borderColor: theme.colors.border,
      },
    },
  };

  const style = variantStyles[variant];
  const accessibilityLabel =
    props.accessibilityLabel ||
    (props.title && props.subtitle ? `${props.title}, ${props.subtitle}` : props.title);

  const content = (
    <View style={{ borderRadius: theme.radius.lg, ...style.shell }}>
      <View
        accessible={!!props.title}
        accessibilityRole={props.title ? "header" : undefined}
        accessibilityLabel={accessibilityLabel}
        style={{
          padding: theme.space.lg,
          borderRadius: theme.radius.lg,
          gap: theme.space.md,
          overflow: "hidden",
          ...style.surface,
        }}
      >
        {props.title ? (
          <Text
            style={{
              fontSize: theme.typography.h3.fontSize,
              fontWeight: theme.typography.h3.fontWeight ?? "600",
              lineHeight: theme.typography.h3.lineHeight,
              letterSpacing: theme.typography.h3.letterSpacing,
              color: theme.colors.text,
            }}
            accessibilityRole="header"
          >
            {props.title}
          </Text>
        ) : null}
        {props.subtitle ? (
          <Text
            style={{
              color: theme.colors.muted,
              lineHeight: theme.typography.bodySmall.lineHeight,
              fontSize: theme.typography.bodySmall.fontSize,
            }}
          >
            {props.subtitle}
          </Text>
        ) : null}
        {props.children}
      </View>
    </View>
  );

  if (props.onPress) {
    return (
      <Pressable
        onPress={props.onPress}
        style={({ pressed }) => ({
          opacity: pressed ? 0.85 : 1,
          transform: [{ scale: pressed ? 0.985 : 1 }],
        })}
      >
        {content}
      </Pressable>
    );
  }

  return content;
}

export function Pill(props: {
  text?: string;
  label?: string;
  kind?: "default" | "accent" | "success" | "muted" | "danger" | "warning";
  size?: "sm" | "md";
  icon?: string;
  selected?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const kind = props.selected ? "accent" : (props.kind ?? "default");
  const size = props.size ?? "md";
  const contentText = props.text ?? props.label ?? "";

  const kindStyles = {
    default: { bg: theme.colors.surface2, color: theme.colors.textSecondary },
    accent: { bg: theme.colors.accentSoft, color: theme.colors.accent },
    success: { bg: theme.colors.successSoft, color: theme.colors.success },
    muted: { bg: theme.colors.surface2, color: theme.colors.muted },
    danger: { bg: theme.colors.dangerSoft, color: theme.colors.danger },
    warning: { bg: theme.colors.warningSoft, color: theme.colors.warning },
  };

  const sizeStyles = {
    sm: { px: 8, py: 3, fontSize: 11 },
    md: { px: 12, py: 5, fontSize: 12 },
  };

  const kStyle = kindStyles[kind] || kindStyles.default;
  const sStyle = sizeStyles[size];

  return (
    <View
      style={[
        {
          alignSelf: "flex-start",
          flexDirection: "row",
          alignItems: "center",
          gap: theme.space.xs,
          paddingHorizontal: sStyle.px + 2,
          paddingVertical: sStyle.py + 1,
          borderRadius: theme.radius.full,
          backgroundColor: kStyle.bg,
          borderWidth: 1,
          borderColor: theme.colors.border,
        },
        props.style,
      ]}
      accessibilityRole="text"
    >
      {props.icon && (
        <Ionicons name={props.icon as any} size={sStyle.fontSize} color={kStyle.color} />
      )}
      <Text style={{ color: kStyle.color, fontSize: sStyle.fontSize, fontWeight: "600" }}>
        {contentText}
      </Text>
    </View>
  );
}

export function Button(props: {
  text: string;
  onPress?: () => void | Promise<void>;
  disabled?: boolean;
  loading?: boolean;
  kind?: "primary" | "secondary" | "danger" | "ghost" | "accent-ghost" | "outline";
  size?: "default" | "small" | "large";
  icon?: string;
  fullWidth?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const kind = props.kind ?? "secondary";
  const disabled = !!props.disabled || !!props.loading;
  const size = props.size ?? "default";

  const bgColors: Record<string, string> = {
    primary: theme.colors.accent,
    secondary: theme.colors.surface2,
    danger: theme.colors.danger,
    ghost: "transparent",
    "accent-ghost": theme.colors.accentSoft,
    outline: "transparent",
  };
  const textColors: Record<string, string> = {
    primary: "#FFFFFF",
    secondary: theme.colors.text,
    danger: "#FFFFFF",
    ghost: theme.colors.text,
    "accent-ghost": theme.colors.accent,
    outline: theme.colors.text,
  };
  const pressedBg: Record<string, string> = {
    primary: theme.colors.accentHover,
    secondary: theme.colors.surface2,
    danger: theme.colors.dangerSoft,
    ghost: theme.colors.surface2,
    "accent-ghost": theme.colors.accentSoft,
    outline: theme.colors.surface2,
  };
  const borderColors: Record<string, string> = {
    primary: "transparent",
    secondary: theme.colors.border,
    danger: "transparent",
    ghost: "transparent",
    "accent-ghost": "transparent",
    outline: theme.colors.border,
  };

  const sizeStyles = {
    small: { paddingVertical: theme.space.xs, paddingHorizontal: theme.space.md, fontSize: 13, radius: theme.radius.md },
    default: { paddingVertical: theme.space.sm, paddingHorizontal: theme.space.lg, fontSize: 15, radius: theme.radius.lg },
    large: { paddingVertical: theme.space.md, paddingHorizontal: theme.space.xl, fontSize: 16, radius: theme.radius.xl },
  };

  const s = sizeStyles[size];

  return (
    <Pressable
      disabled={disabled}
      onPress={props.onPress}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      accessibilityLabel={props.text}
      style={({ pressed }) => [
        {
          paddingVertical: s.paddingVertical,
          paddingHorizontal: s.paddingHorizontal,
          borderRadius: s.radius,
          backgroundColor: disabled
            ? theme.colors.disabledBg
            : pressed
              ? pressedBg[kind]
              : bgColors[kind],
          borderWidth: kind === "ghost" ? 0 : 1,
          borderColor: borderColors[kind],
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          gap: theme.space.xs,
          alignSelf: props.fullWidth ? "stretch" : "flex-start",
          minHeight: 44,
          transform: [{ scale: pressed && !disabled ? 0.97 : 1 }],
          ...(!disabled && kind === "primary" ? shadowStyle(theme.shadows.sm) : {}),
        },
        props.style,
      ]}
    >
      {props.loading ? (
        <ActivityIndicator size="small" color={textColors[kind]} />
      ) : props.icon ? (
        <Ionicons
          name={props.icon as any}
          size={s.fontSize + 1}
          color={disabled ? theme.colors.disabledText : textColors[kind]}
        />
      ) : null}
      <Text
        style={{
          color: disabled ? theme.colors.disabledText : textColors[kind],
          fontWeight: "600",
          fontSize: s.fontSize,
          letterSpacing: -0.1,
        }}
      >
        {props.loading ? "處理中..." : props.text}
      </Text>
    </Pressable>
  );
}

export function LoadingState(props: { title?: string; subtitle?: string; hint?: string; rows?: number }) {
  const rows = props.rows ?? 3;
  return (
    <View style={{ gap: theme.space.md, paddingVertical: theme.space.xl }}>
      <View style={{ alignItems: "center", gap: theme.space.md, paddingVertical: theme.space.lg }}>
        <Spinner size={32} />
        <Text style={{ color: theme.colors.text, fontSize: 16, fontWeight: "600" }}>
          {props.title ?? "載入中"}
        </Text>
        <Text style={{ color: theme.colors.muted, fontSize: 13 }}>
          {props.subtitle ?? "正在取得資料..."}
        </Text>
      </View>
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} height={72} borderRadius={theme.radius.lg} />
      ))}
    </View>
  );
}

export function EmptyState(props: {
  title?: string;
  subtitle?: string;
  hint?: string;
  actionText?: string;
  onAction?: () => void;
  icon?: string;
  variant?: "default" | "search" | "filter" | "error";
}) {
  const getIconAndColor = () => {
    switch (props.variant) {
      case "search":
        return { icon: props.icon ?? "search-outline", color: theme.colors.muted };
      case "filter":
        return { icon: props.icon ?? "filter-outline", color: theme.colors.accent };
      case "error":
        return { icon: props.icon ?? "alert-circle-outline", color: theme.colors.danger };
      default:
        return { icon: props.icon ?? "cube-outline", color: theme.colors.muted };
    }
  };

  const { icon, color } = getIconAndColor();

  return (
    <View style={{ gap: theme.space.md, alignItems: "center", paddingVertical: theme.space.xxxl, paddingHorizontal: theme.space.xl }}>
      <View
        style={{
          width: 88,
          height: 88,
          borderRadius: 44,
          backgroundColor: `${color}10`,
          alignItems: "center",
          justifyContent: "center",
          marginBottom: theme.space.md,
        }}
      >
        <Ionicons name={icon as any} size={36} color={color} />
      </View>
      <Text
        style={{
          color: theme.colors.text,
          fontSize: 18,
          fontWeight: "700",
          textAlign: "center",
          letterSpacing: -0.3,
        }}
      >
        {props.title ?? "目前沒有資料"}
      </Text>
      <Text
        style={{
          color: theme.colors.muted,
          fontSize: 14,
          textAlign: "center",
          lineHeight: 21,
          maxWidth: 280,
        }}
      >
        {props.subtitle ?? "你可以稍後再試，或重新整理頁面。"}
      </Text>
      {props.hint && (
        <Text style={{ color: theme.colors.muted, fontSize: 12, textAlign: "center", marginTop: theme.space.xs }}>
          {props.hint}
        </Text>
      )}
      {props.actionText && (
        <View style={{ marginTop: theme.space.lg }}>
          <Button text={props.actionText} onPress={props.onAction} kind="primary" />
        </View>
      )}
    </View>
  );
}

export type ErrorType = "network" | "server" | "auth" | "notFound" | "permission" | "unknown";

const ERROR_CONFIGS: Record<ErrorType, { icon: string; title: string; subtitle: string; hint: string; actionText: string }> = {
  network: {
    icon: "cloud-offline-outline",
    title: "網路連線問題",
    subtitle: "無法連接到伺服器",
    hint: "請檢查您的網路連線後重試。",
    actionText: "重新連線",
  },
  server: {
    icon: "server-outline",
    title: "伺服器錯誤",
    subtitle: "伺服器暫時無法處理請求",
    hint: "這可能是暫時性問題，請稍後再試。",
    actionText: "重試",
  },
  auth: {
    icon: "lock-closed-outline",
    title: "需要登入",
    subtitle: "此功能需要登入才能使用",
    hint: "請登入您的帳號以繼續。",
    actionText: "前往登入",
  },
  notFound: {
    icon: "search-outline",
    title: "找不到資料",
    subtitle: "您要找的內容不存在或已被移除",
    hint: "請檢查網址是否正確。",
    actionText: "返回",
  },
  permission: {
    icon: "shield-outline",
    title: "權限不足",
    subtitle: "您沒有權限存取此內容",
    hint: "如果您認為這是錯誤，請聯繫管理員。",
    actionText: "了解更多",
  },
  unknown: {
    icon: "alert-circle-outline",
    title: "發生錯誤",
    subtitle: "讀取資料失敗",
    hint: "發生未知錯誤，請重試。",
    actionText: "重試",
  },
};

export function ErrorState(props: {
  title?: string;
  subtitle?: string;
  hint?: string;
  actionText?: string;
  onAction?: () => void;
  errorType?: ErrorType;
  type?: ErrorType;
  errorCode?: string;
  showDetails?: boolean;
}) {
  const errorType = props.errorType ?? props.type ?? "unknown";
  const config = ERROR_CONFIGS[errorType];

  const title = props.title ?? config.title;
  const subtitle = props.subtitle ?? config.subtitle;
  const hint = props.hint ?? config.hint;
  const actionText = props.actionText ?? config.actionText;

  return (
    <View style={{ gap: theme.space.md, paddingVertical: theme.space.xl }} accessibilityRole="alert">
      <View
        style={{
          padding: theme.space.lg,
          borderRadius: theme.radius.lg,
          backgroundColor: theme.colors.dangerSoft,
          gap: theme.space.md,
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: theme.space.md }}>
          <View
            style={{
              width: 48,
              height: 48,
              borderRadius: 24,
              backgroundColor: `${theme.colors.danger}15`,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Ionicons name={config.icon as any} size={24} color={theme.colors.danger} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 16, fontWeight: "700", color: theme.colors.text, letterSpacing: -0.2 }}>
              {title}
            </Text>
            <Text style={{ color: theme.colors.muted, fontSize: 13, marginTop: theme.space.xs }}>{subtitle}</Text>
          </View>
        </View>

        <Text style={{ color: theme.colors.muted, lineHeight: 20, fontSize: 14 }}>{hint}</Text>

        {props.showDetails && props.errorCode && (
          <View style={{ padding: theme.space.sm, borderRadius: theme.radius.sm, backgroundColor: theme.colors.surface2 }}>
            <Text style={{ color: theme.colors.muted, fontSize: 11, fontFamily: Platform.select({ ios: "Menlo", default: "monospace" }) }}>
              錯誤代碼: {props.errorCode}
            </Text>
          </View>
        )}

        {props.onAction && (
          <View style={{ marginTop: theme.space.sm }}>
            <Button text={actionText} onPress={props.onAction} kind="primary" />
          </View>
        )}
      </View>
    </View>
  );
}

export function SectionTitle(props: { text: string }) {
  return (
    <Text style={{
      color: theme.colors.text,
      fontWeight: "700",
      fontSize: theme.typography.label.fontSize,
      letterSpacing: -0.1,
      textTransform: "uppercase",
    }}>
      {props.text}
    </Text>
  );
}

export function SearchBar(props: {
  value: string;
  onChange?: (t: string) => void;
  onChangeText?: (t: string) => void;
  placeholder?: string;
  onFocus?: () => void;
  onSubmit?: () => void;
}) {
  const [isFocused, setIsFocused] = useState(false);
  const handleChange = props.onChangeText ?? props.onChange ?? (() => {});

  return (
    <View
      style={{
        borderRadius: theme.radius.md,
        backgroundColor: theme.colors.surface2,
        paddingHorizontal: theme.space.md,
        paddingVertical: theme.space.sm,
        flexDirection: "row",
        alignItems: "center",
        gap: theme.space.sm,
        borderWidth: 1.5,
        borderColor: isFocused ? theme.colors.accent : "transparent",
      }}
    >
      <Ionicons name="search" size={18} color={isFocused ? theme.colors.accent : theme.colors.muted} />
      <TextInput
        value={props.value}
        onChangeText={handleChange}
        placeholder={props.placeholder ?? "搜尋"}
        placeholderTextColor={theme.colors.muted}
        onFocus={() => {
          setIsFocused(true);
          props.onFocus?.();
        }}
        onBlur={() => setIsFocused(false)}
        onSubmitEditing={props.onSubmit}
        returnKeyType="search"
        style={{
          flex: 1,
          color: theme.colors.text,
          fontSize: 15,
          padding: 0,
        }}
      />
      {props.value.length > 0 ? (
        <Pressable
          onPress={() => handleChange("")}
          style={{
            width: 24,
            height: 24,
            borderRadius: 12,
            backgroundColor: theme.colors.surface2,
            alignItems: "center",
            justifyContent: "center",
          }}
          accessibilityRole="button"
          accessibilityLabel="清除搜尋"
        >
          <Ionicons name="close" size={14} color={theme.colors.muted} />
        </Pressable>
      ) : null}
    </View>
  );
}

export function CountdownTimer(props: { targetDate: Date; label?: string; onExpire?: () => void }) {
  const [countdown, setCountdown] = useState(formatCountdown(props.targetDate));

  useEffect(() => {
    const timer = setInterval(() => {
      const newCountdown = formatCountdown(props.targetDate);
      setCountdown(newCountdown);
      if (newCountdown.isExpired && props.onExpire) {
        props.onExpire();
        clearInterval(timer);
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [props.targetDate, props.onExpire]);

  if (countdown.isExpired) {
    return (
      <View style={{ alignItems: "center", padding: theme.space.md }}>
        <Pill text="已截止" kind="danger" />
      </View>
    );
  }

  const units = [
    { value: countdown.days, label: "天" },
    { value: countdown.hours, label: "時" },
    { value: countdown.minutes, label: "分" },
    { value: countdown.seconds, label: "秒" },
  ];

  return (
    <View style={{ alignItems: "center" }}>
      {props.label ? (
        <Text style={{ color: theme.colors.muted, marginBottom: theme.space.md, fontSize: 12, fontWeight: "500" }}>
          {props.label}
        </Text>
      ) : null}
      <View style={{ flexDirection: "row", gap: theme.space.sm }}>
        {units.map((unit) => (
          <View
            key={unit.label}
            style={{
              alignItems: "center",
              minWidth: 52,
              paddingVertical: theme.space.sm,
              paddingHorizontal: theme.space.xs,
              borderRadius: theme.radius.md,
              backgroundColor: theme.colors.accentSoft,
            }}
          >
            <Text style={{ color: theme.colors.accent, fontWeight: "800", fontSize: 22, letterSpacing: -0.5 }}>
              {String(unit.value).padStart(2, "0")}
            </Text>
            <Text style={{ color: theme.colors.muted, fontSize: 10, marginTop: theme.space.xs, fontWeight: "500" }}>
              {unit.label}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

export function ProgressRing(props: {
  progress: number;
  size?: number;
  strokeWidth?: number;
  color?: string;
  showLabel?: boolean;
}) {
  const size = props.size ?? 60;
  const strokeWidth = props.strokeWidth ?? 5;
  const color = props.color ?? theme.colors.accent;
  const progress = Math.min(1, Math.max(0, props.progress));
  const showLabel = props.showLabel !== false;

  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      <View
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          borderWidth: strokeWidth,
          borderColor: theme.colors.surface2,
          position: "absolute",
        }}
      />
      <View
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          borderWidth: strokeWidth,
          borderColor: color,
          borderTopColor: "transparent",
          borderRightColor: progress > 0.25 ? color : "transparent",
          borderBottomColor: progress > 0.5 ? color : "transparent",
          borderLeftColor: progress > 0.75 ? color : "transparent",
          position: "absolute",
          transform: [{ rotate: "-90deg" }],
        }}
      />
      {showLabel && (
        <Text style={{ color: theme.colors.text, fontWeight: "800", fontSize: size * 0.22 }}>
          {Math.round(progress * 100)}%
        </Text>
      )}
    </View>
  );
}

export function StatusBadge(props: { status: string; text?: string; label?: string }) {
  const configs: Record<string, { color: string; icon: any; defaultText: string }> = {
    open: { color: theme.colors.success, icon: "checkmark-circle" as const, defaultText: "營業中" },
    closed: { color: theme.colors.danger, icon: "close-circle" as const, defaultText: "已打烊" },
    busy: { color: theme.colors.warning, icon: "alert-circle" as const, defaultText: "人潮擁擠" },
    online: { color: theme.colors.success, icon: "ellipse" as const, defaultText: "在線" },
    offline: { color: theme.colors.muted, icon: "ellipse" as const, defaultText: "離線" },
  };
  const config = configs[props.status] ?? { color: theme.colors.muted, icon: "ellipse" as const, defaultText: props.status };

  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: theme.space.xs,
        paddingHorizontal: theme.space.sm,
        paddingVertical: theme.space.xs,
        borderRadius: theme.radius.full,
        backgroundColor: `${config.color}12`,
      }}
    >
      <Ionicons name={config.icon} size={10} color={config.color} />
      <Text style={{ color: config.color, fontWeight: "600", fontSize: 12 }}>
        {props.text ?? props.label ?? config.defaultText}
      </Text>
    </View>
  );
}

export function RatingStars(props: {
  rating: number;
  maxRating?: number;
  size?: number;
  interactive?: boolean;
  onChange?: (rating: number) => void;
}) {
  const maxRating = props.maxRating ?? 5;
  const size = props.size ?? 18;
  const minTouchSize = Math.max(size, 44);

  return (
    <View
      style={{ flexDirection: "row", gap: theme.space.xs, alignItems: "center" }}
      accessibilityRole={props.interactive ? "adjustable" : "text"}
      accessibilityLabel={`評分 ${props.rating.toFixed(1)} 星，滿分 ${maxRating} 星`}
      accessibilityValue={{ min: 0, max: maxRating, now: Math.round(props.rating) }}
    >
      {Array.from({ length: maxRating }).map((_, i) => {
        const filled = i < Math.floor(props.rating);
        const half = !filled && i < props.rating;
        return (
          <Pressable
            key={i}
            onPress={() => props.interactive && props.onChange?.(i + 1)}
            disabled={!props.interactive}
            accessibilityRole={props.interactive ? "button" : "image"}
            accessibilityLabel={props.interactive ? `給 ${i + 1} 星` : undefined}
            hitSlop={{ top: (minTouchSize - size) / 2, bottom: (minTouchSize - size) / 2, left: 4, right: 4 }}
            style={{ padding: props.interactive ? 2 : 0 }}
          >
            <Ionicons
              name={filled ? "star" : half ? "star-half" : "star-outline"}
              size={size}
              color="#F59E0B"
            />
          </Pressable>
        );
      })}
      <Text style={{ color: theme.colors.muted, fontSize: size * 0.75, marginLeft: theme.space.xs, fontWeight: "600" }}>
        {props.rating.toFixed(1)}
      </Text>
    </View>
  );
}

export function AnimatedCard(props: {
  title?: string;
  subtitle?: string;
  children?: React.ReactNode;
  delay?: number;
  variant?: "default" | "elevated";
}) {
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(16)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 450,
        delay: props.delay ?? 0,
        useNativeDriver: true,
        easing: Easing.out(Easing.cubic),
      }),
      Animated.timing(translateY, {
        toValue: 0,
        duration: 450,
        delay: props.delay ?? 0,
        useNativeDriver: true,
        easing: Easing.out(Easing.cubic),
      }),
    ]).start();
  }, []);

  return (
    <Animated.View
      style={{
        opacity: fadeAnim,
        transform: [{ translateY }],
        padding: theme.space.lg,
        borderRadius: theme.radius.lg,
        backgroundColor: theme.colors.surface,
        gap: theme.space.md,
        borderWidth: 1,
        borderColor: theme.colors.border,
        ...softShadowStyle(theme.shadows.soft),
      }}
    >
      {props.title ? (
        <Text style={{ fontSize: 17, fontWeight: "700", color: theme.colors.text, letterSpacing: -0.2 }}>
          {props.title}
        </Text>
      ) : null}
      {props.subtitle ? (
        <Text style={{ color: theme.colors.muted, lineHeight: 20, fontSize: 14 }}>{props.subtitle}</Text>
      ) : null}
      {props.children}
    </Animated.View>
  );
}

export function QuickAction(props: {
  icon: string;
  label: string;
  onPress?: () => void;
  badge?: number;
  disabled?: boolean;
  color?: string;
}) {
  const badgeText =
    props.badge && props.badge > 0
      ? props.badge > 99
        ? "99+"
        : String(props.badge)
      : null;
  const color = props.color ?? theme.colors.accent;

  return (
    <Pressable
      onPress={props.onPress}
      disabled={props.disabled}
      accessibilityRole="button"
      accessibilityLabel={props.label + (badgeText ? `，${badgeText}則通知` : "")}
      accessibilityState={{ disabled: props.disabled }}
      style={({ pressed }) => ({
        alignItems: "center",
        justifyContent: "center",
        padding: theme.space.md,
        borderRadius: theme.radius.lg,
        backgroundColor: pressed ? theme.colors.accentSoft : theme.colors.surface,
        borderWidth: 1,
        borderColor: pressed ? theme.colors.accent : theme.colors.border,
        minWidth: 76,
        minHeight: 76,
        position: "relative",
        opacity: props.disabled ? 0.4 : 1,
        ...softShadowStyle(theme.shadows.soft),
        transform: [{ scale: pressed ? 0.95 : 1 }],
      })}
    >
      <View
        style={{
          width: 36,
          height: 36,
          borderRadius: 18,
          backgroundColor: `${color}12`,
          alignItems: "center",
          justifyContent: "center",
          marginBottom: theme.space.sm,
        }}
      >
        <Ionicons name={props.icon as any} size={18} color={color} />
      </View>
      <Text style={{ fontSize: 12, fontWeight: "600", color: theme.colors.text, textAlign: "center" }}>
        {props.label}
      </Text>
      {badgeText ? (
        <View
          style={{
            position: "absolute",
            top: -6,
            right: -6,
            width: 20,
            height: 20,
            borderRadius: 10,
            backgroundColor: theme.colors.danger,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Text style={{ fontSize: 10, fontWeight: "700", color: "#fff" }}>{badgeText}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

export function InfoRow(props: {
  label: string;
  value: string;
  direction?: "horizontal" | "vertical";
  icon?: string;
}) {
  const isVertical = props.direction === "vertical";

  return (
    <View
      style={{
        flexDirection: isVertical ? "column" : "row",
        justifyContent: isVertical ? "flex-start" : "space-between",
        alignItems: isVertical ? "flex-start" : "center",
        gap: isVertical ? theme.space.xs : 0,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: theme.space.sm }}>
        {props.icon && <Ionicons name={props.icon as any} size={16} color={theme.colors.muted} />}
        <Text style={{ fontSize: 13, color: theme.colors.muted, fontWeight: "500" }}>{props.label}</Text>
      </View>
      <Text style={{ fontSize: 14, color: theme.colors.text, fontWeight: "600" }}>{props.value}</Text>
    </View>
  );
}

export function Skeleton(props: { width?: number | string; height?: number; borderRadius?: number }) {
  const styleObj: any = {
    height: props.height ?? 20,
    borderRadius: props.borderRadius ?? theme.radius.md,
    backgroundColor: theme.colors.surface2,
    overflow: "hidden",
  };
  if (props.width !== undefined) {
    styleObj.width = props.width;
  } else {
    styleObj.width = "100%";
  }
  return (
    <View style={styleObj} />
  );
}

export function Divider(props: { text?: string; spacing?: number }) {
  const spacing = props.spacing ?? theme.space.md;

  if (props.text) {
    return (
      <View style={{ flexDirection: "row", alignItems: "center", gap: theme.space.md, marginVertical: spacing }}>
        <View style={{ flex: 1, height: 1, backgroundColor: theme.colors.border }} />
        <Text style={{ color: theme.colors.muted, fontSize: 12, fontWeight: "500" }}>{props.text}</Text>
        <View style={{ flex: 1, height: 1, backgroundColor: theme.colors.border }} />
      </View>
    );
  }

  return <View style={{ height: 1, backgroundColor: theme.colors.border, marginVertical: spacing }} />;
}

export function FeatureHighlight(props: { icon: string; title: string; description: string; color?: string }) {
  const color = props.color ?? theme.colors.accent;

  return (
    <View style={{ gap: theme.space.sm, alignItems: "flex-start" }}>
      <View
        style={{
          width: 40,
          height: 40,
          borderRadius: 12,
          backgroundColor: `${color}15`,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Ionicons name={props.icon as any} size={20} color={color} />
      </View>
      <Text style={{ fontSize: 15, fontWeight: "700", color: theme.colors.text, letterSpacing: -0.2 }}>
        {props.title}
      </Text>
      <Text style={{ fontSize: 13, color: theme.colors.muted, lineHeight: 20 }}>
        {props.description}
      </Text>
    </View>
  );
}

export function FilterChips(props: {
  options: any[];
  selected?: any[];
  onSelect?: (ids: any[]) => void;
  onChange?: (ids: any[]) => void;
  multi?: boolean;
  multiple?: boolean;
}) {
  const selected = props.selected ?? [];
  const isMulti = props.multi || props.multiple;
  const handleChange = props.onSelect || props.onChange || (() => {});

  const handleSelect = (id: any) => {
    if (isMulti) {
      const newSelected = selected.includes(id)
        ? selected.filter((s) => s !== id)
        : [...selected, id];
      handleChange(newSelected);
    } else {
      handleChange([id]);
    }
  };

  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: theme.space.sm }}>
      {props.options.map((option: any) => {
        const optionId = typeof option === "object" ? (option.id ?? option.key) : option;
        const optionLabel = typeof option === "object" ? option.label : option;
        return (
          <FilterChip
            key={optionId}
            label={String(optionLabel)}
            selected={selected.includes(optionId)}
            onPress={() => handleSelect(optionId)}
          />
        );
      })}
    </View>
  );
}

export function FilterChip(props: { label: string; selected?: boolean; onPress?: () => void }) {
  return (
    <Pressable
      onPress={props.onPress}
      style={({ pressed }) => ({
        paddingHorizontal: theme.space.md,
        paddingVertical: theme.space.sm,
        borderRadius: theme.radius.full,
        backgroundColor: props.selected ? theme.colors.accent : theme.colors.surface2,
        borderWidth: 1,
        borderColor: props.selected ? theme.colors.accent : theme.colors.border,
        opacity: pressed ? 0.85 : 1,
      })}
    >
      <Text
        style={{
          fontSize: 13,
          fontWeight: "600",
          color: props.selected ? "#fff" : theme.colors.text,
        }}
      >
        {props.label}
      </Text>
    </Pressable>
  );
}

export function SegmentedControl(props: {
  options: any[];
  selected?: any;
  onSelect?: (id: any) => void;
  onChange?: (id: any) => void;
}) {
  const getOptionId = (opt: any) => typeof opt === "object" ? (opt.id ?? opt.key) : opt;
  const getOptionLabel = (opt: any) => typeof opt === "object" ? opt.label : opt;
  const selected = props.selected ?? getOptionId(props.options[0]);
  const handleChange = props.onSelect || props.onChange || (() => {});

  return (
    <View style={{ flexDirection: "row", padding: theme.space.xs, borderRadius: theme.radius.lg, backgroundColor: theme.colors.surface2, gap: theme.space.xs }}>
      {props.options.map((option: any) => {
        const optionId = getOptionId(option);
        const optionLabel = getOptionLabel(option);
        return (
          <Pressable
            key={optionId}
            onPress={() => handleChange(optionId)}
            style={{
              flex: 1,
              paddingVertical: theme.space.sm,
              paddingHorizontal: theme.space.md,
              borderRadius: theme.radius.md,
              backgroundColor: optionId === selected ? theme.colors.surface : "transparent",
              alignItems: "center",
            }}
          >
            <Text
              style={{
                fontSize: 13,
                fontWeight: "600",
                color: optionId === selected ? theme.colors.accent : theme.colors.muted,
              }}
            >
              {optionLabel}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function SortButton(props: {
  options: any[];
  selected?: any;
  onSelect?: (id: any) => void;
  onChange?: (id: any) => void;
  label?: string;
}) {
  const [visible, setVisible] = useState(false);
  const getOptionId = (opt: any) => typeof opt === "object" ? (opt.id ?? opt.key) : opt;
  const getOptionLabel = (opt: any) => typeof opt === "object" ? opt.label : opt;
  const selected = props.selected ?? getOptionId(props.options[0]);
  const handleChange = props.onSelect || props.onChange || (() => {});

  return (
    <View>
      <Pressable
        onPress={() => setVisible(!visible)}
        style={({ pressed }) => ({
          flexDirection: "row",
          alignItems: "center",
          gap: theme.space.sm,
          paddingHorizontal: theme.space.md,
          paddingVertical: theme.space.sm,
          borderRadius: theme.radius.lg,
          backgroundColor: visible ? theme.colors.surface2 : "transparent",
          opacity: pressed ? 0.85 : 1,
        })}
      >
        <Ionicons name="funnel-outline" size={16} color={theme.colors.accent} />
        <Text style={{ fontSize: 13, fontWeight: "600", color: theme.colors.text }}>
          {props.label ?? "排序"}
        </Text>
      </Pressable>

      {visible && (
        <View style={{ marginTop: theme.space.sm, borderRadius: theme.radius.lg, backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border, overflow: "hidden" }}>
          {props.options.map((option: any, idx: number) => {
            const optionId = getOptionId(option);
            const optionLabel = getOptionLabel(option);
            const isLast = idx === props.options.length - 1;
            return (
              <Pressable
                key={optionId}
                onPress={() => {
                  handleChange(optionId);
                  setVisible(false);
                }}
                style={({ pressed }) => ({
                  paddingHorizontal: theme.space.md,
                  paddingVertical: theme.space.md,
                  backgroundColor: pressed ? theme.colors.surface2 : "transparent",
                  borderBottomWidth: isLast ? 0 : 1,
                  borderBottomColor: theme.colors.border,
                  flexDirection: "row",
                  justifyContent: "space-between",
                  alignItems: "center",
                })}
              >
                <Text
                  style={{
                    fontSize: 14,
                    color: optionId === selected ? theme.colors.accent : theme.colors.text,
                    fontWeight: optionId === selected ? "700" : "500",
                  }}
                >
                  {optionLabel}
                </Text>
                {optionId === selected && (
                  <Ionicons name="checkmark" size={18} color={theme.colors.accent} />
                )}
              </Pressable>
            );
          })}
        </View>
      )}
    </View>
  );
}

export function StatCard(props: {
  icon?: string;
  label: string;
  value: string | number;
  trend?: "up" | "down" | "neutral";
  trendValue?: string;
  color?: string;
  onPress?: () => void;
}) {
  const color = props.color ?? theme.colors.accent;
  const valueStr = String(props.value);

  const trendIcon =
    props.trend === "up"
      ? "trending-up"
      : props.trend === "down"
        ? "trending-down"
        : "subtract-outline";

  const trendColor =
    props.trend === "up"
      ? theme.colors.success
      : props.trend === "down"
        ? theme.colors.danger
        : theme.colors.muted;

  const content = (
    <View style={{ padding: theme.space.lg, borderRadius: theme.radius.lg, backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border, gap: theme.space.md }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }}>
        {props.icon && (
          <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: `${color}15`, alignItems: "center", justifyContent: "center" }}>
            <Ionicons name={props.icon as any} size={20} color={color} />
          </View>
        )}
        {props.trend && props.trendValue && (
          <View style={{ flexDirection: "row", alignItems: "center", gap: theme.space.xs }}>
            <Ionicons name={trendIcon as any} size={14} color={trendColor} />
            <Text style={{ fontSize: 12, fontWeight: "700", color: trendColor }}>
              {props.trendValue}
            </Text>
          </View>
        )}
      </View>
      <View style={{ gap: theme.space.xs }}>
        <Text style={{ fontSize: 13, color: theme.colors.muted, fontWeight: "500" }}>
          {props.label}
        </Text>
        <Text style={{ fontSize: 24, fontWeight: "800", color: theme.colors.text, letterSpacing: -0.5 }}>
          {valueStr}
        </Text>
      </View>
    </View>
  );

  if (props.onPress) {
    return (
      <Pressable
        onPress={props.onPress}
        style={({ pressed }) => ({
          opacity: pressed ? 0.85 : 1,
          transform: [{ scale: pressed ? 0.98 : 1 }],
        })}
      >
        {content}
      </Pressable>
    );
  }

  return content;
}

export function PriceRangeSlider(props: {
  min: number;
  max: number;
  minValue: number;
  maxValue: number;
  onMinChange?: (value: number) => void;
  onMaxChange?: (value: number) => void;
  step?: number;
}) {
  const step = props.step ?? 1;
  const range = props.max - props.min;

  return (
    <View style={{ gap: theme.space.md }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <Text style={{ fontSize: 13, color: theme.colors.text, fontWeight: "600" }}>
          ${props.minValue}
        </Text>
        <Text style={{ fontSize: 13, color: theme.colors.text, fontWeight: "600" }}>
          ${props.maxValue}
        </Text>
      </View>
      <View style={{ height: 4, borderRadius: 2, backgroundColor: theme.colors.surface2, overflow: "hidden" }}>
        <View
          style={{
            height: "100%",
            backgroundColor: theme.colors.accent,
            marginLeft: `${((props.minValue - props.min) / range) * 100}%`,
            width: `${((props.maxValue - props.minValue) / range) * 100}%`,
          }}
        />
      </View>
    </View>
  );
}

export function Avatar(props: { name?: string; size?: number; imageUrl?: string; color?: string }) {
  const size = props.size ?? 40;
  const color = props.color ?? theme.colors.accent;
  const initials = props.name
    ?.split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase() ?? "?";

  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: props.imageUrl ? "transparent" : `${color}30`,
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
      }}
    >
      {props.imageUrl ? (
        <Text style={{ color }}>{initials}</Text>
      ) : (
        <Text style={{ color, fontSize: size * 0.4, fontWeight: "700" }}>{initials}</Text>
      )}
    </View>
  );
}

export function Badge(props: { count?: number; max?: number; dot?: boolean; text?: string }) {
  if (props.dot) {
    return (
      <View
        style={{
          width: 8,
          height: 8,
          borderRadius: 4,
          backgroundColor: theme.colors.danger,
        }}
      />
    );
  }

  const text = props.text ?? (props.count && props.count > (props.max ?? 99) ? `${props.max ?? 99}+` : String(props.count ?? 0));

  return (
    <View
      style={{
        minWidth: 20,
        height: 20,
        borderRadius: 10,
        backgroundColor: theme.colors.danger,
        alignItems: "center",
        justifyContent: "center",
        paddingHorizontal: 6,
      }}
    >
      <Text style={{ fontSize: 11, fontWeight: "700", color: "#fff" }}>{text}</Text>
    </View>
  );
}

export function ListItem(props: {
  title: string;
  subtitle?: string;
  icon?: string;
  rightText?: string;
  rightIcon?: string;
  onPress?: () => void;
  danger?: boolean;
  disabled?: boolean;
  accessibilityHint?: string;
  iconColor?: string;
  iconBg?: string;
}) {
  const textColor = props.danger ? theme.colors.danger : props.disabled ? theme.colors.muted : theme.colors.text;
  const iconColor = props.iconColor ?? (props.danger ? theme.colors.danger : theme.colors.accent);
  const iconBg = props.iconBg ?? `${iconColor}10`;

  const accessibilityLabel = props.subtitle
    ? `${props.title}, ${props.subtitle}${props.rightText ? `, ${props.rightText}` : ""}`
    : `${props.title}${props.rightText ? `, ${props.rightText}` : ""}`;

  const content = (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        paddingVertical: theme.space.sm,
        paddingHorizontal: theme.space.xs,
        gap: theme.space.md,
        opacity: props.disabled ? 0.4 : 1,
        minHeight: 50,
      }}
    >
      {props.icon && (
        <View
          style={{
            width: 38,
            height: 38,
            borderRadius: 11,
            backgroundColor: iconBg,
            alignItems: "center",
            justifyContent: "center",
          }}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          <Ionicons name={props.icon as any} size={18} color={iconColor} />
        </View>
      )}
      <View style={{ flex: 1 }}>
        <Text style={{ color: textColor, fontWeight: "500", fontSize: 15, letterSpacing: -0.1 }}>
          {props.title}
        </Text>
        {props.subtitle && (
          <Text style={{ color: theme.colors.muted, fontSize: 13, marginTop: theme.space.xs }}>{props.subtitle}</Text>
        )}
      </View>
      {props.rightText && (
        <Text style={{ color: theme.colors.muted, fontSize: 13 }} accessibilityElementsHidden>
          {props.rightText}
        </Text>
      )}
      {props.rightIcon && <Ionicons name={props.rightIcon as any} size={18} color={theme.colors.muted} />}
      {props.onPress && !props.rightIcon && (
        <Ionicons name="chevron-forward" size={16} color={theme.colors.muted} accessibilityElementsHidden />
      )}
    </View>
  );

  if (props.onPress && !props.disabled) {
    return (
      <Pressable
        onPress={props.onPress}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        accessibilityHint={props.accessibilityHint}
        accessibilityState={{ disabled: props.disabled }}
        style={({ pressed }) => ({
          backgroundColor: pressed ? theme.colors.surface2 : "transparent",
          marginHorizontal: -4,
          paddingHorizontal: theme.space.xs,
          borderRadius: theme.radius.sm,
        })}
      >
        {content}
      </Pressable>
    );
  }
  return (
    <View accessibilityLabel={accessibilityLabel}>{content}</View>
  );
}

export function SectionHeader(props: { title: string; action?: string; onAction?: () => void }) {
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: theme.space.md }}>
      <Text style={{ fontSize: theme.typography.label.fontSize, fontWeight: "700", color: theme.colors.text, textTransform: "uppercase" }}>
        {props.title}
      </Text>
      {props.action && props.onAction && (
        <Pressable onPress={props.onAction} accessibilityRole="button" accessibilityLabel={props.action}>
          <Text style={{ fontSize: 13, color: theme.colors.accent, fontWeight: "600" }}>{props.action}</Text>
        </Pressable>
      )}
    </View>
  );
}

export function EmptyListPlaceholder(props: {
  icon?: string;
  title?: string;
  subtitle?: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  const desc = props.description ?? props.subtitle ?? "暫無相關資料";
  return (
    <View style={{ alignItems: "center", paddingVertical: theme.space.xxxl, paddingHorizontal: theme.space.xl, gap: theme.space.md }}>
      {props.icon && (
        <View style={{ width: 60, height: 60, borderRadius: 30, backgroundColor: theme.colors.surface2, alignItems: "center", justifyContent: "center", marginBottom: theme.space.md }}>
          <Ionicons name={props.icon as any} size={28} color={theme.colors.muted} />
        </View>
      )}
      <Text style={{ fontSize: 16, fontWeight: "700", color: theme.colors.text, textAlign: "center" }}>
        {props.title ?? "沒有內容"}
      </Text>
      <Text style={{ fontSize: 13, color: theme.colors.muted, textAlign: "center", lineHeight: 20 }}>
        {desc}
      </Text>
      {props.actionLabel && props.onAction && (
        <View style={{ marginTop: theme.space.md }}>
          <Button text={props.actionLabel} onPress={props.onAction} kind="primary" />
        </View>
      )}
    </View>
  );
}

export class ScreenErrorBoundary extends Component<{ children: React.ReactNode; screenName?: string }, { hasError: boolean }> {
  constructor(props: { children: React.ReactNode; screenName?: string }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("[ScreenErrorBoundary]", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <View style={{ flex: 1, backgroundColor: theme.colors.bg, alignItems: "center", justifyContent: "center", paddingHorizontal: theme.space.lg }}>
          <ErrorState errorType="unknown" />
        </View>
      );
    }

    return this.props.children;
  }
}

export const ErrorBoundary = ScreenErrorBoundary;

export function AuthGuard(props: {
  children: React.ReactNode;
  isAuthenticated?: boolean;
  user?: any;
  fallback?: React.ReactNode;
  onLogin?: () => void;
  title?: string;
  description?: string;
}) {
  const isAuth = props.isAuthenticated ?? !!props.user;
  if (!isAuth) {
    return props.fallback ?? (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <ErrorState errorType="auth" />
      </View>
    );
  }

  return <>{props.children}</>;
}

export function ConfirmDialog(props: {
  visible?: boolean;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  onConfirm?: () => void;
  onCancel?: () => void;
  isDangerous?: boolean;
}) {
  if (!props.visible) return null;

  return (
    <View
      style={{
        ...StyleSheet.absoluteFillObject,
        backgroundColor: "rgba(0,0,0,0.5)",
        alignItems: "center",
        justifyContent: "center",
        padding: theme.space.lg,
      }}
    >
      <View
        style={{
          backgroundColor: theme.colors.surface,
          borderRadius: theme.radius.xl,
          padding: theme.space.lg,
          gap: theme.space.md,
          width: "100%",
          maxWidth: 320,
        }}
      >
        <Text style={{ fontSize: 17, fontWeight: "700", color: theme.colors.text }}>
          {props.title}
        </Text>
        <Text style={{ fontSize: 14, color: theme.colors.muted, lineHeight: 21 }}>
          {props.message}
        </Text>
        <View style={{ flexDirection: "row", gap: theme.space.sm }}>
          <Button
            text={props.cancelText ?? "取消"}
            onPress={props.onCancel}
            kind="ghost"
            style={{ flex: 1 }}
          />
          <Button
            text={props.confirmText ?? "確認"}
            onPress={props.onConfirm}
            kind={props.isDangerous ? "danger" : "primary"}
            style={{ flex: 1 }}
          />
        </View>
      </View>
    </View>
  );
}
