import { randomBytes } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { courseOfferingId } from '@campus/shared/src/timetable/course';
import { signFirebaseCustomToken, type ServiceAccountSigner } from './firebaseCustomToken';
import {
  consumeLoginAccountLimit,
  consumeLoginIpLimit,
  getLoginRateGate,
  LoginRateLimitError,
  LoginRateStoreError,
  refundLoginAccountLimit,
  requireRateLimitSalt,
  type LoginRateGate,
} from './loginRateLimit';
import { createPuCampusGateway, PuCampusError, type PuCampusGateway } from './puCampusClient';
import {
  assertOnlyProvidence,
  buildPuStudentEmail,
  buildPuStudentUid,
  buildPuTeacherEmail,
  buildPuTeacherUid,
  isPuStudentId,
  isPuTeacherAccount,
  normalizePuAccount,
  normalizePuStudentId,
  PROVIDENCE_SCHOOL_ID,
} from './puIdentity';
import { writeSchoolLoginProfile, type SchoolLoginFirestore } from './schoolLoginProfile';

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const TEACHER_ROLES = new Set(['teacher', 'instructor', 'faculty', 'professor']);

export class PuLoginHttpError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'PuLoginHttpError';
    this.status = status;
  }
}

export type SignInPuDeps = {
  db: SchoolLoginFirestore;
  campus?: PuCampusGateway;
  signCustomToken?: (uid: string, claims: Record<string, string>) => Promise<string>;
  serviceAccount?: ServiceAccountSigner | null;
  now?: () => number;
  rateLimitSalt?: string;
  rateLimitGate?: LoginRateGate;
};

export const SCHOOL_UNAVAILABLE = '學校系統暫時無法連線';
export const TEACHER_SCHOOL_UNAVAILABLE = SCHOOL_UNAVAILABLE;
export const TEACHER_IDENTITY_UNVERIFIED = '暫時無法驗證老師身分';

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function clientMessage(error: PuCampusError): { status: number; message: string } {
  if (error.kind === 'credentials') return { status: 401, message: '學號或密碼錯誤' };
  if (error.kind === 'closed') return { status: 503, message: '尚未開放' };
  if (error.kind === 'unverified') return { status: 503, message: TEACHER_IDENTITY_UNVERIFIED };
  return { status: 503, message: SCHOOL_UNAVAILABLE };
}

function redact(value: unknown, secret: string): string {
  const text = value instanceof Error ? `${value.name}: ${value.message}` : String(value);
  if (!secret) return text;
  return text.split(secret).join('[redacted]');
}

function logFailure(error: unknown, secret: string): void {
  console.error('signInPuStudentId error:', redact(error, secret));
}

async function mintToken(
  deps: SignInPuDeps,
  uid: string,
  claims: Record<string, string>,
): Promise<string> {
  if (deps.signCustomToken) return deps.signCustomToken(uid, claims);
  if (!deps.serviceAccount) {
    throw new PuLoginHttpError(503, '尚未啟用');
  }
  return signFirebaseCustomToken(deps.serviceAccount, uid, claims);
}

async function writeSession(
  db: SignInPuDeps['db'],
  path: string,
  data: Record<string, unknown>,
  now: number,
): Promise<string> {
  const sessionId = randomBytes(16).toString('hex');
  const ref = db.doc(path + '/' + sessionId);
  if (typeof ref.set !== 'function') {
    return sessionId;
  }
  await ref.set(
    {
      ...data,
      createdAt: FieldValue.serverTimestamp(),
      expiresAt: new Date(now + SESSION_TTL_MS),
    },
    { merge: true },
  );
  return sessionId;
}

function safeOfferingIds(
  teacherName: string,
  courses: Array<{ name: string; role: string; teachers: Array<{ name?: string }> }>,
): string[] {
  const names = new Set<string>();
  const display = teacherName.trim();
  if (!display) return [];
  for (const course of courses) {
    if (!TEACHER_ROLES.has(course.role) || !course.name.trim()) continue;
    names.add(courseOfferingId({ name: course.name, teacher: display }));
  }
  return [...names].filter((id) => id.length > 0 && id.length <= 200);
}

function hasTronClassSessionCookie(cookies: Record<string, string> | undefined): boolean {
  if (!cookies) return false;
  return Object.entries(cookies).some(
    ([key, value]) => key.toLowerCase() === 'session' && String(value || '').trim().length > 0,
  );
}

function isSchoolSideFailure(error: unknown): boolean {
  if (error instanceof PuCampusError) {
    return error.kind === 'timeout' || error.kind === 'unavailable' || error.kind === 'closed';
  }
  if (error instanceof PuLoginHttpError) {
    return (
      error.status === 503 &&
      (error.message === SCHOOL_UNAVAILABLE || error.message === '尚未開放')
    );
  }
  return false;
}

