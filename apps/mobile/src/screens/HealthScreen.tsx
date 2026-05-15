/* eslint-disable @typescript-eslint/no-unused-vars, @typescript-eslint/no-explicit-any, react-hooks/exhaustive-deps */
/**
 * 靜宜大學校園健康 — 商業級 AI 全人健康生態圈
 *
 * Tabs:
 *  1. 首頁 — 智慧推薦 + 快速操作 + 季節預警
 *  2. 就醫 — AI 症狀自評 + 掛號 + 看診紀錄
 *  3. 心理 — Mood Tracker + 諮商預約 + 同儕互助
 *  4. 護照 — 健康護照 + 疫苗紀錄 + 過敏/用藥
 *  5. 運動 — 運動處方箋 + 體適能 + 校園設施
 *  6. 急救 — AED 地圖 + 緊急電話 + CPR 步驟
 */
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  ScrollView,
  Text,
  View,
  Pressable,
  RefreshControl,
  Alert,
  Dimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { linkingOpenWithPuTronClassGate } from '../services/tronClassWebUiGate';
import {
  Screen,
  AnimatedCard,
  Button,
  Pill,
  SegmentedControl,
  EmptyState,
  ProgressRing,
} from '../ui/components';
import { TAB_BAR_CONTENT_BOTTOM_PADDING } from '../ui/navigationTheme';
import { theme } from '../ui/theme';
import { useAuth } from '../state/auth';
import { useSchool } from '../state/school';
import { analytics } from '../services/analytics';

import {
  // 健康中心
  HEALTH_CENTER,
  COUNSELING_CENTER,
  // 科別
  DEPARTMENTS,
  getDeptInfo,
  type HealthDepartment,
  type DepartmentInfo,
  // AI 症狀自評
  SYMPTOM_OPTIONS,
  triageSymptom,
  type SymptomOption,
  type TriageResult,
  type SymptomSeverity,
  // Mood Tracker
  MOOD_EMOJIS,
  MOOD_FACTORS,
  analyzeMoodTrend,
  type MoodLevel,
  type MoodEntry,
  type MoodTrend,
  type MoodFactor,
  // 健康護照
  AVAILABLE_VACCINES,
  type HealthPassport,
  type VaccinationRecord,
  // AED
  AED_LOCATIONS,
  EMERGENCY_NUMBERS,
  type AEDLocation,
  // 運動處方
  generateExercisePrescription,
  type FitnessProfile,
  type ExercisePrescription,
  // 角色
  ROLE_HEALTH_CONFIG,
  type HealthRole,
  // 互動
  HEALTH_ROLE_INTERACTIONS,
  // 同儕互助
  PEER_TOPICS,
  type PeerSupportPost,
  type PeerSupportTopic,
  // 季節預警
  getActiveAlerts,
  type SeasonalAlert,
  // 推薦
  getSmartHealthSuggestions,
  type HealthSuggestion,
  // 通知
  HEALTH_NOTIFICATION_TYPES,
  // 模擬
  simulateHealthStats,
  simulateMyHealth,
  simulatePeerPosts,
} from '../data/puHealthData';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

// ═══════════════════════════════════════════════════
// Tab 定義
// ═══════════════════════════════════════════════════

type HealthTab = 'home' | 'clinic' | 'mental' | 'passport' | 'exercise' | 'emergency';

const TABS: { key: HealthTab; label: string }[] = [
  { key: 'home', label: '首頁' },
  { key: 'clinic', label: '就醫' },
  { key: 'mental', label: '心理' },
  { key: 'passport', label: '護照' },
  { key: 'exercise', label: '運動' },
  { key: 'emergency', label: '急救' },
];

// ═══════════════════════════════════════════════════
// 主畫面
// ═══════════════════════════════════════════════════

