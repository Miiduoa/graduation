/**
 * Demo / 示範資料統一來源
 *
 * 用途：當 Firebase 未設定或對應資料尚未建立時，所有頁面都從這裡讀。
 * 重點：所有資料用 **同一套 courseId / clubId**，讓 demo 故事線可以
 *   首頁 → 課表 → 點某堂課 → 課程詳情 → 看成績 → 看公告
 * 完整貫通。
 *
 * 修這份檔的原則：
 *  - 課程 id 用 `c1` ~ `c8`
 *  - 社團 id 用 `club-1` ~ `club-6`
 *  - 學期代碼跟 grades 頁的 generateSemesters() 對齊（用最近一學期）
 */

import type {
  CourseWorkspace,
  CourseWorkspaceAssignment,
  CourseWorkspaceAttendanceSession,
  CourseWorkspaceGradebookRow,
  CourseWorkspaceModule,
  CourseWorkspacePost,
  CourseWorkspaceQuiz,
} from '@/lib/firebase';

// ──────────────────────────────────────────────────────────────
// 角色（demo 用，提供登入頁與課程權限用）
// ──────────────────────────────────────────────────────────────
export type DemoUserRole =
  | 'student'
  | 'teacher'
  | 'ta'
  | 'club_officer'
  | 'department_head'
  | 'admin'
  | 'alumni'
  | 'guest';

export interface DemoUser {
  uid: string;
  studentId?: string;
  email: string;
  displayName: string;
  role: DemoUserRole;
  department?: string;
  /** 額外資訊：例如教師所屬課程、社團幹部所屬社團 */
  affiliation?: string;
  password: string; // demo 用，正式環境不會這樣寫
}

export const DEMO_USERS: DemoUser[] = [
  {
    uid: 'demo-student-1',
    studentId: 'M11302001',
    email: 'm11302001@pu.edu.tw',
    displayName: '王小明',
    role: 'student',
    department: '資管系三年級',
    password: 'demo1234',
  },
  {
    uid: 'demo-teacher-1',
    email: 'wang@pu.edu.tw',
    displayName: '王大明 老師',
    role: 'teacher',
    department: '資訊管理系',
    affiliation: '資料結構 (c1) 課程教師',
    password: 'demo1234',
  },
  {
    uid: 'demo-ta-1',
    studentId: 'M11102008',
    email: 'ta.lin@pu.edu.tw',
    displayName: '林助教',
    role: 'ta',
    department: '資管系碩二',
    affiliation: '資料結構 (c1) 課程助教',
    password: 'demo1234',
  },
  {
    uid: 'demo-club-1',
    studentId: 'B11203015',
    email: 'club.chen@pu.edu.tw',
    displayName: '陳社長',
    role: 'club_officer',
    department: '資工系三年級',
    affiliation: '程式設計社 (club-1) 社長',
    password: 'demo1234',
  },
  {
    uid: 'demo-dept-1',
    email: 'dept.huang@pu.edu.tw',
    displayName: '黃主任',
    role: 'department_head',
    department: '資訊管理系系主任',
    affiliation: '資管系',
    password: 'demo1234',
  },
  {
    uid: 'demo-admin-1',
    email: 'admin@pu.edu.tw',
    displayName: '系統管理員',
    role: 'admin',
    department: '電子計算機中心',
    password: 'demo1234',
  },
  {
    uid: 'demo-alumni-1',
    studentId: 'B09203001',
    email: 'alumni.zhang@gmail.com',
    displayName: '張學長',
    role: 'alumni',
    department: '資管系 109 屆',
    affiliation: '已畢業，現為軟體工程師',
    password: 'demo1234',
  },
];

export function getDemoUser(role: DemoUserRole): DemoUser | undefined {
  return DEMO_USERS.find((u) => u.role === role);
}

export function getDemoUserByUid(uid: string): DemoUser | undefined {
  return DEMO_USERS.find((u) => u.uid === uid);
}

// ──────────────────────────────────────────────────────────────
// 課程（canonical source — 所有頁面從這裡讀）
// ──────────────────────────────────────────────────────────────
export interface DemoCourse {
  id: string; // c1, c2, ...
  code: string; // CS301, MATH201, ... — 對應成績冊
  name: string;
  instructor: string;
  instructorId: string;
  room: string;
  dayOfWeek: number; // 1=Mon..5=Fri
  startPeriod: number;
  endPeriod: number;
  color: string;
  icon: string;
  credits: number;
  members: number;
  unread: number;
  lastMessage: string;
  lastTime: string;
  description: string;
}

