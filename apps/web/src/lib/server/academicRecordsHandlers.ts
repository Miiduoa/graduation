import type { CallableRequest } from './groupInviteHandlers';
import { HttpsError } from './httpsError';
import {
  deleteOwnedPuSessions,
  persistOwnedMypuCookies,
  publicCampusDataResult,
} from '../../../../../backend/functions/lib/puSessionStore.js';

type RecordData = Record<string, unknown>;
export type SchoolDataSnapshot = { exists: boolean; data: () => RecordData | undefined };
type Snapshot = SchoolDataSnapshot;
export type AcademicDocRef = {
  path?: string;
  id?: string;
  get: () => Promise<Snapshot>;
  set?: (data: RecordData, options?: { merge?: boolean }) => Promise<unknown>;
  delete?: () => Promise<unknown>;
};
type SessionSnapshot = Snapshot & { ref: AcademicDocRef };
type SessionQuery = {
  where: (field: string, operator: string, value: unknown) => SessionQuery;
  orderBy: (field: string, direction: 'desc') => SessionQuery;
  limit: (count: number) => SessionQuery;
  get: () => Promise<{ docs: SessionSnapshot[]; empty?: boolean }>;
};

export type AcademicTransaction = {
  get: (ref: AcademicDocRef) => Promise<Snapshot>;
  set: (ref: AcademicDocRef, data: RecordData, options?: { merge?: boolean }) => void;
};

export type AcademicFirestore = {
  doc: (path: string) => {
    get: () => Promise<Snapshot>;
    set?: (data: RecordData, options?: { merge?: boolean }) => Promise<unknown>;
  };
  collection: (path: string) => SessionQuery;
  runTransaction?: <T>(fn: (tx: AcademicTransaction) => Promise<T>) => Promise<T>;
};
export type AcademicGradeOptions = {
  mypuCookies?: Record<string, string> | null;
};

export type AcademicFetchers = {
  courses: (cookies: Record<string, string>, semester: string) => Promise<unknown>;
  grades: (
    cookies: Record<string, string>,
    semester: string,
    options?: AcademicGradeOptions,
  ) => Promise<unknown>;
};

function record(value: unknown): RecordData {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as RecordData)
    : {};
}

export function schoolSessionExpiry(value: unknown): number {
  if (value instanceof Date) return value.getTime();
  if (value && typeof value === 'object' && 'toDate' in value && typeof value.toDate === 'function') {
    const date: unknown = value.toDate();
    return date instanceof Date ? date.getTime() : Number.NaN;
  }
  return Number.NaN;
}

export function schoolSessionCookies(value: unknown): Record<string, string> | null {
  const entries = Object.entries(record(value));
  if (!entries.length || entries.some(([key, item]) =>
    !key || /[\s;=\r\n]/.test(key) || typeof item !== 'string' || /[;\r\n]/.test(item),
  )) return null;
  return Object.fromEntries(entries) as Record<string, string>;
}

function reconnect(): never {
  throw new HttpsError('failed-precondition', '校務連線已過期，請重新以學號登入。');
}

function unavailable(): never {
  throw new HttpsError('unavailable', '目前無法取得學校資料，請稍後重試。');
}

function publicResult(kind: keyof AcademicFetchers, result: RecordData): RecordData {
  return publicCampusDataResult(kind, result) as RecordData;
}

export async function requireAcademicAccount(db: AcademicFirestore, uid: string): Promise<void> {
  const [profile, membership] = await Promise.all([
    db.doc(`users/${uid}`).get(),
    db.doc(`schools/pu/members/${uid}`).get(),
  ]);
  const account = profile.data();
  if (!profile.exists || account?.schoolId !== 'pu' ||
    account.accountDeletionInProgress === true || account.status === 'deleted' ||
    !membership.exists || membership.data()?.status !== 'active') {
    throw new HttpsError('permission-denied', '目前無法確認你的在校身分。');
  }
}

export function createAcademicRecordsHandler({
  db,
  fetchers,
  now = Date.now,
}: {
  db: AcademicFirestore;
  fetchers: AcademicFetchers;
  now?: () => number;
}) {
  return async (request: CallableRequest) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError('unauthenticated', '請先登入校園帳號。');
    if (request.auth?.token?.schoolId !== 'pu') {
      throw new HttpsError('permission-denied', '此帳號尚未連結靜宜大學。');
    }
    const data = record(request.data);
    const kind = data.dataType;
    if (typeof kind !== 'string' || !['courses', 'grades'].includes(kind) ||
      Object.keys(data).some((key) => key !== 'dataType')) {
      throw new HttpsError('invalid-argument', '請選擇課表或成績資料。');
    }
    const dataType = kind as keyof AcademicFetchers;
    try {
      await requireAcademicAccount(db, uid);
      // 使用登入已建立的本人 session；前端不能指定他人的學號、學校或 session。
      const sessions = await db.collection('_puSessions')
        .where('ownerUid', '==', uid)
        .orderBy('expiresAt', 'desc')
        .limit(1)
        .get();
      const selected = sessions.docs[0];
      const session = selected?.data();
      const cookies = schoolSessionCookies(session?.cookies);
      if (!selected || !session || session.ownerUid !== uid || !cookies ||
        !(schoolSessionExpiry(session.expiresAt) > now())) reconnect();

      const storedMypu = schoolSessionCookies(session.mypuCookies);
      const result = record(
        dataType === 'grades'
          ? await fetchers.grades(cookies, '', { mypuCookies: storedMypu })
          : await fetchers.courses(cookies, ''),
      );
      if (result.code === 'session-expired') reconnect();
      if (result.success !== true || !Array.isArray(result[dataType])) unavailable();
      const nextMypu = dataType === 'grades' ? schoolSessionCookies(result.mypuCookies) : null;
      if (nextMypu) {
        await persistOwnedMypuCookies(db, selected.ref, uid, nextMypu);
      }

      // 學校回應較慢時，重新確認帳號、校籍與 session，避免撤銷後仍回傳資料。
      await requireAcademicAccount(db, uid);
      const latest = await selected.ref.get();
      const current = latest.data();
      if (!latest.exists || current?.ownerUid !== uid ||
        !schoolSessionCookies(current.cookies) || !(schoolSessionExpiry(current.expiresAt) > now())) reconnect();

      return {
        success: true,
        ownerUid: uid,
        schoolId: 'pu',
        source: 'pu-campus',
        dataType,
        fetchedAt: new Date(now()).toISOString(),
        result: publicResult(dataType, result),
      };
    } catch (error) {
      if (error instanceof HttpsError) throw error;
      // 不把含有網址、cookie 或原始 HTML 的底層錯誤回傳給瀏覽器。
      unavailable();
    }
  };
}

export function createClearPuCampusSessions({ db }: { db: AcademicFirestore }) {
  return async (request: CallableRequest) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError('unauthenticated', '請先登入校園帳號。');
    const deleted = await deleteOwnedPuSessions(db, uid);
    return { success: true, deleted };
  };
}
