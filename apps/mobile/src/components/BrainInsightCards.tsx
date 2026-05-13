/**
 * BrainInsightCards — AI 主動思考洞察卡片
 * ═══════════════════════════════════════════════════════════════════════
 * 訂閱 aiBrain 的 insights，依嚴重度與類別自動排序、上色與顯示。
 *
 *   <BrainInsightCards
 *     maxVisible={3}
 *     onActionPress={(insight) => navigation.navigate('AIChat', { prompt: insight.actionSuggestion })}
 *   />
 *
 * - 自動串接 aiBrain.dismissInsight
 * - 點 action suggestion 會觸發 onActionPress（讓上層自行決定要怎麼導航）
 * - 點整張卡片預設打開洞察詳情面板（暫時用 Alert）
 */

import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { aiBrain, type BrainInsight } from '../services/aiBrain';
import { theme } from '../ui/theme';
import type { ThemeColors } from '../ui/theme';
import { useTheme } from '../state/theme';

export interface BrainInsightCardsProps {
  /** 最多顯示幾張，預設 3 */
  maxVisible?: number;
  /** 標題列（預設「AI 為你發現的事」） */
  title?: string;
  /** 點 action suggestion 時的 callback；不傳則 fallback 用 Alert 預覽 */
  onActionPress?: (insight: BrainInsight) => void;
  /** 點卡片本體時的 callback；不傳則 fallback 用 Alert 預覽 */
  onCardPress?: (insight: BrainInsight) => void;
  /** 額外 wrapper 樣式 */
  style?: React.ComponentProps<typeof View>['style'];
  /** 為空時是否完全隱藏 */
  hideWhenEmpty?: boolean;
  /** 是否顯示「再想一次」按鈕（會呼叫 aiBrain.rethink） */
  showRefresh?: boolean;
}

function buildSeverityPalette(c: ThemeColors): Record<
  BrainInsight['severity'],
  { color: string; bg: string; border: string; icon: keyof typeof Ionicons.glyphMap }
> {
  const edge = (hex: string) => `${hex}59`;
  return {
    critical: {
      color: c.danger,
      bg: c.dangerSoft,
      border: edge(c.danger),
      icon: 'alert-circle',
    },
    danger: {
      color: c.warning,
      bg: c.warningSoft,
      border: edge(c.warning),
      icon: 'warning',
    },
    warning: {
      color: c.gentleWarn,
      bg: c.gentleWarnSoft,
      border: edge(c.gentleWarn),
      icon: 'alert-outline',
    },
    watch: {
      color: c.info,
      bg: c.infoSoft,
      border: edge(c.info),
      icon: 'eye-outline',
    },
    safe: {
      color: c.success,
      bg: c.successSoft,
      border: edge(c.success),
      icon: 'sparkles-outline',
    },
  };
}

const CATEGORY_LABEL: Record<BrainInsight['category'], string> = {
  next_action: '下一步',
  risk: '風險',
  opportunity: '機會',
  reminder: '提醒',
  recommendation: '建議',
  observation: '觀察',
};

export function BrainInsightCards(props: BrainInsightCardsProps) {
  const {
    maxVisible = 3,
    title = 'AI 為你發現的事',
    onActionPress,
    onCardPress,
    style,
    hideWhenEmpty = true,
    showRefresh = true,
  } = props;

  const [insights, setInsights] = useState<BrainInsight[]>(() => aiBrain.getSnapshot().insights);
  const [rethinking, setRethinking] = useState(false);

  React.useEffect(() => {
    return aiBrain.subscribe((snap) => setInsights(snap.insights));
  }, []);

  const visible = useMemo(() => insights.slice(0, maxVisible), [insights, maxVisible]);

  const handleDismiss = useCallback((id: string) => {
    aiBrain.dismissInsight(id);
  }, []);

  const handleRethink = useCallback(async () => {
    setRethinking(true);
    try {
      await aiBrain.rethink();
    } finally {
      setRethinking(false);
    }
  }, []);

  const handleCardPress = useCallback(
    (insight: BrainInsight) => {
      if (onCardPress) return onCardPress(insight);
      Alert.alert(insight.title, insight.message);
    },
    [onCardPress],
  );

  const handleActionPress = useCallback(
    (insight: BrainInsight) => {
      if (onActionPress) return onActionPress(insight);
      Alert.alert(insight.actionSuggestion ?? insight.title, insight.message);
    },
    [onActionPress],
  );

  if (visible.length === 0 && hideWhenEmpty) return null;

  return (
    <View style={[styles.wrapper, style]}>
      <View style={styles.header}>
        <View style={styles.headerLeftRow}>
          <Ionicons name="sparkles" size={16} color={theme.colors.accent} />
          <Text style={styles.headerTitle}>{title}</Text>
          {insights.length > maxVisible && (
            <Text style={styles.headerMore}>還有 {insights.length - maxVisible} 條</Text>
          )}
        </View>
        {showRefresh && (
          <Pressable
            onPress={handleRethink}
            disabled={rethinking}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="再讓 AI 想一次"
          >
            <Ionicons
              name={rethinking ? 'sync' : 'refresh-outline'}
              size={16}
              color={theme.colors.muted}
            />
          </Pressable>
        )}
      </View>

      {visible.length === 0 ? (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyText}>
            AI 暫時沒有新發現，等資料更新會自動回報。
          </Text>
        </View>
      ) : (
        visible.map((insight) => (
          <InsightCard
            key={insight.id}
            insight={insight}
            onPress={() => handleCardPress(insight)}
            onAction={() => handleActionPress(insight)}
            onDismiss={() => handleDismiss(insight.id)}
          />
        ))
      )}
    </View>
  );
}

