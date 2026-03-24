import { buildUserSchoolCollectionPath } from '@campus/shared/src';
import {
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  type Unsubscribe,
} from 'firebase/firestore';

import { collectionFromSegments, docFromSegments } from '../../data/firestorePath';
import { getDb } from '../../firebase';
import { loadPersistedValue, savePersistedValue } from '../../services/persistedStorage';
import { getScopedStorageKey } from '../../services/scopedStorage';

const LEGACY_STREAK_KEY = 'campus.streak.v1';
const WIDGET_LAYOUT_KEY = 'home_widget_layout';
const DAILY_BRIEF_DISMISSED_PREFIX = 'brief_dismissed_';

export type StreakData = {
  currentStreak: number;
  longestStreak: number;
  lastLoginDate: string;
  totalDays: number;
};

export type StreakUpdateResult = {
  streak: StreakData;
  didChange: boolean;
};

export type AchievementProgress = {
  progress: number;
  unlocked: boolean;
  unlockedAt?: Date;
};

export type LeaderboardSnapshotRow = {
  userId: string;
  userName: string;
  points: number;
};

const EMPTY_STREAK: StreakData = {
  currentStreak: 0,
  longestStreak: 0,
  lastLoginDate: '',
  totalDays: 0,
};

function getIsoDate(offsetDays = 0): string {
  return new Date(Date.now() + offsetDays * 86400000).toISOString().split('T')[0] ?? '';
}

function toOptionalDate(value: unknown): Date | undefined {
  if (value instanceof Date) return value;
  if (
    value &&
    typeof value === 'object' &&
    'toDate' in value &&
    typeof (value as { toDate?: () => Date }).toDate === 'function'
  ) {
    return (value as { toDate: () => Date }).toDate();
  }
  return undefined;
}

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function mapAchievementProgress(
  docs: Array<{ id: string; data: () => Record<string, unknown> }>
): Record<string, AchievementProgress> {
  const progressMap: Record<string, AchievementProgress> = {};

  docs.forEach((docSnap) => {
    const raw = docSnap.data();
    progressMap[docSnap.id] = {
      progress: typeof raw.progress === 'number' ? raw.progress : 0,
      unlocked: raw.unlocked === true,
      unlockedAt: toOptionalDate(raw.unlockedAt),
    };
  });

  return progressMap;
}

function buildDailyBriefDismissedKey(date: string): string {
  return `${DAILY_BRIEF_DISMISSED_PREFIX}${date}`;
}

export function getStreakStorageKey(userId: string | null, schoolId: string | null): string {
  return getScopedStorageKey('streak', { uid: userId, schoolId });
}

export async function refreshUserStreak(storageKey: string): Promise<StreakUpdateResult> {
  const existing = await loadPersistedValue<StreakData>({
    storageKey,
    legacyKeys: [LEGACY_STREAK_KEY],
    fallback: EMPTY_STREAK,
  });
  const today = getIsoDate();

  if (existing.lastLoginDate === today) {
    return { streak: existing, didChange: false };
  }

  const yesterday = getIsoDate(-1);
  const nextStreak = existing.lastLoginDate === yesterday ? existing.currentStreak + 1 : 1;
  const updated: StreakData = {
    currentStreak: nextStreak,
    longestStreak: Math.max(existing.longestStreak, nextStreak),
    lastLoginDate: today,
    totalDays: existing.totalDays + 1,
  };

  await savePersistedValue(storageKey, updated);
  return { streak: updated, didChange: true };
}

export async function updateUserStreak(storageKey: string): Promise<StreakData> {
  const { streak } = await refreshUserStreak(storageKey);
  return streak;
}

export async function loadWidgetLayout<T extends string>(fallback: T[]): Promise<T[]> {
  const layout = await loadPersistedValue<T[]>({
    storageKey: WIDGET_LAYOUT_KEY,
    fallback,
    deserialize: (raw) => JSON.parse(raw) as T[],
  });

  return Array.isArray(layout) ? layout : fallback;
}

export async function isDailyBriefDismissed(date: string): Promise<boolean> {
  return loadPersistedValue<boolean>({
    storageKey: buildDailyBriefDismissedKey(date),
    fallback: false,
    deserialize: (raw) => raw === '1',
  });
}

