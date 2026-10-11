import React, { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { subscribeAssistantReply } from '../services/groupAssistantReply';
import { theme } from '../ui/theme';
import { ASSISTANT_AUTHOR_NAME } from './groupAssistant';

/** 等太久就不再顯示「助理回覆中」，也不顯示錯誤。 */
const WAIT_MS = 3 * 60 * 1000;

function createdAtMs(value: any): number {
  if (typeof value?.toMillis === 'function') return value.toMillis();
  // 剛送出、伺服器時間還沒回來
  return value == null ? Date.now() : 0;
}

/**
 * 提問底下的助理回覆：伺服器寫好之前顯示「助理回覆中」，寫好就即時換成回覆內容。
 * 沒有回覆（關掉、失敗或等太久）就什麼都不顯示。
 */
export function AssistantReplyPending(props: {
  groupId: string;
  postId: string;
  createdAt?: any;
  status?: string;
  onArrived?: () => void;
}) {
  const { groupId, postId, createdAt, status, onArrived } = props;
  const [reply, setReply] = useState<string | null>(null);
  const [gone, setGone] = useState(false);
  const started = createdAtMs(createdAt);
  const waiting = status !== 'unavailable' && status !== 'done' && Date.now() - started < WAIT_MS;

  useEffect(() => {
    if (!waiting && status !== 'done') return undefined;
    let unsub: (() => void) | undefined;
    try {
      unsub = subscribeAssistantReply(
        groupId,
        postId,
        (body) => {
          setReply(body);
          onArrived?.();
        },
        () => setGone(true),
      );
    } catch {
      setGone(true);
    }
    const timer = waiting ? setTimeout(() => setGone(true), Math.max(0, WAIT_MS - (Date.now() - started))) : undefined;
    return () => {
      unsub?.();
      if (timer) clearTimeout(timer);
    };
  }, [groupId, postId, waiting, status, started, onArrived]);

  if (reply) {
    return (
      <View
        style={{
          padding: 10,
          borderRadius: theme.radius.md,
          backgroundColor: theme.colors.accentSoft,
          borderWidth: 1,
          borderColor: theme.colors.accent,
        }}
      >
        <Text style={{ color: theme.colors.accent, fontSize: 11, fontWeight: '700', marginBottom: 4 }}>
          {ASSISTANT_AUTHOR_NAME}
        </Text>
        <Text style={{ color: theme.colors.text, fontSize: 13, lineHeight: 18 }} numberOfLines={2}>
          {reply}
        </Text>
      </View>
    );
  }
  if (gone || !waiting) return null;
  return (
    <Text style={{ color: theme.colors.muted, fontSize: 12 }} accessibilityLiveRegion="polite">
      助理回覆中
    </Text>
  );
}
