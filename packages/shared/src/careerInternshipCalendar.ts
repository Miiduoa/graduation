import type { InternshipCalendarItem } from './careerInternship';
import type { PersonalImportRow } from './imports/types';
/** Shared with existing personal calendar import ledger; preserves source and deterministic identity. */
export function internshipPersonalEvent(
  item: InternshipCalendarItem,
  schoolId: string,
): PersonalImportRow {
  const taipei = (iso: string) => new Date(Date.parse(iso) + 8 * 3600000).toISOString();
  const start = taipei(item.startsAt),
    end = taipei(item.endsAt);
  return {
    id: item.id,
    kind: 'events',
    title: item.title,
    schoolId,
    academicYear: '',
    semester: '',
    date: start.slice(0, 10),
    startTime: start.slice(11, 16),
    endDate: end.slice(0, 10),
    endTime: end.slice(11, 16),
    source: {
      type: 'paste',
      name: '實習學分期限',
      line: 1,
      rawText: `${item.description}\n${item.sourceUrl}`,
    },
  };
}
