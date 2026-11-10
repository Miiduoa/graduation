import React, { useEffect, useState } from 'react';
import { Alert, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
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

const workEntries = [
  { title: '店家進駐與門市管理', detail: '用 Google 帳號申請、查進度，或進入已授權的門市。', tab: 'merchant' },
  { title: '教師課程', detail: '用 Google 帳號開班，或進入已授權的課程。', tab: 'courses' },
  { title: '校方人員登入（網頁）', detail: '使用學校核發的帳號，向所屬單位確認業務權限。', path: '/auth/account?method=school' },
  { title: '平台管理員登入（網頁）', detail: '使用已獲平台授權的管理帳號。', path: '/admin/login' },
] as const;

async function openStaffLogin(path: '/auth/account?method=school' | '/admin/login') {
  const url = `https://nuni.tw${path}`;
  try {
    await Linking.openURL(url);
  } catch {
    Alert.alert('無法開啟登入頁', `請使用瀏覽器開啟 ${url}`);
  }
}

export default function LoginLandingScreen() {
  const navigation = useNavigation();
  const auth = useNuniSession();
  const { school, selectionReady } = useSchool();
  const s = useThemeStyleSheet(createStyles);
  const [showWorkEntries, setShowWorkEntries] = useState(false);
  const [, refreshProviders] = useState(0);
  const hasSchool = selectionReady !== false && Boolean(school.id);
  const schoolEntry = hasSchool && isSchoolLoginEntryAvailable(school.id);
  const platformReady = !!auth.session && !auth.loading && !auth.error && !auth.pendingLogout;
  useEffect(() => {
    if (!hasSchool) return;
    let active = true;
    void loadSchoolLoginProviderKinds().then(() => {
      if (active) refreshProviders((revision) => revision + 1);
    });
    return () => {
      active = false;
    };
  }, [hasSchool]);
  return (
    <SafeAreaView testID="login-landing" style={s.page}>
      <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
        <View style={s.brandRow}>
          <View
            style={s.brandMark}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          >
            <Text style={s.brandLetter}>n</Text>
          </View>
          <Text style={s.brand}>nuni</Text>
          <Pressable
            testID="platform-workspace-start"
            accessibilityRole="button"
            accessibilityLabel="開啟課程與作業"
            onPress={() => safeNavigate(navigation, 'NuniWorkspace')}
            style={({ pressed }) => [s.workspaceShortcut, pressed && s.rowPressed]}
          >
            <Text style={s.workspaceShortcutText}>課程與作業</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded: showWorkEntries }}
            onPress={() => setShowWorkEntries((open) => !open)}
            style={({ pressed }) => [s.workShortcut, pressed && s.rowPressed]}
          >
            <Text style={s.workspaceShortcutText}>店家與教職員入口</Text>
          </Pressable>
        </View>
        {showWorkEntries && (
          <View style={s.panel}>
            <Text accessibilityRole="header" style={s.title}>選擇工作入口</Text>
            {workEntries.map((entry) => (
              <Pressable
                key={entry.title}
                accessibilityRole={'path' in entry ? 'link' : 'button'}
                accessibilityLabel={entry.title}
                accessibilityHint={entry.detail}
                onPress={() => 'path' in entry
                  ? void openStaffLogin(entry.path)
                  : safeNavigate(navigation, 'NuniWorkspace', { tab: entry.tab })}
                style={({ pressed }) => [s.workEntry, pressed && s.rowPressed]}
              >
                <Text style={s.publicTitle}>{entry.title}</Text>
                <Text style={s.publicDetail}>{entry.detail}</Text>
              </Pressable>
            ))}
          </View>
        )}
        <View style={s.intro}>
          <Text style={s.school}>{platformReady && hasSchool ? `${school.name} · 我的課表` : '課程・校園・每天的事'}</Text>
          <Text accessibilityRole="header" style={s.heading}>
            {platformReady && hasSchool ? '下一堂課在哪裡？' : '把自己的校園資料，整理在一起'}
          </Text>
          <Text style={s.body}>
            {platformReady && hasSchool ? '用這台手機儲存的課表，查現在或下一堂課的時間和教室。'
              : '使用 Google 帳號即可加入平台課程、繳交作業與查看自己的訂單，不必先綁定學校。選擇學校後，可另外匯入自己的課表、成績與活動；校園地圖、公車與公開資訊不必登入。'}
          </Text>
          {platformReady && (
            <Pressable
              accessibilityRole="button"
              onPress={() => safeNavigate(navigation, 'NuniTimetableAssistant')}
              style={({ pressed }) => [s.schoolButton, pressed && s.rowPressed]}
            >
              <Text style={s.schoolButtonText}>開啟課表助理</Text>
            </Pressable>
          )}
        </View>
        <View style={s.panel}>
          <Text accessibilityRole="header" style={s.title}>
            Google 帳號
          </Text>
          <Text style={s.body}>和網頁版使用同一個 Google 帳號，加入平台課程、繳交作業或查看自己的訂單，不必先綁定學校。</Text>
          <Text style={s.importHelp}>校方私人資料、已驗證學生服務與店家管理，仍依各服務的資格與授權開放。</Text>
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
              {platformReady
                ? '回到我的 nuni'
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
        <SchoolBrowsingControl />
        <View style={s.panel}>
          <Text accessibilityRole="header" style={s.title}>失物招領</Text>
          <Text style={s.body}>用 Google 帳號刊登遺失或拾獲資訊，查看聯絡方式，並管理自己的刊登。</Text>
          <Pressable
            testID="platform-lost-found-start"
            accessibilityRole="button"
            accessibilityLabel="開啟平台失物招領"
            style={({ pressed }) => [s.schoolButton, pressed && s.rowPressed]}
            onPress={() => safeNavigate(navigation, 'PlatformLostFound')}
          >
            <Text style={s.schoolButtonText}>開啟失物招領 →</Text>
          </Pressable>
        </View>
        {hasSchool && (
          <View style={s.schoolPanel}>
            <Text accessibilityRole="header" style={s.title}>
              {schoolEntry ? '學校帳號（尚未開放）' : '從學校資料開始'}
            </Text>
            <Text style={s.body} testID={schoolEntry ? undefined : 'school-login-hint'}>
              {schoolEntry
                ? '尚未開放學號直接登入；你仍可匯入自己取得的課表、成績與活動，或以 Google 帳號使用平台交流與課班服務。'
                : '尚未開放學號直接登入；你仍可匯入自己從校務系統取得的資料。'}
            </Text>
            {schoolEntry ? (
              <Pressable
                testID="school-login-start"
                accessibilityRole="button"
                style={({ pressed }) => [s.schoolButton, pressed && s.rowPressed]}
                onPress={() => safeNavigate(navigation, 'SSOLogin')}
              >
                <Text style={s.schoolButtonText}>學號登入（尚未開放）</Text>
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
        )}
        {hasSchool && (
          <>
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
                   ['StudentCard', '數位學生證', '出示學生證，或核對對方的校園身分'],
                  ['BusSchedule', '公車查詢', '查看站點與官方到站資訊'],
                  ['公告總覽', '公開公告', `查看${school.name}發布的消息`],
                  ['CourseCatalog', '課綱查詢', `查看${school.name}課綱或校方課程查詢入口`],
                  ['Health', '校園健康', `查看${school.name}諮商、就醫與健康檢查資訊`],
                  ['Dormitory', '宿舍服務', `查看${school.name}報修管道與入住事項；設備問題只存成個人備忘`],
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
          </>
        )}
        <Text style={s.footer}>nuni · 課程與校園生活</Text>
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
    workShortcut: {
      paddingHorizontal: 8,
      minHeight: 44,
      justifyContent: 'center',
    },
    workEntry: {
      minHeight: 48,
      justifyContent: 'center',
      paddingVertical: 12,
      marginTop: 4,
      borderBottomWidth: 1,
      borderBottomColor: theme.colors.border,
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
