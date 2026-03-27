/* eslint-disable @typescript-eslint/no-unused-vars */
import React, { useMemo } from 'react';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
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

// Service tile for grid layout
function ServiceTile(props: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  tint: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={props.onPress}
      style={({ pressed }) => ({
        flex: 1,
        padding: theme.space.md,
        borderRadius: theme.radius.lg,
        backgroundColor: theme.colors.surface,
        borderWidth: 1,
        borderColor: theme.colors.border,
        alignItems: 'center',
        gap: theme.space.sm,
        minWidth: 80,
        opacity: pressed ? 0.82 : 1,
        transform: [{ scale: pressed ? 0.97 : 1 }],
        ...shadowStyle(theme.shadows.sm),
      })}
    >
      <View
        style={{
          width: 40,
          height: 40,
          borderRadius: 14,
          backgroundColor: `${props.tint}14`,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Ionicons name={props.icon} size={20} color={props.tint} />
      </View>
      <Text
        style={{ color: theme.colors.text, fontSize: 13, fontWeight: '700', textAlign: 'center' }}
        numberOfLines={2}
      >
        {props.label}
      </Text>
    </Pressable>
  );
}

function MapCard(props: { onPress: () => void; onARPress: () => void }) {
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
          height: 140,
          backgroundColor: theme.mode === 'dark' ? '#1A2A3A' : '#E8F4FD',
          justifyContent: 'center',
          alignItems: 'center',
          borderWidth: 1,
          borderColor: theme.colors.border,
          borderRadius: theme.radius.xl,
          gap: theme.space.md,
        }}
      >
        <View style={{ flexDirection: 'row', gap: 20, opacity: 0.3 }}>
          {[0, 1, 2].map((i) => (
            <View
              key={i}
              style={{
                width: 60 + i * 20,
                height: 40 + i * 10,
                borderRadius: 8,
                backgroundColor: theme.colors.accent,
              }}
            />
          ))}
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space.sm }}>
          <View
            style={{
              width: 32,
              height: 32,
              borderRadius: 16,
              backgroundColor: theme.colors.accent,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Ionicons name="navigate" size={16} color="#fff" />
          </View>
          <Text style={{ color: theme.colors.text, fontSize: 15, fontWeight: '700' }}>
            校園地圖
          </Text>
        </View>
      </View>

      <Pressable
        onPress={props.onARPress}
        style={({ pressed }) => ({
          position: 'absolute',
          bottom: theme.space.md,
          right: theme.space.md,
          flexDirection: 'row',
          alignItems: 'center',
          gap: theme.space.xs,
          paddingHorizontal: theme.space.sm,
          paddingVertical: 7,
          borderRadius: theme.radius.full,
          backgroundColor: theme.colors.surface,
          borderWidth: 1,
          borderColor: theme.colors.border,
          opacity: pressed ? 0.8 : 1,
          ...shadowStyle(theme.shadows.sm),
        })}
      >
        <Ionicons name="glasses-outline" size={15} color={theme.colors.accent} />
        <Text style={{ color: theme.colors.accent, fontSize: 12, fontWeight: '700' }}>AR</Text>
      </Pressable>
    </Pressable>
  );
}

export function CampusHubScreen(props: Record<string, unknown>) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const nav = props?.navigation as any;
  const insets = useSafeAreaInsets();
  const auth = useAuth();
  const { school } = useSchool();
  const ds = useDataSource();
  const paymentsEnabled = isFeatureEnabled('payments');

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
  const { cue: ambientCue, dismissCue: dismissAmbientCue, openCue: openAmbientCue } = useAmbientCues({
    schoolId: school.id,
    uid: auth.user?.uid ?? null,
    role: 'student',
    surface: 'campus',
    limit: 1,
  });

  const allServices = [
    {
      icon: 'map-outline' as const,
      label: '地圖',
      tint: theme.colors.accent,
      screen: 'Map',
    },
    {
      icon: 'restaurant-outline' as const,
      label: '餐廳',
      tint: theme.colors.achievement,
      screen: '餐廳總覽',
    },
    {
      icon: 'library-outline' as const,
      label: '圖書館',
      tint: theme.colors.calm,
      screen: 'Library',
    },
    {
      icon: 'home-outline' as const,
      label: '宿舍',
      tint: theme.colors.growth,
      screen: 'Dormitory',
    },
    {
      icon: 'print-outline' as const,
      label: '列印',
      tint: theme.colors.social,
      screen: 'PrintService',
    },
    {
      icon: 'search-circle-outline' as const,
      label: '失物',
      tint: theme.colors.warning,
      screen: 'LostFound',
    },
    {
      icon: 'heart-outline' as const,
      label: '健康',
      tint: theme.colors.danger,
      screen: 'Health',
    },
    ...(paymentsEnabled
      ? [
          {
            icon: 'card-outline' as const,
            label: '付款',
            tint: theme.colors.streak,
            screen: 'Payment',
          },
        ]
      : []),
  ];

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
          paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING + theme.space.md,
          gap: theme.space.xl,
        }}
        showsVerticalScrollIndicator={false}
      >
        <View style={{ gap: theme.space.xs }}>
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

        {ambientCue ? (
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

        <MapCard
          onPress={() => nav?.navigate?.('Map')}
          onARPress={() => nav?.navigate?.('ARNavigation', { destinationId: 'entrance' })}
        />

        <View style={{ gap: theme.space.md }}>
          <Text
            style={{
              color: theme.colors.muted,
              fontSize: theme.typography.overline.fontSize,
              fontWeight: theme.typography.overline.fontWeight ?? '700',
              letterSpacing: theme.typography.overline.letterSpacing ?? 1.5,
              textTransform: 'uppercase',
            }}
          >
            服務
          </Text>
          {[0, 1].map((row) => (
            <View key={row} style={{ flexDirection: 'row', gap: theme.space.md }}>
              {allServices.slice(row * 4, row * 4 + 4).map((svc) => (
                <ServiceTile
                  key={svc.label}
                  icon={svc.icon}
                  label={svc.label}
                  tint={svc.tint}
                  onPress={() => nav?.navigate?.(svc.screen)}
                />
              ))}
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}
