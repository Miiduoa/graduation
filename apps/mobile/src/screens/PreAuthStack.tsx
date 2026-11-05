import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import LoginLandingScreen from './LoginLandingScreen';
import { GoogleMapsLikeScreen } from './GoogleMapsLikeScreen';
import BusAiFirstScreen from './BusAiFirstScreen';
import LibraryAiFirstScreen from './LibraryAiFirstScreen';
import LibraryCatalogScreen from './LibraryCatalogScreen';
import SchoolInfoScreen from './SchoolInfoScreen';
import { CampusAnnouncementsScreen, CampusAnnouncementDetailScreen } from './CampusContentScreens';
import { SSOLoginScreen } from './SSOLoginScreen';
import { NuniWorkspaceScreen } from './NuniWorkspaceScreen';
import PersonalImportScreen from './PersonalImportScreen';
import PersonalTimetableScreen from './PersonalTimetableScreen';
import PersonalCalendarScreen from './PersonalCalendarScreen';
import { CourseCatalogScreen } from './CourseCatalogScreen';
import { HealthScreen } from './HealthScreen';
import { DormitoryScreen } from './DormitoryScreen';
import { UnavailableFeatureScreen, type ServiceScreenProps } from './UnavailableFeatureScreen';
import type { PreAuthStackParamList } from './preAuthTypes';
import { createStackScreenOptions } from '../ui/navigationTheme';
import { AIButton } from '../ui/aiFirst';
import { useNuniSession } from '../state/nuniSession';
import { useThemeMode } from '../state/theme';

const Stack = createNativeStackNavigator<PreAuthStackParamList, undefined>();

/** Public guest stack may only deep-link into registered PreAuth routes. */
const PUBLIC_UNAVAILABLE_ACTIONS = [{ label: '查看校方公告', route: '公告總覽' }];

function PublicCareerScreen(props: ServiceScreenProps) {
  return (
    <UnavailableFeatureScreen
      {...props}
      route={{ ...props.route, name: 'Career' }}
      actions={PUBLIC_UNAVAILABLE_ACTIONS}
    />
  );
}

/**
 * 平台帳號與學校帳號各自驗證，與 MeStack 共用同一入口。
 */
export function PreAuthStack() {
  useThemeMode();
  const platform = useNuniSession();
  const platformReady = !!platform.session && !platform.loading && !platform.error && !platform.pendingLogout;

  return (
    <Stack.Navigator
      initialRouteName="LoginLanding"
      screenOptions={createStackScreenOptions()}
      id={undefined}
    >
      <Stack.Screen
        name="LoginLanding"
        component={LoginLandingScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen name="Map" component={GoogleMapsLikeScreen} options={{ headerShown: false }} />
      <Stack.Screen name="Library" component={LibraryAiFirstScreen} options={{ headerShown: false }} />
      <Stack.Screen name="LibraryCatalog" component={LibraryCatalogScreen} options={{ headerShown: false }} />
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
      <Stack.Screen name="SSOLogin" component={SSOLoginScreen} options={{ title: '學校登入' }} />
      <Stack.Screen
        name="NuniTimetableAssistant"
        getComponent={() => require('./NuniTimetableAssistantScreen').NuniTimetableAssistantScreen}
        options={{ title: '課表助理', headerShown: false }}
      />
      <Stack.Screen name="PersonalImport" component={PersonalImportScreen} options={{ title: '匯入我的資料' }} />
      <Stack.Screen name="PersonalTimetable" component={PersonalTimetableScreen} options={{ title: '我的課表' }} />
      <Stack.Screen
        name="PersonalCalendar"
        component={PersonalCalendarScreen}
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
