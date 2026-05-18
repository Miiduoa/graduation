/**
 * Campus AI-First — Mobile Shared UI Primitives
 * -----------------------------------------------
 * 所有新版 AI-First Tab landing + 子畫面共用此檔元件，保證視覺一致。
 *
 * 設計總綱：docs/design/AI_FIRST_REDESIGN.md
 * 視覺原型：docs/design/prototype.html
 *
 * 包含：AIScreen / AIDetailScreen / AIHero / AISection / AICard /
 *      AIRow / AIButton / AIChip / AIMark / AIInsightBanner / AIEmptyState
 */
import React, { useEffect, useRef } from 'react';
import {
  Animated,
  Easing,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  type ScrollViewProps,
  type ViewStyle,
  type TextStyle,
} from 'react-native';

// ── Tokens (Apple HIG iOS systemBackground / label / Indigo accent) ──
export const aiTokens = {
  // iOS systemGroupedBackground
  bg: '#F2F2F7',
  surface: '#FFFFFF',
  panel: '#F2F2F7',
  // iOS label / secondaryLabel / tertiaryLabel
  text: '#1C1C1E',
  textSecondary: '#3C3C43',
  muted: '#8E8E93',
  // iOS separator
  border: '#E5E5EA',
  // iOS Indigo accent — 與 mobile theme.ts DEFAULT_ACCENT 對齊
  ai: '#5856D6',
  aiStrong: '#3634A3',
  aiSoft: 'rgba(88,86,214,0.10)',
  aiSurface: '#FAFBFF',
  aiGradientStart: '#EEF2FF',
  aiGradientEnd: '#FCE7F3',
  // iOS System Colors
  success: '#34C759',
  successSoft: 'rgba(52,199,89,0.12)',
  warning: '#FF9500',
  warningSoft: 'rgba(255,149,0,0.12)',
  danger: '#FF3B30',
  dangerSoft: 'rgba(255,59,48,0.12)',
  radius: { sm: 10, md: 14, lg: 20, pill: 999 },
  space: { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 },
};

// ──────────────────────────────────────────────
// AI Mark — breath animation
// ──────────────────────────────────────────────
export function AIMark({ size = 28 }: { size?: number }) {
  const scale = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(scale, {
          toValue: 1.04,
          duration: 800,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(scale, {
          toValue: 1,
          duration: 800,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    ).start();
  }, [scale]);
  return (
    <Animated.View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: aiTokens.ai,
        transform: [{ scale }],
        shadowColor: aiTokens.ai,
        shadowOpacity: 0.4,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: 4 },
        elevation: 6,
      }}
    />
  );
}