export async function dismissDailyBrief(date: string): Promise<void> {
  await savePersistedValue(buildDailyBriefDismissedKey(date), '1', (value) => value);
}

export async function loadDailyBriefContent(params: {
  uid: string;
  schoolId: string;
  date: string;
}): Promise<string | null> {
  const db = getDb();
  const canonicalDoc = await getDoc(
    docFromSegments(db, buildUserSchoolCollectionPath(params.uid, params.schoolId, 'dailyBriefs', params.date))
  ).catch(() => null);
  const canonicalContent = readString(canonicalDoc?.data()?.content);
  if (canonicalContent) {
    return canonicalContent;
  }

  const legacyDoc = await getDoc(docFromSegments(db, ['users', params.uid, 'dailyBriefs', params.date])).catch(
    () => null
  );
  return readString(legacyDoc?.data()?.content);
}

export async function loadLeaderboardSnapshot(
  schoolId: string,
  queryLimit = 10
): Promise<LeaderboardSnapshotRow[]> {
  const db = getDb();
  const snapshot = await getDocs(
    query(collectionFromSegments(db, ['schools', schoolId, 'leaderboard']), orderBy('points', 'desc'), limit(queryLimit))
  );

  return snapshot.docs.map((docSnap) => {
    const raw = docSnap.data();
    return {
      userId: docSnap.id,
      userName: readString(raw.displayName) ?? '同學',
      points: typeof raw.points === 'number' ? raw.points : 0,
    };
  });
}

export function subscribeLeaderboard(params: {
  schoolId: string;
  queryLimit?: number;
  onChange: (rows: LeaderboardSnapshotRow[]) => void;
}): Unsubscribe {
  const db = getDb();

  return onSnapshot(
    query(
      collectionFromSegments(db, ['schools', params.schoolId, 'leaderboard']),
      orderBy('points', 'desc'),
      limit(params.queryLimit ?? 10)
    ),
    (snapshot) => {
      params.onChange(
        snapshot.docs.map((docSnap) => {
          const raw = docSnap.data();
          return {
            userId: docSnap.id,
            userName: readString(raw.displayName) ?? '同學',
            points: typeof raw.points === 'number' ? raw.points : 0,
          };
        })
      );
    }
  );
}

export function subscribeAchievementProgress(params: {
  uid: string;
  schoolId: string;
  onChange: (progressMap: Record<string, AchievementProgress>) => void;
}): Unsubscribe {
  const db = getDb();
  const achievementsRef = collectionFromSegments(
    db,
    buildUserSchoolCollectionPath(params.uid, params.schoolId, 'achievements')
  );

  return onSnapshot(achievementsRef, async (snapshot) => {
    if (!snapshot.empty) {
      params.onChange(
        mapAchievementProgress(snapshot.docs.map((docSnap) => ({ id: docSnap.id, data: () => toRecord(docSnap.data()) })))
      );
      return;
    }

    const legacySnapshot = await getDocs(collectionFromSegments(db, ['users', params.uid, 'achievements'])).catch(
      () => null
    );
    params.onChange(
      legacySnapshot
        ? mapAchievementProgress(
            legacySnapshot.docs.map((docSnap) => ({ id: docSnap.id, data: () => toRecord(docSnap.data()) }))
          )
        : {}
    );
  });
}

export async function syncAchievementProgress(params: {
  uid: string;
  schoolId: string;
  achievementId: string;
  progress: number;
  requirement: number;
}): Promise<void> {
  const db = getDb();
  const achievementRef = docFromSegments(
    db,
    buildUserSchoolCollectionPath(params.uid, params.schoolId, 'achievements', params.achievementId)
  );
  const snapshot = await getDoc(achievementRef);
  const unlocked = params.progress >= params.requirement;
  const existing = snapshot.exists() ? snapshot.data() : null;

  if (!existing || existing.progress !== params.progress) {
    await setDoc(
      achievementRef,
      {
        progress: params.progress,
        unlocked,
        schoolId: params.schoolId,
        updatedAt: serverTimestamp(),
        ...(unlocked && !existing?.unlockedAt ? { unlockedAt: serverTimestamp() } : {}),
      },
      { merge: true }
    );
  }
}
