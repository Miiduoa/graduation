import {
  isStudentCardToken,
  isStudentCardVerification,
  isStudentCardVerificationId,
  STUDENT_CARD_TTL_MS,
  type StudentCardVerification,
} from '@campus/shared/src/studentCard';
import type { User } from 'firebase/auth';
import { abortableCampusRead } from './abortableCampusRead';

export class StudentCardUnavailable extends Error {
  constructor(
    message: string,
    public readonly retryable = false,
  ) {
    super(message);
    this.name = 'StudentCardUnavailable';
  }
}

export type StudentCardCode = { token: string; studentId: string; expiresAt: number };
export type { StudentCardVerification } from '@campus/shared/src/studentCard';

async function readCardResponse(
  response: Response,
  signal: AbortSignal,
): Promise<Record<string, unknown>> {
  const body = await abortableCampusRead(() => response.text(), signal);
  const invalid = () => new StudentCardUnavailable('驗證資料無法確認，請重新出示後再試。');
  if (typeof body !== 'string' || body.length > 2_048) throw invalid();
  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch {
    throw invalid();
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid();
  return value as Record<string, unknown>;
}

export async function requestStudentCardCode(
  user: User,
  schoolId: string,
  signal: AbortSignal,
): Promise<StudentCardCode> {
  try {
    const bearer = await abortableCampusRead(() => user.getIdToken(), signal);
    if (!bearer || bearer === 'mock-token')
      throw new StudentCardUnavailable('請使用已驗證的學校帳號登入後再試。');
    const response = await abortableCampusRead(
      () =>
        fetch('https://nuni.tw/api/student-card/present', {
          method: 'POST',
          redirect: 'error',
          credentials: 'omit',
          cache: 'no-store',
          headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ schoolId }),
          signal,
        }),
      signal,
    );
    if (response.status === 401)
      throw new StudentCardUnavailable('登入已失效，請重新登入學校帳號。');
    if (response.status === 403)
      throw new StudentCardUnavailable('目前無法核對這個帳號的學號。請使用校方證件。');
    if (response.status === 429)
      throw new StudentCardUnavailable('申請次數過於頻繁，請稍候再試。', true);
    if (!response.ok)
      throw new StudentCardUnavailable('暫時無法取得驗證碼，請稍後再試。', response.status >= 500);
    const { token, studentId, expiresAt } = await readCardResponse(response, signal);
    const now = Date.now();
    if (
      !isStudentCardToken(token) ||
      typeof studentId !== 'string' ||
      studentId.trim() !== studentId ||
      !/^[A-Za-z0-9][A-Za-z0-9._-]{4,31}$/.test(studentId) ||
      typeof expiresAt !== 'number' ||
      !Number.isSafeInteger(expiresAt) ||
      expiresAt <= now ||
      expiresAt > now + STUDENT_CARD_TTL_MS + 5_000
    )
      throw new StudentCardUnavailable('驗證碼無法使用，請重新取得。');
    if (signal.aborted) throw new StudentCardUnavailable('已取消出示。');
    return { token, studentId, expiresAt };
  } catch (error) {
    if (signal.aborted || (error instanceof Error && error.name === 'AbortError'))
      throw new StudentCardUnavailable('已取消出示。');
    if (error instanceof StudentCardUnavailable) throw error;
    throw new StudentCardUnavailable('暫時無法取得驗證碼，請稍後再試。', true);
  }
}

export async function verifyStudentCardCode(
  token: string,
  signal: AbortSignal,
  verificationId?: string,
): Promise<StudentCardVerification> {
  if (signal.aborted) throw new StudentCardUnavailable('已取消核對。');
  if (
    !isStudentCardToken(token) ||
    (verificationId !== undefined && !isStudentCardVerificationId(verificationId))
  )
    throw new StudentCardUnavailable('驗證碼無法使用，請對方重新出示。');
  try {
    const response = await abortableCampusRead(
      () =>
        fetch('https://nuni.tw/api/student-card/verify', {
          method: 'POST',
          redirect: 'error',
          credentials: 'omit',
          cache: 'no-store',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token, verificationId }),
          signal,
        }),
      signal,
    );
    if (response.status === 400 || response.status === 410)
      throw new StudentCardUnavailable('這組驗證碼已失效，請對方重新出示。');
    if (response.status === 429)
      throw new StudentCardUnavailable('核對次數過於頻繁，請稍候再試。', true);
    if (!response.ok)
      throw new StudentCardUnavailable('暫時無法連線核對，請稍後再試。', response.status >= 500);
    const receipt = await readCardResponse(response, signal);
    if (!isStudentCardVerification(receipt))
      throw new StudentCardUnavailable('驗證資料無法確認，請重新出示後再試。');
    if (signal.aborted) throw new StudentCardUnavailable('已取消核對。');
    const { schoolName, maskedId, verifiedAt } = receipt;
    return { schoolName, maskedId, verifiedAt };
  } catch (error) {
    if (signal.aborted || (error instanceof Error && error.name === 'AbortError'))
      throw new StudentCardUnavailable('已取消核對。');
    if (error instanceof StudentCardUnavailable) throw error;
    throw new StudentCardUnavailable('暫時無法連線核對，請稍後再試。', true);
  }
}