export async function handleSignInPuStudentId(
  body: unknown,
  ip: string,
  deps: SignInPuDeps,
): Promise<Record<string, unknown>> {
  const payload = asRecord(body);
  const password = String(payload.password || '');
  try {
    try {
      assertOnlyProvidence(payload.schoolId);
    } catch {
      throw new PuLoginHttpError(400, '只接受靜宜大學帳號');
    }

    const rawAccount = normalizePuAccount(payload.studentId ?? payload.account);
    if (!rawAccount || !password) {
      throw new PuLoginHttpError(400, 'Missing required fields: studentId, password');
    }

    const studentId = normalizePuStudentId(rawAccount);
    const teacherAccount = rawAccount;
    const isStudent = isPuStudentId(studentId);
    const isTeacher = !isStudent && isPuTeacherAccount(teacherAccount);
    if (!isStudent && !isTeacher) {
      throw new PuLoginHttpError(400, '學號格式不正確');
    }

    const accountKey = isStudent ? studentId : teacherAccount.toLowerCase();
    const rateCtx = {
      db: deps.db,
      now: deps.now?.() ?? Date.now(),
      salt: requireRateLimitSalt(deps.rateLimitSalt),
      gate: deps.rateLimitGate ?? getLoginRateGate(),
    };
    await consumeLoginIpLimit(ip, rateCtx);
    await consumeLoginAccountLimit(accountKey, rateCtx);

    const campus = deps.campus ?? createPuCampusGateway();
    try {
      return isStudent
        ? await signInStudent(studentId, password, campus, deps)
        : await signInTeacher(teacherAccount, password, campus, deps);
    } catch (error) {
      if (isSchoolSideFailure(error)) {
        await refundLoginAccountLimit(accountKey, rateCtx);
      }
      throw error;
    }
  } catch (error) {
    if (
      error instanceof PuLoginHttpError ||
      error instanceof LoginRateLimitError ||
      error instanceof LoginRateStoreError
    ) {
      throw error;
    }
    if (error instanceof PuCampusError) {
      const mapped = clientMessage(error);
      throw new PuLoginHttpError(mapped.status, mapped.message);
    }
    if (error instanceof Error && error.message === 'account-deletion') {
      throw new PuLoginHttpError(400, '帳號正在刪除或已停用。');
    }
    if (error instanceof Error && error.message === 'membership-disabled') {
      throw new PuLoginHttpError(403, '這間學校的成員資格已停用，請聯絡校方。');
    }
    logFailure(error, password);
    throw new PuLoginHttpError(500, 'PU student login failed');
  }
}

async function signInStudent(
  rawStudentId: string,
  password: string,
  campus: PuCampusGateway,
  deps: SignInPuDeps,
): Promise<Record<string, unknown>> {
  let login;
  try {
    login = await campus.loginStudent(rawStudentId, password);
  } catch (error) {
    if (error instanceof PuCampusError) {
      const mapped = clientMessage(error);
      throw new PuLoginHttpError(mapped.status, mapped.message);
    }
    throw error;
  }
  if (!login.cookies || Object.keys(login.cookies).length === 0) {
    throw new PuLoginHttpError(401, '學號或密碼錯誤');
  }

  let tronClass: Awaited<ReturnType<PuCampusGateway['loginTronClass']>> | null = null;
  try {
    tronClass = await campus.loginTronClass(rawStudentId, password);
  } catch (error) {
    console.warn('[signInPuStudentId] TronClass login failed (soft):', redact(error, password));
  }

  let profile: Awaited<ReturnType<PuCampusGateway['fetchStudentInfo']>> = {};
  try {
    profile = await campus.fetchStudentInfo(login.cookies);
  } catch (error) {
    if (error instanceof PuCampusError && error.kind !== 'credentials') {
      const mapped = clientMessage(error);
      throw new PuLoginHttpError(mapped.status, mapped.message);
    }
  }

  const studentId = normalizePuStudentId(profile.studentId || rawStudentId);
  const displayName = String(profile.name || login.studentName || `${studentId} 同學`).trim();
  const department = String(profile.class || '').trim();
  const email = buildPuStudentEmail(studentId);
  const uid = buildPuStudentUid(studentId);

  const schoolRole = await writeSchoolLoginProfile({
    db: deps.db,
    uid,
    profile: {
      email,
      displayName,
      studentId,
      department,
      role: 'student',
    },
    membershipFields: {
      studentId,
      displayName,
      department,
    },
  });

  const customToken = await mintToken(deps, uid, {
    schoolId: PROVIDENCE_SCHOOL_ID,
    role: schoolRole.role,
  });

  const now = deps.now?.() ?? Date.now();
  const puSessionId = await writeSession(deps.db, '_puSessions', {
    studentId,
    ownerUid: uid,
    cookies: login.cookies,
  }, now);

  let tronClassSessionId: string | null = null;
  if (tronClass && tronClass.cookies && Object.keys(tronClass.cookies).length > 0) {
    tronClassSessionId = await writeSession(deps.db, '_puTronClassSessions', {
      studentId,
      ownerUid: uid,
      cookies: tronClass.cookies,
      userId: tronClass.userId,
      userName: tronClass.userName,
    }, now);
  }

  return {
    success: true,
    customToken,
    uid,
    studentId,
    displayName,
    department,
    isNewUser: schoolRole.isNewUser,
    role: schoolRole.role,
    puSessionId,
    tronClassSessionId,
    tronClassUserId: tronClass?.userId ?? null,
    tronClassOk: !!tronClassSessionId,
    studentInfo: profile.studentId || profile.name ? profile : null,
    courses: null,
    grades: null,
    creditAudit: null,
    announcements: null,
  };
}

