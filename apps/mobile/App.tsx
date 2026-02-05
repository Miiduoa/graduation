import React, { useEffect } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { NavigationContainer, DefaultTheme } from "@react-navigation/native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { Ionicons } from "@expo/vector-icons";

import { theme } from "./src/ui/theme";
import { SchoolProvider } from "./src/state/school";
import { FavoritesProvider } from "./src/state/favorites";
import { DemoProvider } from "./src/state/demo";
import { AuthProvider } from "./src/state/auth";
import { ThemeProvider, useThemeMode } from "./src/state/theme";
import { setDataSource, mockSource, firebaseSource, createCachedSource } from "./src/data";

import { AnnouncementsStack } from "./src/screens/AnnouncementsStack";
import { EventsStack } from "./src/screens/EventsStack";
import { MapStack } from "./src/screens/MapStack";
import { CafeteriaStack } from "./src/screens/CafeteriaStack";
import { MeStack } from "./src/screens/MeStack";
import { MessagesStack } from "./src/screens/MessagesStack";

const Tab = createBottomTabNavigator();

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
    case "訊息":
      return focused ? "chatbubbles" : "chatbubbles-outline";
    case "我的":
      return focused ? "person-circle" : "person-circle-outline";
    default:
      return focused ? "ellipse" : "ellipse-outline";
  }
}

// Data layer: mock vs firebase
// NOTE: if Firebase config is missing, firebaseSource will throw; keep mock as fallback.
let USING_FIREBASE = false;
try {
  setDataSource(createCachedSource(firebaseSource));
  USING_FIREBASE = true;
} catch {
  setDataSource(createCachedSource(mockSource));
  USING_FIREBASE = false;
}

function AppInner() {
  // When Firebase is enabled, force demoMode back to normal so it doesn't hide real data.
  useEffect(() => {
    if (!USING_FIREBASE) return;
    AsyncStorage.setItem("campus.demoMode.v1", "normal").catch(() => void 0);
  }, []);

  // Re-render when theme mode changes so NavigationContainer + tab styles update.
  useThemeMode();

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

  return (
    <SchoolProvider>
      <AuthProvider>
        <FavoritesProvider>
          <DemoProvider>
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
                <Tab.Screen name="公告" component={AnnouncementsStack} options={{ headerShown: false }} />
                <Tab.Screen name="活動" component={EventsStack} options={{ headerShown: false }} />
                <Tab.Screen name="地圖" component={MapStack} options={{ headerShown: false }} />
                <Tab.Screen name="餐廳" component={CafeteriaStack} options={{ headerShown: false }} />
                <Tab.Screen name="訊息" component={MessagesStack} options={{ headerShown: false }} />
                <Tab.Screen name="我的" component={MeStack} options={{ headerShown: false }} />
              </Tab.Navigator>
            </NavigationContainer>
          </DemoProvider>
        </FavoritesProvider>
      </AuthProvider>
    </SchoolProvider>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <AppInner />
    </ThemeProvider>
  );
}
