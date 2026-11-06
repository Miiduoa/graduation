import { makeScopedStoragePrefix } from './tenant';

export const FEED_FILTERS = ['all', 'following', 'subscribed', 'media', 'saved'] as const;
export const FEED_ORDERS = ['recommended', 'latest'] as const;

export function feedChoiceKey(
  uid: string | null | undefined,
  schoolId: string | null | undefined,
  field: 'filter' | 'order',
): string | null {
  if (!uid || !schoolId) return null;
  return makeScopedStoragePrefix('feed-view-v1') + JSON.stringify([uid, schoolId, field]);
}

export function readFeedChoice<T extends string>(
  choices: readonly [T, ...T[]],
  raw: string | null,
): T {
  return choices.find((choice) => choice === raw) ?? choices[0];
}
