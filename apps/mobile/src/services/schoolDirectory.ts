import { collection, getDocs, limit, query } from 'firebase/firestore';

import { type School } from '@campus/shared/src';
import { getPublicSchoolInfo, publicSchoolInfoDirectory } from '@campus/shared/src/publicSchoolInfo';
import { normalizeSchoolIntegrationStatus } from '@campus/shared/src/release';
import { mockSchools, normalizeSchoolCode } from '@campus/shared/src/schools';
import { isPlaceholderAnnouncementSchool } from '@campus/shared/src/campusAnnouncements';

import { getDb } from '../firebase';
import { getSchoolIntegrationStatus, isSchoolVisibleInDirectory } from './release';

const DIRECTORY_TIMEOUT_MS = 5000;

type BrowsableSchool = School & { publicBrowsing?: boolean };
const legacyDirectoryIds = new Set(mockSchools.map((school) => getPublicSchoolInfo(school.id)?.id));
const publicOnlySchools: School[] = Object.values(publicSchoolInfoDirectory)
  .filter((record) => !legacyDirectoryIds.has(record.id))
  .map(({ id, name }) => ({
    id, name, code: id.toUpperCase(), integrationStatus: normalizeSchoolIntegrationStatus({ enabled: false }),
  }));

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(message)), timeoutMs);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timeoutId) clearTimeout(timeoutId);
  });
}

function normalizeSchoolFromFirestore(id: string, value: Record<string, unknown>): BrowsableSchool {
  const name =
    (typeof value.name === 'string' && value.name.trim()) ||
    (typeof value.schoolName === 'string' && value.schoolName.trim()) ||
    (typeof value.shortName === 'string' && value.shortName.trim()) ||
    id;

  const shortName =
    (typeof value.shortName === 'string' && value.shortName.trim()) ||
    (typeof value.code === 'string' && value.code.trim()) ||
    undefined;

  const rawDomains = [value.domain, value.emailDomain].filter(
    (item): item is string => typeof item === 'string' && item.trim().length > 0,
  );

  return {
    id,
    code: normalizeSchoolCode(
      (typeof value.code === 'string' && value.code.trim()) || shortName || id,
    ),
    name,
    shortName,
    themeColor:
      (typeof value.themeColor === 'string' && value.themeColor.trim()) ||
      (typeof value.primaryColor === 'string' && value.primaryColor.trim()) ||
      undefined,
    domains: rawDomains.length > 0 ? rawDomains : undefined,
    publicBrowsing: value.publicBrowsing === true,
    integrationStatus: getSchoolIntegrationStatus(
      id,
      (value.integrationStatus as Partial<NonNullable<School['integrationStatus']>>) ?? undefined,
    ),
  };
}

/**
 * Public browsing and school-account integration are separate capabilities.
 * A university can appear as a public destination even when SSO is closed.
 * Unlisted remote tenants require explicit publicBrowsing or an enabled
 * integration, and demonstration schools continue to follow release policy.
 */
function isBrowsable(school: BrowsableSchool): boolean {
  if (isPlaceholderAnnouncementSchool({ schoolId: school.id })) {
    return isSchoolVisibleInDirectory(school.id, school.integrationStatus);
  }
  return (
    Boolean(getPublicSchoolInfo(school.id)) ||
    school.publicBrowsing === true ||
    isSchoolVisibleInDirectory(school.id, school.integrationStatus)
  );
}

export function mergeSchoolLists(primary: BrowsableSchool[], secondary: School[]): School[] {
  const merged = new Map<string, School>();

  for (const school of secondary) {
    if (isBrowsable(school)) merged.set(school.id, school);
  }
  for (const school of primary) {
    if (!isBrowsable(school)) continue;
    // The picker uses the remote tenant's ID. Keep its verified public identity
    // separate from the integration status reported for that exact tenant.
    const bundled = merged.get(school.id) ??
      (school.id === 'nchu' ? merged.get('tw-nchu') : undefined);
    merged.set(school.id, bundled
      ? { ...bundled, id: school.id, integrationStatus: school.integrationStatus }
      : school);
  }
  if (merged.has('nchu')) merged.delete('tw-nchu');

  return [...merged.values()].sort((left, right) =>
    left.name.localeCompare(right.name, 'zh-Hant'),
  );
}

export async function fetchSchoolDirectory(): Promise<School[]> {
  const bundled = [
    ...mockSchools.map((school) => ({
      ...school, integrationStatus: getSchoolIntegrationStatus(school.id, school.integrationStatus),
    })),
    ...publicOnlySchools,
  ];
  try {
    const db = getDb();
    const snapshot = await withTimeout(
      getDocs(query(collection(db, 'schools'), limit(200))),
      DIRECTORY_TIMEOUT_MS,
      'School directory lookup timed out',
    );

    const remoteSchools = snapshot.docs.map((docSnap) =>
      normalizeSchoolFromFirestore(docSnap.id, docSnap.data() as Record<string, unknown>),
    );

    return mergeSchoolLists(remoteSchools, bundled);
  } catch (error) {
    console.log('[schoolDirectory] Using bundled public directory:', error);
    return mergeSchoolLists([], bundled);
  }
}
