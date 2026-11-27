import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Alert, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { guestCampusServices } from './guestCampusServices';
import { safeNavigate } from '../utils/safeNavigate';
import { theme } from '../ui/theme';
import { pageTitleFont } from '../ui/styles';
import { useThemeStyleSheet } from '../ui/useThemeStyleSheet';
import { useNuniSession } from '../state/nuniSession';
import { useSchool } from '../state/school';
import { SchoolBrowsingControl } from '../components/SchoolBrowsingControl';
import { TodayTimetablePanel } from '../components/TodayTimetablePanel';
import { SchoolPortalImportEntry } from '../components/SchoolPortalImport';
import { WorkspaceStart } from '../components/WorkspaceStart';
import {
  getSchoolLoginAvailabilityState,
  isSchoolLoginEntryAvailable,
  loadSchoolLoginProviderKinds,
} from '../services/schoolLoginAvailability';
import {
  getSchoolTronClassEntry,
  TRONCLASS_LOGIN_DIRECTORY,
} from '@campus/shared/src/schoolLearningPlatforms';
import {
  webBrowserOpenWithPuTronClassGate,
  webViewShouldAllowRequestUrl,
} from '../services/tronClassWebUiGate';

const workEntries = [
  { title: '店家進駐與門市管理', detail: '用 Google 帳號申請、查進度，或進入已授權的門市。', tab: 'merchant' },
  { title: '教師課程', detail: '用 Google 帳號開班，或進入已授權的課程。', tab: 'courses' },
  { title: '校方人員登入（網頁）', detail: '使用學校核發的帳號，向所屬單位確認業務權限。', path: '/auth/account?method=school' },
  { title: '平台管理員登入（網頁）', detail: '使用已獲平台授權的管理帳號。', path: '/admin/login' },
] as const;

async function openStaffLogin(path: '/auth/account?method=school' | '/admin/login' | '/admin') {
  const url = `https://nuni.tw${path}`;
  try {
    await Linking.openURL(url);
  } catch {
    Alert.alert('無法開啟登入頁', `請使用瀏覽器開啟 ${url}`);
  }
}

async function openTronClassDirectory() {
  if (!(await webBrowserOpenWithPuTronClassGate(TRONCLASS_LOGIN_DIRECTORY.url))) {
    Alert.alert('無法開啟 TronClass 官網', `請使用瀏覽器開啟 ${TRONCLASS_LOGIN_DIRECTORY.url}`);
  }
}

