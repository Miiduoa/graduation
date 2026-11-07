import { createHash, randomBytes } from 'node:crypto';
import type { Firestore, Transaction } from 'firebase-admin/firestore';
import { NuniError } from '@campus/shared/src/nuni';
import { getPublicSchoolInfo } from '@campus/shared/src/publicSchoolInfo';
import { toPublicSchoolId } from '@campus/shared/src/schoolIds';
import {
  isStudentCardToken,
  isStudentCardVerification,
  isStudentCardVerificationId,
  maskStudentId,
  STUDENT_CARD_TTL_MS,
  type StudentCardVerification,
} from '@campus/shared/src/studentCard';
import { boundedJson } from '@/lib/nuni/server';
import { getFirebaseAdmin } from './firebaseAdmin';
import { createUidRateLimiter } from './uidRateLimit';

type Account = { uid: string } & Record<string, unknown>;
const claimsLifetime = 24 * 60 * 60 * 1000;
const presentationLimit = createUidRateLimiter();
const scanLimit = createUidRateLimiter({ requestsPerMinute: 120 });
const collection = '_studentCardPresentations';

function fail(status: number, code: string): never {
  throw new NuniError(status, code);
}

function tokenHash(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

export function cardIdentity(account: Account, requestedSchool: unknown, now: number) {
  const schoolId = account.schoolId;
  const id = account.campusCardStudentId;
  const provider = (account.firebase as { sign_in_provider?: unknown } | null)?.sign_in_provider;
  const authAt = typeof account.auth_time === 'number' ? account.auth_time * 1000 : NaN;
  if (
    typeof requestedSchool !== 'string' ||
    typeof schoolId !== 'string' ||
    toPublicSchoolId(requestedSchool) !== schoolId ||
    getPublicSchoolInfo(schoolId)?.id !== schoolId ||
    provider !== 'custom' ||
    account.role !== 'student' ||
    typeof id !== 'string' ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]{4,31}$/.test(id) ||
    !Number.isFinite(authAt) ||
    authAt > now ||
    now - authAt >= claimsLifetime
  ) {
    fail(403, 'SCHOOL_SIGN_IN_REQUIRED');
  }
  return { schoolId, studentId: id };
}

async function activeMember(db: Firestore, tx: Transaction, uid: string, school: string) {
  const [user, member] = await tx.getAll(
    db.doc('users/' + uid),
    db.doc('schools/' + school + '/members/' + uid),
  );
  return (
    user.exists &&
    user.get('role') === 'student' &&
    toPublicSchoolId(user.get('schoolId')) === school &&
    toPublicSchoolId(user.get('primarySchoolId') ?? user.get('schoolId')) === school &&
    user.get('accountDeletionInProgress') !== true &&
    !['deleted', 'disabled', 'suspended', 'inactive'].includes(user.get('status')) &&
    member.get('status') === 'active'
  );
}

export async function issueStudentCard(
  db: Firestore,
  account: Account,
  requestedSchool: unknown,
  { requestedAt = Date.now(), signal }: { requestedAt?: number; signal?: AbortSignal } = {},
) {
  if (signal?.aborted) fail(409, 'PRESENTATION_CANCELLED');
  const { schoolId, studentId } = cardIdentity(account, requestedSchool, Date.now());
  const token = randomBytes(24).toString('base64url');
  const ref = db.collection(collection).doc(account.uid);
  const expiresAt = await db.runTransaction(async (tx) => {
    if (signal?.aborted) fail(409, 'PRESENTATION_CANCELLED');
    if (!(await activeMember(db, tx, account.uid, schoolId))) fail(403, 'SCHOOL_SIGN_IN_REQUIRED');
    const previous = await tx.get(ref);
    const now = Date.now();
    if (signal?.aborted) fail(409, 'PRESENTATION_CANCELLED');
    if (previous.exists && now - previous.get('issuedAt') < 2_000) fail(429, 'TRY_LATER');
    if (previous.exists && requestedAt <= (previous.get('requestedAt') ?? previous.get('issuedAt')))
      fail(409, 'PRESENTATION_SUPERSEDED');
    const expiry = now + STUDENT_CARD_TTL_MS;
    tx.set(ref, {
      schoolId,
      maskedId: maskStudentId(studentId),
      digest: tokenHash(token),
      requestedAt,
      issuedAt: now,
      expiresAt: expiry,
    });
    return expiry;
  });
  return { token, studentId, expiresAt };
}

