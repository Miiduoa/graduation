/** Approval-isolated ports. Uses existing scoped personal calendar persistence. */
import {
  createInternshipService,
  type InternshipTransport,
  type InternshipCalendarItem,
} from '@campus/shared/src/careerInternship';
import { internshipPersonalEvent } from '@campus/shared/src/careerInternshipCalendar';
import { savePersonalImportBatch, type PersonalImportScope } from '@/lib/personalImports';
export function createCareerInternshipPorts({
  schoolId,
  transport,
  scope,
  active,
}: {
  schoolId: string;
  transport: InternshipTransport;
  scope: PersonalImportScope;
  active: () => boolean;
}) {
  if (schoolId !== scope.schoolId) throw new Error('行事曆與實習的學校不一致。');
  return {
    service: createInternshipService(schoolId, transport),
    onAddCalendar: (item: InternshipCalendarItem) =>
      savePersonalImportBatch(scope, [internshipPersonalEvent(item, schoolId)], active),
  };
}
