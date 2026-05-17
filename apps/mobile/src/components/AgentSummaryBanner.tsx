/**
 * AgentSummaryBanner — 顯示「AI 今日已代你完成 N 件」+ pending / awaiting 數字
 *
 * 用法：在 5 cockpit 的 hero 下方加一行。點下去跳 AIAgentConsoleScreen。
 * 預設由 props 接收 role + 自動 load plans。
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, View, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';

import { theme } from '../ui/theme';
import { useAuth } from '../state/auth';
import { safeNavigate } from '../utils/safeNavigate';
import {
  type AgentDailySummary,
  loadAllPlans,
  summarizeToday,
} from '../services/aiAgentRuntime';

export interface AgentSummaryBannerProps {
  /** 顯示位置（給 a11y label 用） */
  cockpitLabel?: string;
}

export function AgentSummaryBanner({ cockpitLabel = '' }: AgentSummaryBannerProps) {
  const auth = useAuth();
  const navigation = useNavigation<any>();
  const [summary, setSummary] = useState<AgentDailySummary>({
    doneCount: 0,
    pendingCount: 0,
    awaitingApprovalCount: 0,
    failedCount: 0,
  });

  const reload = useCallback(async () => {
    if (!auth.user?.uid) return;
    const plans = await loadAllPlans(auth.user.uid, auth.profile?.schoolId ?? null);
    setSummary(summarizeToday(plans));
  }, [auth.user?.uid, auth.profile?.schoolId]);

  useEffect(() => {
    reload();
    // 每 30 秒刷一次（demo 中可以看到 AI 在跑）
    const id = setInterval(reload, 30_000);
    return () => clearInterval(id);
  }, [reload]);

  const total = summary.doneCount + summary.pendingCount + summary.awaitingApprovalCount;
  const hasUrgent = summary.awaitingApprovalCount > 0;

  return (
    <Pressable
      onPress={() => {
        // 先試當前 stack（HomeStack / LearnStack 都已註冊）；不行再嘗試
        // 透過 root navigator 跳到 Learn tab + nested screen，讓任何角色都能到 console。
        try {
          navigation.navigate('AIAgentConsole');
        } catch {
          try {
            navigation.getParent?.()?.navigate('Learn', { screen: 'AIAgentConsole' });
          } catch {
            safeNavigate(navigation, 'AIAgentConsole', undefined, {
              fallbackMessage: 'AI Agent Console 暫無法開啟',
            });
          }
        }
      }}
      accessibilityLabel={`AI Agent 摘要 ${cockpitLabel}`}
      style={({ pressed }) => ({
        marginTop: theme.space.sm,
        marginBottom: theme.space.xs,
        padding: theme.space.sm + 2,
        borderRadius: theme.radius.md,
        backgroundColor: hasUrgent ? '#FEF3C7' : theme.colors.surface,
        borderLeftWidth: 4,
        borderLeftColor: hasUrgent ? theme.colors.warning : theme.colors.accent,
        opacity: pressed ? 0.85 : 1,
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.space.sm,
      })}
    >
      <Text style={{ fontSize: 22 }}>🤖</Text>
      <View style={{ flex: 1 }}>
        <Text style={{
          color: theme.colors.text,
          fontSize: theme.typography.body.fontSize,
          fontWeight: '700',
        }}>
          {total === 0
            ? 'AI Agent 待命中'
            : `AI 今日已代你完成 ${summary.doneCount} 件`}
        </Text>
        <Text style={{
          color: theme.colors.muted,
          fontSize: theme.typography.labelSmall.fontSize,
          marginTop: 2,
        }}>
          {summary.awaitingApprovalCount > 0
            ? `🟡 ${summary.awaitingApprovalCount} 件等你批准`
            : summary.pendingCount > 0
              ? `🟢 ${summary.pendingCount} 件執行中`
              : '點此查看可代理任務'}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={theme.colors.muted} />
    </Pressable>
  );
}
