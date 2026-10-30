type Env = Record<string, string | undefined>;

export const STUDENT_LOGIN_VIA_TRONCLASS_ENV = 'PU_STUDENT_LOGIN_VIA_TRONCLASS';
export const ECAMPUS_FETCH_PAUSED_ENV = 'PU_ECAMPUS_FETCH_PAUSED';

function envFlagOn(env: Env, name: string): boolean {
  const raw = String(env[name] ?? '').trim().toLowerCase();
  return raw === '1' || raw === 'true';
}

/**
 * PU_STUDENT_LOGIN_VIA_TRONCLASS 為 1 或 true 時，學號登入改走 TronClass／identity（CAS），
 * 登入當下不碰 alcat。未設或其他值時維持舊流程（alcat 登入＋背景 WOW Class）。
 * 設回關閉即可回滾。
 */
export function isStudentLoginViaTronClass(env: Env = process.env): boolean {
  return envFlagOn(env, STUDENT_LOGIN_VIA_TRONCLASS_ENV);
}

/**
 * PU_ECAMPUS_FETCH_PAUSED 為 1 或 true 時視為 E 校園（alcat／mypu）資料抓取暫停。
 * 這裡只供登入流程判斷背景補登是否要跳過；#340 合併後改用
 * ecampusFetchPause.ts 的 isEcampusFetchPaused，統一成同一個模組。
 */
export function isEcampusFetchPausedForLogin(env: Env = process.env): boolean {
  return envFlagOn(env, ECAMPUS_FETCH_PAUSED_ENV);
}
