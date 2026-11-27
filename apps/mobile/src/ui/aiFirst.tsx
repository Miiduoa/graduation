/** Shared screen primitives. Existing export names remain compatible with screen imports. */
import React, { useMemo, useSyncExternalStore } from 'react';
import {
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
  type ScrollViewProps,
  type ViewStyle,
  type TextStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTabBarContentBottomPadding } from './navigationTheme';
import { getThemeVersion, subscribeToTheme, theme } from './theme';
import { pageTitleFont } from './styles';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export const aiTokens = {
  get bg() {
    return theme.colors.bg;
  },
  get surface() {
    return theme.colors.surface;
  },
  get panel() {
    return theme.colors.surface2;
  },
  get text() {
    return theme.colors.text;
  },
  get textSecondary() {
    return theme.colors.textSecondary;
  },
  get muted() {
    return theme.colors.muted;
  },
  get border() {
    return theme.colors.border;
  },
  get ai() {
    return theme.colors.accent;
  },
  get aiStrong() {
    return theme.colors.accentStrong;
  },
  get aiSoft() {
    return theme.colors.accentSoft;
  },
  get aiSurface() {
    return theme.colors.surfaceMuted;
  },
  get aiGradientStart() {
    return theme.colors.focusSurface;
  },
  get aiGradientEnd() {
    return theme.colors.bg;
  },
  get success() {
    return theme.colors.success;
  },
  get successSoft() {
    return theme.colors.successSoft;
  },
  get warning() {
    return theme.colors.warning;
  },
  get warningSoft() {
    return theme.colors.warningSoft;
  },
  get danger() {
    return theme.colors.danger;
  },
  get dangerSoft() {
    return theme.colors.dangerSoft;
  },
  get radius() {
    return {
      sm: theme.radius.sm,
      md: theme.radius.md,
      lg: theme.radius.lg,
      pill: theme.radius.full,
    };
  },
  get space() {
    return {
      xs: theme.space.xs,
      sm: 8,
      md: theme.layout.screenHorizontalPadding,
      lg: theme.space.lg,
      xl: theme.space.xl,
    };
  },
};

function useVisualTheme() {
  return useSyncExternalStore(subscribeToTheme, getThemeVersion, getThemeVersion);
}

function useVisualStyles() {
  const version = useVisualTheme();
  return useMemo(createStyles, [version]);
}

// ──────────────────────────────────────────────
// AI Mark — minimal field-guide glyph
// ──────────────────────────────────────────────
export function AIMark({ size = 24 }: { size?: number }) {
  useVisualTheme();
  return (
    <View
      accessibilityElementsHidden
      style={{
        width: size,
        height: size,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Ionicons name="chatbubble-outline" size={Math.round(size * 0.72)} color={aiTokens.ai} />
    </View>
  );
}

// ──────────────────────────────────────────────
// AIScreen — Tab landing 殼層
// ──────────────────────────────────────────────
export function AIScreen({
  children,
  bottomPadding,
  contentContainerStyle,
  keyboardShouldPersistTaps = 'handled',
  keyboardDismissMode = Platform.OS === 'ios' ? 'interactive' : 'on-drag',
  automaticallyAdjustKeyboardInsets = Platform.OS === 'ios',
  delayContentTouches,
  ...rest
}: {
  children: React.ReactNode;
  bottomPadding?: number;
  // iOS UIScrollView; RN's ScrollViewProps currently omit this.
  delayContentTouches?: boolean;
} & ScrollViewProps) {
  useVisualTheme();
  const defaultPadding = useTabBarContentBottomPadding();
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flex: 1, backgroundColor: aiTokens.bg }}>
      <ScrollView
        style={{ flex: 1 }}
        showsVerticalScrollIndicator={false}
        {...rest}
        {...(delayContentTouches === undefined ? null : { delayContentTouches })}
        keyboardShouldPersistTaps={keyboardShouldPersistTaps}
        keyboardDismissMode={keyboardDismissMode}
        automaticallyAdjustKeyboardInsets={automaticallyAdjustKeyboardInsets}
        contentContainerStyle={[
          { paddingTop: insets.top, paddingBottom: bottomPadding ?? defaultPadding },
          contentContainerStyle,
        ]}
      >
        {children}
      </ScrollView>
    </View>
  );
}

