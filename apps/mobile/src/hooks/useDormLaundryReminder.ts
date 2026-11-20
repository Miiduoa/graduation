import { useEffect } from 'react';
import { AppState } from 'react-native';
import { dormStorageKey } from '@campus/shared/src/dormitory';
import { useAuth } from '../state/auth';
import { useOptionalNuniSession } from '../state/nuniSession';
import { useSchool } from '../state/school';
import { refreshDormLaundryReminder, selectDormLaundryScope } from '../services/dormLaundryReminder';

export function useDormitoryOwner() {
  const { user, loading } = useAuth();
  const nuni = useOptionalNuniSession();
  const { selectionReady } = useSchool();
  if (selectionReady === false || loading || nuni?.loading || nuni?.pendingLogout) return null;
  if (user?.uid) return 'firebase:' + user.uid;
  if (nuni?.session) return 'platform:' + nuni.session.platformAccountId;
  return 'guest';
}

export function useDormLaundryReminder() {
  const owner = useDormitoryOwner();
  const { school } = useSchool();
  const key = owner && school?.id ? dormStorageKey(owner, school.id) : null;
  useEffect(() => {
    void selectDormLaundryScope(key).catch(() => undefined);
    const listener = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refreshDormLaundryReminder(key).catch(() => undefined);
    });
    return () => {
      listener.remove();
      void selectDormLaundryScope(null).catch(() => undefined);
    };
  }, [key]);
}
