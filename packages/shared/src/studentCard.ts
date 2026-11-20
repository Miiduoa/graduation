import { toPublicSchoolId } from './schoolIds';

export function maskStudentId(value: string): string {
  const id = value.trim();
  if (!id) return '';
  return id.length > 4 ? '•••• ' + id.slice(-4) : '••••';
}

type CardService = { name: string; detail: string; url: string; ios?: string; android?: string };

const services: ReadonlyMap<string, CardService> = new Map([
  [
    'pu',
    {
      name: '靜宜大學 App',
      detail: '登入 MyPU，依校方說明開啟臨時識別證。',
      url: 'https://dorac.pu.edu.tw/var/file/59/1059/img/451/1090415NEWS.pdf',
      ios: 'https://apps.apple.com/tw/app/id740276935',
      android: 'https://play.google.com/store/apps/details?id=tw.edu.pu.act',
    },
  ],
  [
    'cmu',
    {
      name: '中國醫藥大學數位憑證',
      detail:
        '登入校園入口網站，在「應用系統」搜尋「數位憑證服務」，即可將校方學生證加入數位憑證皮夾。',
      url: 'https://portal.cmu.edu.tw/index.do',
    },
  ],
  [
    'fcu',
    {
      name: '行動逢甲',
      detail: '登入行動逢甲後開啟數位逢甲卡，可用於借書及支援掃碼的門禁點。',
      url: 'https://its.fcu.edu.tw/fcucard',
      ios: 'https://apps.apple.com/tw/app/id6633420933',
      android: 'https://play.google.com/store/apps/details?id=com.fcuapp.app',
    },
  ],
  [
    'thu',
    {
      name: '東海大學 LINE',
      detail: '綁定校園帳號後，從電子證卡開啟校方 QR Code。',
      url: 'https://page.line.me/why2679h',
    },
  ],
]);

export function getStudentCardService(
  schoolId: string | null | undefined,
  platform: 'web' | 'ios' | 'android' = 'web',
) {
  const service = services.get(toPublicSchoolId(schoolId) ?? '');
  if (!service) return null;
  const { name, detail, url } = service;
  return { name, detail, url: platform === 'web' ? url : (service[platform] ?? url) };
}

export const STUDENT_CARD_TTL_MS = 60_000;
export function isStudentCardToken(value: unknown): value is string {
  return typeof value === 'string' && value.length === 32 && /^[A-Za-z0-9_-]{32}$/.test(value);
}

export function isStudentCardVerificationId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length === 36 &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value)
  );
}

export type StudentCardVerification = { schoolName: string; maskedId: string; verifiedAt: number };

export function isStudentCardVerification(
  value: unknown,
  now = Date.now(),
): value is StudentCardVerification {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const { schoolName, maskedId, verifiedAt } = value as Record<string, unknown>;
  return (
    typeof schoolName === 'string' &&
    !!schoolName.trim() &&
    schoolName.length <= 160 &&
    typeof maskedId === 'string' &&
    maskedId.length === 9 &&
    /^•••• [A-Za-z0-9._-]{4}$/.test(maskedId) &&
    typeof verifiedAt === 'number' &&
    Number.isSafeInteger(verifiedAt) &&
    verifiedAt > 0 &&
    verifiedAt <= now + 5_000 &&
    verifiedAt >= now - STUDENT_CARD_TTL_MS
  );
}
