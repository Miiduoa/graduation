import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { HomeScreen } from "./HomeScreen";
import { AnnouncementsScreen } from "./AnnouncementsScreen";
import { AnnouncementDetailScreen } from "./AnnouncementDetailScreen";
import { EventsScreen } from "./EventsScreen";
import { EventDetailScreen } from "./EventDetailScreen";
import { CafeteriaScreen } from "./CafeteriaScreen";
import { MenuDetailScreen } from "./MenuDetailScreen";
import { OrderingScreen } from "./OrderingScreen";
import { MenuSubscriptionScreen } from "./MenuSubscriptionScreen";
import { useThemeMode } from "../state/theme";
import { createStackScreenOptions } from "../ui/navigationTheme";

const Stack = createNativeStackNavigator<any, undefined>();

export function HomeStack() {
  useThemeMode();

  return (
    <Stack.Navigator
      id={undefined}
      initialRouteName="HomeMain"
      screenOptions={createStackScreenOptions()}
    >
      <Stack.Screen name="HomeMain" component={HomeScreen} options={{ title: "首頁", headerShown: false }} />
      <Stack.Screen name="公告總覽" component={AnnouncementsScreen} options={{ title: "公告" }} />
      <Stack.Screen name="公告詳情" component={AnnouncementDetailScreen} options={{ title: "公告詳情" }} />
      <Stack.Screen name="活動總覽" component={EventsScreen} options={{ title: "活動" }} />
      <Stack.Screen name="活動詳情" component={EventDetailScreen} options={{ title: "活動詳情" }} />
      <Stack.Screen name="餐廳總覽" component={CafeteriaScreen} options={{ title: "餐廳" }} />
      <Stack.Screen name="MenuDetail" component={MenuDetailScreen} options={{ title: "餐點詳情" }} />
      <Stack.Screen name="Ordering" component={OrderingScreen} options={{ title: "線上點餐" }} />
      <Stack.Screen name="MenuSubscription" component={MenuSubscriptionScreen} options={{ title: "菜單訂閱" }} />
    </Stack.Navigator>
  );
}
