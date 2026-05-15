/**
 * AI Study Buddy — AI 學伴配對螢幕
 *
 * 用 aiStudyBuddyMatcher 對 demo 候選人做配對，給出 ranked list +
 * 為什麼匹配的解釋。學生可以「邀請」（demo 模式：emit 事件到對方 inbox）。
 *
 * 真實情境意涵：見 docs/REALITY_AUDIT_2026_05_15.md
 *  - 大學裡同班同學 ≠ 合適學伴；這個工具讓「修同課」「強弱互補」「時段重疊」「風格搭配」
 *    四維一起參考，比學生自己亂猜準。
 */
import React, { useMemo, useState } from 'react';
import { ScrollView, View, Text, Pressable, StyleSheet, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { theme } from '../ui/theme';
import { useTabBarContentBottomPadding } from '../ui/navigationTheme';
import {
  CockpitHero,
  CockpitMetricRow,
  CockpitMetricChip,
  CockpitSection,
} from '../ui/cockpitShell';

import {
  matchStudyBuddies,
  DEMO_BUDDY_CANDIDATES,
  DEMO_ME_PROFILE,
  type BuddyMatchResult,
} from '../services/aiStudyBuddyMatcher';
import { DEMO_COURSES } from '../data/demoCoursesMock';
import { useAuth } from '../state/auth';

const courseNameById = (id: number): string => {
  const found = DEMO_COURSES.find((c) => c.id === id);
  return found?.name ?? `課程 #${id}`;
};

export default function AIStudyBuddyScreen() {
  const auth = useAuth();
  const bottomPad = useTabBarContentBottomPadding();
  const [strictMode, setStrictMode] = useState<boolean>(false);
  const [invitedSet, setInvitedSet] = useState<Set<string>>(new Set());

  const matches = useMemo(() => {
    return matchStudyBuddies(DEMO_ME_PROFILE, DEMO_BUDDY_CANDIDATES, {
      topN: 5,
      requireSharedCourse: true,
      requireScheduleOverlap: strictMode,
    });
  }, [strictMode]);

  const avgScore = useMemo(() => {
    if (matches.length === 0) return 0;
    return Math.round(matches.reduce((a, b) => a + b.overallScore, 0) / matches.length);
  }, [matches]);

  const sendInvite = (m: BuddyMatchResult) => {
    setInvitedSet((s) => new Set([...s, m.buddyUid]));
    Alert.alert(
      '邀請已送出',
      `已邀請 ${m.buddyName} 一起組讀書會。\n\n（demo 模式：實際版會 emit 事件到對方 inbox + 通知）`,
    );
  };

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
          eyebrow={`AI 學伴配對 · ${auth.profile?.displayName ?? '學生'}`}
          title="🤝 找對學伴比讀書本身重要"
          summary="同班同學 ≠ 合適學伴。AI 從修課、強弱、空堂、學習風格四維給你 ranked 推薦，並告訴你為什麼。"
        />

        <CockpitMetricRow>
          <CockpitMetricChip label="候選人" value={DEMO_BUDDY_CANDIDATES.length} />
          <CockpitMetricChip
            label="符合配對"
            value={matches.length}
            tone={matches.length === 0 ? 'warn' : 'success'}
          />
          <CockpitMetricChip
            label="平均分"
            value={avgScore}
            tone={avgScore >= 75 ? 'success' : avgScore >= 50 ? undefined : 'warn'}
          />
          <CockpitMetricChip
            label="嚴格模式"
            value={strictMode ? '開' : '關'}
          />
        </CockpitMetricRow>

        {/* 嚴格 toggle */}
        <Pressable
          onPress={() => setStrictMode((v) => !v)}
          style={({ pressed }) => ({
            padding: theme.space.md,
            borderRadius: theme.radius.lg,
            backgroundColor: theme.colors.surface,
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: theme.colors.border,
            marginBottom: theme.space.md,
            opacity: pressed ? 0.85 : 1,
          })}
        >
          <Text style={{ fontWeight: '600', color: theme.colors.text, fontSize: 14 }}>
            {strictMode ? '🎯 嚴格模式（必須有空堂重疊）' : '🌐 寬鬆模式（任何共同課）'}
          </Text>
          <Text style={{ color: theme.colors.muted, fontSize: 12, marginTop: 2 }}>
            點一下切換。開了嚴格 → 沒空堂重疊的人會被過濾。
          </Text>
        </Pressable>

        {/* 4 維評分說明卡 */}
        <View
          style={{
            padding: theme.space.md,
            borderRadius: theme.radius.lg,
            backgroundColor: theme.colors.accentSoft,
            marginBottom: theme.space.md,
          }}
        >
          <Text style={{ fontSize: 12, color: theme.colors.muted, marginBottom: 4 }}>
            AI 用這 4 個維度評分
          </Text>
          <Text style={{ fontSize: 13, color: theme.colors.text, lineHeight: 18 }}>
            🎯 共同修課 30% · 🔄 強弱互補 35% · ⏰ 空堂重疊 20% · 🧠 學習風格 15%
          </Text>
        </View>

        <CockpitSection label="🏆 配對結果（依分數排序）" count={matches.length} open onToggle={() => undefined}>
          {matches.length === 0 ? (
            <Text style={{ color: theme.colors.muted, fontSize: 13, padding: theme.space.md }}>
              找不到符合條件的學伴。試試關閉嚴格模式。
            </Text>
          ) : (
            matches.map((m, idx) => {
              const tone =
                m.overallScore >= 80
                  ? theme.colors.success
                  : m.overallScore >= 60
                    ? theme.colors.accent
                    : theme.colors.warning;
              const invited = invitedSet.has(m.buddyUid);
              return (
                <View
                  key={m.buddyUid}
                  style={{
                    marginBottom: theme.space.md,
                    padding: theme.space.md,
                    borderRadius: theme.radius.lg,
                    backgroundColor: theme.colors.surface,
                    borderWidth: StyleSheet.hairlineWidth,
                    borderColor: theme.colors.border,
                    borderLeftWidth: 4,
                    borderLeftColor: tone,
                  }}
                >
                  <View
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                    }}
                  >
                    <View style={{ flex: 1 }}>
                      <Text
                        style={{
                          fontSize: theme.typography.body.fontSize,
                          fontWeight: '700',
                          color: theme.colors.text,
                        }}
                      >
                        #{idx + 1} {m.buddyName}
                      </Text>
                      <Text
                        style={{
                          fontSize: theme.typography.caption.fontSize,
                          color: theme.colors.muted,
                          marginTop: 2,
                        }}
                      >
                        共同修課 {m.sharedCourseIds.length} 門 · 空堂重疊 {m.scheduleOverlapHours} h
                      </Text>
                    </View>
                    <View
                      style={{
                        paddingHorizontal: theme.space.sm + 2,
                        paddingVertical: theme.space.xs + 2,
                        borderRadius: theme.radius.full,
                        backgroundColor: tone + '20',
                      }}
                    >
                      <Text style={{ color: tone, fontWeight: '700', fontSize: 18 }}>
                        {m.overallScore}
                      </Text>
                    </View>
                  </View>

                  {m.sharedCourseIds.length > 0 && (
                    <View
                      style={{
                        flexDirection: 'row',
                        flexWrap: 'wrap',
                        gap: 4,
                        marginTop: theme.space.sm,
                      }}
                    >
                      {m.sharedCourseIds.slice(0, 4).map((cid) => (
                        <View
                          key={cid}
                          style={{
                            paddingHorizontal: theme.space.xs + 2,
                            paddingVertical: 2,
                            borderRadius: theme.radius.sm,
                            backgroundColor: theme.colors.accentSoft,
                          }}
                        >
                          <Text style={{ fontSize: 11, color: theme.colors.text }}>
                            {courseNameById(cid)}
                          </Text>
                        </View>
                      ))}
                    </View>
                  )}

                  {m.reasons.length > 0 && (
                    <View style={{ marginTop: theme.space.sm }}>
                      {m.reasons.map((r, i) => (
                        <Text
                          key={i}
                          style={{
                            fontSize: 12,
                            color: theme.colors.text,
                            lineHeight: 17,
                            marginTop: 2,
                          }}
                        >
                          ✓ {r}
                        </Text>
                      ))}
                    </View>
                  )}

                  {m.cautions.length > 0 && (
                    <View style={{ marginTop: 4 }}>
                      {m.cautions.map((c, i) => (
                        <Text
                          key={i}
                          style={{
                            fontSize: 12,
                            color: theme.colors.warning,
                            lineHeight: 17,
                            marginTop: 2,
                          }}
                        >
                          ⚠ {c}
                        </Text>
                      ))}
                    </View>
                  )}

                  <Pressable
                    onPress={() => sendInvite(m)}
                    disabled={invited}
                    style={({ pressed }) => ({
                      marginTop: theme.space.sm,
                      paddingVertical: theme.space.sm,
                      borderRadius: theme.radius.md,
                      backgroundColor: invited ? theme.colors.surface : tone,
                      borderWidth: invited ? StyleSheet.hairlineWidth : 0,
                      borderColor: theme.colors.border,
                      alignItems: 'center',
                      flexDirection: 'row',
                      justifyContent: 'center',
                      gap: 6,
                      opacity: pressed ? 0.85 : 1,
                    })}
                  >
                    <Ionicons
                      name={invited ? 'checkmark-circle' : 'paper-plane'}
                      size={14}
                      color={invited ? theme.colors.muted : theme.colors.onAccent}
                    />
                    <Text
                      style={{
                        color: invited ? theme.colors.muted : theme.colors.onAccent,
                        fontWeight: '700',
                        fontSize: 13,
                      }}
                    >
                      {invited ? '已邀請' : '邀請組讀書會'}
                    </Text>
                  </Pressable>
                </View>
              );
            })
          )}
        </CockpitSection>

        <Text
          style={{
            color: theme.colors.muted,
            fontSize: theme.typography.caption.fontSize,
            textAlign: 'center',
            marginTop: theme.space.md,
            lineHeight: theme.typography.caption.lineHeight + 4,
          }}
        >
          AI 推薦不取代你的判斷。{'\n'}
          見過面、聊一下，再決定要不要長期搭。
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}
