import type { PersonalEventDraft } from '@campus/shared';
import { campusEventPhase } from '@campus/shared/src/campusEventTime';
import { taipeiParts } from '@campus/shared/src/taipeiTime';
import type { CampusEvent } from './publicCampusContent';
import type { PersonalImportScope } from './personalImports';

export type CampusEventCalendarDraft = {
  owner: string;
  schoolId: string;
  eventId: string;
  source: CampusEvent['source'];
  draft: PersonalEventDraft;
};

function taipeiFields(instant: string) {
  const parts = taipeiParts(instant);
  if (!parts) return null;
  const pad = (value: number) => String(value).padStart(2, '0');
  return {
    date: `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`,
    time: `${pad(parts.hour24)}:${pad(parts.minute)}`,
  };
}

export function campusEventCalendarDraft(
  event: CampusEvent,
  scope: PersonalImportScope | null,
  now: number,
): CampusEventCalendarDraft | null {
  if (!scope || scope.schoolId !== event.schoolId) return null;
  if (!event.calendarTime?.startsAt) return null;
  const { startsAt, endsAt } = event.calendarTime;
  const phase = campusEventPhase({ startsAt, endsAt }, now);
  if (phase !== 'upcoming' && phase !== 'ongoing') return null;
  const start = taipeiFields(startsAt);
  if (!start) return null;
  const end = endsAt && Date.parse(endsAt) > Date.parse(startsAt) ? taipeiFields(endsAt) : null;
  return {
    ...scope,
    eventId: event.id,
    source: event.source,
    draft: {
      title: event.title,
      date: start.date,
      startTime: start.time,
      endDate: end && end.date !== start.date ? end.date : '',
      endTime: end?.time ?? '',
      allDay: false,
      location: event.location?.trim() ?? '',
    },
  };
}
