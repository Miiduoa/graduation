import { isStudentCardToken, STUDENT_CARD_TTL_MS } from '@campus/shared/src/studentCard';
import type { User } from 'firebase/auth';

export class StudentCardUnavailable extends Error {}

export type StudentCardCode = { token: string; studentId: string; expiresAt: number };

export async function requestStudentCardCode(
  user: User,
  schoolId: string,
  signal: AbortSignal,
): Promise<StudentCardCode> {
  const bearer = await user.getIdToken();
  if (signal.aborted) throw new StudentCardUnavailable('已取消出示。');
  if (!bearer || bearer === 'mock-token')
    throw new StudentCardUnavailable('請使用已驗證的學校帳號登入後再試。');
  const response = await fetch('https://nuni.tw/api/student-card/present', {
    method: 'POST',
    redirect: 'error',
    cache: 'no-store',
    headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ schoolId }),
    signal,
  });
  if (response.status === 401) throw new StudentCardUnavailable('登入已失效，請重新登入學校帳號。');
  if (response.status === 403)
    throw new StudentCardUnavailable('目前無法核對這個帳號的學號。請使用校方證件。');
  if (response.status === 429) throw new StudentCardUnavailable('申請次數過於頻繁，請稍候再試。');
  if (!response.ok) throw new StudentCardUnavailable('暫時無法取得驗證碼，請稍後再試。');
  const { token, studentId, expiresAt } = await response.json();
  if (
    !isStudentCardToken(token) ||
    typeof studentId !== 'string' ||
    !studentId.trim() ||
    !Number.isSafeInteger(expiresAt) ||
    expiresAt <= Date.now() ||
    expiresAt > Date.now() + STUDENT_CARD_TTL_MS + 5_000
  )
    throw new StudentCardUnavailable('驗證碼無法使用，請重新取得。');
  return { token, studentId, expiresAt };
}
