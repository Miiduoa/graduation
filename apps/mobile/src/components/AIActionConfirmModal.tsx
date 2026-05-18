/**
 * AIActionConfirmModal — 高風險 AI 計畫的使用者確認 UI
 * ═══════════════════════════════════════════════════════════════════════
 * 顯示一個 ActionPlan 的全部步驟、風險分類，並讓使用者按「確認執行」或「取消」。
 *
 *   <AIActionConfirmModal
 *     plan={plan}
 *     visible
 *     onConfirm={async () => await brain.confirmPendingPlan(plan.id)}
 *     onCancel={() => setVisiblePlan(null)}
 *   />
 *
 * 設計：
 * - 高/中/低風險步驟用不同顏色標籤
 * - 列出每個 step.description（給使用者「我要點哪些」的可預期感）
 * - 「確認執行」按鈕在 plan.risk === 'high' 時會多一個倒數 3 秒避免誤觸
 */

import React, { useEffect, useState } from 'react';
import { Modal, View, Text, Pressable, ScrollView, StyleSheet, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { ActionPlan, ActionRisk, ActionStep } from '../services/aiBrain';
import { theme, softShadowStyle } from '../ui/theme';

export interface AIActionConfirmModalProps {
  plan: ActionPlan | null;
  visible: boolean;
  onConfirm: () => Promise<void> | void;
  onCancel: () => void;
  /** 自訂標題（預設「確認 AI 將執行的動作」） */
  title?: string;
}

const RISK_STYLES: Record<ActionRisk, { label: string; color: string; bg: string }> = {
  low: { label: '低風險', color: '#34C759', bg: '#D1FAE5' },
  medium: { label: '中風險', color: '#CA8A04', bg: '#FEF3C7' },
  high: { label: '高風險', color: '#D70015', bg: '#FEE2E2' },
};

export function AIActionConfirmModal(props: AIActionConfirmModalProps) {
  const { plan, visible, onConfirm, onCancel, title = '確認 AI 將執行的動作' } = props;
  const [submitting, setSubmitting] = useState(false);
  const [countdown, setCountdown] = useState(0);

  useEffect(() => {
    if (!visible || !plan) {
      setCountdown(0);
      return;
    }
    if (plan.risk === 'high') {
      setCountdown(3);
      const timer = setInterval(() => {
        setCountdown((prev) => {
          if (prev <= 1) {
            clearInterval(timer);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
      return () => clearInterval(timer);
    }
    setCountdown(0);
  }, [visible, plan]);

  if (!plan) return null;

  const palette = RISK_STYLES[plan.risk];
  const isDark = theme.mode === 'dark';

  const handleConfirm = async () => {
    setSubmitting(true);
    try {
      await onConfirm();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.backdrop}>
        <View
          style={[
            styles.dialog,
            {
              backgroundColor: theme.colors.surface,
              borderColor: theme.colors.border,
              ...softShadowStyle(theme.shadows.soft),
            },
          ]}
        >
          <View style={styles.headerRow}>
            <View style={[styles.iconBubble, { backgroundColor: palette.color + '20' }]}>
              <Ionicons name="git-network-outline" size={20} color={palette.color} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.title, { color: theme.colors.text }]}>{title}</Text>
              <Text style={[styles.subtitle, { color: theme.colors.muted }]}>
                {plan.goal}
              </Text>
            </View>
            <View style={[styles.riskTag, { backgroundColor: palette.bg }]}>
              <Text style={[styles.riskTagText, { color: palette.color }]}>{palette.label}</Text>
            </View>
          </View>

          <ScrollView style={styles.stepList} contentContainerStyle={{ gap: 8 }}>
            {plan.steps.map((step, index) => (
              <StepRow key={step.id} step={step} index={index + 1} />
            ))}
          </ScrollView>

          <Text style={[styles.note, { color: theme.colors.muted }]}>
            {plan.risk === 'high'
              ? '此計畫包含不可逆或會通知他人的操作，請確認無誤後再執行。'
              : plan.risk === 'medium'
                ? 'AI 將代你完成這些動作，必要時可隨時取消。'
                : 'AI 將立即完成這些動作。'}
          </Text>

          <View style={styles.actionRow}>
            <Pressable
              onPress={onCancel}
              disabled={submitting}
              style={({ pressed }) => [
                styles.actionButton,
                {
                  backgroundColor: isDark ? theme.colors.surface2 : '#F2F2F7',
                  opacity: pressed ? 0.85 : 1,
                  borderColor: theme.colors.border,
                  borderWidth: 1,
                },
              ]}
            >
              <Text style={[styles.actionText, { color: theme.colors.text }]}>取消</Text>
            </Pressable>
            <Pressable
              onPress={handleConfirm}
              disabled={submitting || countdown > 0}
              style={({ pressed }) => [
                styles.actionButton,
                styles.primaryButton,
                {
                  backgroundColor: palette.color,
                  opacity: submitting || countdown > 0 ? 0.6 : pressed ? 0.85 : 1,
                },
              ]}
            >
              {submitting ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.primaryButtonText}>
                  {countdown > 0 ? `確認執行 (${countdown})` : '確認執行'}
                </Text>
              )}
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function StepRow({ step, index }: { step: ActionStep; index: number }) {
  const palette = RISK_STYLES[step.risk ?? 'low'];
  return (
    <View
      style={[
        styles.stepRow,
        { backgroundColor: theme.colors.surface2, borderColor: theme.colors.border },
      ]}
    >
      <View
        style={[
          styles.stepNumber,
          { backgroundColor: palette.color + '20', borderColor: palette.color + '60' },
        ]}
      >
        <Text style={[styles.stepNumberText, { color: palette.color }]}>{index}</Text>
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[styles.stepTool, { color: theme.colors.text }]} numberOfLines={1}>
          {step.tool}
        </Text>
        <Text style={[styles.stepDescription, { color: theme.colors.textSecondary }]}>
          {step.description}
        </Text>
      </View>
      <Text style={[styles.stepRisk, { color: palette.color }]}>{palette.label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  dialog: {
    width: '100%',
    maxWidth: 420,
    maxHeight: '85%',
    borderRadius: 18,
    padding: 18,
    borderWidth: 1,
    gap: 14,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  iconBubble: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: 16,
    fontWeight: '700',
  },
  subtitle: {
    fontSize: 12,
    marginTop: 2,
  },
  riskTag: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
  },
  riskTagText: {
    fontSize: 10,
    fontWeight: '700',
  },
  stepList: {
    maxHeight: 320,
  },
  stepRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 12,
    padding: 10,
    borderWidth: 1,
  },
  stepNumber: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  stepNumberText: {
    fontSize: 12,
    fontWeight: '700',
  },
  stepTool: {
    fontSize: 13,
    fontWeight: '700',
  },
  stepDescription: {
    fontSize: 11,
    lineHeight: 16,
  },
  stepRisk: {
    fontSize: 10,
    fontWeight: '700',
  },
  note: {
    fontSize: 11,
    lineHeight: 16,
    textAlign: 'center',
  },
  actionRow: {
    flexDirection: 'row',
    gap: 10,
  },
  actionButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButton: {},
  actionText: {
    fontSize: 14,
    fontWeight: '700',
  },
  primaryButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
  },
});

export default AIActionConfirmModal;