export async function redeemStudentCard(
  db: Firestore,
  token: string,
  verificationId?: string,
): Promise<StudentCardVerification> {
  if (
    !isStudentCardToken(token) ||
    (verificationId !== undefined && !isStudentCardVerificationId(verificationId))
  )
    fail(400, 'INVALID_INPUT');
  const digest = tokenHash(token);
  const matches = await db.collection(collection).where('digest', '==', digest).limit(1).get();
  const ref = matches.docs[0]?.ref;
  if (!ref) fail(410, 'CARD_UNAVAILABLE');
  return db.runTransaction(async (tx) => {
    const record = await tx.get(ref);
    const expiresAt = record.get('expiresAt');
    if (record.get('digest') !== digest || !Number.isFinite(expiresAt) || expiresAt <= Date.now())
      fail(410, 'CARD_UNAVAILABLE');
    const schoolId: string = record.get('schoolId');
    const school = getPublicSchoolInfo(schoolId);
    if (!school || !(await activeMember(db, tx, record.id, schoolId)))
      fail(410, 'CARD_UNAVAILABLE');
    const verifiedAt = Date.now();
    if (expiresAt <= verifiedAt) fail(410, 'CARD_UNAVAILABLE');
    const previousReceipt: unknown = record.get('receipt');
    if (previousReceipt !== undefined) {
      if (
        !verificationId ||
        record.get('verificationDigest') !== tokenHash(verificationId) ||
        !isStudentCardVerification(previousReceipt, verifiedAt)
      )
        fail(410, 'CARD_UNAVAILABLE');
      return {
        schoolName: previousReceipt.schoolName,
        maskedId: previousReceipt.maskedId,
        verifiedAt: previousReceipt.verifiedAt,
      };
    }
    const receipt = {
      schoolName: school.name,
      maskedId: record.get('maskedId') as string,
      verifiedAt,
    };
    // Keep the issuance fence after use so an older request cannot replace this card.
    tx.update(record.ref, {
      receipt,
      verificationDigest: verificationId ? tokenHash(verificationId) : null,
    });
    return receipt;
  });
}

function json(data: unknown, status = 200) {
  return Response.json(data, {
    status,
    headers: { 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer' },
  });
}

async function requireCardAdmin() {
  return (await getFirebaseAdmin()) ?? fail(503, 'TEMPORARILY_UNAVAILABLE');
}

export async function studentCardRequest(request: Request, action: 'present' | 'verify') {
  const requestedAt = Date.now();
  try {
    const body = await boundedJson(request, 1024).catch((error) => {
      if (error instanceof NuniError && error.status === 413) throw error;
      fail(400, 'INVALID_INPUT');
    });
    if (!body || typeof body !== 'object') fail(400, 'INVALID_INPUT');
    if (action === 'verify') {
      const token = 'token' in body ? body.token : null;
      const verificationId = 'verificationId' in body ? body.verificationId : undefined;
      if (
        !isStudentCardToken(token) ||
        (verificationId !== undefined && !isStudentCardVerificationId(verificationId))
      )
        fail(400, 'INVALID_INPUT');
      scanLimit.check(request.headers.get('fly-client-ip') || 'unknown');
      return json(await redeemStudentCard((await requireCardAdmin()).db, token, verificationId));
    }
    if (request.signal.aborted) fail(409, 'PRESENTATION_CANCELLED');
    const bearer = /^Bearer (\S+)$/i.exec(request.headers.get('authorization') ?? '');
    if (!bearer) fail(401, 'SIGN_IN_REQUIRED');
    const admin = await requireCardAdmin();
    const account = await admin
      .verifyIdToken(bearer[1]!, true)
      .catch(() => fail(401, 'SIGN_IN_REQUIRED'));
    presentationLimit.check(account.uid);
    return json(
      await issueStudentCard(admin.db, account, 'schoolId' in body ? body.schoolId : null, {
        requestedAt,
        signal: request.signal,
      }),
    );
  } catch (error) {
    if (error instanceof NuniError) return json({ error: error.code }, error.status);
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      error.code === 'resource-exhausted'
    ) {
      return json({ error: 'TRY_LATER' }, 429);
    }
    return json({ error: 'TEMPORARILY_UNAVAILABLE' }, 503);
  }
}
