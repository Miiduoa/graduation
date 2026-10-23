/** 舊 /shops 入口改走現行學校登入頁。 */
export function rewriteLegacyShopsPath(path: string): string {
  return path.replace(/(^|\/)shops(?=\/|\?|$)/, '$1sso-login');
}
