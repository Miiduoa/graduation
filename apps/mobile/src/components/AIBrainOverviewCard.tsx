/**
 * AIBrainOverviewCard — AI 大腦概況卡片
 * ═══════════════════════════════════════════════════════════════════════
 * 顯示 AI 目前對使用者的理解、累積的學習、即時感知資料、主動洞察數量。
 * 點擊跳到 AIChat 並帶入 "AI 大腦概況" prompt。
 *
 * 通常掛在 PersonalHub / Settings / Today 頁，作為使用者了解 AI 狀態的窗口。
 */

import React from 'react';
import { Pressable, Text, View, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAIBrain } from '../app/useAIBrain';
import { theme, softShadowStyle } from '../ui/theme';

export interface AIBrainOverviewCardProps {
  onPress?: () => void;
  /** 不顯示 ChevronForward（如已是純 inline 顯示） */
  hideChevron?: boolean;
}

export function AIBrainOverviewCard({ onPress, hideChevron }: AIBrainOverviewCardProps) {
  const brain = useAIBrain();

  const insightCount = brain.insights.length;
  const factCount = brain.learning?.memory.learnedFacts.length ?? 0;
  const skillCount = brain.learning?.trainingDB.learnedSkills.length ?? 0;
  const recentCount = brain.learning?.memory.recentActions.length ?? 0;

  const description = brain.describe();

  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      style={({ pressed }) => [
        styles.container,
        {
          backgroundColor: theme.colors.surface,
          borderColor: theme.colors.border,
          opacity: pressed && onPress ? 0.92 : 1,
          ...softShadowStyle(theme.shadows.soft),
        },
      ]}
    >
      <View style={styles.headerRow}>
        <View style={[styles.iconBubble, { backgroundColor: theme.colors.accent + '20' }]}>
          <Ionicons name="hardware-chip-outline" size={20} color={theme.colors.accent} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.title, { color: theme.colors.text }]}>AI 大腦概況</Text>
          <Text style={[styles.subtitle, { color: theme.colors.muted }]} numberOfLines={1}>
            {brain.ready ? '已啟動 · 即時感知中' : '尚未啟動'}
          </Text>
        </View>
        {!hideChevron ? (
          <Ionicons name="chevron-forward" size={16} color={theme.colors.muted} />
        ) : null}
      </View>

      <Text style={[styles.description, { color: theme.colors.textSecondary }]} numberOfLines={3}>
        {description}
      </Text>

      <View style={styles.statsRow}>
        <Stat
          label="主動洞察"
          value={insightCount}
          color={insightCount > 0 ? theme.colors.urgent : theme.colors.muted}
        />
        <Stat label="學到事實" value={factCount} color={theme.colors.calm} />
        <Stat label="學會技能" value={skillCount} color="#8B5CF6" />
        <Stat label="近期動作" value={recentCount} color={theme.colors.warning} />
      </View>
    </Pressable>
  );
}

function Stat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <View style={styles.statBlock}>
      <Text style={[styles.statValue, { color }]}>{value}</Text>
      <Text style={[styles.statLabel, { color: theme.colors.muted }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 14,
    gap: 10,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  iconBubble: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: 15,
    fontWeight: '700',
  },
  subtitle: {
    fontSize: 11,
    marginTop: 2,
  },
  description: {
    fontSize: 12,
    lineHeight: 17,
  },
  statsRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 2,
  },
  statBlock: {
    flex: 1,
    alignItems: 'center',
    gap: 2,
  },
  statValue: {
    fontSize: 18,
    fontWeight: '800',
  },
  statLabel: {
    fontSize: 10,
    fontWeight: '600',
  },
});

export default AIBrainOverviewCard;
