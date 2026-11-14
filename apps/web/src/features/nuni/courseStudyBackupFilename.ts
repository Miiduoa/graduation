/**
 * A visible local filename stem shared by note TXT, reading JSON and practice
 * JSON exports. Do not leak invisible format controls into mobile file lists.
 * Keep ZWJ/ZWNJ for readable multilingual and emoji lesson titles.
 */
export function courseStudyBackupFilenameStem(sourceTitle: string): string {
  const safe = sourceTitle
    .replace(/[\p{Cc}\u00ad\u061c\u200b\u200e\u200f\u202a-\u202e\u2060-\u206f\ufeff<>:"/\\|?*]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
    .replace(/\.(pdf|txt|md|markdown)$/i, '')
    .replace(/^[. ]+|[. ]+$/gu, '');
  return Array.from(safe).slice(0, 48).join('').trim() || '讀書白板';
}
