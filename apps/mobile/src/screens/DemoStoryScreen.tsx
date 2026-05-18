/* eslint-disable */
/**
 * Demo Story — 「今天的一天」全螢幕 timeline
 *
 * 為了讓評審/demo viewer 看出個 demo 帳號的真實生活軌跡，
 * 把 persona 全天事件依時間軸排列：
 *   - 學生顧晉瑋：起床 → 早餐 → 搭校園 A 線 → 第一堂課 → 圖書館 → 第二堂課 → 球場 → 晚餐 → 回宿舍
 *   - 老師張怡君：開車到校 → 辦公室準備 → 上課 → 批改 → 辦公時間 → 系務會議 → 下班
 *   - TA / 主任 / 餐廳員工 各自有獨立 timeline
 *
 * 每個事件可點擊跳轉到對應的功能畫面（讓 demo viewer 看到完整串接）。
 */

import React, { useCallback, useMemo, useState } from 'react';
import {
  ScrollView,
  View,
  Text,
  Pressable,
  StyleSheet,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { Screen } from '../ui/components';
import { TAB_BAR_CONTENT_BOTTOM_PADDING } from '../ui/navigationTheme';
import { theme, softShadowStyle } from '../ui/theme';
import { analytics } from '../services/analytics';
import { usePersonaContext, type TimelineEvent } from '../services/personaContext';

const CATEGORY_COLOR: Record<TimelineEvent['category'], string> = {
  wake: '#FF9500',
  bus: '#007AFF',
  class: '#AF52DE',
  food: '#FF3B30',
  study: '#06B6D4',
  office: '#64748B',
  work: '#0EA5E9',
  home: '#22C55E',
  social: '#FF2D55',
  health: '#34D399',
};

const CATEGORY_LABEL: Record<TimelineEvent['category'], string> = {
  wake: '起床',
  bus: '通勤',
  class: '上課',
  food: '用餐',
  study: '自習',
  office: '辦公',
  work: '工作',
  home: '回家',
  social: '社團',
  health: '運動',
};

export function DemoStoryScreen(_props: Record<string, unknown>) {
  const nav = useNavigation<any>();
  const persona = usePersonaContext();
  const [now] = useState<Date>(new Date());

  useFocusEffect(
    useCallback(() => {
      analytics.logScreenView('DemoStory');
    }, []),
  );

  const events = persona.todayTimeline;
  const doneCount = events.filter((e) => e.done).length;
  const upcomingCount = events.length - doneCount;
  const nextEvent = events.find((e) => !e.done);

  // 分類統計（顯示在 header）
  const categoryStats = useMemo(() => {
    const m = new Map<TimelineEvent['category'], number>();
    for (const e of events) {
      m.set(e.category, (m.get(e.category) ?? 0) + 1);
    }
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1]).slice(0, 5);
  }, [events]);

  const handleEventPress = useCallback(
    (e: TimelineEvent) => {
      if (!e.link) return;
      analytics.logEvent('demostory_event_tap', { eventId: e.id, screen: e.link.screen });
      try {
        nav.navigate(e.link.screen, e.link.params);
      } catch (err) {
        console.warn('[DemoStory] navigate failed', err);
      }
    },
    [nav],
  );

  if (!persona.story) {
    return (
      <Screen>
        <View style={{ alignItems: 'center', paddingTop: 80 }}>
          <Ionicons name="information-circle-outline" size={48} color={theme.colors.muted} />
          <Text style={{ color: theme.colors.text, fontSize: 16, fontWeight: '700', marginTop: 12 }}>
            僅 demo 帳號可用
          </Text>
          <Text style={{ color: theme.colors.muted, fontSize: 13, marginTop: 6, textAlign: 'center', paddingHorizontal: 32 }}>
            「今天的故事」會依登入的 demo 角色顯示客製化時程。請登入 demo 帳號後再試。
          </Text>
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING + 32 }}
      >
        {/* Hero */}
        <View
          style={{
            margin: 12,
            padding: 18,
            borderRadius: 22,
            backgroundColor: theme.colors.accent,
            ...softShadowStyle(theme.shadows.md),
          }}
        >
          <Text style={{ color: 'rgba(255,255,255,0.85)', fontSize: 11, fontWeight: '700', letterSpacing: 3 }}>
            今天的一天 · {now.getMonth() + 1}/{now.getDate()} ({['日', '一', '二', '三', '四', '五', '六'][now.getDay()]})
          </Text>
          <Text style={{ color: '#fff', fontSize: 24, fontWeight: '900', marginTop: 4 }}>
            {persona.displayName} 的校園動態
          </Text>
          <Text style={{ color: 'rgba(255,255,255,0.85)', fontSize: 13, marginTop: 4 }}>
            {persona.story.department}
            {persona.story.dorm
              ? ` · 住 ${persona.story.dorm.building} ${persona.story.dorm.room}`
              : persona.story.office
                ? ` · 辦公室 ${persona.story.office.building} ${persona.story.office.room}`
                : ''}
          </Text>

          <View style={{ flexDirection: 'row', gap: 10, marginTop: 14 }}>
            <HeroStat label="今日事件" value={`${events.length}`} />
            <HeroStat label="已完成" value={`${doneCount}`} />
            <HeroStat label="待進行" value={`${upcomingCount}`} highlight />
          </View>

          {nextEvent && (
            <View
              style={{
                marginTop: 14,
                padding: 12,
                backgroundColor: 'rgba(255,255,255,0.16)',
                borderRadius: 14,
              }}
            >
              <Text style={{ color: 'rgba(255,255,255,0.85)', fontSize: 11, fontWeight: '700', letterSpacing: 2 }}>
                下一個 · {nextEvent.hhmm}
              </Text>
              <Text style={{ color: '#fff', fontSize: 16, fontWeight: '800', marginTop: 4 }}>
                {nextEvent.title}
              </Text>
              {!!nextEvent.detail && (
                <Text style={{ color: 'rgba(255,255,255,0.85)', fontSize: 12, marginTop: 2 }}>
                  {nextEvent.detail}
                </Text>
              )}
            </View>
          )}
        </View>

        {/* Category chips */}
        {categoryStats.length > 0 && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: 12, gap: 6 }}
            style={{ marginBottom: 4 }}
          >
            {categoryStats.map(([cat, count]) => (
              <View
                key={cat}
                style={{
                  paddingHorizontal: 10,
                  paddingVertical: 5,
                  borderRadius: 99,
                  backgroundColor: `${CATEGORY_COLOR[cat]}22`,
                  borderWidth: 1,
                  borderColor: `${CATEGORY_COLOR[cat]}55`,
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 4,
                }}
              >
                <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: CATEGORY_COLOR[cat] }} />
                <Text style={{ color: CATEGORY_COLOR[cat], fontSize: 11, fontWeight: '700' }}>
                  {CATEGORY_LABEL[cat]} {count}
                </Text>
              </View>
            ))}
          </ScrollView>
        )}

        {/* 快捷跳板 — 一鍵體驗新地圖+公車功能（依 persona 客製） */}
        <View style={{ marginHorizontal: 12, marginTop: 12 }}>
          <Text
            style={{
              color: theme.colors.muted,
              fontSize: 10,
              fontWeight: '700',
              letterSpacing: 2,
              textTransform: 'uppercase',
              marginBottom: 6,
              marginLeft: 4,
            }}
          >
            為 {persona.displayName} 預備
          </Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
            {persona.nextClass && (
              <PersonaShortcut
                icon="school-outline"
                color="#AF52DE"
                title="去下節課"
                subtitle={`${persona.nextClass.startHHmm} · ${persona.nextClass.poi.name} ${persona.nextClass.roomCode}`}
                onPress={() =>
                  nav.navigate('TripPlanner', {
                    toPoiId: persona.nextClass!.poi.id,
                    toName: persona.nextClass!.poi.name,
                  })
                }
              />
            )}
            {persona.subscribedRoutes[0] && (
              <PersonaShortcut
                icon="bus-outline"
                color="#007AFF"
                title="即時公車"
                subtitle={`常搭 ${persona.subscribedRoutes[0].shortName}`}
                onPress={() =>
                  nav.navigate('BusV2', { initialRouteId: persona.subscribedRoutes[0].id })
                }
              />
            )}
            {persona.nextClass && (
              <PersonaShortcut
                icon="business-outline"
                color="#34C759"
                title="教室平面圖"
                subtitle={`找 ${persona.nextClass.roomCode}`}
                onPress={() =>
                  nav.navigate('IndoorFloorMap', {
                    poiId: persona.nextClass!.poi.id,
                    roomCode: persona.nextClass!.roomCode,
                  })
                }
              />
            )}
            <PersonaShortcut
              icon="map-outline"
              color="#FF9500"
              title="校園地圖"
              subtitle="多圖層 · POI · AR"
              onPress={() => nav.navigate('MapV2')}
            />
          </ScrollView>
        </View>

        {/* Timeline */}
        <View style={{ paddingHorizontal: 12, marginTop: 12 }}>
          {events.map((e, idx) => {
            const isLast = idx === events.length - 1;
            const color = CATEGORY_COLOR[e.category];
            const isNext = !e.done && events.slice(0, idx).every((p) => p.done);

            return (
              <View key={e.id} style={{ flexDirection: 'row', gap: 12 }}>
                {/* Left rail */}
                <View style={{ alignItems: 'center', width: 56 }}>
                  <Text
                    style={{
                      color: e.done ? theme.colors.muted : theme.colors.text,
                      fontWeight: isNext ? '900' : '700',
                      fontSize: isNext ? 15 : 13,
                      marginTop: 8,
                    }}
                  >
                    {e.hhmm}
                  </Text>
                  <View
                    style={{
                      width: 18,
                      height: 18,
                      borderRadius: 9,
                      backgroundColor: e.done ? color : isNext ? color : `${color}40`,
                      borderWidth: 3,
                      borderColor: isNext ? '#fff' : 'transparent',
                      marginTop: 4,
                      ...(isNext
                        ? {
                            shadowColor: color,
                            shadowOpacity: 0.6,
                            shadowRadius: 8,
                            shadowOffset: { width: 0, height: 0 },
                          }
                        : {}),
                    }}
                  />
                  {!isLast && (
                    <View
                      style={{
                        flex: 1,
                        width: 2,
                        backgroundColor: e.done ? `${color}80` : theme.colors.border,
                        marginVertical: 4,
                      }}
                    />
                  )}
                </View>

                {/* Card */}
                <View style={{ flex: 1, marginBottom: isLast ? 12 : 16 }}>
                  <Pressable
                    onPress={() => handleEventPress(e)}
                    disabled={!e.link}
                    style={({ pressed }) => ({
                      backgroundColor: pressed
                        ? theme.colors.surface2
                        : isNext
                          ? `${color}14`
                          : theme.colors.surface,
                      borderRadius: 14,
                      padding: 12,
                      borderWidth: 1,
                      borderColor: isNext ? color : theme.colors.border,
                      borderLeftWidth: 4,
                      borderLeftColor: color,
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 10,
                      opacity: e.done ? 0.65 : 1,
                    })}
                  >
                    <View
                      style={{
                        width: 38,
                        height: 38,
                        borderRadius: 12,
                        backgroundColor: `${color}22`,
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <Ionicons name={e.icon as any} size={18} color={color} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <Text
                          style={{
                            color: theme.colors.text,
                            fontWeight: '800',
                            fontSize: 14,
                            textDecorationLine: e.done ? 'line-through' : 'none',
                          }}
                        >
                          {e.title}
                        </Text>
                        {isNext && (
                          <View
                            style={{
                              paddingHorizontal: 6,
                              paddingVertical: 1,
                              borderRadius: 4,
                              backgroundColor: color,
                            }}
                          >
                            <Text style={{ color: '#fff', fontSize: 9, fontWeight: '800' }}>
                              下一個
                            </Text>
                          </View>
                        )}
                      </View>
                      {!!e.detail && (
                        <Text
                          style={{
                            color: theme.colors.muted,
                            fontSize: 11,
                            marginTop: 2,
                            lineHeight: 16,
                          }}
                        >
                          {e.detail}
                        </Text>
                      )}
                    </View>
                    {e.link && (
                      <Ionicons name="arrow-forward-circle" size={20} color={color} />
                    )}
                  </Pressable>
                </View>
              </View>
            );
          })}
        </View>

        {/* Footer note */}
        <View
          style={{
            margin: 12,
            padding: 14,
            backgroundColor: theme.colors.surface,
            borderRadius: 14,
            borderWidth: 1,
            borderColor: theme.colors.border,
            flexDirection: 'row',
            gap: 12,
            alignItems: 'flex-start',
          }}
        >
          <Ionicons name="information-circle-outline" size={20} color={theme.colors.accent} />
          <Text style={{ color: theme.colors.muted, fontSize: 12, flex: 1, lineHeight: 18 }}>
            這是 <Text style={{ color: theme.colors.text, fontWeight: '700' }}>{persona.displayName}</Text> 的個人時程。
            切換到其他 demo 角色，這個畫面會顯示完全不同的故事。
            點擊任何事件可跳到對應的功能畫面，串起完整 demo 動線。
          </Text>
        </View>
      </ScrollView>
    </Screen>
  );
}

