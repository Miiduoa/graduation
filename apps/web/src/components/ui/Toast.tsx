'use client';

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useRef,
  useSyncExternalStore,
  ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import styles from './Toast.module.css';

type ToastType = 'success' | 'error' | 'warning' | 'info';

interface Toast {
  id: string;
  type: ToastType;
  title: string;
  message?: string;
  duration?: number;
}

interface ToastContextType {
  showToast: (toast: Omit<Toast, 'id'>) => void;
  success: (title: string, message?: string) => void;
  error: (title: string, message?: string) => void;
  warning: (title: string, message?: string) => void;
  info: (title: string, message?: string) => void;
  dismiss: (id: string) => void;
  dismissAll: () => void;
}

const subscribeToHydration = () => () => {};
const clientSnapshot = () => true;
const serverSnapshot = () => false;

// Subscribe once per provider, so a stack of notifications shares the same
// reading window. Hidden tabs and unfocused windows should not consume it.
const subscribeToPageActivity = (onChange: () => void) => {
  document.addEventListener('visibilitychange', onChange);
  window.addEventListener('blur', onChange);
  window.addEventListener('focus', onChange);
  return () => {
    document.removeEventListener('visibilitychange', onChange);
    window.removeEventListener('blur', onChange);
    window.removeEventListener('focus', onChange);
  };
};
const pageIsInactive = () => document.visibilityState !== 'visible' || !document.hasFocus();
const serverPageIsInactive = () => true;

const ToastContext = createContext<ToastContextType | null>(null);

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
}

interface ToastProviderProps {
  children: ReactNode;
  position?:
    | 'top-right'
    | 'top-left'
    | 'bottom-right'
    | 'bottom-left'
    | 'top-center'
    | 'bottom-center';
  maxToasts?: number;
}

export function ToastProvider({
  children,
  position = 'top-right',
  maxToasts = 5,
}: ToastProviderProps) {
  const mounted = useSyncExternalStore(subscribeToHydration, clientSnapshot, serverSnapshot);
  const pageInactive = useSyncExternalStore(
    subscribeToPageActivity,
    pageIsInactive,
    serverPageIsInactive,
  );
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const dismissAll = useCallback(() => {
    setToasts([]);
  }, []);

  const showToast = useCallback(
    (toast: Omit<Toast, 'id'>) => {
      const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const newToast = { ...toast, id };

      setToasts((prev) => {
        const updated = [newToast, ...prev];
        return updated.slice(0, maxToasts);
      });
    },
    [maxToasts],
  );

  const success = useCallback(
    (title: string, message?: string) => showToast({ type: 'success', title, message }),
    [showToast],
  );

  const error = useCallback(
    (title: string, message?: string) =>
      showToast({ type: 'error', title, message, duration: 6000 }),
    [showToast],
  );

  const warning = useCallback(
    (title: string, message?: string) => showToast({ type: 'warning', title, message }),
    [showToast],
  );

  const info = useCallback(
    (title: string, message?: string) => showToast({ type: 'info', title, message }),
    [showToast],
  );

  return (
    <ToastContext.Provider
      value={{ showToast, success, error, warning, info, dismiss, dismissAll }}
    >
      {children}
      {mounted &&
        createPortal(
          <div className={styles.region} data-position={position}>
            {toasts.map((toast) => (
              <ToastItem
                key={toast.id}
                toast={toast}
                onDismiss={dismiss}
                pageInactive={pageInactive}
              />
            ))}
          </div>,
          document.body,
        )}
    </ToastContext.Provider>
  );
}

interface ToastItemProps {
  toast: Toast;
  onDismiss: (id: string) => void;
  pageInactive: boolean;
}

function ToastItem({ toast, onDismiss, pageInactive }: ToastItemProps) {
  const icons: Record<ToastType, string> = {
    success: '✓',
    error: '✕',
    warning: '!',
    info: 'i',
  };
  const duration = toast.duration ?? 4000;
  const remaining = useRef(duration);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const paused = pageInactive || hovered || focused;

  useEffect(() => {
    if (duration <= 0 || paused) return;

    const startedAt = Date.now();
    const timer = window.setTimeout(() => onDismiss(toast.id), remaining.current);
    return () => {
      window.clearTimeout(timer);
      remaining.current = Math.max(0, remaining.current - (Date.now() - startedAt));
    };
  }, [duration, onDismiss, paused, toast.id]);

  return (
    <div
      className={`${styles.toast} ${styles[toast.type]}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false);
      }}
    >
      <div className={styles.icon} aria-hidden="true">
        {icons[toast.type]}
      </div>
      <div
        className={styles.content}
        role={toast.type === 'error' ? 'alert' : 'status'}
        aria-atomic="true"
      >
        <div className={styles.title}>{toast.title}</div>
        {toast.message && <div className={styles.message}>{toast.message}</div>}
      </div>
      <button
        type="button"
        className={styles.dismiss}
        onClick={() => onDismiss(toast.id)}
        aria-label={`關閉通知：${toast.title}`}
      >
        <span aria-hidden="true">✕</span>
      </button>
    </div>
  );
}

export type { Toast, ToastType, ToastContextType };
