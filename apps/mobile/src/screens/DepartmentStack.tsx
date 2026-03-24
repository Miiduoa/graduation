/* eslint-disable */
import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { DepartmentHubScreen } from "./DepartmentHubScreen";
import { useThemeMode } from "../state/theme";
import { createStackScreenOptions } from "../ui/navigationTheme";

const Stack = createNativeStackNavigator<any, undefined>();

export function DepartmentStack() {
  useThemeMode();

  return (
    <Stack.Navigator
      id={undefined}
      initialRouteName="DepartmentHub"
      screenOptions={createStackScreenOptions()}
    >
      <Stack.Screen name="DepartmentHub" component={DepartmentHubScreen} options={{ title: "審核", headerShown: false }} />
    </Stack.Navigator>
  );
}
