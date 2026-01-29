import React from "react";
import { NavigationContainer, DefaultTheme } from "@react-navigation/native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { Ionicons } from "@expo/vector-icons";

import { theme } from "./src/ui/theme";

import { AnnouncementsScreen } from "./src/screens/AnnouncementsScreen";
import { EventsScreen } from "./src/screens/EventsScreen";
import { MapScreen } from "./src/screens/MapScreen";
import { CafeteriaScreen } from "./src/screens/CafeteriaScreen";
import { MeScreen } from "./src/screens/MeScreen";
import { CreditAuditScreen } from "./src/screens/CreditAuditScreen";

const Tab = createBottomTabNavigator();

const navTheme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    background: theme.colors.bg,
    card: theme.colors.surface,
    text: theme.colors.text,
    border: theme.colors.border,
    primary: theme.colors.accent,
  },
};

function getTabIconName(routeName: string, focused: boolean) {
  // Mix A+B: outline by default (A), solid when active (B)
  switch (routeName) {
    case "公告":
      return focused ? "newspaper" : "newspaper-outline";
    case "活動":
      return focused ? "calendar" : "calendar-outline";
    case "地圖":
      return focused ? "map" : "map-outline";
    case "餐廳":
      return focused ? "restaurant" : "restaurant-outline";
    case "我的":
      return focused ? "person-circle" : "person-circle-outline";
    case "試算":
      return focused ? "calculator" : "calculator-outline";
    default:
      return focused ? "ellipse" : "ellipse-outline";
  }
}

export default function App() {
  return (
    <NavigationContainer theme={navTheme}>
      <Tab.Navigator
        screenOptions={({ route }) => ({
          headerStyle: { backgroundColor: theme.colors.surface },
          headerTitleStyle: { color: theme.colors.text, fontWeight: "700" },
          tabBarStyle: {
            backgroundColor: theme.colors.bg,
            borderTopColor: theme.colors.border,
            height: 86,
            paddingTop: 8,
            paddingBottom: 10,
          },
          tabBarLabelStyle: { fontSize: 12, fontWeight: "700" },
          tabBarActiveTintColor: theme.colors.accent,
          tabBarInactiveTintColor: theme.colors.muted,
          tabBarIcon: ({ color, size, focused }) => {
            const s = Math.max(22, size ?? 22);
            const name = getTabIconName(route.name, focused);
            return <Ionicons name={name as any} size={s} color={color} />;
          },
        })}
      >
        <Tab.Screen name="公告" component={AnnouncementsScreen} />
        <Tab.Screen name="活動" component={EventsScreen} />
        <Tab.Screen name="地圖" component={MapScreen} />
        <Tab.Screen name="餐廳" component={CafeteriaScreen} />
        <Tab.Screen name="我的" component={MeScreen} />
        <Tab.Screen name="試算" component={CreditAuditScreen} />
      </Tab.Navigator>
    </NavigationContainer>
  );
}
