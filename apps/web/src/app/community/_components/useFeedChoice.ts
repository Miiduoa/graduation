import { useState } from 'react';
import { readFeedChoice } from '@campus/shared/src/communityFeedPreferences';

// The signed-in feed mounts after client auth resolves and remounts on an account or school change.
export function useFeedChoice<T extends string>(key: string | null, choices: readonly [T, ...T[]]) {
  const [value, setValue] = useState<T>(() => {
    try {
      return readFeedChoice(choices, key ? window.localStorage.getItem(key) : null);
    } catch {
      return choices[0];
    }
  });

  function select(next: T) {
    setValue(next);
    if (!key) return;
    try {
      window.localStorage.setItem(key, next);
    } catch {
      // Keep the user's choice in the open feed.
    }
  }

  return [value, select] as const;
}
