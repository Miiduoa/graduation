import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { MapScreen } from "./MapScreen";
import { PoiDetailScreen } from "./PoiDetailScreen";
import { ARNavigationScreen } from "./ARNavigationScreen";
import { AccessibleRouteScreen } from "./AccessibleRouteScreen";
import { BusScheduleScreen } from "./BusScheduleScreen";
import { useThemeMode } from "../state/theme";
import { createStackScreenOptions } from "../ui/navigationTheme";

const Stack = createNativeStackNavigator<any, undefined>();

export function MapStack() {
  useThemeMode();

  return (
    <Stack.Navigator
      id={undefined}
      initialRouteName="Map"
      screenOptions={createStackScreenOptions()}
    >
      <Stack.Screen name="Map" component={MapScreen} options={{ title: "地圖", headerShown: false }} />
      <Stack.Screen name="PoiDetail" component={PoiDetailScreen} options={{ title: "點位詳情" }} />
      <Stack.Screen name="ARNavigation" component={ARNavigationScreen} options={{ title: "AR 導航" }} />
      <Stack.Screen name="AccessibleRoute" component={AccessibleRouteScreen} options={{ title: "無障礙路線" }} />
      <Stack.Screen name="BusSchedule" component={BusScheduleScreen} options={{ title: "校園公車" }} />
    </Stack.Navigator>
  );
}
