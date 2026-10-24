/* eslint-disable @typescript-eslint/no-explicit-any */
import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  useCallback,
  useRef,
} from 'react';
import {
  collection,
  getDocs,
  query,
  orderBy,
  limit,
  startAfter,
  doc,
  setDoc,
  serverTimestamp,
  writeBatch,
  type QueryDocumentSnapshot,
  type DocumentData,
} from 'firebase/firestore';
import { getDb, hasUsableFirebaseConfig } from '../firebase';
import { useAuth } from './auth';

export type NotificationType =
  | 'announcement'
  | 'event'
  | 'group_post'
  | 'group_invite'
  | 'assignment'
  | 'grade'
  | 'message'
  | 'system';

export type Notification = {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  createdAt?: any;
  read: boolean;
  data?: Record<string, any>;
};

/** 未讀數僅涵蓋目前已載入頁面，不是全信箱總數。 */
export type UnreadScope = 'loaded';

type NotificationsContextValue = {
  notifications: Notification[];
  unreadCount: number;
  unreadScope: UnreadScope;
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  error: string | null;
  markAsRead: (id: string) => Promise<boolean>;
  markAllAsRead: () => Promise<boolean>;
  loadMore: () => Promise<void>;
  reload: () => void;
};

const NotificationsContext = createContext<NotificationsContextValue | null>(null);
type NotificationOwner = { uid: string | null; db: ReturnType<typeof getDb> | null };
type NotificationState = {
  owner: NotificationOwner;
  items: Notification[];
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  error: string | null;
};

const PAGE_SIZE = 50;

function mapNotificationDoc(d: QueryDocumentSnapshot<DocumentData>): Notification {
  const data = d.data();
  return {
    id: d.id,
    type: data.type ?? 'system',
    title: data.title ?? '',
    body: data.body ?? '',
    createdAt: data.createdAt,
    read: data.read ?? false,
    data: data.data ?? {},
  };
}

function dedupeById(rows: Notification[]): Notification[] {
  const seen = new Set<string>();
  const out: Notification[] = [];
  for (const row of rows) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    out.push(row);
  }
  return out;
}

