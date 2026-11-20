import { useEffect, useRef, useState } from 'react';
import { loadPersistedValue, savePersistedValue } from '../../services/persistedStorage';
import { readFeedChoice } from '@campus/shared/src/communityFeedPreferences';

// Finish same-key writes in tap order, including when the student immediately reopens the feed.
const writes = new Map<string, Promise<void>>();

export function useFeedChoice<T extends string>(key: string | null, choices: readonly [T, ...T[]]) {
  const [value, setValue] = useState<T>(choices[0]);
  const edited = useRef(false);
  useEffect(() => {
    if (!key) return;
    let active = true;
    void (async () => {
      await writes.get(key);
      const restored = await loadPersistedValue({
        storageKey: key,
        fallback: choices[0],
        deserialize: (raw) => readFeedChoice(choices, raw),
      });
      if (active && !edited.current) setValue(restored);
    })().catch(() => {});
    return () => {
      active = false;
    };
  }, [key, choices]);

  // HomeFeedContent is keyed by account/school; its two choices hydrate independently.
  function select(next: T) {
    edited.current = true;
    setValue(next);
    if (!key) return;
    const write = (writes.get(key) ?? Promise.resolve())
      .then(() => savePersistedValue(key, next, (choice) => choice))
      .catch(() => {});
    writes.set(key, write);
    void write.then(() => {
      if (writes.get(key) === write) writes.delete(key);
    });
  }

  return [value, select] as const;
}
