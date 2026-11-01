import { useEffect } from 'react';
import { AppState } from 'react-native';
import { usePersonalImportScope } from '../state/personalImportScope';
import { loadPersonalImports, subscribePersonalImports } from '../services/personalImports';
import { loadPersonalTimetable, personalTimetableRecords } from '../services/personalTimetable';
import { refreshClassReminders } from '../services/classReminders';
import { subscribeTimetableChanges } from '../widgets/timetableChanges';

export function useClassReminders() {
  const scope = usePersonalImportScope();
  const owner = scope?.owner;
  const schoolId = scope?.schoolId;
  useEffect(() => {
    if (!owner || !schoolId || owner === 'guest:device') {
      void refreshClassReminders(null).catch(() => undefined);
      return;
    }
    const refresh = () =>
      refreshClassReminders(JSON.stringify({ owner, schoolId }), async () => {
        const [ledger, timetable] = await Promise.all([
          loadPersonalImports({ owner, schoolId }),
          loadPersonalTimetable(
            owner.startsWith('firebase:') ? owner.slice(9) : null,
            schoolId,
            owner.startsWith('nuni:') ? owner : undefined,
          ),
        ]);
        return { records: personalTimetableRecords(timetable, ledger.records), schoolId };
      }).catch(() => undefined);
    void refresh();
    const imports = subscribePersonalImports(({ scope: changed }) => {
      if (changed.owner === owner && changed.schoolId === schoolId) void refresh();
    });
    const manual = subscribeTimetableChanges(() => void refresh());
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refresh();
    });
    return () => {
      imports();
      manual();
      subscription.remove();
      void refreshClassReminders(null).catch(() => undefined);
    };
  }, [owner, schoolId]);
}
