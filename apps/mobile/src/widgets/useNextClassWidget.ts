import { useEffect } from 'react';
import { AppState, Platform } from 'react-native';
import Constants from 'expo-constants';
import { usePersonalImportScope } from '../state/personalImportScope';
import { loadPersonalImports, subscribePersonalImports } from '../services/personalImports';
import { loadPersonalTimetable, personalTimetableRecords } from '../services/personalTimetable';
import { subscribeTimetableChanges } from './timetableChanges';
import { nextClassWriter } from './nextClassBridge';
import { buildNextClassSnapshot } from './nextClassSnapshot';

export function useNextClassWidget() {
  const scope = usePersonalImportScope();
  const owner = scope?.owner;
  const schoolId = scope?.schoolId;
  useEffect(() => {
    if (Platform.OS !== 'ios') return;
    let active = true;
    void nextClassWriter.clear().catch(() => undefined);
    if (
      !owner ||
      !schoolId ||
      owner === 'guest:device' ||
      Constants.expoConfig?.extra?.release?.features?.widgets === false
    )
      return;
    const refresh = async () => {
      const revision = nextClassWriter.begin();
      try {
        const [ledger, timetable] = await Promise.all([
          loadPersonalImports({ owner, schoolId }),
          loadPersonalTimetable(
            owner.startsWith('firebase:') ? owner.slice(9) : null,
            schoolId,
            owner.startsWith('nuni:') ? owner : undefined,
          ),
        ]);
        if (active)
          await nextClassWriter.write(
            buildNextClassSnapshot(
              [...personalTimetableRecords(timetable), ...ledger.records],
              schoolId,
            ),
            revision,
          );
      } catch {
        // Keep the last readable snapshot with its original expiry and update time.
      }
    };
    void refresh();
    const imports = subscribePersonalImports(({ scope: changed }) => {
      if (changed.owner === owner && changed.schoolId === schoolId) void refresh();
    });
    const manual = subscribeTimetableChanges(() => {
      void refresh();
    });
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refresh();
    });
    return () => {
      active = false;
      imports();
      manual();
      subscription.remove();
      void nextClassWriter.clear().catch(() => undefined);
    };
  }, [owner, schoolId]);
}