export default function LoginLandingScreen() {
  const navigation = useNavigation();
  const auth = useNuniSession();
  const { school, selectionReady } = useSchool();
  const s = useThemeStyleSheet(createStyles);
  const [showWorkEntries, setShowWorkEntries] = useState(false);
  const [, refreshProviders] = useState(0);
  const [availabilityAttempt, setAvailabilityAttempt] = useState(0);
  const hasSchool = selectionReady !== false && Boolean(school.id);
  const schoolEntry = hasSchool && isSchoolLoginEntryAvailable(school.id);
  const schoolLoginState = hasSchool ? getSchoolLoginAvailabilityState(school.id) : 'unavailable';
  const checkingSchoolLogin = schoolLoginState === 'unknown' || schoolLoginState === 'loading';
  const platformReady = !!auth.session && !auth.loading && !auth.error && !auth.pendingLogout;
  // Do not displace an existing session or a pending platform recovery with school setup.
  const schoolFirst = schoolEntry && !auth.session && !auth.loading && !auth.error && !auth.pendingLogout;
  const schoolSignIn = (
    <Pressable
      testID="school-login-start"
      accessibilityRole="button"
      style={({ pressed }) => [s.secondaryAction, pressed && s.rowPressed]}
      onPress={() => safeNavigate(navigation, 'SSOLogin')}
    >
      <Text style={s.secondaryActionText}>使用學校帳號登入</Text>
    </Pressable>
  );
  const catalogTronClass = hasSchool ? getSchoolTronClassEntry(school.id, school.name) : null;
  const tronClassEntry =
    catalogTronClass && webViewShouldAllowRequestUrl(catalogTronClass.url) ? catalogTronClass : null;
  const tronClassOpenId = useRef(0);
  const [tronClassOpenFailed, setTronClassOpenFailed] = useState(false);
  useLayoutEffect(() => {
    setTronClassOpenFailed(false);
    return () => {
      tronClassOpenId.current += 1;
    };
  }, [school.id, tronClassEntry?.url]);
  async function openTronClass() {
    if (!tronClassEntry) return;
    const openId = ++tronClassOpenId.current;
    setTronClassOpenFailed(false);
    const opened = await webBrowserOpenWithPuTronClassGate(tronClassEntry.url);
    if (!opened && tronClassOpenId.current === openId) setTronClassOpenFailed(true);
  }
  useEffect(() => {
    if (!hasSchool) return;
    let active = true;
    const pending = loadSchoolLoginProviderKinds(school.id);
    refreshProviders((revision) => revision + 1);
    void pending.then(() => {
      if (active) refreshProviders((revision) => revision + 1);
    });
    return () => {
      active = false;
    };
  }, [hasSchool, school.id, availabilityAttempt]);

  const publicServices = (
    [
      ['Map', '校園地圖', '搜尋地點、查看位置與步行路線'],
      ['Library', '圖書館', `搜尋${school.name}的館藏與官方服務`],
      ['SchoolInfo', '學校資訊', '查看官方總機、網站與名錄地址'],
      ['StudentCard', '數位學生證', '出示學生證，或核對對方的校園身分'],
      ['BusSchedule', '公車查詢', '查看站點與官方到站資訊'],
      ['公告總覽', '公開公告', `查看${school.name}發布的消息`],
      ['活動總覽', '校園活動', '瀏覽活動與講座，查看已收藏的場次'],
      ['CourseCatalog', '課綱查詢', `查看${school.name}課綱或校方課程查詢入口`],
      ['Health', '校園健康', `查看${school.name}諮商、就醫與健康檢查資訊`],
      ['Dormitory', '宿舍服務', `查看${school.name}報修管道與入住事項；設備問題只存成個人備忘`],
      ['Career', '職涯資訊', `前往${school.name}職涯與就業輔導公開資訊`],
    ] as const
  ).filter(([route]) => platformReady || !guestCampusServices.some((service) => service.route === route));

  const schoolPanel = hasSchool ? (
    <View style={s.flatSection}>
      <Text accessibilityRole="header" style={s.sectionTitle}>
        {schoolEntry && !schoolFirst ? '學校帳號與資料' : '從學校資料開始'}
      </Text>
      <Text style={s.body} testID={schoolEntry ? undefined : 'school-login-hint'}>
        {schoolEntry
          ? '手動匯入仍可獨立使用，不需要登入學校；校方資料的連線狀態與平台帳號分別確認。'
          : schoolLoginState === 'error'
            ? '暫時無法確認學校登入方式，請重新確認。你仍可匯入自己的資料或使用公開資訊。'
            : checkingSchoolLogin
              ? '正在確認學校登入方式；你也可以先匯入自己的課表、成績或活動。'
              : '尚未開放學號直接登入；你仍可匯入自己從校務系統取得的資料。'}
      </Text>
      {schoolLoginState === 'error' ? (
        <Pressable
          testID="school-login-check-retry"
          accessibilityRole="button"
          style={({ pressed }) => [s.secondaryAction, pressed && s.rowPressed]}
          onPress={() => setAvailabilityAttempt((attempt) => attempt + 1)}
        >
          <Text style={s.secondaryActionText}>重新確認學校登入</Text>
        </Pressable>
      ) : null}
      {schoolEntry && !schoolFirst ? schoolSignIn : null}
      {tronClassEntry ? (
        <>
          <Pressable
            testID="school-tronclass-open"
            accessibilityRole="link"
            accessibilityLabel={`開啟學校官方 ${tronClassEntry.label}`}
            style={({ pressed }) => [s.secondaryAction, pressed && s.rowPressed]}
            onPress={() => void openTronClass()}
          >
            <Text style={s.secondaryActionText}>開啟學校官方 {tronClassEntry.label} →</Text>
          </Pressable>
          <Text style={s.note}>
            在校方網站登入即可查看自己的課程。這個入口不會同步資料到 nuni，也不會綁定 Google 帳號。
          </Text>
          {tronClassOpenFailed ? (
            <Text accessibilityRole="alert" style={s.note} testID="school-tronclass-open-failed">
              無法開啟學校網站，請稍後再試。
            </Text>
          ) : null}
        </>
      ) : null}
      <SchoolPortalImportEntry
        onOpenRecords={(kind) => safeNavigate(navigation, 'PersonalImport', { kind })}
      />
      <Pressable
        testID="school-import-start"
        accessibilityRole="button"
        accessibilityLabel="匯入課表、成績或活動"
        style={({ pressed }) => [s.secondaryAction, pressed && s.rowPressed]}
        onPress={() => safeNavigate(navigation, 'PersonalImport', { kind: 'timetable' })}
      >
        <Text style={s.secondaryActionText}>匯入課表、成績或活動 →</Text>
      </Pressable>
      <Text style={s.note}>支援學校網頁 HTML 存檔、截圖、PDF、CSV；先選表格並核對內容，不需要提供校務密碼。</Text>
    </View>
  ) : null;
  return (
    <SafeAreaView testID="login-landing" style={s.page}>
      <ScrollView
        testID="login-landing-scroll"
        contentContainerStyle={s.content}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        nestedScrollEnabled={false}
      >
        <View style={s.masthead}>
          <Text style={s.brand}>nuni</Text>
          <View style={s.mastheadActions}>
            <Pressable
              testID="platform-workspace-start"
              accessibilityRole="button"
              accessibilityLabel="開啟課程與作業"
              onPress={() => safeNavigate(navigation, 'NuniWorkspace', { tab: 'courses' })}
              style={({ pressed }) => [s.headerAction, pressed && s.rowPressed]}
            >
              <Text style={s.headerActionText}>課程與作業</Text>
            </Pressable>
            <View style={s.headerDivider} accessibilityElementsHidden />
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ expanded: showWorkEntries }}
              onPress={() => setShowWorkEntries((open) => !open)}
              style={({ pressed }) => [s.headerAction, pressed && s.rowPressed]}
            >
              <Text style={s.headerActionMuted}>店家與教職員入口</Text>
              <Ionicons
                name={showWorkEntries ? 'chevron-up' : 'chevron-down'}
                size={14}
                color={theme.colors.muted}
              />
            </Pressable>
          </View>
        </View>

        {showWorkEntries && (
          <View style={s.workSheet}>
            <Text accessibilityRole="header" style={s.sectionLabel}>選擇工作入口</Text>
            <View style={s.dividedList}>
              {workEntries.map((entry, index) => (
                <Pressable
                  key={entry.title}
                  accessibilityRole={'path' in entry ? 'link' : 'button'}
                  accessibilityLabel={entry.title}
                  accessibilityHint={entry.detail}
                  onPress={() =>
                    'path' in entry
                      ? void openStaffLogin(entry.path)
                      : safeNavigate(navigation, 'NuniWorkspace', { tab: entry.tab })
                  }
                  style={({ pressed }) => [
                    s.listRow,
                    index > 0 && s.rowDivider,
                    pressed && s.rowPressed,
                  ]}
                >
                  <View style={s.rowCopy}>
                    <Text style={s.rowTitle}>{entry.title}</Text>
                    <Text style={s.rowDetail}>{entry.detail}</Text>
                  </View>
                  <Ionicons
                    name={'path' in entry ? 'open-outline' : 'chevron-forward'}
                    size={16}
                    color={theme.colors.muted}
                  />
                </Pressable>
              ))}
            </View>
          </View>
        )}

        <View style={s.hero}>
          {hasSchool && <Text style={s.contextLine}>{school.name}</Text>}
          <Text accessibilityRole="header" style={s.heading}>
            {platformReady ? '我的校園' : '校園服務'}
          </Text>
          <Text style={s.lead}>
            {platformReady
              ? '查看課表、處理作業或追蹤訂單。'
              : schoolFirst
                ? '先驗證學校帳號，也可以使用 Google 帳號進入平台。'
                : hasSchool
                ? '校園公開資訊免登入。'
                : '免登入。先選服務，再選擇要瀏覽的學校。'}
          </Text>
          <WorkspaceStart navigation={navigation}
            scope={JSON.stringify([auth.session?.platformAccountId, auth.session?.context, auth.pendingLogout, auth.error, school.id, selectionReady])}
            assistantRoute={platformReady ? 'NuniTimetableAssistant' : 'AIChat'} />

          {!platformReady && (
            <View style={s.guestIndex}>
              {guestCampusServices.map(({ route, title, icon }, index) => (
                <Pressable
                  key={route}
                  testID={`public-${route}`}
                  accessibilityRole="button"
                  accessibilityLabel={title}
                  style={({ pressed }) => [
                    s.guestRow,
                    index > 0 && s.rowDivider,
                    pressed && s.rowPressed,
                  ]}
                  onPress={() => safeNavigate(navigation, route)}
                >
                  <Ionicons
                    name={icon}
                    size={18}
                    color={theme.colors.accent}
                    accessibilityElementsHidden
                  />
                  <Text style={s.guestRowTitle}>{title}</Text>
                  <Text style={s.rowArrow} accessibilityElementsHidden>→</Text>
                </Pressable>
              ))}
            </View>
          )}

          {platformReady && (
            <Pressable
              accessibilityRole="button"
              onPress={() => safeNavigate(navigation, 'NuniTimetableAssistant')}
              style={({ pressed }) => [s.secondaryAction, s.heroAssistantAction, pressed && s.rowPressed]}
            >
              <Text style={s.secondaryActionText}>開啟課表助理</Text>
              <Ionicons name="chevron-forward" size={16} color={theme.colors.accent} />
            </Pressable>
          )}
        </View>
        {schoolFirst && (
          <View style={s.flatSection}>
            <Text accessibilityRole="header" style={s.sectionTitle}>使用學校帳號開始</Text>
            <Text style={s.body}>前往 {school.name} 的帳號驗證，依學校授權取得可用的校園與課程資料。</Text>
            {schoolSignIn}
          </View>
        )}

        <View style={s.accountCard}>
          <View style={s.accountCardBody}>
            <View
              testID="login-google-account"
              collapsable={false}
              accessible
              accessibilityRole="header"
              accessibilityLabel={platformReady ? '我的 nuni' : 'Google 帳號'}
            >
              <Text accessible={false} style={s.cardHeading}>
                {platformReady ? '我的 nuni' : 'Google 帳號'}
              </Text>
            </View>
            {!platformReady ? (
              <>
                <Text style={s.body}>
                  用 Google 帳號修課、交作業及查看訂單。網頁與 App 使用同一個帳號。
                </Text>
                <Text style={s.note}>
                  校方私人資料、已驗證學生服務與店家管理，仍依各服務的資格與授權開放。
                </Text>
              </>
            ) : (
              <Text style={s.body}>
                修課與授課依每門課的資格顯示，先選課程就能接續作業或教學工作。
              </Text>
            )}
            {auth.pendingLogout || auth.error ? (
              <View style={s.alertBox}>
                <Text accessibilityRole="alert" style={s.alertText}>
                  {auth.pendingLogout
                    ? '上次登出還沒完成，請先完成登出再使用其他帳號。'
                    : auth.error}
                </Text>
              </View>
            ) : null}
            <Pressable
              testID="login-start"
              accessibilityRole="button"
              style={({ pressed }) => [s.primaryButton, pressed && s.primaryButtonPressed]}
              onPress={() =>
                platformReady
                  ? safeNavigate(navigation, 'NuniWorkspace', { tab: 'courses' })
                  : safeNavigate(navigation, 'NuniWorkspace')
              }
            >
              <Text style={s.primaryButtonText}>
                {platformReady
                  ? '回到我的課程'
                  : auth.loading
                    ? '確認 Google 帳號'
                    : auth.pendingLogout
                      ? '處理未完成的登出'
                      : auth.error
                        ? '查看登入問題'
                        : '登入或建立帳號'}
              </Text>
            </Pressable>
            {platformReady ? (
              <View style={s.accountTaskList}>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => safeNavigate(navigation, 'NuniWorkspace', { tab: 'food' })}
                  style={({ pressed }) => [s.listRow, pressed && s.rowPressed]}
                >
                  <View style={s.rowCopy}>
                    <Text style={s.rowTitle}>點餐與訂單</Text>
                    <Text style={s.rowDetail}>查看已開放門市與自己的訂單</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={16} color={theme.colors.muted} />
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => safeNavigate(navigation, 'NuniWorkspace', { tab: 'account' })}
                  style={({ pressed }) => [s.listRow, s.rowDivider, pressed && s.rowPressed]}
                >
                  <View style={s.rowCopy}>
                    <Text style={s.rowTitle}>帳號與資格</Text>
                    <Text style={s.rowDetail}>確認學校資格、帳號與登入狀態</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={16} color={theme.colors.muted} />
                </Pressable>
                {auth.session?.isPlatformOperator ? (
                  <Pressable
                    accessibilityRole="link"
                    onPress={() => void openStaffLogin('/admin')}
                    style={({ pressed }) => [s.listRow, s.rowDivider, pressed && s.rowPressed]}
                  >
                    <View style={s.rowCopy}>
                      <Text style={s.rowTitle}>平台管理（網頁）</Text>
                      <Text style={s.rowDetail}>處理平台待辦與查閱操作紀錄</Text>
                    </View>
                    <Ionicons name="open-outline" size={16} color={theme.colors.muted} />
                  </Pressable>
                ) : null}
              </View>
            ) : null}
          </View>
        </View>
        <Pressable
          accessibilityRole="link"
          accessibilityLabel={TRONCLASS_LOGIN_DIRECTORY.label}
          accessibilityHint={TRONCLASS_LOGIN_DIRECTORY.description}
          onPress={() => void openTronClassDirectory()}
          style={({ pressed }) => [s.directoryRow, pressed && s.rowPressed]}
        >
          <Text style={s.rowTitle}>{TRONCLASS_LOGIN_DIRECTORY.label} ↗</Text>
          <Text style={s.note}>{TRONCLASS_LOGIN_DIRECTORY.description}</Text>
        </Pressable>
        {platformReady && hasSchool ? (
          <View style={s.sectionBlock}>
            <TodayTimetablePanel
              assistantAccountId={auth.session?.platformAccountId}
              onAskCoursework={(prompt) => safeNavigate(navigation, 'NuniTimetableAssistant', { prompt })}
              eventAction={auth.session ? {
                accountId: auth.session.platformAccountId,
                expiresAt: auth.session.expiresAt,
                open: (eventId, eventScope) => {
                  const session = auth.session;
                  if (session && auth.isSessionCurrent(session.platformAccountId, session.context))
                    safeNavigate(navigation, 'PersonalCalendar', { eventId, eventScope });
                },
              } : undefined}
              onOpenImport={() => safeNavigate(navigation, 'PersonalImport', { kind: 'timetable' })}
              onOpenTimetable={(term) =>
                safeNavigate(navigation, 'PersonalTimetable', term ? { term } : undefined)
              }
            />
            <Pressable
              testID="public-PersonalCalendar"
              accessibilityRole="button"
              accessibilityLabel="個人行事曆"
              style={({ pressed }) => [s.directoryRow, pressed && s.rowPressed]}
              onPress={() => safeNavigate(navigation, 'PersonalCalendar')}
            >
              <View style={s.rowCopy}>
                <Text style={s.rowTitle}>個人行事曆</Text>
                <Text style={s.rowDetail}>查看自己的活動、考試與接下來的安排</Text>
              </View>
              <Text style={s.rowArrow} accessibilityElementsHidden>→</Text>
            </Pressable>
          </View>
        ) : null}

        <View style={s.schoolControlWrap}>
          <SchoolBrowsingControl />
        </View>

        <View style={s.flatSection}>
          <View style={s.sectionHeaderRow}>
            <Text accessibilityRole="header" style={s.sectionTitle}>失物招領</Text>
          </View>
          <Text style={s.body}>
            用 Google 帳號刊登遺失或拾獲資訊，查看聯絡方式，並管理自己的刊登。
          </Text>
          <Pressable
            testID="platform-lost-found-start"
            accessibilityRole="button"
            accessibilityLabel="開啟平台失物招領"
            style={({ pressed }) => [s.secondaryAction, pressed && s.rowPressed]}
            onPress={() => safeNavigate(navigation, 'PlatformLostFound')}
          >
            <Text style={s.secondaryActionText}>開啟失物招領 →</Text>
          </Pressable>
        </View>
        {schoolPanel}
        {hasSchool && (
          <View style={s.directorySection}>
            <View style={s.sectionHeaderRow}>
              <Text accessibilityRole="header" style={s.sectionTitle}>
                學校公開資訊
              </Text>
            </View>
            <View style={s.dividedList}>
              {publicServices.map(([route, title, detail], index) => (
                <Pressable
                  key={route}
                  testID={`public-${route}`}
                  accessibilityRole="button"
                  accessibilityLabel={title}
                  style={({ pressed }) => [
                    s.directoryRow,
                    index > 0 && s.rowDivider,
                    pressed && s.rowPressed,
                  ]}
                  onPress={() => safeNavigate(navigation, route)}
                >
                  <View style={s.rowCopy}>
                    <Text style={s.rowTitle}>{title}</Text>
                    <Text style={s.rowDetail}>{detail}</Text>
                  </View>
                  <Text
                    style={s.rowArrow}
                    accessibilityElementsHidden
                    importantForAccessibility="no"
                  >
                    →
                  </Text>
                </Pressable>
              ))}
            </View>
            {!platformReady ? (
              <View style={s.guestPlannerWrap}>
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
                  style={({ pressed }) => [s.directoryRow, s.rowDivider, pressed && s.rowPressed]}
                  onPress={() => safeNavigate(navigation, 'PersonalCalendar')}
                >
                  <View style={s.rowCopy}>
                    <Text style={s.rowTitle}>個人行事曆</Text>
                    <Text style={s.rowDetail}>新增、編輯自己的活動與考試；不必學校帳號。</Text>
                  </View>
                  <Text style={s.rowArrow} accessibilityElementsHidden>→</Text>
                </Pressable>
              </View>
            ) : null}
          </View>
        )}

        <View style={s.demoSection}>
          <Text accessibilityRole="header" style={s.demoTitle}>
            口試示範工作區
          </Text>
          <Text style={s.note}>
            本機示範資料，涵蓋學生、教師、校方、店家與平台營運。不會登入真實校園，也不會寫入正式資料庫。
          </Text>
          <Pressable
            testID="oral-exam-demo-start"
            accessibilityRole="button"
            accessibilityLabel="開啟口試示範工作區"
            style={({ pressed }) => [s.quietLinkButton, pressed && s.rowPressed]}
            onPress={() => safeNavigate(navigation, 'OralExamDemo')}
          >
            <Text style={s.quietLinkText}>開啟口試示範 →</Text>
          </Pressable>
        </View>

      </ScrollView>
    </SafeAreaView>
  );
}

