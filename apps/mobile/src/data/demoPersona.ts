/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Demo Persona Data Layer — 統一的「角色身分 + 私有資料」單一資料源
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  目的：讓 demo 模式下的每個角色都是「獨立、隱私、連續」的人，而不是
 *  全部共享同一份 mock data 的紙片人。
 *
 *  解決了三個 demo 期間最常被抓包的問題：
 *
 *    1. 「為什麼學生 A 看得到老師 B 的私訊？」
 *         → 訊息資料以 personaUid 為 key 隔離。切換 demo 角色 = 換收件箱。
 *
 *    2. 「儀表板按鈕點了沒反應」
 *         → 每個 mission 都帶一個明確的 navigate target（路由 + params），
 *           並通過 safeNavigate 走，找不到路由會跳 Toast 而不是死當。
 *
 *    3. 「故事性不連貫」
 *         → 學生請假 → 教師收件匣出現待審 → 系主任儀表板出現異常出席率
 *           三個角色看到的是同一份事實的「不同切面」，由本模組統一供應。
 *
 *  跨角色關聯的「事實流」（fact flow）：
 *
 *     [事實]                          [來源角色]    [其他角色如何看到]
 *     leave_request_pending          學生         → 教師收件箱、系主任異常燈號
 *     low_engagement_student_flag    AI 從成績算   → 教師中控、系主任預警、學生溫和提示
 *     menu_published_today           商家         → 學生今日推薦（依過敏原過濾）
 *     attendance_anomaly             AI           → 教師、TA、家長、系主任同步看到
 *     exam_grade_published           教師         → 學生、家長（學生授權後）
 *     vendor_low_stock               商家 POS     → 商家後台補貨建議、學生菜單灰掉
 *
 *  使用：
 *    import { getPersonaInbox, getPersonaConversations, getPersonaMissions } from '...';
 *    const inbox = getPersonaInbox(auth.user.uid);
 *
 *  注意：本模組僅在 demo / mock 模式生效，正式登入仍走 Firestore。
 * ═══════════════════════════════════════════════════════════════════════════
 */

export type PersonaRole =
  | 'student'
  | 'teacher'
  | 'ta'
  | 'department_head'
  | 'admin'
  | 'vendor'
  | 'parent'
  | 'club_officer';

/** Demo persona 的 uid 列表 — 全 App 統一使用這些字串 */
export const DEMO_PERSONAS = {
  STUDENT_KU: 'demo_student_kuchih',
  STUDENT_PEER: 'demo_student_peer_lin',
  TEACHER_CHANG: 'demo_teacher_chang',
  TA_LIN: 'demo_ta_lin',
  DEPT_HEAD_HUANG: 'demo_admin_huang', // 系主任
  ADMIN_SYS: 'demo_admin_sys',
  VENDOR_AYING: 'demo_cafeteria',
  PARENT_KU: 'demo_parent_ku',
  CLUB_OFFICER_WEI: 'demo_club_wei',
} as const;

export type PersonaUid = (typeof DEMO_PERSONAS)[keyof typeof DEMO_PERSONAS];

export interface PersonaIdentity {
  uid: string;
  fullName: string;
  role: PersonaRole;
  shortLabel: string;
  schoolId: string;
  department?: string;
  /** 真正能看到的「我的訊息對方 uid」白名單 */
  contactUids: string[];
  /** 跟誰是父子關係（給家長角色用） */
  childUids?: string[];
}

// ─────────────────────────────────────────────────────────────────────────
//  9 個 demo 角色身分
// ─────────────────────────────────────────────────────────────────────────

