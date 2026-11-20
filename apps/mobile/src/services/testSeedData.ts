/**
 * 測試帳號種子資料 — 跨角色互聯的模擬世界
 *
 * 所有測試帳號共用同一組課程、成績、訂單資料，確保：
 *   - test_student 的課表裡老師 = test_teacher
 *   - test_teacher 的課程裡有 test_student 的修課紀錄
 *   - test_vendor 的店可以收到 test_student 的訂單
 *   - test_department / test_department_head 管的系 = 資工系 = 上述師生的系
 *   - test_admin / test_school 可看到全校資料
 *
 * 資料關聯圖：
 *
 *   test_school ──管理──→ 全校
 *       │
 *   test_admin  ──管理──→ 全校設定
 *       │
 *   test_department_head ──主管──→ 資訊工程學系
 *       │
 *   test_department ──系辦──→ 資訊工程學系
 *       │
 *   test_teacher ──教授──→ [程式設計, 資料結構, 計算機概論]
 *       │                         ↑ 修課
 *   test_student ──修課──→ [程式設計, 資料結構, 計算機概論]
 *       │
 *       └──點餐──→ test_vendor（靜園自助餐 jy-01）
 *
 *   test_staff ──總務處──→ 校園設施管理
 */

import type {
  PUCourse,
  PUCourseResult,
  PUGradeResult,
  PUStudentInfo,
  PUAnnouncement,
} from './puDirectScraper';
import {
  seedCachedCourses,
  seedCachedGrades,
  seedCachedStudentInfo,
  seedCachedAnnouncements,
} from './puDataCache';
import {
  createOrder,
  getOrders,
  type Order,
} from './cafeteriaData';
import type { UserRole } from '../state/auth';

// ═══════════════════════════════════════════════════════
// I. 共用常數 — 所有角色共享的課程/人員 ID
// ═══════════════════════════════════════════════════════

const CURRENT_SEMESTER = '113-2';  // 113 學年第 2 學期
const DEPT = '資訊工程學系';

/** 測試帳號 UID 常數（與 studentIdAuth.ts 的 TEST_ACCOUNTS 對應） */
export const TEST_UIDS = {
  student: 'test-student',
  teacher: 'test-teacher',
  staff: 'test-staff',
  department: 'test-department',
  departmentHead: 'test-department_head',
  admin: 'test-admin',
  school: 'test-school',
  vendor: 'test-vendor',
} as const;

/** 測試帳號人名常數 */
export const TEST_NAMES = {
  student: '測試學生',
  teacher: '測試教師',
  staff: '測試職員',
  department: '測試系辦',
  departmentHead: '測試系主任',
  admin: '測試管理員',
  school: '測試校方',
  vendor: '測試店家老闆',
} as const;

// ═══════════════════════════════════════════════════════
// II. 共用課表 — 3 門課，老師都是 test_teacher
// ═══════════════════════════════════════════════════════

const SHARED_COURSES: PUCourse[] = [
  {
    code: 'CS101',
    classOffered: '資工一A',
    name: '程式設計',
    nameEn: 'Programming',
    courseType: '必修',
    credits: 3,
    dayOfWeek: 1,  // 週一
    periods: [3, 4],
    startTime: '10:10',
    endTime: '12:00',
    location: '至善樓 S312',
    timePlaceRaw: '一3-4 至善樓S312',
    teacherEmail: 'test_teacher@test.campus.app',
    teacherName: TEST_NAMES.teacher,
  },
  {
    code: 'CS201',
    classOffered: '資工二A',
    name: '資料結構',
    nameEn: 'Data Structures',
    courseType: '必修',
    credits: 3,
    dayOfWeek: 3,  // 週三
    periods: [5, 6],
    startTime: '13:10',
    endTime: '15:00',
    location: '至善樓 S310',
    timePlaceRaw: '三5-6 至善樓S310',
    teacherEmail: 'test_teacher@test.campus.app',
    teacherName: TEST_NAMES.teacher,
  },
  {
    code: 'CS110',
    classOffered: '資工一A',
    name: '計算機概論',
    nameEn: 'Introduction to Computer Science',
    courseType: '必修',
    credits: 3,
    dayOfWeek: 5,  // 週五
    periods: [1, 2],
    startTime: '08:10',
    endTime: '10:00',
    location: '至善樓 S305',
    timePlaceRaw: '五1-2 至善樓S305',
    teacherEmail: 'test_teacher@test.campus.app',
    teacherName: TEST_NAMES.teacher,
  },
];