// ──────────────────────────────────────────────
// AIHero — 漸層 hero 區
// ──────────────────────────────────────────────
export function AIHero({
  eyebrow,
  title,
  subtitle,
}: {
  eyebrow?: string;
  title: string | React.ReactNode;
  subtitle?: string;
}) {
  const styles = useVisualStyles();
  return (
    <View style={styles.hero}>
      {eyebrow ? <Text style={styles.heroEyebrow}>{eyebrow}</Text> : null}
      <Text accessibilityRole="header" style={styles.heroTitle}>{title}</Text>
      {subtitle ? <Text style={styles.heroSub}>{subtitle}</Text> : null}
    </View>
  );
}

// ──────────────────────────────────────────────
// AISectionContext — 讓 AISection 內的 AIRow 知道自己處於 iOS insetGrouped 列表中
// ──────────────────────────────────────────────
type AISectionContextValue = {
  inGroup: boolean;
  isFirst: boolean;
  isLast: boolean;
};
const AISectionContext = React.createContext<AISectionContextValue>({
  inGroup: false,
  isFirst: false,
  isLast: false,
});

// ──────────────────────────────────────────────
// AISection — iOS insetGrouped 列表分組
// 標題（13pt uppercase secondaryLabel）+ 圓角白底容器 + 內部 hairline 分隔
// ──────────────────────────────────────────────
export function AISection({
  title,
  subtitle,
  action,
  children,
  style,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  style?: ViewStyle;
}) {
  const styles = useVisualStyles();
  // 把 children 轉成 array 以便插入 first/last 標記
  const items = React.Children.toArray(children);
  return (
    <View style={[{ marginTop: aiTokens.space.lg, paddingHorizontal: aiTokens.space.md }, style]}>
      <View style={styles.sectionHead}>
        <View style={{ flex: 1 }}>
          <Text style={styles.sectionTitle}>{title}</Text>
          {subtitle ? <Text style={styles.sectionSub}>{subtitle}</Text> : null}
        </View>
        {action}
      </View>
      <View style={styles.sectionGroup}>
        {items.map((child, i) => (
          <AISectionContext.Provider
            key={i}
            value={{ inGroup: true, isFirst: i === 0, isLast: i === items.length - 1 }}
          >
            {child}
          </AISectionContext.Provider>
        ))}
      </View>
    </View>
  );
}

