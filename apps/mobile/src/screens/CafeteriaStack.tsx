/* eslint-disable */
import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { CafeteriaScreen } from "./CafeteriaScreen";
import { MenuDetailScreen } from "./MenuDetailScreen";
import { OrderingScreen } from "./OrderingScreen";
import { MenuSubscriptionScreen } from "./MenuSubscriptionScreen";
import { useThemeMode } from "../state/theme";
import { createStackScreenOptions } from "../ui/navigationTheme";

const Stack = createNativeStackNavigator<any, undefined>();

export function CafeteriaStack() {
  useThemeMode();

  return (
    <Stack.Navigator
      id={undefined}
      initialRouteName="Cafeteria"
      screenOptions={createStackScreenOptions()}
    >
      <Stack.Screen name="Cafeteria" component={CafeteriaScreen} options={{ title: "餐廳", headerShown: false }} />
      <Stack.Screen name="MenuDetail" component={MenuDetailScreen} options={{ title: "餐點詳情" }} />
      <Stack.Screen name="Ordering" component={OrderingScreen} options={{ title: "線上點餐" }} />
      <Stack.Screen name="MenuSubscription" component={MenuSubscriptionScreen} options={{ title: "菜單訂閱" }} />
    </Stack.Navigator>
  );
}
