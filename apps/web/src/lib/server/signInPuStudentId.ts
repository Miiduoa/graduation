import { randomBytes } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import {
  TEACHER_LMS_UNAVAILABLE_CODE,
  TEACHER_LMS_UNAVAILABLE_COPY,
} from '@campus/shared/src/schoolLogin';
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
import {
  createPuCampusGateway,
  PuCampusError,
  type CampusLoginRoute,
  type CampusLoginStage,
  type PuCampusGateway,
} from './puCampusClient';
import {
  canonicalizePuStudentId,
  normalizePuAccount,
  normalizePuStudentId,
  providenceAlcatUidCandidates,
  PROVIDENCE_SCHOOL_ID,
} from './puIdentity';
import {
  getSchoolLoginConfig,
  matchSchoolLoginAccount,
  schoolLoginAccountScope,
  schoolLoginHasAdapter,
  schoolLoginIpScope,
  type SchoolLoginConfig,
} from './schoolLoginConfig';
import { writeSchoolLoginProfile, type SchoolLoginFirestore } from './schoolLoginProfile';

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const TEACHER_ROLES = new Set(['teacher', 'instructor', 'faculty', 'professor']);

export class PuLoginHttpError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly route?: CampusLoginRoute;
  readonly stage?: CampusLoginStage;
  readonly causeCode?: string;

  constructor(
    status: number,
    message: string,
    details: {
      code?: string;
      route?: CampusLoginRoute;
      stage?: CampusLoginStage;
      causeCode?: string;
    } = {},
  ) {
    super(message);
    this.name = 'PuLoginHttpError';
    this.status = status;
    this.code = details.code;
    this.route = details.route;
    this.stage = details.stage;
    this.causeCode = details.causeCode;
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
  /** 登入回應送出後才跑成績／WOW Class SSO；測試可改成先收集再手動執行。 */
  scheduleCampusSso?: (task: () => Promise<void>) => void;
};

export const SCHOOL_UNAVAILABLE = '學校系統暫時無法連線';
export const TEACHER_SCHOOL_UNAVAILABLE = SCHOOL_UNAVAILABLE;
export const TEACHER_LMS_UNAVAILABLE = TEACHER_LMS_UNAVAILABLE_COPY;
export { TEACHER_LMS_UNAVAILABLE_CODE };
export const TEACHER_IDENTITY_UNVERIFIED = '暫時無法驗證老師身分';
/** 學生 e 校園驗證單次逾時下限；可用 PU_STUDENT_LOGIN_TIMEOUT_MS 再拉長，不可低於此值。 */
export const MIN_STUDENT_PORTAL_TIMEOUT_MS = 15_000;
export const MAX_STUDENT_PORTAL_TIMEOUT_MS = 60_000;
/** 登入後背景 TronClass／WOW Class SSO，失敗不影響已完成的學號驗證。 */
export const STUDENT_LMS_SOFT_TIMEOUT_MS = MIN_STUDENT_PORTAL_TIMEOUT_MS;

export function studentPortalTimeoutMs(
  raw: string | undefined = process.env.PU_STUDENT_LOGIN_TIMEOUT_MS,
): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return MIN_STUDENT_PORTAL_TIMEOUT_MS;
  return Math.min(
    MAX_STUDENT_PORTAL_TIMEOUT_MS,
    Math.max(MIN_STUDENT_PORTAL_TIMEOUT_MS, Math.trunc(parsed)),
  );
}

type ExpectedCampusFailureReason = 'campus_closed' | 'campus_unreachable';

function expectedCampusFailureReason(error: unknown): ExpectedCampusFailureReason | null {
  if (error instanceof PuCampusError) {
    if (error.kind === 'closed') return 'campus_closed';
    if (error.kind === 'timeout' || error.kind === 'unavailable') return 'campus_unreachable';
    return null;
  }
  if (error instanceof PuLoginHttpError) {
    if (error.message === '尚未開放') return 'campus_closed';
    if (
      error.message === SCHOOL_UNAVAILABLE ||
      error.message === TEACHER_LMS_UNAVAILABLE ||
      error.code === TEACHER_LMS_UNAVAILABLE_CODE
    ) {
      return 'campus_unreachable';
    }
  }
  return null;
}