function PersonaShortcut({
  icon,
  color,
  title,
  subtitle,
  onPress,
}: {
  icon: any;
  color: string;
  title: string;
  subtitle: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        width: 168,
        padding: 12,
        borderRadius: 14,
        backgroundColor: theme.colors.surface,
        borderWidth: 1,
        borderColor: theme.colors.border,
        borderLeftWidth: 4,
        borderLeftColor: color,
        opacity: pressed ? 0.88 : 1,
      })}
    >
      <View
        style={{
          width: 32,
          height: 32,
          borderRadius: 10,
          backgroundColor: `${color}22`,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Ionicons name={icon} size={16} color={color} />
      </View>
      <Text style={{ color: theme.colors.text, fontWeight: '800', fontSize: 13, marginTop: 8 }}>
        {title}
      </Text>
      <Text style={{ color: theme.colors.muted, fontSize: 11, marginTop: 2 }} numberOfLines={2}>
        {subtitle}
      </Text>
    </Pressable>
  );
}

function HeroStat({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <View
      style={{
        flex: 1,
        padding: 10,
        borderRadius: 12,
        backgroundColor: highlight ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.08)',
        borderWidth: highlight ? 1 : 0,
        borderColor: 'rgba(255,255,255,0.3)',
      }}
    >
      <Text style={{ color: 'rgba(255,255,255,0.7)', fontSize: 10, fontWeight: '700', letterSpacing: 1 }}>
        {label.toUpperCase()}
      </Text>
      <Text style={{ color: '#fff', fontSize: 22, fontWeight: '900', marginTop: 2 }}>{value}</Text>
    </View>
  );
}

export default DemoStoryScreen;