// ═══════════════════════════════════════════════════════
// III. 共用成績 — 上學期成績（模擬歷史資料）
// ═══════════════════════════════════════════════════════

const SHARED_GRADES: PUGradeResult = {
  grades: [
    {
      semester: '113-1',
      courseName: '微積分',
      courseNameEn: 'Calculus',
      className: '資工一A',
      courseType: '必修',
      credits: 3,
      score: 82,
    },
    {
      semester: '113-1',
      courseName: '普通物理',
      courseNameEn: 'General Physics',
      className: '資工一A',
      courseType: '必修',
      credits: 3,
      score: 78,
    },
    {
      semester: '113-1',
      courseName: '英文閱讀',
      courseNameEn: 'English Reading',
      className: '資工一A',
      courseType: '通識',
      credits: 2,
      score: 88,
    },
    {
      semester: '113-1',
      courseName: '大學國文',
      courseNameEn: 'Chinese Literature',
      className: '資工一A',
      courseType: '通識',
      credits: 2,
      score: 75,
    },
  ],
  allSemesters: ['113-1'],
  summary: {
    '113-1': {
      departmentRanking: '12/45',
      classRanking: '8/32',
      behaviorScore: 85,
      semesterAverage: 80.75,
    },
  },
};

// ═══════════════════════════════════════════════════════
// IV. 共用公告
// ═══════════════════════════════════════════════════════

const SHARED_ANNOUNCEMENTS: PUAnnouncement[] = [
  {
    title: '113-2 期中考週注意事項',
    date: '2025-04-01',
    url: 'https://www.pu.edu.tw/test/midterm',
    category: '教務處',
  },
  {
    title: '資工系專題成果發表會',
    date: '2025-05-15',
    url: 'https://www.pu.edu.tw/test/capstone',
    category: '資訊工程學系',
  },
  {
    title: '圖書館端午節閉館公告',
    date: '2025-05-20',
    url: 'https://www.pu.edu.tw/test/library-closed',
    category: '圖書館',
  },
];

// ═══════════════════════════════════════════════════════
// V. 模擬班級名冊 — test_student + 其他模擬同學
// ═══════════════════════════════════════════════════════

export type TestClassmate = {
  uid: string;
  studentId: string;
  displayName: string;
  department: string;
  role: UserRole;
};

/** 同班同學（含 test_student 本人），供點名、學習配對等功能使用 */
export const TEST_CLASSMATES: TestClassmate[] = [
  {
    uid: TEST_UIDS.student,
    studentId: 'T11100001',
    displayName: TEST_NAMES.student,
    department: DEPT,
    role: 'student',
  },
  {
    uid: 'mock-student-2',
    studentId: 'T11100002',
    displayName: '王小明',
    department: DEPT,
    role: 'student',
  },
  {
    uid: 'mock-student-3',
    studentId: 'T11100003',
    displayName: '李小華',
    department: DEPT,
    role: 'student',
  },
  {
    uid: 'mock-student-4',
    studentId: 'T11100004',
    displayName: '張美玲',
    department: DEPT,
    role: 'student',
  },
  {
    uid: 'mock-student-5',
    studentId: 'T11100005',
    displayName: '陳大文',
    department: DEPT,
    role: 'student',
  },
];

// ═══════════════════════════════════════════════════════
// VI. 模擬訂單（test_student → test_vendor 的靜園自助餐）
// ═══════════════════════════════════════════════════════