// ──────────────────────────────────────────────
// AICard — 通用卡片
// ──────────────────────────────────────────────
export function AICard({
  title,
  titleTestID,
  icon,
  badge,
  badgeTone = 'ai',
  source,
  confidence: _confidence,
  children,
  onPress,
  onPin,
  aiGenerated: _aiGenerated = false,
  style,
}: {
  title?: string;
  titleTestID?: string;
  icon?: string;
  badge?: string;
  badgeTone?: 'ai' | 'success' | 'warning' | 'danger' | 'muted';
  source?: string;
  confidence?: 'high' | 'mid' | 'low';
  children: React.ReactNode;
  onPress?: () => void;
  onPin?: () => void;
  aiGenerated?: boolean;
  style?: ViewStyle;
}) {
  const styles = useVisualStyles();
  const Container = onPress ? TouchableOpacity : View;
  const containerProps = onPress ? { activeOpacity: 0.85, onPress, accessibilityRole: 'button' as const } : {};

  const badgeMap = {
    ai: { bg: aiTokens.aiSoft, color: aiTokens.ai, isStatus: true },
    success: { bg: aiTokens.successSoft, color: aiTokens.success, isStatus: true },
    warning: { bg: aiTokens.warningSoft, color: aiTokens.warning, isStatus: true },
    danger: { bg: aiTokens.dangerSoft, color: aiTokens.danger, isStatus: true },
    muted: { bg: 'transparent', color: aiTokens.muted, isStatus: false },
  };
  const badgeStyle = badgeMap[badgeTone];

  return (
    <Container {...containerProps} style={[styles.card, style]}>
      {(title || icon || badge || onPin) && (
        <View style={styles.cardHeader}>
          {icon ? (
            <View style={styles.cardIcon}>
              <Text style={{ fontSize: 15 }}>{icon}</Text>
            </View>
          ) : null}
          {title ? (
            <View
              testID={titleTestID}
              collapsable={false}
              accessible
              accessibilityRole="header"
              accessibilityLabel={title}
              style={{ flex: 1 }}
            >
              <Text accessible={false} style={styles.cardTitle}>
                {title}
              </Text>
            </View>
          ) : (
            <View style={{ flex: 1 }} />
          )}
          {badge ? (
            badgeStyle.isStatus ? (
              <View style={[styles.cardBadge, { backgroundColor: badgeStyle.bg }]}>
                <Text style={[styles.cardBadgeText, { color: badgeStyle.color }]}>{badge}</Text>
              </View>
            ) : (
              <Text style={[styles.cardBadgeText, { color: badgeStyle.color }]}>{badge}</Text>
            )
          ) : null}
          {onPin ? (
            <TouchableOpacity
              onPress={onPin}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel="釘選"
              style={{ marginLeft: 8, padding: 2 }}
            >
              <Ionicons name="pin-outline" size={16} color={aiTokens.muted} />
            </TouchableOpacity>
          ) : null}
        </View>
      )}
      <View style={styles.cardBody}>{children}</View>
      {source && (
        <View style={styles.cardFooter}>
          <Text style={styles.cardSource}>{source}</Text>
        </View>
      )}
    </Container>
  );
}

