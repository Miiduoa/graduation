/* eslint-disable @typescript-eslint/no-explicit-any */
export function formatDateTime(input: string | number | Date | any) {
  try {
    const v: any = input as any;
    if (v == null) return "";

    // Firestore Timestamp (or Timestamp-like): { seconds, nanoseconds, toDate() }
    if (typeof v === "object") {
      if (typeof v.toMillis === "function") {
        const d = new Date(v.toMillis());
        if (!Number.isNaN(d.getTime())) return d.toLocaleString();
      }
      if (typeof v.toDate === "function") {
        const raw = v.toDate();
        // Re-wrap to avoid Hermes cross-realm Date issues
        let d: Date;
        try { d = new Date(raw.getTime()); } catch { d = new Date(Date.parse(String(raw))); }
        if (!Number.isNaN(d.getTime())) return d.toLocaleString();
      }
      if (typeof v.seconds === "number") {
        const d = new Date(v.seconds * 1000);
        if (!Number.isNaN(d.getTime())) return d.toLocaleString();
      }
      if (typeof v._seconds === "number") {
        const d = new Date(v._seconds * 1000);
        if (!Number.isNaN(d.getTime())) return d.toLocaleString();
      }
    }

    const d = v instanceof Date ? v : new Date(v);
    if (Number.isNaN(d.getTime())) return String(v);
    return d.toLocaleString();
  } catch {
    return String(input);
  }
}

export function formatDate(input: string | number | Date | any): string {
  const date = toDate(input);
  return date ? date.toLocaleDateString("zh-TW") : "";
}

function isValidDate(d: unknown): d is Date {
  if (!d) return false;
  if (!(d instanceof Date)) return false;
  // Some mocks/serializers might carry `getTime` but not behave like real Date.
  const getTime = (d as { getTime?: unknown }).getTime;
  if (typeof getTime !== "function") return false;
  // getTime 依賴 this 指向 Date 物件，所以要用 call 綁定。
  const t = (getTime as (this: Date) => number).call(d);
  return typeof t === "number" && !Number.isNaN(t);
}

export function toDate(input: any): Date | null {
  try {
    if (input == null) return null;

    // Firestore Timestamp — prefer toMillis() (plain number, no cross-realm risk)
    if (typeof input.toMillis === "function") {
      const ms = input.toMillis();
      if (typeof ms === "number" && Number.isFinite(ms)) return new Date(ms);
    }

    // Firestore Timestamp.toDate() — re-wrap to avoid Hermes cross-realm Date issues
    if (typeof input.toDate === "function") {
      const d = input.toDate();
      try { return new Date(d.getTime()); } catch { /* cross-realm */ }
      const parsed = Date.parse(String(d));
      return Number.isFinite(parsed) ? new Date(parsed) : null;
    }

    // Serialised Firestore Timestamp
    if (typeof input._seconds === "number") return new Date(input._seconds * 1000);
    if (typeof input.seconds === "number") return new Date(input.seconds * 1000);

    // String, number, or current-realm Date
    const d = input instanceof Date ? input : new Date(input);
    return Number.isNaN(d.getTime()) ? null : d;
  } catch {
    return null;
  }
}

export function formatRelativeTime(date?: Date | null): string {
  if (!isValidDate(date)) return "";
  const now = new Date();
  const getTime = (date as { getTime?: unknown }).getTime;
  if (typeof getTime !== "function") return "";
  const diff = (getTime as () => number).call(date) - now.getTime();
  const absDiff = Math.abs(diff);
  const isPast = diff < 0;

  const minutes = Math.floor(absDiff / (1000 * 60));
  const hours = Math.floor(absDiff / (1000 * 60 * 60));
  const days = Math.floor(absDiff / (1000 * 60 * 60 * 24));

  if (minutes < 1) return isPast ? "剛剛" : "即將";
  if (minutes < 60) return isPast ? `${minutes} 分鐘前` : `${minutes} 分鐘後`;
  if (hours < 24) return isPast ? `${hours} 小時前` : `${hours} 小時後`;
  if (days < 7) return isPast ? `${days} 天前` : `${days} 天後`;
  return date.toLocaleDateString();
}

export function formatCountdown(
  targetDate?: Date | null
): { days: number; hours: number; minutes: number; seconds: number; isExpired: boolean } {
  if (!isValidDate(targetDate)) {
    return { days: 0, hours: 0, minutes: 0, seconds: 0, isExpired: true };
  }
  const now = new Date();
  const getTime = (targetDate as { getTime?: unknown }).getTime;
  if (typeof getTime !== "function") {
    return { days: 0, hours: 0, minutes: 0, seconds: 0, isExpired: true };
  }
  const diff = (getTime as () => number).call(targetDate) - now.getTime();

  if (diff <= 0) {
    return { days: 0, hours: 0, minutes: 0, seconds: 0, isExpired: true };
  }

  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  const seconds = Math.floor((diff % (1000 * 60)) / 1000);

  return { days, hours, minutes, seconds, isExpired: false };
}

export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} 分鐘`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return mins > 0 ? `${hours} 小時 ${mins} 分鐘` : `${hours} 小時`;
}

export function isOpenNow(openTime: string, closeTime: string): boolean {
  const now = new Date();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();

  const [openH, openM] = openTime.split(":").map(Number);
  const [closeH, closeM] = closeTime.split(":").map(Number);

  const openMinutes = openH * 60 + openM;
  const closeMinutes = closeH * 60 + closeM;

  if (closeMinutes < openMinutes) {
    return currentMinutes >= openMinutes || currentMinutes < closeMinutes;
  }
  return currentMinutes >= openMinutes && currentMinutes < closeMinutes;
}

export function getTimeUntilClose(closeTime: string): number {
  const now = new Date();
  const [closeH, closeM] = closeTime.split(":").map(Number);
  const closeDate = new Date(now);
  closeDate.setHours(closeH, closeM, 0, 0);

  if (closeDate <= now) {
    closeDate.setDate(closeDate.getDate() + 1);
  }

  return Math.floor((closeDate.getTime() - now.getTime()) / (1000 * 60));
}

export function debounce<T extends (...args: any[]) => any>(fn: T, delay: number): T {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  return ((...args: Parameters<T>) => {
    if (timeoutId) clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn(...args), delay);
  }) as T;
}

export function formatFileSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

export function formatPrice(amount: number | null | undefined, currencySymbol: string = "$"): string {
  const safeAmount = typeof amount === "number" && Number.isFinite(amount) ? amount : 0;
  return `${currencySymbol}${safeAmount.toLocaleString("zh-TW")}`;
}

export function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 3) + "...";
}

export function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substring(2);
}
