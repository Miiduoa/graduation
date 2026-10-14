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
};

function validId(value: string) {
  return value.length > 0 && !value.includes('/');
}

export async function loadMapLocations(schoolId: string): Promise<MapLocation[]> {
  if (!isFirebaseConfigured() || !validId(schoolId)) throw new Error('Map source unavailable');
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
  const snapshot = await getDocsFromServer(
    query(
      collection(getDb(), 'users', uid, 'schools', schoolId, 'favorites'),
      where('type', '==', 'poi'),
    ),
  );
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

export function walkingDirectionsUrl(destination: MapCoordinate, origin?: MapCoordinate): string {
  const parameters = new URLSearchParams({
    api: '1',
    destination: `${destination.lat},${destination.lng}`,
    travelmode: 'walking',
  });
  if (origin) parameters.set('origin', `${origin.lat},${origin.lng}`);
  return `https://www.google.com/maps/dir/?${parameters.toString()}`;
}
