import React, { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { safeNavigate } from '../utils/safeNavigate';
import { theme } from '../ui/theme';
import { useThemeStyleSheet } from '../ui/useThemeStyleSheet';
import { useNuniSession } from '../state/nuniSession';
import { useSchool } from '../state/school';
import { SchoolBrowsingControl } from '../components/SchoolBrowsingControl';
import { TodayTimetablePanel } from '../components/TodayTimetablePanel';
import {
  SCHOOL_LOGIN_BIND_HINT,
  isSchoolLoginEntryAvailable,
  loadSchoolLoginProviderKinds,
} from '../services/schoolLoginAvailability';

export default function LoginLandingScreen() {
  const navigation = useNavigation();
  const auth = useNuniSession();
  const { school } = useSchool();
  const s = useThemeStyleSheet(createStyles);
  const [, refreshProviders] = useState(0);
  const schoolEntry = isSchoolLoginEntryAvailable(school.id);
  useEffect(() => {
    let active = true;
    void loadSchoolLoginProviderKinds().then(() => {
      if (active) refreshProviders((revision) => revision + 1);
    });
    return () => {
      active = false;
    };
  }, []);
  return (
    <SafeAreaView testID="login-landing" style={s.page}>
      <ScrollView contentContainerStyle={s.content}>
        <View style={s.brandRow}>
          <View
            style={s.brandMark}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          >
            <Text style={s.brandLetter}>
              C<Text style={s.brandNumber}>1</Text>
            </Text>
          </View>
          <Text style={s.brand}>Campus One</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="開啟課程與作業"
            onPress={() => safeNavigate(navigation, 'NuniWorkspace')}
            style={({ pressed }) => [s.workspaceShortcut, pressed && s.rowPressed]}
          >
            <Text style={s.workspaceShortcutText}>課程與作業</Text>
          </Pressable>
        </View>
        <View style={s.intro}>
          <Text style={s.school}>課程・校園・每天的事</Text>
          <Text accessibilityRole="header" style={s.heading}>
            校園生活
          </Text>
          <Text style={s.body}>不必登入學校帳號，就能查看各校地圖、公車、圖書館與公開公告。</Text>
        </View>
        <SchoolBrowsingControl />
        <View style={s.publicPanel}>
          <View style={s.sectionHeading}>
            <Text accessibilityRole="header" style={s.title}>
              先找需要的資訊
            </Text>
            <Text style={s.sectionCaption}>公開資訊</Text>
          </View>
          {(
            [
              ['Map', '校園地圖', '搜尋地點、查看位置與步行路線'],
              ['Library', '圖書館', '搜尋目前選擇學校的館藏與官方服務'],
              ['BusSchedule', '公車查詢', '查看站點與官方到站資訊'],
              ['公告總覽', '公開公告', '查看學校發布的消息'],
            ] as const
          ).map(([route, title, detail], index) => (
            <Pressable
              key={route}
              testID={`public-${route}`}
              accessibilityRole="button"
              accessibilityLabel={title}
              style={({ pressed }) => [s.publicButton, pressed && s.rowPressed]}
              onPress={() => safeNavigate(navigation, route)}
            >
              <Text
                style={s.serviceNumber}
                accessibilityElementsHidden
                importantForAccessibility="no"
              >
                {String(index + 1).padStart(2, '0')}
              </Text>
              <View style={s.serviceCopy}>
                <Text style={s.publicTitle}>{title}</Text>
                <Text style={s.publicDetail}>{detail}</Text>
              </View>
              <Text
                style={s.serviceArrow}
                accessibilityElementsHidden
                importantForAccessibility="no"
              >
                →
              </Text>
            </Pressable>
          ))}
        </View>
        <TodayTimetablePanel
          onOpenImport={() => safeNavigate(navigation, 'PersonalImport', { kind: 'timetable' })}
          onOpenTimetable={(term) =>
            safeNavigate(navigation, 'PersonalTimetable', term ? { term } : undefined)
          }
        />
        <View style={s.panel}>
          <Text accessibilityRole="header" style={s.title}>
            Google 帳號
          </Text>
          <Text style={s.body}>和網頁版使用同一個帳號，加入課程、繳交作業或管理店家。</Text>
          {auth.pendingLogout || auth.error ? (
            <Text accessibilityRole="alert" style={s.body}>
              {auth.pendingLogout ? '上次登出還沒完成，請先完成登出再使用其他帳號。' : auth.error}
            </Text>
          ) : null}
          <Pressable
            testID="login-start"
            accessibilityRole="button"
            style={({ pressed }) => [s.button, pressed && s.buttonPressed]}
            onPress={() => safeNavigate(navigation, 'NuniWorkspace')}
          >
            <Text style={s.buttonText}>
              {auth.session && !auth.loading && !auth.error && !auth.pendingLogout
                ? '回到我的 Campus One'
                : auth.loading
                  ? '確認 Google 帳號'
                  : auth.pendingLogout
                    ? '處理未完成的登出'
                    : auth.error
                      ? '查看登入問題'
                      : '登入或建立帳號'}
            </Text>
          </Pressable>
        </View>
        <View style={s.schoolPanel}>
          <Text accessibilityRole="header" style={s.title}>
            連線學校帳號
          </Text>
          <Text style={s.body} testID={schoolEntry ? undefined : 'school-login-hint'}>
            {schoolEntry
              ? '只有讀取學校提供的個人課表與成績，才需要連線學校帳號。'
              : SCHOOL_LOGIN_BIND_HINT}
          </Text>
          {schoolEntry ? (
            <Pressable
              testID="school-login-start"
              accessibilityRole="button"
              style={({ pressed }) => [s.schoolButton, pressed && s.rowPressed]}
              onPress={() => safeNavigate(navigation, 'SSOLogin')}
            >
              <Text style={s.schoolButtonText}>前往學校登入</Text>
            </Pressable>
          ) : null}
        </View>
        <Text style={s.footer}>Campus One · 課程與校園生活</Text>
      </ScrollView>
    </SafeAreaView>
  );
}
const createStyles = () =>
  StyleSheet.create({
    page: { flex: 1, backgroundColor: theme.colors.bg },
    content: {
      paddingHorizontal: 24,
      paddingTop: 20,
      flexGrow: 1,
      width: '100%',
      maxWidth: 640,
      alignSelf: 'center',
    },
    brandRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 9 },
    brandMark: {
      width: 34,
      height: 34,
      borderRadius: 8,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.colors.accent,
    },
    brandLetter: { color: theme.colors.onAccent, fontSize: 23, fontWeight: '600' },
    brandNumber: { fontSize: 13 },
    brand: {
      color: theme.colors.text,
      letterSpacing: -0.4,
      fontWeight: '700',
      fontSize: 17,
    },
    workspaceShortcut: {
      marginLeft: 'auto',
      paddingHorizontal: 10,
      minHeight: 44,
      justifyContent: 'center',
      borderRadius: 7,
      borderWidth: 1,
      borderColor: theme.colors.border,
    },
    workspaceShortcutText: { color: theme.colors.accent, fontSize: 12, fontWeight: '600' },
    intro: { paddingTop: 24, paddingBottom: 24 },
    publicPanel: { marginTop: 24, marginBottom: 8 },
    sectionHeading: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'baseline',
      justifyContent: 'space-between',
      gap: 8,
      paddingBottom: 12,
      borderBottomWidth: 1,
      borderBottomColor: theme.colors.border,
    },
    sectionCaption: { color: theme.colors.muted, fontSize: 12 },
    publicButton: {
      minHeight: 76,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 14,
      paddingVertical: 14,
      borderBottomWidth: 1,
      borderBottomColor: theme.colors.border,
    },
    serviceNumber: {
      color: theme.colors.muted,
      fontSize: 12,
      fontVariant: ['tabular-nums'],
      width: 24,
    },
    serviceCopy: { flex: 1, minWidth: 0 },
    serviceArrow: { color: theme.colors.accent, fontSize: 22 },
    rowPressed: { backgroundColor: theme.colors.surfaceInteractive },
    buttonPressed: { backgroundColor: theme.colors.accentHover },
    publicTitle: { color: theme.colors.text, fontSize: 16, fontWeight: '600', lineHeight: 23 },
    publicDetail: { color: theme.colors.muted, fontSize: 13, lineHeight: 21, marginTop: 4 },
    school: {
      color: theme.colors.textSecondary,
      fontSize: 12,
      letterSpacing: 0.5,
      marginBottom: 10,
    },
    heading: {
      color: theme.colors.text,
      fontSize: 32,
      fontWeight: '600',
      lineHeight: 42,
      letterSpacing: -0.6,
    },
    body: { color: theme.colors.muted, fontSize: 14, lineHeight: 24, marginTop: 12 },
    panel: {
      padding: 22,
      backgroundColor: theme.colors.focusSurface,
      borderColor: theme.colors.border,
      borderWidth: 1,
      borderRadius: 14,
      marginTop: 10,
    },
    title: { color: theme.colors.text, fontSize: 18, lineHeight: 26, fontWeight: '600' },
    button: {
      backgroundColor: theme.colors.accent,
      minHeight: 50,
      justifyContent: 'center',
      padding: 15,
      borderRadius: 8,
      marginTop: 22,
    },
    buttonText: {
      color: theme.colors.onAccent,
      textAlign: 'center',
      fontSize: 15,
      fontWeight: '600',
    },
    schoolPanel: { paddingTop: 28, paddingHorizontal: 2 },
    schoolButton: {
      minHeight: 48,
      alignSelf: 'flex-start',
      justifyContent: 'center',
      paddingVertical: 14,
      paddingHorizontal: 8,
      marginLeft: -8,
      marginTop: 10,
      borderRadius: 6,
    },
    schoolButtonText: { color: theme.colors.accent, fontSize: 15, fontWeight: '600' },
    footer: {
      color: theme.colors.muted,
      fontSize: 11,
      paddingVertical: 28,
      marginTop: 24,
      borderTopWidth: 1,
      borderTopColor: theme.colors.border,
    },
  });
