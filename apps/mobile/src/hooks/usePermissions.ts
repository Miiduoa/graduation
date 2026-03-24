/* eslint-disable */
import { useMemo } from "react";
import { useAuth } from "../state/auth";
import {
  type Permission,
  type RoleGroup,
  type TabConfig,
  getRoleGroup,
  getPermissions,
  hasPermission,
  hasAnyPermission,
  getTabsForRole,
  canAccessScreen,
  getInitialRoute,
  getRoleDisplayName,
  getRoleBadgeColor,
} from "../services/permissions";

export function usePermissions() {
  const { profile } = useAuth();
  const role = profile?.role ?? "student";

  return useMemo(() => ({
    role,
    roleGroup: getRoleGroup(role),
    permissions: getPermissions(role),

    // Check a single permission
    can: (permission: Permission) => hasPermission(role, permission),

    // Check if user has any of the given permissions
    canAny: (permissions: Permission[]) => hasAnyPermission(role, permissions),

    // Check screen access
    canAccess: (screenName: string) => canAccessScreen(role, screenName),

    // Get tab config for current role
    tabs: getTabsForRole(role),

    // Get initial route
    initialRoute: getInitialRoute(role),

    // Display helpers
    displayName: getRoleDisplayName(role),
    badgeColor: getRoleBadgeColor(role),

    // Convenience booleans
    isStudent: getRoleGroup(role) === "student",
    isTeacher: getRoleGroup(role) === "teacher",
    isStaff: getRoleGroup(role) === "staff",
    isDepartmentHead: getRoleGroup(role) === "department_head",
    isAdmin: getRoleGroup(role) === "admin",
  }), [role]);
}
