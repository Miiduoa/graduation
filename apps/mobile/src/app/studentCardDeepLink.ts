import { isStudentCardToken } from '@campus/shared/src/studentCard';

const STUDENT_CARD_LINK_PREFIX = 'https://nuni.tw/student-card/verify#';

export function parseStudentCardDeepLink(url: unknown): string | null {
  if (typeof url !== 'string' || !url.startsWith(STUDENT_CARD_LINK_PREFIX)) return null;
  const token = url.slice(STUDENT_CARD_LINK_PREFIX.length);
  return isStudentCardToken(token) ? token : null;
}
