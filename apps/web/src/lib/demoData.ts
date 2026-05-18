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
    color: '#007AFF',
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
    color: '#007AFF',
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

// ──────────────────────────────────────────────────────────────
// 班級學生名單（教師端點名 / 成績冊共用）
// 資料結構 c1 有 48 位學生，此處列出前 12 位作為 demo 代表
// ──────────────────────────────────────────────────────────────
export interface DemoStudent {
  uid: string;
  studentId: string;
  displayName: string;
  email: string;
  /** 作業（3 次平均）/ 期中 / 期末 分數 */
  scores: { hw: number; mid: number; final: number };
}

export interface DemoStudentExtended extends DemoStudent {
  /** 該學生本學期選修課程 id（c1~c8 子集）— 用來在學生檔案頁顯示不一樣的修課單 */
  enrolledCourses: string[];
  /** 在資料結構（c1）班上的座號／群組（影響助教批改分組） */
  c1Group: 'first-half' | 'second-half';
  /** 學生屬性：高、中、低風險 — 影響學生檔案頁的 AI 摘要文案 */
  riskLevel: 'high' | 'mid' | 'low';
}

export const DEMO_STUDENTS: DemoStudentExtended[] = [
  // 1-12：所有人都選 c1（資料結構），其他課每人不一樣
  { uid: 'stu-001', studentId: 'M11302001', displayName: '王小明', email: 'm11302001@pu.edu.tw', scores: { hw: 95, mid: 96, final: 97 }, enrolledCourses: ['c1', 'c2', 'c3', 'c4', 'c6', 'c7', 'c8'], c1Group: 'first-half', riskLevel: 'low' },
  { uid: 'stu-002', studentId: 'M11302002', displayName: '陳雅婷', email: 'm11302002@pu.edu.tw', scores: { hw: 88, mid: 91, final: 89 }, enrolledCourses: ['c1', 'c2', 'c3', 'c5'], c1Group: 'first-half', riskLevel: 'low' },
  { uid: 'stu-003', studentId: 'M11302003', displayName: '林俊宏', email: 'm11302003@pu.edu.tw', scores: { hw: 72, mid: 68, final: 74 }, enrolledCourses: ['c1', 'c3', 'c4', 'c5'], c1Group: 'first-half', riskLevel: 'mid' },
  { uid: 'stu-004', studentId: 'M11302004', displayName: '黃美珍', email: 'm11302004@pu.edu.tw', scores: { hw: 90, mid: 88, final: 92 }, enrolledCourses: ['c1', 'c2', 'c4', 'c6', 'c7'], c1Group: 'first-half', riskLevel: 'low' },
  { uid: 'stu-005', studentId: 'M11302005', displayName: '張志偉', email: 'm11302005@pu.edu.tw', scores: { hw: 60, mid: 55, final: 58 }, enrolledCourses: ['c1', 'c3', 'c5'], c1Group: 'first-half', riskLevel: 'high' },
  { uid: 'stu-006', studentId: 'M11302006', displayName: '吳怡君', email: 'm11302006@pu.edu.tw', scores: { hw: 85, mid: 84, final: 86 }, enrolledCourses: ['c1', 'c2', 'c4', 'c5', 'c6'], c1Group: 'first-half', riskLevel: 'low' },
  { uid: 'stu-007', studentId: 'M11302007', displayName: '劉建宇', email: 'm11302007@pu.edu.tw', scores: { hw: 78, mid: 80, final: 76 }, enrolledCourses: ['c1', 'c3', 'c7', 'c8'], c1Group: 'second-half', riskLevel: 'mid' },
  { uid: 'stu-008', studentId: 'M11302008', displayName: '蔡雅芳', email: 'm11302008@pu.edu.tw', scores: { hw: 93, mid: 90, final: 94 }, enrolledCourses: ['c1', 'c2', 'c5', 'c6', 'c7', 'c8'], c1Group: 'second-half', riskLevel: 'low' },
  { uid: 'stu-009', studentId: 'M11302009', displayName: '許志明', email: 'm11302009@pu.edu.tw', scores: { hw: 66, mid: 70, final: 65 }, enrolledCourses: ['c1', 'c4', 'c5'], c1Group: 'second-half', riskLevel: 'mid' },
  { uid: 'stu-010', studentId: 'M11302010', displayName: '周曉雯', email: 'm11302010@pu.edu.tw', scores: { hw: 82, mid: 85, final: 83 }, enrolledCourses: ['c1', 'c2', 'c3', 'c5', 'c6'], c1Group: 'second-half', riskLevel: 'low' },
  { uid: 'stu-011', studentId: 'M11302011', displayName: '鄭國豪', email: 'm11302011@pu.edu.tw', scores: { hw: 75, mid: 72, final: 78 }, enrolledCourses: ['c1', 'c3', 'c4', 'c7'], c1Group: 'second-half', riskLevel: 'mid' },
  { uid: 'stu-012', studentId: 'M11302012', displayName: '簡佩君', email: 'm11302012@pu.edu.tw', scores: { hw: 88, mid: 92, final: 91 }, enrolledCourses: ['c1', 'c2', 'c5', 'c6', 'c8'], c1Group: 'second-half', riskLevel: 'low' },
];

