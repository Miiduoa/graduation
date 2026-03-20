import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { CampusHubScreen } from "./CampusHubScreen";
import { MapScreen } from "./MapScreen";
import { PoiDetailScreen } from "./PoiDetailScreen";
import { ARNavigationScreen } from "./ARNavigationScreen";
import { AccessibleRouteScreen } from "./AccessibleRouteScreen";
import { BusScheduleScreen } from "./BusScheduleScreen";
import { CafeteriaScreen } from "./CafeteriaScreen";
import { MenuDetailScreen } from "./MenuDetailScreen";
import { OrderingScreen } from "./OrderingScreen";
import { MenuSubscriptionScreen } from "./MenuSubscriptionScreen";
import { LibraryScreen } from "./LibraryScreen";
import { HealthScreen } from "./HealthScreen";
import { DormitoryScreen } from "./DormitoryScreen";
import { PrintServiceScreen } from "./PrintServiceScreen";
import { LostFoundScreen } from "./LostFoundScreen";
import { LostFoundDetailScreen } from "./LostFoundDetailScreen";
import { LostFoundPostScreen } from "./LostFoundPostScreen";
import { PaymentScreen } from "./PaymentScreen";
import { useThemeMode } from "../state/theme";
import { createStackScreenOptions } from "../ui/navigationTheme";

const Stack = createNativeStackNavigator<any, undefined>();

export function MapStack() {
  useThemeMode();

  return (
    <Stack.Navigator
      id={undefined}
      initialRouteName="CampusHome"
      screenOptions={createStackScreenOptions()}
    >
      <Stack.Screen name="CampusHome" component={CampusHubScreen} options={{ title: "校園", headerShown: false }} />
      <Stack.Screen name="Map" component={MapScreen} options={{ title: "地圖", headerShown: false }} />
      <Stack.Screen name="PoiDetail" component={PoiDetailScreen} options={{ title: "點位詳情" }} />
      <Stack.Screen name="ARNavigation" component={ARNavigationScreen} options={{ title: "AR 導航" }} />
      <Stack.Screen name="AccessibleRoute" component={AccessibleRouteScreen} options={{ title: "無障礙路線" }} />
      <Stack.Screen name="BusSchedule" component={BusScheduleScreen} options={{ title: "校園公車" }} />
      <Stack.Screen name="餐廳總覽" component={CafeteriaScreen} options={{ title: "餐廳" }} />
      <Stack.Screen name="MenuDetail" component={MenuDetailScreen} options={{ title: "餐點詳情" }} />
      <Stack.Screen name="Ordering" component={OrderingScreen} options={{ title: "線上點餐" }} />
      <Stack.Screen name="MenuSubscription" component={MenuSubscriptionScreen} options={{ title: "菜單訂閱" }} />
      <Stack.Screen name="Library" component={LibraryScreen} options={{ title: "圖書館" }} />
      <Stack.Screen name="Health" component={HealthScreen} options={{ title: "校園健康" }} />
      <Stack.Screen name="Dormitory" component={DormitoryScreen} options={{ title: "宿舍服務" }} />
      <Stack.Screen name="PrintService" component={PrintServiceScreen} options={{ title: "列印服務" }} />
      <Stack.Screen name="LostFound" component={LostFoundScreen} options={{ title: "失物招領" }} />
      <Stack.Screen name="LostFoundDetail" component={LostFoundDetailScreen} options={{ title: "物品詳情" }} />
      <Stack.Screen name="LostFoundPost" component={LostFoundPostScreen} options={{ title: "發布招領" }} />
      <Stack.Screen name="Payment" component={PaymentScreen} options={{ title: "校園支付" }} />
    </Stack.Navigator>
  );
}
