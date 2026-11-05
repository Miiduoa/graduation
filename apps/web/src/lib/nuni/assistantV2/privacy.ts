// Free text is allowed only after this common egress filter. This is a bounded
// recognizer, not a claim that arbitrary unlabeled personal data is detectable.
export function maskSensitive(value: string): string {
  return value
    .replace(/("(?:student_?id|grade|score|password|secret|api_?key|access_?token)"\s*:\s*)(?:"[^"\n]*"|-?\d+(?:\.\d+)?)/gi, '$1"[已遮罩]"')
    .replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?(?:-----END [^-]*PRIVATE KEY-----|$)/g, '[憑證已遮罩]')
    .replace(/\b(?:gsk_|sk-(?:proj-)?|gh[pousr]_|github_pat_|AKIA)[A-Za-z0-9_\-/+]{8,}/g, '[憑證已遮罩]')
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[憑證已遮罩]')
    .replace(/(?:Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, '[憑證已遮罩]')
    .replace(/((?:api[_ -]?key|access[_ -]?token|password|secret|密碼|金鑰|憑證)(?:\s*[：:=]\s*|\s+))["']?[^\s,"'，。；<>\[\]{}]+/gi, '$1[已遮罩]')
    .replace(/((?:學號|student[_ -]?id)\s*[：:=]?\s*)[A-Za-z0-9_-]+/gi, '$1[已遮罩]')
    .replace(/((?:成績|分數|grade|score)\s*[：:=]?\s*)(?:\d+(?:\.\d+)?(?:\s*分)?|[A-F][+-]?|不及格|及格)/gi, '$1[已遮罩]');
}
export function maskMessages<T>(value: T): T {
  if (typeof value === 'string') return maskSensitive(value) as T;
  if (Array.isArray(value)) return value.map(maskMessages) as T;
  if (value && typeof value === 'object') return Object.fromEntries(
    Object.entries(value).map(([key, v]) => [key, /^(?:student_?id|grade|score|password|secret|api_?key|access_?token)$/i.test(key) ? '[已遮罩]' : maskMessages(v)]),
  ) as T;
  return value;
}
