/* eslint-disable @typescript-eslint/no-unused-vars */
import React, { useMemo, useState, useCallback } from 'react';
import {
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  TextInput,
  View,
  LayoutAnimation,
  Platform,
  UIManager,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { BusRoute, MenuItem, Poi } from '../data';
import { useAsyncList } from '../hooks/useAsyncList';
import { useDataSource } from '../hooks/useDataSource';
import { isFeatureEnabled } from '../services/release';
import { useAuth } from '../state/auth';
import { useSchool } from '../state/school';
import { useAmbientCues } from '../features/engagement';
import { TAB_BAR_CONTENT_BOTTOM_PADDING } from '../ui/navigationTheme';
import { AmbientCueCard } from '../ui/campusOs';
import { shadowStyle, theme } from '../ui/theme';
import { navigateToCourseScreen, migrateTabName } from '../utils/courseNavigation';
import { aiOverlay } from '../app/useAIOverlay';
import { HeaderAvatarButton } from '../components/HeaderAvatarButton';

// Enable LayoutAnimation on Android
if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

// ═══════════════════════════════════════════════════════════
// Service tile types
// ═══════════════════════════════════════════════════════════

interface ServiceItem {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  tint: string;
  /** Same-stack screen name, OR cross-tab navigation config */
  screen?: string;
  /** For cross-tab navigation: { tab: 'Today', screen: 'AIChat' } */
  crossTab?: { tab: string; screen: string };
  /** Search keywords (for filtering) */
  keywords?: string[];
}

interface ServiceSection {
  title: string;
  emoji: string;
  items: ServiceItem[];
}

// ═══════════════════════════════════════════════════════════
// Service Tile Component
// ═══════════════════════════════════════════════════════════

function ServiceTile(props: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  tint: string;
  highlight?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={props.onPress}
      style={({ pressed }) => ({
        flex: 1,
        paddingVertical: theme.space.md,
        paddingHorizontal: theme.space.xs,
        borderRadius: theme.radius.lg,
        backgroundColor: props.highlight ? `${props.tint}12` : theme.colors.surface,
        borderWidth: 1,
        borderColor: props.highlight ? `${props.tint}30` : theme.colors.border,
        alignItems: 'center',
        gap: theme.space.sm,
        minWidth: 72,
        opacity: pressed ? 0.82 : 1,
        transform: [{ scale: pressed ? 0.96 : 1 }],
        ...shadowStyle(theme.shadows.sm),
      })}
    >
      <View
        style={{
          width: 40,
          height: 40,
          borderRadius: 14,
          backgroundColor: `${props.tint}18`,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Ionicons name={props.icon} size={20} color={props.tint} />
      </View>
      <Text
        style={{
          color: props.highlight ? props.tint : theme.colors.text,
          fontSize: 12,
          fontWeight: props.highlight ? '800' : '600',
          textAlign: 'center',
        }}
        numberOfLines={2}
      >
        {props.label}
      </Text>
    </Pressable>
  );
}

// ═══════════════════════════════════════════════════════════
// Section Header Component
// ═══════════════════════════════════════════════════════════

function SectionHeader(props: { emoji: string; title: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 2 }}>
      <Text style={{ fontSize: 15 }}>{props.emoji}</Text>
      <Text
        style={{
          color: theme.colors.text,
          fontSize: 15,
          fontWeight: '700',
          letterSpacing: 0.3,
        }}
      >
        {props.title}
      </Text>
    </View>
  );
}

// ═══════════════════════════════════════════════════════════
// Search Bar Component
// ═══════════════════════════════════════════════════════════

function SearchBar(props: {
  value: string;
  onChangeText: (t: string) => void;
  onAIPress: () => void;
}) {
  return (
    <View style={{ flexDirection: 'row', gap: theme.space.sm, alignItems: 'center' }}>
      <View
        style={{
          flex: 1,
          flexDirection: 'row',
          alignItems: 'center',
          backgroundColor: theme.colors.surface,
          borderRadius: theme.radius.lg,
          borderWidth: 1,
          borderColor: theme.colors.border,
          paddingHorizontal: theme.space.md,
          height: 42,
          gap: theme.space.sm,
        }}
      >
        <Ionicons name="search" size={17} color={theme.colors.muted} />
        <TextInput
          value={props.value}
          onChangeText={props.onChangeText}
          placeholder="搜尋服務、地點、功能..."
          placeholderTextColor={theme.colors.muted}
          style={{
            flex: 1,
            color: theme.colors.text,
            fontSize: 14,
            paddingVertical: 0,
          }}
          returnKeyType="search"
        />
        {props.value.length > 0 && (
          <Pressable onPress={() => props.onChangeText('')}>
            <Ionicons name="close-circle" size={17} color={theme.colors.muted} />
          </Pressable>
        )}
      </View>
      <Pressable
        onPress={props.onAIPress}
        style={({ pressed }) => ({
          width: 42,
          height: 42,
          borderRadius: theme.radius.lg,
          backgroundColor: theme.colors.accent,
          alignItems: 'center',
          justifyContent: 'center',
          opacity: pressed ? 0.8 : 1,
          transform: [{ scale: pressed ? 0.94 : 1 }],
          ...shadowStyle(theme.shadows.md),
        })}
      >
        <Ionicons name="sparkles" size={20} color="#fff" />
      </Pressable>
    </View>
  );
}

