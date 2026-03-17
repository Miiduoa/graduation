export function formatDateTime(input: string | number | Date | any) {
  try {
    const v: any = input as any;
    if (v == null) return "";

    // Firestore Timestamp (or Timestamp-like): { seconds, nanoseconds, toDate() }
    if (typeof v === "object") {
      if (typeof v.toDate === "function") {
        const d = v.toDate();
        if (d instanceof Date && !Number.isNaN(d.getTime())) return d.toLocaleString();
      }
      if (typeof v.seconds === "number") {
        const d = new Date(v.seconds * 1000);
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

export function toDate(input: any): Date | null {
  try {
    if (input == null) return null;
    if (typeof input.toDate === "function") return input.toDate();
    if (typeof input.seconds === "number") return new Date(input.seconds * 1000);
    const d = input instanceof Date ? input : new Date(input);
    return Number.isNaN(d.getTime()) ? null : d;
  } catch {
    return null;
  }
}

export function formatRelativeTime(date: Date): string {
  const now = new Date();
  const diff = date.getTime() - now.getTime();
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

export function formatCountdown(targetDate: Date): { days: number; hours: number; minutes: number; seconds: number; isExpired: boolean } {
  const now = new Date();
  const diff = targetDate.getTime() - now.getTime();

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