export const DEMO_COURSES: DemoCourse[] = [
  {
    id: 'c1',
    code: 'CS301',
    name: '資料結構',
    instructor: '王大明',
    instructorId: 'demo-teacher-1',
    room: '工程館 302',
    dayOfWeek: 1,
    startPeriod: 1,
    endPeriod: 2,
    color: '#5E6AD2',
    icon: '📘',
    credits: 3,
    members: 48,
    unread: 2,
    lastMessage: '下週考試範圍確認到第七章',
    lastTime: '5 分鐘前',
    description: '介紹基本資料結構（陣列、鏈結串列、樹、圖）與其演算法分析。',
  },
  {
    id: 'c2',
    code: 'MATH201',
    name: '線性代數',
    instructor: '陳小華',
    instructorId: 'demo-teacher-2',
    room: '理學院 201',
    dayOfWeek: 1,
    startPeriod: 5,
    endPeriod: 6,
    color: '#34C759',
    icon: '📐',
    credits: 3,
    members: 102,
    unread: 0,
    lastMessage: '第二次小考 5/22',
    lastTime: '1 小時前',
    description: '向量空間、線性映射、特徵值與其在工程與資工領域的應用。',
  },
  {
    id: 'c3',
    code: 'CS302',
    name: '作業系統',
    instructor: '李志明',
    instructorId: 'demo-teacher-3',
    room: '資工大樓 405',
    dayOfWeek: 2,
    startPeriod: 3,
    endPeriod: 4,
    color: '#FF9500',
    icon: '💻',
    credits: 3,
    members: 76,
    unread: 0,
    lastMessage: '第三次作業延期到週五',
    lastTime: '1 小時前',
    description: '行程管理、記憶體管理、檔案系統與並行控制原理。',
  },
  {
    id: 'c4',
    code: 'CS401',
    name: '計算機網路',
    instructor: '張美玲',
    instructorId: 'demo-teacher-4',
    room: '工程館 105',
    dayOfWeek: 2,
    startPeriod: 7,
    endPeriod: 8,
    color: '#007AFF',
    icon: '🌐',
    credits: 3,
    members: 68,
    unread: 0,
    lastMessage: '期末專題分組截止日 5/30',
    lastTime: '昨天',
    description: 'TCP/IP 五層模型、路由、傳輸層協定與網路安全基礎。',
  },
  {
    id: 'c5',
    code: 'MATH101',
    name: '微積分',
    instructor: '吳俊傑',
    instructorId: 'demo-teacher-5',
    room: '理學院 101',
    dayOfWeek: 3,
    startPeriod: 1,
    endPeriod: 3,
    color: '#FF3B30',
    icon: '∫',
    credits: 4,
    members: 120,
    unread: 0,
    lastMessage: '補充教材已上傳',
    lastTime: '2 天前',
    description: '極限、微分、積分與應用，配合工程與資工問題實作。',
  },
  {
    id: 'c6',
    code: 'ENG201',
    name: '英文寫作',
    instructor: 'Smith, J.',
    instructorId: 'demo-teacher-6',
    room: '語言中心 202',
    dayOfWeek: 4,
    startPeriod: 2,
    endPeriod: 3,
    color: '#BF5AF2',
    icon: '✍️',
    credits: 2,
    members: 32,
    unread: 1,
    lastMessage: 'Essay 2 due Friday',
    lastTime: '3 小時前',
    description: 'Academic writing fundamentals: structure, citation, revision.',
  },
  {
    id: 'c7',
    code: 'CS303',
    name: '資料庫系統',
    instructor: '劉建宏',
    instructorId: 'demo-teacher-7',
    room: '資工大樓 301',
    dayOfWeek: 4,
    startPeriod: 6,
    endPeriod: 7,
    color: '#32ADE6',
    icon: '🗄️',
    credits: 3,
    members: 54,
    unread: 0,
    lastMessage: '期中考成績已公布',
    lastTime: '昨天',
    description: '關聯式資料庫、SQL、正規化與交易處理。',
  },
  {
    id: 'c8',
    code: 'CS402',
    name: '軟體工程',
    instructor: '林宜珊',
    instructorId: 'demo-teacher-8',
    room: '工程館 204',
    dayOfWeek: 5,
    startPeriod: 4,
    endPeriod: 5,
    color: '#FF6B35',
    icon: '🛠️',
    credits: 3,
    members: 45,
    unread: 3,
    lastMessage: 'Sprint 3 review 5/26',
    lastTime: '剛剛',
    description: '需求分析、設計模式、敏捷流程與專案管理實務。',
  },
];

