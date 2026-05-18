/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  AIMissionControl — 角色身分專屬的 AI 任務指揮中心
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  Drop-in card 元件。任何儀表板（學生 / 教師 / TA / 系主任 / 商家 / 家長 …）
 *  把它放在第一屏，就會出現一張「AI 替你想好的下一步」清單，按下去
 *  直接跳到對應頁面做事，不會出現「點了沒反應」。
 *
 *  設計原則：
 *    1. 「AI 不是工具，是同事」— 文案用第一人稱：「我替你預估」「我已先做」
 *    2. 「省了 X 分鐘」量化 AI 的價值，畢業專題口試講師最愛這個
 *    3. 「跨角色提示」說出這件事如何牽動其他人，讓故事性自然流出
 *
 *  使用：
 *    import { AIMissionControl } from '../components/AIMissionControl';
 *    <AIMissionControl uid={auth.user?.uid} maxVisible={3} />
 *
 *  路由策略：
 *    - mission.primaryAction.{tab, screen, params} 透過 rootNavigateNested 派送
 *    - 任何路由如果未註冊，會被 NavigationContainer.onUnhandledAction 接住
 *      → 跳統一 Alert，不會白點
 * ═══════════════════════════════════════════════════════════════════════════
 */

import React, { useCallback, useMemo } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '../ui/theme';
import { rootNavigateNested } from '../app/rootNavigation';
import { getPersonaMissions, getPersona, type PersonaMission } from '../data/demoPersona';

function getSeverityStyle(
  severity: PersonaMission['severity'],
): { color: string; bg: string; icon: keyof typeof Ionicons.glyphMap; label: string } {
  switch (severity) {
    case 'critical':
      return { color: theme.colors.danger, bg: theme.colors.dangerSoft, icon: 'alert-circle', label: '優先處理' };
    case 'warn':
      return { color: theme.colors.warning, bg: theme.colors.warningSoft, icon: 'warning', label: '本日重要' };
    case 'success':
      return { color: theme.colors.success, bg: theme.colors.successSoft, icon: 'checkmark-circle', label: '進度更新' };
    case 'info':
    default:
      return { color: theme.colors.info, bg: theme.colors.infoSoft, icon: 'sparkles', label: 'AI 建議' };
  }
}

export interface AIMissionControlProps {
  /** 當前登入身分 uid */
  uid: string | undefined | null;
  /** 最多顯示張數，預設 3 */
  maxVisible?: number;
  /** 自訂標題 */
  title?: string;
  /** 自訂副標 */
  subtitle?: string;
  /** 額外 wrapper 樣式 */
  style?: React.ComponentProps<typeof View>['style'];
  /** 沒有任務時要不要完全隱藏 */
  hideWhenEmpty?: boolean;
}

