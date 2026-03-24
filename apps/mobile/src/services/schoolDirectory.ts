import { collection, getDocs, limit, query } from 'firebase/firestore';

import { type School } from '@campus/shared/src';
import { mockSchools, normalizeSchoolCode } from '@campus/shared/src/schools';

import { getDb } from '../firebase';
import { getSchoolIntegrationStatus, isSchoolVisibleInDirectory } from './release';

const DIRECTORY_TIMEOUT_MS = 5000;

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(message)), timeoutMs);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timeoutId) clearTimeout(timeoutId);
  });
}

function normalizeSchoolFromFirestore(id: string, value: Record<string, unknown>): School {
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
    integrationStatus: getSchoolIntegrationStatus(
      id,
      (value.integrationStatus as Partial<NonNullable<School['integrationStatus']>>) ?? undefined,
    ),
  };
}

function mergeSchoolLists(primary: School[], secondary: School[]): School[] {
  const merged = new Map<string, School>();

  for (const school of [...primary, ...secondary]) {
    const existing = merged.get(school.id);
    merged.set(school.id, existing ? { ...school, ...existing } : school);
  }

  return [...merged.values()]
    .filter((school) => isSchoolVisibleInDirectory(school.id, school.integrationStatus))
    .sort((left, right) => left.name.localeCompare(right.name, 'zh-Hant'));
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
    return [...mockSchools]
      .map((school) => ({
        ...school,
        integrationStatus: getSchoolIntegrationStatus(school.id, school.integrationStatus),
      }))
      .filter((school) => isSchoolVisibleInDirectory(school.id, school.integrationStatus))
      .sort((left, right) => left.name.localeCompare(right.name, 'zh-Hant'));
  }
}
