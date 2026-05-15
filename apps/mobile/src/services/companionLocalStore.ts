/**
 * Companion Local Store — 本地 signal + lifetime 快取
 *
 * 設計：
 *  - 每次 recordCompanionEvent 同時更新本地累積（不必等 cron）
 *  - CompanionScreen / Collection 優先讀本地，看起來就有資料；後端可用時再覆蓋
 *  - 解決使用者打開 APP 看到「無法載入」的窘境
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  aggregateCompanionEvents,
  computeSpriteState,
  computeGarden,
  evaluateAchievements,
  type DailyActivitySignal,
  type CompanionEvent,
  type CourseSignals,
  type SpriteState,
  type GardenSummary,
  type Unlockable,
  type SpriteProfile,
} from '@campus/shared';

const KEY_EVENTS = 'companion_local_events_v1';
const KEY_LIFETIME = 'companion_local_lifetime_v1';
const KEY_UNLOCKS = 'companion_local_unlocks_v1';
const KEY_COURSES = 'companion_local_courses_v1';

const MAX_EVENTS = 500;

interface LocalState {
  events: CompanionEvent[];
  lifetime: Record<string, number>;
  unlocks: string[];
  courses: CourseSignals[];
}

async function readJson<T>(key: string, fallback: T): Promise<T> {
  try {
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return (parsed as T) ?? fallback;
  } catch {
    return fallback;
  }
}

async function writeJson(key: string, value: unknown): Promise<void> {
  try {
    await AsyncStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* swallow */
  }
}

export async function appendLocalEvent(evt: CompanionEvent): Promise<void> {
  const events = await readJson<CompanionEvent[]>(KEY_EVENTS, []);
  events.push(evt);
  // 控制大小
  while (events.length > MAX_EVENTS) events.shift();
  await writeJson(KEY_EVENTS, events);

  // 同步更新 lifetime
  const r = aggregateCompanionEvents([evt]);
  const lifetime = await readJson<Record<string, number>>(KEY_LIFETIME, {});
  for (const [k, v] of Object.entries(r.lifetimeCounters)) {
    lifetime[k] = (lifetime[k] ?? 0) + v;
  }
  await writeJson(KEY_LIFETIME, lifetime);

  // 評估新解鎖
  const unlocked = new Set(await readJson<string[]>(KEY_UNLOCKS, []));
  const result = evaluateAchievements({ progress: lifetime, alreadyUnlocked: unlocked });
  if (result.newlyUnlocked.length > 0) {
    for (const u of result.newlyUnlocked) unlocked.add(u.id);
    await writeJson(KEY_UNLOCKS, Array.from(unlocked));
  }
}

export async function getLocalState(): Promise<LocalState> {
  const [events, lifetime, unlocks, courses] = await Promise.all([
    readJson<CompanionEvent[]>(KEY_EVENTS, []),
    readJson<Record<string, number>>(KEY_LIFETIME, {}),
    readJson<string[]>(KEY_UNLOCKS, []),
    readJson<CourseSignals[]>(KEY_COURSES, []),
  ]);
  return { events, lifetime, unlocks, courses };
}

export async function setLocalCourses(courses: CourseSignals[]): Promise<void> {
  await writeJson(KEY_COURSES, courses);
}

export async function clearLocalCompanion(): Promise<void> {
  await Promise.all([
    AsyncStorage.removeItem(KEY_EVENTS),
    AsyncStorage.removeItem(KEY_LIFETIME),
    AsyncStorage.removeItem(KEY_UNLOCKS),
    AsyncStorage.removeItem(KEY_COURSES),
  ]);
}

/**
 * 從本地 events 算出當下 sprite + garden + unlocks。
 * 任何時候打開 APP 都會有畫面，不再「載入失敗」。
 */
export async function computeLocalCompanion(
  profile: Partial<SpriteProfile> = {},
): Promise<{
  sprite: SpriteState;
  garden: GardenSummary;
  unlocks: Unlockable[];
}> {
  const { events, courses, unlocks } = await getLocalState();
  const aggregated = aggregateCompanionEvents(events);
  const fullProfile: SpriteProfile = {
    createdAt: profile.createdAt ?? new Date().toISOString(),
    studyYear: profile.studyYear ?? 1,
    currentMonth: profile.currentMonth ?? new Date().getMonth() + 1,
    schoolId: profile.schoolId,
  };
  const sprite = computeSpriteState({
    signals: aggregated.days,
    profile: fullProfile,
  });
  const garden = computeGarden(courses);

  // 把 unlock id 轉成完整 Unlockable
  const { ACHIEVEMENTS } = await import('@campus/shared');
  const fullUnlocks: Unlockable[] = unlocks
    .map((id) => ACHIEVEMENTS.find((a) => a.id === id)?.unlock)
    .filter((u): u is Unlockable => !!u);

  return { sprite, garden, unlocks: fullUnlocks };
}
