export type ResolvedDashboardRole =
  | 'student'
  | 'teacher'
  | 'ta'
  | 'club_officer'
  | 'department'
  | 'admin'
  | 'vendor'
  | 'staff'
  | 'alumni'
  | 'guest';

/** Display routing uses the authenticated profile, never an identifier naming convention. */
export function resolveDashboardRole(
  profile: { uid?: string | null; roleGroup?: string | null; role?: string | null } | null,
): ResolvedDashboardRole {
  if (!profile) return 'guest';
  const group = profile.roleGroup;
  if (
    group === 'student' ||
    group === 'teacher' ||
    group === 'ta' ||
    group === 'club_officer' ||
    group === 'admin' ||
    group === 'alumni' ||
    group === 'guest'
  )
    return group;
  if (group === 'department_head' || group === 'department') return 'department';
  const role = profile.role;
  if (role === 'vendor' || role === 'cafeteria') return 'vendor';
  if (group === 'staff') return 'staff';
  if (role === 'professor' || role === 'teacher') return 'teacher';
  if (role === 'assistant' || role === 'ta') return 'ta';
  if (role === 'school' || role === 'admin') return 'admin';
  if (role === 'department_head' || role === 'principal' || role === 'department')
    return 'department';
  if (role === 'staff' || role === 'service') return 'staff';
  if (role === 'student' || role === 'club_officer' || role === 'alumni' || role === 'guest')
    return role;
  return 'guest';
}
