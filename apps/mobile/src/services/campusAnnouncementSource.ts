export type CampusAnnouncementSource = {
  kind: 'school-announcement' | 'legacy-announcement';
  id: string;
};

export function parseCampusAnnouncementSource(value: unknown): CampusAnnouncementSource | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const { kind, id } = value as Record<string, unknown>;
  if ((kind !== 'school-announcement' && kind !== 'legacy-announcement') ||
      typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(id)) return null;
  return { kind, id };
}
