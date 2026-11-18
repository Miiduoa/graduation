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

/** Read-only fields from the existing club-internal portal projection. */
export type ClubProfileFeed = {
  instagram: string;
  line: string;
  events: Pick<
    NonNullable<import('./clubPortal').ClubPortalView['events']>[number],
    'id' | 'title' | 'startsAt' | 'endsAt' | 'location'
  >[];
};

export function clubProfileFeed(
  view: import('./clubPortal').ClubPortalView,
): ClubProfileFeed | null {
  if (!view.club || !Array.isArray(view.events)) return null;
  const safeLink = (value: string, host: string) => {
    try {
      const url = new URL(value);
      return url.protocol === 'https:' &&
        !url.username &&
        !url.password &&
        (url.hostname === host || url.hostname.endsWith(`.${host}`))
        ? url.href
        : '';
    } catch {
      return '';
    }
  };
  return {
    instagram: safeLink(view.club.instagram, 'instagram.com'),
    line: safeLink(view.club.line, 'line.me'),
    events: view.events.map(({ id, title, startsAt, endsAt, location }) => ({
      id,
      title,
      startsAt,
      endsAt,
      location,
    })),
  };
}
