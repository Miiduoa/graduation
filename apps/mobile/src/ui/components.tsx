import React, { Component, ErrorInfo, useEffect, useMemo, useRef, useState } from "react";
import { Animated, Pressable, Text, TextInput, View, Easing, ScrollView, ActivityIndicator, Platform, Dimensions, type StyleProp, type ViewStyle } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { TAB_BAR_CONTENT_BOTTOM_PADDING } from "./navigationTheme";
import { theme, shadowStyle, softShadowStyle } from "./theme";
import { formatCountdown } from "../utils/format";

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
      shell: softShadowStyle(theme.shadows.soft),
      surface: {
        backgroundColor: theme.colors.surface,
        borderWidth: 1,
        borderColor: theme.colors.border,
      },
    },
    elevated: {
      shell: softShadowStyle(theme.shadows.soft),
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
          gap: 10,
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
    default: { bg: theme.colors.surfaceElevated, color: theme.colors.textSecondary },
    accent: { bg: theme.colors.accentSoft, color: theme.colors.accent },
    success: { bg: theme.colors.successSoft, color: theme.colors.success },
    muted: { bg: theme.colors.surfaceElevated, color: theme.colors.muted },
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
          gap: 4,
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
    secondary: theme.colors.surfaceElevated,
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
    outline: theme.colors.surfaceElevated,
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
    small: { paddingVertical: 9, paddingHorizontal: 16, fontSize: 13, radius: theme.radius.md },
    default: { paddingVertical: 13, paddingHorizontal: 22, fontSize: 15, radius: theme.radius.lg },
    large: { paddingVertical: 17, paddingHorizontal: 30, fontSize: 16, radius: theme.radius.xl },
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
          gap: 8,
          alignSelf: props.fullWidth ? "stretch" : "flex-start",
          minHeight: 44,
          transform: [{ scale: pressed && !disabled ? 0.97 : 1 }],
          ...(!disabled && (kind === "primary" || kind === "secondary") ? softShadowStyle(theme.shadows.soft) : {}),
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
    <View style={{ gap: 16, paddingVertical: 24 }}>
      <View style={{ alignItems: "center", gap: 12, paddingVertical: 16 }}>
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
    <View style={{ gap: 12, alignItems: "center", paddingVertical: 48, paddingHorizontal: 32 }}>
      <View
        style={{
          width: 88,
          height: 88,
          borderRadius: 44,
          backgroundColor: `${color}10`,
          alignItems: "center",
          justifyContent: "center",
          marginBottom: 8,
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
        {props.subtitle ?? "你可以稍後再試，或切換學校。"}
      </Text>
      {props.hint && (
        <Text style={{ color: theme.colors.muted, fontSize: 12, textAlign: "center", marginTop: 4 }}>
          {props.hint}
        </Text>
      )}
      {props.actionText && (
        <View style={{ marginTop: 20 }}>
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
    <View style={{ gap: 16, paddingVertical: 24 }} accessibilityRole="alert">
      <View
        style={{
          padding: theme.space.lg,
          borderRadius: theme.radius.lg,
          backgroundColor: theme.colors.dangerSoft,
          gap: 14,
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
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
            <Text style={{ color: theme.colors.muted, fontSize: 13, marginTop: 3 }}>{subtitle}</Text>
          </View>
        </View>

        <Text style={{ color: theme.colors.muted, lineHeight: 20, fontSize: 14 }}>{hint}</Text>

        {props.showDetails && props.errorCode && (
          <View style={{ padding: 10, borderRadius: theme.radius.sm, backgroundColor: theme.colors.surface2 }}>
            <Text style={{ color: theme.colors.muted, fontSize: 11, fontFamily: Platform.select({ ios: "Menlo", default: "monospace" }) }}>
              錯誤代碼: {props.errorCode}
            </Text>
          </View>
        )}

        {props.onAction && (
          <View style={{ marginTop: 4 }}>
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
        paddingHorizontal: 14,
        paddingVertical: 11,
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
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
      <View style={{ alignItems: "center", padding: 12 }}>
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
        <Text style={{ color: theme.colors.muted, marginBottom: 10, fontSize: 12, fontWeight: "500" }}>
          {props.label}
        </Text>
      ) : null}
      <View style={{ flexDirection: "row", gap: 8 }}>
        {units.map((unit) => (
          <View
            key={unit.label}
            style={{
              alignItems: "center",
              minWidth: 52,
              paddingVertical: 10,
              paddingHorizontal: 8,
              borderRadius: theme.radius.md,
              backgroundColor: theme.colors.accentSoft,
            }}
          >
            <Text style={{ color: theme.colors.accent, fontWeight: "800", fontSize: 22, letterSpacing: -0.5 }}>
              {String(unit.value).padStart(2, "0")}
            </Text>
            <Text style={{ color: theme.colors.muted, fontSize: 10, marginTop: 2, fontWeight: "500" }}>
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
  /** 是否在圓環中央顯示百分比文字，預設 true。若外部自訂 center 內容請設為 false */
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
        gap: 5,
        paddingHorizontal: 10,
        paddingVertical: 5,
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
      style={{ flexDirection: "row", gap: 2, alignItems: "center" }}
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
      <Text style={{ color: theme.colors.muted, fontSize: size * 0.75, marginLeft: 4, fontWeight: "600" }}>
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
        gap: 10,
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
        padding: 14,
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
          marginBottom: 6,
        }}
      >
        <Ionicons name={props.icon as any} size={20} color={color} />
      </View>
      <Text style={{ color: theme.colors.text, fontSize: 11, fontWeight: "600", textAlign: "center" }}>
        {props.label}
      </Text>
      {badgeText ? (
        <View
          style={{
            position: "absolute",
            top: 6,
            right: 6,
            minWidth: 18,
            height: 18,
            borderRadius: 9,
            backgroundColor: theme.colors.danger,
            alignItems: "center",
            justifyContent: "center",
            paddingHorizontal: 4,
          }}
          accessibilityElementsHidden
        >
          <Text style={{ color: "#fff", fontSize: 10, fontWeight: "700" }}>{badgeText}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

export function InfoRow(props: {
  icon?: string;
  label: string;
  value: string;
  onPress?: () => void;
  iconColor?: string;
}) {
  const iconColor = props.iconColor ?? theme.colors.accent;
  const content = (
    <View style={{ flexDirection: "row", alignItems: "center", paddingVertical: 12 }}>
      {props.icon ? (
        <View
          style={{
            width: 34,
            height: 34,
            borderRadius: 10,
            backgroundColor: `${iconColor}10`,
            alignItems: "center",
            justifyContent: "center",
            marginRight: 14,
          }}
        >
          <Ionicons name={props.icon as any} size={16} color={iconColor} />
        </View>
      ) : null}
      <Text style={{ color: theme.colors.muted, flex: 1, fontSize: 14 }}>{props.label}</Text>
      <Text style={{ color: theme.colors.text, fontWeight: "600", fontSize: 14 }}>{props.value}</Text>
      {props.onPress ? (
        <Ionicons name="chevron-forward" size={16} color={theme.colors.muted} style={{ marginLeft: 8 }} />
      ) : null}
    </View>
  );

  if (props.onPress) {
    return (
      <Pressable onPress={props.onPress} style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}>
        {content}
      </Pressable>
    );
  }
  return content;
}

export function Skeleton(props: { width?: number | string; height?: number; borderRadius?: number }) {
  const pulseAnim = useRef(new Animated.Value(0.4)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 0.8, duration: 1000, useNativeDriver: true, easing: Easing.inOut(Easing.ease) }),
        Animated.timing(pulseAnim, { toValue: 0.4, duration: 1000, useNativeDriver: true, easing: Easing.inOut(Easing.ease) }),
      ])
    ).start();
  }, []);

  return (
    <Animated.View
      style={{
        width: (props.width ?? "100%") as ViewStyle["width"],
        height: props.height ?? 20,
        borderRadius: props.borderRadius ?? theme.radius.sm,
        backgroundColor: theme.colors.shimmer,
        opacity: pulseAnim,
      }}
    />
  );
}

export function Divider(props: { text?: string; spacing?: number }) {
  const spacing = props.spacing ?? 16;
  if (props.text) {
    return (
      <View style={{ flexDirection: "row", alignItems: "center", marginVertical: spacing }}>
        <View style={{ flex: 1, height: 1, backgroundColor: theme.colors.border }} />
        <Text style={{ color: theme.colors.muted, marginHorizontal: 14, fontSize: 12, fontWeight: "500" }}>
          {props.text}
        </Text>
        <View style={{ flex: 1, height: 1, backgroundColor: theme.colors.border }} />
      </View>
    );
  }
  return <View style={{ height: 1, backgroundColor: theme.colors.border, marginVertical: spacing }} />;
}

export function FeatureHighlight(props: { icon: string; title: string; description: string; color?: string }) {
  const color = props.color ?? theme.colors.accent;
  return (
    <View
      style={{
        flexDirection: "row",
        gap: 14,
        padding: 16,
        borderRadius: theme.radius.lg,
        backgroundColor: `${color}08`,
      }}
    >
      <View
        style={{
          width: 44,
          height: 44,
          borderRadius: 14,
          backgroundColor: `${color}15`,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Ionicons name={props.icon as any} size={22} color={color} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ color: theme.colors.text, fontWeight: "700", fontSize: 15, letterSpacing: -0.1 }}>
          {props.title}
        </Text>
        <Text style={{ color: theme.colors.muted, fontSize: 13, marginTop: 4, lineHeight: 19 }}>
          {props.description}
        </Text>
      </View>
    </View>
  );
}

export function FilterChips(props: {
  options: Array<{ key: string; label: string; icon?: string }>;
  selected: string[];
  onChange: (selected: string[]) => void;
  multiple?: boolean;
  label?: string;
}) {
  const handlePress = (key: string) => {
    if (props.multiple) {
      if (props.selected.includes(key)) {
        props.onChange(props.selected.filter((k) => k !== key));
      } else {
        props.onChange([...props.selected, key]);
      }
    } else {
      props.onChange(props.selected.includes(key) ? [] : [key]);
    }
  };

  return (
    <View
      style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}
      accessibilityRole="radiogroup"
      accessibilityLabel={props.label ?? "篩選選項"}
    >
      {props.options.map((opt) => {
        const isSelected = props.selected.includes(opt.key);
        return (
          <Pressable
            key={opt.key}
            onPress={() => handlePress(opt.key)}
            accessibilityRole={props.multiple ? "checkbox" : "radio"}
            accessibilityState={{ checked: isSelected }}
            accessibilityLabel={opt.label}
            style={({ pressed }) => ({
              flexDirection: "row",
              alignItems: "center",
              gap: 5,
              paddingHorizontal: 14,
              paddingVertical: 8,
              borderRadius: theme.radius.full,
              backgroundColor: isSelected
                ? theme.colors.accent
                : pressed
                  ? theme.colors.surface2
                  : theme.colors.surface,
              borderWidth: 1,
              borderColor: isSelected ? theme.colors.accent : theme.colors.border,
              minHeight: 38,
            })}
          >
            {opt.icon && (
              <Ionicons name={opt.icon as any} size={14} color={isSelected ? "#fff" : theme.colors.muted} />
            )}
            <Text
              style={{
                color: isSelected ? "#fff" : theme.colors.textSecondary,
                fontWeight: "600",
                fontSize: 13,
              }}
            >
              {opt.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function FilterChip(props: {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  icon?: string;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <Pressable
      onPress={props.onPress}
      style={({ pressed }) => [
        {
          flexDirection: "row",
          alignItems: "center",
          gap: 5,
          paddingHorizontal: 14,
          paddingVertical: 8,
          borderRadius: theme.radius.full,
          backgroundColor: props.selected
            ? theme.colors.accent
            : pressed
              ? theme.colors.surface2
              : theme.colors.surface,
          borderWidth: 1,
          borderColor: props.selected ? theme.colors.accent : theme.colors.border,
          minHeight: 38,
        },
        props.style,
      ]}
    >
      {props.icon ? (
        <Ionicons
          name={props.icon as any}
          size={14}
          color={props.selected ? "#fff" : theme.colors.muted}
        />
      ) : null}
      <Text
        style={{
          color: props.selected ? "#fff" : theme.colors.textSecondary,
          fontWeight: "600",
          fontSize: 13,
        }}
      >
        {props.label}
      </Text>
    </Pressable>
  );
}

export function SegmentedControl(props: {
  options: Array<{ key: string; label: string }> | string[];
  selected: string | number;
  onChange: (key: any) => void;
}) {
  const isStringArray = props.options.length > 0 && typeof props.options[0] === "string";
  const normalizedOptions = props.options.map((opt, idx) => {
    if (typeof opt === "string") return { key: `segment-${idx}`, label: opt, originalIndex: idx };
    return { key: opt.key, label: opt.label, originalIndex: idx };
  });

  return (
    <View
      style={{
        flexDirection: "row",
        borderRadius: theme.radius.md,
        backgroundColor: theme.colors.surface2,
        padding: 3,
      }}
    >
      {normalizedOptions.map((opt) => {
        const isSelected = isStringArray
          ? props.selected === opt.originalIndex
          : props.selected === opt.key;
        return (
          <Pressable
            key={opt.key}
            onPress={() => props.onChange(isStringArray ? opt.originalIndex : opt.key)}
            style={{
              flex: 1,
              paddingVertical: 9,
              paddingHorizontal: 14,
              borderRadius: theme.radius.sm,
              backgroundColor: isSelected ? theme.colors.surface : "transparent",
              alignItems: "center",
              ...(isSelected ? softShadowStyle(theme.shadows.soft) : {}),
            }}
          >
            <Text
              style={{
                color: isSelected ? theme.colors.text : theme.colors.muted,
                fontWeight: isSelected ? "600" : "500",
                fontSize: 13,
              }}
            >
              {opt.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function SortButton(props: {
  options: Array<{ key: string; label: string }>;
  selected: string;
  onChange: (key: string) => void;
}) {
  const [visible, setVisible] = useState(false);
  const selectedLabel = props.options.find((o) => o.key === props.selected)?.label ?? "排序";

  return (
    <View style={{ position: "relative", zIndex: visible ? 100 : 1 }}>
      <Pressable
        onPress={() => setVisible(!visible)}
        accessibilityRole="button"
        accessibilityState={{ expanded: visible }}
        accessibilityLabel={`排序方式: ${selectedLabel}`}
        style={({ pressed }) => ({
          flexDirection: "row",
          alignItems: "center",
          gap: 6,
          paddingHorizontal: 14,
          paddingVertical: 9,
          borderRadius: theme.radius.md,
          backgroundColor: visible ? theme.colors.accentSoft : theme.colors.surface2,
          minHeight: 38,
        })}
      >
        <Ionicons name="swap-vertical" size={16} color={visible ? theme.colors.accent : theme.colors.muted} />
        <Text
          style={{
            color: visible ? theme.colors.accent : theme.colors.textSecondary,
            fontWeight: "600",
            fontSize: 13,
          }}
        >
          {selectedLabel}
        </Text>
        <Ionicons name={visible ? "chevron-up" : "chevron-down"} size={12} color={theme.colors.muted} />
      </Pressable>

      {visible && (
        <>
          <Pressable
            onPress={() => setVisible(false)}
            style={{
              position: "absolute",
              top: -1000,
              left: -1000,
              width: 5000,
              height: 5000,
            }}
            accessibilityLabel="關閉選單"
          />
          <View
            style={{
              position: "absolute",
              top: "100%",
              left: 0,
              right: 0,
              marginTop: 6,
              borderRadius: theme.radius.md,
              backgroundColor: theme.colors.surface,
              borderWidth: 1,
              borderColor: theme.colors.border,
              ...softShadowStyle(theme.shadows.soft),
              zIndex: 101,
              overflow: "hidden",
            }}
          >
            {props.options.map((opt, idx) => (
              <Pressable
                key={opt.key}
                onPress={() => {
                  props.onChange(opt.key);
                  setVisible(false);
                }}
                accessibilityRole="menuitem"
                accessibilityState={{ selected: props.selected === opt.key }}
                style={({ pressed }) => ({
                  paddingHorizontal: 14,
                  paddingVertical: 12,
                  backgroundColor: pressed ? theme.colors.surface2 : "transparent",
                  borderTopWidth: idx > 0 ? 1 : 0,
                  borderTopColor: theme.colors.border,
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "space-between",
                  minHeight: 44,
                })}
              >
                <Text
                  style={{
                    color: props.selected === opt.key ? theme.colors.accent : theme.colors.text,
                    fontWeight: props.selected === opt.key ? "600" : "400",
                    fontSize: 14,
                  }}
                >
                  {opt.label}
                </Text>
                {props.selected === opt.key && (
                  <Ionicons name="checkmark" size={16} color={theme.colors.accent} />
                )}
              </Pressable>
            ))}
          </View>
        </>
      )}
    </View>
  );
}

export function StatCard(props: {
  icon: string;
  label: string;
  value: string | number;
  subtitle?: string;
  color?: string;
  onPress?: () => void;
}) {
  const color = props.color ?? theme.colors.accent;

  const content = (
    <View
      style={{
        padding: 18,
        borderRadius: theme.radius.lg,
        backgroundColor: theme.colors.surface,
        borderWidth: 1,
        borderColor: theme.colors.border,
        minWidth: 100,
        ...softShadowStyle(theme.shadows.soft),
      }}
    >
      <View
        style={{
          width: 40,
          height: 40,
          borderRadius: 12,
          backgroundColor: `${color}10`,
          alignItems: "center",
          justifyContent: "center",
          marginBottom: 14,
        }}
      >
        <Ionicons name={props.icon as any} size={20} color={color} />
      </View>
      <Text style={{ color: theme.colors.text, fontWeight: "800", fontSize: 26, letterSpacing: -0.5 }}>
        {props.value}
      </Text>
      <Text style={{ color: theme.colors.muted, fontWeight: "500", fontSize: 13, marginTop: 4 }}>
        {props.label}
      </Text>
      {props.subtitle && (
        <Text style={{ color: theme.colors.muted, fontSize: 11, marginTop: 2 }}>{props.subtitle}</Text>
      )}
    </View>
  );

  if (props.onPress) {
    return (
      <Pressable onPress={props.onPress} style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1, transform: [{ scale: pressed ? 0.97 : 1 }] })}>
        {content}
      </Pressable>
    );
  }
  return content;
}

export function PriceRangeSlider(props: {
  min: number;
  max: number;
  value: [number, number];
  onChange: (value: [number, number]) => void;
  step?: number;
}) {
  const [low, high] = props.value;

  return (
    <View style={{ padding: 8 }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 10 }}>
        <Text style={{ color: theme.colors.text, fontWeight: "600", fontSize: 15 }}>${low}</Text>
        <Text style={{ color: theme.colors.muted, fontSize: 13 }}>—</Text>
        <Text style={{ color: theme.colors.text, fontWeight: "600", fontSize: 15 }}>${high}</Text>
      </View>
      <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
        <Text style={{ color: theme.colors.muted, fontSize: 12 }}>${props.min}</Text>
        <View
          style={{
            flex: 1,
            height: 4,
            backgroundColor: theme.colors.surface2,
            borderRadius: 2,
            position: "relative",
          }}
        >
          <View
            style={{
              position: "absolute",
              left: `${((low - props.min) / (props.max - props.min)) * 100}%`,
              right: `${100 - ((high - props.min) / (props.max - props.min)) * 100}%`,
              height: "100%",
              backgroundColor: theme.colors.accent,
              borderRadius: 2,
            }}
          />
        </View>
        <Text style={{ color: theme.colors.muted, fontSize: 12 }}>${props.max}</Text>
      </View>
      <View style={{ flexDirection: "row", gap: 8, marginTop: 14 }}>
        {[
          props.min,
          Math.round((props.max - props.min) / 3 + props.min),
          Math.round(((props.max - props.min) * 2) / 3 + props.min),
          props.max,
        ].map((preset) => (
          <Pressable
            key={preset}
            onPress={() => props.onChange([props.min, preset])}
            style={({ pressed }) => ({
              paddingHorizontal: 12,
              paddingVertical: 6,
              borderRadius: theme.radius.full,
              backgroundColor: high === preset ? theme.colors.accent : pressed ? theme.colors.surface2 : theme.colors.surface,
              borderWidth: 1,
              borderColor: high === preset ? theme.colors.accent : theme.colors.border,
            })}
          >
            <Text
              style={{
                color: high === preset ? "#fff" : theme.colors.muted,
                fontSize: 12,
                fontWeight: "600",
              }}
            >
              ≤${preset}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function getAvatarDisplay(name?: string): { text: string; fontSize: number } {
  if (!name || name.trim().length === 0) return { text: "?", fontSize: 1 };
  const trimmed = name.trim();
  const isChinese = /[\u4e00-\u9fa5]/.test(trimmed);
  if (isChinese) {
    if (trimmed.length >= 2) return { text: trimmed.slice(-2), fontSize: 0.32 };
    return { text: trimmed, fontSize: 0.38 };
  }
  const words = trimmed.split(/\s+/);
  if (words.length >= 2) return { text: (words[0][0] + words[1][0]).toUpperCase(), fontSize: 0.38 };
  return { text: trimmed[0].toUpperCase(), fontSize: 0.38 };
}

export function Avatar(props: { name?: string; size?: number; imageUrl?: string; color?: string }) {
  const size = props.size ?? 42;
  const { text, fontSize } = getAvatarDisplay(props.name);
  const bgColor = props.color ?? theme.colors.accentSoft;

  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: bgColor,
        alignItems: "center",
        justifyContent: "center",
        borderWidth: 2,
        borderColor: theme.colors.surface,
      }}
    >
      <Text style={{ color: theme.colors.accent, fontWeight: "700", fontSize: size * fontSize }}>
        {text}
      </Text>
    </View>
  );
}

export function Badge(props: { count?: number; max?: number; dot?: boolean; text?: string }) {
  if (props.text) {
    return (
      <View
        style={{
          alignSelf: "flex-start",
          paddingHorizontal: 10,
          paddingVertical: 5,
          borderRadius: theme.radius.full,
          backgroundColor: theme.colors.accentSoft,
        }}
      >
        <Text style={{ color: theme.colors.accent, fontWeight: "700", fontSize: 12 }}>
          {props.text}
        </Text>
      </View>
    );
  }

  const count = props.count ?? 0;
  if (count <= 0 && !props.dot) return null;

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

  const max = props.max ?? 99;
  const displayCount = count > max ? `${max}+` : String(count);

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
      <Text style={{ color: "#fff", fontSize: 11, fontWeight: "700" }}>{displayCount}</Text>
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
        paddingVertical: 13,
        paddingHorizontal: 4,
        gap: 14,
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
          <Text style={{ color: theme.colors.muted, fontSize: 13, marginTop: 2 }}>{props.subtitle}</Text>
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
          paddingHorizontal: 4,
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
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
      <Text style={{ color: theme.colors.text, fontWeight: "700", fontSize: 18, letterSpacing: -0.3 }}>
        {props.title}
      </Text>
      {props.action && (
        <Pressable
          onPress={props.onAction}
          style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
        >
          <Text style={{ color: theme.colors.accent, fontWeight: "600", fontSize: 14 }}>{props.action}</Text>
        </Pressable>
      )}
    </View>
  );
}

export function EmptyListPlaceholder(props: {
  icon?: string;
  title: string;
  subtitle?: string;
  action?: string;
  onAction?: () => void;
}) {
  return (
    <View style={{ alignItems: "center", padding: 36 }}>
      {props.icon && (
        <View
          style={{
            width: 68,
            height: 68,
            borderRadius: 34,
            backgroundColor: theme.colors.surface2,
            alignItems: "center",
            justifyContent: "center",
            marginBottom: 18,
          }}
        >
          <Ionicons name={props.icon as any} size={28} color={theme.colors.muted} />
        </View>
      )}
      <Text style={{ color: theme.colors.text, fontWeight: "600", fontSize: 16, textAlign: "center" }}>
        {props.title}
      </Text>
      {props.subtitle && (
        <Text
          style={{
            color: theme.colors.muted,
            fontSize: 14,
            textAlign: "center",
            marginTop: 8,
            lineHeight: 21,
          }}
        >
          {props.subtitle}
        </Text>
      )}
      {props.action && (
        <View style={{ marginTop: 20 }}>
          <Button text={props.action} kind="primary" onPress={props.onAction} />
        </View>
      )}
    </View>
  );
}

export function ToggleSwitch(props: {
  value: boolean;
  onChange?: (value: boolean) => void;
  onToggle?: (value: boolean) => void;
  disabled?: boolean;
  size?: "default" | "small";
}) {
  const handlePress = () => {
    if (props.disabled) return;
    const newValue = !props.value;
    props.onChange?.(newValue);
    props.onToggle?.(newValue);
  };

  const isSmall = props.size === "small";
  const width = isSmall ? 44 : 52;
  const height = isSmall ? 26 : 31;
  const thumbSize = isSmall ? 20 : 25;

  const translateX = useRef(new Animated.Value(props.value ? width - thumbSize - 4 : 3)).current;

  useEffect(() => {
    Animated.spring(translateX, {
      toValue: props.value ? width - thumbSize - 4 : 3,
      useNativeDriver: true,
      friction: 8,
      tension: 65,
    }).start();
  }, [props.value, width, thumbSize]);

  return (
    <Pressable
      onPress={handlePress}
      accessibilityRole="switch"
      accessibilityState={{ checked: props.value, disabled: props.disabled }}
      accessibilityLabel={props.value ? "開啟" : "關閉"}
      style={({ pressed }) => ({
        width,
        height,
        borderRadius: height / 2,
        backgroundColor: props.value ? theme.colors.accent : theme.colors.surface2,
        justifyContent: "center",
        opacity: props.disabled ? 0.4 : pressed ? 0.85 : 1,
      })}
    >
      <Animated.View
        style={{
          width: thumbSize,
          height: thumbSize,
          borderRadius: thumbSize / 2,
          backgroundColor: "#fff",
          transform: [{ translateX }],
          ...softShadowStyle(theme.shadows.soft),
        }}
      />
    </Pressable>
  );
}

type ErrorBoundaryProps = {
  children: React.ReactNode;
  fallback?: React.ReactNode;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
  showDetails?: boolean;
};

type ErrorBoundaryState = {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
};

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    this.setState({ errorInfo });
    this.props.onError?.(error, errorInfo);
    if (__DEV__) {
      console.error("[ErrorBoundary]", error);
    }
  }

  handleRetry = (): void => {
    this.setState({ hasError: false, error: null, errorInfo: null });
  };

  render(): React.ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;

      const { error, errorInfo } = this.state;
      const showDetails = this.props.showDetails ?? __DEV__;

      return (
        <View
          style={{
            flex: 1,
            backgroundColor: theme.colors.bg,
            padding: theme.space.xl,
            justifyContent: "center",
            alignItems: "center",
          }}
        >
          <View
            style={{
              width: 80,
              height: 80,
              borderRadius: 40,
              backgroundColor: theme.colors.dangerSoft,
              justifyContent: "center",
              alignItems: "center",
              marginBottom: 24,
            }}
          >
            <Ionicons name="warning-outline" size={36} color={theme.colors.danger} />
          </View>

          <Text
            style={{
              color: theme.colors.text,
              fontSize: 22,
              fontWeight: "700",
              marginBottom: 10,
              textAlign: "center",
              letterSpacing: -0.3,
            }}
          >
            發生錯誤
          </Text>

          <Text
            style={{
              color: theme.colors.muted,
              fontSize: 15,
              textAlign: "center",
              marginBottom: 24,
              lineHeight: 22,
              maxWidth: 280,
            }}
          >
            很抱歉，應用程式發生了意外錯誤。{"\n"}請嘗試重新載入。
          </Text>

          {showDetails && error && (
            <ScrollView
              style={{
                maxHeight: 180,
                width: "100%",
                marginBottom: 24,
                padding: 14,
                borderRadius: theme.radius.md,
                backgroundColor: theme.colors.surface2,
              }}
            >
              <Text
                style={{
                  color: theme.colors.danger,
                  fontSize: 12,
                  fontFamily: Platform.select({ ios: "Menlo", default: "monospace" }),
                }}
              >
                {error.name}: {error.message}
              </Text>
              {errorInfo?.componentStack && (
                <Text
                  style={{
                    color: theme.colors.muted,
                    fontSize: 10,
                    fontFamily: Platform.select({ ios: "Menlo", default: "monospace" }),
                    marginTop: 8,
                  }}
                >
                  {errorInfo.componentStack.trim().slice(0, 500)}
                </Text>
              )}
            </ScrollView>
          )}

          <Button text="重試" kind="primary" onPress={this.handleRetry} icon="refresh-outline" />
        </View>
      );
    }

    return this.props.children;
  }
}

export function ScreenErrorBoundary(props: { children: React.ReactNode; screenName?: string }) {
  return (
    <ErrorBoundary
      onError={(error) => {
        console.error(`[${props.screenName ?? "Screen"}] Error:`, error.message);
      }}
    >
      {props.children}
    </ErrorBoundary>
  );
}

export function AuthGuard(props: {
  children: React.ReactNode;
  user: any;
  onLogin?: () => void;
  title?: string;
  description?: string;
}) {
  if (props.user) return <>{props.children}</>;

  return (
    <Screen>
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center", padding: 32 }}>
        <View
          style={{
            width: 88,
            height: 88,
            borderRadius: 44,
            backgroundColor: theme.colors.accentSoft,
            justifyContent: "center",
            alignItems: "center",
            marginBottom: 28,
          }}
        >
          <Ionicons name="person-outline" size={40} color={theme.colors.accent} />
        </View>

        <Text
          style={{
            color: theme.colors.text,
            fontSize: 24,
            fontWeight: "700",
            textAlign: "center",
            marginBottom: 12,
            letterSpacing: -0.3,
          }}
        >
          {props.title ?? "需要登入"}
        </Text>

        <Text
          style={{
            color: theme.colors.muted,
            fontSize: 15,
            textAlign: "center",
            lineHeight: 23,
            marginBottom: 36,
            maxWidth: 280,
          }}
        >
          {props.description ?? "請登入以使用此功能。登入後您可以享受完整的校園服務。"}
        </Text>

        <Button text="前往登入" kind="primary" onPress={props.onLogin} icon="log-in-outline" size="large" />
      </View>
    </Screen>
  );
}

export function LoadingOverlay(props: { visible: boolean; message?: string }) {
  const spinAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (props.visible) {
      const animation = Animated.loop(
        Animated.timing(spinAnim, {
          toValue: 1,
          duration: 800,
          easing: Easing.linear,
          useNativeDriver: true,
        })
      );
      animation.start();
      return () => animation.stop();
    }
  }, [props.visible, spinAnim]);

  const spin = spinAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ["0deg", "360deg"],
  });

  if (!props.visible) return null;

  return (
    <View
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: theme.colors.overlay,
        justifyContent: "center",
        alignItems: "center",
        zIndex: 1000,
      }}
      accessibilityRole="alert"
      accessibilityLabel={props.message ?? "載入中"}
    >
      <View
        style={{
          padding: 28,
          borderRadius: theme.radius.xl,
          backgroundColor: theme.colors.surfaceElevated,
          alignItems: "center",
          gap: 14,
          minWidth: 120,
          borderWidth: 1,
          borderColor: theme.colors.border,
          ...softShadowStyle(theme.shadows.soft),
        }}
      >
        <Animated.View
          style={{
            width: 36,
            height: 36,
            borderRadius: 18,
            borderWidth: 3,
            borderColor: theme.colors.accent,
            borderTopColor: "transparent",
            transform: [{ rotate: spin }],
          }}
        />
        {props.message && (
          <Text style={{ color: theme.colors.text, fontSize: 14, fontWeight: "500" }}>{props.message}</Text>
        )}
      </View>
    </View>
  );
}

export function ConfirmDialog(props: {
  visible: boolean;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  onConfirm: () => void;
  onCancel: () => void;
  destructive?: boolean;
}) {
  if (!props.visible) return null;

  return (
    <View
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: theme.colors.overlay,
        justifyContent: "center",
        alignItems: "center",
        padding: 32,
        zIndex: 1000,
      }}
    >
      <Pressable
        style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}
        onPress={props.onCancel}
        accessibilityLabel="取消"
      />
      <View
        style={{
          padding: 28,
          borderRadius: theme.radius.xl,
          backgroundColor: theme.colors.surfaceElevated,
          width: "100%",
          maxWidth: 340,
          borderWidth: 1,
          borderColor: theme.colors.border,
          ...softShadowStyle(theme.shadows.soft),
        }}
        accessibilityRole="alert"
      >
        <Text
          style={{
            color: theme.colors.text,
            fontSize: 19,
            fontWeight: "700",
            marginBottom: 10,
            letterSpacing: -0.2,
          }}
        >
          {props.title}
        </Text>
        <Text
          style={{
            color: theme.colors.muted,
            fontSize: 15,
            lineHeight: 22,
            marginBottom: 28,
          }}
        >
          {props.message}
        </Text>
        <View style={{ flexDirection: "row", gap: 12 }}>
          <View style={{ flex: 1 }}>
            <Button text={props.cancelText ?? "取消"} kind="secondary" onPress={props.onCancel} fullWidth />
          </View>
          <View style={{ flex: 1 }}>
            <Button
              text={props.confirmText ?? "確認"}
              kind={props.destructive ? "danger" : "primary"}
              onPress={props.onConfirm}
              fullWidth
            />
          </View>
        </View>
      </View>
    </View>
  );
}
