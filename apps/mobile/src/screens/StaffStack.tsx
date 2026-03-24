/* eslint-disable */
import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { StaffHubScreen } from "./StaffHubScreen";
import { MapStack } from "./MapStack";
import { MessagesStack } from "./MessagesStack";
import { PrintServiceScreen } from "./PrintServiceScreen";
import { DormitoryScreen } from "./DormitoryScreen";
import { NotificationsScreen } from "./NotificationsScreen";
import { useThemeMode } from "../state/theme";
import { createStackScreenOptions } from "../ui/navigationTheme";

const Stack = createNativeStackNavigator<any, undefined>();

export function StaffStack() {
  useThemeMode();

  return (
    <Stack.Navigator
      id={undefined}
      initialRouteName="StaffHub"
      screenOptions={createStackScreenOptions()}
    >
      <Stack.Screen name="StaffHub" component={StaffHubScreen} options={{ title: "服務", headerShown: false }} />
      <Stack.Screen name="MapStack" component={MapStack} options={{ headerShown: false }} />
      <Stack.Screen name="MessagesStack" component={MessagesStack} options={{ headerShown: false }} />
      <Stack.Screen name="PrintService" component={PrintServiceScreen} options={{ title: "列印服務" }} />
      <Stack.Screen name="Dormitory" component={DormitoryScreen} options={{ title: "宿舍服務" }} />
      <Stack.Screen name="Notifications" component={NotificationsScreen} options={{ title: "通知" }} />
    </Stack.Navigator>
  );
}
