import type { Announcement, ClubEvent, Course, CampusPoi, CafeteriaMenuItem } from "./index";
import type { Department, Enrollment, GradRuleTemplate } from "./creditAudit";

// ===== Existing app mock data =====
export const mockAnnouncements: Announcement[] = [
  {
    id: "a1",
    title: "開學重要通知：新生註冊流程",
    body: "這裡是示範公告內容。之後會改接 Firebase/學校系統。",
    publishedAt: new Date().toISOString(),
    source: "教務處",
  },
];

export const mockCoursesLegacy: Course[] = [
  {
    id: "c1",
    name: "資料結構",
    teacher: "王老師",
    dayOfWeek: 2,
    startTime: "09:10",
    endTime: "10:00",
    location: "資訊大樓 305",
  },
];

export const mockClubEvents: ClubEvent[] = [
  {
    id: "e1",
    title: "迎新茶會",
    description: "社團迎新活動（示範資料）",
    startsAt: new Date(Date.now() + 86400000).toISOString(),
    endsAt: new Date(Date.now() + 90000000).toISOString(),
    location: "學生活動中心",
  },
];

export const mockPois: CampusPoi[] = [
  {
    id: "p1",
    name: "圖書館",
    category: "building",
    lat: 24.121,
    lng: 120.673,
    description: "示範座標（之後換成實際校園點位）",
  },
];

export const mockMenus: CafeteriaMenuItem[] = [
  {
    id: "m1",
    cafeteria: "第一餐廳",
    name: "雞腿便當",
    price: 80,
    availableOn: new Date().toISOString().slice(0, 10),
  },
];

// ===== New: Credit audit mock data (MVP v1) =====
export const mockDepartment: Department = {
  id: "dept-demo-cs",
  schoolId: "tw-demo-uni",
  name: "資訊工程系（示範）",
  programType: "university",
};

export const mockGradRuleTemplateV1: GradRuleTemplate = {
  id: "tpl-v1",
  name: "畢業規則模板 V1（最小五分類）",
  version: "2026.1",
  description: "必修/選修/通識/英文/其他必備",
  categories: [
    { key: "required", label: "必修" },
    { key: "elective", label: "選修" },
    { key: "general", label: "通識" },
    { key: "english", label: "英文" },
    { key: "other", label: "其他必備" },
  ],
  requirements: {
    totalCreditsRequired: 128,
    minByCategory: {
      required: 40,
      elective: 60,
      general: 20,
      english: 2,
      other: 1,
    },
  },
};

// course catalog for audit (separate from timetable Course type)
export const mockCourses: Array<import("./creditAudit").Course> = [
  { id: "ac1", departmentId: mockDepartment.id, code: "CS101", name: "計算機概論", credits: 3, category: "required" },
  { id: "ac2", departmentId: mockDepartment.id, code: "CS201", name: "資料結構", credits: 3, category: "required" },
  { id: "ac3", departmentId: mockDepartment.id, code: "GE101", name: "通識：哲學", credits: 2, category: "general" },
  { id: "ac4", departmentId: mockDepartment.id, code: "EN101", name: "英文（一）", credits: 2, category: "english" },
  { id: "ac5", departmentId: mockDepartment.id, code: "EL201", name: "選修：行動程式設計", credits: 3, category: "elective" },
  { id: "ac6", departmentId: mockDepartment.id, code: "OT001", name: "服務學習", credits: 1, category: "other" },
];

export const demoEnrollments: Enrollment[] = [
  { id: "en1", uid: "demo", courseId: "ac1", status: "completed", grade: 85 },
  { id: "en2", uid: "demo", courseId: "ac2", status: "completed", grade: 70 },
  { id: "en3", uid: "demo", courseId: "ac3", status: "completed", grade: 90 },
  { id: "en4", uid: "demo", courseId: "ac4", status: "completed", grade: 60 },
  { id: "en5", uid: "demo", courseId: "ac5", status: "completed", grade: 78 },
  { id: "en6", uid: "demo", courseId: "ac6", status: "completed", passed: true },
];
