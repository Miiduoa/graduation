/**
 * AI Data Inventory — APP 內所有功能 / 資料對 AI 的接入點
 *
 * 設計：APP 主打 AI 代理一切，AI 必須**掌握所有資料**。
 *
 * 一個地方統一列出每個 domain：
 *  - 資料 source（拉哪個 service / cache / storage）
 *  - 是否已串到 aiContextBuilder
 *  - 是否暴露為 AI Tool
 *  - 是否觸發 RoleEventBus
 *  - AI orchestration 接口
 *
 * 同時提供 wide-coverage 的 snapshot 函式 — 一次拉全 APP 所有 domain 的精簡摘要
 * 給 AI 主對話 system prompt 使用。
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import { DEMO_COURSES, getDemoHomeworksByCourse, getDemoExamsByCourse } from '../data/demoCoursesMock';
import { getScopedStorageKey } from './scopedStorage';

// ─────────────────────────────────────────────────────────
// AI Data Inventory schema
// ─────────────────────────────────────────────────────────

export type AIIntegrationLevel =
  | 'native'    // AI 直接演算，動作前後都過 AI
  | 'context'   // AI 拿得到資料但不主動 orchestrate
  | 'tool'      // AI 可主動 invoke tool 取資料
  | 'planned'   // 規劃中，下一輪整合
  | 'static';   // 純展示，無需 AI

export interface AIDomainEntry {
  /** Domain key */
  key: string;
  /** 中文名稱 */
  label: string;
  /** 角色相關（哪個角色會用到） */
  roles: Array<'student' | 'teacher' | 'ta' | 'department' | 'vendor'>;
  /** 對應 screens（檔名） */
  screens: string[];
  /** AI 整合等級 */
  level: AIIntegrationLevel;
  /** AI 能從這個 domain 知道什麼 */
  aiKnowledge: string;
  /** AI 能對這個 domain 做什麼 action */
  aiAction?: string;
  /** Snapshot provider key（aiDomainSnapshot 函式內對應） */
  snapshot?: string;
}