function InsightCard(props: {
  insight: BrainInsight;
  onPress: () => void;
  onAction: () => void;
  onDismiss: () => void;
}) {
  const { insight, onPress, onAction, onDismiss } = props;
  const th = useTheme();
  const severityStyles = useMemo(() => buildSeverityPalette(th.colors), [th]);
  const palette = severityStyles[insight.severity] ?? severityStyles.watch;
  const isDark = th.mode === 'dark';

  return (
    <Pressable
      onPress={onPress}
      accessibilityLabel={insight.title}
      style={({ pressed }) => [
        styles.card,
        {
          borderColor: palette.border,
          backgroundColor: isDark ? theme.colors.surface : palette.bg,
          opacity: pressed ? 0.85 : 1,
        },
      ]}
    >
      <View style={styles.cardHeaderRow}>
        <View style={[styles.iconBubble, { backgroundColor: palette.color + '22' }]}>
          <Ionicons name={palette.icon} size={16} color={palette.color} />
        </View>
        <View style={styles.cardHeaderText}>
          <Text style={[styles.cardCategory, { color: palette.color }]} numberOfLines={1}>
            {CATEGORY_LABEL[insight.category] ?? insight.category}
          </Text>
          <Text style={styles.cardTitle} numberOfLines={2}>
            {insight.title}
          </Text>
        </View>
        <Pressable
          onPress={onDismiss}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="忽略"
        >
          <Ionicons name="close" size={16} color={th.colors.muted} />
        </Pressable>
      </View>

      <Text style={styles.cardMessage} numberOfLines={4}>
        {insight.message}
      </Text>

      <View style={styles.cardFooter}>
        <View style={styles.cardMetaRow}>
          {insight.relatedModules.slice(0, 3).map((mod) => (
            <View key={mod} style={styles.metaPill}>
              <Text style={styles.metaPillText}>{mod}</Text>
            </View>
          ))}
        </View>
        {insight.actionSuggestion && (
          <Pressable
            onPress={onAction}
            style={({ pressed }) => [
              styles.actionButton,
              { backgroundColor: palette.color, opacity: pressed ? 0.85 : 1 },
            ]}
            accessibilityRole="button"
            accessibilityLabel={insight.actionSuggestion}
          >
            <Text style={[styles.actionButtonText, { color: th.colors.onAccent }]} numberOfLines={1}>
              {insight.actionSuggestion}
            </Text>
            <Ionicons name="arrow-forward" size={12} color={th.colors.onAccent} />
          </Pressable>
        )}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    marginHorizontal: 16,
    marginBottom: 16,
    gap: 10,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 2,
    marginBottom: 4,
  },
  headerLeftRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  headerTitle: {
    color: theme.colors.text,
    fontSize: 13,
    fontWeight: '700',
  },
  headerMore: {
    color: theme.colors.muted,
    fontSize: 11,
    marginLeft: 4,
  },
  emptyCard: {
    backgroundColor: theme.colors.surface,
    borderColor: theme.colors.border,
    borderWidth: 1,
    borderRadius: theme.radius.md,
    padding: 14,
  },
  emptyText: {
    color: theme.colors.muted,
    fontSize: 12,
  },
  card: {
    borderRadius: theme.radius.md,
    borderWidth: 1,
    padding: 12,
    gap: 8,
  },
  cardHeaderRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  iconBubble: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardHeaderText: {
    flex: 1,
    gap: 2,
  },
  cardCategory: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  cardTitle: {
    color: theme.colors.text,
    fontSize: 14,
    fontWeight: '700',
  },
  cardMessage: {
    color: theme.colors.textSecondary,
    fontSize: 12,
    lineHeight: 18,
  },
  cardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    flexWrap: 'wrap',
  },
  cardMetaRow: {
    flexDirection: 'row',
    gap: 4,
    flexShrink: 1,
  },
  metaPill: {
    backgroundColor: theme.colors.surface2,
    borderRadius: theme.radius.sm,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  metaPillText: {
    color: theme.colors.muted,
    fontSize: 10,
    fontWeight: '600',
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
  },
  actionButtonText: {
    fontSize: 11,
    fontWeight: '700',
  },
});

export default BrainInsightCards;
