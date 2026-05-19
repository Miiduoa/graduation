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
  findInstantHelp,
  suggestStudyTeam,
  DEMO_BUDDY_CANDIDATES,
  DEMO_ME_PROFILE,
  type BuddyMatchResult,
  type InstantHelpMatch,
  type StudyTeamSuggestion,
} from '../services/aiStudyBuddyMatcher';
import {
  emitHelpRequested,
  emitAnnouncementPosted,
} from '../services/roleEventBus';
import { DEMO_COURSES } from '../data/demoCoursesMock';
import { useAuth } from '../state/auth';
import { requestHelp } from '../services/demoStore';

const courseNameById = (id: number): string => {
  const found = DEMO_COURSES.find((c) => c.id === id);
  return found?.name ?? `課程 #${id}`;
};

type BuddyMode = 'semester' | 'instant' | 'team';

export default function AIStudyBuddyScreen() {
  const auth = useAuth();
  const bottomPad = useTabBarContentBottomPadding();
  const [mode, setMode] = useState<BuddyMode>('semester');
  const [strictMode, setStrictMode] = useState<boolean>(false);
  const [invitedSet, setInvitedSet] = useState<Set<string>>(new Set());
  // 即時求助：選一門目前卡關的課（預設第一門共修課）
  const [helpCourseId, setHelpCourseId] = useState<number>(
    DEMO_ME_PROFILE.enrolledCourseIds[0] ?? 71378,
  );

  const matches = useMemo(() => {
    return matchStudyBuddies(DEMO_ME_PROFILE, DEMO_BUDDY_CANDIDATES, {
      topN: 5,
      requireSharedCourse: true,
      requireScheduleOverlap: strictMode,
    });
  }, [strictMode]);

  const instantMatches: InstantHelpMatch[] = useMemo(() => {
    return findInstantHelp({
      courseId: helpCourseId,
      myStrength: DEMO_ME_PROFILE.courseStrength[helpCourseId],
      candidates: DEMO_BUDDY_CANDIDATES,
      topN: 3,
    });
  }, [helpCourseId]);

  const teamSuggestion: StudyTeamSuggestion = useMemo(() => {
    return suggestStudyTeam(DEMO_ME_PROFILE, DEMO_BUDDY_CANDIDATES, {
      teamSize: 3,
      forCourseId: helpCourseId,
    });
  }, [helpCourseId]);

  const avgScore = useMemo(() => {
    if (matches.length === 0) return 0;
    return Math.round(matches.reduce((a, b) => a + b.overallScore, 0) / matches.length);
  }, [matches]);

  const sendInvite = async (m: BuddyMatchResult) => {
    const actorUid = auth.user?.uid ?? 'demo_student_kuchih';
    // 不能邀請自己（demo 對 demo 自己 buddyUid 重合的保險）
    if (m.buddyUid === actorUid) {
      Alert.alert('提示', '不能邀請自己當學伴。');
      return;
    }
    setInvitedSet((s) => new Set([...s, m.buddyUid]));
    // emit 邀請事件到對方 inbox（用 announcement_posted 限定 audience）
    try {
      await emitAnnouncementPosted({
        actorUid,
        actorName: auth.profile?.displayName ?? '同學',
        targetUids: [m.buddyUid],
        courseId: m.sharedCourseIds[0] ?? 'general',
        courseName: '學伴邀請',
        payload: {
          title: '📨 學伴邀請',
          content: `${auth.profile?.displayName ?? '同學'} 邀請你一起組讀書會。`,
        },
      });
    } catch {
      /* swallow */
    }
    Alert.alert('邀請已送出', `已邀請 ${m.buddyName} 一起組讀書會，訊息會出現在他的 inbox。`);
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

        {/* 3 模式切換 */}
        <View
          style={{
            flexDirection: 'row',
            gap: theme.space.xs,
            marginBottom: theme.space.md,
          }}
        >
          {(
            [
              { key: 'semester', emoji: '📅', label: '學期長期' },
              { key: 'instant', emoji: '🆘', label: '即時求助' },
              { key: 'team', emoji: '👥', label: '組讀書會' },
            ] as Array<{ key: BuddyMode; emoji: string; label: string }>
          ).map((opt) => {
            const active = mode === opt.key;
            return (
              <Pressable
                key={opt.key}
                onPress={() => setMode(opt.key)}
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
                    fontWeight: '700',
                    fontSize: 12,
                  }}
                >
                  {opt.emoji} {opt.label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {mode === 'semester' && (
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
        )}

        {/* 嚴格 toggle — 只在 semester mode 顯示 */}
        {mode === 'semester' && (
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
        )}

        {/* 4 維評分說明卡 — 只在 semester mode 顯示 */}
        {mode === 'semester' && (
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
        )}

        {/* ── INSTANT 模式 UI ── */}
        {mode === 'instant' && (
          <>
            {/* 課程選擇 */}
            <View
              style={{
                marginBottom: theme.space.md,
                padding: theme.space.md,
                borderRadius: theme.radius.lg,
                backgroundColor: theme.colors.surface,
                borderWidth: StyleSheet.hairlineWidth,
                borderColor: theme.colors.border,
              }}
            >
              <Text style={{ fontSize: 12, color: theme.colors.muted, marginBottom: theme.space.xs }}>
                我卡關的課程
              </Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space.xs }}>
                {DEMO_ME_PROFILE.enrolledCourseIds.map((cid) => {
                  const active = cid === helpCourseId;
                  return (
                    <Pressable
                      key={cid}
                      onPress={() => setHelpCourseId(cid)}
                      style={({ pressed }) => ({
                        paddingHorizontal: theme.space.sm + 2,
                        paddingVertical: theme.space.xs + 2,
                        borderRadius: theme.radius.full,
                        backgroundColor: active ? theme.colors.text : theme.colors.surfaceMuted,
                        opacity: pressed ? 0.8 : 1,
                      })}
                    >
                      <Text style={{ color: active ? theme.colors.bg : theme.colors.text, fontSize: 12, fontWeight: '600' }}>
                        {courseNameById(cid)}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            <CockpitSection
              label={`🆘 線上能幫你的人（${courseNameById(helpCourseId)}）`}
              count={instantMatches.length}
              open
              onToggle={() => undefined}
            >
              {instantMatches.length === 0 ? (
                <View style={{ padding: theme.space.md }}>
                  <Text style={{ color: theme.colors.muted, fontSize: 13 }}>
                    目前沒有「線上 + 該科比你強」的學伴。
                  </Text>
                  <Text style={{ color: theme.colors.muted, fontSize: 12, marginTop: 4 }}>
                    建議：發到「跨校匿名問答」或先 self study 30 分鐘再求助。
                  </Text>
                </View>
              ) : (
                instantMatches.map((h) => (
                  <View
                    key={h.buddyUid}
                    style={{
                      marginBottom: theme.space.sm,
                      padding: theme.space.md,
                      borderRadius: theme.radius.lg,
                      backgroundColor: theme.colors.surface,
                      borderWidth: StyleSheet.hairlineWidth,
                      borderColor: theme.colors.border,
                      borderLeftWidth: 4,
                      borderLeftColor: theme.colors.success,
                    }}
                  >
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                      <View style={{ flex: 1 }}>
                        <Text style={{ fontSize: 15, fontWeight: '700', color: theme.colors.text }}>
                          🟢 {h.buddyName}
                        </Text>
                        <Text style={{ fontSize: 12, color: theme.colors.muted, marginTop: 2 }}>
                          約 {h.expectedResponseMinutes} 分鐘內回 · 該科強度 {h.theirStrength}
                        </Text>
                      </View>
                      <Pressable
                        onPress={async () => {
                          // 真的 emit help_requested → TA inbox + 學伴 inbox
                          // 收件人會自動排除 actor 自己（避免老師對自己求助）
                          try {
                            const actorUid = auth.user?.uid ?? 'demo_student_kuchih';
                            const targets = [h.buddyUid, 'demo_ta_lin'].filter(
                              (uid) => uid && uid !== actorUid,
                            );
                            if (targets.length > 0) {
                              await emitHelpRequested({
                                actorUid,
                                actorName: auth.profile?.displayName ?? '同學',
                                targetUids: targets,
                                courseId: helpCourseId,
                                courseName: courseNameById(helpCourseId),
                                payload: {
                                  topic: `${courseNameById(helpCourseId)} 卡關`,
                                  preview: `想請 ${h.buddyName} 協助解題`,
                                  urgency: 'medium',
                                },
                              });
                            }
                          } catch {
                            /* swallow */
                          }
                          // 同步寫 demoStore，讓切換到 ta/teacher 角色可在
                          // Messages 跨角色面板看到並回覆。
                          try {
                            requestHelp({
                              courseId: String(helpCourseId),
                              courseName: courseNameById(helpCourseId),
                              topic: `${courseNameById(helpCourseId)} 卡關（請 ${h.buddyName} 協助解題）`,
                              urgency: 'normal',
                              studentId: auth.user?.uid ?? 'stu-001',
                              studentName: auth.profile?.displayName ?? '王小明',
                            });
                          } catch {
                            /* swallow */
                          }
                          Alert.alert(
                            '求助已送出',
                            `已送訊息給 ${h.buddyName} 與助教，預估 ${h.expectedResponseMinutes} 分鐘內回。\n切換成 TA / 老師角色可在 Messages 跨角色面板回覆。`,
                          );
                        }}
                        style={({ pressed }) => ({
                          paddingHorizontal: theme.space.md,
                          paddingVertical: theme.space.xs + 2,
                          borderRadius: theme.radius.full,
                          backgroundColor: theme.colors.success,
                          opacity: pressed ? 0.85 : 1,
                        })}
                      >
                        <Text style={{ color: theme.colors.onAccent ?? '#fff', fontSize: 12, fontWeight: '700' }}>
                          🆘 求助
                        </Text>
                      </Pressable>
                    </View>
                    {h.reasons.map((r, i) => (
                      <Text key={i} style={{ fontSize: 12, color: theme.colors.text, marginTop: 2 }}>
                        ✓ {r}
                      </Text>
                    ))}
                  </View>
                ))
              )}
            </CockpitSection>
          </>
        )}

        {/* ── TEAM 模式 UI ── */}
        {mode === 'team' && (
          <>
            <View
              style={{
                marginBottom: theme.space.md,
                padding: theme.space.md,
                borderRadius: theme.radius.lg,
                backgroundColor: theme.colors.accentSoft,
              }}
            >
              <Text style={{ fontSize: 12, color: theme.colors.muted, marginBottom: 4 }}>
                AI 建議的 3 人讀書會（含角色分配）
              </Text>
              <Text style={{ fontSize: 13, color: theme.colors.text, lineHeight: 18 }}>
                配 1 解題王 + 1 筆記王 + 1 督促者 / 主持人 = 不會散
              </Text>
              <View style={{ marginTop: theme.space.sm, flexDirection: 'row', alignItems: 'center', gap: theme.space.xs }}>
                <View
                  style={{
                    paddingHorizontal: theme.space.sm,
                    paddingVertical: theme.space.xs,
                    borderRadius: theme.radius.full,
                    backgroundColor: theme.colors.success + '22',
                  }}
                >
                  <Text style={{ color: theme.colors.success, fontSize: 12, fontWeight: '700' }}>
                    Synergy {teamSuggestion.synergyScore}
                  </Text>
                </View>
                {teamSuggestion.synergyReasons.map((r, i) => (
                  <Text key={i} style={{ color: theme.colors.text, fontSize: 11 }}>
                    · {r}
                  </Text>
                ))}
              </View>
            </View>

            <CockpitSection
              label={`👥 建議組合（${teamSuggestion.members.length} 人）`}
              count={teamSuggestion.members.length}
              open
              onToggle={() => undefined}
            >
              {teamSuggestion.members.length === 0 ? (
                <Text style={{ color: theme.colors.muted, fontSize: 13, padding: theme.space.md }}>
                  目前候選人不足以組成讀書會。
                </Text>
              ) : (
                teamSuggestion.members.map((m) => (
                  <View
                    key={m.buddyUid}
                    style={{
                      marginBottom: theme.space.sm,
                      padding: theme.space.md,
                      borderRadius: theme.radius.lg,
                      backgroundColor: theme.colors.surface,
                      borderWidth: StyleSheet.hairlineWidth,
                      borderColor: theme.colors.border,
                      borderLeftWidth: 4,
                      borderLeftColor: theme.colors.accent,
                    }}
                  >
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                      <View style={{ flex: 1 }}>
                        <Text style={{ fontSize: 15, fontWeight: '700', color: theme.colors.text }}>
                          {m.buddyName}
                        </Text>
                        <Text style={{ fontSize: 12, color: theme.colors.muted, marginTop: 2 }}>
                          {m.reasoning}
                        </Text>
                      </View>
                      <View
                        style={{
                          paddingHorizontal: theme.space.sm,
                          paddingVertical: theme.space.xs + 2,
                          borderRadius: theme.radius.full,
                          backgroundColor: theme.colors.accent + '22',
                        }}
                      >
                        <Text style={{ color: theme.colors.accent, fontSize: 12, fontWeight: '700' }}>
                          {m.role}
                        </Text>
                      </View>
                    </View>
                  </View>
                ))
              )}
              <Pressable
                onPress={() => {
                  Alert.alert(
                    '邀請組讀書會',
                    `將同時邀請 ${teamSuggestion.members.map((m) => m.buddyName).join('、')} 一起組讀書會。\n\n（demo 模式：實際版會建群 + 同步到行事曆）`,
                  );
                }}
                style={({ pressed }) => ({
                  marginTop: theme.space.sm,
                  paddingVertical: theme.space.sm,
                  borderRadius: theme.radius.md,
                  backgroundColor: theme.colors.text,
                  alignItems: 'center',
                  opacity: pressed ? 0.85 : 1,
                })}
              >
                <Text style={{ color: theme.colors.bg, fontWeight: '700', fontSize: 13 }}>
                  📩 邀請整組
                </Text>
              </Pressable>
            </CockpitSection>
          </>
        )}

        {mode === 'semester' && (
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
        )}

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
