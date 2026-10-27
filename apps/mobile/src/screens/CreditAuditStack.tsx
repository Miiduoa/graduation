/* eslint-disable */
import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { CreditAuditScreen } from './CreditAuditScreen';
import { CreditAuditInputScreen } from './CreditAuditInputScreen';
import CreditSummaryScreen from './CreditSummaryScreen';
import CreditPlanningScreen from './CreditPlanningScreen';
import { theme } from '../ui/theme';
import { useThemeMode } from '../state/theme';

const Stack = createNativeStackNavigator<any, undefined>();

export function CreditAuditStack() {
  useThemeMode();

  return (
    <Stack.Navigator
      id={undefined}
      screenOptions={{
        headerStyle: { backgroundColor: theme.colors.bg },
        headerTitleStyle: { color: theme.colors.text, fontWeight: '700' },
        headerTintColor: theme.colors.text,
        headerShadowVisible: false,
      }}
    >
      <Stack.Screen
        name="CreditAudit"
        component={CreditSummaryScreen}
        options={{ title: '學分試算', headerShown: false }}
      />
      <Stack.Screen
        name="CreditAuditLegacy"
        component={CreditAuditScreen}
        options={{ title: '完整學分試算' }}
      />
      <Stack.Screen
        name="CreditAuditInput"
        component={CreditAuditInputScreen}
        options={{ title: '新增修課' }}
      />
      <Stack.Screen
        name="CreditPlanning"
        component={CreditPlanningScreen}
        options={{ title: '未來學分規劃', headerShown: false }}
      />
    </Stack.Navigator>
  );
}
