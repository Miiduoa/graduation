/**
 * Alumni Home — 校友主畫面（demo）
 *
 * 校友身份僅可瀏覽：校園公告 / 地圖 / 公車 / 活動清單。
 * 不能加入社團、不能借書、不能下單；所有「行動」按鈕點下去都會跳「校友身份」toast。
 *
 * 對應 web 端 apps/web/src/app/page.tsx 的灰色 alumni banner。
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
import { useAuth } from '../state/auth';
import { useSchool } from '../state/school';
import { getDemoAnnouncements, getDemoEvents } from '../data/demoData';
import { safeNavigate } from '../utils/safeNavigate';

export default function AlumniHomeScreen() {
  const navigation = useNavigation<any>();
  const auth = useAuth();
  const { school } = useSchool();
  const tabBarBottomPad = useTabBarContentBottomPadding();

  const schoolId = school?.id ?? 'pu';
  const displayName = auth.profile?.displayName ?? '校友';

  const announcements = useMemo(() => getDemoAnnouncements(schoolId).slice(0, 5), [schoolId]);
  const events = useMemo(() => getDemoEvents(schoolId).slice(0, 5), [schoolId]);

  const showAlumniLimit = () => {
    Alert.alert('校友身份僅可瀏覽', '無法執行學生 / 在校教職員的動作，這是 demo 的權限隔離示範。');
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
          eyebrow="校友 · 動態"
          title={`${displayName}，歡迎回來看看母校最近的消息`}
          summary="校友身份僅可瀏覽公開資訊，無法加入社團或借書"
        />

        {/* 校友身份 banner */}
        <View
          style={{
            padding: theme.space.md,
            borderRadius: theme.radius.md,
            backgroundColor: theme.colors.surfaceMuted,
            borderWidth: 1,
            borderColor: theme.colors.border,
            marginBottom: theme.space.lg,
            flexDirection: 'row',
            alignItems: 'center',
            gap: theme.space.sm,
          }}
        >
          <Ionicons name="ribbon-outline" size={20} color={theme.colors.muted} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={{ color: theme.colors.text, fontSize: 14, fontWeight: '700' }}>
              校友身份（109 屆）· 僅瀏覽模式
            </Text>
            <Text style={{ color: theme.colors.textSecondary, fontSize: 12, marginTop: 2 }}>
              可看：公告、地圖、活動、公車｜不可：加社團、借書、課程
            </Text>
          </View>
        </View>

        <CockpitMetricRow>
          <CockpitMetricChip label="近期公告" value={announcements.length} />
          <CockpitMetricChip label="校友開放活動" value={events.length} />
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
            label="餐廳資訊"
            onPress={() => safeNavigate(navigation, '餐廳總覽')}
          />
          <CockpitToolChip
            icon="lock-closed-outline"
            label="加入社團"
            onPress={showAlumniLimit}
          />
          <CockpitToolChip
            icon="lock-closed-outline"
            label="圖書館"
            onPress={showAlumniLimit}
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

        <View style={{ height: theme.space.md }} />

        <CockpitSection label="校友開放活動" count={events.length} open onToggle={() => undefined}>
          {events.map((e) => (
            <CockpitRow
              key={e.id}
              icon="calendar-outline"
              title={e.title}
              subtitle={`${new Date(e.startsAt).toLocaleDateString('zh-TW')} · ${e.location ?? '校園'}`}
              onPress={() =>
                safeNavigate(navigation, 'EventDetail', { id: e.id })
              }
            />
          ))}
        </CockpitSection>
      </ScrollView>
    </SafeAreaView>
  );
}