export function getDemoCourseById(id: string): DemoCourse | undefined {
  return DEMO_COURSES.find((c) => c.id === id);
}

// ──────────────────────────────────────────────────────────────
// 社團
// ──────────────────────────────────────────────────────────────
export interface DemoClub {
  id: string; // club-1, club-2, ...
  name: string;
  category: '學術' | '藝術' | '運動';
  members: number;
  unread: number;
  nextEvent: string;
  nextEventDate: string;
  description: string;
  color: string;
  icon: string;
  isJoined: boolean;
  lastMessage: string;
  lastTime: string;
}

export const DEMO_CLUBS: DemoClub[] = [
  {
    id: 'club-1',
    name: '程式設計社',
    category: '學術',
    members: 120,
    unread: 5,
    nextEvent: '黑客松',
    nextEventDate: '5/23 週六',
    description: '分享程式技術，舉辦競賽與 side project 工作坊。',
    color: '#5E6AD2',
    icon: '💻',
    isJoined: true,
    lastMessage: '本週五舉辦黑客松活動！',
    lastTime: '3 小時前',
  },
  {
    id: 'club-2',
    name: '攝影社',
    category: '藝術',
    members: 88,
    unread: 1,
    nextEvent: '春季外拍',
    nextEventDate: '5/24 週日',
    description: '攝影技巧分享與校園及戶外拍攝活動。',
    color: '#BF5AF2',
    icon: '📷',
    isJoined: false,
    lastMessage: '三月份外拍活動照片上傳啦',
    lastTime: '昨天',
  },
  {
    id: 'club-3',
    name: '登山社',
    category: '運動',
    members: 65,
    unread: 0,
    nextEvent: '雪山健行',
    nextEventDate: '6/1 週日',
    description: '台灣各大名山探訪，培養野外體能與生態知識。',
    color: '#34C759',
    icon: '⛰️',
    isJoined: false,
    lastMessage: '報名截止 5/28',
    lastTime: '2 天前',
  },
  {
    id: 'club-4',
    name: '創業研究社',
    category: '學術',
    members: 52,
    unread: 2,
    nextEvent: '創業沙龍',
    nextEventDate: '5/21 週四',
    description: '創業理念交流、商業計畫書撰寫與投資人對接。',
    color: '#FF9500',
    icon: '🚀',
    isJoined: false,
    lastMessage: '本週講者：某知名 startup CTO',
    lastTime: '1 天前',
  },
  {
    id: 'club-5',
    name: '管弦樂社',
    category: '藝術',
    members: 78,
    unread: 0,
    nextEvent: '春季音樂會',
    nextEventDate: '6/8 週日',
    description: '弦樂與管樂交流，每學期舉辦正式演奏會。',
    color: '#FF3B30',
    icon: '🎻',
    isJoined: false,
    lastMessage: '本週練習 19:00 開始',
    lastTime: '3 天前',
  },
  {
    id: 'club-6',
    name: '桌球社',
    category: '運動',
    members: 43,
    unread: 0,
    nextEvent: '社際盃',
    nextEventDate: '5/30 週六',
    description: '每週固定練習，積極參與校際桌球競賽。',
    color: '#007AFF',
    icon: '🏓',
    isJoined: false,
    lastMessage: '社際盃報名開放中',
    lastTime: '4 天前',
  },
];

export function getDemoClubById(id: string): DemoClub | undefined {
  return DEMO_CLUBS.find((c) => c.id === id);
}

// ──────────────────────────────────────────────────────────────
// 成績（與 DEMO_COURSES 共用 courseId）
// ──────────────────────────────────────────────────────────────
export interface DemoGrade {
  courseId: string; // 對應 DEMO_COURSES.id
  code: string;
  name: string;
  credits: number;
  grade: string;
  score: number;
  gpa: number;
  instructor: string;
  rank?: string;
}