/** 根據 courseId 取得該課程的學生名冊
 *
 *  注意：demo 場景只有 c1（資料結構）有完整 12 位學生；c2-c8 暫以 c1 學生
 *  的 enrolledCourses 篩選來模擬「不同課程不同名冊」，避免任何一門課都顯示
 *  相同 12 位學生的隱私問題。
 */
export function getStudentsForCourse(courseId: string): DemoStudentExtended[] {
  if (courseId === 'c1') return DEMO_STUDENTS;
  return DEMO_STUDENTS.filter((s) => s.enrolledCourses.includes(courseId));
}

/** 根據 studentId（M11302xxx）或 uid（stu-xxx）查詢 */
export function getDemoStudent(idOrUid: string): DemoStudentExtended | undefined {
  return DEMO_STUDENTS.find((s) => s.uid === idOrUid || s.studentId === idOrUid);
}

// ──────────────────────────────────────────────────────────────
// 圖書館借閱（與 AI 助理開場白同步）
// AI 開場白說「人月神話 2 天後到期」— 需與 library/page.tsx 的
// DEFAULT_BORROWED 第三本書一致（daysFromToday(2)）
// ──────────────────────────────────────────────────────────────
export const DEMO_LIBRARY_DUE_SOON_BOOK = '人月神話';   // AI 開場白提到的書名
export const DEMO_LIBRARY_DUE_SOON_DAYS = 2;            // 與 library page 的 daysFromToday(2) 一致
export const DEMO_LIBRARY_DUE_SOON_BOOK_ID = '3';       // 與 library/page.tsx DEFAULT_BORROWED[2].id 一致

// ──────────────────────────────────────────────────────────────
// 待審核公告共用資料（announcements + admin 頁共用）
// 用 localStorage key 'demoPendingAnn' 存取，模組只提供初始值
// ──────────────────────────────────────────────────────────────
export interface DemoPendingAnn {
  id: string;
  title: string;
  body?: string;
  source: string;
  submittedAt: string;
  /** 'teacher' | 'department_head' | 'club_officer' | 'admin' */
  submittedByRole: string;
}

/** 系統預設待審公告（硬編碼初始值） */
export const INITIAL_PENDING_ANNS: DemoPendingAnn[] = [
  { id: 'pa-1', title: '【待審】資管系畢業專題評分標準調整', source: '系所辦公室', submittedAt: '2 小時前', submittedByRole: 'department_head' },
  { id: 'pa-2', title: '【待審】2025 暑期實習合作廠商說明會', source: '產學合作中心', submittedAt: '4 小時前', submittedByRole: 'department_head' },
  { id: 'pa-3', title: '【待審】系友回娘家活動', source: '系學會', submittedAt: '昨天', submittedByRole: 'club_officer' },
];

const PENDING_ANN_KEY = 'demoPendingAnn';
const APPROVED_ANN_KEY = 'demoApprovedAnn';