export const PERSONAS: Record<PersonaUid, PersonaIdentity> = {
  [DEMO_PERSONAS.STUDENT_KU]: {
    uid: DEMO_PERSONAS.STUDENT_KU,
    fullName: '顧晉瑋',
    role: 'student',
    shortLabel: '學生',
    schoolId: 'pu',
    department: '資訊管理學系',
    contactUids: [
      DEMO_PERSONAS.TEACHER_CHANG,
      DEMO_PERSONAS.TA_LIN,
      DEMO_PERSONAS.STUDENT_PEER,
      DEMO_PERSONAS.CLUB_OFFICER_WEI,
    ],
  },
  [DEMO_PERSONAS.STUDENT_PEER]: {
    uid: DEMO_PERSONAS.STUDENT_PEER,
    fullName: '林宏志',
    role: 'student',
    shortLabel: '學生（同學）',
    schoolId: 'pu',
    department: '資訊工程學系',
    contactUids: [DEMO_PERSONAS.STUDENT_KU, DEMO_PERSONAS.TA_LIN],
  },
  [DEMO_PERSONAS.TEACHER_CHANG]: {
    uid: DEMO_PERSONAS.TEACHER_CHANG,
    fullName: '張怡君',
    role: 'teacher',
    shortLabel: '教師',
    schoolId: 'pu',
    department: '資訊管理學系',
    contactUids: [
      DEMO_PERSONAS.TA_LIN,
      DEMO_PERSONAS.DEPT_HEAD_HUANG,
      DEMO_PERSONAS.STUDENT_KU,
      DEMO_PERSONAS.STUDENT_PEER,
    ],
  },
  [DEMO_PERSONAS.TA_LIN]: {
    uid: DEMO_PERSONAS.TA_LIN,
    fullName: '林助教',
    role: 'ta',
    shortLabel: '助教 TA',
    schoolId: 'pu',
    department: '資訊管理學系',
    contactUids: [
      DEMO_PERSONAS.TEACHER_CHANG,
      DEMO_PERSONAS.STUDENT_KU,
      DEMO_PERSONAS.STUDENT_PEER,
    ],
  },
  [DEMO_PERSONAS.DEPT_HEAD_HUANG]: {
    uid: DEMO_PERSONAS.DEPT_HEAD_HUANG,
    fullName: '黃主任',
    role: 'department_head',
    shortLabel: '系主任',
    schoolId: 'pu',
    department: '資訊管理學系',
    contactUids: [
      DEMO_PERSONAS.TEACHER_CHANG,
      DEMO_PERSONAS.ADMIN_SYS,
      DEMO_PERSONAS.VENDOR_AYING,
    ],
  },
  [DEMO_PERSONAS.ADMIN_SYS]: {
    uid: DEMO_PERSONAS.ADMIN_SYS,
    fullName: '系統管理員',
    role: 'admin',
    shortLabel: '管理員',
    schoolId: 'pu',
    department: '資訊處',
    contactUids: [DEMO_PERSONAS.DEPT_HEAD_HUANG, DEMO_PERSONAS.VENDOR_AYING],
  },
  [DEMO_PERSONAS.VENDOR_AYING]: {
    uid: DEMO_PERSONAS.VENDOR_AYING,
    fullName: '阿英（中餐部店長）',
    role: 'vendor',
    shortLabel: '商家',
    schoolId: 'pu',
    department: '校園商家',
    contactUids: [DEMO_PERSONAS.ADMIN_SYS, DEMO_PERSONAS.DEPT_HEAD_HUANG],
  },
  [DEMO_PERSONAS.PARENT_KU]: {
    uid: DEMO_PERSONAS.PARENT_KU,
    fullName: '顧媽媽',
    role: 'parent',
    shortLabel: '家長',
    schoolId: 'pu',
    department: '家長',
    childUids: [DEMO_PERSONAS.STUDENT_KU],
    contactUids: [DEMO_PERSONAS.TEACHER_CHANG, DEMO_PERSONAS.DEPT_HEAD_HUANG],
  },
  [DEMO_PERSONAS.CLUB_OFFICER_WEI]: {
    uid: DEMO_PERSONAS.CLUB_OFFICER_WEI,
    fullName: '威廷（資管學會長）',
    role: 'club_officer',
    shortLabel: '社團幹部',
    schoolId: 'pu',
    department: '資管學會',
    contactUids: [DEMO_PERSONAS.STUDENT_KU, DEMO_PERSONAS.STUDENT_PEER],
  },
};

export function getPersona(uid: string | undefined | null): PersonaIdentity | null {
  if (!uid) return null;
  return PERSONAS[uid as PersonaUid] ?? null;
}

export function isDemoPersonaUid(uid: string | undefined | null): boolean {
  return !!uid && uid in PERSONAS;
}

export function listDemoPersonas(): PersonaIdentity[] {
  return Object.values(PERSONAS);
}

// ─────────────────────────────────────────────────────────────────────────
//  訊息系統（嚴格按身分隔離）
// ─────────────────────────────────────────────────────────────────────────

export interface PersonaConversation {
  /** Conversation id — 兩個 uid 排序後拼接 */
  id: string;
  participants: string[]; // [uidA, uidB]
  /** 對話內容（按時間順序） */
  messages: Array<{
    id: string;
    fromUid: string;
    text: string;
    sentAt: string; // ISO
  }>;
}

const now = Date.now();
const minutesAgo = (m: number) => new Date(now - m * 60_000).toISOString();
const hoursAgo = (h: number) => new Date(now - h * 3600_000).toISOString();
const daysAgo = (d: number) => new Date(now - d * 24 * 3600_000).toISOString();

function convId(a: string, b: string): string {
  return [a, b].sort().join('__');
}

