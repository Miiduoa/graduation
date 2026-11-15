/** Approval-isolated ports; same personal calendar ledger used by mobile calendar. */
import {
  createInternshipService,
  type InternshipTransport,
  type InternshipCalendarItem,
} from '@campus/shared/src/careerInternship';
import { internshipPersonalEvent } from '@campus/shared/src/careerInternshipCalendar';
import { appendPersonalImports, type PersonalImportScope } from '../../services/personalImports';
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
      appendPersonalImports(scope, [internshipPersonalEvent(item, schoolId)], active),
  };
}
