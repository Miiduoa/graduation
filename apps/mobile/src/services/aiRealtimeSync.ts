/**
 * AI Realtime Sync — Firestore 即時資料管線
 * ═══════════════════════════════════════════════════════════════════════
 * 訂閱使用者最敏感、最會變動的資料源（通知、訂單、行事曆、公告），
 * 用 onSnapshot 推送變動到 AI Brain，讓 AI 不必等 30 秒輪詢。
 *
 * 不會重複訂閱（同 userId/schoolId 已啟動時直接 reuse）；
 * 任何 listener 失敗都會降級為輪詢回退（呼叫 refreshAIAmbientAwareness）。
 */

import {
  collection,
  limit,
  onSnapshot,
  orderBy,
  query,
  where,
  Timestamp,
  type Unsubscribe,
} from 'firebase/firestore';
import { getDb, hasUsableFirebaseConfig } from '../firebase';
import type { DataSource } from '../data/source';
import {
  refreshAIAmbientAwareness,
  type AIAmbientAwarenessReason,
} from './aiAppContext';

export type RealtimeEventKind =
  | 'notification'
  | 'order'
  | 'calendar'
  | 'announcement'
  | 'repair'
  | 'health';

export interface RealtimeEvent {
  kind: RealtimeEventKind;
  itemId: string;
  changeType: 'added' | 'modified' | 'removed';
  data: Record<string, unknown>;
  timestamp: number;
}

type Listener = (event: RealtimeEvent) => void;

const eventListeners = new Set<Listener>();

export function subscribeRealtimeEvents(listener: Listener): () => void {
  eventListeners.add(listener);
  return () => {
    eventListeners.delete(listener);
  };
}

function emit(event: RealtimeEvent): void {
  for (const listener of eventListeners) {
    try {
      listener(event);
    } catch (e) {
      console.warn('[AIRealtimeSync] listener failed:', e);
    }
  }
}

// ─── State ───────────────────────────────────────────────────────────

interface ActiveSubscription {
  userId: string | null;
  schoolId: string | null;
  unsubscribers: Unsubscribe[];
  refreshTimer: ReturnType<typeof setTimeout> | null;
  dataSource: DataSource | null;
}

let current: ActiveSubscription | null = null;

// ─── Public API ───────────────────────────────────────────────────────

export interface StartRealtimeSyncParams {
  userId: string | null;
  schoolId: string | null;
  dataSource: DataSource;
  /** 當 Firestore 不可用時的回退輪詢間隔（毫秒）；預設 60s */
  fallbackPollMs?: number;
}

/**
 * 啟動即時訂閱。若 userId/schoolId 與目前相同，會 no-op；
 * 切換使用者或學校時會自動先取消舊訂閱。
 */
