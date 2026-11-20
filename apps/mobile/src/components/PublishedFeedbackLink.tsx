import React, { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Text, Pressable } from 'react-native';
import { theme } from '../ui/theme';

export function PublishedFeedbackLink({
  owner,
  record,
  version,
  label,
  onOpen,
}: {
  owner: string | null;
  record: string;
  version: string | null;
  label: string;
  onOpen(): void;
}) {
  const key = owner ? `published-feedback:${JSON.stringify([owner, record])}` : null;
  const [seen, setSeen] = useState<{ key: string; version: string | null } | null>(null);
  useEffect(() => {
    let active = true;
    if (key)
      void AsyncStorage.getItem(key)
        .then((value) => {
          if (active) setSeen({ key, version: value });
        })
        .catch(() => {});
    return () => {
      active = false;
    };
  }, [key]);
  const stamp = version;
  const unread = key && seen?.key === key && (!stamp || seen.version !== stamp);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={() => {
        if (key && stamp)
          void AsyncStorage.setItem(key, stamp)
            .then(() => setSeen({ key, version: stamp }))
            .catch(() => {});
        onOpen();
      }}
    >
      <Text style={{ color: theme.colors.text }}>
        {unread ? '未讀 · ' : ''}
        {label}
      </Text>
    </Pressable>
  );
}
