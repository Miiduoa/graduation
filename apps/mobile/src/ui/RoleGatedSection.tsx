 
import React from "react";
import { usePermissions } from "../hooks/usePermissions";
import type { Permission } from "../services/permissions";
import type { RoleGroup } from "../services/permissions";

type RoleGatedSectionProps = {
  /** Show only if user has this permission */
  permission?: Permission;
  /** Show only if user has ANY of these permissions */
  anyPermission?: Permission[];
  /** Show only for these role groups */
  roles?: RoleGroup[];
  /** Invert the condition (show when NOT matching) */
  invert?: boolean;
  /** Fallback content when hidden */
  fallback?: React.ReactNode;
  children: React.ReactNode;
};

/**
 * Conditionally renders children based on the user's role/permissions.
 *
 * Usage:
 * <RoleGatedSection permission="courses.grade">
 *   <GradebookButton />
 * </RoleGatedSection>
 *
 * <RoleGatedSection roles={['teacher', 'admin']}>
 *   <PublishAnnouncementButton />
 * </RoleGatedSection>
 */
export function RoleGatedSection({
  permission,
  anyPermission,
  roles,
  invert = false,
  fallback = null,
  children,
}: RoleGatedSectionProps) {
  const { can, canAny, roleGroup } = usePermissions();

  let visible = true;

  if (permission) {
    visible = can(permission);
  } else if (anyPermission) {
    visible = canAny(anyPermission);
  } else if (roles) {
    visible = roles.includes(roleGroup);
  }

  if (invert) visible = !visible;

  return <>{visible ? children : fallback}</>;
}
