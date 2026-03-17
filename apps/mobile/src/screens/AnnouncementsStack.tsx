import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { AnnouncementsScreen } from "./AnnouncementsScreen";
import { AnnouncementDetailScreen } from "./AnnouncementDetailScreen";
import { useThemeMode } from "../state/theme";
import { createStackScreenOptions } from "../ui/navigationTheme";

const Stack = createNativeStackNavigator<any, undefined>();

export function AnnouncementsStack() {
  useThemeMode();

  return (
    <Stack.Navigator
      id={undefined}
      initialRouteName="Announcements"
      screenOptions={createStackScreenOptions()}
    >
      <Stack.Screen name="Announcements" component={AnnouncementsScreen} options={{ headerShown: false }} />
      <Stack.Screen
        name="AnnouncementDetail"
        component={AnnouncementDetailScreen}
        options={{ title: "公告詳情" }}
      />
    </Stack.Navigator>
  );
}