/** 全部對話（demo 預埋）— 每個 conversation 都包含兩個明確的參與者 uid */
const ALL_CONVERSATIONS: PersonaConversation[] = [
  // 學生顧 ↔ 教師張：請假討論
  {
    id: convId(DEMO_PERSONAS.STUDENT_KU, DEMO_PERSONAS.TEACHER_CHANG),
    participants: [DEMO_PERSONAS.STUDENT_KU, DEMO_PERSONAS.TEACHER_CHANG],
    messages: [
      {
        id: 'm1',
        fromUid: DEMO_PERSONAS.STUDENT_KU,
        text: '老師您好，下週三我家裡有事想請假，可以嗎？',
        sentAt: hoursAgo(20),
      },
      {
        id: 'm2',
        fromUid: DEMO_PERSONAS.TEACHER_CHANG,
        text: '請從 App 內提交請假單，我會在收件匣審核。',
        sentAt: hoursAgo(19),
      },
      {
        id: 'm3',
        fromUid: DEMO_PERSONAS.STUDENT_KU,
        text: '好的，已經送出了，麻煩老師。',
        sentAt: hoursAgo(2),
      },
    ],
  },
  // 學生顧 ↔ TA 林：作業 debug
  {
    id: convId(DEMO_PERSONAS.STUDENT_KU, DEMO_PERSONAS.TA_LIN),
    participants: [DEMO_PERSONAS.STUDENT_KU, DEMO_PERSONAS.TA_LIN],
    messages: [
      {
        id: 'm10',
        fromUid: DEMO_PERSONAS.STUDENT_KU,
        text: 'TA 你好，HW3 的 normalization 我卡在第三正規化，可以幫忙看嗎？',
        sentAt: hoursAgo(3),
      },
      {
        id: 'm11',
        fromUid: DEMO_PERSONAS.TA_LIN,
        text: '把 ER 圖貼上來，我等等就看。',
        sentAt: minutesAgo(95),
      },
    ],
  },
  // 學生顧 ↔ 同學林宏志：分組作業
  {
    id: convId(DEMO_PERSONAS.STUDENT_KU, DEMO_PERSONAS.STUDENT_PEER),
    participants: [DEMO_PERSONAS.STUDENT_KU, DEMO_PERSONAS.STUDENT_PEER],
    messages: [
      {
        id: 'm20',
        fromUid: DEMO_PERSONAS.STUDENT_PEER,
        text: '專題 Demo 我們約週五下午對一下？',
        sentAt: hoursAgo(8),
      },
      {
        id: 'm21',
        fromUid: DEMO_PERSONAS.STUDENT_KU,
        text: '可以，研討室 G-3 我訂了 14:00-16:00',
        sentAt: hoursAgo(7),
      },
    ],
  },
  // 學生顧 ↔ 社團幹部威廷：社團活動
  {
    id: convId(DEMO_PERSONAS.STUDENT_KU, DEMO_PERSONAS.CLUB_OFFICER_WEI),
    participants: [DEMO_PERSONAS.STUDENT_KU, DEMO_PERSONAS.CLUB_OFFICER_WEI],
    messages: [
      {
        id: 'm30',
        fromUid: DEMO_PERSONAS.CLUB_OFFICER_WEI,
        text: '資管之夜你 RSVP 了嗎？要幫忙嗎？',
        sentAt: daysAgo(1),
      },
    ],
  },
  // 教師張 ↔ TA 林：協助批改
  {
    id: convId(DEMO_PERSONAS.TEACHER_CHANG, DEMO_PERSONAS.TA_LIN),
    participants: [DEMO_PERSONAS.TEACHER_CHANG, DEMO_PERSONAS.TA_LIN],
    messages: [
      {
        id: 'm40',
        fromUid: DEMO_PERSONAS.TEACHER_CHANG,
        text: '林助教，這次 HW3 約 32 份請麻煩你批一半，rubric 我已經設好了。',
        sentAt: hoursAgo(5),
      },
      {
        id: 'm41',
        fromUid: DEMO_PERSONAS.TA_LIN,
        text: '收到，週四前完成。AI 建議我先批 8 份高信心的我會直接放行。',
        sentAt: hoursAgo(4),
      },
    ],
  },
  // 教師張 ↔ 系主任黃：成績送審
  {
    id: convId(DEMO_PERSONAS.TEACHER_CHANG, DEMO_PERSONAS.DEPT_HEAD_HUANG),
    participants: [DEMO_PERSONAS.TEACHER_CHANG, DEMO_PERSONAS.DEPT_HEAD_HUANG],
    messages: [
      {
        id: 'm50',
        fromUid: DEMO_PERSONAS.DEPT_HEAD_HUANG,
        text: '資料庫管理（DB101）期中成績已收到，分布略偏低，是否需要調整？',
        sentAt: daysAgo(2),
      },
      {
        id: 'm51',
        fromUid: DEMO_PERSONAS.TEACHER_CHANG,
        text: 'AI 已標出 3 位風險學生，我會在週五前個別約談並補強。',
        sentAt: daysAgo(2),
      },
    ],
  },
  // 系主任 ↔ 商家：餐飲評議
  {
    id: convId(DEMO_PERSONAS.DEPT_HEAD_HUANG, DEMO_PERSONAS.VENDOR_AYING),
    participants: [DEMO_PERSONAS.DEPT_HEAD_HUANG, DEMO_PERSONAS.VENDOR_AYING],
    messages: [
      {
        id: 'm60',
        fromUid: DEMO_PERSONAS.DEPT_HEAD_HUANG,
        text: '本月學生對中餐部評價 4.3⭐，恭喜。請持續注意花生過敏原標示。',
        sentAt: daysAgo(3),
      },
    ],
  },
  // 系主任 ↔ 管理員：系統設定
  {
    id: convId(DEMO_PERSONAS.DEPT_HEAD_HUANG, DEMO_PERSONAS.ADMIN_SYS),
    participants: [DEMO_PERSONAS.DEPT_HEAD_HUANG, DEMO_PERSONAS.ADMIN_SYS],
    messages: [
      {
        id: 'm70',
        fromUid: DEMO_PERSONAS.ADMIN_SYS,
        text: '本學期新加入 2 位 TA 已開帳號完成。',
        sentAt: daysAgo(5),
      },
    ],
  },
  // 家長 ↔ 教師
  {
    id: convId(DEMO_PERSONAS.PARENT_KU, DEMO_PERSONAS.TEACHER_CHANG),
    participants: [DEMO_PERSONAS.PARENT_KU, DEMO_PERSONAS.TEACHER_CHANG],
    messages: [
      {
        id: 'm80',
        fromUid: DEMO_PERSONAS.PARENT_KU,
        text: '老師您好，最近孩子在家較疲憊，課業上需要特別注意嗎？',
        sentAt: daysAgo(4),
      },
      {
        id: 'm81',
        fromUid: DEMO_PERSONAS.TEACHER_CHANG,
        text: '出席率正常、作業繳交率 92%；AI 建議他在期中前多做 1 次模擬考。',
        sentAt: daysAgo(4),
      },
    ],
  },
];