// ──────────────────────────────────────────────
// AIScreen — Tab landing 殼層
// ──────────────────────────────────────────────
export function AIScreen({
  children,
  bottomPadding = 120,
  ...rest
}: {
  children: React.ReactNode;
  bottomPadding?: number;
} & ScrollViewProps) {
  return (
    <View style={{ flex: 1, backgroundColor: aiTokens.bg }}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: bottomPadding }}
        showsVerticalScrollIndicator={false}
        {...rest}
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
  return (
    <View style={styles.hero}>
      {/* 漸層球 */}
      <View pointerEvents="none" style={styles.heroBlob} />
      {eyebrow ? <Text style={styles.heroEyebrow}>{eyebrow}</Text> : null}
      <Text style={styles.heroTitle}>{title}</Text>
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
  icon,
  badge,
  badgeTone = 'ai',
  source,
  confidence,
  children,
  onPress,
  onPin,
  aiGenerated = false,
  style,
}: {
  title?: string;
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
  const Container: any = onPress ? TouchableOpacity : View;
  const containerProps = onPress ? { activeOpacity: 0.85, onPress } : {};

  const confMap = {
    high: { color: aiTokens.success, label: '已驗證 ✓' },
    mid: { color: aiTokens.warning, label: '中信心 ●' },
    low: { color: aiTokens.danger, label: '建議找真人 ⚠' },
  };
  const conf = confidence ? confMap[confidence] : null;

  const badgeMap = {
    ai: { bg: aiTokens.aiSoft, color: aiTokens.ai },
    success: { bg: aiTokens.successSoft, color: aiTokens.success },
    warning: { bg: aiTokens.warningSoft, color: aiTokens.warning },
    danger: { bg: aiTokens.dangerSoft, color: aiTokens.danger },
    muted: { bg: aiTokens.panel, color: aiTokens.muted },
  };
  const badgeStyle = badgeMap[badgeTone];

  return (
    <Container {...containerProps} style={[styles.card, style]}>
      {aiGenerated && <View style={styles.cardAiTop} />}
      {(title || icon || badge || onPin) && (
        <View style={styles.cardHeader}>
          {icon ? (
            <View style={styles.cardIcon}>
              <Text style={{ fontSize: 16 }}>{icon}</Text>
            </View>
          ) : null}
          {title ? <Text style={styles.cardTitle}>{title}</Text> : <View style={{ flex: 1 }} />}
          {badge ? (
            <View style={[styles.cardBadge, { backgroundColor: badgeStyle.bg }]}>
              <Text style={[styles.cardBadgeText, { color: badgeStyle.color }]}>{badge}</Text>
            </View>
          ) : null}
          {onPin ? (
            <TouchableOpacity onPress={onPin} hitSlop={8} style={{ marginLeft: 8 }}>
              <Text style={{ fontSize: 18 }}>📌</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      )}
      <View style={styles.cardBody}>{children}</View>
      {(source || conf) && (
        <View style={styles.cardFooter}>
          {source ? <Text style={styles.cardSource}>📡 {source}</Text> : <View />}
          {conf && (
            <View style={[styles.cardConf, { backgroundColor: conf.color + '20' }]}>
              <Text style={[styles.cardConfText, { color: conf.color }]}>{conf.label}</Text>
            </View>
          )}
        </View>
      )}
    </Container>
  );
}

// ──────────────────────────────────────────────
// AIRow — 列表中的行（icon + 主文 + tag + chevron）
// ──────────────────────────────────────────────
export function AIRow({
  icon,
  title,
  subtitle,
  tag,
  tagTone = 'muted',
  right,
  onPress,
}: {
  icon?: string;
  title: string;
  subtitle?: string;
  tag?: string;
  tagTone?: 'ai' | 'success' | 'warning' | 'danger' | 'muted';
  right?: React.ReactNode;
  onPress?: () => void;
}) {
  const tagMap = {
    ai: { bg: aiTokens.aiSoft, color: aiTokens.ai },
    success: { bg: aiTokens.successSoft, color: aiTokens.success },
    warning: { bg: aiTokens.warningSoft, color: aiTokens.warning },
    danger: { bg: aiTokens.dangerSoft, color: aiTokens.danger },
    muted: { bg: aiTokens.panel, color: aiTokens.muted },
  };
  const tagStyle = tagMap[tagTone];

  // 若呼叫端忘了傳 onPress，至少不要假裝可點 — 開發環境直接出 warn 方便定位
  if (!onPress && __DEV__) {
    // eslint-disable-next-line no-console
    console.warn(`[AIRow] "${title}" 缺少 onPress，會顯示但點擊無反應`);
  }
  const interactive = typeof onPress === 'function';
  const sectionCtx = React.useContext(AISectionContext);

  // 在 AISection 容器內：iOS insetGrouped 樣式 — 無邊框、hairline 分隔、首末圓角
  const groupedStyle: ViewStyle = sectionCtx.inGroup
    ? {
        backgroundColor: 'transparent',
        marginHorizontal: 0,
        marginBottom: 0,
        borderWidth: 0,
        borderRadius: 0,
        borderTopWidth: sectionCtx.isFirst ? 0 : StyleSheet.hairlineWidth,
        borderTopColor: aiTokens.border,
        paddingVertical: 12,
      }
    : {};

  return (
    <TouchableOpacity
      activeOpacity={interactive ? 0.6 : 1}
      onPress={onPress}
      disabled={!interactive}
      accessibilityRole={interactive ? 'button' : undefined}
      accessibilityState={interactive ? undefined : { disabled: true }}
      style={[styles.row, groupedStyle, !interactive && { opacity: 0.55 }]}
    >
      {icon ? <Text style={{ fontSize: 20, marginRight: 12 }}>{icon}</Text> : null}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.rowTitle} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={styles.rowSub} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {tag ? (
        <View style={[styles.rowTag, { backgroundColor: tagStyle.bg }]}>
          <Text style={[styles.rowTagText, { color: tagStyle.color }]}>{tag}</Text>
        </View>
      ) : null}
      {right ?? null}
      {/* iOS chevron：在 group 內可點時顯示，與 SF Symbols chevron.right 對齊 */}
      {sectionCtx.inGroup && interactive && !right && !tag ? (
        <Text style={{ fontSize: 16, color: aiTokens.muted, marginLeft: 6 }}>›</Text>
      ) : null}
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
}: {
  label: string;
  onPress?: () => void;
  variant?: 'primary' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  icon?: string;
  style?: ViewStyle;
}) {
  const variantMap = {
    // iOS Filled
    primary: { bg: aiTokens.ai, fg: '#fff', border: aiTokens.ai },
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
  if (!onPress && __DEV__) {
    // eslint-disable-next-line no-console
    console.warn(`[AIButton] "${label}" 缺少 onPress，已自動 disable`);
  }
  const interactive = typeof onPress === 'function';
  return (
    <TouchableOpacity
      activeOpacity={interactive ? 0.8 : 1}
      onPress={onPress}
      disabled={!interactive}
      accessibilityRole="button"
      accessibilityState={interactive ? undefined : { disabled: true }}
      style={[
        {
          backgroundColor: v.bg,
          borderColor: v.border,
          borderWidth: 1,
          paddingHorizontal: sizing.paddingH,
          paddingVertical: sizing.paddingV,
          borderRadius: aiTokens.radius.sm,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 4,
          alignSelf: 'flex-start',
          opacity: interactive ? 1 : 0.5,
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
  const chipInteractive = typeof onPress === 'function';
  return (
    <TouchableOpacity
      activeOpacity={chipInteractive ? 0.8 : 1}
      onPress={onPress}
      disabled={!chipInteractive}
      accessibilityRole={chipInteractive ? 'button' : undefined}
      accessibilityState={chipInteractive ? undefined : { disabled: true }}
      style={{
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: aiTokens.radius.pill,
        borderWidth: 1,
        borderColor: active ? aiTokens.ai : aiTokens.border,
        backgroundColor: active ? aiTokens.aiSoft : aiTokens.surface,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        opacity: chipInteractive ? 1 : 0.55,
      }}
    >
      <View
        style={{
          width: 6,
          height: 6,
          borderRadius: 3,
          backgroundColor: aiTokens.ai,
        }}
      />
      <Text
        style={{
          fontSize: 12,
          color: active ? aiTokens.ai : aiTokens.text,
          fontWeight: '500',
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
const styles = StyleSheet.create({
  hero: {
    margin: aiTokens.space.md,
    marginTop: aiTokens.space.xl + 16,
    padding: aiTokens.space.lg,
    backgroundColor: aiTokens.aiGradientStart,
    borderRadius: aiTokens.radius.lg,
    overflow: 'hidden',
    position: 'relative',
  },
  heroBlob: {
    position: 'absolute',
    top: -40,
    right: -40,
    width: 160,
    height: 160,
    borderRadius: 80,
    backgroundColor: aiTokens.ai,
    opacity: 0.08,
  },
  heroEyebrow: {
    fontSize: 11,
    color: aiTokens.ai,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  } as TextStyle,
  heroTitle: {
    // iOS Large Title：34pt / 700 / letter-spacing -0.4
    fontSize: 34,
    fontWeight: '700',
    color: aiTokens.text,
    letterSpacing: -0.4,
    marginTop: 6,
    lineHeight: 41,
  } as TextStyle,
  heroSub: {
    // iOS subhead：15pt / 20 line-height
    fontSize: 15,
    color: aiTokens.muted,
    marginTop: 8,
    lineHeight: 20,
  },

  sectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: aiTokens.space.sm,
    paddingHorizontal: aiTokens.space.xs,
  },
  sectionTitle: {
    // iOS insetGrouped section header：13pt / 600 / uppercase / secondaryLabel
    fontSize: 13,
    fontWeight: '600',
    color: aiTokens.textSecondary,
    letterSpacing: 0.06,
    textTransform: 'uppercase',
  } as TextStyle,
  sectionSub: {
    fontSize: 13,
    color: aiTokens.muted,
    marginTop: 2,
  },
  // iOS insetGrouped 群組容器：圓角白底 + overflow hidden 把 row 分隔線切齊
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
    borderWidth: 1,
    borderColor: aiTokens.border,
    marginHorizontal: aiTokens.space.md,
    marginBottom: aiTokens.space.sm,
    padding: aiTokens.space.md,
    overflow: 'hidden',
  },
  cardAiTop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 3,
    backgroundColor: aiTokens.ai,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
    marginTop: 2,
  },
  cardIcon: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: aiTokens.aiSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  cardTitle: {
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
    color: aiTokens.text,
  },
  cardBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: aiTokens.radius.pill,
  },
  cardBadgeText: {
    fontSize: 11,
    fontWeight: '700',
  },
  cardBody: { gap: 4 },
  cardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: aiTokens.border,
    borderStyle: 'dashed',
  },
  cardSource: { fontSize: 11, color: aiTokens.muted },
  cardConf: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: aiTokens.radius.pill,
  },
  cardConfText: { fontSize: 10, fontWeight: '700' },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: aiTokens.space.md,
    paddingVertical: 14,
    backgroundColor: aiTokens.surface,
    marginHorizontal: aiTokens.space.md,
    borderRadius: aiTokens.radius.md,
    borderWidth: 1,
    borderColor: aiTokens.border,
    marginBottom: 8,
  },
  rowTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: aiTokens.text,
  },
  rowSub: {
    fontSize: 12,
    color: aiTokens.muted,
    marginTop: 2,
  },
  rowTag: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: aiTokens.radius.pill,
    marginLeft: 8,
  },
  rowTagText: {
    fontSize: 11,
    fontWeight: '700',
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
}: {
  title: string;
  subtitle?: string;
  onBack?: () => void;
  rightAction?: React.ReactNode;
}) {
  return (
    <View style={detailStyles.header}>
      {onBack ? (
        <TouchableOpacity onPress={onBack} hitSlop={10} style={detailStyles.backBtn}>
          <Text style={{ fontSize: 22, color: aiTokens.text }}>‹</Text>
        </TouchableOpacity>
      ) : (
        <View style={detailStyles.backBtn} />
      )}
      <View style={{ flex: 1 }}>
        <Text style={detailStyles.title} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={detailStyles.subtitle} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {rightAction ?? <View style={detailStyles.backBtn} />}
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
  bottomPadding = 120,
}: {
  title: string;
  subtitle?: string;
  onBack?: () => void;
  rightAction?: React.ReactNode;
  children: React.ReactNode;
  bottomPadding?: number;
}) {
  return (
    <View style={{ flex: 1, backgroundColor: aiTokens.bg }}>
      <AIDetailHeader
        title={title}
        subtitle={subtitle}
        onBack={onBack}
        rightAction={rightAction}
      />
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: bottomPadding }}
        showsVerticalScrollIndicator={false}
      >
        {children}
      </ScrollView>
    </View>
  );
}

