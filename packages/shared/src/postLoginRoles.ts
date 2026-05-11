/**
 * 登入後角色解析（純函式）：Firestore users.role 為權威起點，
 * E 校園 / TronClass / 校籍成員為「證據」，輸出 primaryRole 與多身分 flags。
 */

export type PostLoginConfidence = 'high' | 'medium' | 'low';

/** 與 apps/mobile/src/data/types.ts UserRole 對齊 */
export type ResolvedAppRole =
  | 'student'
  | 'teacher'
  | 'professor'
  | 'department_head'
  | 'principal'
  | 'admin'
  | 'staff'
  | 'alumni'
  | 'department'
  | 'school'
  | 'vendor';

export type TcCourseEvidence = {
  id: number;
  course_code?: string | null;
  name?: string | null;
  role?: string | null;
};

export type ResolveUserRolesInput = {
  /** users/{uid} 主要欄位 */
  userDoc: {
    role?: string | null;
    primaryRole?: string | null;
    email?: string | null;
    studentId?: string | null;
  };
  /** schools/{schoolId}/members/{uid} */
  schoolMemberDoc?: { role?: string | null; status?: string | null } | null;
  /** schools/{schoolId}/serviceRoles/{uid} 正規化後（domain → boolean） */
  serviceRolesDoc?: Record<string, unknown> | null;
  tcProfile?: { role?: string | null } | null;
  tcCourses?: TcCourseEvidence[] | null;
};

export type ResolveUserRolesResult = {
  primaryRole: ResolvedAppRole;
  roles: string[];
  teachingRoles: string[];
  orgRoles: string[];
  confidence: PostLoginConfidence;
  reasons: string[];
  /** 若 true，表示未使用 PU/TC 推斷 primary（僅合併 teaching/org flags） */
  usedAuthoritativeUserRole: boolean;
};

const SERVICE_ROLE_DOMAINS = ['orders', 'repairs', 'packages', 'printing', 'health'] as const;

function normEmail(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim().toLowerCase();
  return s || null;
}

function normRole(v: unknown): string {
  return String(v || '')
    .trim()
    .toLowerCase();
}

function isStudentLikeUserRole(role: string): boolean {
  return role === 'student' || role === 'alumni';
}

function toResolvedAppRole(role: string): ResolvedAppRole {
  const r = normRole(role);
  const allowed = new Set<ResolvedAppRole>([
    'student',
    'teacher',
    'professor',
    'department_head',
    'principal',
    'admin',
    'staff',
    'alumni',
    'department',
    'school',
    'vendor',
  ]);
  if (allowed.has(r as ResolvedAppRole)) return r as ResolvedAppRole;
  if (r === 'faculty') return 'teacher';
  return 'student';
}

function hasTeachingEvidence(tcCourses: TcCourseEvidence[] | null | undefined): boolean {
  if (!tcCourses?.length) return false;
  return tcCourses.some((c) => normRole(c.role) === 'teacher');
}

function countEnrolledStudentCourses(tcCourses: TcCourseEvidence[] | null | undefined): number {
  if (!tcCourses?.length) return 0;
  return tcCourses.filter((c) => normRole(c.role) === 'student').length;
}

function hasTaOnly(tcCourses: TcCourseEvidence[] | null | undefined): boolean {
  if (!tcCourses?.length) return false;
  const roles = tcCourses.map((c) => normRole(c.role));
  return roles.some((r) => r === 'ta') && !roles.some((r) => r === 'teacher');
}

function collectServiceOrgRoles(serviceRolesDoc: Record<string, unknown> | null | undefined): string[] {
  if (!serviceRolesDoc || serviceRolesDoc.status === 'inactive') return [];
  const out: string[] = [];
  for (const d of SERVICE_ROLE_DOMAINS) {
    if (serviceRolesDoc[d] === true) out.push(`service:${d}`);
  }
  return out;
}

/**
 * 以 users.role 為權威；僅在 student-like 時用證據推斷 primaryRole。
 */
