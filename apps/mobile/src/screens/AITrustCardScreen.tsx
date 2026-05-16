/**
 * AI Trust Card — 期末 AI 信任卡（學生 / 老師都可看）
 *
 * 把 audit log + interaction history → 計算 trust metrics → 可分享的視覺卡片
 *
 * 設計重點：
 *   - 卡面要 sharable（適合截圖貼 IG）
 *   - 數字要直白（推送幾次 / 採納幾次 / 擋下幾次）
 *   - AI 守住的承諾要列出（為什麼擋）
 *   - 給整體 trust score 0-100
 *
 * 動機：見 docs/REALITY_AUDIT_2026_05_15.md D.2
 */
import React, { useEffect, useMemo, useState } from 'react';
import {
  ScrollView,
  View,
  Text,
  Pressable,
  StyleSheet,
  Alert,
  Share,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { theme } from '../ui/theme';
import { useTabBarContentBottomPadding } from '../ui/navigationTheme';
import { CockpitHero, CockpitSection } from '../ui/cockpitShell';
import { useAuth } from '../state/auth';

import {
  buildTrustCard,
  REASON_LABEL,
  type TrustCardData,
} from '../services/aiTrustCard';
import { loadAuditLog, type AuditLogEntry } from '../services/aiSkillApplicator';
import { loadInteractionHistory, type InteractionEvent } from '../services/aiLearning';

const PERIOD_OPTIONS: Array<{ key: '7d' | '30d' | 'semester'; label: string; days: number }> = [
  { key: '7d', label: '近 7 天', days: 7 },
  { key: '30d', label: '近 30 天', days: 30 },
  { key: 'semester', label: '本學期', days: 120 },
];

export default function AITrustCardScreen() {
  const auth = useAuth();
  const uid = auth.user?.uid ?? null;
  const bottomPad = useTabBarContentBottomPadding();

  const [period, setPeriod] = useState<'7d' | '30d' | 'semester'>('semester');
  const [auditLog, setAuditLog] = useState<AuditLogEntry[]>([]);
  const [history, setHistory] = useState<InteractionEvent[]>([]);

  useEffect(() => {
    if (!uid) return;
    Promise.all([
      loadAuditLog(uid).catch(() => [] as AuditLogEntry[]),
      loadInteractionHistory(uid).catch(() => [] as InteractionEvent[]),
    ]).then(([log, hist]) => {
      setAuditLog(log);
      setHistory(hist);
    });
  }, [uid]);

  const card: TrustCardData = useMemo(() => {
    const days = PERIOD_OPTIONS.find((p) => p.key === period)?.days ?? 120;
    const fromMs = Date.now() - days * 86400_000;
    return buildTrustCard({
      uid: uid ?? '',
      displayName: auth.profile?.displayName ?? '使用者',
      auditLog,
      history,
      periodLabel: PERIOD_OPTIONS.find((p) => p.key === period)?.label,
      fromMs,
      toMs: Date.now(),
    });
  }, [uid, auth.profile?.displayName, auditLog, history, period]);

  const sharedCard = async () => {
    try {
      await Share.share({
        message: card.shareableSummary + '\n\n— Campus Companion · AI 信任卡',
      });
    } catch (e) {
      Alert.alert('分享失敗', String((e as Error)?.message ?? e));
    }
  };

  const scoreColor =
    card.trustScore >= 80
      ? theme.colors.success
      : card.trustScore >= 60
        ? theme.colors.accent
        : theme.colors.warning;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.bg }} edges={['top']}>
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: theme.layout.screenHorizontalPadding,
          paddingTop: theme.space.md,
          paddingBottom: bottomPad,
        }}
        showsVerticalScrollIndicator={false}
      >
        <CockpitHero
          eyebrow={`AI 信任卡 · ${auth.profile?.displayName ?? '使用者'}`}
          title="🛡 AI 為你守住了什麼"
          summary="每一次推送、每一次擋下都有紀錄。AI 應該是工具，不是黑盒。"
        />

        {/* 期間切換 */}
        <View style={{ flexDirection: 'row', gap: theme.space.xs, marginBottom: theme.space.md }}>
          {PERIOD_OPTIONS.map((p) => {
            const active = p.key === period;
            return (
              <Pressable
                key={p.key}
                onPress={() => setPeriod(p.key)}
                style={({ pressed }) => ({
                  flex: 1,
                  paddingVertical: theme.space.sm,
                  borderRadius: theme.radius.md,
                  backgroundColor: active ? theme.colors.text : theme.colors.surface,
                  borderWidth: StyleSheet.hairlineWidth,
                  borderColor: active ? theme.colors.text : theme.colors.border,
                  alignItems: 'center',
                  opacity: pressed ? 0.85 : 1,
                })}
              >
                <Text
                  style={{
                    color: active ? theme.colors.bg : theme.colors.text,
                    fontSize: 12,
                    fontWeight: '700',
                  }}
                >
                  {p.label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {/* 主卡（截圖區） */}
        <View
          style={{
            padding: theme.space.lg,
            borderRadius: theme.radius.xl,
            backgroundColor: theme.colors.surface,
            borderWidth: 1,
            borderColor: theme.colors.border,
            marginBottom: theme.space.lg,
          }}
        >
          <Text
            style={{
              fontSize: theme.typography.labelSmall.fontSize,
              color: theme.colors.muted,
              textTransform: 'uppercase',
              letterSpacing: 0.6,
              fontWeight: '700',
            }}
          >
            🛡 AI 信任卡 · {card.periodLabel}
          </Text>
          {/* trust score 大字 */}
          <View
            style={{
              alignItems: 'center',
              marginTop: theme.space.md,
              marginBottom: theme.space.md,
            }}
          >
            <Text style={{ fontSize: 64, fontWeight: '800', color: scoreColor }}>
              {card.trustScore}
            </Text>
            <Text style={{ fontSize: 12, color: theme.colors.muted, marginTop: -4 }}>
              / 100 信任分
            </Text>
          </View>

          {/* 三排數字 */}
          <View
            style={{
              flexDirection: 'row',
              justifyContent: 'space-around',
              marginTop: theme.space.sm,
            }}
          >
            <Stat label="推送" value={card.totalSuggested} />
            <Divider />
            <Stat label="採納" value={card.accepted} accent={theme.colors.success} />
            <Divider />
            <Stat label="自律擋下" value={card.blocked} accent={theme.colors.warning} />
          </View>

          {/* 採納率條 */}
          <View style={{ marginTop: theme.space.md }}>
            <View
              style={{
                flexDirection: 'row',
                justifyContent: 'space-between',
                marginBottom: 4,
              }}
            >
              <Text style={{ fontSize: 12, color: theme.colors.muted }}>採納率</Text>
              <Text style={{ fontSize: 12, color: theme.colors.text, fontWeight: '700' }}>
                {Math.round(card.acceptRate * 100)}%
              </Text>
            </View>
            <View
              style={{
                height: 6,
                borderRadius: 3,
                backgroundColor: theme.colors.surfaceMuted,
                overflow: 'hidden',
              }}
            >
              <View
                style={{
                  width: `${Math.round(card.acceptRate * 100)}%`,
                  height: '100%',
                  backgroundColor: scoreColor,
                }}
              />
            </View>
          </View>

          {/* 分享按鈕 */}
          <Pressable
            onPress={sharedCard}
            style={({ pressed }) => ({
              marginTop: theme.space.lg,
              paddingVertical: theme.space.sm + 2,
              borderRadius: theme.radius.md,
              backgroundColor: theme.colors.text,
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
              opacity: pressed ? 0.85 : 1,
            })}
          >
            <Ionicons name="share-outline" size={16} color={theme.colors.bg} />
            <Text style={{ color: theme.colors.bg, fontSize: 13, fontWeight: '700' }}>
              分享我的 AI 信任卡
            </Text>
          </Pressable>
        </View>

        {/* AI 守住的承諾 */}
        <CockpitSection
          label="🌟 AI 守住的承諾"
          count={card.highlights.length}
          open
          onToggle={() => undefined}
        >
          {card.highlights.map((h, i) => (
            <View
              key={i}
              style={{
                padding: theme.space.md,
                borderRadius: theme.radius.md,
                backgroundColor: theme.colors.surface,
                borderLeftWidth: 3,
                borderLeftColor: theme.colors.success,
                marginBottom: theme.space.xs + 2,
              }}
            >
              <Text style={{ fontSize: 13, color: theme.colors.text, lineHeight: 18 }}>
                ✓ {h}
              </Text>
            </View>
          ))}
        </CockpitSection>

        {/* Guardrail 觸發分布 */}
        <CockpitSection
          label="📋 Guardrail 觸發分布"
          count={Object.keys(card.guardrailBreakdown).length}
          open
          onToggle={() => undefined}
        >
          {Object.keys(card.guardrailBreakdown).length === 0 ? (
            <Text style={{ color: theme.colors.muted, fontSize: 13, padding: theme.space.md }}>
              本期間 AI 沒有觸發任何 guardrail（沒有需要擋下的推送）
            </Text>
          ) : (
            Object.entries(card.guardrailBreakdown)
              .sort((a, b) => b[1] - a[1])
              .map(([reason, count]) => (
                <View
                  key={reason}
                  style={{
                    flexDirection: 'row',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    paddingVertical: theme.space.sm,
                    borderBottomWidth: StyleSheet.hairlineWidth,
                    borderBottomColor: theme.colors.separator,
                  }}
                >
                  <Text style={{ fontSize: 13, color: theme.colors.text, flex: 1 }}>
                    {REASON_LABEL[reason] ?? reason}
                  </Text>
                  <Text style={{ fontSize: 13, color: theme.colors.muted, fontWeight: '700' }}>
                    {count} 次
                  </Text>
                </View>
              ))
          )}
        </CockpitSection>

        {/* AI 自律比例條 */}
        <View
          style={{
            marginTop: theme.space.md,
            padding: theme.space.md,
            borderRadius: theme.radius.lg,
            backgroundColor: theme.colors.accentSoft,
          }}
        >
          <Text style={{ fontSize: 12, color: theme.colors.muted, marginBottom: theme.space.sm }}>
            自動 vs 先問 vs 擋下
          </Text>
          {(() => {
            const total = card.totalSuggested || 1;
            const segs = [
              { label: '自動', value: card.autoPushed, color: theme.colors.success },
              { label: '先問', value: card.askedUser, color: theme.colors.accent },
              { label: '擋下', value: card.blocked, color: theme.colors.warning },
            ];
            return (
              <>
                <View
                  style={{
                    flexDirection: 'row',
                    height: 10,
                    borderRadius: 5,
                    overflow: 'hidden',
                    backgroundColor: theme.colors.surface,
                  }}
                >
                  {segs.map((s) => (
                    <View
                      key={s.label}
                      style={{
                        flex: s.value / total,
                        backgroundColor: s.color,
                      }}
                    />
                  ))}
                </View>
                <View
                  style={{
                    flexDirection: 'row',
                    justifyContent: 'space-between',
                    marginTop: theme.space.sm,
                  }}
                >
                  {segs.map((s) => (
                    <View key={s.label} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                      <View
                        style={{
                          width: 8,
                          height: 8,
                          borderRadius: 4,
                          backgroundColor: s.color,
                        }}
                      />
                      <Text style={{ fontSize: 12, color: theme.colors.text }}>
                        {s.label} {s.value}
                      </Text>
                    </View>
                  ))}
                </View>
              </>
            );
          })()}
        </View>

        <Text
          style={{
            marginTop: theme.space.lg,
            color: theme.colors.muted,
            fontSize: theme.typography.caption.fontSize,
            textAlign: 'center',
            lineHeight: theme.typography.caption.lineHeight + 4,
          }}
        >
          所有數字皆來自你的裝置 audit log。{'\n'}
          AI 應該是讓你看得到的工具。
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function Stat({ label, value, accent }: { label: string; value: number; accent?: string }) {
  return (
    <View style={{ alignItems: 'center', minWidth: 72 }}>
      <Text
        style={{
          fontSize: 24,
          fontWeight: '800',
          color: accent ?? theme.colors.text,
        }}
      >
        {value}
      </Text>
      <Text style={{ fontSize: 11, color: theme.colors.muted, marginTop: 2 }}>{label}</Text>
    </View>
  );
}

function Divider() {
  return (
    <View
      style={{
        width: StyleSheet.hairlineWidth,
        backgroundColor: theme.colors.separator,
      }}
    />
  );
}