// ──────────────────────────────────────────────
// AIRow — 扁平列表列（細線對齊文字）
// ──────────────────────────────────────────────
export function AIRow({
  icon,
  title,
  subtitle,
  tag,
  tagTone = 'muted',
  right,
  onPress,
  static: isStatic = false,
  disabled = false,
  testID,
}: {
  icon?: string;
  title: string;
  subtitle?: string;
  tag?: string;
  tagTone?: 'ai' | 'success' | 'warning' | 'danger' | 'muted';
  right?: React.ReactNode;
  onPress?: () => void;
  static?: boolean;
  disabled?: boolean;
  testID?: string;
}) {
  const styles = useVisualStyles();
  const tagMap = {
    ai: { bg: aiTokens.aiSoft, color: aiTokens.ai, isStatus: true },
    success: { bg: aiTokens.successSoft, color: aiTokens.success, isStatus: true },
    warning: { bg: aiTokens.warningSoft, color: aiTokens.warning, isStatus: true },
    danger: { bg: aiTokens.dangerSoft, color: aiTokens.danger, isStatus: true },
    muted: { bg: 'transparent', color: aiTokens.muted, isStatus: false },
  };
  const tagStyle = tagMap[tagTone];

  // 若呼叫端忘了傳 onPress，至少不要假裝可點 — 開發環境直接出 warn 方便定位。
  // static/disabled 是刻意的非互動狀態，不提示。
  if (!onPress && !isStatic && !disabled && __DEV__) {
    console.warn(`[AIRow] "${title}" 缺少 onPress，會顯示但點擊無反應`);
  }
  const interactive = !isStatic && !disabled && typeof onPress === 'function';
  const sectionCtx = React.useContext(AISectionContext);

  const groupedStyle: ViewStyle = sectionCtx.inGroup
    ? {
        backgroundColor: 'transparent',
        marginHorizontal: 0,
        marginBottom: 0,
        borderWidth: 0,
        borderBottomWidth: 0,
        borderRadius: 0,
        paddingVertical: 0,
      }
    : {};

  const showTopHairline = sectionCtx.inGroup && !sectionCtx.isFirst;

  return (
    <TouchableOpacity
      testID={testID}
      accessible
      activeOpacity={interactive ? 0.65 : 1}
      onPress={interactive ? onPress : undefined}
      disabled={!interactive}
      accessibilityRole={interactive ? 'button' : undefined}
      accessibilityState={disabled ? { disabled: true } : undefined}
      accessibilityLabel={title}
      accessibilityHint={subtitle}
      style={[styles.row, groupedStyle, disabled && { opacity: 0.52 }]}
    >
      {icon ? (
        <View
          accessible={false}
          style={{ width: 24, marginRight: 10, alignItems: 'center', justifyContent: 'center' }}
        >
          <Text accessible={false} style={{ fontSize: 16 }}>{icon}</Text>
        </View>
      ) : null}
      <View
        accessible={false}
        style={{
          flex: 1,
          minWidth: 0,
          flexDirection: 'row',
          alignItems: 'center',
          paddingVertical: sectionCtx.inGroup ? 13 : 0,
          borderTopWidth: showTopHairline ? StyleSheet.hairlineWidth : 0,
          borderTopColor: aiTokens.border,
        }}
      >
        <View accessible={false} style={{ flex: 1, minWidth: 0 }}>
          <Text accessible={false} style={styles.rowTitle} numberOfLines={1}>
            {title}
          </Text>
          {subtitle ? (
            <Text accessible={false} style={styles.rowSub} numberOfLines={1}>
              {subtitle}
            </Text>
          ) : null}
        </View>
        {tag ? (
          tagStyle.isStatus ? (
            <View accessible={false} style={[styles.rowTag, { backgroundColor: tagStyle.bg }]}>
              <Text accessible={false} style={[styles.rowTagText, { color: tagStyle.color }]}>{tag}</Text>
            </View>
          ) : (
            <Text accessible={false} style={[styles.rowTagText, { color: tagStyle.color, marginLeft: 8 }]}>{tag}</Text>
          )
        ) : null}
        {right ?? null}
        {sectionCtx.inGroup && interactive && !right && !tag ? (
          <Ionicons
            name="chevron-forward"
            size={15}
            color={aiTokens.muted}
            accessibilityElementsHidden
            importantForAccessibility="no"
            style={{ marginLeft: 6 }}
          />
        ) : null}
      </View>
    </TouchableOpacity>
  );
}

// ──────────────────────────────────────────────
// AIButton — 統一按鈕
// ──────────────────────────────────────────────
export function AIButton({
  label,
  onPress,
  variant = 'primary',
  size = 'md',
  icon,
  style,
  static: isStatic = false,
  disabled = false,
}: {
  label: string;
  onPress?: () => void;
  variant?: 'primary' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  icon?: string;
  style?: ViewStyle;
  static?: boolean;
  disabled?: boolean;
}) {
  useVisualTheme();
  const variantMap = {
    // iOS Filled
    primary: { bg: aiTokens.ai, fg: theme.colors.onAccent, border: aiTokens.ai },
    // iOS Bordered Plain
    ghost: { bg: aiTokens.surface, fg: aiTokens.text, border: aiTokens.border },
    // iOS Bordered Destructive
    danger: { bg: aiTokens.surface, fg: aiTokens.danger, border: aiTokens.danger },
  };
  const v = variantMap[variant];
  // iOS HIG：md 預設 ≥44pt 觸控目標；sm 32pt chip 用；lg 50pt 主 CTA
  const sizing =
    size === 'sm'
      ? { paddingV: 8, paddingH: 14, fs: 13 }
      : size === 'lg'
        ? { paddingV: 14, paddingH: 20, fs: 17 }
        : { paddingV: 12, paddingH: 18, fs: 15 };
  if (!onPress && !isStatic && !disabled && __DEV__) {
    console.warn(`[AIButton] "${label}" 缺少 onPress，已自動 disable`);
  }
  const interactive = !isStatic && !disabled && typeof onPress === 'function';
  return (
    <TouchableOpacity
      activeOpacity={interactive ? 0.8 : 1}
      onPress={interactive ? onPress : undefined}
      disabled={!interactive}
      accessibilityRole="button"
      accessibilityState={!interactive ? { disabled: true } : undefined}
      style={[
        {
          backgroundColor: v.bg,
          borderColor: v.border,
          borderWidth: 1,
          paddingHorizontal: sizing.paddingH,
          paddingVertical: sizing.paddingV,
          minHeight: 44,
          borderRadius: aiTokens.radius.sm,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 4,
          alignSelf: 'flex-start',
          opacity: interactive ? 1 : isStatic ? 0.75 : 0.5,
        },
        style,
      ]}
    >
      {icon ? <Text style={{ fontSize: sizing.fs }}>{icon}</Text> : null}
      <Text style={{ color: v.fg, fontSize: sizing.fs, fontWeight: '600' }}>{label}</Text>
    </TouchableOpacity>
  );
}

