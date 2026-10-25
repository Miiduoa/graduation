/** 舊頁轉址時保留原查詢參數（例如學校代碼、邀請碼）。 */
export function redirectQuery(
  params: Record<string, string | string[] | undefined> | undefined,
  extra?: Record<string, string>,
): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params ?? {})) {
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item) query.append(key, item);
      }
    } else if (value) {
      query.set(key, value);
    }
  }
  if (extra) {
    for (const [key, value] of Object.entries(extra)) query.set(key, value);
  }
  return query.size ? `?${query}` : '';
}
