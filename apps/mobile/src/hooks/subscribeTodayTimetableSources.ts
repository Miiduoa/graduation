import { subscribePersonalImports, type PersonalImportScope } from '../services/personalImports';
import { subscribeTimetableChanges } from '../widgets/timetableChanges';

export function subscribeTodayTimetableSources(scope: PersonalImportScope, refresh: () => void) {
  const unsubscribeLedger = subscribePersonalImports((change) => {
    if (change.scope.owner === scope.owner && change.scope.schoolId === scope.schoolId) refresh();
  });
  const unsubscribeTimetable = subscribeTimetableChanges(refresh);
  return () => {
    unsubscribeLedger();
    unsubscribeTimetable();
  };
}
