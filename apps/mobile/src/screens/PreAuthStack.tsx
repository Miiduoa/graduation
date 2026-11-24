import React from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { useGuestCampusHandoff } from '../app/guestCampusHandoff';
import { guestCampusServices } from './guestCampusServices';
import LoginLandingScreen from './LoginLandingScreen';
import { ExploreScreen } from './ExploreScreen';
import { GoogleMapsLikeScreen } from './GoogleMapsLikeScreen';
import BusAiFirstScreen from './BusAiFirstScreen';
import LibraryAiFirstScreen from './LibraryAiFirstScreen';
import LibraryCatalogScreen from './LibraryCatalogScreen';
import SchoolInfoScreen from './SchoolInfoScreen';
import { CampusAnnouncementsScreen, CampusAnnouncementDetailScreen } from './CampusContentScreens';
import { SSOLoginScreen } from './SSOLoginScreen';
import { NuniWorkspaceScreen } from './NuniWorkspaceScreen';
import PersonalImportScreen from './PersonalImportScreen';
import { PublicPersonalTimetable } from './PersonalTimetableScreen';
import { PublicPersonalCalendar } from './PersonalCalendarScreen';
import { CourseCatalogScreen } from './CourseCatalogScreen';
import { HealthScreen } from './HealthScreen';
import { DormitoryScreen } from './DormitoryScreen';
import { PlatformLostFoundScreen } from './PlatformLostFoundScreen';
import type { ServiceScreenProps } from './UnavailableFeatureScreen';
import type { PreAuthStackParamList } from './preAuthTypes';
import { createStackScreenOptions } from '../ui/navigationTheme';
import { AIButton } from '../ui/aiFirst';
import { useNuniSession } from '../state/nuniSession';
import { SchoolBrowsingControl } from '../components/SchoolBrowsingControl';
import { useReducedMotion } from '../hooks/useReducedMotion';
import { useSchool } from '../state/school';
import { theme } from '../ui/theme';
import { useThemeMode } from '../state/theme';

const Stack = createNativeStackNavigator<PreAuthStackParamList, undefined>();

function PublicCareerScreen(props: ServiceScreenProps) {
  const { CareerScreen } = require('./CareerScreen') as typeof import('./CareerScreen');
  return <CareerScreen navigation={props.navigation} />;
}

function PublicSchoolRoute({ children, route, onCancel, onHome }: {
  children: React.ReactNode;
  route: keyof PreAuthStackParamList;
  onCancel: () => void;
  onHome: () => void;
}) {
  const { school, selectionReady } = useSchool();
  const handoff = useGuestCampusHandoff();
  const service = guestCampusServices.find((item) => item.route === route);
  // When the canonical scope did not remount navigation, this route already resumed in place.
  React.useEffect(() => { if (school.id && service) handoff?.clear(); }, [school.id, service, handoff]);
  if (selectionReady === false) return <ActivityIndicator accessibilityLabel="正在讀取選校設定" />;
  if (school.id) return <>{children}</>;
  if (service) {
    return <SchoolBrowsingControl destination={{
      title: service.title,
      onChoose: (schoolId) => handoff?.remember({ route: service.route, schoolId }),
      onCancel: () => { handoff?.clear(); onCancel(); },
    }} />;
  }
  return (
    <SafeAreaView style={{ flex: 1, padding: 20, backgroundColor: theme.colors.bg }}>
      <View style={{ gap: 14 }}>
        <Text accessibilityRole="header" style={{ color: theme.colors.text, fontSize: 22, fontWeight: '700' }}>
          先選擇要瀏覽的學校
        </Text>
        <Text style={{ color: theme.colors.muted }}>選校後會開啟你剛才要看的頁面。</Text>
        <SchoolBrowsingControl />
        <AIButton label="返回首頁" variant="ghost" onPress={onHome} />
      </View>
    </SafeAreaView>
  );
}

/**
 * 平台帳號與學校帳號各自驗證，與 MeStack 共用同一入口。
 */