/**
 * 取得某身分能看到的對話清單。
 *
 * **嚴格規則**：對話只在使用者本身是 participant 之一時才回傳。
 * 不論呼叫端傳什麼 uid，永遠 not leak 別人的對話。
 */
export function getPersonaConversations(viewerUid: string | undefined | null): PersonaConversation[] {
  if (!viewerUid) return [];
  return ALL_CONVERSATIONS.filter((c) => c.participants.includes(viewerUid));
}

/** 對話摘要（給訊息列表用） */
export interface PersonaConversationSummary {
  id: string;
  peerUid: string;
  peerName: string;
  peerRole: PersonaRole;
  lastMessage: string;
  lastMessageAt: string;
  /** 最後一句是不是對方發的（true = 應該回對方） */
  lastFromPeer: boolean;
  unread: boolean;
}

export function getPersonaConversationSummaries(
  viewerUid: string | undefined | null,
): PersonaConversationSummary[] {
  const conversations = getPersonaConversations(viewerUid);
  return conversations
    .map((c) => {
      const last = c.messages[c.messages.length - 1];
      const peerUid = c.participants.find((p) => p !== viewerUid) ?? '';
      const peer = getPersona(peerUid);
      return {
        id: c.id,
        peerUid,
        peerName: peer?.fullName ?? '校內聯絡人',
        peerRole: peer?.role ?? 'student',
        lastMessage: last?.text ?? '',
        lastMessageAt: last?.sentAt ?? new Date().toISOString(),
        lastFromPeer: last?.fromUid !== viewerUid,
        // 簡單規則：對方最後發的、且 < 1 天內 → 視為未讀
        unread: last?.fromUid !== viewerUid && Date.now() - new Date(last?.sentAt ?? 0).getTime() < 86400_000,
      };
    })
    .sort((a, b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime());
}

/** 取得單一對話的完整訊息（嚴格檢查 viewer 是不是 participant） */
export function getPersonaConversationDetail(
  viewerUid: string | undefined | null,
  conversationId: string,
): PersonaConversation | null {
  if (!viewerUid) return null;
  const c = ALL_CONVERSATIONS.find((x) => x.id === conversationId);
  if (!c) return null;
  if (!c.participants.includes(viewerUid)) return null; // ← 嚴格隔離
  return c;
}

// ─────────────────────────────────────────────────────────────────────────
//  AI 編排的「下一步行動」— 每個角色看到的不同
// ─────────────────────────────────────────────────────────────────────────

/** 一張任務卡 — AI 替你想好、按下就做事 */
export interface PersonaMission {
  id: string;
  /** 嚴重度 — 影響顏色與排序 */
  severity: 'critical' | 'warn' | 'info' | 'success';
  /** AI 的「為什麼」這要做 — 用第一人稱解釋 */
  reason: string;
  /** AI 建議的標題 */
  title: string;
  /** 一段話補充情境（給故事感） */
  detail: string;
  /** AI 推算的省下時間（顯示「AI 替你省了 X 分鐘」） */
  savedMinutes?: number;
  /** 主要 CTA 文案 */
  primaryActionLabel: string;
  /** 主要 CTA navigate 目標 — { tab, screen, params } */
  primaryAction: {
    tab?: 'Today' | '學習' | '校園' | '訊息' | '我的';
    screen: string;
    params?: Record<string, unknown>;
  };
  /** 次要動作（通常是「稍後再說」） */
  secondaryActionLabel?: string;
  /** 跨角色關聯：這個 mission 來自誰、影響誰 */
  crossRoleHint?: string;
}

/**
 * 取得角色身分的 AI mission 清單。
 * 每個角色看到的是「AI 已經想完、只剩你下決定」的事情。
 */
export function getPersonaMissions(uid: string | undefined | null): PersonaMission[] {
  const persona = getPersona(uid);
  if (!persona) return [];

  switch (persona.role) {
    case 'student':
      if (persona.uid === DEMO_PERSONAS.STUDENT_PEER) {
        return [
          {
            id: 'peer-1',
            severity: 'info',
            reason: '你和顧晉瑋同組的專題 Demo 在週五',
            title: '加入分組討論室',
            detail: '研討室 G-3 已預約 14:00-16:00，AI 已準備好討論大綱。',
            savedMinutes: 12,
            primaryActionLabel: '進入分組',
            primaryAction: { tab: '訊息', screen: 'GroupDetail', params: { groupId: 'project-team-1' } },
            crossRoleHint: '由你的組員「顧晉瑋」發起',
          },
        ];
      }
      return [
        {
          id: 'stu-1',
          severity: 'critical',
          reason: 'AI 偵測：你「資料庫管理」上週小考 62 分、低於班級平均 12 分',
          title: '15 分鐘錯題複習',
          detail: '我把第三正規化的兩題錯題整理進「錯題本」，建議今晚做完。',
          savedMinutes: 25,
          primaryActionLabel: '開始複習',
          primaryAction: { tab: '學習', screen: 'AcademicInsights', params: { focus: 'mistakes' } },
          secondaryActionLabel: '改明天',
          crossRoleHint: '系主任儀表板上你也被標為「黃燈」，建議今天處理',
        },
        {
          id: 'stu-2',
          severity: 'warn',
          reason: '統計學作業明天到期，AI 預估還需 2.5 小時',
          title: '排入今晚 19:30',
          detail: '已避開你訂的圖書館研討室時段，並提醒室友該時段保持安靜。',
          primaryActionLabel: '加入今日排程',
          primaryAction: { tab: 'Today', screen: 'SmartCalendarScreen' },
        },
        {
          id: 'stu-3',
          severity: 'info',
          reason: '中餐部今日新菜「咖哩雞腿飯」— 已篩掉你的花生過敏原',
          title: '幫你預訂今日午餐',
          detail: 'AI 估計 12:05 排隊最短，已預扣 $90 並通知商家備餐。',
          savedMinutes: 18,
          primaryActionLabel: '確認預訂',
          primaryAction: { tab: '校園', screen: '餐廳總覽' },
          crossRoleHint: '商家後台會即時看到你的訂單',
        },
      ];
    case 'teacher':
      return [
        {
          id: 'tch-1',
          severity: 'critical',
          reason: '收件箱：學生「顧晉瑋」請假待審',
          title: '一鍵核可請假',
          detail: 'AI 已驗證：出席率 96%、無相關小考、補課方案已準備。',
          savedMinutes: 6,
          primaryActionLabel: '審核請假',
          primaryAction: { tab: '訊息', screen: 'Inbox' },
          crossRoleHint: '審核後家長與系主任會同步收到',
        },
        {
          id: 'tch-2',
          severity: 'warn',
          reason: 'AI 已預批 HW3 共 24 份，置信度 ≥ 90% 的 8 份可直接放行',
          title: '檢視 AI 預批成績',
          detail: '其餘 16 份標記原因（圖過小、解題缺步驟）等你確認。',
          savedMinutes: 95,
          primaryActionLabel: '進入成績冊',
          primaryAction: { tab: '學習', screen: 'CourseGradebook', params: { courseId: 'db101' } },
          crossRoleHint: 'TA 林助教正在批另一半，目前批完 12/16',
        },
        {
          id: 'tch-3',
          severity: 'info',
          reason: '本週「資料庫」課程出席異常：學生「林宏志」連續 3 次未到',
          title: '產生關懷訊息草稿',
          detail: 'AI 已寫好溫和提醒訊息，附上補課資源連結。',
          primaryActionLabel: '預覽並發送',
          primaryAction: { tab: '訊息', screen: 'Chat', params: { peerId: DEMO_PERSONAS.STUDENT_PEER } },
        },
      ];
    case 'ta':
      return [
        {
          id: 'ta-1',
          severity: 'warn',
          reason: '張老師指派：HW3 你負責 16 份，AI 預批完成 12 份',
          title: '檢查剩餘 4 份手動批改',
          detail: 'AI 信心 < 70%（圖檔解析度不足），建議你 5 分鐘內掃過。',
          savedMinutes: 32,
          primaryActionLabel: '開始批改',
          primaryAction: { tab: '學習', screen: 'CourseGradebook', params: { courseId: 'db101', filter: 'ta_pending' } },
          crossRoleHint: '完成後成績冊會自動推給張老師覆核',
        },
        {
          id: 'ta-2',
          severity: 'info',
          reason: 'Office Hour 開始前 30 分鐘 — 排隊問題：3 題',
          title: '檢視今日學生問題',
          detail: 'AI 已分群：第三正規化 2 題、ER 圖 1 題。建議集中說明。',
          primaryActionLabel: '進入答疑室',
          primaryAction: { tab: '訊息', screen: 'GroupDetail', params: { groupId: 'ta-office-hour' } },
        },
        {
          id: 'ta-3',
          severity: 'info',
          reason: '學生顧晉瑋在 1:1 私訊有新提問',
          title: '回覆 ER 圖討論',
          detail: '對話已開啟，AI 標示「需要看圖才能回答」。',
          primaryActionLabel: '查看對話',
          primaryAction: { tab: '訊息', screen: 'Chat', params: { peerId: DEMO_PERSONAS.STUDENT_KU } },
        },
      ];
    case 'department_head':
      return [
        {
          id: 'dh-1',
          severity: 'warn',
          reason: 'AI 全系預警：3 位學生本月學業風險升為「黃燈」',
          title: '檢視高風險名單',
          detail: '張怡君（資料庫）已介入 2 位，剩 1 位跨課程預警尚未指派。',
          savedMinutes: 22,
          primaryActionLabel: '開啟學生風險面板',
          primaryAction: { tab: '學習', screen: 'AcademicOverview', params: { tab: 'risk' } },
          crossRoleHint: '介入後家長端 7 天內可選擇是否接收提醒',
        },
        {
          id: 'dh-2',
          severity: 'info',
          reason: '本週課程出席率：資料庫 96% / 統計學 91% / 行銷 88%',
          title: '查看週報並備註異常',
          detail: 'AI 找出行銷學 88% 主因為「實作課時段衝堂」。',
          primaryActionLabel: '開啟週報',
          primaryAction: { tab: '學習', screen: 'LearningAnalytics' },
        },
        {
          id: 'dh-3',
          severity: 'info',
          reason: '商家「中餐部」本月評分 4.3⭐ — 比上月 +0.2',
          title: '檢視商家評議報告',
          detail: 'AI 摘要：素食選項評論增加 18 次，建議擴充。',
          primaryActionLabel: '查看商家報告',
          primaryAction: { tab: '校園', screen: '餐廳總覽' },
          crossRoleHint: '商家阿英也會收到同份報告（不含個別評論）',
        },
      ];
    case 'admin':
      return [
        {
          id: 'adm-1',
          severity: 'critical',
          reason: '系統 24h 內：新增 12 位待認證學生帳號',
          title: '批次認證學生身分',
          detail: 'AI 已比對教務處名單，10 位可一鍵通過，2 位需人工審核。',
          savedMinutes: 45,
          primaryActionLabel: '前往認證佇列',
          primaryAction: { tab: '訊息', screen: 'AdminCourseVerify' },
        },
        {
          id: 'adm-2',
          severity: 'info',
          reason: 'AI 監測：訊息系統未讀數異常下降 35%（與上週同期）',
          title: '查看系統健康面板',
          detail: '初步歸因：新「AI 草稿回覆」上線後回覆速度提高。',
          primaryActionLabel: '開啟系統儀表',
          primaryAction: { tab: '學習', screen: 'AdminDashboard' },
        },
        {
          id: 'adm-3',
          severity: 'success',
          reason: '本週合規檢查通過：1024/1024 名師生 GDPR 同意書完成',
          title: '生成週報並歸檔',
          detail: 'AI 已草擬週報，包含趨勢圖與下週注意事項。',
          primaryActionLabel: '預覽週報',
          primaryAction: { tab: '我的', screen: 'DataExport' },
        },
      ];
    case 'vendor':
      return [
        {
          id: 'ven-1',
          severity: 'warn',
          reason: 'AI 預測 11:30 — 12:30 為今日尖峰，估計 78 份午餐',
          title: '提早 30 分鐘備料',
          detail: '已自動推播給內場員工，預估減少 12 分鐘排隊。',
          savedMinutes: 18,
          primaryActionLabel: '查看備料清單',
          primaryAction: { tab: '校園', screen: '餐廳總覽' },
          crossRoleHint: '學生端會看到「目前等候 < 5 分」標籤',
        },
        {
          id: 'ven-2',
          severity: 'info',
          reason: '咖哩雞腿飯今日已售 23/40 份',
          title: '上架明日新菜「番茄牛肉麵」',
          detail: 'AI 建議定價 $95，預估明日 + 14% 客流。',
          primaryActionLabel: '前往菜單管理',
          primaryAction: { tab: '校園', screen: 'MenuDetail' },
        },
        {
          id: 'ven-3',
          severity: 'info',
          reason: '本週累積評分 4.3⭐（94 則評論）',
          title: '檢視 AI 評論摘要',
          detail: '正面：份量、辣度可調。負面：素食選項少。',
          primaryActionLabel: '查看評論摘要',
          primaryAction: { tab: '校園', screen: '餐廳總覽' },
        },
      ];
    case 'parent':
      return [
        {
          id: 'par-1',
          severity: 'info',
          reason: '孩子本週出席率 100%、作業按時繳交 92%',
          title: '查看孩子本週學習報告',
          detail: 'AI 摘要：表現穩定，但統計學模擬考分數略低。',
          primaryActionLabel: '開啟學習報告',
          primaryAction: { tab: '學習', screen: 'AcademicInsights' },
          crossRoleHint: '此份內容是孩子主動授權分享給您',
        },
        {
          id: 'par-2',
          severity: 'info',
          reason: '張老師回覆了您 4 天前的詢問',
          title: '查看訊息',
          detail: '對話已標記，僅您與張老師可見。',
          primaryActionLabel: '開啟對話',
          primaryAction: { tab: '訊息', screen: 'Chat', params: { peerId: DEMO_PERSONAS.TEACHER_CHANG } },
        },
      ];
    case 'club_officer':
      return [
        {
          id: 'co-1',
          severity: 'warn',
          reason: '資管之夜 2026 距活動只剩 14 天，RSVP 達 64/120',
          title: '發送「最後一週提醒」',
          detail: 'AI 已草擬訊息，分群推播（未回應、可能參加、確認參加）。',
          savedMinutes: 25,
          primaryActionLabel: '檢視草稿並發送',
          primaryAction: { tab: '訊息', screen: 'Groups' },
        },
        {
          id: 'co-2',
          severity: 'info',
          reason: '攝影社外拍 RSVP 還缺 5 人達成最低人數',
          title: '檢視活動詳情',
          detail: 'AI 建議：在資管學會群組轉發合作邀請。',
          primaryActionLabel: '開啟活動',
          primaryAction: { tab: 'Today', screen: '活動總覽' },
        },
      ];
    default:
      return [];
  }
}

// ─────────────────────────────────────────────────────────────────────────
//  收件匣任務（按身分） — 與 inbox 系統對齊
// ─────────────────────────────────────────────────────────────────────────

export interface PersonaInboxTask {
  id: string;
  kind: 'leave_request' | 'grading' | 'discussion_reply' | 'announcement_ack' | 'verify' | 'order_action';
  title: string;
  subtitle: string;
  /** 來自誰（學生提交給老師、商家提交給管理員 …） */
  fromUid?: string;
  /** 任務的關聯課程 */
  courseId?: string;
  /** 點下去要做什麼 */
  action: {
    tab?: 'Today' | '學習' | '校園' | '訊息' | '我的';
    screen: string;
    params?: Record<string, unknown>;
  };
  /** 優先度 — 數字小越優先 */
  priority: number;
  /** 截止時間 */
  dueAt?: string;
}

const ALL_INBOX_TASKS: Record<string, PersonaInboxTask[]> = {
  [DEMO_PERSONAS.STUDENT_KU]: [
    {
      id: 'i-stu-1',
      kind: 'announcement_ack',
      title: '請確認：期中考週時間表',
      subtitle: '校長辦公室 — 你尚未已讀',
      action: { tab: 'Today', screen: '公告總覽' },
      priority: 10,
    },
    {
      id: 'i-stu-2',
      kind: 'grading',
      title: 'HW3 已批改完成',
      subtitle: '資料庫管理 — 你拿 82 分，AI 已生成個人化檢討',
      fromUid: DEMO_PERSONAS.TEACHER_CHANG,
      courseId: 'db101',
      action: { tab: '學習', screen: 'AcademicInsights', params: { focus: 'hw3' } },
      priority: 20,
    },
    {
      id: 'i-stu-3',
      kind: 'discussion_reply',
      title: 'TA 林助教回覆了你的 ER 圖問題',
      subtitle: '資料庫管理 — 私訊 1 則',
      fromUid: DEMO_PERSONAS.TA_LIN,
      action: { tab: '訊息', screen: 'Chat', params: { peerId: DEMO_PERSONAS.TA_LIN } },
      priority: 5,
    },
  ],
  [DEMO_PERSONAS.STUDENT_PEER]: [
    {
      id: 'i-peer-1',
      kind: 'announcement_ack',
      title: '專題分組通知',
      subtitle: '你和顧晉瑋同組 — 請確認分工',
      action: { tab: '訊息', screen: 'Chat', params: { peerId: DEMO_PERSONAS.STUDENT_KU } },
      priority: 8,
    },
  ],
  [DEMO_PERSONAS.TEACHER_CHANG]: [
    {
      id: 'i-tch-1',
      kind: 'leave_request',
      title: '請假待審：顧晉瑋（資料庫管理）',
      subtitle: 'AI 建議：低風險，可一鍵核可',
      fromUid: DEMO_PERSONAS.STUDENT_KU,
      courseId: 'db101',
      action: { tab: '訊息', screen: 'Chat', params: { peerId: DEMO_PERSONAS.STUDENT_KU } },
      priority: 1,
      dueAt: hoursAgo(-24),
    },
    {
      id: 'i-tch-2',
      kind: 'grading',
      title: 'HW3 待覆核（AI 已預批 24 份）',
      subtitle: '資料庫管理 — 信心 ≥ 90% 共 8 份可一鍵放行',
      courseId: 'db101',
      action: { tab: '學習', screen: 'CourseGradebook', params: { courseId: 'db101' } },
      priority: 3,
    },
    {
      id: 'i-tch-3',
      kind: 'discussion_reply',
      title: '林宏志連續 3 次未到 — AI 草擬關懷訊息',
      subtitle: '資料庫管理',
      fromUid: DEMO_PERSONAS.STUDENT_PEER,
      action: { tab: '訊息', screen: 'Chat', params: { peerId: DEMO_PERSONAS.STUDENT_PEER } },
      priority: 12,
    },
  ],
  [DEMO_PERSONAS.TA_LIN]: [
    {
      id: 'i-ta-1',
      kind: 'grading',
      title: 'HW3 你負責的 16 份 — 還剩 4 份',
      subtitle: 'AI 信心 < 70% 需要人工覆核',
      courseId: 'db101',
      action: { tab: '學習', screen: 'CourseGradebook', params: { courseId: 'db101', filter: 'ta_pending' } },
      priority: 1,
    },
    {
      id: 'i-ta-2',
      kind: 'discussion_reply',
      title: '顧晉瑋私訊：ER 圖問題',
      subtitle: 'AI 已標：需要看圖才能回答',
      fromUid: DEMO_PERSONAS.STUDENT_KU,
      action: { tab: '訊息', screen: 'Chat', params: { peerId: DEMO_PERSONAS.STUDENT_KU } },
      priority: 5,
    },
  ],
  [DEMO_PERSONAS.DEPT_HEAD_HUANG]: [
    {
      id: 'i-dh-1',
      kind: 'verify',
      title: '本月 3 位學生風險升級為黃燈',
      subtitle: 'AI 已協調介入計畫',
      action: { tab: '學習', screen: 'AcademicOverview', params: { tab: 'risk' } },
      priority: 2,
    },
    {
      id: 'i-dh-2',
      kind: 'announcement_ack',
      title: '張怡君繳交期中成績單',
      subtitle: '資料庫管理 — 分布略偏低，需備註',
      fromUid: DEMO_PERSONAS.TEACHER_CHANG,
      action: { tab: '學習', screen: 'CourseGradebook', params: { courseId: 'db101' } },
      priority: 8,
    },
    {
      id: 'i-dh-3',
      kind: 'verify',
      title: '商家「中餐部」本月評議報告',
      subtitle: 'AI 建議擴充素食選項',
      fromUid: DEMO_PERSONAS.VENDOR_AYING,
      action: { tab: '校園', screen: '餐廳總覽' },
      priority: 15,
    },
  ],
  [DEMO_PERSONAS.ADMIN_SYS]: [
    {
      id: 'i-adm-1',
      kind: 'verify',
      title: '12 位新學生帳號待認證',
      subtitle: 'AI 已比對教務處名單',
      action: { tab: '訊息', screen: 'AdminCourseVerify' },
      priority: 1,
    },
    {
      id: 'i-adm-2',
      kind: 'announcement_ack',
      title: '系統健康週報已生成',
      subtitle: '待您簽署',
      action: { tab: '學習', screen: 'AdminDashboard' },
      priority: 8,
    },
  ],
  [DEMO_PERSONAS.VENDOR_AYING]: [
    {
      id: 'i-ven-1',
      kind: 'order_action',
      title: '尖峰預測：11:30 — 12:30 估 78 份',
      subtitle: 'AI 已自動推播給內場',
      action: { tab: '校園', screen: '餐廳總覽' },
      priority: 1,
    },
    {
      id: 'i-ven-2',
      kind: 'order_action',
      title: '咖哩雞腿飯 23/40 份',
      subtitle: '預估 13:00 售完，是否補餐？',
      action: { tab: '校園', screen: 'MenuDetail' },
      priority: 5,
    },
    {
      id: 'i-ven-3',
      kind: 'verify',
      title: '本週評論摘要',
      subtitle: '4.3⭐ — 素食選項評論 +18',
      action: { tab: '校園', screen: '餐廳總覽' },
      priority: 18,
    },
  ],
  [DEMO_PERSONAS.PARENT_KU]: [
    {
      id: 'i-par-1',
      kind: 'announcement_ack',
      title: '孩子本週學習報告已生成',
      subtitle: '孩子授權分享',
      action: { tab: '學習', screen: 'AcademicInsights' },
      priority: 2,
    },
    {
      id: 'i-par-2',
      kind: 'discussion_reply',
      title: '張老師回覆了您的詢問',
      subtitle: '私訊 1 則',
      fromUid: DEMO_PERSONAS.TEACHER_CHANG,
      action: { tab: '訊息', screen: 'Chat', params: { peerId: DEMO_PERSONAS.TEACHER_CHANG } },
      priority: 5,
    },
  ],
  [DEMO_PERSONAS.CLUB_OFFICER_WEI]: [
    {
      id: 'i-co-1',
      kind: 'announcement_ack',
      title: '資管之夜 2026 — RSVP 達 64/120',
      subtitle: '距活動只剩 14 天',
      action: { tab: '訊息', screen: 'Groups' },
      priority: 2,
    },
  ],
};

export function getPersonaInbox(uid: string | undefined | null): PersonaInboxTask[] {
  if (!uid) return [];
  return (ALL_INBOX_TASKS[uid] ?? []).slice().sort((a, b) => a.priority - b.priority);
}

// ─────────────────────────────────────────────────────────────────────────
//  跨角色「事實流」事件 — 給 demo 講師敘事用
// ─────────────────────────────────────────────────────────────────────────

export interface CrossRoleEvent {
  id: string;
  title: string;
  /** 來源角色（產生事件的人） */
  fromRole: PersonaRole;
  /** 目標角色（會看到事件的人們） */
  toRoles: PersonaRole[];
  description: string;
}

export const CROSS_ROLE_EVENTS: CrossRoleEvent[] = [
  {
    id: 'leave_chain',
    title: '請假事件鏈',
    fromRole: 'student',
    toRoles: ['teacher', 'parent', 'department_head'],
    description: '學生送請假 → 教師收件匣 + AI 風險評估 → 核可後家長端標記 → 系主任儀表板出席率即時更新',
  },
  {
    id: 'grading_chain',
    title: 'AI 預批 → TA → 教師覆核 → 學生收件',
    fromRole: 'teacher',
    toRoles: ['ta', 'student', 'parent'],
    description: '教師指派 HW → AI 預批 → TA 處理低信心 → 教師覆核 → 學生收到個人化檢討 → 家長端週報',
  },
  {
    id: 'meal_chain',
    title: '商家備料 ↔ 學生餐點推薦',
    fromRole: 'vendor',
    toRoles: ['student', 'admin'],
    description: '商家上架菜單 → AI 依過敏原過濾後推薦給學生 → 學生預訂 → 商家備餐 → 評分迴流',
  },
  {
    id: 'risk_chain',
    title: '跨課程學業風險',
    fromRole: 'admin',
    toRoles: ['department_head', 'teacher', 'student', 'parent'],
    description: 'AI 跨課程關聯分析 → 系主任收到黃燈名單 → 派給授課教師 → 學生收到溫和提醒 → 家長 7 天後可選擇接收',
  },
];