export function NotificationsProvider(props: { children: React.ReactNode }) {
  const auth = useAuth();
  const db = useMemo(() => (hasUsableFirebaseConfig() ? getDb() : null), []);
  // A new owner object also fences A -> B -> A, where the uid alone would match.
  const owner = useMemo(() => ({ uid: auth.user?.uid ?? null, db }), [auth.user?.uid, db]);
  const activeOwner = useRef(owner);
  activeOwner.current = owner;
  const mounted = useRef(false);
  const isCurrent = useCallback(() => mounted.current && activeOwner.current === owner, [owner]);
  const cursorRef = useRef<QueryDocumentSnapshot<DocumentData> | null>(null);
  const loadMoreLock = useRef(false);
  const [state, setState] = useState<NotificationState>(() => ({
    owner,
    items: [],
    loading: !!(owner.uid && owner.db),
    loadingMore: false,
    hasMore: false,
    error: null,
  }));
  const [reloadTrigger, setReloadTrigger] = useState(0);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    cursorRef.current = null;
    loadMoreLock.current = false;
    if (!owner.db || !owner.uid) {
      setState({
        owner,
        items: [],
        loading: false,
        loadingMore: false,
        hasMore: false,
        error: null,
      });
      return;
    }
    let cancelled = false;
    setState((previous) => ({
      owner,
      items: previous.owner === owner ? previous.items : [],
      loading: true,
      loadingMore: false,
      hasMore: previous.owner === owner ? previous.hasMore : false,
      error: null,
    }));
    (async () => {
      try {
        const ref = collection(owner.db!, 'users', owner.uid!, 'notifications');
        const snap = await getDocs(query(ref, orderBy('createdAt', 'desc'), limit(PAGE_SIZE)));
        if (cancelled || !isCurrent()) return;
        const items = snap.docs.map(mapNotificationDoc);
        cursorRef.current = snap.docs.length > 0 ? snap.docs[snap.docs.length - 1]! : null;
        setState({
          owner,
          items,
          loading: false,
          loadingMore: false,
          hasMore: snap.docs.length >= PAGE_SIZE,
          error: null,
        });
      } catch (failure: any) {
        if (!cancelled && isCurrent()) {
          setState((previous) =>
            previous.owner === owner
              ? {
                  ...previous,
                  loading: false,
                  loadingMore: false,
                  error: failure?.message ?? '載入通知失敗',
                }
              : previous,
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [owner, isCurrent, reloadTrigger]);

  // Effects run after rendering: never expose the previous owner's rows or count,
  // even for the first render of a new account or logout.
  const notifications = useMemo(
    () => (state.owner === owner ? state.items : []),
    [state.owner, state.items, owner],
  );
  const loading = state.owner === owner ? state.loading : !!(owner.uid && owner.db);
  const loadingMore = state.owner === owner ? state.loadingMore : false;
  const hasMore = state.owner === owner ? state.hasMore : false;
  const error = state.owner === owner ? state.error : null;
  const unreadCount = notifications.filter((notification) => !notification.read).length;
  const unreadScope: UnreadScope = 'loaded';

  const reportReadOutcome = useCallback(
    (input: Record<string, unknown>, success: boolean, message: string, failure?: unknown) => {
      void import('../services/aiBrain')
        .then(({ aiBrain }) => {
          if (isCurrent()) {
            aiBrain.reportToolOutcome(
              'mark_notifications_read',
              input,
              success ? 'success' : 'failure',
              failure === undefined ? undefined : String(failure),
              message,
            );
          }
        })
        .catch(() => {
          /* Reporting cannot change a confirmed Firestore result. */
        });
    },
    [isCurrent],
  );

  const markAsRead = useCallback(
    async (id: string): Promise<boolean> => {
      if (!owner.uid || !owner.db || !isCurrent()) return false;
      const original = notifications.find((notification) => notification.id === id);
      if (!original) return false;
      if (original.read) return true;
      const optimistic = { ...original, read: true };
      setState((previous) =>
        previous.owner === owner
          ? {
              ...previous,
              items: previous.items.map((row) => (row === original ? optimistic : row)),
            }
          : previous,
      );
      try {
        await setDoc(
          doc(owner.db, 'users', owner.uid, 'notifications', id),
          { read: true, readAt: serverTimestamp() },
          { merge: true },
        );
        if (!isCurrent()) return false;
        reportReadOutcome(
          { action: 'single', notificationId: id, scope: 'loaded' },
          true,
          '使用者在通知中心將單則通知標為已讀',
        );
        return true;
      } catch (failure) {
        if (!isCurrent()) return false;
        reportReadOutcome(
          { action: 'single', notificationId: id, scope: 'loaded' },
          false,
          '通知標為已讀失敗',
          failure,
        );
        setState((previous) =>
          previous.owner === owner
            ? {
                ...previous,
                items: previous.items.map((row) => (row === optimistic ? original : row)),
              }
            : previous,
        );
        return false;
      }
    },
    [owner, isCurrent, notifications, reportReadOutcome],
  );

  const markAllAsRead = useCallback(async (): Promise<boolean> => {
    if (!owner.uid || !owner.db || !isCurrent()) return false;
    // 明確範圍：僅目前已載入頁面的未讀，不含尚未分頁載入的歷史。
    const unread = notifications.filter((notification) => !notification.read);
    if (!unread.length) return true;
    const originals = new Map(unread.map((row) => [row.id, row]));
    const optimistic = new Map(unread.map((row) => [row.id, { ...row, read: true }]));
    setState((previous) =>
      previous.owner === owner
        ? {
            ...previous,
            items: previous.items.map((row) =>
              row === originals.get(row.id) ? optimistic.get(row.id)! : row,
            ),
          }
        : previous,
    );
    try {
      const batch = writeBatch(owner.db);
      const readAt = serverTimestamp();
      for (const row of unread) {
        batch.update(doc(owner.db, 'users', owner.uid, 'notifications', row.id), {
          read: true,
          readAt,
        });
      }
      await batch.commit();
      if (!isCurrent()) return false;
      reportReadOutcome(
        {
          action: 'all_loaded',
          scope: 'loaded',
          notificationIds: unread.map((row) => row.id),
          count: unread.length,
        },
        true,
        `使用者在通知中心將已載入的 ${unread.length} 則通知標為已讀`,
      );
      if (unread.length >= 3) {
        void import('../services/companionEngine')
          .then((module) => {
            if (isCurrent()) module.recordCompanionFeatureSignal('notification_batch');
          })
          .catch(() => {});
      }
      return true;
    } catch (failure) {
      if (!isCurrent()) return false;
      reportReadOutcome(
        {
          action: 'all_loaded',
          scope: 'loaded',
          notificationIds: unread.map((row) => row.id),
        },
        false,
        '已載入通知全部標為已讀失敗',
        failure,
      );
      setState((previous) =>
        previous.owner === owner
          ? {
              ...previous,
              items: previous.items.map((row) =>
                row === optimistic.get(row.id) ? originals.get(row.id)! : row,
              ),
            }
          : previous,
      );
      return false;
    }
  }, [owner, isCurrent, notifications, reportReadOutcome]);

  const loadMore = useCallback(async () => {
    if (!owner.uid || !owner.db || !isCurrent()) return;
    if (!hasMore || loading || loadingMore || loadMoreLock.current) return;
    const cursor = cursorRef.current;
    if (!cursor) return;
    loadMoreLock.current = true;
    setState((previous) =>
      previous.owner === owner ? { ...previous, loadingMore: true, error: null } : previous,
    );
    try {
      const ref = collection(owner.db, 'users', owner.uid, 'notifications');
      const snap = await getDocs(
        query(ref, orderBy('createdAt', 'desc'), startAfter(cursor), limit(PAGE_SIZE)),
      );
      if (!isCurrent()) return;
      const page = snap.docs.map(mapNotificationDoc);
      cursorRef.current = snap.docs.length > 0 ? snap.docs[snap.docs.length - 1]! : cursor;
      setState((previous) =>
        previous.owner === owner
          ? {
              ...previous,
              items: dedupeById([...previous.items, ...page]),
              loadingMore: false,
              hasMore: snap.docs.length >= PAGE_SIZE,
            }
          : previous,
      );
    } catch (failure: any) {
      if (isCurrent()) {
        setState((previous) =>
          previous.owner === owner
            ? {
                ...previous,
                loadingMore: false,
                error: failure?.message ?? '載入更多通知失敗',
              }
            : previous,
        );
      }
    } finally {
      loadMoreLock.current = false;
    }
  }, [owner, isCurrent, hasMore, loading, loadingMore]);

  const reload = useCallback(() => {
    if (isCurrent()) setReloadTrigger((value) => value + 1);
  }, [isCurrent]);
  const value = useMemo(
    () => ({
      notifications,
      unreadCount,
      unreadScope,
      loading,
      loadingMore,
      hasMore,
      error,
      markAsRead,
      markAllAsRead,
      loadMore,
      reload,
    }),
    [
      notifications,
      unreadCount,
      unreadScope,
      loading,
      loadingMore,
      hasMore,
      error,
      markAsRead,
      markAllAsRead,
      loadMore,
      reload,
    ],
  );

  return (
    <NotificationsContext.Provider value={value}>{props.children}</NotificationsContext.Provider>
  );
}

export function useNotifications() {
  const ctx = useContext(NotificationsContext);
  if (!ctx) throw new Error('useNotifications must be used within NotificationsProvider');
  return ctx;
}

export function getNotificationIcon(type: NotificationType): string {
  switch (type) {
    case 'announcement':
      return 'megaphone';
    case 'event':
      return 'calendar';
    case 'group_post':
      return 'chatbubbles';
    case 'group_invite':
      return 'person-add';
    case 'assignment':
      return 'document-text';
    case 'grade':
      return 'school';
    case 'message':
      return 'mail';
    case 'system':
    default:
      return 'notifications';
  }
}

export function getNotificationTypeLabel(type: NotificationType): string {
  switch (type) {
    case 'announcement':
      return '公告';
    case 'event':
      return '活動';
    case 'group_post':
      return '群組';
    case 'group_invite':
      return '邀請';
    case 'assignment':
      return '作業';
    case 'grade':
      return '成績';
    case 'message':
      return '訊息';
    case 'system':
    default:
      return '系統';
  }
}
