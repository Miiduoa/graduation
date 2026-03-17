import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { EventsScreen } from "./EventsScreen";
import { EventDetailScreen } from "./EventDetailScreen";
import { useThemeMode } from "../state/theme";
import { createStackScreenOptions } from "../ui/navigationTheme";

const Stack = createNativeStackNavigator<any, undefined>();

export function EventsStack() {
  useThemeMode();

  return (
    <Stack.Navigator
      id={undefined}
      initialRouteName="Events"
      screenOptions={createStackScreenOptions()}
    >
      <Stack.Screen name="Events" component={EventsScreen} options={{ headerShown: false }} />
      <Stack.Screen name="EventDetail" component={EventDetailScreen} options={{ title: "活動詳情" }} />
    </Stack.Navigator>
  );
}