const SEED_ORDERS: Array<Omit<Order, 'id' | 'createdAt'>> = [
  {
    studentUid: TEST_UIDS.student,
    vendorId: 'jy-01',          // 靜園自助餐（ownerUid = test-vendor）
    cafeteriaId: 'jingyuan',
    status: 'completed',
    items: [
      { menuItemId: 'jy01-01', menuItemName: '自助餐A餐', quantity: 1, unitPrice: 65, selectedOptions: [], subtotal: 65 },
    ],
    totalPrice: 65,
    note: '',
    estimatedPickup: null,
    queueNumber: 1,
    completedAt: '2025-04-10T12:30:00+08:00',
    cancelledAt: null,
    cancelReason: null,
  },
  {
    studentUid: TEST_UIDS.student,
    vendorId: 'jy-01',
    cafeteriaId: 'jingyuan',
    status: 'preparing',
    items: [
      { menuItemId: 'jy01-02', menuItemName: '自助餐B餐', quantity: 1, unitPrice: 70, selectedOptions: [], subtotal: 70 },
      { menuItemId: 'jy01-03', menuItemName: '紅茶', quantity: 2, unitPrice: 15, selectedOptions: [], subtotal: 30 },
    ],
    totalPrice: 100,
    note: '少飯多菜',
    estimatedPickup: null,
    queueNumber: 2,
    completedAt: null,
    cancelledAt: null,
    cancelReason: null,
  },
];

// ═══════════════════════════════════════════════════════
// VII. 主入口 — 依角色注入種子資料
// ═══════════════════════════════════════════════════════

/**
 * 測試帳號登入後呼叫此函式，注入該角色視角的關聯資料到本地快取。
 *
 * 關聯邏輯：
 *   student  → 課表（老師=test_teacher）、成績、公告、歷史訂單
 *   teacher  → 課表（自己教的）、學生名冊、公告
 *   staff    → 公告
 *   department / department_head → 課表（系上所有課）、公告
 *   admin / school → 全校課表、全部訂單、公告
 *   vendor   → 本店訂單、公告
 */
export async function seedTestData(role: UserRole): Promise<void> {
  console.log(`[testSeedData] Seeding data for role: ${role}`);

  try {
    // ── 所有角色都有公告 ──
    await seedCachedAnnouncements(SHARED_ANNOUNCEMENTS);

    switch (role) {
      case 'student': {
        // 學生看到的課表 — 自己修的 3 門課，老師 = test_teacher
        const studentInfo: PUStudentInfo = {
          studentId: 'T11100001',
          name: TEST_NAMES.student,
          className: '資工一A',
          currentSemester: CURRENT_SEMESTER,
          department: DEPT,
          grade: '一年級',
          enrollmentStatus: '在學',
        };
        const courseResult: PUCourseResult = {
          courses: SHARED_COURSES,
          studentInfo,
          semester: CURRENT_SEMESTER,
          totalCredits: SHARED_COURSES.reduce((s, c) => s + c.credits, 0),
        };
        await seedCachedCourses(courseResult);
        await seedCachedGrades(SHARED_GRADES);
        await seedCachedStudentInfo(studentInfo);

        // 注入歷史訂單（學生 → 靜園自助餐）
        await seedTestOrders();
        break;
      }

      case 'teacher':
      case 'professor': {
        // 教師看到的課表 — 自己教的 3 門課
        const teacherInfo: PUStudentInfo = {
          studentId: 'T90000001',
          name: TEST_NAMES.teacher,
          className: null,
          currentSemester: CURRENT_SEMESTER,
          department: DEPT,
          grade: null,
          enrollmentStatus: '在職',
        };
        const teacherCourses: PUCourseResult = {
          courses: SHARED_COURSES,
          studentInfo: teacherInfo,
          semester: CURRENT_SEMESTER,
          totalCredits: SHARED_COURSES.reduce((s, c) => s + c.credits, 0),
        };
        await seedCachedCourses(teacherCourses);
        await seedCachedStudentInfo(teacherInfo);
        break;
      }

      case 'department':
      case 'department_head': {
        // 系辦/系主任看到系上所有課程
        const deptInfo: PUStudentInfo = {
          studentId: role === 'department' ? 'D90000001' : 'H90000001',
          name: role === 'department' ? TEST_NAMES.department : TEST_NAMES.departmentHead,
          className: null,
          currentSemester: CURRENT_SEMESTER,
          department: DEPT,
          grade: null,
          enrollmentStatus: '在職',
        };
        const deptCourses: PUCourseResult = {
          courses: SHARED_COURSES,
          studentInfo: deptInfo,
          semester: CURRENT_SEMESTER,
          totalCredits: SHARED_COURSES.reduce((s, c) => s + c.credits, 0),
        };
        await seedCachedCourses(deptCourses);
        await seedCachedStudentInfo(deptInfo);
        break;
      }

      case 'admin':
      case 'school': {
        // 管理員/校方看到全校資料
        const adminInfo: PUStudentInfo = {
          studentId: role === 'admin' ? 'A90000001' : 'X90000001',
          name: role === 'admin' ? TEST_NAMES.admin : TEST_NAMES.school,
          className: null,
          currentSemester: CURRENT_SEMESTER,
          department: role === 'admin' ? '資訊中心' : '校長室',
          grade: null,
          enrollmentStatus: '在職',
        };
        await seedCachedCourses({
          courses: SHARED_COURSES,
          studentInfo: adminInfo,
          semester: CURRENT_SEMESTER,
          totalCredits: SHARED_COURSES.reduce((s, c) => s + c.credits, 0),
        });
        await seedCachedStudentInfo(adminInfo);
        break;
      }

      case 'vendor': {
        // 店家 — 注入訂單（會透過 cafeteriaData 的 getOrders(undefined, vendorId) 讀到）
        const vendorInfo: PUStudentInfo = {
          studentId: 'V90000001',
          name: TEST_NAMES.vendor,
          className: null,
          currentSemester: CURRENT_SEMESTER,
          department: '靜園美食街',
          grade: null,
          enrollmentStatus: '在職',
        };
        await seedCachedStudentInfo(vendorInfo);
        // 注入示範訂單讓店家畫面有東西看
        await seedTestOrders();
        break;
      }

      case 'staff': {
        // 職員 — 基本資料
        const staffInfo: PUStudentInfo = {
          studentId: 'S90000001',
          name: TEST_NAMES.staff,
          className: null,
          currentSemester: CURRENT_SEMESTER,
          department: '總務處',
          grade: null,
          enrollmentStatus: '在職',
        };
        await seedCachedStudentInfo(staffInfo);
        break;
      }

      default:
        break;
    }

    console.log(`[testSeedData] ✅ Seed complete for role: ${role}`);
  } catch (err) {
    console.warn(`[testSeedData] Seed error for role ${role}:`, err);
  }
}