export const DEMO_GRADES: DemoGrade[] = [
  {
    courseId: 'c1',
    code: 'CS301',
    name: '資料結構',
    credits: 3,
    grade: 'A+',
    score: 96,
    gpa: 4.3,
    instructor: '王大明',
    rank: '3/48',
  },
  {
    courseId: 'c2',
    code: 'MATH201',
    name: '線性代數',
    credits: 3,
    grade: 'A',
    score: 91,
    gpa: 4.0,
    instructor: '陳小華',
    rank: '8/102',
  },
  {
    courseId: 'c3',
    code: 'CS302',
    name: '作業系統',
    credits: 3,
    grade: 'A-',
    score: 88,
    gpa: 3.7,
    instructor: '李志明',
    rank: '12/76',
  },
  {
    courseId: 'c4',
    code: 'CS401',
    name: '計算機網路',
    credits: 3,
    grade: 'B+',
    score: 84,
    gpa: 3.3,
    instructor: '張美玲',
    rank: '22/68',
  },
  {
    courseId: 'c5',
    code: 'MATH101',
    name: '微積分',
    credits: 4,
    grade: 'B',
    score: 79,
    gpa: 3.0,
    instructor: '吳俊傑',
    rank: '35/120',
  },
  {
    courseId: 'c7',
    code: 'CS303',
    name: '資料庫系統',
    credits: 3,
    grade: 'A',
    score: 92,
    gpa: 4.0,
    instructor: '劉建宏',
    rank: '5/54',
  },
];

// ──────────────────────────────────────────────────────────────
// 公告（部分會綁到 courseId / clubId，讓「下一步」按鈕能跳轉）
// ──────────────────────────────────────────────────────────────
export interface DemoAnnouncement {
  id: string;
  title: string;
  body: string;
  publishedAt: string;
  source: string;
  category?: 'academic' | 'event' | 'general';
  pinned?: boolean;
  relatedCourseId?: string;
  relatedClubId?: string;
}

const now = Date.now();
const hoursAgo = (h: number) => new Date(now - h * 3600_000).toISOString();
const daysAgo = (d: number) => new Date(now - d * 86400_000).toISOString();

export const DEMO_ANNOUNCEMENTS: DemoAnnouncement[] = [
  {
    id: 'ann-1',
    title: '【重要】資料結構期中考試範圍公布',
    body: '本週五（5/22）09:00 於工程館 302 舉行期中考試，範圍涵蓋第 1-7 章，請務必準時到場。',
    publishedAt: hoursAgo(2),
    source: '王大明老師',
    category: 'academic',
    pinned: true,
    relatedCourseId: 'c1',
  },
  {
    id: 'ann-2',
    title: '程式設計社：本週五黑客松開放報名',
    body: '24 小時黑客松，獎金 NTD 30,000，限 6 人組隊，於程設社社團教室舉行。報名截止 5/21。',
    publishedAt: hoursAgo(5),
    source: '程式設計社',
    category: 'event',
    relatedClubId: 'club-1',
  },
  {
    id: 'ann-3',
    title: '作業系統第三次作業延期',
    body: '原訂 5/19 截止之第三次作業，延期至 5/23 23:59 截止。請同學把握時間完成。',
    publishedAt: hoursAgo(8),
    source: '李志明老師',
    category: 'academic',
    relatedCourseId: 'c3',
  },
  {
    id: 'ann-4',
    title: '【緊急】校園網路維護公告',
    body: '5/20 凌晨 02:00-04:00 進行校園網路設備維護，期間部分服務（含教學平台）可能無法使用。',
    publishedAt: daysAgo(1),
    source: '電算中心',
    category: 'general',
    pinned: true,
  },
  {
    id: 'ann-5',
    title: '計算機網路：期末專題分組截止提醒',
    body: '期末專題分組請於 5/30 前完成，每組 3-4 人，未組隊者將由系統隨機分配。',
    publishedAt: daysAgo(1),
    source: '張美玲老師',
    category: 'academic',
    relatedCourseId: 'c4',
  },
  {
    id: 'ann-6',
    title: '攝影社春季外拍活動',
    body: '本週日 5/24 早上 09:00 於後門集合，前往中社花卉中心進行春季外拍，自備相機。',
    publishedAt: daysAgo(2),
    source: '攝影社',
    category: 'event',
    relatedClubId: 'club-2',
  },
  {
    id: 'ann-7',
    title: '圖書館期末考週延長開放至 24:00',
    body: '配合期末考試，圖書館自 6/1 起延長開放時間至凌晨 24:00，閉館前 30 分鐘停止入館。',
    publishedAt: daysAgo(3),
    source: '圖書館',
    category: 'general',
  },
];