/** 讀取目前所有待審公告（合併初始值 + 動態新增） */
export function readPendingAnns(): DemoPendingAnn[] {
  if (typeof window === 'undefined') return INITIAL_PENDING_ANNS;
  try {
    const raw = window.localStorage.getItem(PENDING_ANN_KEY);
    const extra: DemoPendingAnn[] = raw ? (JSON.parse(raw) as DemoPendingAnn[]) : [];
    const approvedRaw = window.localStorage.getItem(APPROVED_ANN_KEY);
    const approved: Set<string> = new Set(approvedRaw ? (JSON.parse(approvedRaw) as string[]) : []);
    const combined = [...INITIAL_PENDING_ANNS, ...extra].filter((a) => !approved.has(a.id));
    return combined;
  } catch {
    return INITIAL_PENDING_ANNS;
  }
}

/** 新增一則待審公告（教師 / 社團幹部發布後呼叫） */
export function addPendingAnn(ann: Omit<DemoPendingAnn, 'id'>): DemoPendingAnn {
  const newAnn: DemoPendingAnn = { ...ann, id: `pa-dyn-${Date.now()}` };
  if (typeof window === 'undefined') return newAnn;
  try {
    const raw = window.localStorage.getItem(PENDING_ANN_KEY);
    const extra: DemoPendingAnn[] = raw ? (JSON.parse(raw) as DemoPendingAnn[]) : [];
    extra.unshift(newAnn);
    window.localStorage.setItem(PENDING_ANN_KEY, JSON.stringify(extra));
    window.dispatchEvent(new CustomEvent('demoPendingAnnChange'));
  } catch { /* ignore */ }
  return newAnn;
}

/** 核准或退回一則待審公告 */
export function approvePendingAnn(id: string): void {
  if (typeof window === 'undefined') return;
  try {
    const raw = window.localStorage.getItem(APPROVED_ANN_KEY);
    const approved: string[] = raw ? (JSON.parse(raw) as string[]) : [];
    if (!approved.includes(id)) approved.push(id);
    window.localStorage.setItem(APPROVED_ANN_KEY, JSON.stringify(approved));
    window.dispatchEvent(new CustomEvent('demoPendingAnnChange'));
  } catch { /* ignore */ }
}

/** 清除 demo 待審狀態（測試用） */
export function resetPendingAnns(): void {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(PENDING_ANN_KEY);
  window.localStorage.removeItem(APPROVED_ANN_KEY);
}

// ──────────────────────────────────────────────────────────────
// 學生待繳作業（影響 AI 開場白 + 課程頁作業狀態）
// ──────────────────────────────────────────────────────────────
export type AssignmentStatus = 'pending' | 'submitted' | 'graded' | 'overdue';

export interface StudentAssignment {
  id: string;
  courseId: string;          // 對應 DEMO_COURSES.id
  courseName: string;
  title: string;
  due: string;               // YYYY-MM-DD
  status: AssignmentStatus;
  points?: number;
}

export const STUDENT_ASSIGNMENTS: StudentAssignment[] = [
  {
    id: 'a1',
    courseId: 'c1',
    courseName: '資料結構',
    title: '期末專題提案',
    due: '2026-05-20',
    status: 'pending',
    points: 100,
  },
  {
    id: 'a2',
    courseId: 'c3',
    courseName: '作業系統',
    title: 'Lab 5 實作',
    due: '2026-05-18',
    status: 'pending',
    points: 80,
  },
  {
    id: 'a3',
    courseId: 'c2',
    courseName: '線性代數',
    title: '演算法作業 3',
    due: '2026-05-15',
    status: 'submitted',
    points: 100,
  },
  {
    id: 'a4',
    courseId: 'c4',
    courseName: '計算機網路',
    title: '期末專題分組報告',
    due: '2026-05-30',
    status: 'pending',
    points: 150,
  },
  {
    id: 'a5',
    courseId: 'c8',
    courseName: '軟體工程',
    title: 'Sprint 3 Review 報告',
    due: '2026-05-26',
    status: 'pending',
    points: 100,
  },
];

/** 取得 pending 狀態的作業（未繳），按截止日排序 */
export function getPendingAssignments(): StudentAssignment[] {
  return STUDENT_ASSIGNMENTS
    .filter((a) => a.status === 'pending')
    .sort((a, b) => a.due.localeCompare(b.due));
}

// ──────────────────────────────────────────────────────────────
// 社團近期活動（影響 AI 開場白 + 社團頁）
// ──────────────────────────────────────────────────────────────
export interface ClubActivity {
  clubId: string;            // 對應 DEMO_CLUBS.id
  clubName: string;
  title: string;
  date: string;              // YYYY-MM-DD
  location: string;
  registrationDeadline?: string;
}