export function resolveUserRoles(input: ResolveUserRolesInput): ResolveUserRolesResult {
  const reasons: string[] = [];
  const author = normRole(input.userDoc.primaryRole || input.userDoc.role || 'student');
  const basePrimary = toResolvedAppRole(author);
  const teachingRoles: string[] = [];
  const orgRoles: string[] = [];
  const roles = new Set<string>();

  const tcProfileRole = input.tcProfile?.role ? normRole(input.tcProfile.role) : '';
  const tcCourses = input.tcCourses ?? [];
  const memberRole = normRole(input.schoolMemberDoc?.role);

  if (hasTeachingEvidence(tcCourses)) {
    teachingRoles.push('teacher');
    reasons.push('TronClass 課程 role=teacher');
  }
  if (tcProfileRole === 'teacher' || tcProfileRole === 'admin') {
    teachingRoles.push(tcProfileRole === 'admin' ? 'admin' : 'teacher');
    reasons.push(`TronClass profile.role=${tcProfileRole}`);
  }

  if (memberRole === 'admin' || memberRole === 'editor') {
    orgRoles.push(memberRole === 'admin' ? 'schoolAdmin' : 'schoolEditor');
    reasons.push(`school members.role=${memberRole}`);
  }

  orgRoles.push(...collectServiceOrgRoles(input.serviceRolesDoc ?? null));

  teachingRoles.forEach((t) => roles.add(t));
  orgRoles.forEach((o) => roles.add(o));

  if (!isStudentLikeUserRole(basePrimary)) {
    roles.add(basePrimary);
    return {
      primaryRole: basePrimary,
      roles: Array.from(roles),
      teachingRoles: [...new Set(teachingRoles)],
      orgRoles: [...new Set(orgRoles)],
      confidence: 'high',
      reasons: [`users 權威角色=${basePrimary}`, ...reasons],
      usedAuthoritativeUserRole: true,
    };
  }

  // --- 以下：user 為 student / alumni 才做證據推斷 primary ---
  let primaryRole: ResolvedAppRole = 'student';
  let confidence: PostLoginConfidence = 'low';

  if (tcProfileRole === 'admin') {
    primaryRole = 'admin';
    confidence = 'high';
    reasons.push('TronClass profile 為 admin');
  } else if (memberRole === 'admin') {
    primaryRole = 'admin';
    confidence = 'high';
    reasons.push('校籍 members 為 admin');
  } else if (hasTeachingEvidence(tcCourses) || tcProfileRole === 'teacher') {
    primaryRole = 'teacher';
    confidence = tcProfileRole === 'teacher' ? 'high' : 'medium';
    reasons.push(
      hasTeachingEvidence(tcCourses)
        ? '存在教授課程（TC course.role=teacher）'
        : 'TronClass profile 為 teacher',
    );
  } else if (memberRole === 'editor') {
    primaryRole = 'staff';
    confidence = 'medium';
    reasons.push('校籍 members 為 editor（系辦／編輯）');
  } else if (orgRoles.length > 0) {
    primaryRole = 'staff';
    confidence = 'medium';
    reasons.push('具 serviceRoles 維運 domain');
  } else if (countEnrolledStudentCourses(tcCourses) > 0 || tcProfileRole === 'student') {
    primaryRole = 'student';
    confidence = tcCourses.length ? 'high' : 'medium';
    reasons.push('僅修課／學生 profile');
  } else {
    primaryRole = 'student';
    confidence = 'low';
    reasons.push('證據不足，維持 student');
  }

  roles.add(primaryRole);
  if (hasTaOnly(tcCourses)) {
    roles.add('ta');
    reasons.push('具助教課程（TA）');
  }

  return {
    primaryRole,
    roles: Array.from(roles),
    teachingRoles: [...new Set(teachingRoles)],
    orgRoles: [...new Set(orgRoles)],
    confidence,
    reasons,
    usedAuthoritativeUserRole: false,
  };
}

export function normalizeEmailForMatch(email: string | null | undefined): string | null {
  return normEmail(email);
}
