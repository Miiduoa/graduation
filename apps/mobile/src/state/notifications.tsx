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
  doc,
  setDoc,
  serverTimestamp,
  writeBatch,
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

type NotificationsContextValue = {
  notifications: Notification[];
  unreadCount: number;
  loading: boolean;
  error: string | null;
  markAsRead: (id: string) => Promise<void>;
  markAllAsRead: () => Promise<void>;
  reload: () => void;
};

const NotificationsContext = createContext<NotificationsContextValue | null>(null);
type NotificationOwner = { uid: string | null; db: ReturnType<typeof getDb> | null };
type NotificationState = {
  owner: NotificationOwner;
  items: Notification[];
  loading: boolean;
  error: string | null;
};

export function NotificationsProvider(props: { children: React.ReactNode }) {
  const auth = useAuth();
  const db = useMemo(() => (hasUsableFirebaseConfig() ? getDb() : null), []);
  // A new owner object also fences A -> B -> A, where the uid alone would match.
  const owner = useMemo(() => ({ uid: auth.user?.uid ?? null, db }), [auth.user?.uid, db]);
  const activeOwner = useRef(owner);
  activeOwner.current = owner;
  const mounted = useRef(false);
  const isCurrent = useCallback(() => mounted.current && activeOwner.current === owner, [owner]);
  const [state, setState] = useState<NotificationState>(() => ({
    owner,
    items: [],
    loading: !!(owner.uid && owner.db),
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
    if (!owner.db || !owner.uid) {
      setState({ owner, items: [], loading: false, error: null });
      return;
    }
    let cancelled = false;
    setState((previous) => ({
      owner,
      items: previous.owner === owner ? previous.items : [],
      loading: true,
      error: null,
    }));
    (async () => {
      try {
        const ref = collection(owner.db!, 'users', owner.uid!, 'notifications');
        const snap = await getDocs(query(ref, orderBy('createdAt', 'desc'), limit(50)));
        if (cancelled || !isCurrent()) return;
        const items = snap.docs.map((d) => {
          const data = d.data();
          return {
            id: d.id,
            type: data.type ?? 'system',
            title: data.title ?? '',
            body: data.body ?? '',
            createdAt: data.createdAt,
            read: data.read ?? false,
            data: data.data ?? {},
          } as Notification;
        });
        setState({ owner, items, loading: false, error: null });
      } catch (failure: any) {
        if (!cancelled && isCurrent()) {
          setState((previous) =>
            previous.owner === owner
              ? { ...previous, loading: false, error: failure?.message ?? '載入通知失敗' }
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
  const error = state.owner === owner ? state.error : null;
  const unreadCount = notifications.filter((notification) => !notification.read).length;

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
    async (id: string) => {
      if (!owner.uid || !owner.db || !isCurrent()) return;
      const original = notifications.find((notification) => notification.id === id);
      if (!original || original.read) return;
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
        if (!isCurrent()) return;
        reportReadOutcome(
          { action: 'single', notificationId: id },
          true,
          '使用者在通知中心將單則通知標為已讀',
        );
      } catch (failure) {
        if (!isCurrent()) return;
        reportReadOutcome(
          { action: 'single', notificationId: id },
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
      }
    },
    [owner, isCurrent, notifications, reportReadOutcome],
  );

  const markAllAsRead = useCallback(async () => {
    if (!owner.uid || !owner.db || !isCurrent()) return;
    const unread = notifications.filter((notification) => !notification.read);
    if (!unread.length) return;
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
      if (!isCurrent()) return;
      reportReadOutcome(
        { action: 'all', notificationIds: unread.map((row) => row.id) },
        true,
        `使用者在通知中心將 ${unread.length} 則通知全部標為已讀`,
      );
      if (unread.length >= 3) {
        void import('../services/companionEngine')
          .then((module) => {
            if (isCurrent()) module.recordCompanionFeatureSignal('notification_batch');
          })
          .catch(() => {});
      }
    } catch (failure) {
      if (!isCurrent()) return;
      reportReadOutcome(
        { action: 'all', notificationIds: unread.map((row) => row.id) },
        false,
        '全部通知標為已讀失敗',
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
    }
  }, [owner, isCurrent, notifications, reportReadOutcome]);

  const reload = useCallback(() => {
    if (isCurrent()) setReloadTrigger((value) => value + 1);
  }, [isCurrent]);
  const value = useMemo(
    () => ({
      notifications,
      unreadCount,
      loading,
      error,
      markAsRead,
      markAllAsRead,
      reload,
    }),
    [notifications, unreadCount, loading, error, markAsRead, markAllAsRead, reload],
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