export function AIMissionControl(props: AIMissionControlProps) {
  const { uid, maxVisible = 3, hideWhenEmpty = false } = props;
  const persona = useMemo(() => getPersona(uid), [uid]);
  const missions = useMemo(() => getPersonaMissions(uid).slice(0, maxVisible), [uid, maxVisible]);

  const totalSavedMinutes = useMemo(
    () => missions.reduce((sum, m) => sum + (m.savedMinutes ?? 0), 0),
    [missions],
  );

  const handlePress = useCallback((mission: PersonaMission) => {
    const { tab = 'Today', screen, params } = mission.primaryAction;
    rootNavigateNested(tab, screen, params);
  }, []);

  if (missions.length === 0) {
    if (hideWhenEmpty) return null;
    return (
      <View style={[styles.container, props.style]}>
        <View style={styles.header}>
          <View style={styles.aiBadge}>
            <Ionicons name="sparkles" size={14} color={theme.colors.accent} />
            <Text style={styles.aiBadgeText}>AI 任務指揮</Text>
          </View>
        </View>
        <View style={styles.emptyState}>
          <Text style={styles.emptyTitle}>目前沒有 AI 推薦任務</Text>
          <Text style={styles.emptyDesc}>你已經追上所有節奏，AI 會持續監測。</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, props.style]}>
      <View style={styles.header}>
        <View style={styles.aiBadge}>
          <Ionicons name="sparkles" size={14} color={theme.colors.accent} />
          <Text style={styles.aiBadgeText}>AI 任務指揮 · {persona?.shortLabel ?? '訪客'}</Text>
        </View>
        {totalSavedMinutes > 0 && (
          <View style={styles.savedBadge}>
            <Ionicons name="time-outline" size={12} color={theme.colors.success} />
            <Text style={styles.savedText}>AI 已替你節省 {totalSavedMinutes} 分鐘</Text>
          </View>
        )}
      </View>

      <Text style={styles.title}>{props.title ?? `${persona?.fullName ?? '你'}，這是我整理的下一步`}</Text>
      {props.subtitle && <Text style={styles.subtitle}>{props.subtitle}</Text>}

      <View style={styles.missionList}>
        {missions.map((mission) => {
          const sev = getSeverityStyle(mission.severity);
          return (
            <Pressable
              key={mission.id}
              testID={`mission-${mission.id}`}
              accessibilityRole="button"
              accessibilityLabel={`${mission.title}，AI 推薦`}
              onPress={() => handlePress(mission)}
              style={({ pressed }) => [
                styles.missionCard,
                { borderLeftColor: sev.color },
                pressed && styles.missionCardPressed,
              ]}
            >
              <View style={styles.missionTop}>
                <View style={[styles.severityChip, { backgroundColor: sev.bg }]}>
                  <Ionicons name={sev.icon} size={12} color={sev.color} />
                  <Text style={[styles.severityText, { color: sev.color }]}>{sev.label}</Text>
                </View>
                {mission.savedMinutes ? (
                  <Text style={styles.savedInline}>+{mission.savedMinutes} 分鐘</Text>
                ) : null}
              </View>

              <Text style={styles.missionTitle} numberOfLines={2}>
                {mission.title}
              </Text>
              <Text style={styles.missionReason} numberOfLines={2}>
                {mission.reason}
              </Text>
              <Text style={styles.missionDetail} numberOfLines={3}>
                {mission.detail}
              </Text>

              {mission.crossRoleHint && (
                <View style={styles.crossRoleHint}>
                  <Ionicons name="git-network-outline" size={12} color={theme.colors.muted} />
                  <Text style={styles.crossRoleText} numberOfLines={2}>
                    {mission.crossRoleHint}
                  </Text>
                </View>
              )}

              <View style={styles.actionRow}>
                <View style={[styles.primaryBtn, { backgroundColor: sev.color }]}>
                  <Text style={styles.primaryBtnText}>{mission.primaryActionLabel}</Text>
                  <Ionicons name="arrow-forward" size={14} color="#fff" />
                </View>
                {mission.secondaryActionLabel && (
                  <Text style={styles.secondaryText}>{mission.secondaryActionLabel}</Text>
                )}
              </View>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.xl,
    padding: theme.space.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    gap: theme.space.md,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 8,
  },
  aiBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: theme.colors.accentSoft,
  },
  aiBadgeText: {
    color: theme.colors.accent,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0,
  },
  savedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: theme.radius.sm,
    backgroundColor: theme.colors.successSoft,
  },
  savedText: {
    color: theme.colors.success,
    fontSize: 11,
    fontWeight: '700',
  },
  title: {
    color: theme.colors.text,
    fontSize: 17,
    fontWeight: '800',
    letterSpacing: 0,
  },
  subtitle: {
    color: theme.colors.muted,
    fontSize: 13,
    lineHeight: 18,
  },
  missionList: {
    gap: 10,
  },
  missionCard: {
    backgroundColor: theme.colors.bg,
    borderRadius: theme.radius.md,
    padding: 14,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderLeftWidth: 4,
    gap: 6,
  },
  missionCardPressed: {
    opacity: 0.7,
    transform: [{ scale: 0.98 }],
  },
  missionTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  severityChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
  },
  severityText: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0,
  },
  savedInline: {
    fontSize: 11,
    fontWeight: '700',
    color: '#34C759',
  },
  missionTitle: {
    color: theme.colors.text,
    fontSize: 15,
    fontWeight: '700',
    marginTop: 2,
  },
  missionReason: {
    color: theme.colors.muted,
    fontSize: 12,
    lineHeight: 17,
  },
  missionDetail: {
    color: theme.colors.textSecondary ?? theme.colors.muted,
    fontSize: 12,
    lineHeight: 17,
    marginTop: 2,
  },
  crossRoleHint: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 5,
    marginTop: 6,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
  crossRoleText: {
    flex: 1,
    color: theme.colors.muted,
    fontSize: 11,
    lineHeight: 15,
    fontStyle: 'italic',
  },
  actionRow: {
    marginTop: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
  },
  primaryBtnText: {
    color: theme.colors.onAccent,
    fontSize: 13,
    fontWeight: '700',
  },
  secondaryText: {
    color: theme.colors.muted,
    fontSize: 12,
    fontWeight: '600',
  },
  emptyState: {
    paddingVertical: 18,
    alignItems: 'center',
  },
  emptyTitle: {
    color: theme.colors.text,
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 4,
  },
  emptyDesc: {
    color: theme.colors.muted,
    fontSize: 12,
  },
});