// ═══════════════════════════════════════════════════════════
// Map Card (compact version)
// ═══════════════════════════════════════════════════════════

function CompactMapCard(props: { onPress: () => void; onARPress: () => void }) {
  return (
    <Pressable
      onPress={props.onPress}
      style={({ pressed }) => ({
        borderRadius: theme.radius.xl,
        overflow: 'hidden',
        opacity: pressed ? 0.9 : 1,
        ...shadowStyle(theme.shadows.md),
      })}
    >
      <View
        style={{
          height: 100,
          backgroundColor: theme.mode === 'dark' ? '#1A2A3A' : '#E8F4FD',
          justifyContent: 'center',
          alignItems: 'center',
          borderWidth: 1,
          borderColor: theme.colors.border,
          borderRadius: theme.radius.xl,
          flexDirection: 'row',
          gap: theme.space.md,
        }}
      >
        <View style={{ flexDirection: 'row', gap: 12, opacity: 0.25 }}>
          {[0, 1, 2].map((i) => (
            <View
              key={i}
              style={{
                width: 40 + i * 14,
                height: 28 + i * 8,
                borderRadius: 6,
                backgroundColor: theme.colors.accent,
              }}
            />
          ))}
        </View>
        <View style={{ alignItems: 'center', gap: 4 }}>
          <View
            style={{
              width: 36,
              height: 36,
              borderRadius: 18,
              backgroundColor: theme.colors.accent,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Ionicons name="navigate" size={18} color="#fff" />
          </View>
          <Text style={{ color: theme.colors.text, fontSize: 13, fontWeight: '700' }}>
            校園地圖
          </Text>
        </View>
      </View>

      <Pressable
        onPress={props.onARPress}
        style={({ pressed }) => ({
          position: 'absolute',
          bottom: theme.space.sm,
          right: theme.space.sm,
          flexDirection: 'row',
          alignItems: 'center',
          gap: theme.space.xs,
          paddingHorizontal: theme.space.sm,
          paddingVertical: 5,
          borderRadius: theme.radius.full,
          backgroundColor: theme.colors.surface,
          borderWidth: 1,
          borderColor: theme.colors.border,
          opacity: pressed ? 0.8 : 1,
          ...shadowStyle(theme.shadows.sm),
        })}
      >
        <Ionicons name="glasses-outline" size={14} color={theme.colors.accent} />
        <Text style={{ color: theme.colors.accent, fontSize: 11, fontWeight: '700' }}>AR</Text>
      </Pressable>
    </Pressable>
  );
}

// ═══════════════════════════════════════════════════════════
// Main Screen
// ═══════════════════════════════════════════════════════════

export function CampusHubScreen(props: Record<string, unknown>) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const nav = props?.navigation as any;
  const insets = useSafeAreaInsets();
  const auth = useAuth();
  const { school } = useSchool();
  const ds = useDataSource();
  const paymentsEnabled = isFeatureEnabled('payments');

  const [searchQuery, setSearchQuery] = useState('');

  const {
    items: pois,
    refreshing,
    refresh,
  } = useAsyncList<Poi>(async () => (await ds.listPois(school.id)).slice(0, 5), [ds, school.id]);

  const { items: routes } = useAsyncList<BusRoute>(
    async () => ds.listBusRoutes(school.id),
    [ds, school.id],
  );

  const { items: menus } = useAsyncList<MenuItem>(
    async () => (await ds.listMenus(school.id)).slice(0, 3),
    [ds, school.id],
  );

  const {
    cue: ambientCue,
    dismissCue: dismissAmbientCue,
    openCue: openAmbientCue,
  } = useAmbientCues({
    schoolId: school.id,
    uid: auth.user?.uid ?? null,
    role: 'student',
    surface: 'campus',
    limit: 1,
  });

  // ═══════════════════════════════════════════════════════
  // 9 個實體校園服務磚（精簡版，3x3 格）
  // 設計原則：只放「實體位置/物理服務」；抽象功能交給 AI 球
  // ═══════════════════════════════════════════════════════

  const serviceSections: ServiceSection[] = useMemo(
    () => [
      {
        title: '師生連結',
        emoji: '💬',
        items: [
          {
            icon: 'people-circle-outline',
            label: '校園社群',
            tint: theme.colors.social,
            crossTab: { tab: 'Today', screen: 'CampusSocialScreen' },
            keywords: ['社群', '看板', '動態', '匿名', '學伴', '即時', 'story', '發文'],
          },
        ],
      },
      {
        title: '校園服務',
        emoji: '🏫',
        items: [
          {
            icon: 'restaurant-outline',
            label: '餐廳',
            tint: theme.colors.achievement,
            screen: '餐廳總覽',
            keywords: ['餐廳', '吃', '食堂', '餐飲', '菜單', '點餐'],
          },
          {
            icon: 'library-outline',
            label: '圖書館',
            tint: theme.colors.calm,
            screen: 'Library',
            keywords: ['圖書館', '借書', '還書', '自習', '蓋夏'],
          },
          {
            icon: 'home-outline',
            label: '宿舍',
            tint: theme.colors.growth,
            screen: 'Dormitory',
            keywords: ['宿舍', '住宿', '寢室', '報修'],
          },
          {
            icon: 'bus-outline',
            label: '交通',
            tint: '#3b82f6',
            screen: 'TransportHub',
            keywords: ['交通', '公車', '搭車', '車站', '高鐵'],
          },
          {
            icon: 'print-outline',
            label: '列印',
            tint: theme.colors.social,
            screen: 'PrintService',
            keywords: ['列印', '印表機', '影印', '掃描'],
          },
          {
            icon: 'heart-outline',
            label: '健康',
            tint: theme.colors.danger,
            screen: 'Health',
            keywords: ['健康', '醫療', '診所', '保健'],
          },
          {
            icon: 'search-circle-outline',
            label: '失物招領',
            tint: theme.colors.warning,
            screen: 'LostFound',
            keywords: ['失物', '招領', '撿到', '遺失'],
          },
          {
            icon: 'accessibility-outline',
            label: '無障礙路線',
            tint: '#0ea5e9',
            screen: 'AccessibleRoute',
            keywords: ['無障礙', '輪椅', '電梯', '坡道'],
          },
          ...(paymentsEnabled
            ? [
                {
                  icon: 'card-outline' as keyof typeof Ionicons.glyphMap,
                  label: '校園支付',
                  tint: theme.colors.streak,
                  screen: 'Payment',
                  keywords: ['付款', '支付', '繳費', '儲值'],
                },
              ]
            : [
                {
                  icon: 'navigate-circle-outline' as keyof typeof Ionicons.glyphMap,
                  label: 'AR 導航',
                  tint: theme.colors.accent,
                  screen: 'ARNavigation',
                  keywords: ['ar', '導航', '擴增實境'],
                },
              ]),
        ],
      },
    ],
    [paymentsEnabled],
  );

  // ═══════════════════════════════════════════════════════
  // Search filter
  // ═══════════════════════════════════════════════════════

  const filteredSections = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return serviceSections;

    const result: ServiceSection[] = [];
    for (const section of serviceSections) {
      const matchedItems = section.items.filter(
        (item) =>
          item.label.toLowerCase().includes(q) || (item.keywords ?? []).some((k) => k.includes(q)),
      );
      if (matchedItems.length > 0) {
        result.push({ ...section, items: matchedItems });
      }
    }
    return result;
  }, [searchQuery, serviceSections]);

  // ═══════════════════════════════════════════════════════
  // Navigation handler
  // ═══════════════════════════════════════════════════════

  const handleServicePress = useCallback(
    (item: ServiceItem) => {
      if (item.crossTab) {
        if (
          item.crossTab.tab === '課程' ||
          item.crossTab.tab === '教學' ||
          item.crossTab.tab === '學習'
        ) {
          navigateToCourseScreen(nav, auth.profile?.role, item.crossTab.screen);
          return;
        }
        // 自動將舊 Tab 名稱遷移到新導航
        const tab = migrateTabName(item.crossTab.tab);
        nav?.navigate?.(tab, { screen: item.crossTab.screen });
      } else if (item.screen) {
        nav?.navigate?.(item.screen);
      }
    },
    [auth.profile?.role, nav],
  );

  const handleAIPress = useCallback(() => {
    aiOverlay.open({ mode: 'chat', source: 'campus_hub' });
  }, []);

  // ═══════════════════════════════════════════════════════
  // Render
  // ═══════════════════════════════════════════════════════

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.bg }}>
      <ScrollView
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={refresh}
            tintColor={theme.colors.accent}
            colors={[theme.colors.accent]}
          />
        }
        contentContainerStyle={{
          paddingTop: insets.top + theme.space.md,
          paddingHorizontal: theme.space.lg,
          paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING + theme.space.lg,
          gap: theme.space.lg,
        }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* ── Header ── */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space.md }}>
          <HeaderAvatarButton />
          <View style={{ flex: 1, gap: theme.space.xs }}>
            <Text
              style={{
                color: theme.colors.muted,
                fontSize: theme.typography.overline.fontSize,
                fontWeight: theme.typography.overline.fontWeight ?? '700',
                letterSpacing: theme.typography.overline.letterSpacing ?? 1.5,
                textTransform: 'uppercase',
              }}
            >
              {school.name}
            </Text>
            <Text
              style={{
                color: theme.colors.text,
                fontSize: theme.typography.display.fontSize,
                fontWeight: theme.typography.display.fontWeight ?? '800',
                letterSpacing: theme.typography.display.letterSpacing,
              }}
            >
              校園
            </Text>
          </View>
        </View>

        {/* ── Search Bar + AI Button ── */}
        <SearchBar
          value={searchQuery}
          onChangeText={(t) => {
            LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
            setSearchQuery(t);
          }}
          onAIPress={handleAIPress}
        />

        {/* ── Ambient Cue (活動通知) ── */}
        {ambientCue && !searchQuery ? (
          <AmbientCueCard
            signalType={ambientCue.signalType}
            headline={ambientCue.headline}
            body={ambientCue.body}
            metric={ambientCue.metric}
            actionLabel={ambientCue.ctaLabel}
            onPress={() => openAmbientCue(ambientCue, nav)}
            onDismiss={() => {
              void dismissAmbientCue(ambientCue);
            }}
          />
        ) : null}

        {/* ── Map Card (hide when searching) ── */}
        {!searchQuery ? (
          <CompactMapCard
            onPress={() => nav?.navigate?.('Map')}
            onARPress={() => nav?.navigate?.('ARNavigation', { destinationId: 'entrance' })}
          />
        ) : null}

        {/* ── Service Sections ── */}
        {filteredSections.map((section) => (
          <View key={section.title} style={{ gap: theme.space.md }}>
            <SectionHeader emoji={section.emoji} title={section.title} />
            {/* Render rows of 4 */}
            {Array.from({ length: Math.ceil(section.items.length / 4) }, (_, rowIdx) => (
              <View key={rowIdx} style={{ flexDirection: 'row', gap: theme.space.sm }}>
                {section.items.slice(rowIdx * 4, rowIdx * 4 + 4).map((item) => (
                  <ServiceTile
                    key={item.label}
                    icon={item.icon}
                    label={item.label}
                    tint={item.tint}
                    highlight={section.title === '快捷入口' && item.label === 'AI 助理'}
                    onPress={() => handleServicePress(item)}
                  />
                ))}
                {/* Fill empty slots to keep grid alignment */}
                {section.items.slice(rowIdx * 4, rowIdx * 4 + 4).length < 4 &&
                  Array.from(
                    { length: 4 - section.items.slice(rowIdx * 4, rowIdx * 4 + 4).length },
                    (_, i) => <View key={`empty-${i}`} style={{ flex: 1, minWidth: 72 }} />,
                  )}
              </View>
            ))}
          </View>
        ))}

        {/* ── Empty search state ── */}
        {searchQuery && filteredSections.length === 0 && (
          <View style={{ alignItems: 'center', paddingVertical: 40, gap: theme.space.md }}>
            <Ionicons name="search-outline" size={48} color={theme.colors.muted} />
            <Text style={{ color: theme.colors.muted, fontSize: 15, textAlign: 'center' }}>
              找不到「{searchQuery}」相關的服務
            </Text>
            <Pressable onPress={handleAIPress}>
              <Text style={{ color: theme.colors.accent, fontSize: 14, fontWeight: '600' }}>
                問問 AI 助理 →
              </Text>
            </Pressable>
          </View>
        )}
      </ScrollView>
    </View>
  );
}
