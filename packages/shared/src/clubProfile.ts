// Exact legacy placeholders only; real content may contain these phrases.
const CLUB_PROFILE_PLACEHOLDERS = new Set([
  '未提供',
  '社課時間未提供',
  '社團尚未提供介紹',
  '社團尚未提供介紹。',
]);

export function normalizeClubProfileText(value?: string | null): string {
  const text = value?.trim() ?? '';
  return CLUB_PROFILE_PLACEHOLDERS.has(text) ? '' : text;
}
