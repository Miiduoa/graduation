import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import LoginLandingScreen from './LoginLandingScreen';
import { SSOLoginScreen } from './SSOLoginScreen';
import type { PreAuthStackParamList } from './preAuthTypes';
import { createStackScreenOptions } from '../ui/navigationTheme';
import { useThemeMode } from '../state/theme';

const Stack = createNativeStackNavigator<PreAuthStackParamList, undefined>();

/**
 * 未登入時的根導航：Landing → 正式學校登入（與 MeStack 內 SSOLogin 同一元件）
 */
export function PreAuthStack() {
  useThemeMode();

  return (
    <Stack.Navigator
      initialRouteName="LoginLanding"
      screenOptions={createStackScreenOptions()}
      id={undefined}
    >
      <Stack.Screen
        name="LoginLanding"
        component={LoginLandingScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen name="SSOLogin" component={SSOLoginScreen} options={{ title: '學校登入' }} />
    </Stack.Navigator>
  );
}
