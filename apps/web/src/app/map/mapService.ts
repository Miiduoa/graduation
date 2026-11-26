import type { CampusCoordinate } from '@campus/shared/src/campusGeo';
import { parseCampusMapRecord } from '@campus/shared/src/campusMapRecords';
export { distanceMeters, formatDistance } from '@campus/shared/src/campusGeo';

import {
  collection,
  doc,
  getDocsFromServer,
  query,
  runTransaction,
  serverTimestamp,
  where,
} from 'firebase/firestore';
import { getAuth, getDb, isFirebaseConfigured } from '@/lib/firebase';

export type MapCoordinate = CampusCoordinate;

export type MapLocation = {
  id: string;
  name: string;
  category: string;
  description: string;
  lat: number;
  lng: number;
  building?: string;
  floor?: string;
  facilities?: string[];
  transitStopIds?: unknown;
};

function validId(value: string) {
  return value.length > 0 && !value.includes('/');
}

/** 地點來源最多等這麼久；連線卡住時不能讓畫面永遠停在「正在載入」。 */
export const MAP_SOURCE_TIMEOUT_MS = 8000;

export class MapSourceTimeoutError extends Error {
  constructor() {
    super('Map source timed out');
    this.name = 'MapSourceTimeoutError';
  }
}

export function withTimeout<T>(work: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new MapSourceTimeoutError()), timeoutMs);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export async function loadMapLocations(
  schoolId: string,
  { timeoutMs = MAP_SOURCE_TIMEOUT_MS }: { timeoutMs?: number } = {},
): Promise<MapLocation[]> {
  if (!isFirebaseConfigured() || !validId(schoolId)) throw new Error('Map source unavailable');
  return withTimeout(readMapLocations(schoolId), timeoutMs);
}

async function readMapLocations(schoolId: string): Promise<MapLocation[]> {
  const db = getDb();
  let snapshot = await getDocsFromServer(collection(db, 'schools', schoolId, 'pois'));
  // Only use the migration source after the canonical source confirms it is empty.
  if (snapshot.empty) {
    snapshot = await getDocsFromServer(
      query(collection(db, 'pois'), where('schoolId', '==', schoolId)),
    );
  }
  return snapshot.docs
    .flatMap((entry) => {
      const place = parseCampusMapRecord(entry.id, entry.data(), schoolId);
      if (!place) return [];
      return [{
        id: place.id,
        name: place.name,
        category: place.category,
        description: place.description,
        lat: place.lat,
        lng: place.lng,
        ...(place.building ? { building: place.building } : {}),
        ...(place.floor ? { floor: place.floor } : {}),
        ...(place.facilities.length ? { facilities: place.facilities } : {}),
        ...('transitStopIds' in place ? { transitStopIds: place.transitStopIds } : {}),
      }];
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant'));
}

function assertCurrent(uid: string, current: () => boolean) {
  if (
    !isFirebaseConfigured() ||
    !validId(uid) ||
    !current() ||
    getAuth()?.currentUser?.uid !== uid
  ) {
    throw new Error('Account changed');
  }
}

export async function loadMapFavorites(uid: string, schoolId: string): Promise<string[]> {
  assertCurrent(uid, () => true);
  if (!validId(schoolId)) throw new Error('Invalid school');
  // A stalled Firestore read must not leave the map's saved-place UI waiting
  // indefinitely. Do not fall back to another school's or user's favorites.
  const snapshot = await withTimeout(getDocsFromServer(
    query(
      collection(getDb(), 'users', uid, 'schools', schoolId, 'favorites'),
      where('type', '==', 'poi'),
    ),
  ), MAP_SOURCE_TIMEOUT_MS);
  assertCurrent(uid, () => true);
  return snapshot.docs.flatMap((entry) => {
    const data = entry.data();
    return typeof data.itemId === 'string' &&
      validId(data.itemId) &&
      entry.id === `poi_${data.itemId}` &&
      data.type === 'poi' &&
      data.schoolId === schoolId
      ? [data.itemId]
      : [];
  });
}

export async function setMapFavorite(
  uid: string,
  schoolId: string,
  location: MapLocation,
  saved: boolean,
  current: () => boolean,
): Promise<void> {
  assertCurrent(uid, current);
  if (!validId(schoolId) || !validId(location.id)) throw new Error('Invalid favorite');
  const db = getDb();
  const reference = doc(db, 'users', uid, 'schools', schoolId, 'favorites', `poi_${location.id}`);
  await runTransaction(db, async (transaction) => {
    assertCurrent(uid, current);
    const existing = await transaction.get(reference);
    assertCurrent(uid, current);
    if (!saved) {
      if (existing.exists()) transaction.delete(reference);
    } else if (!existing.exists()) {
      transaction.set(reference, {
        type: 'poi',
        itemId: location.id,
        itemTitle: location.name,
        schoolId,
        addedAt: serverTimestamp(),
      });
    }
  });
  assertCurrent(uid, current);
}

/** Finite WGS-84 point that is not the (0, 0) missing-fix sentinel. */
export function isUsableMapCoordinate(
  place: MapCoordinate | null | undefined,
): place is MapCoordinate {
  return place != null &&
    Number.isFinite(place.lat) && Math.abs(place.lat) <= 90 &&
    Number.isFinite(place.lng) && Math.abs(place.lng) <= 180 &&
    !(place.lat === 0 && place.lng === 0);
}

export function walkingDirectionsUrl(destination: MapCoordinate, origin?: MapCoordinate): string {
  const parameters = new URLSearchParams({
    api: '1',
    destination: `${destination.lat},${destination.lng}`,
    travelmode: 'walking',
  });
  if (isUsableMapCoordinate(origin)) parameters.set('origin', `${origin.lat},${origin.lng}`);
  return `https://www.google.com/maps/dir/?${parameters.toString()}`;
}

/** Opens Apple Maps walking directions to the existing marker, not a verified building entrance. */
export function appleWalkingDirectionsUrl(destination: MapCoordinate, origin?: MapCoordinate): string {
  // The documented legacy map URL also works on older iOS versions and WebViews.
  // An omitted saddr lets Maps choose the user's actual starting position.
  const parameters = new URLSearchParams({
    daddr: `${destination.lat},${destination.lng}`,
    dirflg: 'w',
  });
  if (isUsableMapCoordinate(origin)) parameters.set('saddr', `${origin.lat},${origin.lng}`);
  return `https://maps.apple.com/?${parameters.toString()}`;
}
