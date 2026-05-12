/**
 * 過敏原檢查 — 下單前最後一道防線
 *
 * 流程：
 *   1. 從本機讀使用者飲食偏好（離線可用）
 *   2. 比對購物車內每個品項的 allergens / vegetarian / vegan / halal
 *   3. 命中嚴格禁忌 → severity='block'，UI 需明確 override
 *   4. 命中不喜歡 → severity='warn'，UI 顯示提醒但不擋
 *
 * 這層不會去動 Firestore，純本機 + cart input，方便 AI 助理代下單前也能查。
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { getRandomBytesAsync } from 'expo-crypto';
import type {
  AllergenCheckResult,
  AllergenMatch,
  DietaryProfile,
} from './types';
import type { MenuItem } from '../cafeteriaData';

const DIETARY_KEY = '@ordering_dietary_profile';

function emptyProfile(uid: string): DietaryProfile {
  return {
    uid,
    allergens: [],
    dislikes: [],
    vegetarian: false,
    vegan: false,
    halal: false,
    updatedAt: new Date().toISOString(),
  };
}

export async function getDietaryProfile(uid: string): Promise<DietaryProfile> {
  if (!uid) return emptyProfile('');
  try {
    const raw = await AsyncStorage.getItem(`${DIETARY_KEY}_${uid}`);
    if (!raw) return emptyProfile(uid);
    const parsed = JSON.parse(raw) as Partial<DietaryProfile>;
    return {
      ...emptyProfile(uid),
      ...parsed,
      uid,
    };
  } catch {
    return emptyProfile(uid);
  }
}

export async function updateDietaryProfile(
  uid: string,
  patch: Partial<Omit<DietaryProfile, 'uid' | 'updatedAt'>>,
): Promise<DietaryProfile> {
  const current = await getDietaryProfile(uid);
  const next: DietaryProfile = {
    ...current,
    ...patch,
    uid,
    updatedAt: new Date().toISOString(),
  };
  await AsyncStorage.setItem(`${DIETARY_KEY}_${uid}`, JSON.stringify(next));
  return next;
}

/**
 * 過敏原比對核心邏輯
 *
 * @param items 購物車中的菜單品項（已展開）
 * @param profile 使用者飲食偏好
 * @returns 比對結果與是否需要 override
 */
export async function checkAllergens(
  items: Array<Pick<MenuItem, 'id' | 'name' | 'allergens'>>,
  profile: DietaryProfile,
): Promise<AllergenCheckResult> {
  const allergenSet = new Set(profile.allergens.map((a) => a.toLowerCase()));
  const dislikeSet = new Set(profile.dislikes.map((d) => d.toLowerCase()));

  const blockMatches: AllergenMatch[] = [];
  const warnMatches: AllergenMatch[] = [];

  for (const item of items) {
    const itemAllergens = (item.allergens ?? []).map((a) => a.toLowerCase());
    const hardHits = itemAllergens.filter((a) => allergenSet.has(a));
    const softHits = itemAllergens.filter((a) => dislikeSet.has(a));

    if (hardHits.length > 0) {
      blockMatches.push({
        menuItemId: item.id,
        menuItemName: item.name,
        hits: hardHits,
      });
    } else if (softHits.length > 0) {
      warnMatches.push({
        menuItemId: item.id,
        menuItemName: item.name,
        hits: softHits,
      });
    }
  }

  if (blockMatches.length > 0) {
    const summary = blockMatches
      .map((m) => `「${m.menuItemName}」含有 ${m.hits.join('、')}`)
      .join('；');
    return {
      severity: 'block',
      matches: blockMatches,
      message: `⚠️ 您設定的嚴格過敏原命中：${summary}。如仍要下單，請明確同意風險。`,
      overrideToken: await generateOverrideToken(),
    };
  }

  if (warnMatches.length > 0) {
    const summary = warnMatches
      .map((m) => `「${m.menuItemName}」含有 ${m.hits.join('、')}`)
      .join('；');
    return {
      severity: 'warn',
      matches: warnMatches,
      message: `提醒：${summary}（屬於您標記的不喜歡食材）`,
    };
  }

  return {
    severity: 'none',
    matches: [],
    message: '無過敏原命中',
  };
}

/** 驗證 override token 是否在合理時間內、且為合法格式 */
export function isValidOverrideToken(
  token: string | undefined,
  maxAgeSec = 300,
): boolean {
  if (!token || typeof token !== 'string') return false;
  const parts = token.split('.');
  if (parts.length !== 2) return false;
  const [tsStr] = parts;
  const ts = parseInt(tsStr, 10);
  if (!Number.isFinite(ts)) return false;
  const ageMs = Date.now() - ts;
  return ageMs >= 0 && ageMs <= maxAgeSec * 1000;
}

async function generateOverrideToken(): Promise<string> {
  const bytes = await getRandomBytesAsync(8);
  const hex = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return `${Date.now()}.${hex}`;
}