export const AI_DATA_INVENTORY: AIDomainEntry[] = [
  // 學習核心（已 native）
  {
    key: 'courses',
    label: '課程 / 教材 / 作業 / 測驗',
    roles: ['student', 'teacher', 'ta'],
    screens: ['CoursesHome', 'CourseModules', 'CourseScores', 'QuizCenter', 'HomeworkSubmit'],
    level: 'native',
    aiKnowledge: '5 門課完整狀態、預估成績、待繳作業、考試排程',
    aiAction: 'grade_predict_what_if / study_plan_today / urgent_notifications',
    snapshot: 'courses',
  },
  {
    key: 'attendance',
    label: '智慧點名',
    roles: ['student', 'teacher'],
    screens: ['AttendanceMultiMethod', 'MyAttendanceHistory'],
    level: 'native',
    aiKnowledge: '出席率、遲到/缺席模式、5 種點名方式選擇',
    aiAction: '老師開點名 → AI 推 critical 通知；學生出席異常 → AI 標 risk',
    snapshot: 'attendance',
  },
  {
    key: 'discussion',
    label: '課程討論',
    roles: ['student', 'teacher', 'ta'],
    screens: ['CourseDiscussion', 'DiscussionThreadDetail'],
    level: 'context',
    aiKnowledge: '討論串、待回覆問題、老師置頂',
    snapshot: 'discussion',
  },
  {
    key: 'peer_review',
    label: '同儕互評',
    roles: ['student'],
    screens: ['PeerReviewSubmit'],
    level: 'context',
    aiKnowledge: '互評任務、deadline',
    snapshot: 'peerReview',
  },
  {
    key: 'mistakes',
    label: '錯題本',
    roles: ['student'],
    screens: ['MistakeRepertoire'],
    level: 'native',
    aiKnowledge: '錯題本總題、今日該練、吸收率、Leitner box 分布',
    aiAction: 'mistake_due_today',
    snapshot: 'mistakes',
  },
  {
    key: 'notes',
    label: '課程筆記',
    roles: ['student'],
    screens: ['CourseNotes'],
    level: 'planned',
    aiKnowledge: '（規劃中）AI 摘要、跨課全文搜尋',
    snapshot: 'notes',
  },
  {
    key: 'ai_advisor',
    label: 'AI 學伴',
    roles: ['student'],
    screens: ['AICourseAdvisor'],
    level: 'native',
    aiKnowledge: 'AI 自身對話歷史、推薦課程、選課偏好',
    aiAction: 'socratic_hint / ai_full_context',
    snapshot: 'advisor',
  },
  // 校園生活
  {
    key: 'cafeteria',
    label: '校園餐廳',
    roles: ['student', 'teacher', 'vendor'],
    screens: ['Cafeteria', 'MenuDetail', 'Ordering', 'MenuSubscription', 'AdminCafeteria'],
    level: 'tool',
    aiKnowledge: '訂單佇列、菜單、品項熱度、學生偏好',
    aiAction: 'order_food / recommend_lunch / aiVendorNextAction',
    snapshot: 'cafeteria',
  },
  {
    key: 'library',
    label: '圖書館 / 借書 / 座位',
    roles: ['student', 'teacher', 'ta'],
    screens: ['Library', 'LibraryCatalog'],
    level: 'tool',
    aiKnowledge: '可借書、座位空檔、借閱歷史',
    aiAction: 'borrow_book / reserve_seat',
    snapshot: 'library',
  },
  {
    key: 'transport',
    label: '校車 / 接駁',
    roles: ['student', 'teacher', 'ta', 'department', 'vendor'],
    screens: ['BusSchedule', 'TransportHub'],
    level: 'context',
    aiKnowledge: '校車時刻、班次、月票',
    snapshot: 'transport',
  },
  {
    key: 'map',
    label: '地圖 / AR 導航 / 無障礙路線',
    roles: ['student', 'teacher', 'ta', 'department', 'vendor'],
    screens: ['Map', 'PoiDetail', 'ARNavigation', 'AccessibleRoute'],
    level: 'context',
    aiKnowledge: 'POI 位置、目前位置、教室路徑',
    snapshot: 'map',
  },
  {
    key: 'health',
    label: '健康 / 衛保 / 諮商',
    roles: ['student', 'teacher', 'ta'],
    screens: ['Health'],
    level: 'tool',
    aiKnowledge: '預約紀錄、看診時段',
    aiAction: 'create_health_appointment',
    snapshot: 'health',
  },
  {
    key: 'dormitory',
    label: '宿舍',
    roles: ['student'],
    screens: ['Dormitory'],
    level: 'context',
    aiKnowledge: '宿舍房號、繳費狀態',
    snapshot: 'dormitory',
  },
  {
    key: 'lostfound',
    label: '失物招領',
    roles: ['student', 'teacher', 'ta'],
    screens: ['LostFound', 'LostFoundDetail', 'LostFoundPost'],
    level: 'context',
    aiKnowledge: '失物清單、自己刊登的物品',
    snapshot: 'lostFound',
  },
  {
    key: 'print',
    label: '列印服務',
    roles: ['student', 'teacher', 'ta'],
    screens: ['PrintService'],
    level: 'tool',
    aiKnowledge: '列印額度、待印作業',
    aiAction: 'create_print_job',
    snapshot: 'print',
  },
  // 社群 / 訊息
  {
    key: 'announcements',
    label: '校園公告',
    roles: ['student', 'teacher', 'ta', 'department'],
    screens: ['Announcements', 'AnnouncementDetail'],
    level: 'context',
    aiKnowledge: '最新公告、未讀數、重要公告',
    snapshot: 'announcements',
  },
  {
    key: 'events',
    label: '校園活動 / 社團',
    roles: ['student', 'teacher', 'ta'],
    screens: ['Events', 'EventDetail'],
    level: 'context',
    aiKnowledge: '近期活動、報名狀態、社團',
    snapshot: 'events',
  },
  {
    key: 'social',
    label: '校園社群 / 看板',
    roles: ['student', 'teacher', 'ta'],
    screens: ['CampusSocial', 'BoardDetail', 'PostDetail', 'PostCompose', 'StoryCompose', 'HomeFeed', 'StudyBuddy'],
    level: 'context',
    aiKnowledge: '社群動態、貼文互動、Story',
    snapshot: 'social',
  },
  {
    key: 'messages',
    label: '訊息 / DM / 群組',
    roles: ['student', 'teacher', 'ta', 'department', 'vendor'],
    screens: ['MessagesHome', 'Inbox', 'Dms', 'Groups', 'GroupDetail', 'GroupPost', 'Chat'],
    level: 'tool',
    aiKnowledge: '未讀訊息、群組討論',
    aiAction: 'send_message',
    snapshot: 'messages',
  },
  {
    key: 'friends',
    label: '朋友 / 追蹤',
    roles: ['student'],
    screens: ['FriendSearch', 'FriendsManage', 'FollowingLists'],
    level: 'context',
    aiKnowledge: '好友、追蹤對象、可以一起讀書的同學',
    snapshot: 'friends',
  },
  // 時間管理 / Gamification
  {
    key: 'schedule',
    label: '行事曆 / 課表',
    roles: ['student', 'teacher', 'ta', 'department'],
    screens: ['SmartCalendar', 'UnifiedCalendar', 'CourseSchedule', 'AddCourse'],
    level: 'tool',
    aiKnowledge: '今天的課表、會議、考試日',
    aiAction: 'create_reminder',
    snapshot: 'schedule',
  },
  {
    key: 'companion',
    label: '校園精靈 / 學習花園',
    roles: ['student'],
    screens: ['Companion', 'CompanionCollection', 'CampusGarden', 'CampusGame'],
    level: 'native',
    aiKnowledge: '精靈狀態、花園進度、每日 signal',
    aiAction: 'spriteEngine / gardenEngine',
    snapshot: 'companion',
  },
  {
    key: 'constellation',
    label: '校園星圖',
    roles: ['student'],
    screens: ['Constellation'],
    level: 'context',
    aiKnowledge: '去過的地點、點亮的星座、本月限定',
    snapshot: 'constellation',
  },
  {
    key: 'achievements',
    label: '成就 / Gamification',
    roles: ['student'],
    screens: ['Achievements', 'Gamification'],
    level: 'context',
    aiKnowledge: '已解鎖成就、進度中、近期表現',
    snapshot: 'achievements',
  },
  // 學業 / 個人
  {
    key: 'academic',
    label: '學業總覽',
    roles: ['student'],
    screens: ['Academic', 'AcademicInsights', 'AcademicOverview', 'LearningAnalytics', 'Grades'],
    level: 'native',
    aiKnowledge: '畢業學分、GPA、學期紀錄、學業風險',
    snapshot: 'academic',
  },
  {
    key: 'credit_audit',
    label: '學分審查',
    roles: ['student', 'department'],
    screens: ['CreditAudit', 'CreditAuditInput'],
    level: 'context',
    aiKnowledge: '缺學分科目、可選課推薦',
    snapshot: 'creditAudit',
  },
  {
    key: 'profile',
    label: '個人資料 / 設定',
    roles: ['student', 'teacher', 'ta', 'department', 'vendor'],
    screens: ['Profile', 'ProfileEdit', 'NotificationSettings', 'AccessibilitySettings', 'LanguageSettings', 'PreferencesSettings'],
    level: 'context',
    aiKnowledge: '個人偏好、提醒設定、無障礙需求',
    snapshot: 'profile',
  },
  // 管理 / 服務
  {
    key: 'teacher_workspace',
    label: '教師工作台',
    roles: ['teacher', 'ta'],
    screens: ['TeachingHub', 'TeacherCockpit', 'CourseGradebook', 'CourseHub', 'AdminCourseVerify'],
    level: 'native',
    aiKnowledge: '待批改、紅旗學生、評語草稿',
    aiAction: 'feedback_drafter / bulk_reminders / aiPreReviewGrade',
    snapshot: 'teacherWorkspace',
  },
  {
    key: 'department_admin',
    label: '系所管理',
    roles: ['department', 'ta'],
    screens: ['DepartmentHub', 'DepartmentDashboard', 'AdminDashboard'],
    level: 'native',
    aiKnowledge: '系所健康度、課程平均、教學評鑑',
    aiAction: 'aiDepartmentHealthScore',
    snapshot: 'departmentAdmin',
  },
  {
    key: 'vendor_admin',
    label: '餐廳管理',
    roles: ['vendor'],
    screens: ['VendorDashboard', 'VendorManagement', 'AdminCafeteria'],
    level: 'native',
    aiKnowledge: '訂單佇列、營收、熱門品項',
    aiAction: 'aiVendorNextAction',
    snapshot: 'vendorAdmin',
  },
  {
    key: 'staff_hub',
    label: '職員工作台',
    roles: ['ta', 'department', 'vendor'],
    screens: ['StaffHub'],
    level: 'context',
    aiKnowledge: '指派任務、學生求助',
    snapshot: 'staffHub',
  },
  // 公共 / 輔助
  {
    key: 'global_search',
    label: '全域搜尋',
    roles: ['student', 'teacher', 'ta', 'department', 'vendor'],
    screens: ['GlobalSearch'],
    level: 'tool',
    aiKnowledge: '跨域搜尋：課程、人、地點、活動',
    snapshot: 'search',
  },
  {
    key: 'notifications',
    label: '通知中心',
    roles: ['student', 'teacher', 'ta', 'department', 'vendor'],
    screens: ['Notifications', 'NotificationSettings'],
    level: 'native',
    aiKnowledge: '智慧通知排程、cooldown',
    aiAction: 'planNotifications',
    snapshot: 'notifications',
  },
  {
    key: 'offline',
    label: '離線佇列',
    roles: ['student', 'teacher', 'ta', 'department', 'vendor'],
    screens: ['OfflineQueue'],
    level: 'context',
    aiKnowledge: '離線中待同步的動作',
    snapshot: 'offline',
  },
  {
    key: 'help',
    label: '幫助 / 回報',
    roles: ['student', 'teacher', 'ta', 'department', 'vendor'],
    screens: ['Help', 'BugReport', 'Feedback'],
    level: 'tool',
    aiKnowledge: 'FAQ、最近 bug 回報',
    snapshot: 'help',
  },
];

