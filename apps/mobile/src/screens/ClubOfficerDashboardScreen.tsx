/**
 * Club Officer Dashboard — 社團幹部今日駕駛艙
 *
 * 角色邊界：社團幹部只看自己「擔任幹部」的社團。資料來源走 getDemoGroups()
 * 並用 ownerUid / clubOfficerUid 過濾，避免越權看到其他社團內部資料。
 *
 * 對應 web 端 apps/web/src/app/clubs/page.tsx 的「社團幹部管理區」綠色 banner。
 */
import React, { useMemo, useState } from 'react';
import { ScrollView, View, LayoutAnimation, Platform, UIManager, Text, Pressable, Alert } from 'react-native';
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
import { getDemoGroups, getDemoEvents } from '../data/demoData';
import { safeNavigate } from '../utils/safeNavigate';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

/**
 * 用 uid 推斷該幹部負責的社團。
 * 在 demo 環境中，社團群組的 ownerUid 已對齊 demo_club_wei；正式環境會走
 * Firestore `clubs/{clubId}/officers/{uid}`，邏輯由 club_officers 服務取代。
 */
function filterMyClubs<T extends { ownerId?: string | null; createdBy?: string | null }>(
  rows: T[],
  uid: string | null,
): T[] {
  if (!uid) return [];
  return rows.filter((g) => g.ownerId === uid || g.createdBy === uid);
}

