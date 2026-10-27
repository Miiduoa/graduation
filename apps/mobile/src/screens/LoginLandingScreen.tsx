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
import { SchoolPortalImportEntry } from '../components/SchoolPortalImport';
import {
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
            testID="platform-workspace-start"
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
            把自己的校園資料，整理在一起
          </Text>
          <Text style={s.body}>
            選擇學校後，可以連線支援的校務系統，或直接匯入自己下載的課表、成績與活動資料。校園地圖、公車與公開資訊仍然不必登入。
          </Text>
        </View>
        <SchoolBrowsingControl />
        <View style={s.schoolPanel}>
          <Text accessibilityRole="header" style={s.title}>
            {schoolEntry ? '從學校帳號取得資料' : '從學校資料開始'}
          </Text>
          <Text style={s.body} testID={schoolEntry ? undefined : 'school-login-hint'}>
            {schoolEntry
              ? '靜宜大學目前可直接使用 e 校園帳號讀取個人校務資料，不需要重新手動建立課表。'
              : '這間學校尚未開放學號直接連線；你仍可匯入自己從校務系統取得的資料。'}
          </Text>
          {schoolEntry ? (
            <Pressable
              testID="school-login-start"
              accessibilityRole="button"
              style={({ pressed }) => [s.schoolButton, pressed && s.rowPressed]}
              onPress={() => safeNavigate(navigation, 'SSOLogin')}
            >
              <Text style={s.schoolButtonText}>使用學號連線</Text>
            </Pressable>
          ) : null}
          <SchoolPortalImportEntry
            onOpenRecords={(kind) => safeNavigate(navigation, 'PersonalImport', { kind })}
          />
          <Pressable
            testID="school-import-start"
            accessibilityRole="button"
            accessibilityLabel="匯入課表、成績或活動"
            style={({ pressed }) => [s.importButton, pressed && s.rowPressed]}
            onPress={() => safeNavigate(navigation, 'PersonalImport', { kind: 'timetable' })}
          >
            <Text style={s.importButtonText}>匯入課表、成績或活動 →</Text>
          </Pressable>
          <Text style={s.importHelp}>支援學校網頁 HTML 存檔、截圖、PDF、CSV；先選表格並核對內容，不需要提供校務密碼。</Text>
        </View>
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
              ['Library', '圖書館', `搜尋${school.name}的館藏與官方服務`],
              ['SchoolInfo', '學校資訊', '查看官方總機、網站與名錄地址'],
              ['BusSchedule', '公車查詢', '查看站點與官方到站資訊'],
              ['公告總覽', '公開公告', `查看${school.name}發布的消息`],
              ['CourseCatalog', '課綱查詢', `查看${school.name}課綱或校方課程查詢入口`],
              ['Health', '校園健康', `查看${school.name}諮商、就醫與健康檢查資訊`],
              ['Dormitory', '宿舍服務', `前往${school.name}住宿相關校方入口`],
              ['Career', '職涯資訊', `前往${school.name}職涯與就業輔導公開資訊`],
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
        <Pressable
          testID="public-PersonalCalendar"
          accessibilityRole="button"
          accessibilityLabel="個人行事曆"
          style={({ pressed }) => [s.publicButton, pressed && s.rowPressed]}
          onPress={() => safeNavigate(navigation, 'PersonalCalendar')}
        >
          <Text style={s.publicTitle}>個人行事曆</Text>
          <Text style={s.publicDetail}>新增、編輯自己的活動與考試；不必學校帳號。</Text>
        </Pressable>
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
    schoolPanel: {
      gap: 10,
      padding: 20,
      marginTop: 22,
      backgroundColor: theme.colors.focusSurface,
      borderColor: theme.colors.border,
      borderWidth: 1,
      borderRadius: 14,
    },
    schoolButton: {
      minHeight: 50,
      alignSelf: 'stretch',
      justifyContent: 'center',
      paddingVertical: 12,
      paddingHorizontal: 16,
      marginTop: 4,
      borderRadius: 8,
      backgroundColor: theme.colors.accent,
    },
    schoolButtonText: { color: theme.colors.onAccent, textAlign: 'center', fontSize: 15, fontWeight: '600' },
    importButton: {
      minHeight: 48,
      alignSelf: 'stretch',
      justifyContent: 'center',
      paddingVertical: 12,
      paddingHorizontal: 14,
      marginTop: 4,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.surface,
    },
    importButtonText: { color: theme.colors.accent, textAlign: 'center', fontSize: 14, fontWeight: '600' },
    importHelp: { color: theme.colors.muted, fontSize: 12, lineHeight: 19 },
    footer: {
      color: theme.colors.muted,
      fontSize: 11,
      paddingVertical: 28,
      marginTop: 24,
      borderTopWidth: 1,
      borderColor: theme.colors.border,
    },
  });
