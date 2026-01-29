import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { AnnouncementsScreen } from "./AnnouncementsScreen";
import { AnnouncementDetailScreen } from "./AnnouncementDetailScreen";
import { theme } from "../ui/theme";

const Stack = createNativeStackNavigator();

export function AnnouncementsStack() {
  return (
    <Stack.Navigator
      initialRouteName="AnnouncementDetail"
      screenOptions={{
        headerStyle: { backgroundColor: theme.colors.surface },
        headerTitleStyle: { color: theme.colors.text, fontWeight: "800" },
        headerTintColor: theme.colors.text,
      }}
    >
      <Stack.Screen name="Announcements" component={AnnouncementsScreen} options={{ title: "公告" }} />
      <Stack.Screen
        name="AnnouncementDetail"
        component={AnnouncementDetailScreen}
        options={{ title: "公告詳情" }}
        initialParams={{ id: "a1" }}
      />
    </Stack.Navigator>
  );
}
