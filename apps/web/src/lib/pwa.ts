/**
 * PWA Utilities
 * PWA 相關功能：Service Worker 註冊、推播通知、離線支援
 */

interface NavigatorWithStandalone extends Navigator {
  standalone?: boolean;
}

interface BeforeInstallPromptEventLike extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

type SyncCapableServiceWorkerRegistration = ServiceWorkerRegistration & {
  sync: {
    register: (tag: string) => Promise<void>;
  };
};

function hasBackgroundSync(
  registration: ServiceWorkerRegistration
): registration is SyncCapableServiceWorkerRegistration {
  return "sync" in registration;
}

// Service Worker Registration
export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) {
    console.log("[PWA] Service Worker not supported");
    return null;
  }

  try {
    const registration = await navigator.serviceWorker.register("/sw.js", {
      scope: "/",
    });

    console.log("[PWA] Service Worker registered:", registration.scope);

    // Handle updates
    registration.addEventListener("updatefound", () => {
      const newWorker = registration.installing;
      if (!newWorker) return;

      newWorker.addEventListener("statechange", () => {
        if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
          // New update available
          if (typeof window !== "undefined") {
            const event = new CustomEvent("swUpdate", { detail: registration });
            window.dispatchEvent(event);
          }
        }
      });
    });

    return registration;
  } catch (error) {
    console.error("[PWA] Service Worker registration failed:", error);
    return null;
  }
}

// Skip waiting and activate new service worker
export async function skipWaiting(): Promise<void> {
  const registration = await navigator.serviceWorker.getRegistration();
  if (registration?.waiting) {
    registration.waiting.postMessage({ type: "SKIP_WAITING" });
  }
}

// Push Notification Permission
export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (!("Notification" in window)) {
    console.log("[PWA] Notifications not supported");
    return "denied";
  }

  if (Notification.permission === "granted") {
    return "granted";
  }

  if (Notification.permission !== "denied") {
    const permission = await Notification.requestPermission();
    return permission;
  }

  return Notification.permission;
}

// Subscribe to Push Notifications
export async function subscribeToPushNotifications(
  vapidPublicKey: string
): Promise<PushSubscription | null> {
  try {
    const registration = await navigator.serviceWorker.ready;
    
    // Check if already subscribed
    const existingSubscription = await registration.pushManager.getSubscription();
    if (existingSubscription) {
      return existingSubscription;
    }

    // Subscribe
    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
    });

    console.log("[PWA] Push subscription:", subscription);
    return subscription;
  } catch (error) {
    console.error("[PWA] Push subscription failed:", error);
    return null;
  }
}

// Unsubscribe from Push Notifications
export async function unsubscribeFromPushNotifications(): Promise<boolean> {
  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    
    if (subscription) {
      await subscription.unsubscribe();
      console.log("[PWA] Push unsubscribed");
      return true;
    }
    
    return false;
  } catch (error) {
    console.error("[PWA] Push unsubscribe failed:", error);
    return false;
  }
}

// Show local notification
export function showNotification(
  title: string,
  options?: NotificationOptions
): void {
  if (!("Notification" in window) || Notification.permission !== "granted") {
    return;
  }

  const defaultOptions: NotificationOptions = {
    icon: "/icons/icon-192x192.png",
    badge: "/icons/badge-72x72.png",
    ...options,
  };

  new Notification(title, defaultOptions);
}

// Check if app is installed (PWA)
export function isAppInstalled(): boolean {
  if (typeof window === "undefined") return false;
  
  // Check for display-mode: standalone
  if (window.matchMedia("(display-mode: standalone)").matches) {
    return true;
  }
  
  // Check for iOS standalone mode
  if ((window.navigator as NavigatorWithStandalone).standalone === true) {
    return true;
  }
  
  return false;
}

// Check if app can be installed
export function canInstallApp(): boolean {
  if (typeof window === "undefined") return false;
  
  // Check for beforeinstallprompt event
  return "BeforeInstallPromptEvent" in window;
}

// App Install Prompt Handler
let deferredPrompt: BeforeInstallPromptEventLike | null = null;

export function initInstallPrompt(): void {
  if (typeof window === "undefined") return;

  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredPrompt = e as BeforeInstallPromptEventLike;
    
    // Dispatch custom event
    const event = new CustomEvent("canInstall", { detail: true });
    window.dispatchEvent(event);
  });

  window.addEventListener("appinstalled", () => {
    deferredPrompt = null;
    
    // Dispatch custom event
    const event = new CustomEvent("appInstalled");
    window.dispatchEvent(event);
  });
}

export async function promptInstall(): Promise<boolean> {
  if (!deferredPrompt) {
    return false;
  }

  deferredPrompt.prompt();
  const { outcome } = await deferredPrompt.userChoice;
  deferredPrompt = null;

  return outcome === "accepted";
}

// Offline detection
export function isOnline(): boolean {
  if (typeof window === "undefined") return true;
  return navigator.onLine;
}

export function onOnlineStatusChange(callback: (online: boolean) => void): () => void {
  if (typeof window === "undefined") return () => {};

  const handleOnline = () => callback(true);
  const handleOffline = () => callback(false);

  window.addEventListener("online", handleOnline);
  window.addEventListener("offline", handleOffline);

  return () => {
    window.removeEventListener("online", handleOnline);
    window.removeEventListener("offline", handleOffline);
  };
}

// Background Sync
export async function registerBackgroundSync(tag: string): Promise<boolean> {
  try {
    const registration = await navigator.serviceWorker.ready;
    
    if (hasBackgroundSync(registration)) {
      await registration.sync.register(tag);
      console.log("[PWA] Background sync registered:", tag);
      return true;
    }
    
    return false;
  } catch (error) {
    console.error("[PWA] Background sync failed:", error);
    return false;
  }
}

// Cache management
export async function cacheUrls(urls: string[]): Promise<void> {
  const registration = await navigator.serviceWorker.ready;
  
  if (registration.active) {
    registration.active.postMessage({
      type: "CACHE_URLS",
      urls,
    });
  }
}

export async function clearCache(): Promise<void> {
  const keys = await caches.keys();
  await Promise.all(keys.map((key) => caches.delete(key)));
  console.log("[PWA] Cache cleared");
}

// Utility function to convert VAPID key
function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding)
    .replace(/-/g, "+")
    .replace(/_/g, "/");

  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(new ArrayBuffer(rawData.length));

  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }

  return outputArray;
}

// Share API
export async function share(data: ShareData): Promise<boolean> {
  if (!("share" in navigator)) {
    return false;
  }

  try {
    await navigator.share(data);
    return true;
  } catch (error) {
    if ((error as Error).name !== "AbortError") {
      console.error("[PWA] Share failed:", error);
    }
    return false;
  }
}

// Clipboard API
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Fallback for older browsers
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    
    try {
      document.execCommand("copy");
      return true;
    } finally {
      document.body.removeChild(textarea);
    }
  }
}
