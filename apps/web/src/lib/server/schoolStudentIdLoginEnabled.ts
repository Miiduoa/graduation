/**
 * 靜宜學號／教職員帳號登入是否走 nuni-web `/api/fn/signInPuStudentId`。
 * 只在伺服器 runtime 讀 process.env，預設關閉。同一個開關是總閘，同時控制
 * sign-in-options 的 studentId 與登入 API；各校是否開放另看 SchoolLoginConfig。
 */
export const SCHOOL_STUDENT_ID_LOGIN_SERVER_FLAG = 'SCHOOL_STUDENT_ID_LOGIN_ENABLED';

export function isSchoolStudentIdLoginEnabled(
  raw: string | undefined = process.env.SCHOOL_STUDENT_ID_LOGIN_ENABLED,
): boolean {
  return typeof raw === 'string' && /^(1|true|on|yes)$/i.test(raw.trim());
}
