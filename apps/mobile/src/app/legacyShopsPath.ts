/** 舊 /shops 入口改走現行學校登入頁；已下架功能深鏈改走今天。 */
export function rewriteLegacyShopsPath(path: string): string {
  return path
    .replace(/(^|\/)shops(?=\/|\?|$)/, '$1sso-login')
    .replace(/(^|\/)(?:staff|department|dormitory)(?=\/|\?|$)/, '$1home');
}
