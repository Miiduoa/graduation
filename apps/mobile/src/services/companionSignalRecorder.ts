/**
 * Campus Companion — Signal Recorder
 *
 * 給各畫面呼叫的單一入口：recordCompanionEvent(kind, payload)
 *  - 本地佇列（AsyncStorage）→ 離線可寫
 *  - 連線時批次送 Firestore：users/{uid}/companionEvents/{eventId}
 *  - 後端 cron 每晚 aggregate → companionSignals/{date} + achievements
 *
 * 不阻擋 UI：所有 record 都是 fire-and-forget。
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { getFirestore, collection, doc, setDoc, serverTimestamp } from 'firebase/firestore';
import type { CompanionEventKind } from '@campus/shared';

import { getFirebaseApp } from '../firebase';

const QUEUE_KEY = 'companion_event_queue_v1';
const MAX_QUEUE_BYTES = 60_000; // 約 100-200 筆，保護 AsyncStorage

interface QueuedEvent {
  kind: CompanionEventKind;
  at: string;
  eventId: string;
  payload?: Record<string, unknown>;
  uid?: string;
}

let inMemoryQueue: QueuedEvent[] = [];
let flushing = false;

function genEventId(kind: CompanionEventKind): string {
  return `${Date.now().toString(36)}_${kind}_${Math.random().toString(36).slice(2, 8)}`;
}

async function loadQueue(): Promise<QueuedEvent[]> {
  try {
    const raw = await AsyncStorage.getItem(QUEUE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function saveQueue(q: QueuedEvent[]): Promise<void> {
  try {
    // 控制體積
    let serialized = JSON.stringify(q);
    while (serialized.length > MAX_QUEUE_BYTES && q.length > 0) {
      q.shift();
      serialized = JSON.stringify(q);
    }
    await AsyncStorage.setItem(QUEUE_KEY, serialized);
  } catch {
    /* swallow */
  }
}

/**
 * 對外主入口：紀錄一個 companion event。
 * 永遠不會丟例外，呼叫端可以「呼了就走」。
 */
export async function recordCompanionEvent(
  kind: CompanionEventKind,
  options: {
    uid?: string | null;
    payload?: Record<string, unknown>;
    /** 若這次特別重要、不想等 cron，可立即 flush */
    immediate?: boolean;
  } = {},
): Promise<void> {
  const evt: QueuedEvent = {
    kind,
    at: new Date().toISOString(),
    eventId: genEventId(kind),
    payload: options.payload,
    uid: options.uid ?? undefined,
  };
  inMemoryQueue.push(evt);
  try {
    const persisted = await loadQueue();
    persisted.push(evt);
    await saveQueue(persisted);
  } catch {
    /* swallow */
  }

  if (options.immediate) {
    void flushCompanionEvents();
  }
}

/**
 * 嘗試把佇列裡的 events flush 到 Firestore；網路失敗會保留在佇列。
 */
export async function flushCompanionEvents(): Promise<{ flushed: number; remaining: number }> {
  if (flushing) return { flushed: 0, remaining: inMemoryQueue.length };
  flushing = true;
  try {
    const persisted = await loadQueue();
    if (persisted.length === 0) return { flushed: 0, remaining: 0 };

    const app = getFirebaseApp();
    const db = getFirestore(app);
    let flushed = 0;
    const remaining: QueuedEvent[] = [];
    for (const evt of persisted) {
      const uid = evt.uid;
      if (!uid) {
        // 沒有 uid 的事件先保留在佇列，登入後再 flush
        remaining.push(evt);
        continue;
      }
      try {
        const ref = doc(collection(db, 'users', uid, 'companionEvents'), evt.eventId);
        await setDoc(
          ref,
          {
            kind: evt.kind,
            at: evt.at,
            payload: evt.payload ?? {},
            createdAt: serverTimestamp(),
          },
          { merge: true },
        );
        flushed += 1;
      } catch (e) {
        remaining.push(evt);
      }
    }
    inMemoryQueue = remaining;
    await saveQueue(remaining);
    return { flushed, remaining: remaining.length };
  } finally {
    flushing = false;
  }
}

/**
 * 給 App 啟動時呼叫的 prime：把 AsyncStorage 載入到 in-memory。
 */
export async function primeCompanionRecorder(): Promise<void> {
  try {
    inMemoryQueue = await loadQueue();
  } catch {
    inMemoryQueue = [];
  }
}

/**
 * 取得目前佇列長度（debug）
 */
export function getCompanionQueueSize(): number {
  return inMemoryQueue.length;
}
