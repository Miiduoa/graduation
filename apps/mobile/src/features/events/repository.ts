import { buildSchoolCollectionPath } from '@campus/shared/src';
import { getDoc, getDocs, orderBy, query, serverTimestamp, setDoc } from 'firebase/firestore';

import { collectionFromSegments, docFromSegments } from '../../data/firestorePath';
import { getDb } from '../../firebase';

export type EventRegistration = {
  uid: string;
  email?: string | null;
  displayName?: string | null;
  avatarUrl?: string | null;
  registeredAt?: unknown;
  status: 'registered' | 'cancelled' | 'waitlist';
  checkedIn?: boolean;
  checkedInAt?: unknown;
  waitlistPosition?: number;
};

export type EventReview = {
  id: string;
  uid: string;
  email?: string | null;
  displayName?: string | null;
  rating: number;
  comment: string;
  createdAt?: unknown;
};

export type EventUserProfile = {
  uid: string;
  displayName?: string;
  email?: string;
  avatarUrl?: string;
};

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function readString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

export async function loadEventRegistrations(eventId: string, schoolId: string): Promise<EventRegistration[]> {
  const db = getDb();

  try {
    const canonicalSnapshot = await getDocs(
      query(
        collectionFromSegments(db, buildSchoolCollectionPath(schoolId, 'events', eventId, 'registrations')),
        orderBy('registeredAt', 'asc')
      )
    );

    if (!canonicalSnapshot.empty) {
      return canonicalSnapshot.docs.map((docSnap) => ({
        uid: docSnap.id,
        ...(toRecord(docSnap.data()) as Omit<EventRegistration, 'uid'>),
      }));
    }
  } catch (error) {
    console.warn('[EventRepository] Failed to read canonical registrations:', error);
  }

  const legacySnapshot = await getDocs(
    query(collectionFromSegments(db, ['events', eventId, 'registrations']), orderBy('registeredAt', 'asc'))
  );

  return legacySnapshot.docs.map((docSnap) => ({
    uid: docSnap.id,
    ...(toRecord(docSnap.data()) as Omit<EventRegistration, 'uid'>),
  }));
}

export async function loadEventReviews(eventId: string, schoolId: string): Promise<EventReview[]> {
  const db = getDb();

  try {
    const canonicalSnapshot = await getDocs(
      query(
        collectionFromSegments(db, buildSchoolCollectionPath(schoolId, 'events', eventId, 'reviews')),
        orderBy('createdAt', 'desc')
      )
    );

    if (!canonicalSnapshot.empty) {
      return canonicalSnapshot.docs.map((docSnap) => ({
        id: docSnap.id,
        ...(toRecord(docSnap.data()) as Omit<EventReview, 'id'>),
      }));
    }
  } catch (error) {
    console.warn('[EventRepository] Failed to read canonical reviews:', error);
  }

  const legacySnapshot = await getDocs(
    query(collectionFromSegments(db, ['events', eventId, 'reviews']), orderBy('createdAt', 'desc'))
  );

  return legacySnapshot.docs.map((docSnap) => ({
    id: docSnap.id,
    ...(toRecord(docSnap.data()) as Omit<EventReview, 'id'>),
  }));
}

export async function loadEventUserProfiles(uids: string[]): Promise<EventUserProfile[]> {
  const db = getDb();
  const profiles = await Promise.all(
    uids.map(async (uid) => {
      const userSnapshot = await getDoc(docFromSegments(db, ['users', uid])).catch(() => null);
      if (!userSnapshot?.exists()) return null;

      const raw = toRecord(userSnapshot.data());
      return {
        uid,
        displayName: readString(raw.displayName) ?? undefined,
        email: readString(raw.email) ?? undefined,
        avatarUrl: readString(raw.avatarUrl) ?? undefined,
      };
    })
  );

  return profiles.filter((profile) => profile != null) as EventUserProfile[];
}

export async function submitEventReview(params: {
  eventId: string;
  schoolId: string;
  uid: string;
  email?: string | null;
  displayName?: string | null;
  rating: number;
  comment: string;
}): Promise<void> {
  const db = getDb();
  await setDoc(
    docFromSegments(db, buildSchoolCollectionPath(params.schoolId, 'events', params.eventId, 'reviews', params.uid)),
    {
      uid: params.uid,
      email: params.email ?? null,
      displayName: params.displayName ?? null,
      rating: params.rating,
      comment: params.comment.trim(),
      schoolId: params.schoolId,
      createdAt: serverTimestamp(),
    }
  );
}
