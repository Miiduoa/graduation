/**
 * Widget 資料提供者
 * 負責為各種 Widget 提供資料
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import { getScopedStorageKey, makeScopedStoragePrefix } from "../services/scopedStorage";
import type {
  WidgetType,
  AllWidgetData,
  TodayScheduleWidgetData,
  NextClassWidgetData,
  CafeteriaMenuWidgetData,
  BusArrivalWidgetData,
  LibraryWidgetData,
  EventCountdownWidgetData,
  AnnouncementWidgetData,
  QuickActionsWidgetData,
  GradesWidgetData,
  LostFoundWidgetData,
} from "./types";

const WIDGET_CACHE_PREFIX = makeScopedStoragePrefix("widget-cache");
const WIDGET_CACHE_TTL = 5 * 60 * 1000; // 5 分鐘快取

interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

async function getCache<T>(key: string): Promise<T | null> {
  try {
    const cached = await AsyncStorage.getItem(key);
    if (!cached) return null;
    
    const entry: CacheEntry<T> = JSON.parse(cached);
    if (Date.now() - entry.timestamp > WIDGET_CACHE_TTL) {
      await AsyncStorage.removeItem(key);
      return null;
    }
    return entry.data;
  } catch {
    return null;
  }
}

async function setCache<T>(key: string, data: T): Promise<void> {
  try {
    const entry: CacheEntry<T> = { data, timestamp: Date.now() };
    await AsyncStorage.setItem(key, JSON.stringify(entry));
  } catch {
    // Ignore cache errors
  }
}

function makeWidgetCacheKey(
  scope: string,
  params: {
    userId?: string;
    schoolId?: string;
    extraKey?: string;
  } = {}
): string {
  return getScopedStorageKey("widget-cache", {
    uid: params.userId ?? null,
    schoolId: params.schoolId ?? null,
    scope: params.extraKey ? `${scope}-${params.extraKey}` : scope,
  });
}

function getDayOfWeek(date: Date): string {
  const days = ["日", "一", "二", "三", "四", "五", "六"];
  return `週${days[date.getDay()]}`;
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit" });
}

function getMinutesUntil(targetTime: string): number {
  const now = new Date();
  const [hours, minutes] = targetTime.split(":").map(Number);
  const target = new Date(now);
  target.setHours(hours, minutes, 0, 0);
  return Math.max(0, Math.floor((target.getTime() - now.getTime()) / 60000));
}

export async function getTodayScheduleData(
  userId: string,
  schoolId: string
): Promise<TodayScheduleWidgetData> {
  const cacheKey = makeWidgetCacheKey("todaySchedule", { userId, schoolId });
  const cached = await getCache<TodayScheduleWidgetData>(cacheKey);
  if (cached) return cached;

  const now = new Date();
  const dayOfWeek = now.getDay();

  // 模擬課表資料（實際應從 Firebase 取得）
  const mockCourses = [
    { id: "1", name: "微積分", time: "08:10-10:00", location: "理學院 101", color: "#4F46E5" },
    { id: "2", name: "程式設計", time: "10:20-12:10", location: "資工系 302", color: "#059669" },
    { id: "3", name: "資料結構", time: "14:10-16:00", location: "資工系 201", color: "#DC2626" },
  ].filter(() => dayOfWeek >= 1 && dayOfWeek <= 5); // 只有平日有課

  const data: TodayScheduleWidgetData = {
    type: "todaySchedule",
    timestamp: now.toISOString(),
    data: {
      date: now.toLocaleDateString("zh-TW"),
      dayOfWeek: getDayOfWeek(now),
      courses: dayOfWeek >= 1 && dayOfWeek <= 5 ? mockCourses : [],
      totalClasses: dayOfWeek >= 1 && dayOfWeek <= 5 ? mockCourses.length : 0,
    },
  };

  await setCache(cacheKey, data);
  return data;
}

export async function getNextClassData(
  userId: string,
  schoolId: string
): Promise<NextClassWidgetData> {
  const cacheKey = makeWidgetCacheKey("nextClass", { userId, schoolId });
  const cached = await getCache<NextClassWidgetData>(cacheKey);
  if (cached) return cached;

  const now = new Date();
  const currentHour = now.getHours();
  const dayOfWeek = now.getDay();

  // 模擬下一堂課資料
  let data: NextClassWidgetData;

  if (dayOfWeek === 0 || dayOfWeek === 6) {
    data = {
      type: "nextClass",
      timestamp: now.toISOString(),
      data: {
        hasNextClass: false,
        message: "今天沒有課程，好好休息！",
      },
    };
  } else if (currentHour >= 18) {
    data = {
      type: "nextClass",
      timestamp: now.toISOString(),
      data: {
        hasNextClass: false,
        message: "今天的課程已結束",
      },
    };
  } else {
    const nextStartTime = currentHour < 8 ? "08:10" : 
                          currentHour < 10 ? "10:20" :
                          currentHour < 14 ? "14:10" : "16:20";
    
    data = {
      type: "nextClass",
      timestamp: now.toISOString(),
      data: {
        hasNextClass: true,
        course: {
          id: "1",
          name: currentHour < 8 ? "微積分" : currentHour < 10 ? "程式設計" : "資料結構",
          startTime: nextStartTime,
          endTime: currentHour < 8 ? "10:00" : currentHour < 10 ? "12:10" : "16:00",
          location: currentHour < 8 ? "理學院 101" : currentHour < 10 ? "資工系 302" : "資工系 201",
          instructor: "王教授",
          minutesUntilStart: getMinutesUntil(nextStartTime),
        },
      },
    };
  }

  await setCache(cacheKey, data);
  return data;
}

export async function getCafeteriaMenuData(
  schoolId: string,
  cafeteriaId?: string
): Promise<CafeteriaMenuWidgetData> {
  const cacheKey = makeWidgetCacheKey("cafeteriaMenu", { schoolId, extraKey: cafeteriaId || "default" });
  const cached = await getCache<CafeteriaMenuWidgetData>(cacheKey);
  if (cached) return cached;

  const now = new Date();
  const currentHour = now.getHours();
  
  const mealType = currentHour < 10 ? "breakfast" : currentHour < 14 ? "lunch" : "dinner";
  const isOpen = currentHour >= 7 && currentHour < 20;

  const data: CafeteriaMenuWidgetData = {
    type: "cafeteriaMenu",
    timestamp: now.toISOString(),
    data: {
      cafeteriaName: "第一學生餐廳",
      mealType,
      items: [
        { id: "1", name: "招牌雞腿飯", price: 75, calories: 680 },
        { id: "2", name: "紅燒牛肉麵", price: 85, calories: 720 },
        { id: "3", name: "素食便當", price: 65, calories: 520 },
        { id: "4", name: "日式咖哩飯", price: 70, calories: 650 },
      ],
      isOpen,
      closingTime: isOpen ? "20:00" : undefined,
    },
  };

  await setCache(cacheKey, data);
  return data;
}

export async function getBusArrivalData(
  schoolId: string,
  stopId?: string
): Promise<BusArrivalWidgetData> {
  const cacheKey = makeWidgetCacheKey("busArrival", { schoolId, extraKey: stopId || "default" });
  const cached = await getCache<BusArrivalWidgetData>(cacheKey);
  if (cached) return cached;

  const now = new Date();

  const data: BusArrivalWidgetData = {
    type: "busArrival",
    timestamp: now.toISOString(),
    data: {
      stopName: "校門口站",
      arrivals: [
        { routeId: "1", routeName: "校園環線", estimatedMinutes: 3, crowdLevel: "medium" },
        { routeId: "2", routeName: "火車站接駁", estimatedMinutes: 8, crowdLevel: "low" },
        { routeId: "3", routeName: "宿舍專車", estimatedMinutes: 15, crowdLevel: "high" },
      ],
    },
  };

  await setCache(cacheKey, data);
  return data;
}

export async function getLibraryData(
  userId: string,
  schoolId: string
): Promise<LibraryWidgetData> {
  const cacheKey = makeWidgetCacheKey("library", { userId, schoolId });
  const cached = await getCache<LibraryWidgetData>(cacheKey);
  if (cached) return cached;

  const now = new Date();
  const dueDate = new Date(now);
  dueDate.setDate(dueDate.getDate() + 3);

  const data: LibraryWidgetData = {
    type: "library",
    timestamp: now.toISOString(),
    data: {
      borrowedCount: 4,
      dueSoonCount: 1,
      overdueCount: 0,
      nearestDue: {
        bookTitle: "演算法導論",
        dueDate: dueDate.toISOString(),
        daysRemaining: 3,
      },
      availableSeats: 42,
    },
  };

  await setCache(cacheKey, data);
  return data;
}

export async function getEventCountdownData(
  schoolId: string,
  userId?: string
): Promise<EventCountdownWidgetData> {
  const cacheKey = makeWidgetCacheKey("eventCountdown", { userId, schoolId });
  const cached = await getCache<EventCountdownWidgetData>(cacheKey);
  if (cached) return cached;

  const now = new Date();
  const eventDate = new Date(now);
  eventDate.setDate(eventDate.getDate() + 5);
  eventDate.setHours(14, 0, 0, 0);

  const diff = eventDate.getTime() - now.getTime();
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

  const data: EventCountdownWidgetData = {
    type: "eventCountdown",
    timestamp: now.toISOString(),
    data: {
      hasUpcoming: true,
      event: {
        id: "event1",
        title: "校慶園遊會",
        startsAt: eventDate.toISOString(),
        location: "校園廣場",
        daysRemaining: days,
        hoursRemaining: hours,
        minutesRemaining: minutes,
      },
    },
  };

  await setCache(cacheKey, data);
  return data;
}

export async function getAnnouncementData(
  schoolId: string
): Promise<AnnouncementWidgetData> {
  const cacheKey = makeWidgetCacheKey("announcement", { schoolId });
  const cached = await getCache<AnnouncementWidgetData>(cacheKey);
  if (cached) return cached;

  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);

  const data: AnnouncementWidgetData = {
    type: "announcement",
    timestamp: now.toISOString(),
    data: {
      announcements: [
        {
          id: "1",
          title: "113 學年度第二學期選課公告",
          source: "教務處",
          publishedAt: now.toISOString(),
          isUrgent: true,
        },
        {
          id: "2",
          title: "圖書館暑假開放時間調整",
          source: "圖書館",
          publishedAt: yesterday.toISOString(),
          isUrgent: false,
        },
        {
          id: "3",
          title: "校園網路維護通知",
          source: "資訊中心",
          publishedAt: yesterday.toISOString(),
          isUrgent: false,
        },
      ],
      unreadCount: 2,
    },
  };

  await setCache(cacheKey, data);
  return data;
}

export async function getQuickActionsData(): Promise<QuickActionsWidgetData> {
  const now = new Date();

  const data: QuickActionsWidgetData = {
    type: "quickActions",
    timestamp: now.toISOString(),
    data: {
      actions: [
        { id: "qr", icon: "qr-code", label: "QR 碼", deepLink: "campus://qrcode" },
        { id: "schedule", icon: "calendar", label: "課表", deepLink: "campus://schedule" },
        { id: "payment", icon: "wallet", label: "支付", deepLink: "campus://payment" },
        { id: "bus", icon: "bus", label: "公車", deepLink: "campus://bus" },
        { id: "library", icon: "book", label: "圖書館", deepLink: "campus://library" },
        { id: "ai", icon: "chatbubble", label: "AI 助理", deepLink: "campus://ai" },
      ],
    },
  };

  return data;
}

export async function getGradesData(
  userId: string,
  schoolId: string
): Promise<GradesWidgetData> {
  const cacheKey = makeWidgetCacheKey("grades", { userId, schoolId });
  const cached = await getCache<GradesWidgetData>(cacheKey);
  if (cached) return cached;

  const now = new Date();
  const lastWeek = new Date(now);
  lastWeek.setDate(lastWeek.getDate() - 7);

  const data: GradesWidgetData = {
    type: "grades",
    timestamp: now.toISOString(),
    data: {
      currentGPA: 3.75,
      semesterCredits: 18,
      recentGrades: [
        { courseName: "程式設計", grade: "A", publishedAt: lastWeek.toISOString() },
        { courseName: "微積分", grade: "A-", publishedAt: lastWeek.toISOString() },
      ],
    },
  };

  await setCache(cacheKey, data);
  return data;
}

export async function getLostFoundData(
  schoolId: string
): Promise<LostFoundWidgetData> {
  const cacheKey = makeWidgetCacheKey("lostFound", { schoolId });
  const cached = await getCache<LostFoundWidgetData>(cacheKey);
  if (cached) return cached;

  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);

  const data: LostFoundWidgetData = {
    type: "lostFound",
    timestamp: now.toISOString(),
    data: {
      recentItems: [
        { id: "1", type: "lost", title: "藍色悠遊卡", category: "wallet", date: now.toISOString() },
        { id: "2", type: "found", title: "黑色雨傘", category: "accessories", date: yesterday.toISOString() },
        { id: "3", type: "lost", title: "AirPods Pro", category: "electronics", date: yesterday.toISOString() },
      ],
      totalLost: 15,
      totalFound: 23,
    },
  };

  await setCache(cacheKey, data);
  return data;
}

// 統一的 Widget 資料獲取函數
export async function getWidgetData(
  type: WidgetType,
  params: {
    userId?: string;
    schoolId: string;
    extraParams?: Record<string, string>;
  }
): Promise<AllWidgetData> {
  const { userId, schoolId, extraParams } = params;

  switch (type) {
    case "todaySchedule":
      if (!userId) throw new Error("需要登入才能使用此 Widget");
      return getTodayScheduleData(userId, schoolId);
    
    case "nextClass":
      if (!userId) throw new Error("需要登入才能使用此 Widget");
      return getNextClassData(userId, schoolId);
    
    case "cafeteriaMenu":
      return getCafeteriaMenuData(schoolId, extraParams?.cafeteriaId);
    
    case "busArrival":
      return getBusArrivalData(schoolId, extraParams?.stopId);
    
    case "library":
      if (!userId) throw new Error("需要登入才能使用此 Widget");
      return getLibraryData(userId, schoolId);
    
    case "eventCountdown":
      return getEventCountdownData(schoolId, userId);
    
    case "announcement":
      return getAnnouncementData(schoolId);
    
    case "quickActions":
      return getQuickActionsData();
    
    case "grades":
      if (!userId) throw new Error("需要登入才能使用此 Widget");
      return getGradesData(userId, schoolId);
    
    case "lostFound":
      return getLostFoundData(schoolId);
    
    default:
      throw new Error(`未知的 Widget 類型: ${type}`);
  }
}

// 清除所有 Widget 快取
export async function clearWidgetCache(): Promise<void> {
  try {
    const keys = await AsyncStorage.getAllKeys();
    const widgetKeys = keys.filter(key => key.startsWith(WIDGET_CACHE_PREFIX));
    await AsyncStorage.multiRemove(widgetKeys);
  } catch {
    // Ignore errors
  }
}

// 刷新特定 Widget 資料
export async function refreshWidgetData(
  type: WidgetType,
  params: {
    userId?: string;
    schoolId: string;
    extraParams?: Record<string, string>;
  }
): Promise<AllWidgetData> {
  // 先清除該 Widget 的快取
  const cacheKey = makeWidgetCacheKey(type, { userId: params.userId, schoolId: params.schoolId });
  await AsyncStorage.removeItem(cacheKey);
  
  // 重新獲取資料
  return getWidgetData(type, params);
}