// ──────────────────────────────────────────────────────────────
// 課程詳情頁的 demo workspace
// 提供給 course/[courseId]/page.tsx，當 Firebase 沒資料時 fallback
// ──────────────────────────────────────────────────────────────
function buildDemoCourseWorkspace(course: DemoCourse): CourseWorkspace {
  const modules: CourseWorkspaceModule[] = [
    {
      id: `${course.id}-m1`,
      title: '第 1 週：課程簡介與環境設定',
      description: '介紹本課程的學習目標、評量方式與環境準備。',
      week: 1,
      order: 1,
      estimatedMinutes: 90,
      published: true,
      resourceCount: 3,
      resourceLabel: '簡報 + 影片',
    },
    {
      id: `${course.id}-m2`,
      title: '第 2 週：核心概念與基礎',
      description: '逐步建立核心概念與第一個實作。',
      week: 2,
      order: 2,
      estimatedMinutes: 90,
      published: true,
      resourceCount: 4,
      resourceLabel: '簡報 + 範例程式',
    },
    {
      id: `${course.id}-m3`,
      title: '第 3 週：實作練習與案例分析',
      description: '分析 2-3 個案例，並完成第一份練習。',
      week: 3,
      order: 3,
      estimatedMinutes: 60,
      published: true,
      resourceCount: 2,
      resourceLabel: '練習題',
    },
    {
      id: `${course.id}-m4`,
      title: '第 4 週：進階主題',
      description: '進入進階主題與業界實例。',
      week: 4,
      order: 4,
      estimatedMinutes: 90,
      published: false,
      resourceCount: 0,
    },
  ];

  const assignments: CourseWorkspaceAssignment[] = [
    {
      id: `${course.id}-hw1`,
      title: '作業一：基礎練習',
      description: '繳交基礎觀念練習題',
      dueAt: daysAgo(20),
      type: 'assignment',
      points: 100,
      weight: 0.15,
      gradesPublished: true,
      submissionCount: course.members - 2,
    },
    {
      id: `${course.id}-hw2`,
      title: '作業二：實作專題',
      description: '撰寫小型實作專題並繳交報告',
      dueAt: hoursAgo(-72),
      type: 'assignment',
      points: 100,
      weight: 0.25,
      gradesPublished: false,
      submissionCount: Math.floor(course.members * 0.4),
    },
  ];

  const quizzes: CourseWorkspaceQuiz[] = [
    {
      id: `${course.id}-q1`,
      title: '第一次小考',
      type: 'quiz',
      questionCount: 10,
      durationMinutes: 30,
      points: 50,
      weight: 0.1,
      dueAt: daysAgo(15),
      gradesPublished: true,
    },
    {
      id: `${course.id}-q2`,
      title: '期中考',
      type: 'exam',
      questionCount: 25,
      durationMinutes: 90,
      points: 100,
      weight: 0.3,
      dueAt: hoursAgo(-48),
      gradesPublished: false,
    },
  ];

  const attendance: CourseWorkspaceAttendanceSession[] = [
    {
      id: `${course.id}-att1`,
      active: false,
      attendeeCount: course.members - 3,
      startedAt: daysAgo(7),
      endedAt: daysAgo(7),
      attendanceMode: 'qr-code',
      source: 'attendance',
    },
    {
      id: `${course.id}-att2`,
      active: false,
      attendeeCount: course.members - 5,
      startedAt: daysAgo(0),
      endedAt: daysAgo(0),
      attendanceMode: 'qr-code',
      source: 'attendance',
    },
  ];

  const gradebookRows: CourseWorkspaceGradebookRow[] = Array.from({ length: course.members }).map(
    (_, i) => ({
      id: `${course.id}-row${i}`,
      finalScore: 60 + ((i * 7) % 40),
      published: i < Math.floor(course.members * 0.6),
      result: 'pass',
    }),
  );

  const posts: CourseWorkspacePost[] = [
    {
      id: `${course.id}-post1`,
      content: '本週上課內容請見教材模組第 3 週的影片與講義。',
      authorName: course.instructor,
      createdAt: hoursAgo(6),
    },
    {
      id: `${course.id}-post2`,
      content: `下一次點名會在 ${course.room}，請同學提早 5 分鐘到場。`,
      authorName: course.instructor,
      createdAt: daysAgo(2),
    },
  ];

  return {
    course: {
      id: course.id,
      name: course.name,
      description: course.description,
      type: 'course',
      courseId: course.id,
      memberCount: course.members,
      createdBy: course.instructorId,
      createdAt: daysAgo(60),
    },
    modules,
    assignments,
    quizzes,
    attendance,
    gradebookRows,
    posts,
  };
}