export function PreAuthStack() {
  useThemeMode();
  const reducedMotion = useReducedMotion();
  const platform = useNuniSession();
  const platformReady = !!platform.session && !platform.loading && !platform.error && !platform.pendingLogout;

  return (
    <Stack.Navigator
      initialRouteName="LoginLanding"
      screenLayout={({ children, route, navigation }) =>
        route.name === 'LoginLanding' || route.name === 'Explore' || route.name === 'AIChat' || route.name === 'NuniWorkspace' || route.name === 'TronClassWorkspace' || route.name === 'OralExamDemo' ? <>{children}</> : (
          <PublicSchoolRoute
            route={route.name}
            onCancel={() => navigation.canGoBack() ? navigation.goBack() : navigation.navigate('LoginLanding')}
            onHome={() => navigation.navigate('LoginLanding')}
          >{children}</PublicSchoolRoute>
        )
      }
      screenOptions={{ ...createStackScreenOptions(), ...(reducedMotion ? { animation: 'none' as const } : {}) }}
      id={undefined}
    >
      <Stack.Screen
        name="LoginLanding"
        component={LoginLandingScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen name="Explore" component={ExploreScreen} options={{ title: '探索' }} />
      <Stack.Screen name="AIChat" getComponent={() => require('./CampusAssistantScreen').CampusAssistantScreen}
        options={{ title: '校園助理', headerShown: false }} />
      <Stack.Screen name="Map" component={GoogleMapsLikeScreen} options={{ headerShown: false }} />
      <Stack.Screen name="Library" component={LibraryAiFirstScreen} options={{ headerShown: false }} />
      <Stack.Screen name="LibraryCatalog" component={LibraryCatalogScreen} options={{ headerShown: false }} />
      <Stack.Screen name="StudentCard" getComponent={() => require('./StudentCardScreen').default} options={{ title: '數位學生證' }} />
      <Stack.Screen name="SchoolInfo" component={SchoolInfoScreen} options={{ headerShown: false }} />
      <Stack.Screen
        name="BusSchedule"
        component={BusAiFirstScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="公告總覽"
        component={CampusAnnouncementsScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="公告詳情"
        component={CampusAnnouncementDetailScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="CourseCatalog"
        component={CourseCatalogScreen}
        options={{ title: '課綱查詢' }}
      />
      <Stack.Screen
        name="Health"
        component={HealthScreen}
        options={{ headerShown: false, title: '校園健康' }}
      />
      <Stack.Screen
        name="Dormitory"
        component={DormitoryScreen}
        options={{ headerShown: false, title: '宿舍服務' }}
      />
      <Stack.Screen
        name="Career"
        component={PublicCareerScreen}
        options={{ headerShown: false, title: '職涯' }}
      />
      <Stack.Screen name="PlatformLostFound" component={PlatformLostFoundScreen} options={{ title: '失物招領' }} />
      <Stack.Screen name="SSOLogin" component={SSOLoginScreen} options={{ title: '學校登入' }} />
      <Stack.Screen name="TronClassWorkspace" getComponent={() => require('./TronClassWorkspaceScreen').TronClassWorkspaceScreen} options={{ title: 'TronClass 課務' }} />
      <Stack.Screen
        name="OralExamDemo"
        getComponent={() => require('./OralExamDemoScreen').default}
        options={{ title: '口試示範工作區' }}
      />
      <Stack.Screen
        name="NuniTimetableAssistant"
        getComponent={() => require('./NuniTimetableAssistantScreen').NuniTimetableAssistantScreen}
        options={{ title: '課表助理', headerShown: false }}
      />
      <Stack.Screen name="PersonalImport" component={PersonalImportScreen} options={{ title: '匯入我的資料' }} />
      <Stack.Screen name="PersonalTimetable" component={PublicPersonalTimetable} options={{ title: '我的課表' }} />
      <Stack.Screen
        name="PersonalCalendar"
        component={PublicPersonalCalendar}
        options={{ title: '個人行事曆' }}
      />
      <Stack.Screen
        name="NuniWorkspace"
        component={NuniWorkspaceScreen}
        options={({ navigation }) => ({
          title: 'nuni',
          headerRight: platformReady ? () => (
            <AIButton label="問課表" variant="ghost" style={{ minHeight: 44 }}
              onPress={() => navigation.navigate('NuniTimetableAssistant')} />
          ) : undefined,
        })}
      />
    </Stack.Navigator>
  );
}
