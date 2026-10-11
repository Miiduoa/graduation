import React, { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { subscribeAssistantReply } from '../services/groupAssistantReply';
import { theme } from '../ui/theme';
import { ASSISTANT_AUTHOR_NAME, ASSISTANT_PENDING_COPY, ASSISTANT_UNAVAILABLE_COPY } from './groupAssistant';

/** 等超過一分鐘就改成「助理暫時沒辦法回答」，不會一直轉。 */
export const ASSISTANT_WAIT_MS = 60 * 1000;

function createdAtMs(value: any): number {
  if (typeof value?.toMillis === 'function') return value.toMillis();
  if (value instanceof Date) return value.getTime();
  if (typeof value?.seconds === 'number') return value.seconds * 1000;
  // 剛送出、伺服器時間還沒回來，就從現在開始算
  return Date.now();
}

/**
 * 提問底下的助理回覆：伺服器寫好之前顯示「助理回覆中」，寫好就即時換成回覆內容。
 * 一分鐘內沒回覆（或伺服器記成沒辦法回答）就改成「助理暫時沒辦法回答，可以等其他同學回覆」。
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
  const [started] = useState(() => createdAtMs(createdAt));
  const [timedOut, setTimedOut] = useState(() => Date.now() - started >= ASSISTANT_WAIT_MS);

  useEffect(() => {
    let unsub: (() => void) | undefined;
    try {
      unsub = subscribeAssistantReply(
        groupId,
        postId,
        (body) => {
          setReply(body);
          onArrived?.();
        },
        () => setTimedOut(true),
      );
    } catch {
      setTimedOut(true);
    }
    const left = ASSISTANT_WAIT_MS - (Date.now() - started);
    const timer = left > 0 ? setTimeout(() => setTimedOut(true), left) : undefined;
    return () => {
      unsub?.();
      if (timer) clearTimeout(timer);
    };
  }, [groupId, postId, started, onArrived]);

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
  const unavailable = timedOut || status === 'unavailable';
  return (
    <Text style={{ color: theme.colors.muted, fontSize: 12 }} accessibilityLiveRegion="polite">
      {unavailable ? ASSISTANT_UNAVAILABLE_COPY : ASSISTANT_PENDING_COPY}
    </Text>
  );
}