function campusLogFields(error: unknown): {
  route?: CampusLoginRoute;
  stage?: CampusLoginStage;
  code?: string;
} {
  if (error instanceof PuCampusError) {
    return { route: error.route, stage: error.stage, code: error.code };
  }
  if (error instanceof PuLoginHttpError) {
    return { route: error.route, stage: error.stage, code: error.causeCode || error.code };
  }
  return {};
}

function logStudentSoftFailure(error: unknown, school: string, startedAt: number): void {
  const fields = campusLogFields(error);
  const reason =
    error instanceof PuCampusError
      ? error.kind
      : expectedCampusFailureReason(error) || 'lms_login_failed';
  console.info(
    JSON.stringify({
      msg: 'pu_campus_login_soft_failure',
      reason,
      school,
      route: 'student',
      stage: fields.stage || 'submit',
      ...(fields.code ? { code: fields.code } : {}),
      elapsedMs: Math.max(0, Date.now() - startedAt),
    }),
  );
}

function logExpectedCampusFailure(
  error: unknown,
  startedAt: number,
  school: string,
  route: CampusLoginRoute,
): void {
  const reason = expectedCampusFailureReason(error);
  if (!reason) return;
  const fields = campusLogFields(error);
  console.info(
    JSON.stringify({
      msg: 'pu_campus_login_expected_failure',
      reason,
      school,
      route: fields.route || route,
      ...(fields.stage ? { stage: fields.stage } : {}),
      ...(fields.code ? { code: fields.code } : {}),
      elapsedMs: Math.max(0, Date.now() - startedAt),
    }),
  );
}

function closedWithoutCampus(): never {
  throw new PuLoginHttpError(503, '尚未開放');
}

function campusFromConfig(config: SchoolLoginConfig, injected?: PuCampusGateway): PuCampusGateway {
  if (injected) return injected;
  return createPuCampusGateway({
    portalOrigin: config.endpoints.portal,
    lmsOrigin: config.endpoints.lms,
    timeoutMs: studentPortalTimeoutMs(),
  });
}

function scheduleCampusSsoTask(
  schedule: SignInPuDeps['scheduleCampusSso'],
  task: () => Promise<void>,
): void {
  const run = schedule ?? ((work) => { void work(); });
  run(async () => {
    try {
      await task();
    } catch {
      // SSO 失敗已在 task 內記錄，不可再拋回登入請求。
    }
  });
}

function isRetryableCampusFailure(error: unknown): boolean {
  return error instanceof PuCampusError && (error.kind === 'timeout' || error.kind === 'unavailable');
}

function studentUid(config: SchoolLoginConfig, studentId: string): string {
  return `${config.uid.studentPrefix}${studentId.toLowerCase()}`;
}

function teacherUid(config: SchoolLoginConfig, account: string): string {
  return `${config.uid.teacherPrefix}${account.toLowerCase()}`;
}