async function signInTeacher(
  account: string,
  password: string,
  campus: PuCampusGateway,
  deps: SignInPuDeps,
): Promise<Record<string, unknown>> {
  let session;
  try {
    session = await campus.loginTronClass(account, password);
  } catch (error) {
    if (error instanceof PuCampusError) {
      if (error.kind === 'closed') {
        throw new PuLoginHttpError(503, '尚未開放');
      }
      if (error.kind === 'unverified') {
        throw new PuLoginHttpError(503, TEACHER_IDENTITY_UNVERIFIED);
      }
      if (error.kind === 'timeout' || error.kind === 'unavailable') {
        throw new PuLoginHttpError(503, SCHOOL_UNAVAILABLE);
      }
      throw new PuLoginHttpError(401, '學號或密碼錯誤');
    }
    throw error;
  }
  if (!hasTronClassSessionCookie(session.cookies) || (!session.userId && !session.userName.trim())) {
    throw new PuLoginHttpError(401, '學號或密碼錯誤');
  }

  let courses: Awaited<ReturnType<PuCampusGateway['fetchTronClassCourses']>> = [];
  try {
    courses = await campus.fetchTronClassCourses(session);
  } catch (error) {
    if (error instanceof PuCampusError && error.kind !== 'credentials') {
      if (error.kind === 'timeout' || error.kind === 'unavailable') {
        throw new PuLoginHttpError(503, SCHOOL_UNAVAILABLE);
      }
      const mapped = clientMessage(error);
      throw new PuLoginHttpError(mapped.status, mapped.message);
    }
  }

  const taught = courses.filter((course) => TEACHER_ROLES.has(course.role));
  const profileIsTeacher = TEACHER_ROLES.has(session.role);
  if (!profileIsTeacher && taught.length === 0) {
    throw new PuLoginHttpError(403, '此帳號沒有教師或校管身分');
  }

  const displayName = String(session.userName || account).trim();
  const email = buildPuTeacherEmail(account);
  const uid = buildPuTeacherUid(account);
  const offeringIds = safeOfferingIds(displayName, taught);

  const schoolRole = await writeSchoolLoginProfile({
    db: deps.db,
    uid,
    profile: {
      email,
      displayName,
      role: 'teacher',
    },
    membershipFields: {
      displayName,
      account: account.toLowerCase(),
    },
    courseOfferingIds: offeringIds,
  });

  const customToken = await mintToken(deps, uid, {
    schoolId: PROVIDENCE_SCHOOL_ID,
    role: schoolRole.role,
  });

  let tronClassSessionId: string | null = null;
  if (session.cookies && Object.keys(session.cookies).length > 0) {
    tronClassSessionId = await writeSession(
      deps.db,
      '_puTronClassSessions',
      {
        ownerUid: uid,
        cookies: session.cookies,
        userId: session.userId,
        userName: session.userName,
      },
      deps.now?.() ?? Date.now(),
    );
  }

  return {
    success: true,
    customToken,
    uid,
    studentId: account,
    displayName,
    department: '',
    isNewUser: schoolRole.isNewUser,
    role: schoolRole.role,
    puSessionId: null,
    tronClassSessionId,
    tronClassUserId: session.userId,
    tronClassOk: !!tronClassSessionId,
    studentInfo: null,
    courses: null,
    grades: null,
    creditAudit: null,
    announcements: null,
    offerings: offeringIds,
  };
}

export function clientIpFromRequest(request: Request): string {
  return request.headers.get('fly-client-ip')?.trim() || 'unknown';
}