// ──────────────────────────────────────────────
// AIChip — 圓角小標籤
// ──────────────────────────────────────────────
export function AIChip({
  label,
  onPress,
  active,
}: {
  label: string;
  onPress?: () => void;
  active?: boolean;
}) {
  useVisualTheme();
  const chipInteractive = typeof onPress === 'function';
  return (
    <TouchableOpacity
      activeOpacity={chipInteractive ? 0.8 : 1}
      onPress={onPress}
      disabled={!chipInteractive}
      accessibilityRole={chipInteractive ? 'button' : undefined}
      accessibilityState={{ selected: active, disabled: !chipInteractive }}
      style={{
        paddingHorizontal: 13,
        paddingVertical: 7,
        minHeight: chipInteractive ? 44 : 32,
        minWidth: chipInteractive ? 44 : undefined,
        justifyContent: 'center',
        borderRadius: aiTokens.radius.md,
        borderWidth: 1,
        borderColor: active ? aiTokens.ai : aiTokens.border,
        backgroundColor: active ? aiTokens.aiSoft : aiTokens.surface,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        opacity: chipInteractive ? 1 : 0.55,
      }}
    >
      <Text
        style={{
          fontSize: 13,
          color: active ? aiTokens.ai : aiTokens.text,
          fontWeight: active ? '600' : '500',
        }}
      >
        {label}
      </Text>
    </TouchableOpacity>
  );
}