export const CLUB_ACTIVITIES: ClubActivity[] = [
  {
    clubId: 'club-1',
    clubName: '程式設計社',
    title: '黑客松報名截止',
    date: '2026-05-19',
    location: '工程館 B101',
    registrationDeadline: '2026-05-19',
  },
  {
    clubId: 'club-1',
    clubName: '程式設計社',
    title: '24 小時黑客松',
    date: '2026-05-23',
    location: '工程館 B101',
  },
  {
    clubId: 'club-1',
    clubName: '程式設計社',
    title: '期末成果展示',
    date: '2026-06-05',
    location: '活動中心大廳',
  },
  {
    clubId: 'club-2',
    clubName: '攝影社',
    title: '春季外拍',
    date: '2026-05-24',
    location: '中社花卉中心',
  },
];

// ──────────────────────────────────────────────────────────────
// 教師待批改作業（影響 AI 開場白 + 教師端成績冊）
// ──────────────────────────────────────────────────────────────
export type ReviewStatus = 'submitted' | 'grading' | 'graded';

export interface TeacherPendingReview {
  studentId: string;
  studentName: string;
  assignmentTitle: string;
  courseId: string;
  submittedAt: string;       // 人類可讀時間
  status: ReviewStatus;
}

export const TEACHER_PENDING_REVIEWS: TeacherPendingReview[] = [
  { studentId: 'stu-001', studentName: '王小明',  assignmentTitle: '作業二：實作專題', courseId: 'c1', submittedAt: '2026-05-14 14:22', status: 'submitted' },
  { studentId: 'stu-002', studentName: '陳雅婷',  assignmentTitle: '作業二：實作專題', courseId: 'c1', submittedAt: '2026-05-14 16:05', status: 'submitted' },
  { studentId: 'stu-003', studentName: '林俊宏',  assignmentTitle: '作業二：實作專題', courseId: 'c1', submittedAt: '2026-05-15 09:11', status: 'submitted' },
  { studentId: 'stu-004', studentName: '黃美珍',  assignmentTitle: '作業二：實作專題', courseId: 'c1', submittedAt: '2026-05-15 11:47', status: 'grading' },
  { studentId: 'stu-005', studentName: '張志偉',  assignmentTitle: '作業二：實作專題', courseId: 'c1', submittedAt: '2026-05-15 23:58', status: 'submitted' },
];

// ──────────────────────────────────────────────────────────────
// 訊息系統（Demo inbox — 每個角色各有 3-5 則示範訊息）
// ──────────────────────────────────────────────────────────────
export interface DemoMessage {
  id: string;
  /** 寄件人顯示名稱 */
  fromName: string;
  /** 寄件人 emoji 頭像 */
  fromAvatar: string;
  /** 主旨 */
  subject: string;
  /** 完整內容 */
  body: string;
  /** 送出時間（人類可讀） */
  sentAt: string;
  /** 是否已讀 */
  isRead: boolean;
  /** 訊息類型（影響 icon / 色調） */
  type: 'info' | 'warning' | 'action' | 'success';
  /** 關聯課程（按鈕跳轉） */
  relatedCourseId?: string;
  /** 關聯社團 */
  relatedClubId?: string;
  /** 關聯公告 */
  relatedAnnouncementId?: string;
  /** 哪些角色收得到這則訊息 */
  recipientRoles: DemoUserRole[];
}

