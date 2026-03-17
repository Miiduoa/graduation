/**
 * Widget 配置
 */

import type { WidgetConfig, WidgetType } from "./types";

export const widgetConfigs: Record<WidgetType, WidgetConfig> = {
  todaySchedule: {
    type: "todaySchedule",
    title: "今日課表",
    description: "顯示今天的課程安排",
    supportedSizes: ["small", "medium", "large"],
    supportedFamilies: ["systemSmall", "systemMedium", "systemLarge"],
    refreshInterval: 60, // 每小時更新
    requiresAuth: true,
  },
  nextClass: {
    type: "nextClass",
    title: "下一堂課",
    description: "顯示即將到來的課程",
    supportedSizes: ["small", "medium"],
    supportedFamilies: ["systemSmall", "systemMedium", "accessoryRectangular"],
    refreshInterval: 15, // 每 15 分鐘更新
    requiresAuth: true,
  },
  cafeteriaMenu: {
    type: "cafeteriaMenu",
    title: "今日菜單",
    description: "顯示餐廳今日菜單",
    supportedSizes: ["medium", "large"],
    supportedFamilies: ["systemMedium", "systemLarge"],
    refreshInterval: 120, // 每 2 小時更新
    requiresAuth: false,
  },
  busArrival: {
    type: "busArrival",
    title: "公車到站",
    description: "顯示公車即時到站時間",
    supportedSizes: ["small", "medium"],
    supportedFamilies: ["systemSmall", "systemMedium", "accessoryRectangular"],
    refreshInterval: 5, // 每 5 分鐘更新
    requiresAuth: false,
  },
  library: {
    type: "library",
    title: "圖書館",
    description: "顯示借閱狀態與座位",
    supportedSizes: ["small", "medium"],
    supportedFamilies: ["systemSmall", "systemMedium", "accessoryCircular"],
    refreshInterval: 30, // 每 30 分鐘更新
    requiresAuth: true,
  },
  eventCountdown: {
    type: "eventCountdown",
    title: "活動倒數",
    description: "顯示即將到來的活動",
    supportedSizes: ["small", "medium"],
    supportedFamilies: ["systemSmall", "systemMedium", "accessoryRectangular", "accessoryInline"],
    refreshInterval: 60, // 每小時更新
    requiresAuth: false,
  },
  announcement: {
    type: "announcement",
    title: "最新公告",
    description: "顯示最新校園公告",
    supportedSizes: ["medium", "large"],
    supportedFamilies: ["systemMedium", "systemLarge"],
    refreshInterval: 30, // 每 30 分鐘更新
    requiresAuth: false,
  },
  quickActions: {
    type: "quickActions",
    title: "快捷功能",
    description: "常用功能快速入口",
    supportedSizes: ["small", "medium"],
    supportedFamilies: ["systemSmall", "systemMedium"],
    refreshInterval: 1440, // 每天更新
    requiresAuth: false,
  },
  grades: {
    type: "grades",
    title: "成績查詢",
    description: "顯示 GPA 與最新成績",
    supportedSizes: ["small", "medium"],
    supportedFamilies: ["systemSmall", "systemMedium", "accessoryCircular"],
    refreshInterval: 120, // 每 2 小時更新
    requiresAuth: true,
  },
  lostFound: {
    type: "lostFound",
    title: "失物招領",
    description: "顯示最新失物招領",
    supportedSizes: ["medium", "large"],
    supportedFamilies: ["systemMedium", "systemLarge"],
    refreshInterval: 60, // 每小時更新
    requiresAuth: false,
  },
};

export const defaultWidgets: WidgetType[] = [
  "nextClass",
  "cafeteriaMenu",
  "busArrival",
  "announcement",
];

export const getWidgetConfig = (type: WidgetType): WidgetConfig => {
  return widgetConfigs[type];
};

export const getAllWidgetConfigs = (): WidgetConfig[] => {
  return Object.values(widgetConfigs);
};

export const getWidgetsRequiringAuth = (): WidgetConfig[] => {
  return Object.values(widgetConfigs).filter(config => config.requiresAuth);
};

export const getWidgetsBySize = (size: "small" | "medium" | "large"): WidgetConfig[] => {
  return Object.values(widgetConfigs).filter(config => 
    config.supportedSizes.includes(size)
  );
};
