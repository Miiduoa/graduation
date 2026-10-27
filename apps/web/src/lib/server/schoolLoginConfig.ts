export type SchoolLoginStatus = 'open' | 'closed';

export type SchoolStudentAdapter = 'form-password';
export type SchoolTeacherAdapter = 'lms-password';
export type SchoolTeacherProof = 'tronclass-profile';

export type SchoolLoginConfig = {
  schoolId: string;
  status: SchoolLoginStatus;
  studentAdapter: SchoolStudentAdapter | null;
  teacherAdapter: SchoolTeacherAdapter | null;
  teacherProof: SchoolTeacherProof | null;
  endpoints: {
    portal?: string;
    lms?: string;
  };
  accountPattern: {
    student: RegExp;
    teacher: RegExp;
  };
  uid: {
    studentPrefix: string;
    teacherPrefix: string;
  };
  emailDomain: string;
  membershipSchoolId: string;
};

const SCHOOL_ID = /^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/;

const PROVIDENCE_LOGIN: SchoolLoginConfig = {
  schoolId: 'pu',
  status: 'open',
  studentAdapter: 'form-password',
  teacherAdapter: 'lms-password',
  teacherProof: 'tronclass-profile',
  endpoints: {
    portal: 'https://alcat.pu.edu.tw',
    lms: 'https://tronclass.pu.edu.tw',
  },
  accountPattern: {
    student: /^[0-9]{7,10}$/,
    teacher: /^[A-Za-z][A-Za-z0-9._-]{1,31}$/,
  },
  uid: {
    studentPrefix: 'pu-',
    teacherPrefix: 'pu-t-',
  },
  emailDomain: 'pu.edu.tw',
  membershipSchoolId: 'pu',
};

const SCHOOL_LOGIN_CONFIGS: Record<string, SchoolLoginConfig> = {
  pu: PROVIDENCE_LOGIN,
};

export function normalizeSchoolLoginId(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return 'pu';
  const id = String(value).trim().toLowerCase();
  if (!SCHOOL_ID.test(id)) return null;
  return id;
}

export function getSchoolLoginConfig(schoolId: unknown): SchoolLoginConfig | null {
  const id = normalizeSchoolLoginId(schoolId);
  if (!id) return null;
  return SCHOOL_LOGIN_CONFIGS[id] ?? null;
}

export function schoolLoginConfigAcceptsSignIn(config: SchoolLoginConfig | null): boolean {
  if (!config || config.status !== 'open') return false;
  return config.studentAdapter != null || config.teacherAdapter != null;
}

export function isSchoolLoginOffered(schoolId: unknown): boolean {
  return schoolLoginConfigAcceptsSignIn(getSchoolLoginConfig(schoolId));
}

export function schoolLoginAccountScope(schoolId: string): string {
  return `school-login-${schoolId}-account`;
}

export function schoolLoginIpScope(schoolId: string): string {
  return `school-login-${schoolId}-ip`;
}

export function matchSchoolLoginAccount(
  config: SchoolLoginConfig,
  account: string,
): 'student' | 'teacher' | null {
  if (config.accountPattern.student.test(account)) return 'student';
  if (config.accountPattern.teacher.test(account)) return 'teacher';
  return null;
}

export function schoolLoginHasAdapter(
  config: SchoolLoginConfig,
  kind: 'student' | 'teacher',
): boolean {
  if (config.status !== 'open') return false;
  if (kind === 'student') return config.studentAdapter != null;
  return config.teacherAdapter != null && config.teacherProof != null;
}
