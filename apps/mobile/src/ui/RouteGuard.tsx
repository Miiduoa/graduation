/* eslint-disable */
import React from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import { usePermissions } from "../hooks/usePermissions";
import type { Permission } from "../services/permissions";
import { theme } from "./theme";

type RouteGuardProps = {
  /** Required permission(s). If array, user needs ANY of them. */
  requires: Permission | Permission[];
  /** Fallback UI when access denied. Default: built-in access denied screen */
  fallback?: React.ReactNode;
  children: React.ReactNode;
};

/**
 * Wraps a screen to enforce permission checks.
 * If the user doesn't have the required permission(s),
 * shows an access denied screen instead.
 */
export function RouteGuard({ requires, fallback, children }: RouteGuardProps) {
  const { can, canAny, displayName, role } = usePermissions();
  const navigation = useNavigation();

  const permissions = Array.isArray(requires) ? requires : [requires];
  const hasAccess = permissions.length === 1 ? can(permissions[0]) : canAny(permissions);

  if (hasAccess) {
    return <>{children}</>;
  }

  if (fallback) {
    return <>{fallback}</>;
  }

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <View style={styles.iconContainer}>
          <Ionicons name="lock-closed" size={48} color={theme.colors.textSecondary} />
        </View>
        <Text style={styles.title}>無法存取此頁面</Text>
        <Text style={styles.subtitle}>
          您目前的身份是「{displayName}」，此功能不在您的權限範圍內。
        </Text>
        <Text style={styles.hint}>如果您認為這是錯誤，請聯繫學校管理員調整您的帳號權限。</Text>
        <Pressable
          style={styles.backButton}
          onPress={() => {
            if (navigation.canGoBack()) {
              navigation.goBack();
            }
          }}
        >
          <Ionicons name="arrow-back" size={20} color="#fff" />
          <Text style={styles.backButtonText}>返回上一頁</Text>
        </Pressable>
      </View>
    </View>
  );
}

/**
 * Higher-order component version of RouteGuard.
 * Usage: export default withPermission('admin.dashboard')(AdminDashboardScreen)
 */
export function withPermission(requires: Permission | Permission[]) {
  return function <P extends object>(WrappedComponent: React.ComponentType<P>) {
    return function PermissionGatedScreen(props: P) {
      return (
        <RouteGuard requires={requires}>
          <WrappedComponent {...props} />
        </RouteGuard>
      );
    };
  };
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
    backgroundColor: theme.colors.bg,
  },
  card: {
    backgroundColor: theme.colors.surface,
    borderRadius: 16,
    padding: 32,
    alignItems: "center",
    maxWidth: 340,
    width: "100%",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },
  iconContainer: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: theme.colors.bg,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 20,
  },
  title: {
    fontSize: 20,
    fontWeight: "700",
    color: theme.colors.text,
    marginBottom: 8,
    textAlign: "center",
  },
  subtitle: {
    fontSize: 15,
    color: theme.colors.textSecondary,
    textAlign: "center",
    lineHeight: 22,
    marginBottom: 8,
  },
  hint: {
    fontSize: 13,
    color: theme.colors.textSecondary,
    textAlign: "center",
    lineHeight: 19,
    marginBottom: 24,
    opacity: 0.7,
  },
  backButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: theme.colors.accent,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 10,
  },
  backButtonText: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "600",
  },
});
