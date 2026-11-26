import { formatTodayClassCalendarOverlapAnswer } from '@campus/shared/src/classCalendarOverlap';
import { toPublicSchoolId } from '@campus/shared/src/schoolIds';
import type { PersonalImportScope } from './personalImports';
import { snapshotPersonalImports } from './personalImports';
import { loadOfflinePersonalTimetable, scopedPersonalTimetableRecords } from './personalTimetable';

/** Read the device's saved copies, using the same owner keys as the personal calendar and timetable. */
export async function readAssistantClassCalendar(scope: PersonalImportScope, uid: string, current: () => boolean) {
  const [calendar, timetable] = await Promise.all([
    snapshotPersonalImports(scope, current),
    loadOfflinePersonalTimetable(uid || scope.owner, scope.schoolId),
  ]);
  if (!current()) throw new Error('帳號或校園已變更。');
  const schoolId = toPublicSchoolId(scope.schoolId) || scope.schoolId;
  if (timetable && toPublicSchoolId(timetable.schoolId) !== schoolId) throw new Error('無法核對課表校園。');
  const records = scopedPersonalTimetableRecords(timetable, calendar.records, schoolId);
  return formatTodayClassCalendarOverlapAnswer(records, schoolId, new Date(), '這台手機');
}