// ──────────────────────────────────────────────
// Styles
// ──────────────────────────────────────────────
const createStyles = () =>
  StyleSheet.create({
    hero: {
      marginHorizontal: aiTokens.space.md,
      marginTop: aiTokens.space.md,
      marginBottom: aiTokens.space.sm,
      paddingTop: aiTokens.space.sm,
      paddingBottom: aiTokens.space.md,
      backgroundColor: aiTokens.bg,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: aiTokens.border,
    },
    heroEyebrow: {
      fontSize: theme.typography.overline.fontSize,
      lineHeight: theme.typography.overline.lineHeight,
      color: aiTokens.ai,
      fontWeight: '600',
      letterSpacing: 0.6,
      textTransform: 'uppercase',
    } as TextStyle,
    heroTitle: {
      fontFamily: pageTitleFont,
      fontSize: theme.typography.hero.fontSize,
      fontWeight: theme.typography.hero.fontWeight ?? '700',
      color: aiTokens.text,
      letterSpacing: theme.typography.hero.letterSpacing ?? -0.4,
      marginTop: 4,
      lineHeight: theme.typography.hero.lineHeight,
    } as TextStyle,
    heroSub: {
      fontSize: theme.typography.bodySmall.fontSize,
      color: aiTokens.textSecondary,
      marginTop: 6,
      lineHeight: theme.typography.bodySmall.lineHeight,
    },

    sectionHead: {
      flexDirection: 'row',
      alignItems: 'baseline',
      marginBottom: aiTokens.space.sm,
      paddingHorizontal: 2,
    },
    sectionTitle: {
      fontSize: theme.typography.h3.fontSize,
      lineHeight: theme.typography.h3.lineHeight,
      fontWeight: '600',
      color: aiTokens.text,
      letterSpacing: theme.typography.h3.letterSpacing,
    } as TextStyle,
    sectionSub: {
      fontSize: 12,
      color: aiTokens.muted,
      marginTop: 2,
    },
    sectionGroup: {
      backgroundColor: aiTokens.surface,
      borderRadius: aiTokens.radius.md,
      overflow: 'hidden',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: aiTokens.border,
    },

    card: {
      backgroundColor: aiTokens.surface,
      borderRadius: aiTokens.radius.lg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: aiTokens.border,
      marginHorizontal: aiTokens.space.md,
      marginBottom: aiTokens.space.sm,
      padding: 15,
      overflow: 'hidden',
    },
    cardHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: 8,
    },
    cardIcon: {
      width: 22,
      alignItems: 'center',
      justifyContent: 'center',
      marginRight: 8,
    },
    cardTitle: {
      flex: 1,
      fontSize: theme.typography.h3.fontSize,
      lineHeight: theme.typography.h3.lineHeight,
      fontWeight: '600',
      color: aiTokens.text,
    },
    cardBadge: {
      paddingHorizontal: 8,
      paddingVertical: 2,
      borderRadius: aiTokens.radius.sm,
    },
    cardBadgeText: {
      fontSize: 11,
      fontWeight: '600',
    },
    cardBody: { gap: 4 },
    cardFooter: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginTop: 10,
      paddingTop: 8,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: aiTokens.border,
    },
    cardSource: { fontSize: 12, color: aiTokens.muted },
    cardConf: {
      paddingHorizontal: 8,
      paddingVertical: 2,
      borderRadius: aiTokens.radius.sm,
    },
    cardConfText: { fontSize: 10, fontWeight: '600' },

    row: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 15,
      paddingVertical: 13,
      minHeight: 48,
      backgroundColor: aiTokens.surface,
      marginHorizontal: aiTokens.space.md,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: aiTokens.border,
    },
    rowTitle: {
      fontSize: theme.typography.body.fontSize,
      lineHeight: theme.typography.body.lineHeight,
      fontWeight: '500',
      color: aiTokens.text,
    },
    rowSub: {
      fontSize: theme.typography.bodySmall.fontSize,
      lineHeight: theme.typography.bodySmall.lineHeight,
      color: aiTokens.muted,
      marginTop: 1,
    },
    rowTag: {
      paddingHorizontal: 8,
      paddingVertical: 2,
      borderRadius: aiTokens.radius.sm,
      marginLeft: 8,
    },
    rowTagText: {
      fontSize: 11,
      fontWeight: '600',
    },
  });

// ──────────────────────────────────────────────
// AIDetailHeader — 子畫面頂部（返回 + 標題 + 右側）
// ──────────────────────────────────────────────
export function AIDetailHeader({
  title,
  subtitle,
  onBack,
  rightAction,
  hideHeading = false,
}: {
  title: string;
  subtitle?: string;
  onBack?: () => void;
  rightAction?: React.ReactNode;
  hideHeading?: boolean;
}) {
  const version = useVisualTheme();
  const detailStyles = useMemo(createDetailStyles, [version]);
  const insets = useSafeAreaInsets();
  const { width, fontScale } = useWindowDimensions();
  const stackAction = !hideHeading && Boolean(rightAction) && width / fontScale < 360;
  return (
    <View style={[detailStyles.header, { paddingTop: insets.top + 12 }]}>
      <View style={detailStyles.headerRow}>
        {onBack ? (
          // iOS Nav Bar Back Button：chevron-back + tint accent
          <TouchableOpacity
            onPress={onBack}
            hitSlop={10}
            style={detailStyles.backBtn}
            accessibilityLabel="返回"
            accessibilityRole="button"
          >
            <Ionicons name="chevron-back" size={26} color={aiTokens.ai} />
          </TouchableOpacity>
        ) : (
          <View style={detailStyles.backBtn} />
        )}
        <View style={detailStyles.heading}>
          {!hideHeading ? (
            <Text style={detailStyles.title} accessibilityRole="header" numberOfLines={2}>
              {title}
            </Text>
          ) : null}
          {!hideHeading && subtitle ? (
            <Text accessibilityLabel={subtitle} style={detailStyles.subtitle} numberOfLines={2}>
              {subtitle}
            </Text>
          ) : null}
        </View>
        {stackAction ? (
          <View style={detailStyles.backBtn} />
        ) : (
          (rightAction ?? <View style={detailStyles.backBtn} />)
        )}
      </View>
      {stackAction ? <View style={detailStyles.stackedAction}>{rightAction}</View> : null}
    </View>
  );
}

