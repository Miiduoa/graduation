import { collection, getDocs, limit, query } from 'firebase/firestore';

import { type School } from '@campus/shared/src';
import { mockSchools, normalizeSchoolCode } from '@campus/shared/src/schools';
import { isPlaceholderAnnouncementSchool } from '@campus/shared/src/campusAnnouncements';

import { getDb } from '../firebase';
import { getSchoolIntegrationStatus, isSchoolVisibleInDirectory } from './release';

const DIRECTORY_TIMEOUT_MS = 5000;

type BrowsableSchool = School & { publicBrowsing?: boolean };
const bundledOfficialSchoolIds = new Set(
  mockSchools
    .filter(
      (school) =>
        !isPlaceholderAnnouncementSchool({ schoolId: school.id }) &&
        !school.name.includes('（示範）'),
    )
    .map((school) => school.id),
);

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
    bundledOfficialSchoolIds.has(school.id) ||
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
    const bundled = merged.get(school.id);
    if (bundled) {
      // The built-in official school name/code must not be replaced by an
      // unreviewed remote display name. The live integration status still wins.
      merged.set(school.id, { ...school, ...bundled, integrationStatus: school.integrationStatus });
    } else {
      merged.set(school.id, school);
    }
  }

  return [...merged.values()].sort((left, right) =>
    left.name.localeCompare(right.name, 'zh-Hant'),
  );
}

export async function fetchSchoolDirectory(): Promise<School[]> {
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

    return mergeSchoolLists(
      remoteSchools,
      mockSchools.map((school) => ({
        ...school,
        integrationStatus: getSchoolIntegrationStatus(school.id, school.integrationStatus),
      })),
    );
  } catch (error) {
    console.log('[schoolDirectory] Falling back to mock schools:', error);
    return mergeSchoolLists([], mockSchools.map((school) => ({
      ...school,
      integrationStatus: getSchoolIntegrationStatus(school.id, school.integrationStatus),
    })));
  }
}
