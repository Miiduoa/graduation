/* eslint-disable */
import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { AdminDashboardScreen } from "./AdminDashboardScreen";
import { useThemeMode } from "../state/theme";
import { createStackScreenOptions } from "../ui/navigationTheme";

const Stack = createNativeStackNavigator<any, undefined>();

export function AdminStack() {
  useThemeMode();

  return (
    <Stack.Navigator
      id={undefined}
      initialRouteName="AdminDashboard"
      screenOptions={createStackScreenOptions()}
    >
      <Stack.Screen name="AdminDashboard" component={AdminDashboardScreen} options={{ title: "管理", headerShown: false }} />
    </Stack.Navigator>
  );
}
