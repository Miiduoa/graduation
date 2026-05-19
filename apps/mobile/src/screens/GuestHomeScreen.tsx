/**
 * Guest Home — 訪客主畫面（demo）
 *
 * 訪客 = 未登入身份。可看：公告、校園地圖、餐廳、公車。
 * 任何「登入後才能用」的功能（社團、課表、成績、訊息）都會引導到登入頁。
 */
import React, { useMemo } from 'react';
import { ScrollView, View, Text, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { theme } from '../ui/theme';
import { useTabBarContentBottomPadding } from '../ui/navigationTheme';
import {
  CockpitHero,
  CockpitMetricRow,
  CockpitMetricChip,
  CockpitSection,
  CockpitRow,
  CockpitToolChip,
} from '../ui/cockpitShell';
import { useSchool } from '../state/school';
import { useAuth } from '../state/auth';
import { getDemoAnnouncements } from '../data/demoData';
import { safeNavigate } from '../utils/safeNavigate';

export default function GuestHomeScreen() {
  const navigation = useNavigation<any>();
  const { school } = useSchool();
  const auth = useAuth();
  const tabBarBottomPad = useTabBarContentBottomPadding();

  const schoolId = school?.id ?? 'pu';
  const announcements = useMemo(() => getDemoAnnouncements(schoolId).slice(0, 4), [schoolId]);

  const showGuestLimit = () => {
    Alert.alert('需要登入才能使用', '登入後可以看到課表、成績、訊息與個人化推薦。', [
      { text: '取消', style: 'cancel' },
      {
        text: '前往登入',
        onPress: async () => {
          await auth.signOut().catch(() => undefined);
        },
      },
    ]);
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.bg }} edges={['top', 'left', 'right']}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          paddingHorizontal: theme.layout.screenHorizontalPadding,
          paddingTop: theme.space.md,
          paddingBottom: tabBarBottomPad + theme.space.lg,
        }}
        showsVerticalScrollIndicator={false}
      >
        <CockpitHero
          eyebrow="訪客模式"
          title="逛逛靜宜校園的公開資訊"
          summary="公告 · 地圖 · 公車 · 餐廳開放給所有人"
        />

        <View
          style={{
            padding: theme.space.md,
            borderRadius: theme.radius.md,
            backgroundColor: theme.colors.surface,
            borderWidth: 1,
            borderColor: theme.colors.border,
            marginBottom: theme.space.lg,
            flexDirection: 'row',
            alignItems: 'center',
            gap: theme.space.sm,
          }}
        >
          <Ionicons name="eye-outline" size={20} color={theme.colors.muted} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={{ color: theme.colors.text, fontSize: 14, fontWeight: '700' }}>
              訪客僅可瀏覽公開內容
            </Text>
            <Text style={{ color: theme.colors.textSecondary, fontSize: 12, marginTop: 2 }}>
              想看個人化內容請先登入
            </Text>
          </View>
        </View>

        <CockpitMetricRow>
          <CockpitMetricChip label="本週公告" value={announcements.length} />
          <CockpitMetricChip label="公車路線" value={4} />
          <CockpitMetricChip label="餐廳" value={6} />
        </CockpitMetricRow>

        <View
          style={{
            flexDirection: 'row',
            flexWrap: 'wrap',
            gap: theme.space.xs + 2,
            marginBottom: theme.space.lg,
          }}
        >
          <CockpitToolChip
            icon="map-outline"
            label="校園地圖"
            onPress={() => safeNavigate(navigation, 'Map')}
          />
          <CockpitToolChip
            icon="bus-outline"
            label="校園公車"
            onPress={() => safeNavigate(navigation, 'BusSchedule')}
          />
          <CockpitToolChip
            icon="restaurant-outline"
            label="餐廳列表"
            onPress={() => safeNavigate(navigation, '餐廳總覽')}
          />
          <CockpitToolChip
            icon="lock-closed-outline"
            label="課表"
            onPress={showGuestLimit}
          />
          <CockpitToolChip
            icon="lock-closed-outline"
            label="訊息"
            onPress={showGuestLimit}
          />
        </View>

        <CockpitSection label="校園公告" count={announcements.length} open onToggle={() => undefined}>
          {announcements.map((a) => (
            <CockpitRow
              key={a.id}
              icon="megaphone-outline"
              title={a.title}
              subtitle={`${a.source ?? '校園公告'} · ${new Date(a.publishedAt).toLocaleDateString('zh-TW')}`}
              onPress={() =>
                safeNavigate(navigation, '公告詳情', { id: a.id })
              }
            />
          ))}
        </CockpitSection>
      </ScrollView>
    </SafeAreaView>
  );
}
