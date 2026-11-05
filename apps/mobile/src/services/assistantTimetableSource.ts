import { onAuthStateChanged } from 'firebase/auth';
import { getAuthInstance, isFirebaseMockMode } from '../firebase';
import { withClassExceptions } from '@campus/shared/src/timetable/classExceptions';
import { toPublicSchoolId } from '@campus/shared/src/schoolIds';
import { loadPersonalImports } from './personalImports';
import { loadOfflinePersonalTimetable, personalTimetableRecords } from './personalTimetable';

export type PlatformTimetableAccess = { accountId: string; isCurrent: () => boolean };

export function isAssistantTimetableOwner(uid: string, platform?: PlatformTimetableAccess) {
  if (platform) return !uid && !!platform.accountId && platform.isCurrent();
  return !!uid && !isFirebaseMockMode() && getAuthInstance().currentUser?.uid === uid;
}

export function subscribeAssistantTimetableOwner(uid: string, refresh: () => void, platform?: PlatformTimetableAccess) {
  if (platform || !uid || isFirebaseMockMode()) return;
  let matched = isAssistantTimetableOwner(uid);
  return onAuthStateChanged(getAuthInstance(), () => {
    const next = isAssistantTimetableOwner(uid);
    if (matched === next) return;
    matched = next;
    refresh();
  });
}

/** The chat response and its foreground hint must use the same account-scoped offline evidence. */
export async function readAssistantTimetable(uid: string, schoolId: string, platform?: PlatformTimetableAccess) {
  if (!schoolId || (platform ? !isAssistantTimetableOwner(uid, platform) : !uid)) return null;
  const owner = platform ? `nuni:${platform.accountId}` : `firebase:${uid}`;
  const [timetable, ledger] = await Promise.all([
    loadOfflinePersonalTimetable(platform ? owner : uid, schoolId),
    loadPersonalImports({ owner, schoolId }),
  ]);
  if (platform && !isAssistantTimetableOwner(uid, platform)) return null;
  const imported = ledger.records.filter((row) => row.kind === 'timetable' && row.schoolId === schoolId);
  if (!timetable && !imported.length) return null;
  const canonical = toPublicSchoolId(schoolId) || schoolId;
  if (timetable && toPublicSchoolId(timetable.schoolId) !== canonical) return null;

  const records = (timetable ? personalTimetableRecords(timetable, imported) : withClassExceptions(imported))
    .map((row) => row.schoolId === canonical ? row : { ...row, schoolId: canonical });
  const savedAt = timetable?.updatedAt;
  let updatedAt = savedAt && Number.isFinite(Date.parse(savedAt)) ? savedAt : null;
  for (const row of imported) {
    if (!updatedAt || Date.parse(row.importedAt) > Date.parse(updatedAt)) updatedAt = row.importedAt;
  }
  return { timetable, schoolId: canonical, records, updatedAt };
}