// ──────────────────────────────────────────────
// AIDetailScreen — 子畫面殼層
// ──────────────────────────────────────────────
export function AIDetailScreen({
  title,
  subtitle,
  onBack,
  rightAction,
  children,
  bottomPadding,
  scrollRef,
  onScroll,
  testID,
  keyboardShouldPersistTaps = 'handled',
  keyboardDismissMode = Platform.OS === 'ios' ? 'interactive' : 'on-drag',
  automaticallyAdjustKeyboardInsets = Platform.OS === 'ios',
}: {
  title: string;
  subtitle?: string;
  onBack?: () => void;
  rightAction?: React.ReactNode;
  children: React.ReactNode;
  bottomPadding?: number;
  scrollRef?: React.Ref<ScrollView>;
  onScroll?: ScrollViewProps['onScroll'];
  testID?: string;
  keyboardShouldPersistTaps?: ScrollViewProps['keyboardShouldPersistTaps'];
  keyboardDismissMode?: ScrollViewProps['keyboardDismissMode'];
  automaticallyAdjustKeyboardInsets?: ScrollViewProps['automaticallyAdjustKeyboardInsets'];
}) {
  const version = useVisualTheme();
  const detailStyles = useMemo(createDetailStyles, [version]);
  const defaultPadding = useTabBarContentBottomPadding();
  const { width, fontScale } = useWindowDimensions();
  // Keep the navigation controls reachable while complete, larger headings scroll
  // with their content. Dynamic course/shop names must not consume the viewport.
  const headingInContent =
    width / fontScale < 360 || title.length > 24 || (subtitle?.length ?? 0) > 40;
  return (
    <View testID={testID} collapsable={false} style={{ flex: 1, backgroundColor: aiTokens.bg }}>
      <AIDetailHeader
        title={title}
        subtitle={subtitle}
        onBack={onBack}
        rightAction={rightAction}
        hideHeading={headingInContent}
      />
      <ScrollView
        ref={scrollRef}
        onScroll={onScroll}
        scrollEventThrottle={onScroll ? 16 : undefined}
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: bottomPadding ?? defaultPadding }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps={keyboardShouldPersistTaps}
        keyboardDismissMode={keyboardDismissMode}
        automaticallyAdjustKeyboardInsets={automaticallyAdjustKeyboardInsets}
      >
        {headingInContent ? (
          <View style={detailStyles.contentHeading}>
            <Text style={detailStyles.title} accessibilityRole="header">
              {title}
            </Text>
            {subtitle ? (
              <Text accessibilityLabel={subtitle} style={detailStyles.subtitle}>
                {subtitle}
              </Text>
            ) : null}
          </View>
        ) : null}
        {children}
      </ScrollView>
    </View>
  );
}