function schoolEmail(config: SchoolLoginConfig, local: string): string {
  if (local.includes('@')) return local.toLowerCase();
  return `${local.toLowerCase()}@${config.emailDomain}`;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function loginHttpDetails(error: PuCampusError, route?: CampusLoginRoute) {
  return {
    route: error.route || route,
    stage: error.stage,
    causeCode: error.code,
  };
}

function clientMessage(
  error: PuCampusError,
  route: CampusLoginRoute = error.route || 'student',
): { status: number; message: string; code?: string } {
  if (error.kind === 'credentials') return { status: 401, message: '學號或密碼錯誤' };
  if (error.kind === 'closed') return { status: 503, message: '尚未開放' };
  if (error.kind === 'unverified') return { status: 503, message: TEACHER_IDENTITY_UNVERIFIED };
  if (route === 'teacher' && (error.kind === 'timeout' || error.kind === 'unavailable')) {
    return { status: 503, message: TEACHER_LMS_UNAVAILABLE, code: TEACHER_LMS_UNAVAILABLE_CODE };
  }
  return { status: 503, message: SCHOOL_UNAVAILABLE };
}

function throwMappedCampusError(error: PuCampusError, route: CampusLoginRoute): never {
  const mapped = clientMessage(error, route);
  throw new PuLoginHttpError(mapped.status, mapped.message, {
    code: mapped.code,
    ...loginHttpDetails(error, route),
  });
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
      (error.message === SCHOOL_UNAVAILABLE ||
        error.message === TEACHER_LMS_UNAVAILABLE ||
        error.code === TEACHER_LMS_UNAVAILABLE_CODE ||
        error.message === '尚未開放')
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
    const config = getSchoolLoginConfig(payload.schoolId);
    if (!config || config.status !== 'open') {
      closedWithoutCampus();
    }
    if (!config.studentAdapter && !config.teacherAdapter) {
      closedWithoutCampus();
    }

    const rawAccount = normalizePuAccount(payload.studentId ?? payload.account);
    if (!rawAccount || !password) {
      throw new PuLoginHttpError(400, 'Missing required fields: studentId, password');
    }

    const canonicalStudentId =
      config.schoolId === PROVIDENCE_SCHOOL_ID ? canonicalizePuStudentId(rawAccount) : null;
    const studentId = canonicalStudentId || normalizePuStudentId(rawAccount);
    const teacherAccount = rawAccount;
    const kind = canonicalStudentId
      ? 'student'
      : matchSchoolLoginAccount(config, teacherAccount) === 'teacher'
        ? 'teacher'
        : matchSchoolLoginAccount(config, studentId);
    if (!kind) {
      throw new PuLoginHttpError(400, '學號格式不正確');
    }
    if (!schoolLoginHasAdapter(config, kind)) {
      closedWithoutCampus();
    }

    const accountKey = kind === 'student' ? studentId : teacherAccount.toLowerCase();
    const rateCtx = {
      db: deps.db,
      now: deps.now?.() ?? Date.now(),
      salt: requireRateLimitSalt(deps.rateLimitSalt),
      gate: deps.rateLimitGate ?? getLoginRateGate(),
      accountScope: schoolLoginAccountScope(config.schoolId),
      ipScope: schoolLoginIpScope(config.schoolId),
    };
    await consumeLoginIpLimit(ip, rateCtx);
    await consumeLoginAccountLimit(accountKey, rateCtx);

    const campus = campusFromConfig(config, deps.campus);
    const campusStartedAt = Date.now();
    try {
      return kind === 'student'
        ? await signInStudent(
            studentId,
            config.schoolId === PROVIDENCE_SCHOOL_ID
              ? providenceAlcatUidCandidates(rawAccount)
              : [studentId],
            password,
            campus,
            deps,
            config,
          )
        : await signInTeacher(teacherAccount, password, campus, deps, config);
    } catch (error) {
      logExpectedCampusFailure(error, campusStartedAt, config.schoolId, kind);
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
      throwMappedCampusError(error, error.route || 'student');
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

async function loginStudentWithTimeoutRetry(
  campus: PuCampusGateway,
  portalUid: string,
  password: string,
): Promise<Awaited<ReturnType<PuCampusGateway['loginStudent']>>> {
  try {
    return await campus.loginStudent(portalUid, password);
  } catch (error) {
    if (!isRetryableCampusFailure(error)) throw error;
    return await campus.loginStudent(portalUid, password);
  }
}

async function loginStudentWithAlternateUid(
  campus: PuCampusGateway,
  portalUids: readonly string[],
  password: string,
): Promise<{ login: Awaited<ReturnType<PuCampusGateway['loginStudent']>>; portalUid: string }> {
  const uids = portalUids.filter((uid) => uid.length > 0).slice(0, 2);
  const first = uids[0];
  if (!first) {
    throw new PuLoginHttpError(400, '學號格式不正確');
  }
  try {
    return { login: await loginStudentWithTimeoutRetry(campus, first, password), portalUid: first };
  } catch (error) {
    const alternate = uids[1];
    if (!alternate || !(error instanceof PuCampusError) || error.kind !== 'credentials') {
      if (error instanceof PuCampusError) throwMappedCampusError(error, 'student');
      throw error;
    }
    try {
      return {
        login: await loginStudentWithTimeoutRetry(campus, alternate, password),
        portalUid: alternate,
      };
    } catch (second) {
      if (second instanceof PuCampusError) throwMappedCampusError(second, 'student');
      throw second;
    }
  }
}

async function signInStudent(
  canonicalStudentId: string,
  portalUids: readonly string[],
  password: string,
  campus: PuCampusGateway,
  deps: SignInPuDeps,
  config: SchoolLoginConfig,
): Promise<Record<string, unknown>> {
  if (config.studentAdapter !== 'form-password') {
    closedWithoutCampus();
  }
  const { login, portalUid } = await loginStudentWithAlternateUid(campus, portalUids, password);
  if (!login.cookies || Object.keys(login.cookies).length === 0) {
    throw new PuLoginHttpError(401, '學號或密碼錯誤');
  }

  const studentId = canonicalStudentId;
  const displayName = String(login.studentName || `${studentId} 同學`).trim();
  const department = String(login.studentClass || '').trim();
  const email = schoolEmail(config, studentId);
  const uid = studentUid(config, studentId);

  const schoolRole = await writeSchoolLoginProfile({
    db: deps.db,
    uid,
    schoolId: config.membershipSchoolId,
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
    schoolId: config.schoolId,
    role: schoolRole.role,
  });

  const now = deps.now?.() ?? Date.now();
  const puSessionId = await writeSession(deps.db, '_puSessions', {
    studentId,
    ownerUid: uid,
    cookies: login.cookies,
  }, now);

  scheduleCampusSsoTask(deps.scheduleCampusSso, () =>
    attachStudentLmsSession({
      campus,
      portalUid,
      password,
      studentId,
      uid,
      puSessionId,
      db: deps.db,
      now,
      school: config.schoolId,
    }),
  );

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
    tronClassSessionId: null,
    tronClassUserId: null,
    tronClassOk: false,
    studentInfo:
      login.studentName || login.studentClass
        ? { name: login.studentName || null, class: login.studentClass || null }
        : null,
    courses: null,
    grades: null,
    creditAudit: null,
    announcements: null,
  };
}

async function attachStudentLmsSession(options: {
  campus: PuCampusGateway;
  portalUid: string;
  password: string;
  studentId: string;
  uid: string;
  puSessionId: string;
  db: SignInPuDeps['db'];
  now: number;
  school: string;
}): Promise<void> {
  const startedAt = Date.now();
  try {
    const tronClass = await options.campus.loginTronClass(options.portalUid, options.password, {
      timeoutMs: STUDENT_LMS_SOFT_TIMEOUT_MS,
      route: 'student',
    });
    if (!tronClass?.cookies || Object.keys(tronClass.cookies).length === 0) return;
    const tronClassSessionId = await writeSession(
      options.db,
      '_puTronClassSessions',
      {
        studentId: options.studentId,
        ownerUid: options.uid,
        cookies: tronClass.cookies,
        userId: tronClass.userId,
        userName: tronClass.userName,
      },
      options.now,
    );
    const portalSession = options.db.doc('_puSessions/' + options.puSessionId);
    if (typeof portalSession.set === 'function') {
      await portalSession.set({ tronClassSessionId }, { merge: true });
    }
  } catch (error) {
    logStudentSoftFailure(error, options.school, startedAt);
  }
}

async function signInTeacher(
  account: string,
  password: string,
  campus: PuCampusGateway,
  deps: SignInPuDeps,
  config: SchoolLoginConfig,
): Promise<Record<string, unknown>> {
  if (config.teacherAdapter !== 'lms-password' || config.teacherProof !== 'tronclass-profile') {
    closedWithoutCampus();
  }
  let session;
  try {
    session = await campus.loginTronClass(account, password, { route: 'teacher' });
  } catch (error) {
    if (error instanceof PuCampusError) {
      throwMappedCampusError(error, 'teacher');
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
      throwMappedCampusError(error, 'teacher');
    }
  }

  const taught = courses.filter((course) => TEACHER_ROLES.has(course.role));
  const profileIsTeacher = TEACHER_ROLES.has(session.role);
  if (!profileIsTeacher && taught.length === 0) {
    throw new PuLoginHttpError(403, '此帳號沒有教師或校管身分');
  }

  const displayName = String(session.userName || account).trim();
  const email = schoolEmail(config, account);
  const uid = teacherUid(config, account);
  const offeringIds = safeOfferingIds(displayName, taught);

  const schoolRole = await writeSchoolLoginProfile({
    db: deps.db,
    uid,
    schoolId: config.membershipSchoolId,
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
    schoolId: config.schoolId,
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