/** Demo 訊息全量資料（按角色過濾使用） */
export const DEMO_MESSAGES: DemoMessage[] = [
  // ── 學生（王小明）收件匣 ──
  {
    id: 'msg-s1',
    fromName: '王大明 老師',
    fromAvatar: '🧑‍🏫',
    subject: '【重要】資料結構期末專題截止提醒',
    body: '王小明同學你好，\n\n提醒你「資料結構期末專題提案」截止日為 2026-05-20（三）23:59，請務必在期限前透過課程頁面繳交。\n\n如對題目有疑問，歡迎在截止前三天前預約辦公室時間（工程館 308，週二 14:00-17:00）。\n\n祝學習順利！\n王大明 敬上',
    sentAt: '2 小時前',
    isRead: false,
    type: 'warning',
    relatedCourseId: 'c1',
    recipientRoles: ['student'],
  },
  {
    id: 'msg-s2',
    fromName: '李志明 老師',
    fromAvatar: '🧑‍🏫',
    subject: '【作業系統】第三次作業截止日延期通知',
    body: '各位同學，\n\n第三次作業（Lab 5 實作）截止日由 5/19 延期至 **5/23 23:59**，請把握時間完成。\n\n延期原因：本週提前公告未達 72 小時，基於公平原則給予延期。\n\n繳交連結請見課程頁。\n\n李志明 敬上',
    sentAt: '8 小時前',
    isRead: false,
    type: 'action',
    relatedCourseId: 'c3',
    recipientRoles: ['student'],
  },
  {
    id: 'msg-s3',
    fromName: '程式設計社',
    fromAvatar: '💻',
    subject: '【程式設計社】黑客松報名即將截止（明天 23:59）',
    body: '社員你好！\n\n2026 年度黑客松活動報名截止日為 **2026-05-19 23:59**，名額僅剩 4 組！\n\n活動資訊：\n- 時間：2026-05-23（六）09:00 起\n- 地點：工程館 B101\n- 形式：24 小時不限主題黑客松\n- 獎金：NTD 30,000（第一名）\n\n如尚未報名，請立即前往社團頁面！',
    sentAt: '5 小時前',
    isRead: true,
    type: 'info',
    relatedClubId: 'club-1',
    recipientRoles: ['student'],
  },
  {
    id: 'msg-s4',
    fromName: '陳小華 老師',
    fromAvatar: '🧑‍🏫',
    subject: '【線性代數】第二次小考 5/22 提醒',
    body: '同學你好，\n\n提醒本週四（5/22）13:10 在理學院 201 進行第二次小考，考試範圍為第 6-9 章（行列式、特徵值與特徵向量）。\n\n考試時長 40 分鐘，帶好學生證與文具。\n\n祝考試順利！',
    sentAt: '昨天',
    isRead: true,
    type: 'info',
    relatedCourseId: 'c2',
    recipientRoles: ['student'],
  },
  {
    id: 'msg-s5',
    fromName: '張美玲 老師',
    fromAvatar: '🧑‍🏫',
    subject: '【計算機網路】期末專題分組截止提醒',
    body: '各位選課學生，\n\n計算機網路期末專題分組截止日為 **2026-05-30**，每組 3-4 人，請自行組隊後在課程系統填寫組別資訊。\n\n未完成組隊者，系統將於截止後自動隨機分配，請盡快確認。\n\n張美玲 敬上',
    sentAt: '昨天',
    isRead: false,
    type: 'warning',
    relatedCourseId: 'c4',
    recipientRoles: ['student'],
  },

  // ── 教師（王大明）收件匣 ──
  {
    id: 'msg-t1',
    fromName: '王小明（M11302001）',
    fromAvatar: '👩‍🎓',
    subject: '關於資料結構期末專題的問題',
    body: '王大明老師好，\n\n我是資料結構的學生王小明，想請教關於期末專題提案的問題：\n\n1. 題目可以自訂嗎？還是必須從老師提供的清單選？\n2. 提案報告格式有要求嗎？（頁數、字型等）\n3. 可以兩人組隊還是必須單人？\n\n謝謝老師！',
    sentAt: '1 小時前',
    isRead: false,
    type: 'action',
    relatedCourseId: 'c1',
    recipientRoles: ['teacher'],
  },
  {
    id: 'msg-t2',
    fromName: '課程系統',
    fromAvatar: '🔔',
    subject: '【資料結構】作業二已收到 5 份提交，待批改',
    body: '資料結構（CS301）作業二「實作專題」共有 5 位學生完成提交：\n\n- 王小明（2026-05-14 14:22）\n- 陳雅婷（2026-05-14 16:05）\n- 林俊宏（2026-05-15 09:11）\n- 黃美珍（2026-05-15 11:47）\n- 張志偉（2026-05-15 23:58）\n\n請前往課程成績冊進行批改，建議於 5/30 前完成。教師可分派部分批改任務給助教（林助教）。',
    sentAt: '30 分鐘前',
    isRead: false,
    type: 'action',
    relatedCourseId: 'c1',
    recipientRoles: ['teacher', 'ta'],
  },
  {
    id: 'msg-t3',
    fromName: '林助教',
    fromAvatar: '🧑‍💻',
    subject: '作業批改進度回報：已完成前 3 份',
    body: '王老師好，\n\n報告批改進度：已完成作業二前 3 份（王小明、陳雅婷、林俊宏），評語與分數已填入成績冊。\n\n林俊宏同學有一題邏輯錯誤，已附評語建議修改。\n\n其餘 2 份（黃美珍、張志偉）預計明天前完成，請老師最後審閱後發布成績。\n\n林助教 敬上',
    sentAt: '3 小時前',
    isRead: true,
    type: 'success',
    relatedCourseId: 'c1',
    recipientRoles: ['teacher'],
  },
  {
    id: 'msg-t4',
    fromName: '系統通知',
    fromAvatar: '✅',
    subject: '你發布的公告「期中考試範圍公布」已獲系主任核准',
    body: '通知你：\n\n你在 2026-05-17 提交的課程公告「【重要】資料結構期中考試範圍公布」已由系主任（黃主任）核准，現已正式對選課學生公開。\n\n48 位選課學生已收到通知。',
    sentAt: '昨天',
    isRead: true,
    type: 'success',
    relatedAnnouncementId: 'ann-1',
    recipientRoles: ['teacher'],
  },

  // ── 助教（林助教）收件匣 ──
  {
    id: 'msg-a1',
    fromName: '王大明 老師',
    fromAvatar: '🧑‍🏫',
    subject: '請協助批改資料結構作業二（第 11-20 號學生）',
    body: '林助教你好，\n\n麻煩你協助批改作業二「實作專題」第 11-20 號學生的提交，批改規則如下：\n\n- 正確性 50 分（程式碼能執行且輸出正確）\n- 程式碼品質 30 分（可讀性、命名規範）\n- 報告撰寫 20 分（說明清楚、有截圖）\n\n請在 2026-05-17 前完成並填入成績冊，我會再最終審閱。\n\n謝謝你的協助！\n王大明',
    sentAt: '30 分鐘前',
    isRead: false,
    type: 'action',
    relatedCourseId: 'c1',
    recipientRoles: ['ta'],
  },
  {
    id: 'msg-a2',
    fromName: '課程系統',
    fromAvatar: '🔔',
    subject: '助教批改權限已開通：資料結構（CS301）',
    body: '你已被指定為資料結構（CS301）課程助教，以下權限已開通：\n\n✅ 查看學生作業提交\n✅ 填寫批改分數與評語\n✅ 查看成績冊\n\n⛔ 以下權限僅限授課教師操作：\n- 發布成績（讓學生看見）\n- 修改課程設定\n- 管理教材模組\n\n如有問題請聯絡課程負責人王大明老師。',
    sentAt: '2 天前',
    isRead: true,
    type: 'info',
    relatedCourseId: 'c1',
    recipientRoles: ['ta'],
  },
  {
    id: 'msg-a3',
    fromName: '王小明（M11302001）',
    fromAvatar: '👩‍🎓',
    subject: '請問作業二第三題的評分標準？',
    body: '林助教你好，\n\n我想請問作業二第三題（鏈結串列反轉）的評分標準：\n\n我用遞迴實作，但老師課堂上示範的是迭代，這樣算不算符合要求？輸出是正確的，但不知道方法不同會不會被扣分。\n\n謝謝助教！\n王小明',
    sentAt: '45 分鐘前',
    isRead: false,
    type: 'action',
    relatedCourseId: 'c1',
    recipientRoles: ['ta'],
  },

  // ── 社團幹部（陳社長）收件匣 ──
  {
    id: 'msg-c1',
    fromName: '課程系統',
    fromAvatar: '🔔',
    subject: '【程式設計社】3 位新成員申請入社',
    body: '程式設計社最新入社申請（共 3 位）：\n\n1. 李宇欣（資管系大一，B11302088）\n2. 張博文（資工系大二，B11202044）\n3. 陳怡萱（電機系大一，B11305012）\n\n注意：上述為新申請者個資，請至「管理成員」頁面進行審核，並遵守學生個資保護原則（僅限社團幹部本人查看）。',
    sentAt: '1 小時前',
    isRead: false,
    type: 'action',
    relatedClubId: 'club-1',
    recipientRoles: ['club_officer'],
  },
  {
    id: 'msg-c2',
    fromName: '校學生活動中心',
    fromAvatar: '🏫',
    subject: '黑客松場地使用確認：工程館 B101',
    body: '陳社長您好，\n\n2026-05-23（六）09:00 至 2026-05-24（日）09:00 工程館 B101 場地預訂已確認核准。\n\n注意事項：\n- 活動前一天請至場控室領取鑰匙\n- 活動後需恢復原狀並填寫場地使用紀錄表\n- 活動期間禁止大聲喧嘩（22:00 後）\n\n如有問題請洽學生事務處（分機 1234）。',
    sentAt: '昨天',
    isRead: true,
    type: 'success',
    relatedClubId: 'club-1',
    recipientRoles: ['club_officer'],
  },
  {
    id: 'msg-c3',
    fromName: '系統通知',
    fromAvatar: '✅',
    subject: '黑客松活動公告已獲核准並對外公開',
    body: '你提交的社團公告「程式設計社：本週五黑客松開放報名」已獲系主任核准，現已向全校學生公開。\n\n目前共有 18 組報名，距滿額（20 組）還剩 2 組名額。',
    sentAt: '2 天前',
    isRead: true,
    type: 'success',
    relatedClubId: 'club-1',
    recipientRoles: ['club_officer'],
  },

  // ── 系主任（黃主任）收件匣 ──
  {
    id: 'msg-d1',
    fromName: '公告審核系統',
    fromAvatar: '⏳',
    subject: '3 則公告待你審核',
    body: '目前有 3 則公告待你審核，請盡快處理：\n\n1. 【待審】資管系畢業專題評分標準調整（系所辦公室，2 小時前）\n2. 【待審】2025 暑期實習合作廠商說明會（產學合作中心，4 小時前）\n3. 【待審】系友回娘家活動（系學會，昨天）\n\n請前往管理後台進行審核。',
    sentAt: '2 小時前',
    isRead: false,
    type: 'warning',
    recipientRoles: ['department_head'],
  },
  {
    id: 'msg-d2',
    fromName: '林宜珊 老師',
    fromAvatar: '🧑‍🏫',
    subject: '教師基本資料已提交，請審核',
    body: '黃主任您好，\n\n本人林宜珊已完成教師基本資料更新，包含：\n- 個人學術著作清單（新增 3 篇）\n- 兼職申報表\n- 新學年授課意願表\n\n煩請撥冗審核，謝謝！\n林宜珊 敬上',
    sentAt: '昨天',
    isRead: false,
    type: 'action',
    recipientRoles: ['department_head'],
  },
  {
    id: 'msg-d3',
    fromName: '系統報表',
    fromAvatar: '📊',
    subject: '本週系所課程統計報表已生成',
    body: '本週（2026-05-11 ～ 2026-05-17）資訊管理系統計摘要：\n\n- 本週課程總節數：47 節\n- 平均出席率：94.2%\n- 作業繳交率：88.7%\n- 已登錄成績課程：12 門 / 全學期 34 門\n\n完整報表已匯出 Excel，請前往系統後台下載。',
    sentAt: '今天 08:00',
    isRead: true,
    type: 'info',
    recipientRoles: ['department_head'],
  },

  // ── 管理員收件匣 ──
  {
    id: 'msg-ad1',
    fromName: '資安監控系統',
    fromAvatar: '🛡️',
    subject: '⚠️ 異常登入嘗試偵測（來自境外 IP）',
    body: '系統偵測到異常活動：\n\n- 時間：2026-05-17 09:23\n- 事件：5 次登入失敗嘗試\n- 來源 IP：185.220.101.xx（荷蘭，Tor 出口節點）\n- 目標帳號：admin@pu.edu.tw\n\n建議措施：\n1. 確認帳號密碼無外洩\n2. 啟用雙因子驗證\n3. 加入該 IP 段至封鎖清單\n\n[前往管理後台處理]',
    sentAt: '30 分鐘前',
    isRead: false,
    type: 'warning',
    recipientRoles: ['admin'],
  },
  {
    id: 'msg-ad2',
    fromName: '備份系統',
    fromAvatar: '💾',
    subject: '每日備份完成（1.2GB）',
    body: '每日例行備份已完成：\n\n- 時間：2026-05-17 03:00\n- 備份大小：1.2 GB\n- 備份目的地：AWS S3（ap-northeast-1）\n- 資料保存期：30 天\n- 狀態：成功 ✅\n\n如需下載備份請前往系統管理後台。',
    sentAt: '今天 03:00',
    isRead: true,
    type: 'success',
    recipientRoles: ['admin'],
  },
  {
    id: 'msg-ad3',
    fromName: '系統監控',
    fromAvatar: '📡',
    subject: 'API 速率警告：tronclass-proxy 超出 80%',
    body: 'tronclass-proxy 服務在過去 1 小時（09:00-10:00）請求數達到速率限制的 83%。\n\n詳情：\n- 實際請求數：4,150 次 / 小時\n- 速率限制上限：5,000 次 / 小時\n- 峰值時間：09:30-09:45\n\n如持續增加，建議考慮：\n- 啟用快取層\n- 升級 API 方案',
    sentAt: '1 小時前',
    isRead: false,
    type: 'warning',
    recipientRoles: ['admin'],
  },

  // ── 校友（張學長）收件匣 ──
  {
    id: 'msg-al1',
    fromName: '資管系學生會',
    fromAvatar: '🎓',
    subject: '系友回娘家活動邀請（2026/06/15）',
    body: '張學長您好！\n\n誠摯邀請您參加「資管系 109 屆系友回娘家」活動：\n\n📅 時間：2026-06-15（日）13:00 ～ 17:00\n📍 地點：靜宜大學學生活動中心 3F\n🍱 餐點：自助下午茶\n🎤 活動：現任師生分享、業界交流座談\n\n請於 6/10 前填寫報名表（詳見附件連結）。\n\n期待與你相聚！',
    sentAt: '昨天',
    isRead: true,
    type: 'info',
    recipientRoles: ['alumni'],
  },
];