// ──────────────────────────────────────────────
// AIInsightBanner — 摘要便條（畫面頂部用）
// ──────────────────────────────────────────────
export function AIInsightBanner({
  text,
  source,
  confidence: _confidence,
}: {
  text: string;
  source?: string;
  confidence?: 'high' | 'mid' | 'low';
}) {
  useVisualTheme();
  return (
    <View
      style={{
        marginHorizontal: aiTokens.space.md,
        marginVertical: aiTokens.space.sm,
        padding: 14,
        backgroundColor: aiTokens.surface,
        borderRadius: aiTokens.radius.md,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: aiTokens.border,
        borderLeftWidth: 3,
        borderLeftColor: aiTokens.ai,
        flexDirection: 'row',
        gap: 10,
        alignItems: 'flex-start',
      }}
    >
      <AIMark size={20} />
      <View style={{ flex: 1 }}>
        <Text
          style={{
            fontSize: theme.typography.overline.fontSize,
            color: aiTokens.ai,
            fontWeight: '600',
            letterSpacing: 0.5,
          }}
        >
          摘要
        </Text>
        <Text
          style={{
            fontSize: theme.typography.bodySmall.fontSize,
            color: aiTokens.text,
            marginTop: 3,
            lineHeight: theme.typography.bodySmall.lineHeight,
          }}
        >
          {text}
        </Text>
        {source ? (
          <Text style={{ fontSize: 11, color: aiTokens.muted, marginTop: 6 }}>{source}</Text>
        ) : null}
      </View>
    </View>
  );
}

// ──────────────────────────────────────────────
// AIEmptyState — 空狀態（沒資料時）
// ──────────────────────────────────────────────
export function AIEmptyState({
  icon,
  title,
  subtitle,
  action,
}: {
  icon?: string;
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}) {
  useVisualTheme();
  return (
    <View
      style={{
        alignItems: 'center',
        paddingVertical: aiTokens.space.xl * 1.4,
        paddingHorizontal: aiTokens.space.xl,
      }}
    >
      {icon && icon !== '✨' ? (
        <Text style={{ fontSize: 28 }}>{icon}</Text>
      ) : (
        <Ionicons name="document-text-outline" size={28} color={aiTokens.muted} />
      )}
      <Text
        style={{
          fontSize: theme.typography.h2.fontSize,
          lineHeight: theme.typography.h2.lineHeight,
          fontWeight: '600',
          color: aiTokens.text,
          marginTop: 12,
          textAlign: 'center',
        }}
      >
        {title}
      </Text>
      {subtitle ? (
        <Text
          style={{
            fontSize: theme.typography.bodySmall.fontSize,
            color: aiTokens.muted,
            marginTop: 5,
            textAlign: 'center',
            lineHeight: theme.typography.bodySmall.lineHeight,
          }}
        >
          {subtitle}
        </Text>
      ) : null}
      {action ? <View style={{ marginTop: 14 }}>{action}</View> : null}
    </View>
  );
}

// ──────────────────────────────────────────────
// AILegacyLink — 已停用
// 原本作為過渡期「回到舊版」按鈕，現在新版是主入口，所有舊版 screen
// 都已從 Stack 移除（或將被移除），此元件保留型別介面但不再渲染任何 UI，
// 以避免引用方需大幅改檔。
// ──────────────────────────────────────────────
export function AILegacyLink(_props: { label?: string; onPress?: () => void }) {
  return null;
}

const createDetailStyles = () =>
  StyleSheet.create({
    header: {
      paddingHorizontal: aiTokens.space.sm,
      paddingBottom: 10,
      backgroundColor: aiTokens.bg,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: aiTokens.border,
    },
    headerRow: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    heading: {
      flex: 1,
      minWidth: 0,
      paddingHorizontal: 4,
    },
    stackedAction: {
      alignItems: 'flex-end',
      marginTop: 8,
      paddingHorizontal: 12,
    },
    contentHeading: {
      paddingHorizontal: aiTokens.space.md,
      paddingTop: 16,
      paddingBottom: 8,
    },
    backBtn: {
      width: 44,
      height: 44,
      flexShrink: 0,
      alignItems: 'center',
      justifyContent: 'center',
    },
    title: {
      fontFamily: pageTitleFont,
      fontSize: 17,
      fontWeight: '600',
      color: aiTokens.text,
      letterSpacing: -0.2,
      textAlign: 'center',
    } as TextStyle,
    subtitle: {
      fontSize: 11,
      color: aiTokens.muted,
      textAlign: 'center',
      marginTop: 2,
    },
  });
