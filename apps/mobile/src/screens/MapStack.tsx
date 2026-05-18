/* eslint-disable */
import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { CampusHubScreen } from './CampusHubScreen';
import { ARNavigationScreen } from './ARNavigationScreen';
import { AccessibleRouteScreen } from './AccessibleRouteScreen';
import { OnBusModeScreen } from './OnBusModeScreen';
import { GoogleMapsLikeScreen } from './GoogleMapsLikeScreen';
import { BusStopDetailScreen } from './BusStopDetailScreen';
import { TripPlannerScreen } from './TripPlannerScreen';
import { IndoorFloorMapScreen } from './IndoorFloorMapScreen';
import { TransportHubScreen } from './TransportHubScreen';
// AI-First v1（已是主入口；舊版檔案已刪除）
import CafeteriaAiFirstScreen from './CafeteriaAiFirstScreen';
import PoiDetailAiFirstScreen from './PoiDetailAiFirstScreen';
import BusAiFirstScreen from './BusAiFirstScreen';
import MenuDetailAiFirstScreen from './MenuDetailAiFirstScreen';
import LibraryAiFirstScreen from './LibraryAiFirstScreen';
import ClubsAiFirstScreen from './ClubsAiFirstScreen';
import { OrderingScreen } from './OrderingScreen';
import { MenuSubscriptionScreen } from './MenuSubscriptionScreen';
import { LibraryCatalogScreen } from './LibraryCatalogScreen';
import { HealthScreen } from './HealthScreen';
import { DormitoryScreen } from './DormitoryScreen';
import { PrintServiceScreen } from './PrintServiceScreen';
import { LostFoundScreen } from './LostFoundScreen';
import { LostFoundDetailScreen } from './LostFoundDetailScreen';
import { LostFoundPostScreen } from './LostFoundPostScreen';
import { PaymentScreen } from './PaymentScreen';
import { useThemeMode } from '../state/theme';
import { createStackScreenOptions } from '../ui/navigationTheme';

const Stack = createNativeStackNavigator<any, undefined>();

export function MapStack() {
  useThemeMode();

  return (
    <Stack.Navigator
      id={undefined}
      initialRouteName="CampusHome"
      screenOptions={createStackScreenOptions()}
    >
      <Stack.Screen
        name="CampusHome"
        component={CampusHubScreen}
        options={{ title: '校園', headerShown: false }}
      />
      {/* 校園地圖 — Map 與 MapV2 為同一個新版實作（GoogleMapsLikeScreen）；
          'Map' 保留只是為了相容舊 deep link / AI agent 路由；新代碼一律用 'MapV2'。 */}
      <Stack.Screen
        name="Map"
        component={GoogleMapsLikeScreen}
        options={{ title: '校園地圖', headerShown: false }}
      />
      <Stack.Screen
        name="MapV2"
        component={GoogleMapsLikeScreen}
        options={{ title: '校園地圖', headerShown: false }}
      />
      <Stack.Screen
        name="PoiDetail"
        component={PoiDetailAiFirstScreen}
        options={{ title: '點位詳情', headerShown: false }}
      />
      <Stack.Screen
        name="ARNavigation"
        component={ARNavigationScreen}
        options={{ title: 'AR 導航' }}
      />
      <Stack.Screen
        name="AccessibleRoute"
        component={AccessibleRouteScreen}
        options={{ title: '無障礙路線' }}
      />
      <Stack.Screen
        name="BusSchedule"
        component={BusAiFirstScreen}
        options={{ title: '校園公車', headerShown: false }}
      />
      <Stack.Screen
        name="BusV2"
        component={BusAiFirstScreen}
        options={{ title: '校園公車', headerShown: false }}
      />
      <Stack.Screen
        name="OnBusMode"
        component={OnBusModeScreen}
        options={{ title: '搭車中', headerShown: false }}
      />
      <Stack.Screen
        name="BusStopDetail"
        component={BusStopDetailScreen}
        options={{ title: '站點詳情' }}
      />
      <Stack.Screen
        name="TripPlanner"
        component={TripPlannerScreen}
        options={{ title: '路線規劃' }}
      />
      <Stack.Screen
        name="IndoorFloorMap"
        component={IndoorFloorMapScreen}
        options={{ title: '樓層平面圖', headerShown: false }}
      />
      <Stack.Screen
        name="TransportHub"
        component={TransportHubScreen}
        options={{ title: '交通資訊' }}
      />
      <Stack.Screen
        name="餐廳總覽"
        component={CafeteriaAiFirstScreen}
        options={{ title: '餐廳', headerShown: false }}
      />
      <Stack.Screen
        name="Cafeteria"
        component={CafeteriaAiFirstScreen}
        options={{ title: '餐廳', headerShown: false }}
      />
      <Stack.Screen
        name="MenuDetail"
        component={MenuDetailAiFirstScreen}
        options={{ title: '餐點詳情' }}
      />
      <Stack.Screen name="Ordering" component={OrderingScreen} options={{ title: '線上點餐' }} />
      <Stack.Screen
        name="MenuSubscription"
        component={MenuSubscriptionScreen}
        options={{ title: '菜單訂閱' }}
      />
      <Stack.Screen
        name="Library"
        component={LibraryAiFirstScreen}
        options={{ title: '圖書館', headerShown: false }}
      />
      <Stack.Screen
        name="Clubs"
        component={ClubsAiFirstScreen}
        options={{ title: '社團', headerShown: false }}
      />
      <Stack.Screen
        name="LibraryCatalog"
        component={LibraryCatalogScreen}
        options={{ title: '館藏查詢', headerShown: false }}
      />
      <Stack.Screen name="Health" component={HealthScreen} options={{ title: '校園健康' }} />
      <Stack.Screen name="Dormitory" component={DormitoryScreen} options={{ title: '宿舍服務' }} />
      <Stack.Screen
        name="PrintService"
        component={PrintServiceScreen}
        options={{ title: '列印服務' }}
      />
      <Stack.Screen name="LostFound" component={LostFoundScreen} options={{ title: '失物招領' }} />
      <Stack.Screen
        name="LostFoundDetail"
        component={LostFoundDetailScreen}
        options={{ title: '物品詳情' }}
      />
      <Stack.Screen
        name="LostFoundPost"
        component={LostFoundPostScreen}
        options={{ title: '發布招領' }}
      />
      <Stack.Screen name="Payment" component={PaymentScreen} options={{ title: '校園支付' }} />
    </Stack.Navigator>
  );
}