// ═══════════════════════════════════════════════════════
// VIII. 內部：注入模擬訂單
// ═══════════════════════════════════════════════════════

async function seedTestOrders(): Promise<void> {
  try {
    // 先檢查是否已有訂單，避免重複建立
    const existing = await getOrders(TEST_UIDS.student);
    if (existing.length > 0) {
      console.log('[testSeedData] Orders already exist, skip seeding');
      return;
    }

    for (const orderTemplate of SEED_ORDERS) {
      await createOrder({
        studentUid: orderTemplate.studentUid,
        vendorId: orderTemplate.vendorId,
        cafeteriaId: orderTemplate.cafeteriaId,
        items: orderTemplate.items,
        totalPrice: orderTemplate.totalPrice,
        note: orderTemplate.note ?? '',
        estimatedPickup: orderTemplate.estimatedPickup ?? null,
      });
    }
    console.log(`[testSeedData] Seeded ${SEED_ORDERS.length} test orders`);
  } catch (err) {
    console.warn('[testSeedData] Seed orders error:', err);
  }
}

// ═══════════════════════════════════════════════════════
// IX. 輔助 — 取得班級名冊（供點名系統使用）
// ═══════════════════════════════════════════════════════

/**
 * 取得測試課程的學生名冊。
 * 點名系統 / 學習配對 可以用這個函式取得同班同學資料。
 */
export function getTestClassRoster(courseCode?: string): TestClassmate[] {
  // 所有測試課程共用同一批學生
  return TEST_CLASSMATES;
}

/**
 * 判斷目前是否為測試帳號登入狀態
 */
export function isTestAccount(uid: string | undefined | null): boolean {
  if (!uid) return false;
  return uid.startsWith('test-');
}

/**
 * 依 UID 查詢對應的測試帳號顯示名稱
 */
export function getTestDisplayName(uid: string): string | null {
  const entry = Object.entries(TEST_UIDS).find(([, v]) => v === uid);
  if (!entry) return null;
  return TEST_NAMES[entry[0] as keyof typeof TEST_NAMES] ?? null;
}