/** 根據角色取得對應收件匣訊息（按時間倒序）
 *
 * 嚴格隱私規則：
 *   1. 訪客（guest）一律拿不到任何訊息 — guest 應被 messages 頁直接攔截，
 *      但這裡作為第二道防線。
 *   2. 只有 recipientRoles 明確包含當前角色才回傳，避免 fall-through 顯示
 *      不屬於自己的訊息（例如教師看到學生的「課程系統」內部通知）。
 */
export function getMessagesForRole(role: DemoUserRole): DemoMessage[] {
  if (role === 'guest') return [];
  return DEMO_MESSAGES.filter((m) => m.recipientRoles.includes(role));
}

/** 取得某角色的未讀訊息數量 */
export function getUnreadCountForRole(role: DemoUserRole): number {
  return DEMO_MESSAGES.filter((m) => m.recipientRoles.includes(role) && !m.isRead).length;
}

// ──────────────────────────────────────────────────────────────
// 即將到來的考試（影響 AI 開場白 + 課程頁）
// ──────────────────────────────────────────────────────────────
export interface UpcomingExam {
  courseId: string;
  courseName: string;
  title: string;
  date: string;              // YYYY-MM-DD
  time: string;              // HH:MM
  location: string;
  type: 'midterm' | 'final' | 'quiz';
}

export const UPCOMING_EXAMS: UpcomingExam[] = [
  {
    courseId: 'c1',
    courseName: '資料結構',
    title: '期末考試',
    date: '2026-06-15',
    time: '09:00',
    location: '工學院 301',
    type: 'final',
  },
  {
    courseId: 'c2',
    courseName: '線性代數',
    title: '第二次小考',
    date: '2026-05-22',
    time: '13:10',
    location: '理學院 201',
    type: 'quiz',
  },
  {
    courseId: 'c3',
    courseName: '作業系統',
    title: '期中補考',
    date: '2026-05-22',
    time: '14:00',
    location: '工學院 201',
    type: 'midterm',
  },
  {
    courseId: 'c5',
    courseName: '微積分',
    title: '期末考試',
    date: '2026-06-17',
    time: '10:00',
    location: '理學院 101',
    type: 'final',
  },
];
