import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { CreditAuditScreen } from "./CreditAuditScreen";
import { CreditAuditInputScreen } from "./CreditAuditInputScreen";
import { theme } from "../ui/theme";

const Stack = createNativeStackNavigator();

export function CreditAuditStack() {
  return (
    <Stack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: theme.colors.surface },
        headerTitleStyle: { color: theme.colors.text, fontWeight: "800" },
        headerTintColor: theme.colors.text,
      }}
    >
      <Stack.Screen name="CreditAudit" component={CreditAuditScreen} options={{ title: "學分試算" }} />
      <Stack.Screen name="CreditAuditInput" component={CreditAuditInputScreen} options={{ title: "新增修課" }} />
    </Stack.Navigator>
  );
}