export default function ClubOfficerDashboardScreen() {
  const navigation = useNavigation<any>();
  const auth = useAuth();
  const { school } = useSchool();
  const tabBarBottomPad = useTabBarContentBottomPadding();
  const [openSection, setOpenSection] = useState<null | 'mine' | 'events' | 'pending'>('mine');

  const schoolId = school?.id ?? 'pu';
  const uid = auth.user?.uid ?? null;
  const displayName = auth.profile?.displayName ?? '社團幹部';

  const allGroups = useMemo(() => getDemoGroups(schoolId), [schoolId]);
  // demo 期間若 ownerId 沒對齊 uid，回退顯示前 2 個社團作為「我管理的社團」
  const myClubs = useMemo(() => {
    const matched = filterMyClubs(allGroups, uid);
    if (matched.length > 0) return matched;
    return allGroups.slice(0, 2);
  }, [allGroups, uid]);

  const events = useMemo(() => getDemoEvents(schoolId), [schoolId]);
  const myUpcomingEvents = useMemo(() => {
    // ClubEvent.organizer 在 demo 資料中可能是 group.id 也可能是社團名稱，兩者都比對。
    const myClubIds = new Set(myClubs.map((c) => c.id));
    const myClubNames = new Set(myClubs.map((c) => c.name));
    const filtered = events.filter(
      (e) => (e.organizer && (myClubIds.has(e.organizer) || myClubNames.has(e.organizer))),
    );
    // demo 資料若沒有 organizer 對到，至少顯示前 4 筆活動讓 demo 不空白
    return (filtered.length > 0 ? filtered : events).slice(0, 6);
  }, [events, myClubs]);

  const totalMembers = useMemo(
    () => myClubs.reduce((sum, c) => sum + (c.memberCount ?? 0), 0),
    [myClubs],
  );

  const toggle = (k: typeof openSection) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setOpenSection(openSection === k ? null : k);
  };

  const handlePublishEvent = () => {
    Alert.alert('發布社團活動', '已開啟活動發布流程（demo）。\n\n這會通知社團成員與校內公告。');
  };

  const handleManageMembers = (clubId: string, clubName: string) => {
    const ok = safeNavigate(navigation, 'GroupDetail', { groupId: clubId });
    if (!ok) {
      Alert.alert('社團成員管理', `${clubName} 的成員管理（demo）`);
    }
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
          eyebrow="社團幹部 · 今日"
          title={`${displayName}，你的社團今天有 ${myUpcomingEvents.length} 場活動需要追蹤`}
          summary={`管理 ${myClubs.length} 個社團 · 共 ${totalMembers} 位成員`}
        />

        {/* 社團幹部 banner */}
        <View
          style={{
            padding: theme.space.md,
            borderRadius: theme.radius.md,
            backgroundColor: 'rgba(52,199,89,0.10)',
            borderWidth: 1,
            borderColor: 'rgba(52,199,89,0.30)',
            marginBottom: theme.space.lg,
            flexDirection: 'row',
            alignItems: 'center',
            gap: theme.space.sm,
          }}
        >
          <Ionicons name="flag-outline" size={20} color="#34C759" />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={{ color: '#1F8B3D', fontSize: 14, fontWeight: '700' }}>
              社團幹部管理區
            </Text>
            <Text style={{ color: theme.colors.textSecondary, fontSize: 12, marginTop: 2 }}>
              發布活動、管理成員、審核報名都在這
            </Text>
          </View>
        </View>

        <CockpitMetricRow>
          <CockpitMetricChip label="我管理的社團" value={myClubs.length} />
          <CockpitMetricChip label="本月活動" value={myUpcomingEvents.length} />
          <CockpitMetricChip label="社團成員" value={totalMembers} />
        </CockpitMetricRow>

        {/* 工具列 */}
        <View
          style={{
            flexDirection: 'row',
            flexWrap: 'wrap',
            gap: theme.space.xs + 2,
            marginBottom: theme.space.lg,
          }}
        >
          <CockpitToolChip
            icon="megaphone-outline"
            label="發布活動"
            onPress={handlePublishEvent}
          />
          <CockpitToolChip
            icon="people-outline"
            label="社團名單"
            onPress={() => safeNavigate(navigation, 'Groups')}
          />
          <CockpitToolChip
            icon="document-text-outline"
            label="活動審核"
            onPress={() => Alert.alert('活動報名審核', '3 筆新報名等待審核（demo）')}
          />
        </View>

        <CockpitSection
          label="我的社團"
          count={myClubs.length}
          open={openSection === 'mine'}
          onToggle={() => toggle('mine')}
        >
          {myClubs.map((club) => (
            <CockpitRow
              key={club.id}
              icon="people-circle-outline"
              title={club.name}
              subtitle={`${club.memberCount ?? 0} 位成員 · ${club.type === 'club' ? '社團' : club.type}`}
              onPress={() => handleManageMembers(club.id, club.name)}
            />
          ))}
          {myClubs.length === 0 && (
            <Text style={{ color: theme.colors.muted, padding: theme.space.md }}>
              你目前還沒有管理的社團
            </Text>
          )}
        </CockpitSection>

        <CockpitSection
          label="本月活動"
          count={myUpcomingEvents.length}
          open={openSection === 'events'}
          onToggle={() => toggle('events')}
        >
          {myUpcomingEvents.map((event) => (
            <CockpitRow
              key={event.id}
              icon="calendar-outline"
              title={event.title}
              subtitle={`${new Date(event.startsAt).toLocaleString('zh-TW', {
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              })} · ${event.registeredCount ?? 0} / ${event.capacity ?? '∞'} 人報名`}
              onPress={() =>
                safeNavigate(navigation, 'EventDetail', { id: event.id })
              }
            />
          ))}
          {myUpcomingEvents.length === 0 && (
            <Text style={{ color: theme.colors.muted, padding: theme.space.md }}>
              這個月沒有排定的活動
            </Text>
          )}
        </CockpitSection>

        <CockpitSection
          label="待審報名"
          count={3}
          open={openSection === 'pending'}
          onToggle={() => toggle('pending')}
        >
          <CockpitRow
            icon="person-add-outline"
            title="陳同學 · 加入「程式設計社」"
            subtitle="自我介紹：對 React 與後端開發都有興趣"
            tone="warn"
            onPress={() => Alert.alert('審核加入申請', '已核准陳同學（demo）')}
          />
          <CockpitRow
            icon="person-add-outline"
            title="林同學 · 加入「程式設計社」"
            subtitle="自我介紹：希望學習 AI 與機器學習"
            tone="warn"
            onPress={() => Alert.alert('審核加入申請', '已核准林同學（demo）')}
          />
          <CockpitRow
            icon="person-add-outline"
            title="王同學 · 報名「期末 Hackathon」"
            subtitle="作品方向：校園資訊整合 App"
            tone="warn"
            onPress={() => Alert.alert('審核活動報名', '已核准王同學報名（demo）')}
          />
        </CockpitSection>
      </ScrollView>
    </SafeAreaView>
  );
}
