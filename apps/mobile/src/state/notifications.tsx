/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars, react-hooks/exhaustive-deps */
import React, { createContext, useContext, useEffect, useMemo, useState, useCallback } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { collection, getDocs, query, where, orderBy, limit, doc, setDoc, serverTimestamp, writeBatch } from "firebase/firestore";
import { getDb, hasUsableFirebaseConfig } from "../firebase";
import { useAuth } from "./auth";

export type NotificationType =
  | "announcement"
  | "event"
  | "group_post"
  | "group_invite"
  | "assignment"
  | "grade"
  | "message"
  | "system";

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

const STORAGE_KEY = "campus.notifications.lastRead.v1";
const NotificationsContext = createContext<NotificationsContextValue | null>(null);

export function NotificationsProvider(props: { children: React.ReactNode }) {
  const auth = useAuth();
  const db = useMemo(() => {
    if (!hasUsableFirebaseConfig()) return null;
    return getDb();
  }, []);

  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastRead, setLastRead] = useState<string | null>(null);
  const [reloadTrigger, setReloadTrigger] = useState(0);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then((v) => setLastRead(v)).catch(() => void 0);
  }, []);

  useEffect(() => {
    if (!db) {
      setNotifications([]);
      setLoading(false);
      setError(null);
      return;
    }

    if (!auth.user) {
      setNotifications([]);
      return;
    }

    const uid = auth.user.uid;
    let cancelled = false;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        const ref = collection(db, "users", uid, "notifications");
        const qy = query(ref, orderBy("createdAt", "desc"), limit(50));
        const snap = await getDocs(qy);

        if (cancelled) return;

        const items = snap.docs.map((d) => {
          const data = d.data() as any;
          return {
            id: d.id,
            type: data.type ?? "system",
            title: data.title ?? "",
            body: data.body ?? "",
            createdAt: data.createdAt,
            read: data.read ?? false,
            data: data.data ?? {},
          } as Notification;
        });

        setNotifications(items);
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? "載入通知失敗");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [db, auth.user?.uid, reloadTrigger]);

  const unreadCount = useMemo(() => {
    return notifications.filter((n) => !n.read).length;
  }, [notifications]);

  const markAsRead = useCallback(async (id: string) => {
    if (!auth.user || !db) return;

    // 使用 functional update 來獲取當前狀態的快照，避免閉包問題
    let notificationsSnapshot: Notification[] = [];
    
    setNotifications((prev) => {
      notificationsSnapshot = prev;
      return prev.map((n) => (n.id === id ? { ...n, read: true } : n));
    });

    try {
      await setDoc(
        doc(db, "users", auth.user.uid, "notifications", id),
        { read: true, readAt: serverTimestamp() },
        { merge: true }
      );
    } catch (e) {
      console.warn("Failed to mark notification as read:", e);
      // 回滾時也使用 functional update，確保只回滾我們的修改
      setNotifications((current) => {
        // 檢查是否已經被其他操作修改過，如果是則不回滾
        const targetNotification = current.find(n => n.id === id);
        const originalNotification = notificationsSnapshot.find(n => n.id === id);
        
        if (targetNotification && originalNotification && targetNotification.read !== originalNotification.read) {
          // 只回滾這一個通知的 read 狀態
          return current.map((n) => 
            n.id === id ? { ...n, read: originalNotification.read } : n
          );
        }
        return current;
      });
    }
  }, [auth.user, db]);

  const markAllAsRead = useCallback(async () => {
    if (!auth.user || !db) return;

    // 使用 functional update 來獲取當前狀態並計算需要更新的項目
    let unreadIds: string[] = [];
    const originalReadStates: Map<string, boolean> = new Map();
    
    setNotifications((prev) => {
      const unread = prev.filter((n) => !n.read);
      if (unread.length === 0) return prev;
      
      // 記錄原始狀態
      unreadIds = unread.map(n => n.id);
      prev.forEach(n => originalReadStates.set(n.id, n.read));
      
      return prev.map((n) => ({ ...n, read: true }));
    });

    // 如果沒有未讀通知，提前返回
    if (unreadIds.length === 0) return;

    try {
      const batch = writeBatch(db);
      const readAt = serverTimestamp();
      
      for (const nId of unreadIds) {
        const notifRef = doc(db, "users", auth.user.uid, "notifications", nId);
        batch.update(notifRef, { read: true, readAt });
      }
      
      await batch.commit();
    } catch (e) {
      console.warn("Failed to mark all notifications as read:", e);
      // 精確回滾：只回滾我們修改過的項目
      setNotifications((current) => 
        current.map((n) => {
          const originalRead = originalReadStates.get(n.id);
          if (originalRead !== undefined && unreadIds.includes(n.id)) {
            return { ...n, read: originalRead };
          }
          return n;
        })
      );
    }
  }, [auth.user, db]);

  const reload = useCallback(() => setReloadTrigger((t) => t + 1), []);

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
    [notifications, unreadCount, loading, error, markAsRead, markAllAsRead, reload]
  );

  return (
    <NotificationsContext.Provider value={value}>
      {props.children}
    </NotificationsContext.Provider>
  );
}

export function useNotifications() {
  const ctx = useContext(NotificationsContext);
  if (!ctx) throw new Error("useNotifications must be used within NotificationsProvider");
  return ctx;
}

export function getNotificationIcon(type: NotificationType): string {
  switch (type) {
    case "announcement":
      return "megaphone";
    case "event":
      return "calendar";
    case "group_post":
      return "chatbubbles";
    case "group_invite":
      return "person-add";
    case "assignment":
      return "document-text";
    case "grade":
      return "school";
    case "message":
      return "mail";
    case "system":
    default:
      return "notifications";
  }
}

export function getNotificationTypeLabel(type: NotificationType): string {
  switch (type) {
    case "announcement":
      return "公告";
    case "event":
      return "活動";
    case "group_post":
      return "群組";
    case "group_invite":
      return "邀請";
    case "assignment":
      return "作業";
    case "grade":
      return "成績";
    case "message":
      return "訊息";
    case "system":
    default:
      return "系統";
  }
}