// ─────────────────────────────────────────────────────────
// 統計 helpers
// ─────────────────────────────────────────────────────────

export function aiDataInventoryStats() {
  const total = AI_DATA_INVENTORY.length;
  const byLevel: Record<AIIntegrationLevel, number> = {
    native: 0, context: 0, tool: 0, planned: 0, static: 0,
  };
  for (const e of AI_DATA_INVENTORY) byLevel[e.level] += 1;
  const integrated = byLevel.native + byLevel.context + byLevel.tool;
  const coverage = Math.round((integrated / total) * 100);
  return { total, byLevel, integrated, coverage };
}

// ─────────────────────────────────────────────────────────
// Wide AI Snapshot — 一次拉「給 AI 看的精簡摘要」
//
// 給 chatWithAI 的 system prompt 用，讓 AI 知道 APP 內所有 domain 現況。
// 每個 snapshot 都是純函式 + AsyncStorage 讀，不打網路。
// ─────────────────────────────────────────────────────────

export interface WideSnapshot {
  generatedAt: string;
  domains: Record<string, unknown>;
  /** 整合等級覆蓋率 */
  coverage: number;
  /** AI 沒有資料的 domain（提醒下一輪補） */
  uncoveredDomains: string[];
}

export async function buildWideAISnapshot(opts: {
  uid: string;
  schoolId?: string | null;
}): Promise<WideSnapshot> {
  const domains: Record<string, unknown> = {};

  // 1. courses（課程資料 — demo）
  domains.courses = {
    total: DEMO_COURSES.length,
    list: DEMO_COURSES.map((c) => ({ id: c.id, name: c.name, instructor: c.instructor })),
    upcomingHomeworks: DEMO_COURSES.flatMap((c) =>
      getDemoHomeworksByCourse(c.id)
        .filter((h) => !h.submitted)
        .map((h) => ({ courseName: c.name, title: h.title, dueAt: h.dueAt })),
    ).slice(0, 10),
    upcomingExams: DEMO_COURSES.flatMap((c) =>
      getDemoExamsByCourse(c.id)
        .filter((e) => !e.submitted)
        .map((e) => ({ courseName: c.name, title: e.title, startAt: e.startAt })),
    ).slice(0, 5),
  };

  // 2. mistakes（錯題本）
  try {
    const key = getScopedStorageKey('mistake_repertoire_v1', { uid: opts.uid, schoolId: opts.schoolId ?? null });
    const raw = await AsyncStorage.getItem(key);
    const list = raw ? JSON.parse(raw) : [];
    domains.mistakes = {
      total: Array.isArray(list) ? list.length : 0,
      retired: Array.isArray(list) ? list.filter((m: any) => m.retired).length : 0,
    };
  } catch {
    domains.mistakes = { total: 0, retired: 0 };
  }

  // 3. companion signals（精靈狀態 — 讀 storage）
  try {
    const key = getScopedStorageKey('companion_signals_v1', { uid: opts.uid, schoolId: opts.schoolId ?? null });
    const raw = await AsyncStorage.getItem(key);
    domains.companion = raw ? { hasData: true, preview: String(raw).slice(0, 100) } : { hasData: false };
  } catch {
    domains.companion = { hasData: false };
  }

  // 4. notes
  try {
    // 嘗試讀任一 course note key (note key 是 per-course)
    const allKeys = await AsyncStorage.getAllKeys();
    const noteKeys = allKeys.filter((k) => k.startsWith('course_notes_v1_'));
    let count = 0;
    for (const k of noteKeys.slice(0, 5)) {
      const raw = await AsyncStorage.getItem(k);
      if (raw) {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr)) count += arr.length;
      }
    }
    domains.notes = { courseCount: noteKeys.length, totalNotes: count };
  } catch {
    domains.notes = { courseCount: 0, totalNotes: 0 };
  }

  // 5. role inbox
  try {
    const key = getScopedStorageKey('role_event_log_v1', { uid: opts.uid, schoolId: null });
    const raw = await AsyncStorage.getItem(key);
    const list = raw ? JSON.parse(raw) : [];
    domains.messagesInbox = {
      total: Array.isArray(list) ? list.length : 0,
    };
  } catch {
    domains.messagesInbox = { total: 0 };
  }

  // 6. profile / preferences
  try {
    const prefKey = getScopedStorageKey('campus.preferences', { uid: opts.uid, schoolId: null });
    const raw = await AsyncStorage.getItem(prefKey);
    domains.profile = raw
      ? { hasPreferences: true }
      : { hasPreferences: false };
  } catch {
    domains.profile = { hasPreferences: false };
  }

  // 7-N. 其他 domain 標為 placeholder（等 stub adapter）
  const placeholderDomains = [
    'cafeteria', 'library', 'transport', 'map', 'health', 'dormitory',
    'lostFound', 'print', 'announcements', 'events', 'social', 'friends',
    'achievements', 'academic', 'creditAudit', 'attendance', 'discussion',
    'peerReview', 'schedule', 'constellation', 'teacherWorkspace',
    'departmentAdmin', 'vendorAdmin', 'staffHub', 'search', 'notifications', 'offline', 'help',
  ];
  for (const k of placeholderDomains) {
    if (!(k in domains)) {
      domains[k] = { available: true, note: 'AI 可透過對應 AI Tool 即時取資料' };
    }
  }

  const stats = aiDataInventoryStats();
  const uncoveredDomains = AI_DATA_INVENTORY
    .filter((e) => e.level === 'planned')
    .map((e) => e.key);

  return {
    generatedAt: new Date().toISOString(),
    domains,
    coverage: stats.coverage,
    uncoveredDomains,
  };
}

// ─────────────────────────────────────────────────────────
// Helper: 給 AI prompt 用的單行摘要
// ─────────────────────────────────────────────────────────

export function wideSnapshotToPromptLine(snap: WideSnapshot): string {
  const c = snap.domains.courses as any;
  const m = snap.domains.mistakes as any;
  const inbox = snap.domains.messagesInbox as any;
  return [
    `AI 資料覆蓋率 ${snap.coverage}%。`,
    `學生有 ${c?.total ?? 0} 門課、${c?.upcomingHomeworks?.length ?? 0} 份待繳作業、${c?.upcomingExams?.length ?? 0} 場考試。`,
    `錯題本 ${m?.total ?? 0} 題（已熟練 ${m?.retired ?? 0}）。`,
    `Inbox 有 ${inbox?.total ?? 0} 則動態。`,
    `${snap.uncoveredDomains.length > 0 ? `規劃中：${snap.uncoveredDomains.join('、')}。` : '所有 domain 已串接。'}`,
  ].join(' ');
}