// ──────────────────────────────────────────────
// AIInsightBanner — AI 摘要橫條（畫面頂部用）
// ──────────────────────────────────────────────
export function AIInsightBanner({
  text,
  source,
  confidence = 'high',
}: {
  text: string;
  source?: string;
  confidence?: 'high' | 'mid' | 'low';
}) {
  const confMap = {
    high: { color: aiTokens.success, label: '高信心 ✓' },
    mid: { color: aiTokens.warning, label: '中信心 ●' },
    low: { color: aiTokens.danger, label: '低信心 ⚠' },
  };
  const c = confMap[confidence];
  return (
    <View
      style={{
        margin: aiTokens.space.md,
        padding: aiTokens.space.md,
        backgroundColor: aiTokens.aiSurface,
        borderRadius: aiTokens.radius.md,
        borderWidth: 1,
        borderColor: aiTokens.aiSoft,
        flexDirection: 'row',
        gap: 12,
        alignItems: 'flex-start',
      }}
    >
      <AIMark size={28} />
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 11, color: aiTokens.ai, fontWeight: '700', letterSpacing: 0.4 }}>
          AI 摘要
        </Text>
        <Text style={{ fontSize: 13, color: aiTokens.text, marginTop: 4, lineHeight: 19 }}>
          {text}
        </Text>
        <View style={{ flexDirection: 'row', marginTop: 8, alignItems: 'center', gap: 8 }}>
          {source ? (
            <Text style={{ fontSize: 10, color: aiTokens.muted }}>📡 {source}</Text>
          ) : null}
          <View
            style={{
              paddingHorizontal: 6,
              paddingVertical: 2,
              borderRadius: aiTokens.radius.pill,
              backgroundColor: c.color + '20',
            }}
          >
            <Text style={{ fontSize: 9, color: c.color, fontWeight: '700' }}>{c.label}</Text>
          </View>
        </View>
      </View>
    </View>
  );
}

