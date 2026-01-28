import type { Announcement, ClubEvent, Course, CampusPoi, CafeteriaMenuItem } from "./index";

export const mockAnnouncements: Announcement[] = [
  {
    id: "a1",
    title: "開學重要通知：新生註冊流程",
    body: "這裡是示範公告內容。之後會改接 Firebase/學校系統。",
    publishedAt: new Date().toISOString(),
    source: "教務處"
  }
];

export const mockCourses: Course[] = [
  {
    id: "c1",
    name: "資料結構",
    teacher: "王老師",
    dayOfWeek: 2,
    startTime: "09:10",
    endTime: "10:00",
    location: "資訊大樓 305"
  }
];

export const mockClubEvents: ClubEvent[] = [
  {
    id: "e1",
    title: "迎新茶會",
    description: "社團迎新活動（示範資料）",
    startsAt: new Date(Date.now() + 86400000).toISOString(),
    endsAt: new Date(Date.now() + 90000000).toISOString(),
    location: "學生活動中心"
  }
];

export const mockPois: CampusPoi[] = [
  {
    id: "p1",
    name: "圖書館",
    category: "building",
    lat: 24.121,
    lng: 120.673,
    description: "示範座標（之後換成實際校園點位）"
  }
];

export const mockMenus: CafeteriaMenuItem[] = [
  {
    id: "m1",
    cafeteria: "第一餐廳",
    name: "雞腿便當",
    price: 80,
    availableOn: new Date().toISOString().slice(0, 10)
  }
];
