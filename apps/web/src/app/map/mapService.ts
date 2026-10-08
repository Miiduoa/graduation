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

export type MapLocation = {
  id: string;
  name: string;
  category: string;
  description: string;
  lat: number;
  lng: number;
};

const categoryNames: Record<string, string> = {
  academic: '教學',
  research: '研究',
  library: '圖書館',
  admin: '行政',
  cafeteria: '餐飲',
  dormitory: '住宿',
  sports: '運動',
  parking: '停車',
  convenience: '生活',
  medical: '健康',
  religious: '宗教',
  gate: '交通',
  other: '其他',
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
      const data = entry.data();
      if (data.schoolId != null && data.schoolId !== schoolId)
        throw new Error('Invalid map school');
      if (
        typeof data.name !== 'string' ||
        !data.name.trim() ||
        typeof data.lat !== 'number' ||
        !Number.isFinite(data.lat) ||
        Math.abs(data.lat) > 90 ||
        typeof data.lng !== 'number' ||
        !Number.isFinite(data.lng) ||
        Math.abs(data.lng) > 180
      )
        return [];
      const category = typeof data.category === 'string' ? data.category.trim() : '';
      return [
        {
          id: entry.id,
          name: data.name.trim(),
          category: categoryNames[category] ?? (category || '其他'),
          description: typeof data.description === 'string' ? data.description : '',
          lat: data.lat,
          lng: data.lng,
        },
      ];
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

export function walkingDirectionsUrl(destination: MapLocation, origin?: MapLocation): string {
  const parameters = new URLSearchParams({
    api: '1',
    destination: `${destination.lat},${destination.lng}`,
    travelmode: 'walking',
  });
  if (origin) parameters.set('origin', `${origin.lat},${origin.lng}`);
  return `https://www.google.com/maps/dir/?${parameters.toString()}`;
}
