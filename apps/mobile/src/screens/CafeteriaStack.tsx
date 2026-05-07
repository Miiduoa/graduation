/* eslint-disable */
import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { CafeteriaScreen } from './CafeteriaScreen';
import { VendorManagementScreen } from './VendorManagementScreen';
import { AdminCafeteriaScreen } from './AdminCafeteriaScreen';
import { useThemeMode } from '../state/theme';
import { createStackScreenOptions } from '../ui/navigationTheme';

const Stack = createNativeStackNavigator<any, undefined>();

export function CafeteriaStack() {
  useThemeMode();

  return (
    <Stack.Navigator
      id={undefined}
      initialRouteName="Cafeteria"
      screenOptions={createStackScreenOptions()}
    >
      <Stack.Screen
        name="Cafeteria"
        component={CafeteriaScreen}
        options={{ title: '餐廳', headerShown: false }}
      />
      <Stack.Screen
        name="VendorManagement"
        component={VendorManagementScreen}
        options={{ title: '店家管理', headerShown: false }}
      />
      <Stack.Screen
        name="AdminCafeteria"
        component={AdminCafeteriaScreen}
        options={{ title: '餐廳管理', headerShown: false }}
      />
    </Stack.Navigator>
  );
}
