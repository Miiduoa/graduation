/** 僅伺服器端讀取；必須明確設為小寫 true 才啟用。 */
export function isSchoolLmsReadonlyEnabled(): boolean {
  return process.env.SCHOOL_LMS_READONLY_ENABLED === 'true';
}
