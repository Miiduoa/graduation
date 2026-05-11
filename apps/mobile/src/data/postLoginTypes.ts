import type { PostLoginEngineBootstrap } from '../services/postLoginBootstrapStore';

// ─── 基本角色 ────────────────────────────────────────────────────────────────
export type PrimaryRole =
  | 'student'
  | 'teacher'
  | 'departmentAdmin'
  | 'staff'
  | 'shopOwner'
  | 'admin';

export type SubRole = 'ta' | 'dormManager' | 'cafeteriaStaff' | 'librarian';

export interface ResolvedRoles {
  primaryRole: PrimaryRole;
  subRoles: SubRole[];
  flags: {
    isTeacher: boolean;
    isStudent: boolean;
    isDeptAdmin: boolean;
    isAdmin: boolean;
  };
  // 供 Debug 用：這個 role 是怎麼判出來的
  source: 'firestore' | 'tron' | 'pu' | 'fallback';
}

// ─── 標準化課程 ──────────────────────────────────────────────────────────────
export interface NormalizedCourse {
  id: string; // 以 tronClass courseId 為主，沒有則用 pu courseCode
  code: string; // 課程代碼
  name: string;
  credits: number;
  semesterId: string; // e.g. '2025S2'
  teacherUids: string[]; // 對齊 Firebase uid
  teacherNames: string[]; // 備用（uid 找不到時顯示）
  studentUids: string[];
  schedule: CourseSchedule[];
  source: 'pu' | 'tron' | 'merged';
  tronCourseId?: string;
  puCourseCode?: string;
}

export interface CourseSchedule {
  weekday: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  periodStart: number;
  periodEnd: number;
  room?: string;
}

// ─── 作業 / 考試 ─────────────────────────────────────────────────────────────
export interface NormalizedAssignment {
  id: string;
  courseId: string;
  title: string;
  dueAt: string; // ISO
  type: 'homework' | 'exam' | 'quiz';
  status: 'pending' | 'submitted' | 'graded' | 'overdue';
  score?: number;
  maxScore?: number;
  source: 'tron' | 'pu';
}

// ─── postLoginContext：router 產出的「統一視角」 ─────────────────────────────
export interface PostLoginContext {
  uid: string;
  schoolId: string;
  roles: ResolvedRoles;

  // 學生視角
  asStudent?: {
    courses: NormalizedCourse[];
    pendingAssignments: NormalizedAssignment[];
    upcomingExams: NormalizedAssignment[];
    creditSummary?: {
      required: number;
      earned: number;
      inProgress: number;
    };
  };

  // 老師視角（primaryRole = teacher 或有 isTeacher flag 時填充）
  asTeacher?: {
    teachingCourses: NormalizedCourse[];
  };

  // 系所主管視角
  asDeptAdmin?: {
    departmentId: string;
    studentCount: number;
    courseCount: number;
  };

  // 服務人員視角（職員、店家）
  asStaff?: {
    managedServices: ('cafeteria' | 'dorm' | 'library' | 'printer')[];
  };

  // 共用：通知、公告
  latestAnnouncements: Array<{
    id: string;
    title: string;
    publishedAt: string;
    source: 'pu' | 'firebase';
  }>;

  // 時間戳記
  builtAt: string; // ISO，用於 debug
  partialErrors: string[]; // 哪些來源抓失敗（不阻斷主流程）
}

// ─── 各引擎都要實作的介面（payload 與 finalize bootstrap 對齊）────────────────────
export interface CampusEngineInitializable {
  initFromPostLoginContext(ctx: PostLoginEngineBootstrap): void | Promise<void>;
}