export function getDemoCourseWorkspace(courseId: string): CourseWorkspace | null {
  const course = getDemoCourseById(courseId);
  if (!course) return null;
  return buildDemoCourseWorkspace(course);
}

// ──────────────────────────────────────────────────────────────
// 歷史修課紀錄（大一上 ~ 大二下，每學期 5-6 門課）
// ──────────────────────────────────────────────────────────────
export type CreditCategory = 'required' | 'elective' | 'general' | 'pe' | 'other';

export interface HistoryCourse {
  code: string;
  name: string;
  credits: number;
  grade: string;
  score: number;
  gpa: number;
  category: CreditCategory;
  instructor: string;
}

export interface SemesterHistory {
  semester: string; // e.g. '111-1'
  label: string;   // e.g. '大一上'
  courses: HistoryCourse[];
  semesterGpa: number;
}

export const CREDIT_CATEGORIES: Record<CreditCategory, string> = {
  required: '必修',
  elective: '選修',
  general: '通識',
  pe: '體育',
  other: '其他',
};

export const DEMO_HISTORY_SEMESTERS: SemesterHistory[] = [
  {
    semester: '111-1',
    label: '大一上',
    semesterGpa: 3.42,
    courses: [
      { code: 'MATH001', name: '微積分（一）', credits: 4, grade: 'B+', score: 83, gpa: 3.3, category: 'required', instructor: '吳俊傑' },
      { code: 'CS001',   name: '計算機概論', credits: 3, grade: 'A-', score: 88, gpa: 3.7, category: 'required', instructor: '陳志遠' },
      { code: 'CS002',   name: '程式設計（一）', credits: 3, grade: 'A', score: 91, gpa: 4.0, category: 'required', instructor: '林宜珊' },
      { code: 'GE001',   name: '大學國文', credits: 2, grade: 'B', score: 78, gpa: 3.0, category: 'general', instructor: '劉美玲' },
      { code: 'GE002',   name: '英文（一）', credits: 2, grade: 'B+', score: 85, gpa: 3.3, category: 'general', instructor: 'Smith, J.' },
      { code: 'PE001',   name: '體育（一）', credits: 1, grade: 'A', score: 92, gpa: 4.0, category: 'pe', instructor: '體育組' },
    ],
  },
  {
    semester: '111-2',
    label: '大一下',
    semesterGpa: 3.58,
    courses: [
      { code: 'MATH002', name: '微積分（二）', credits: 4, grade: 'B', score: 79, gpa: 3.0, category: 'required', instructor: '吳俊傑' },
      { code: 'CS003',   name: '程式設計（二）', credits: 3, grade: 'A', score: 93, gpa: 4.0, category: 'required', instructor: '林宜珊' },
      { code: 'CS004',   name: '離散數學', credits: 3, grade: 'A-', score: 87, gpa: 3.7, category: 'required', instructor: '黃志文' },
      { code: 'GE003',   name: '英文（二）', credits: 2, grade: 'B+', score: 84, gpa: 3.3, category: 'general', instructor: 'Smith, J.' },
      { code: 'GE004',   name: '哲學與生命', credits: 2, grade: 'A-', score: 89, gpa: 3.7, category: 'general', instructor: '方正誠' },
      { code: 'PE002',   name: '體育（二）', credits: 1, grade: 'A', score: 94, gpa: 4.0, category: 'pe', instructor: '體育組' },
    ],
  },
  {
    semester: '112-1',
    label: '大二上',
    semesterGpa: 3.71,
    courses: [
      { code: 'CS101',   name: '資料結構', credits: 3, grade: 'A', score: 91, gpa: 4.0, category: 'required', instructor: '王大明' },
      { code: 'CS102',   name: '演算法', credits: 3, grade: 'A-', score: 88, gpa: 3.7, category: 'required', instructor: '陳志遠' },
      { code: 'MATH101', name: '線性代數', credits: 3, grade: 'B+', score: 84, gpa: 3.3, category: 'required', instructor: '陳小華' },
      { code: 'CS103',   name: '數位邏輯', credits: 3, grade: 'A', score: 92, gpa: 4.0, category: 'required', instructor: '張明宏' },
      { code: 'GE005',   name: '社會學概論', credits: 2, grade: 'A-', score: 87, gpa: 3.7, category: 'general', instructor: '趙瑋瑋' },
    ],
  },
  {
    semester: '112-2',
    label: '大二下',
    semesterGpa: 3.82,
    courses: [
      { code: 'CS201',   name: '作業系統', credits: 3, grade: 'A-', score: 88, gpa: 3.7, category: 'required', instructor: '李志明' },
      { code: 'CS202',   name: '計算機組織', credits: 3, grade: 'B+', score: 85, gpa: 3.3, category: 'required', instructor: '周志豪' },
      { code: 'CS203',   name: '物件導向程式設計', credits: 3, grade: 'A', score: 92, gpa: 4.0, category: 'required', instructor: '林宜珊' },
      { code: 'CS204',   name: '網頁程式設計', credits: 3, grade: 'A+', score: 96, gpa: 4.3, category: 'elective', instructor: '吳家豪' },
      { code: 'GE006',   name: '藝術鑑賞', credits: 2, grade: 'A', score: 90, gpa: 4.0, category: 'general', instructor: '葉子萱' },
    ],
  },
];

