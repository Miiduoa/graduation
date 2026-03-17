/**
 * Widget 類型定義
 */

export type WidgetSize = "small" | "medium" | "large";

export type WidgetFamily = 
  | "systemSmall"    // iOS 小型 (2x2)
  | "systemMedium"   // iOS 中型 (4x2)
  | "systemLarge"    // iOS 大型 (4x4)
  | "accessoryCircular"  // iOS 鎖定畫面圓形
  | "accessoryRectangular" // iOS 鎖定畫面矩形
  | "accessoryInline";  // iOS 鎖定畫面行內

export type WidgetType = 
  | "todaySchedule"
  | "nextClass"
  | "cafeteriaMenu"
  | "busArrival"
  | "library"
  | "eventCountdown"
  | "announcement"
  | "quickActions"
  | "grades"
  | "lostFound";

export interface WidgetConfig {
  type: WidgetType;
  title: string;
  description: string;
  supportedSizes: WidgetSize[];
  supportedFamilies: WidgetFamily[];
  refreshInterval: number; // 更新間隔（分鐘）
  requiresAuth: boolean;
}

export interface WidgetData {
  type: WidgetType;
  timestamp: string;
  data: unknown;
}

// 今日課表 Widget 資料
export interface TodayScheduleWidgetData extends WidgetData {
  type: "todaySchedule";
  data: {
    date: string;
    dayOfWeek: string;
    courses: Array<{
      id: string;
      name: string;
      time: string;
      location: string;
      instructor?: string;
      color?: string;
    }>;
    totalClasses: number;
  };
}

// 下一堂課 Widget 資料
export interface NextClassWidgetData extends WidgetData {
  type: "nextClass";
  data: {
    hasNextClass: boolean;
    course?: {
      id: string;
      name: string;
      startTime: string;
      endTime: string;
      location: string;
      instructor?: string;
      minutesUntilStart: number;
    };
    message?: string;
  };
}

// 餐廳菜單 Widget 資料
export interface CafeteriaMenuWidgetData extends WidgetData {
  type: "cafeteriaMenu";
  data: {
    cafeteriaName: string;
    mealType: "breakfast" | "lunch" | "dinner";
    items: Array<{
      id: string;
      name: string;
      price: number;
      calories?: number;
      imageUrl?: string;
    }>;
    isOpen: boolean;
    closingTime?: string;
  };
}

// 公車到站 Widget 資料
export interface BusArrivalWidgetData extends WidgetData {
  type: "busArrival";
  data: {
    stopName: string;
    arrivals: Array<{
      routeId: string;
      routeName: string;
      estimatedMinutes: number;
      vehicleId?: string;
      crowdLevel?: "low" | "medium" | "high" | "full";
    }>;
  };
}

// 圖書館 Widget 資料
export interface LibraryWidgetData extends WidgetData {
  type: "library";
  data: {
    borrowedCount: number;
    dueSoonCount: number;
    overdueCount: number;
    nearestDue?: {
      bookTitle: string;
      dueDate: string;
      daysRemaining: number;
    };
    availableSeats?: number;
  };
}

// 活動倒數 Widget 資料
export interface EventCountdownWidgetData extends WidgetData {
  type: "eventCountdown";
  data: {
    hasUpcoming: boolean;
    event?: {
      id: string;
      title: string;
      startsAt: string;
      location?: string;
      daysRemaining: number;
      hoursRemaining: number;
      minutesRemaining: number;
    };
  };
}

// 公告 Widget 資料
export interface AnnouncementWidgetData extends WidgetData {
  type: "announcement";
  data: {
    announcements: Array<{
      id: string;
      title: string;
      source?: string;
      publishedAt: string;
      isUrgent?: boolean;
    }>;
    unreadCount: number;
  };
}

// 快捷功能 Widget 資料
export interface QuickActionsWidgetData extends WidgetData {
  type: "quickActions";
  data: {
    actions: Array<{
      id: string;
      icon: string;
      label: string;
      deepLink: string;
    }>;
  };
}

// 成績 Widget 資料
export interface GradesWidgetData extends WidgetData {
  type: "grades";
  data: {
    currentGPA: number;
    semesterCredits: number;
    recentGrades: Array<{
      courseName: string;
      grade: string;
      publishedAt: string;
    }>;
  };
}

// 失物招領 Widget 資料
export interface LostFoundWidgetData extends WidgetData {
  type: "lostFound";
  data: {
    recentItems: Array<{
      id: string;
      type: "lost" | "found";
      title: string;
      category: string;
      date: string;
    }>;
    totalLost: number;
    totalFound: number;
  };
}

// 所有 Widget 資料類型聯合
export type AllWidgetData = 
  | TodayScheduleWidgetData
  | NextClassWidgetData
  | CafeteriaMenuWidgetData
  | BusArrivalWidgetData
  | LibraryWidgetData
  | EventCountdownWidgetData
  | AnnouncementWidgetData
  | QuickActionsWidgetData
  | GradesWidgetData
  | LostFoundWidgetData;
