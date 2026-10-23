import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import LoginLandingScreen from './LoginLandingScreen';
import { GoogleMapsLikeScreen } from './GoogleMapsLikeScreen';
import BusAiFirstScreen from './BusAiFirstScreen';
import LibraryAiFirstScreen from './LibraryAiFirstScreen';
import LibraryCatalogScreen from './LibraryCatalogScreen';
import { CampusAnnouncementsScreen, CampusAnnouncementDetailScreen } from './CampusContentScreens';
import { SSOLoginScreen } from './SSOLoginScreen';
import { NuniWorkspaceScreen } from './NuniWorkspaceScreen';
import PersonalImportScreen from './PersonalImportScreen';
import PersonalTimetableScreen from './PersonalTimetableScreen';
import type { PreAuthStackParamList } from './preAuthTypes';
import { createStackScreenOptions } from '../ui/navigationTheme';
import { useThemeMode } from '../state/theme';

const Stack = createNativeStackNavigator<PreAuthStackParamList, undefined>();

/**
 * 平台帳號與學校帳號各自驗證，與 MeStack 共用同一入口。
 */
export function PreAuthStack() {
  useThemeMode();

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
      <Stack.Screen name="SSOLogin" component={SSOLoginScreen} options={{ title: '學校登入' }} />
      <Stack.Screen name="PersonalImport" component={PersonalImportScreen} options={{ title: '匯入我的資料' }} />
      <Stack.Screen name="PersonalTimetable" component={PersonalTimetableScreen} options={{ title: '我的課表' }} />
      <Stack.Screen
        name="NuniWorkspace"
        component={NuniWorkspaceScreen}
        options={{ title: 'Campus One' }}
      />
    </Stack.Navigator>
  );
}