// 本學期（大三上）修課 — 對應 DEMO_COURSES
export const CURRENT_SEMESTER: SemesterHistory = {
  semester: '113-1',
  label: '大三上（本學期）',
  semesterGpa: 0, // 修習中，尚無成績
  courses: [
    { code: 'CS301', name: '資料結構', credits: 3, grade: '修習中', score: 0, gpa: 0, category: 'required', instructor: '王大明' },
    { code: 'MATH201', name: '線性代數', credits: 3, grade: '修習中', score: 0, gpa: 0, category: 'required', instructor: '陳小華' },
    { code: 'CS302', name: '作業系統', credits: 3, grade: '修習中', score: 0, gpa: 0, category: 'required', instructor: '李志明' },
    { code: 'CS401', name: '計算機網路', credits: 3, grade: '修習中', score: 0, gpa: 0, category: 'required', instructor: '張美玲' },
    { code: 'ENG201', name: '英文寫作', credits: 2, grade: '修習中', score: 0, gpa: 0, category: 'general', instructor: 'Smith, J.' },
    { code: 'CS303', name: '資料庫系統', credits: 3, grade: '修習中', score: 0, gpa: 0, category: 'required', instructor: '劉建宏' },
    { code: 'CS402', name: '軟體工程', credits: 3, grade: '修習中', score: 0, gpa: 0, category: 'required', instructor: '林宜珊' },
  ],
};

// ──────────────────────────────────────────────────────────────
// 下學期可選課程清單（含衝堂設計）
// ──────────────────────────────────────────────────────────────
export interface NextSemCourse {
  id: string;
  code: string;
  name: string;
  credits: number;
  category: CreditCategory;
  instructor: string;
  room: string;
  dayOfWeek: number; // 1=Mon..5=Fri
  startPeriod: number;
  endPeriod: number;
  description: string;
  /** 若與本學期某課衝堂，標注衝堂的 courseId */
  conflictsWith?: string;
  recommended?: boolean;
}