// ──────────────────────────────────────────────
// AIEmptyState — 空狀態（沒資料時）
// ──────────────────────────────────────────────
export function AIEmptyState({
  icon = '✨',
  title,
  subtitle,
  action,
}: {
  icon?: string;
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}) {
  return (
    <View
      style={{
        alignItems: 'center',
        paddingVertical: aiTokens.space.xl * 1.5,
        paddingHorizontal: aiTokens.space.xl,
      }}
    >
      <Text style={{ fontSize: 56 }}>{icon}</Text>
      <Text
        style={{
          fontSize: 17,
          fontWeight: '700',
          color: aiTokens.text,
          marginTop: 16,
          textAlign: 'center',
        }}
      >
        {title}
      </Text>
      {subtitle ? (
        <Text
          style={{
            fontSize: 13,
            color: aiTokens.muted,
            marginTop: 6,
            textAlign: 'center',
            lineHeight: 19,
          }}
        >
          {subtitle}
        </Text>
      ) : null}
      {action ? <View style={{ marginTop: 16 }}>{action}</View> : null}
    </View>
  );
}

// ──────────────────────────────────────────────
// AILegacyLink — 已停用
// 原本作為過渡期「回到舊版」按鈕，現在 AI-First 是主入口，所有舊版 screen
// 都已從 Stack 移除（或將被移除），此元件保留型別介面但不再渲染任何 UI，
// 以避免引用方需大幅改檔。
// ──────────────────────────────────────────────
export function AILegacyLink(_props: { label?: string; onPress?: () => void }) {
  return null;
}

const detailStyles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: aiTokens.space.sm,
    paddingTop: 56, // safe area for notch
    paddingBottom: 12,
    backgroundColor: aiTokens.bg,
    borderBottomWidth: 1,
    borderBottomColor: aiTokens.border,
  },
  backBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: 17,
    fontWeight: '700',
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