const createStyles = () =>
  StyleSheet.create({
    page: { flex: 1, backgroundColor: theme.colors.bg },
    content: {
      paddingHorizontal: 22,
      paddingTop: 12,
      paddingBottom: 24,
      flexGrow: 1,
      width: '100%',
      maxWidth: 640,
      alignSelf: 'center',
    },
    masthead: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 8,
      paddingBottom: 12,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.colors.border,
    },
    brand: {
      color: theme.colors.text,
      letterSpacing: -0.5,
      fontWeight: '700',
      fontSize: 19,
    },
    mastheadActions: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'center',
      gap: 4,
    },
    headerAction: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      minHeight: 44,
      paddingHorizontal: 8,
      borderRadius: 6,
    },
    headerDivider: {
      width: 1,
      height: 14,
      backgroundColor: theme.colors.border,
    },
    headerActionText: {
      color: theme.colors.accent,
      fontSize: 13,
      fontWeight: '600',
    },
    headerActionMuted: {
      color: theme.colors.textSecondary,
      fontSize: 13,
      fontWeight: '500',
    },
    workSheet: {
      marginTop: 14,
      paddingHorizontal: 16,
      paddingTop: 14,
      paddingBottom: 4,
      backgroundColor: theme.colors.surface,
      borderWidth: 1,
      borderColor: theme.colors.border,
      borderRadius: 10,
    },
    sectionLabel: {
      color: theme.colors.textSecondary,
      fontSize: 13,
      lineHeight: 19,
      fontWeight: '600',
      paddingBottom: 8,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.colors.border,
    },
    hero: {
      paddingTop: 28,
      paddingBottom: 24,
    },
    contextLine: {
      color: theme.colors.textSecondary,
      fontSize: 13,
      lineHeight: 19,
      fontWeight: '500',
      marginBottom: 8,
    },
    heading: {
      fontFamily: pageTitleFont,
      color: theme.colors.text,
      fontSize: 32,
      fontWeight: '700',
      lineHeight: 42,
      letterSpacing: -0.7,
    },
    lead: {
      color: theme.colors.muted,
      fontSize: 14,
      lineHeight: 23,
      marginTop: 10,
    },
    guestIndex: {
      marginTop: 20,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderColor: theme.colors.border,
    },
    guestRow: {
      minHeight: 54,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingVertical: 12,
      paddingHorizontal: 2,
    },
    guestRowTitle: {
      flex: 1,
      color: theme.colors.text,
      fontSize: 16,
      lineHeight: 23,
      fontWeight: '600',
    },
    heroAssistantAction: {
      marginTop: 18,
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    accountCard: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.colors.border,
    },
    accountCardBody: { paddingVertical: 18 },
    cardHeading: {
      color: theme.colors.text,
      fontSize: 19,
      lineHeight: 27,
      fontWeight: '700',
      letterSpacing: -0.2,
    },
    body: {
      color: theme.colors.textSecondary,
      fontSize: 14,
      lineHeight: 23,
      marginTop: 8,
    },
    note: {
      color: theme.colors.muted,
      fontSize: 12,
      lineHeight: 19,
      marginTop: 8,
    },
    alertBox: {
      marginTop: 12,
      paddingLeft: 12,
      paddingVertical: 6,
      borderLeftWidth: 3,
      borderLeftColor: theme.colors.danger,
    },
    alertText: {
      color: theme.colors.danger,
      fontSize: 13,
      lineHeight: 20,
      fontWeight: '500',
    },
    primaryButton: {
      backgroundColor: theme.colors.accent,
      minHeight: 50,
      justifyContent: 'center',
      alignItems: 'center',
      paddingHorizontal: 18,
      paddingVertical: 14,
      borderRadius: 8,
      marginTop: 18,
    },
    primaryButtonPressed: {
      backgroundColor: theme.colors.accentHover,
    },
    primaryButtonText: {
      color: theme.colors.onAccent,
      textAlign: 'center',
      fontSize: 15,
      fontWeight: '600',
    },
    accountTaskList: {
      marginTop: 14,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.colors.border,
    },
    sectionBlock: {
      marginTop: 22,
    },
    schoolControlWrap: {
      marginTop: 20,
    },
    flatSection: {
      marginTop: 28,
      paddingTop: 20,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.colors.border,
      gap: 6,
    },
    directorySection: {
      marginTop: 28,
      paddingTop: 20,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.colors.border,
    },
    sectionHeaderRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'baseline',
      justifyContent: 'space-between',
      gap: 8,
      paddingBottom: 8,
    },
    sectionTitle: {
      color: theme.colors.text,
      fontSize: 17,
      lineHeight: 24,
      fontWeight: '700',
      letterSpacing: -0.2,
    },
    dividedList: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.colors.border,
    },
    listRow: {
      minHeight: 56,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingVertical: 12,
    },
    directoryRow: {
      minHeight: 64,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 14,
      paddingVertical: 13,
      paddingHorizontal: 2,
    },
    rowDivider: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.colors.border,
    },
    rowCopy: {
      flex: 1,
      minWidth: 0,
    },
    rowTitle: {
      color: theme.colors.text,
      fontSize: 15,
      fontWeight: '600',
      lineHeight: 22,
    },
    rowDetail: {
      color: theme.colors.muted,
      fontSize: 13,
      lineHeight: 20,
      marginTop: 2,
    },
    rowArrow: {
      color: theme.colors.accent,
      fontSize: 18,
    },
    secondaryAction: {
      minHeight: 46,
      alignSelf: 'stretch',
      justifyContent: 'center',
      paddingVertical: 11,
      paddingHorizontal: 14,
      marginTop: 8,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.surface,
    },
    secondaryActionText: {
      color: theme.colors.accent,
      textAlign: 'center',
      fontSize: 14,
      fontWeight: '600',
    },
    guestPlannerWrap: {
      marginTop: 18,
    },
    demoSection: {
      marginTop: 28,
      paddingTop: 18,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.colors.border,
    },
    demoTitle: {
      color: theme.colors.textSecondary,
      fontSize: 14,
      lineHeight: 20,
      fontWeight: '600',
    },
    quietLinkButton: {
      minHeight: 44,
      alignSelf: 'flex-start',
      justifyContent: 'center',
      paddingVertical: 8,
      paddingHorizontal: 2,
      marginTop: 4,
    },
    quietLinkText: {
      color: theme.colors.accent,
      fontSize: 14,
      fontWeight: '600',
    },
    rowPressed: {
      backgroundColor: theme.colors.surfaceInteractive,
    },
  });