export const NEXT_SEM_COURSES: NextSemCourse[] = [
  {
    id: 'n1',
    code: 'CS501',
    name: '人工智慧導論',
    credits: 3,
    category: 'elective',
    instructor: '陳志遠',
    room: '工程館 403',
    dayOfWeek: 1,
    startPeriod: 3,
    endPeriod: 4,
    description: '機器學習、深度學習基礎與應用實例。',
    recommended: true,
  },
  {
    id: 'n2',
    code: 'CS502',
    name: '雲端運算與服務',
    credits: 3,
    category: 'elective',
    instructor: '吳家豪',
    room: '資工大樓 201',
    dayOfWeek: 2,
    startPeriod: 1,
    endPeriod: 2,
    description: 'AWS/GCP/Azure 架構、容器化與 DevOps 實務。',
    recommended: true,
  },
  {
    id: 'n3',
    code: 'CS503',
    name: '資訊安全',
    credits: 3,
    category: 'required',
    instructor: '周志豪',
    room: '工程館 205',
    dayOfWeek: 3,
    startPeriod: 5,
    endPeriod: 6,
    description: '密碼學、網路安全攻防、資安政策。',
    recommended: true,
  },
  {
    id: 'n4',
    code: 'CS504',
    name: '機器學習實務',
    credits: 3,
    category: 'elective',
    instructor: '陳志遠',
    room: '工程館 403',
    // 與 n1 人工智慧導論同一時段 → 衝堂
    dayOfWeek: 1,
    startPeriod: 3,
    endPeriod: 4,
    description: 'Scikit-learn、PyTorch 實作，期末 Kaggle 競賽專題。',
    conflictsWith: 'n1',
  },
  {
    id: 'n5',
    code: 'GE101',
    name: '科技與社會',
    credits: 2,
    category: 'general',
    instructor: '趙瑋瑋',
    room: '人文館 101',
    dayOfWeek: 4,
    startPeriod: 1,
    endPeriod: 2,
    description: '探討科技發展對社會、倫理的影響。',
    recommended: true,
  },
  {
    id: 'n6',
    code: 'CS505',
    name: '專題研究（一）',
    credits: 2,
    category: 'required',
    instructor: '王大明',
    room: '工程館 302',
    dayOfWeek: 5,
    startPeriod: 1,
    endPeriod: 2,
    description: '大三必修專題，指導教授帶領研究計畫。',
    recommended: true,
  },
  {
    id: 'n7',
    code: 'CS506',
    name: '行動應用程式開發',
    credits: 3,
    category: 'elective',
    instructor: '吳家豪',
    room: '資工大樓 201',
    // 與 n2 雲端運算同一時段 → 衝堂
    dayOfWeek: 2,
    startPeriod: 1,
    endPeriod: 2,
    description: 'React Native / Flutter 跨平台 App 開發實務。',
    conflictsWith: 'n2',
  },
  {
    id: 'n8',
    code: 'GE102',
    name: '環境永續與創新',
    credits: 2,
    category: 'general',
    instructor: '方正誠',
    room: '人文館 205',
    dayOfWeek: 4,
    startPeriod: 5,
    endPeriod: 6,
    description: '永續發展目標（SDGs）與綠色科技應用。',
  },
];

// ──────────────────────────────────────────────────────────────
// 畢業學分需求結構
// ──────────────────────────────────────────────────────────────
export interface GraduationRequirement {
  department: string;
  totalRequired: number;
  breakdown: Record<CreditCategory, number>;
}

export const GRADUATION_REQUIREMENTS: GraduationRequirement = {
  department: '資訊工程學系',
  totalRequired: 128,
  breakdown: {
    required: 64,
    elective: 32,
    general: 20,
    pe: 4,
    other: 8,
  },
};

/** 計算已修各類別學分（歷史 + 本學期修習中） */
export function computeEarnedCredits(): {
  total: number;
  byCategory: Record<CreditCategory, number>;
  historicalTotal: number;
  currentSemesterTotal: number;
} {
  const byCategory: Record<CreditCategory, number> = {
    required: 0,
    elective: 0,
    general: 0,
    pe: 0,
    other: 0,
  };

  let historicalTotal = 0;
  for (const sem of DEMO_HISTORY_SEMESTERS) {
    for (const c of sem.courses) {
      byCategory[c.category] += c.credits;
      historicalTotal += c.credits;
    }
  }

  return {
    total: historicalTotal,
    byCategory,
    historicalTotal,
    currentSemesterTotal: CURRENT_SEMESTER.courses.reduce((s, c) => s + c.credits, 0),
  };
}