export function HealthScreen(props: any) {
  const nav = props?.navigation;
  const auth = useAuth();
  const { school } = useSchool();

  const [tab, setTab] = useState<HealthTab>('home');
  const [refreshing, setRefreshing] = useState(false);

  // 資料
  const [suggestions, setSuggestions] = useState<HealthSuggestion[]>([]);
  const [alerts, setAlerts] = useState<SeasonalAlert[]>([]);
  const [stats, setStats] = useState(simulateHealthStats());
  const [myHealth, setMyHealth] = useState(simulateMyHealth());
  const [peerPosts, setPeerPosts] = useState<PeerSupportPost[]>([]);
  const [moodTrend, setMoodTrend] = useState<MoodTrend | null>(null);

  // 症狀自評
  const [selectedSymptom, setSelectedSymptom] = useState<SymptomOption | null>(null);
  const [triageResult, setTriageResult] = useState<TriageResult | null>(null);

  // 運動處方
  const [exerciseRx, setExerciseRx] = useState<ExercisePrescription[]>([]);

  useEffect(() => {
    analytics.logScreenView('Health');
    loadData();
  }, [school?.id]);

  const loadData = useCallback(() => {
    setSuggestions(getSmartHealthSuggestions());
    setAlerts(getActiveAlerts());
    setStats(simulateHealthStats());
    const health = simulateMyHealth();
    setMyHealth(health);
    setPeerPosts(simulatePeerPosts());
    setMoodTrend(analyzeMoodTrend(health.moodEntries));

    // 產生運動處方
    const profile: FitnessProfile = {
      userId: 'current-user',
      bmi: health.passport.bmi ?? 22,
      restingHR: 72,
      level: 'beginner',
      weeklyExerciseMinutes: 60,
      goals: ['紓壓', '改善睡眠'],
      limitations: [],
    };
    setExerciseRx(generateExercisePrescription(profile));
  }, [school?.id]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    loadData();
    setRefreshing(false);
  }, [loadData]);

  const handleCall = (phone: string) => {
    void linkingOpenWithPuTronClassGate(`tel:${phone.replace(/[^0-9#*]/g, '')}`);
  };

  const handleTriageSymptom = (symptom: SymptomOption) => {
    setSelectedSymptom(symptom);
    // 簡化版 demo: 假設使用者描述為「輕微」
    const result = triageSymptom(symptom.id, ['輕微']);
    setTriageResult(result);
  };

  // ═════════════════════════════════════════════════
  // renderHome
  // ═════════════════════════════════════════════════

  const renderHome = () => (
    <>
      {/* 智慧推薦 */}
      {suggestions.length > 0 && (
        <AnimatedCard>
          <View style={{ gap: 8 }}>
            {suggestions.map((s, i) => (
              <Pressable
                key={i}
                onPress={() => {
                  if (s.action === 'mood') setTab('mental');
                  else if (s.action === 'exercise') setTab('exercise');
                  else if (s.action === 'sleep') setTab('mental');
                }}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 10,
                  padding: 10,
                  borderRadius: theme.radius.md,
                  backgroundColor: `${s.color}10`,
                }}
              >
                <Ionicons name={s.icon as any} size={18} color={s.color} />
                <Text style={{ color: theme.colors.text, fontSize: 13, flex: 1 }}>{s.text}</Text>
                {s.action && (
                  <Ionicons name="chevron-forward" size={14} color={theme.colors.muted} />
                )}
              </Pressable>
            ))}
          </View>
        </AnimatedCard>
      )}

      {/* 季節預警 */}
      {alerts.length > 0 && (
        <AnimatedCard title="健康預警" delay={50}>
          <View style={{ gap: 8 }}>
            {alerts.slice(0, 3).map((alert) => {
              const bgColor =
                alert.severity === 'danger'
                  ? '#EF444415'
                  : alert.severity === 'warning'
                    ? '#F59E0B12'
                    : `${alert.color}10`;
              return (
                <View
                  key={alert.id}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 10,
                    padding: 10,
                    borderRadius: theme.radius.md,
                    backgroundColor: bgColor,
                  }}
                >
                  <Ionicons name={alert.icon as any} size={18} color={alert.color} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: theme.colors.text, fontWeight: '600', fontSize: 13 }}>
                      {alert.title}
                    </Text>
                    <Text style={{ color: theme.colors.muted, fontSize: 11 }}>{alert.message}</Text>
                  </View>
                </View>
              );
            })}
          </View>
        </AnimatedCard>
      )}

      {/* 快速操作 */}
      <AnimatedCard title="快速操作" delay={100}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
          {[
            { key: 'clinic', label: '症狀自評', icon: 'git-compare-outline', color: '#3B82F6' },
            { key: 'book', label: '預約掛號', icon: 'calendar-outline', color: '#10B981' },
            { key: 'mood', label: '記錄心情', icon: 'happy-outline', color: '#7C3AED' },
            { key: 'emergency', label: '緊急求助', icon: 'warning-outline', color: '#EF4444' },
            {
              key: 'passport',
              label: '健康護照',
              icon: 'shield-checkmark-outline',
              color: '#059669',
            },
            { key: 'peer', label: '同儕互助', icon: 'people-outline', color: '#EC4899' },
          ].map((qa) => (
            <Pressable
              key={qa.key}
              onPress={() => {
                if (qa.key === 'clinic' || qa.key === 'book') setTab('clinic');
                else if (qa.key === 'mood' || qa.key === 'peer') setTab('mental');
                else if (qa.key === 'emergency') setTab('emergency');
                else if (qa.key === 'passport') setTab('passport');
              }}
              style={({ pressed }) => ({
                width: (SCREEN_WIDTH - 64) / 3 - 7,
                paddingVertical: 14,
                alignItems: 'center',
                borderRadius: theme.radius.md,
                backgroundColor: pressed ? `${qa.color}20` : `${qa.color}10`,
                gap: 6,
              })}
            >
              <Ionicons name={qa.icon as any} size={22} color={qa.color} />
              <Text style={{ color: theme.colors.text, fontSize: 11, fontWeight: '600' }}>
                {qa.label}
              </Text>
            </Pressable>
          ))}
        </View>
      </AnimatedCard>

      {/* Mood 概覽 */}
      {moodTrend && (
        <AnimatedCard title="本週心情" subtitle={`平均 ${moodTrend.weekAvg}/5`} delay={150}>
          <View style={{ gap: 8 }}>
            {/* 情緒曲線 (簡化為近 7 天 emoji) */}
            <View style={{ flexDirection: 'row', justifyContent: 'space-around' }}>
              {myHealth.moodEntries
                .slice(0, 7)
                .reverse()
                .map((entry, i) => {
                  const emoji = MOOD_EMOJIS[entry.level];
                  return (
                    <View key={i} style={{ alignItems: 'center', gap: 2 }}>
                      <Text style={{ fontSize: 20 }}>{emoji.emoji}</Text>
                      <Text style={{ color: theme.colors.muted, fontSize: 9 }}>
                        {new Date(entry.date).getDate()}日
                      </Text>
                    </View>
                  );
                })}
            </View>

            {/* 趨勢提示 */}
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 8,
                padding: 10,
                borderRadius: theme.radius.md,
                backgroundColor:
                  moodTrend.alertLevel === 'normal'
                    ? '#10B98110'
                    : moodTrend.alertLevel === 'attention'
                      ? '#F59E0B10'
                      : '#EF444410',
              }}
            >
              <Ionicons
                name={
                  moodTrend.trend === 'improving'
                    ? 'trending-up'
                    : moodTrend.trend === 'declining'
                      ? 'trending-down'
                      : 'remove-outline'
                }
                size={18}
                color={
                  moodTrend.trend === 'improving'
                    ? '#10B981'
                    : moodTrend.trend === 'declining'
                      ? '#EF4444'
                      : '#F59E0B'
                }
              />
              <Text style={{ color: theme.colors.text, fontSize: 12, flex: 1 }}>
                {moodTrend.suggestion}
              </Text>
            </View>
          </View>
        </AnimatedCard>
      )}

      {/* 即將到來的預約 */}
      {myHealth.upcomingAppointments.length > 0 && (
        <AnimatedCard title="即將到來" delay={200}>
          {myHealth.upcomingAppointments.map((apt) => {
            const deptInfo = getDeptInfo(apt.dept);
            return (
              <View
                key={apt.id}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 10,
                  padding: 10,
                  borderRadius: theme.radius.md,
                  backgroundColor: theme.colors.surface2,
                }}
              >
                <View
                  style={{
                    width: 42,
                    height: 42,
                    borderRadius: 12,
                    backgroundColor: `${deptInfo.color}15`,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Ionicons name={deptInfo.icon as any} size={20} color={deptInfo.color} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: theme.colors.text, fontWeight: '600', fontSize: 13 }}>
                    {deptInfo.label}
                  </Text>
                  <Text style={{ color: theme.colors.muted, fontSize: 11 }}>
                    {apt.date} {apt.time} · {apt.doctor}
                  </Text>
                </View>
                <Pill text="已預約" kind="accent" />
              </View>
            );
          })}
        </AnimatedCard>
      )}

      {/* 營業資訊 */}
      <AnimatedCard title="服務時間" delay={250}>
        <View style={{ gap: 6 }}>
          {[
            {
              name: HEALTH_CENTER.name,
              hours: HEALTH_CENTER.hours[0].time,
              icon: 'medical-outline',
              color: '#3B82F6',
            },
            {
              name: COUNSELING_CENTER.name,
              hours: COUNSELING_CENTER.hours[0].time,
              icon: 'heart-outline',
              color: '#7C3AED',
            },
          ].map((svc) => (
            <View
              key={svc.name}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 10,
                padding: 10,
                borderRadius: theme.radius.md,
                backgroundColor: theme.colors.surface2,
              }}
            >
              <Ionicons name={svc.icon as any} size={18} color={svc.color} />
              <View style={{ flex: 1 }}>
                <Text style={{ color: theme.colors.text, fontWeight: '600', fontSize: 13 }}>
                  {svc.name}
                </Text>
                <Text style={{ color: theme.colors.muted, fontSize: 11 }}>{svc.hours}</Text>
              </View>
            </View>
          ))}
        </View>
      </AnimatedCard>
    </>
  );

  // ═════════════════════════════════════════════════
  // renderClinic — 就醫
  // ═════════════════════════════════════════════════

  const renderClinic = () => (
    <>
      {/* AI 症狀自評 */}
      <AnimatedCard title="AI 症狀自評" subtitle="幫助你快速分流掛號">
        {!selectedSymptom ? (
          <View style={{ gap: 6 }}>
            <Text style={{ color: theme.colors.muted, fontSize: 12, marginBottom: 4 }}>
              請選擇你目前的主要不適：
            </Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {SYMPTOM_OPTIONS.map((s) => (
                <Pressable
                  key={s.id}
                  onPress={() => handleTriageSymptom(s)}
                  style={({ pressed }) => ({
                    paddingHorizontal: 14,
                    paddingVertical: 10,
                    borderRadius: theme.radius.md,
                    backgroundColor: pressed ? theme.colors.accentSoft : theme.colors.surface2,
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 6,
                  })}
                >
                  <Ionicons name={s.icon as any} size={16} color={theme.colors.accent} />
                  <Text style={{ color: theme.colors.text, fontSize: 12, fontWeight: '600' }}>
                    {s.label}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>
        ) : (
          <View style={{ gap: 10 }}>
            {/* 選中的症狀 */}
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 8,
                padding: 10,
                borderRadius: theme.radius.md,
                backgroundColor: theme.colors.accentSoft,
              }}
            >
              <Ionicons name={selectedSymptom.icon as any} size={18} color={theme.colors.accent} />
              <Text style={{ color: theme.colors.accent, fontWeight: '700', fontSize: 14 }}>
                {selectedSymptom.label}
              </Text>
              <Pressable
                onPress={() => {
                  setSelectedSymptom(null);
                  setTriageResult(null);
                }}
                style={{ marginLeft: 'auto' }}
              >
                <Ionicons name="close-circle" size={20} color={theme.colors.muted} />
              </Pressable>
            </View>

            {/* 分流結果 */}
            {triageResult && (
              <View style={{ gap: 8 }}>
                <View
                  style={{
                    padding: 12,
                    borderRadius: theme.radius.lg,
                    backgroundColor:
                      triageResult.severity === 'emergency'
                        ? '#EF444420'
                        : triageResult.severity === 'severe'
                          ? '#F59E0B20'
                          : triageResult.severity === 'moderate'
                            ? '#3B82F620'
                            : '#10B98115',
                    borderWidth: 1,
                    borderColor:
                      triageResult.severity === 'emergency'
                        ? '#EF444450'
                        : triageResult.severity === 'severe'
                          ? '#F59E0B50'
                          : triageResult.severity === 'moderate'
                            ? '#3B82F650'
                            : '#10B98130',
                  }}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <Ionicons
                      name={triageResult.shouldCallEmergency ? 'alert-circle' : 'checkmark-circle'}
                      size={22}
                      color={
                        triageResult.severity === 'emergency'
                          ? '#EF4444'
                          : triageResult.severity === 'severe'
                            ? '#F59E0B'
                            : '#10B981'
                      }
                    />
                    <Text
                      style={{ color: theme.colors.text, fontWeight: '700', fontSize: 14, flex: 1 }}
                    >
                      {triageResult.urgencyMessage}
                    </Text>
                  </View>

                  <View style={{ flexDirection: 'row', gap: 12, marginTop: 10 }}>
                    <View style={{ flex: 1, gap: 4 }}>
                      <Text style={{ color: theme.colors.muted, fontSize: 11 }}>推薦科別</Text>
                      <Text style={{ color: theme.colors.text, fontWeight: '600', fontSize: 13 }}>
                        {getDeptInfo(triageResult.recommendedDepartment).label}
                      </Text>
                    </View>
                    <View style={{ flex: 1, gap: 4 }}>
                      <Text style={{ color: theme.colors.muted, fontSize: 11 }}>預估等待</Text>
                      <Text style={{ color: theme.colors.text, fontWeight: '600', fontSize: 13 }}>
                        {triageResult.waitEstimate}
                      </Text>
                    </View>
                  </View>
                </View>

                {/* 自我照護建議 */}
                {triageResult.selfCareAdvice && (
                  <View style={{ gap: 4 }}>
                    <Text style={{ color: theme.colors.text, fontWeight: '600', fontSize: 12 }}>
                      居家照護建議：
                    </Text>
                    {triageResult.selfCareAdvice.map((tip, i) => (
                      <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <Ionicons name="checkmark" size={14} color="#10B981" />
                        <Text style={{ color: theme.colors.muted, fontSize: 12 }}>{tip}</Text>
                      </View>
                    ))}
                  </View>
                )}

                {triageResult.shouldCallEmergency ? (
                  <Button text="撥打緊急電話" kind="primary" onPress={() => handleCall('119')} />
                ) : (
                  <Button
                    text="前往掛號"
                    kind="primary"
                    onPress={() =>
                      Alert.alert(
                        '掛號',
                        `將為您掛號 ${getDeptInfo(triageResult.recommendedDepartment).label}`,
                      )
                    }
                  />
                )}
              </View>
            )}
          </View>
        )}
      </AnimatedCard>

      {/* 門診科別 */}
      <AnimatedCard title="門診科別" subtitle="點擊快速掛號" delay={50}>
        <View style={{ gap: 6 }}>
          {DEPARTMENTS.filter((d) => d.id !== 'crisis').map((dept) => (
            <Pressable
              key={dept.id}
              onPress={() =>
                Alert.alert(
                  `${dept.label}`,
                  `${dept.description}\n\n開診時間：${dept.availableDays}\n預估等待：${dept.avgWaitMinutes} 分鐘\n${dept.requiresAppointment ? '⚠️ 需事先預約' : '✅ 可現場掛號'}`,
                )
              }
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 10,
                padding: 10,
                borderRadius: theme.radius.md,
                backgroundColor: theme.colors.surface2,
              }}
            >
              <View
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: 10,
                  backgroundColor: `${dept.color}15`,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Ionicons name={dept.icon as any} size={16} color={dept.color} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: theme.colors.text, fontWeight: '600', fontSize: 13 }}>
                  {dept.label}
                </Text>
                <Text style={{ color: theme.colors.muted, fontSize: 11 }} numberOfLines={1}>
                  {dept.description}
                </Text>
              </View>
              {dept.requiresAppointment && (
                <View
                  style={{
                    paddingHorizontal: 6,
                    paddingVertical: 2,
                    borderRadius: 4,
                    backgroundColor: '#F59E0B18',
                  }}
                >
                  <Text style={{ color: '#F59E0B', fontSize: 9, fontWeight: '600' }}>需預約</Text>
                </View>
              )}
            </Pressable>
          ))}
        </View>
      </AnimatedCard>

      {/* 近期就醫紀錄 */}
      <AnimatedCard title="近期就醫" delay={100}>
        {myHealth.recentVisits.length === 0 ? (
          <EmptyState title="無就醫紀錄" subtitle="保持健康！" icon="checkmark-circle-outline" />
        ) : (
          <View style={{ gap: 6 }}>
            {myHealth.recentVisits.map((visit, i) => {
              const deptInfo = getDeptInfo(visit.dept);
              return (
                <View
                  key={i}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 10,
                    padding: 10,
                    borderRadius: theme.radius.md,
                    backgroundColor: theme.colors.surface2,
                  }}
                >
                  <Ionicons name={deptInfo.icon as any} size={18} color={deptInfo.color} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: theme.colors.text, fontWeight: '600', fontSize: 12 }}>
                      {deptInfo.label} · {visit.doctor}
                    </Text>
                    <Text style={{ color: theme.colors.muted, fontSize: 11 }}>{visit.note}</Text>
                  </View>
                  <Text style={{ color: theme.colors.muted, fontSize: 10 }}>{visit.date}</Text>
                </View>
              );
            })}
          </View>
        )}
      </AnimatedCard>
    </>
  );

  // ═════════════════════════════════════════════════
  // renderMental — 心理健康
  // ═════════════════════════════════════════════════

  const renderMental = () => (
    <>
      {/* Mood Tracker */}
      <AnimatedCard title="今日心情" subtitle="匿名記錄，只有你看得到">
        <View style={{ gap: 12 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-around' }}>
            {([1, 2, 3, 4, 5] as MoodLevel[]).map((level) => {
              const mood = MOOD_EMOJIS[level];
              return (
                <Pressable
                  key={level}
                  onPress={() =>
                    Alert.alert(
                      '記錄心情',
                      `今天心情：${mood.label}\n\n（實際版本會展開選擇困擾因素）`,
                    )
                  }
                  style={({ pressed }) => ({
                    width: 52,
                    height: 52,
                    borderRadius: 26,
                    backgroundColor: pressed ? `${mood.color}30` : `${mood.color}12`,
                    alignItems: 'center',
                    justifyContent: 'center',
                  })}
                >
                  <Text style={{ fontSize: 26 }}>{mood.emoji}</Text>
                </Pressable>
              );
            })}
          </View>
          <Text style={{ color: theme.colors.muted, fontSize: 11, textAlign: 'center' }}>
            選擇最符合現在感受的表情
          </Text>
        </View>
      </AnimatedCard>

      {/* 心情趨勢 */}
      {moodTrend && (
        <AnimatedCard title="心情趨勢" subtitle="近 7 天" delay={50}>
          <View style={{ gap: 8 }}>
            <View style={{ flexDirection: 'row', gap: 12 }}>
              <View
                style={{
                  flex: 1,
                  padding: 10,
                  borderRadius: 8,
                  backgroundColor: theme.colors.surface2,
                  alignItems: 'center',
                }}
              >
                <Text style={{ color: theme.colors.text, fontWeight: '800', fontSize: 20 }}>
                  {moodTrend.weekAvg}
                </Text>
                <Text style={{ color: theme.colors.muted, fontSize: 10 }}>本週平均</Text>
              </View>
              <View
                style={{
                  flex: 1,
                  padding: 10,
                  borderRadius: 8,
                  backgroundColor: theme.colors.surface2,
                  alignItems: 'center',
                }}
              >
                <Text style={{ color: theme.colors.text, fontWeight: '800', fontSize: 20 }}>
                  {moodTrend.monthAvg}
                </Text>
                <Text style={{ color: theme.colors.muted, fontSize: 10 }}>本月平均</Text>
              </View>
              <View
                style={{
                  flex: 1,
                  padding: 10,
                  borderRadius: 8,
                  backgroundColor: theme.colors.surface2,
                  alignItems: 'center',
                }}
              >
                <Ionicons
                  name={
                    moodTrend.trend === 'improving'
                      ? 'trending-up'
                      : moodTrend.trend === 'declining'
                        ? 'trending-down'
                        : 'remove'
                  }
                  size={22}
                  color={
                    moodTrend.trend === 'improving'
                      ? '#10B981'
                      : moodTrend.trend === 'declining'
                        ? '#EF4444'
                        : '#F59E0B'
                  }
                />
                <Text style={{ color: theme.colors.muted, fontSize: 10 }}>趨勢</Text>
              </View>
            </View>

            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 8,
                padding: 10,
                borderRadius: 8,
                backgroundColor: `${MOOD_FACTORS.find((f) => f.id === moodTrend.dominantFactor)?.id ? '#7C3AED' : '#3B82F6'}10`,
              }}
            >
              <Ionicons name="analytics-outline" size={16} color="#7C3AED" />
              <Text style={{ color: theme.colors.text, fontSize: 12, flex: 1 }}>
                主要影響因素：
                {MOOD_FACTORS.find((f) => f.id === moodTrend.dominantFactor)?.label ?? ''}
              </Text>
            </View>
          </View>
        </AnimatedCard>
      )}

      {/* 諮商預約 */}
      <AnimatedCard title="心理諮商" subtitle={COUNSELING_CENTER.hours[0].time} delay={100}>
        <View style={{ gap: 8 }}>
          <Text style={{ color: theme.colors.muted, fontSize: 12, lineHeight: 18 }}>
            所有諮商嚴格保密。首次諮商可先進行初談評估，由專業諮商師協助你釐清困擾。
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {COUNSELING_CENTER.services.map((svc) => (
              <View
                key={svc}
                style={{
                  paddingHorizontal: 10,
                  paddingVertical: 5,
                  borderRadius: 999,
                  backgroundColor: '#7C3AED12',
                }}
              >
                <Text style={{ color: '#7C3AED', fontSize: 11, fontWeight: '600' }}>{svc}</Text>
              </View>
            ))}
          </View>
          <Button
            text="預約諮商"
            kind="primary"
            onPress={() => Alert.alert('預約諮商', '將為您開啟線上預約系統')}
          />
        </View>
      </AnimatedCard>

      {/* 同儕互助圈 */}
      <AnimatedCard title="匿名互助圈" subtitle="你不孤單" delay={150}>
        <View style={{ gap: 8 }}>
          {peerPosts.slice(0, 4).map((post) => {
            const topicInfo = PEER_TOPICS.find((t) => t.id === post.topic);
            return (
              <View
                key={post.id}
                style={{
                  padding: 10,
                  borderRadius: theme.radius.md,
                  backgroundColor: theme.colors.surface2,
                }}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <View
                    style={{
                      paddingHorizontal: 6,
                      paddingVertical: 2,
                      borderRadius: 4,
                      backgroundColor: `${topicInfo?.color ?? '#999'}15`,
                    }}
                  >
                    <Text
                      style={{ color: topicInfo?.color ?? '#999', fontSize: 9, fontWeight: '600' }}
                    >
                      {topicInfo?.label}
                    </Text>
                  </View>
                  <Text style={{ color: theme.colors.muted, fontSize: 10 }}>
                    {post.authorAlias}
                  </Text>
                </View>
                <Text
                  style={{ color: theme.colors.text, fontSize: 12, marginTop: 4, lineHeight: 18 }}
                  numberOfLines={2}
                >
                  {post.content}
                </Text>
                <View style={{ flexDirection: 'row', gap: 12, marginTop: 6 }}>
                  {post.reactions.map((r) => (
                    <View
                      key={r.type}
                      style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}
                    >
                      <Text style={{ fontSize: 12 }}>
                        {r.type === 'hug' ? '🤗' : r.type === 'same' ? '💭' : '💪'}
                      </Text>
                      <Text style={{ color: theme.colors.muted, fontSize: 10 }}>{r.count}</Text>
                    </View>
                  ))}
                  <View
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 3,
                      marginLeft: 'auto',
                    }}
                  >
                    <Ionicons name="chatbubble-outline" size={12} color={theme.colors.muted} />
                    <Text style={{ color: theme.colors.muted, fontSize: 10 }}>
                      {post.replyCount}
                    </Text>
                  </View>
                </View>
              </View>
            );
          })}
          <Pressable style={{ alignItems: 'center', padding: 8 }}>
            <Text style={{ color: theme.colors.accent, fontSize: 12, fontWeight: '600' }}>
              查看更多 / 發布心情 →
            </Text>
          </Pressable>
        </View>
      </AnimatedCard>

      {/* 心理資源 */}
      <AnimatedCard title="24h 求助資源" delay={200}>
        <View style={{ gap: 6 }}>
          {EMERGENCY_NUMBERS.filter((n) =>
            ['安心專線', '生命線', '張老師專線'].includes(n.name),
          ).map((num) => (
            <Pressable
              key={num.name}
              onPress={() => handleCall(num.phone)}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 10,
                padding: 10,
                borderRadius: theme.radius.md,
                backgroundColor: theme.colors.surface2,
              }}
            >
              <Ionicons name={num.icon as any} size={18} color={num.color} />
              <View style={{ flex: 1 }}>
                <Text style={{ color: theme.colors.text, fontWeight: '600', fontSize: 13 }}>
                  {num.name}
                </Text>
                <Text style={{ color: theme.colors.muted, fontSize: 11 }}>{num.available}</Text>
              </View>
              <Text style={{ color: theme.colors.accent, fontWeight: '700', fontSize: 14 }}>
                {num.phone}
              </Text>
            </Pressable>
          ))}
        </View>
      </AnimatedCard>
    </>
  );

  // ═════════════════════════════════════════════════
  // renderPassport — 健康護照
  // ═════════════════════════════════════════════════

  const renderPassport = () => {
    const passport = myHealth.passport;
    return (
      <>
        {/* 基本資訊 */}
        <AnimatedCard title="我的健康護照" subtitle="一碼通行">
          <View style={{ gap: 8 }}>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {[
                {
                  label: '血型',
                  value: passport.bloodType ?? '未登錄',
                  icon: 'water',
                  color: '#EF4444',
                },
                {
                  label: 'BMI',
                  value: passport.bmi?.toString() ?? '--',
                  icon: 'body',
                  color: '#3B82F6',
                },
                {
                  label: '視力(左)',
                  value: passport.visionLeft?.toString() ?? '--',
                  icon: 'eye',
                  color: '#8B5CF6',
                },
                {
                  label: '視力(右)',
                  value: passport.visionRight?.toString() ?? '--',
                  icon: 'eye',
                  color: '#8B5CF6',
                },
              ].map((info) => (
                <View
                  key={info.label}
                  style={{
                    flex: 1,
                    padding: 10,
                    borderRadius: 8,
                    backgroundColor: theme.colors.surface2,
                    alignItems: 'center',
                  }}
                >
                  <Ionicons name={info.icon as any} size={16} color={info.color} />
                  <Text
                    style={{
                      color: theme.colors.text,
                      fontWeight: '700',
                      fontSize: 14,
                      marginTop: 2,
                    }}
                  >
                    {info.value}
                  </Text>
                  <Text style={{ color: theme.colors.muted, fontSize: 9 }}>{info.label}</Text>
                </View>
              ))}
            </View>

            {/* 過敏 */}
            {passport.allergies && passport.allergies.length > 0 && (
              <View
                style={{
                  padding: 10,
                  borderRadius: 8,
                  backgroundColor: '#EF444412',
                  borderWidth: 1,
                  borderColor: '#EF444430',
                }}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Ionicons name="alert-circle" size={16} color="#EF4444" />
                  <Text style={{ color: '#EF4444', fontWeight: '700', fontSize: 12 }}>過敏史</Text>
                </View>
                {passport.allergies.map((a, i) => (
                  <Text key={i} style={{ color: theme.colors.text, fontSize: 12, marginTop: 4 }}>
                    {a.name}（
                    {a.severity === 'severe' ? '嚴重' : a.severity === 'moderate' ? '中度' : '輕微'}
                    ）
                  </Text>
                ))}
              </View>
            )}

            {/* 緊急聯絡人 */}
            {passport.emergencyContact && (
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 8,
                  padding: 10,
                  borderRadius: 8,
                  backgroundColor: theme.colors.surface2,
                }}
              >
                <Ionicons name="call-outline" size={16} color={theme.colors.accent} />
                <View style={{ flex: 1 }}>
                  <Text style={{ color: theme.colors.text, fontWeight: '600', fontSize: 12 }}>
                    緊急聯絡人：{passport.emergencyContact.name}（
                    {passport.emergencyContact.relation}）
                  </Text>
                  <Text style={{ color: theme.colors.muted, fontSize: 11 }}>
                    {passport.emergencyContact.phone}
                  </Text>
                </View>
              </View>
            )}
          </View>
        </AnimatedCard>

        {/* 疫苗紀錄 */}
        <AnimatedCard title="疫苗接種紀錄" delay={50}>
          {passport.vaccinations && passport.vaccinations.length > 0 ? (
            <View style={{ gap: 6 }}>
              {passport.vaccinations.map((vac) => (
                <View
                  key={vac.id}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 10,
                    padding: 10,
                    borderRadius: theme.radius.md,
                    backgroundColor: theme.colors.surface2,
                  }}
                >
                  <View
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: 8,
                      backgroundColor: '#05966918',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Ionicons name="shield-checkmark" size={16} color="#059669" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: theme.colors.text, fontWeight: '600', fontSize: 12 }}>
                      {vac.vaccine}
                    </Text>
                    <Text style={{ color: theme.colors.muted, fontSize: 11 }}>
                      {vac.date} · 第 {vac.dose}/{vac.totalDoses} 劑
                    </Text>
                  </View>
                  {vac.certificate && (
                    <View
                      style={{
                        paddingHorizontal: 6,
                        paddingVertical: 2,
                        borderRadius: 4,
                        backgroundColor: '#10B98118',
                      }}
                    >
                      <Text style={{ color: '#10B981', fontSize: 9, fontWeight: '600' }}>
                        已認證
                      </Text>
                    </View>
                  )}
                </View>
              ))}
            </View>
          ) : (
            <EmptyState
              title="無接種紀錄"
              subtitle="可到衛保組登錄歷史接種"
              icon="shield-outline"
            />
          )}
        </AnimatedCard>

        {/* 可接種疫苗 */}
        <AnimatedCard title="推薦接種" subtitle="校內可預約" delay={100}>
          <View style={{ gap: 6 }}>
            {AVAILABLE_VACCINES.slice(0, 4).map((vac) => (
              <View
                key={vac.id}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 10,
                  padding: 10,
                  borderRadius: theme.radius.md,
                  backgroundColor: theme.colors.surface2,
                }}
              >
                <Ionicons name={vac.icon as any} size={16} color={vac.color} />
                <View style={{ flex: 1 }}>
                  <Text style={{ color: theme.colors.text, fontWeight: '600', fontSize: 12 }}>
                    {vac.name}
                  </Text>
                  <Text style={{ color: theme.colors.muted, fontSize: 10 }}>{vac.note}</Text>
                </View>
                <Text style={{ color: theme.colors.muted, fontSize: 10 }}>{vac.doses}劑</Text>
              </View>
            ))}
          </View>
        </AnimatedCard>

        {/* 上次健檢 */}
        <AnimatedCard title="健康檢查" delay={150}>
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 10,
              padding: 12,
              borderRadius: theme.radius.md,
              backgroundColor: theme.colors.surface2,
            }}
          >
            <Ionicons name="clipboard-outline" size={22} color={theme.colors.accent} />
            <View style={{ flex: 1 }}>
              <Text style={{ color: theme.colors.text, fontWeight: '600', fontSize: 13 }}>
                {passport.lastCheckup ? `上次健檢：${passport.lastCheckup}` : '尚無健檢紀錄'}
              </Text>
              <Text style={{ color: theme.colors.muted, fontSize: 11 }}>
                建議每學年進行一次全面健檢
              </Text>
            </View>
          </View>
        </AnimatedCard>
      </>
    );
  };

  // ═════════════════════════════════════════════════
  // renderExercise — 運動處方
  // ═════════════════════════════════════════════════

  const renderExercise = () => (
    <>
      {/* 我的運動處方 */}
      <AnimatedCard title="我的運動處方箋" subtitle="根據 BMI 和目標個人化推薦">
        {exerciseRx.length === 0 ? (
          <EmptyState title="尚未生成" subtitle="完成體適能評估後自動生成" icon="fitness-outline" />
        ) : (
          <View style={{ gap: 8 }}>
            {exerciseRx.map((rx) => (
              <View
                key={rx.id}
                style={{
                  padding: 12,
                  borderRadius: theme.radius.lg,
                  backgroundColor: theme.colors.surface2,
                }}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <View
                    style={{
                      width: 38,
                      height: 38,
                      borderRadius: 12,
                      backgroundColor: `${rx.color}15`,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Ionicons name={rx.icon as any} size={18} color={rx.color} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: theme.colors.text, fontWeight: '700', fontSize: 14 }}>
                      {rx.name}
                    </Text>
                    <Text style={{ color: theme.colors.muted, fontSize: 11 }}>
                      {rx.description}
                    </Text>
                  </View>
                </View>
                <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
                  {[
                    { label: `${rx.durationMinutes}分鐘`, icon: 'time-outline' },
                    { label: rx.frequency, icon: 'repeat-outline' },
                    { label: `~${rx.calories}kcal`, icon: 'flame-outline' },
                    { label: rx.campusLocation, icon: 'location-outline' },
                  ].map((tag, i) => (
                    <View
                      key={i}
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: 3,
                        paddingHorizontal: 6,
                        paddingVertical: 3,
                        borderRadius: 4,
                        backgroundColor: theme.colors.bg,
                      }}
                    >
                      <Ionicons name={tag.icon as any} size={10} color={theme.colors.muted} />
                      <Text style={{ color: theme.colors.muted, fontSize: 10 }}>{tag.label}</Text>
                    </View>
                  ))}
                </View>
              </View>
            ))}
          </View>
        )}
      </AnimatedCard>

      {/* 校園運動設施 */}
      <AnimatedCard title="校園運動設施" delay={50}>
        <View style={{ gap: 6 }}>
          {[
            {
              name: '體育館重訓室',
              hours: '07:00-21:00',
              icon: 'barbell-outline',
              color: '#F59E0B',
            },
            { name: '韻律教室', hours: '08:00-21:00', icon: 'body-outline', color: '#EC4899' },
            { name: '操場/跑道', hours: '06:00-22:00', icon: 'walk-outline', color: '#3B82F6' },
            { name: '籃球場', hours: '06:00-22:00', icon: 'basketball-outline', color: '#EA580C' },
            {
              name: '游泳池',
              hours: '週一三五 12:00-20:00',
              icon: 'water-outline',
              color: '#0D9488',
            },
            { name: '校園步道', hours: '全天開放', icon: 'leaf-outline', color: '#10B981' },
          ].map((facility) => (
            <View
              key={facility.name}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 10,
                padding: 10,
                borderRadius: theme.radius.md,
                backgroundColor: theme.colors.surface2,
              }}
            >
              <Ionicons name={facility.icon as any} size={18} color={facility.color} />
              <View style={{ flex: 1 }}>
                <Text style={{ color: theme.colors.text, fontWeight: '600', fontSize: 13 }}>
                  {facility.name}
                </Text>
                <Text style={{ color: theme.colors.muted, fontSize: 11 }}>{facility.hours}</Text>
              </View>
            </View>
          ))}
        </View>
      </AnimatedCard>

      {/* 運動小知識 */}
      <AnimatedCard title="運動小知識" delay={100}>
        <View style={{ gap: 6 }}>
          {[
            '每週 150 分鐘中等強度運動可降低慢性病風險',
            '運動後 30 分鐘內補充蛋白質有助肌肉修復',
            '久坐每 50 分鐘起身活動 5-10 分鐘',
            '規律運動可改善情緒、提升睡眠品質',
          ].map((tip, i) => (
            <View
              key={i}
              style={{
                flexDirection: 'row',
                gap: 8,
                padding: 8,
                borderRadius: 6,
                backgroundColor: theme.colors.surface2,
              }}
            >
              <Ionicons name="bulb-outline" size={14} color="#F59E0B" style={{ marginTop: 1 }} />
              <Text style={{ color: theme.colors.text, fontSize: 12, flex: 1, lineHeight: 18 }}>
                {tip}
              </Text>
            </View>
          ))}
        </View>
      </AnimatedCard>
    </>
  );

  // ═════════════════════════════════════════════════
  // renderEmergency — 急救
  // ═════════════════════════════════════════════════

  const renderEmergency = () => (
    <>
      {/* 緊急電話 */}
      <AnimatedCard title="緊急電話" subtitle="一鍵撥號">
        <View style={{ gap: 8 }}>
          {EMERGENCY_NUMBERS.map((num) => (
            <Pressable
              key={num.name}
              onPress={() => handleCall(num.phone)}
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                gap: 10,
                padding: 12,
                borderRadius: theme.radius.md,
                backgroundColor: pressed ? `${num.color}20` : theme.colors.surface2,
              })}
            >
              <View
                style={{
                  width: 38,
                  height: 38,
                  borderRadius: 19,
                  backgroundColor: `${num.color}15`,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Ionicons name={num.icon as any} size={18} color={num.color} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: theme.colors.text, fontWeight: '600', fontSize: 13 }}>
                  {num.name}
                </Text>
                <Text style={{ color: theme.colors.muted, fontSize: 11 }}>{num.available}</Text>
              </View>
              <Text style={{ color: num.color, fontWeight: '700', fontSize: 14 }}>{num.phone}</Text>
              <Ionicons name="call" size={18} color={num.color} />
            </Pressable>
          ))}
        </View>
      </AnimatedCard>

      {/* AED 位置 */}
      <AnimatedCard
        title="AED 自動體外電擊器"
        subtitle={`校內 ${AED_LOCATIONS.length} 台`}
        delay={50}
      >
        <View style={{ gap: 6 }}>
          {AED_LOCATIONS.map((aed) => (
            <View
              key={aed.id}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 10,
                padding: 10,
                borderRadius: theme.radius.md,
                backgroundColor: theme.colors.surface2,
              }}
            >
              <View
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 8,
                  backgroundColor: aed.status === 'available' ? '#10B98115' : '#EF444415',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Ionicons
                  name="pulse"
                  size={16}
                  color={aed.status === 'available' ? '#10B981' : '#EF4444'}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: theme.colors.text, fontWeight: '600', fontSize: 12 }}>
                  {aed.name}
                </Text>
                <Text style={{ color: theme.colors.muted, fontSize: 10 }}>{aed.exactLocation}</Text>
              </View>
              <View
                style={{
                  paddingHorizontal: 6,
                  paddingVertical: 2,
                  borderRadius: 4,
                  backgroundColor: '#10B98115',
                }}
              >
                <Text style={{ color: '#10B981', fontSize: 9, fontWeight: '600' }}>可用</Text>
              </View>
            </View>
          ))}
        </View>
      </AnimatedCard>

      {/* CPR 急救步驟 */}
      <AnimatedCard title="急救步驟" subtitle="黃金 4 分鐘" delay={100}>
        <View style={{ gap: 6 }}>
          {[
            { step: '1', text: '確認環境安全，評估意識', icon: 'eye-outline', color: '#3B82F6' },
            { step: '2', text: '呼叫 119 + 請人取 AED', icon: 'call-outline', color: '#EF4444' },
            { step: '3', text: '壓額抬下巴，檢查呼吸', icon: 'body-outline', color: '#F59E0B' },
            {
              step: '4',
              text: '胸外按壓 30 下（5-6cm 深）',
              icon: 'hand-left-outline',
              color: '#DC2626',
            },
            {
              step: '5',
              text: '人工呼吸 2 次（30:2 循環）',
              icon: 'pulse-outline',
              color: '#7C3AED',
            },
            { step: '6', text: 'AED 到達後立即使用', icon: 'flash-outline', color: '#059669' },
          ].map((s) => (
            <View
              key={s.step}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 10,
                padding: 10,
                borderRadius: theme.radius.md,
                backgroundColor: theme.colors.surface2,
              }}
            >
              <View
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: 14,
                  backgroundColor: `${s.color}15`,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Text style={{ color: s.color, fontWeight: '800', fontSize: 12 }}>{s.step}</Text>
              </View>
              <Ionicons name={s.icon as any} size={16} color={s.color} />
              <Text style={{ color: theme.colors.text, fontSize: 12, flex: 1 }}>{s.text}</Text>
            </View>
          ))}
        </View>
      </AnimatedCard>

      {/* 注意事項 */}
      <AnimatedCard title="急救注意" delay={150}>
        <View style={{ gap: 6 }}>
          {[
            '不隨意移動傷患（除非環境不安全）',
            '保持傷患呼吸道暢通',
            '大量出血時直接加壓止血',
            '記錄事發時間和經過，告知救護人員',
            '不要給意識不清者喝水或吃東西',
          ].map((note, i) => (
            <View key={i} style={{ flexDirection: 'row', gap: 6, padding: 6 }}>
              <Ionicons
                name="alert-circle-outline"
                size={14}
                color="#F59E0B"
                style={{ marginTop: 1 }}
              />
              <Text style={{ color: theme.colors.text, fontSize: 12, flex: 1 }}>{note}</Text>
            </View>
          ))}
        </View>
      </AnimatedCard>
    </>
  );

  // ═════════════════════════════════════════════════
  // Main Render
  // ═════════════════════════════════════════════════

  return (
    <Screen>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ gap: 12, paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={theme.colors.accent}
          />
        }
      >
        {/* Header */}
        <AnimatedCard title="校園健康" subtitle="AI 全人健康生態圈">
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <View style={{ flex: 1 }}>
              <Button text="症狀自評" kind="primary" onPress={() => setTab('clinic')} />
            </View>
            <View style={{ flex: 1 }}>
              <Button text="緊急求助" onPress={() => setTab('emergency')} />
            </View>
          </View>
        </AnimatedCard>

        {/* Tab Bar */}
        <SegmentedControl options={TABS} selected={tab} onChange={(k) => setTab(k as HealthTab)} />

        {/* Tab Content */}
        {tab === 'home' && renderHome()}
        {tab === 'clinic' && renderClinic()}
        {tab === 'mental' && renderMental()}
        {tab === 'passport' && renderPassport()}
        {tab === 'exercise' && renderExercise()}
        {tab === 'emergency' && renderEmergency()}
      </ScrollView>
    </Screen>
  );
}