export function startRealtimeSync(params: StartRealtimeSyncParams): () => void {
  if (
    current &&
    current.userId === params.userId &&
    current.schoolId === params.schoolId
  ) {
    return () => stopRealtimeSync();
  }

  stopRealtimeSync();

  const next: ActiveSubscription = {
    userId: params.userId,
    schoolId: params.schoolId,
    unsubscribers: [],
    refreshTimer: null,
    dataSource: params.dataSource,
  };
  current = next;

  if (!params.userId) return () => stopRealtimeSync();

  const triggerRefresh = (reason: AIAmbientAwarenessReason | string) => {
    if (current !== next || !next.dataSource) return;
    if (next.refreshTimer) clearTimeout(next.refreshTimer);
    next.refreshTimer = setTimeout(() => {
      void refreshAIAmbientAwareness({
        dataSource: next.dataSource!,
        userId: next.userId,
        schoolId: next.schoolId,
        reason,
        force: true,
        minIntervalMs: 5_000,
      });
    }, 600);
  };

  if (hasUsableFirebaseConfig()) {
    try {
      const db = getDb();

      // 通知 ──────────────────────────────────────
      const notifQ = query(
        collection(db, 'users', params.userId, 'notifications'),
        orderBy('createdAt', 'desc'),
        limit(25),
      );
      const unsubNotif = onSnapshot(
        notifQ,
        (snap) => {
          snap.docChanges().forEach((change) => {
            const data = change.doc.data() as Record<string, unknown>;
            emit({
              kind: 'notification',
              itemId: change.doc.id,
              changeType: change.type,
              data,
              timestamp: Date.now(),
            });
          });
          if (!snap.metadata.fromCache) triggerRefresh('realtime-notification');
        },
        (error) => {
          console.warn('[AIRealtimeSync] notifications listener failed:', error);
        },
      );
      next.unsubscribers.push(unsubNotif);

      // 訂單 ──────────────────────────────────────
      if (params.schoolId) {
        try {
          const ordersQ = query(
            collection(db, 'schools', params.schoolId, 'orders'),
            where('userId', '==', params.userId),
            orderBy('createdAt', 'desc'),
            limit(15),
          );
          const unsubOrders = onSnapshot(
            ordersQ,
            (snap) => {
              snap.docChanges().forEach((change) => {
                emit({
                  kind: 'order',
                  itemId: change.doc.id,
                  changeType: change.type,
                  data: change.doc.data() as Record<string, unknown>,
                  timestamp: Date.now(),
                });
              });
              if (!snap.metadata.fromCache) triggerRefresh('realtime-order');
            },
            (error) => {
              console.warn('[AIRealtimeSync] orders listener failed:', error);
            },
          );
          next.unsubscribers.push(unsubOrders);
        } catch (e) {
          console.warn('[AIRealtimeSync] orders subscribe failed:', e);
        }
      }

      // 行事曆 ────────────────────────────────────
      try {
        const sinceMs = Date.now() - 24 * 60 * 60 * 1000;
        const calQ = query(
          collection(db, 'users', params.userId, 'calendar'),
          where('startAt', '>=', Timestamp.fromMillis(sinceMs)),
          orderBy('startAt', 'asc'),
          limit(30),
        );
        const unsubCal = onSnapshot(
          calQ,
          (snap) => {
            snap.docChanges().forEach((change) => {
              emit({
                kind: 'calendar',
                itemId: change.doc.id,
                changeType: change.type,
                data: change.doc.data() as Record<string, unknown>,
                timestamp: Date.now(),
              });
            });
            if (!snap.metadata.fromCache) triggerRefresh('realtime-calendar');
          },
          (error) => {
            console.warn('[AIRealtimeSync] calendar listener failed:', error);
          },
        );
        next.unsubscribers.push(unsubCal);
      } catch (e) {
        console.warn('[AIRealtimeSync] calendar subscribe failed:', e);
      }

      // 公告 ──────────────────────────────────────
      if (params.schoolId) {
        try {
          const annQ = query(
            collection(db, 'schools', params.schoolId, 'announcements'),
            orderBy('publishedAt', 'desc'),
            limit(15),
          );
          const unsubAnn = onSnapshot(
            annQ,
            (snap) => {
              snap.docChanges().forEach((change) => {
                emit({
                  kind: 'announcement',
                  itemId: change.doc.id,
                  changeType: change.type,
                  data: change.doc.data() as Record<string, unknown>,
                  timestamp: Date.now(),
                });
              });
              if (!snap.metadata.fromCache) triggerRefresh('realtime-announcement');
            },
            (error) => {
              console.warn('[AIRealtimeSync] announcements listener failed:', error);
            },
          );
          next.unsubscribers.push(unsubAnn);
        } catch (e) {
          console.warn('[AIRealtimeSync] announcements subscribe failed:', e);
        }
      }
    } catch (e) {
      console.warn('[AIRealtimeSync] startup failed, fallback to polling:', e);
    }
  }

  // 即使 Firestore listener 都失敗，也保留輪詢回退
  const pollMs = params.fallbackPollMs ?? 60_000;
  const fallbackTimer = setInterval(() => {
    if (current !== next) return;
    triggerRefresh('realtime-fallback-poll');
  }, pollMs);
  next.unsubscribers.push(() => clearInterval(fallbackTimer));

  return () => stopRealtimeSync();
}

export function stopRealtimeSync(): void {
  if (!current) return;
  for (const off of current.unsubscribers) {
    try {
      off();
    } catch (e) {
      console.warn('[AIRealtimeSync] unsubscribe failed:', e);
    }
  }
  if (current.refreshTimer) clearTimeout(current.refreshTimer);
  current = null;
}

export function isRealtimeSyncActive(): boolean {
  return current !== null && (current.unsubscribers.length > 0);
}
