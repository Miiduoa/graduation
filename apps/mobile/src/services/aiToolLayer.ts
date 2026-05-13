import type { AssistantActionProposal, CampusActorRole } from '../data/types';
import type { AIContext } from './ai';
import {
  filterMainMealCandidates,
  formatLunchRecommendationReply,
  messageWantsMainMealRecommendation,
  parseBudgetCapFromMessage,
  recommendLunchCandidates,
} from './recommendLunch';
import {
  getPermissions,
  getRoleGroup,
  type AppRole,
  type Permission,
  type RoleGroup,
} from './permissions';

export type AIToolLayerIntent =
  | 'schedule_lookup'
  | 'recommend_lunch'
  | 'assignment_lookup'
  | 'calendar_lookup'
  | 'dining_lookup'
  | 'order_action'
  | 'order_status'
  | 'repair_status'
  | 'library_status'
  | 'print_status'
  | 'dorm_status'
  | 'health_status'
  | 'seat_status'
  | 'washing_status'
  | 'notification_lookup'
  | 'role_capability'
  | 'app_data_search'
  | 'general';

export type AIToolLayerStep = {
  step: string;
  detail: string;
  status: 'done' | 'checking' | 'warning' | 'info';
};

export type AIToolLayerInsight = {
  key: string;
  label: string;
  value: string;
  severity?: 'info' | 'warning' | 'critical';
  evidence?: string[];
};

export type AICrossRoleEffect = {
  sourceRole: CampusActorRole | 'faculty' | 'vendor' | 'guest';
  action: string;
  targetRoles: Array<CampusActorRole | 'faculty' | 'vendor' | 'student' | 'guest'>;
  targetWork: string;
  confirmationRequired: boolean;
  dataScope: 'private' | 'school' | 'public' | 'cross_role';
  notes?: string;
};

export type AIDelegatedPermissionProfile = {
  mode: 'max_delegated';
  role: CampusActorRole | 'faculty' | 'vendor' | 'guest';
  roleLabel: string;
  signedIn: boolean;
  roleGroup: RoleGroup | 'guest';
  permissionLevel: 'guest_public' | 'user_role' | 'admin_role';
  allowedPermissions: Permission[];
  canReadAllAccessibleAppData: boolean;
  canUseAllRoleTools: boolean;
  canRunBackgroundAwareness: boolean;
  canDraftCrossRoleActions: boolean;
  canExecuteAfterConfirmation: boolean;
  canBypassBackendRules: false;
  readableDataSources: string[];
  blockedDataSources: string[];
  missingDataSources: string[];
  toolActions: string[];
  requiresConfirmationFor: string[];
  policySummary: string;
};

export type AIToolLayerResult = {
  intent: AIToolLayerIntent;
  confidence: number;
  toolName: string;
  handled: boolean;
  answer?: string;
  actions?: AssistantActionProposal[];
  steps: AIToolLayerStep[];
  insights: AIToolLayerInsight[];
  crossRoleEffects: AICrossRoleEffect[];
  permissionProfile?: AIDelegatedPermissionProfile;
};

export type AIRoleCapability = {
  key: string;
  label: string;
  description: string;
  actions: string[];
};

const DAY_NAMES = ['週日', '週一', '週二', '週三', '週四', '週五', '週六'];
const ROLE_LABELS: Record<string, string> = {
  student: '學生',
  teacher: '教師',
  faculty: '教師',
  staff: '職員',
  department: '系所',
  department_head: '系主任/主管',
  admin: '管理員',
  vendor: '店家',
  guest: '訪客',
};

function compact(value: unknown): string {
  return String(value ?? '').trim();
}

function normalize(value: unknown): string {
  return compact(value)
    .toLowerCase()
    .replace(/[０-９]/g, (digit) => String.fromCharCode(digit.charCodeAt(0) - 0xfee0))
    .replace(/[\s｜|、，,。．.（）()【】\[\]{}「」『』\-—_]/g, '');
}

function toDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value === 'object' && typeof (value as any).seconds === 'number') {
    const date = new Date((value as any).seconds * 1000);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
}

function startOfDay(date: Date): Date {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function addDays(date: Date, days: number): Date {
  const copy = startOfDay(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

function formatDate(date: Date): string {
  return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}（${DAY_NAMES[date.getDay()]}）`;
}

function parseRequestedDate(message: string, now = new Date()): { date: Date; label: string } {
  const today = startOfDay(now);
  if (/後天/.test(message)) {
    const date = addDays(today, 2);
    return { date, label: `後天 ${formatDate(date)}` };
  }
  if (/明天/.test(message)) {
    const date = addDays(today, 1);
    return { date, label: `明天 ${formatDate(date)}` };
  }
  if (/今天/.test(message)) {
    return { date: today, label: `今天 ${formatDate(today)}` };
  }
  const dayMatch = message.match(/(?:星期|週|禮拜)(一|二|三|四|五|六|日|天)/);
  if (dayMatch) {
    const map: Record<string, number> = { 日: 0, 天: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6 };
    const targetDay = map[dayMatch[1]] ?? today.getDay();
    const delta = (targetDay - today.getDay() + 7) % 7;
    const date = addDays(today, delta);
    return { date, label: `${DAY_NAMES[targetDay]} ${formatDate(date)}` };
  }
  return { date: today, label: `今天 ${formatDate(today)}` };
}

function normalizeDay(day: unknown): number | null {
  if (typeof day !== 'number' || !Number.isFinite(day)) return null;
  if (day === 7) return 0;
  if (day >= 0 && day <= 6) return day;
  return null;
}

type CourseItem = NonNullable<AIContext['courses']>[number];
type MeetingItem = NonNullable<CourseItem['schedule']>[number];
type NormalizedMeetingItem = MeetingItem & { dayOfWeek: number };

function getCourseMeetings(course: CourseItem): NormalizedMeetingItem[] {
  if (Array.isArray(course.schedule) && course.schedule.length > 0) {
    return course.schedule
      .map((meeting) => {
        const dayOfWeek = normalizeDay(meeting.dayOfWeek);
        return dayOfWeek == null ? null : { ...meeting, dayOfWeek };
      })
      .filter((meeting): meeting is NormalizedMeetingItem => Boolean(meeting));
  }
  const dayOfWeek = normalizeDay(course.dayOfWeek);
  if (dayOfWeek == null) return [];
  return [
    {
      dayOfWeek,
      startPeriod: course.startPeriod,
      endPeriod: course.endPeriod,
      startTime: course.startTime,
      endTime: course.endTime,
      location: course.location,
    },
  ];
}

function meetingSortValue(meeting: NormalizedMeetingItem): number {
  if (typeof meeting.startPeriod === 'number') return meeting.startPeriod * 100;
  if (meeting.startTime) {
    const [hour, minute] = meeting.startTime.split(':').map(Number);
    if (Number.isFinite(hour) && Number.isFinite(minute)) return hour * 60 + minute;
  }
  return Number.MAX_SAFE_INTEGER;
}

function formatMeetingTime(meeting: NormalizedMeetingItem): string {
  if (typeof meeting.startPeriod === 'number') {
    const end =
      typeof meeting.endPeriod === 'number' && meeting.endPeriod !== meeting.startPeriod
        ? `-${meeting.endPeriod}`
        : '';
    return `第${meeting.startPeriod}${end}節`;
  }
  if (meeting.startTime && meeting.endTime) return `${meeting.startTime}-${meeting.endTime}`;
  if (meeting.startTime) return meeting.startTime;
  return '時間未提供';
}

function sortAssignmentsByUrgency(assignments: NonNullable<AIContext['pendingAssignments']>) {
  return [...assignments].sort((a, b) => {
    if (a.isLate !== b.isLate) return a.isLate ? -1 : 1;
    const left = toDate(a.dueAt)?.getTime() ?? Number.POSITIVE_INFINITY;
    const right = toDate(b.dueAt)?.getTime() ?? Number.POSITIVE_INFINITY;
    return left - right;
  });
}

function formatAssignmentSprintReply(
  assignments: NonNullable<AIContext['pendingAssignments']>,
  context?: AIContext,
): string {
  const sorted = sortAssignmentsByUrgency(assignments);
  const top = sorted[0];
  const due = toDate(top.dueAt);
  const dueLabel = due ? formatDate(due) : '截止時間未提供';
  const gradeHint =
    context?.gradesSummary?.courses
      ?.filter((course) => typeof course.grade === 'number')
      .sort((a, b) => (a.grade ?? 100) - (b.grade ?? 100))
      .slice(0, 2)
      .map((course) => `${course.name} ${course.grade} 分`)
      .join('、') || '目前沒有可驗證的成績趨勢';

  return [
    `我會先處理「${top.title}」（${top.groupName || '課程未標明'}，${dueLabel}${top.isLate ? '，已逾期' : ''}）。`,
    '',
    '今天可執行步驟：',
    '1. 10 分鐘：打開題目與繳交規格，列出必交項目和格式。',
    '2. 25 分鐘：完成最核心的一段內容或第一題，不先追求完美。',
    '3. 5 分鐘：比對 rubric / 教師要求，標出缺口。',
    '4. 25 分鐘：補齊缺口，整理可提交版本。',
    '5. 10 分鐘：檢查檔名、附件、引用與上傳狀態。',
    '',
    `排序依據：${assignments.length} 項待處理作業/測驗、截止時間、逾期狀態與成績線索（${gradeHint}）。`,
  ].join('\n');
}

function detectIntent(message: string): { intent: AIToolLayerIntent; confidence: number; toolName: string } {
  const msg = message.toLowerCase();
  const rules: Array<[AIToolLayerIntent, RegExp, number, string]> = [
    ['schedule_lookup', /課表|上課|有課|什麼課|哪幾堂課|幾堂課|幾點上課|早八/, 0.92, '課表查詢'],
    [
      'recommend_lunch',
      /推薦.*(午餐|午飯|正餐)|午餐.*(推薦|吃什麼|要吃)|今天中午吃什麼|中午吃什麼|吃午飯|午飯吃什麼|幫我.*午餐|今天.*午餐|正餐.*吃什麼/,
      0.9,
      '午餐推薦',
    ],
    ['order_action', /幫我.*(點|訂)|我要(點|訂|吃)|點餐|訂餐|下單|來一份|點一份/, 0.9, '點餐代理'],
    ['dining_lookup', /吃什麼|推薦.*(餐|吃)|餐點|菜單|餐廳|午餐|晚餐|早餐|好餓/, 0.82, '餐飲查詢'],
    ['assignment_lookup', /作業|截止|待繳|期限|逾期|deadline/, 0.9, '作業演算'],
    ['calendar_lookup', /行程|行事曆|活動|今天.*安排|明天.*安排|有沒有事/, 0.82, '行程查詢'],
    ['order_status', /訂單|餐點.*狀態|下單.*狀態|取餐/, 0.86, '訂單狀態查詢'],
    ['repair_status', /報修|維修|工單|宿舍.*壞|冷氣|漏水|網路壞/, 0.84, '報修狀態查詢'],
    ['library_status', /借書|借閱|到期|還書|圖書館.*書/, 0.84, '借閱狀態查詢'],
    ['print_status', /列印|影印|印表|印報告|列印餘額/, 0.84, '列印狀態查詢'],
    ['dorm_status', /包裹|快遞|宿舍|寢室|門禁/, 0.8, '宿舍資料查詢'],
    ['health_status', /掛號|預約.*(看診|諮商)|衛保|健康|門診/, 0.82, '健康預約查詢'],
    ['seat_status', /座位|自習室|討論室|預約位|圖書館.*位/, 0.82, '座位預約查詢'],
    ['washing_status', /洗衣|烘衣|洗衣機|烘衣機/, 0.82, '洗衣預約查詢'],
    ['notification_lookup', /通知|訊息|未讀|提醒|公告/, 0.72, '通知查詢'],
    ['role_capability', /你能做什麼|可以做什麼|代理|功能|權限|角色/, 0.78, '角色能力查詢'],
    ['app_data_search', /我的資料|掌握.*資料|所有資料|幫我查|查一下|目前狀態|狀態總覽/, 0.68, 'App 資料搜尋'],
  ];

  for (const [intent, pattern, confidence, toolName] of rules) {
    if (pattern.test(msg)) return { intent, confidence, toolName };
  }
  return { intent: 'general', confidence: 0.35, toolName: '一般資料檢索' };
}

function toPermissionRole(role?: CampusActorRole | 'faculty' | 'vendor' | 'guest' | null): AppRole | null {
  switch (role) {
    case 'student':
      return 'student';
    case 'teacher':
    case 'faculty':
      return 'teacher';
    case 'staff':
    case 'vendor':
      return 'staff';
    case 'department':
    case 'department_head':
    case 'school':
      return 'department_head';
    case 'admin':
      return 'admin';
    default:
      return null;
  }
}

function formatCoverageSource(row: NonNullable<AIContext['appDataCoverage']>[number]): string {
  const count = row.count > 0 ? ` ${row.count} 筆` : '';
  const detail = row.detail ? `（${row.detail}）` : '';
  return `${row.label}${count}${detail}`;
}

export function buildAIDelegatedPermissionProfile(context?: AIContext): AIDelegatedPermissionProfile {
  const role = (context?.role ?? 'guest') as AIDelegatedPermissionProfile['role'];
  const appRole = toPermissionRole(role);
  const signedIn = Boolean(context?.userId);
  const allowedPermissions = appRole ? [...getPermissions(appRole)] : [];
  const roleGroup = appRole ? getRoleGroup(appRole) : 'guest';
  const capabilities = getRoleToolCapabilities(role);
  const toolActions = Array.from(new Set(capabilities.flatMap((capability) => capability.actions)));
  const coverage = context?.appDataCoverage ?? [];
  const readableDataSources =
    coverage
      .filter((row) => row.state === 'live' || row.state === 'empty')
      .map(formatCoverageSource)
      .slice(0, 18);
  if (readableDataSources.length === 0 && (context?.appDataRecords?.length ?? 0) > 0) {
    readableDataSources.push(`App 資料索引 ${context?.appDataRecords?.length ?? 0} 筆`);
  }
  const blockedDataSources = coverage
    .filter((row) => row.state === 'blocked')
    .map(formatCoverageSource)
    .slice(0, 12);
  const missingDataSources = coverage
    .filter((row) => row.state === 'missing')
    .map(formatCoverageSource)
    .slice(0, 12);
  const requiresConfirmationFor = [
    '建立/修改/刪除資料',
    '點餐、預約、報修、列印、發訊息',
    '通知其他角色或產生跨角色待辦',
    '送出會影響帳務、健康、課務、宿舍、圖書館或店家端狀態的操作',
  ];
  const permissionLevel =
    role === 'admin' && signedIn ? 'admin_role' : signedIn && appRole ? 'user_role' : 'guest_public';
  const canExecuteAfterConfirmation = signedIn && appRole !== null;
  const policySummary = signedIn
    ? `最大委派權限：讀取目前角色可合法存取的全部 App/使用者資料，啟用全部角色工具；寫入與跨角色操作必須先確認；不能繞過 Firestore/後端規則。`
    : '訪客模式：只能使用公開或本機已存在資料，不能讀取私人資料，也不能代理送出操作。';

  return {
    mode: 'max_delegated',
    role,
    roleLabel: ROLE_LABELS[String(role)] ?? String(role),
    signedIn,
    roleGroup,
    permissionLevel,
    allowedPermissions,
    canReadAllAccessibleAppData: true,
    canUseAllRoleTools: signedIn && appRole !== null,
    canRunBackgroundAwareness: true,
    canDraftCrossRoleActions: canExecuteAfterConfirmation,
    canExecuteAfterConfirmation,
    canBypassBackendRules: false,
    readableDataSources,
    blockedDataSources,
    missingDataSources,
    toolActions,
    requiresConfirmationFor,
    policySummary,
  };
}

export function getRoleToolCapabilities(
  role?: CampusActorRole | 'faculty' | 'vendor' | 'guest' | null,
): AIRoleCapability[] {
  const normalizedRole = role ?? 'guest';
  const common: AIRoleCapability[] = [
    {
      key: 'ambient_awareness',
      label: '背景資料感知',
      description: '持續整理 App 可讀資料、權限狀態、近期事件與使用者待處理事項。',
      actions: ['讀取 App context', '建立資料索引', '計算近期風險'],
    },
    {
      key: 'safe_execution',
      label: '安全代理操作',
      description: '會寫入資料或通知他人的動作，必須先產生確認卡，再交給正式 executor。',
      actions: ['確認卡', '草稿', '正式 API 執行'],
    },
  ];

  if (normalizedRole === 'teacher' || normalizedRole === 'faculty') {
    return [
      ...common,
      {
        key: 'teaching',
        label: '教學工作流',
        description: '課程、作業、出席、互評、學習分析與學生提醒。',
        actions: ['查課程', '發布作業', '出席警示', '學習分析', '群組訊息草稿'],
      },
    ];
  }
  if (normalizedRole === 'staff') {
    return [
      ...common,
      {
        key: 'service_ops',
        label: '校園服務工作流',
        description: '報修、列印、宿舍、衛保、圖書館與服務案件處理。',
        actions: ['查服務案件', '更新狀態', '建立通知草稿', '導向服務後台'],
      },
    ];
  }
  if (normalizedRole === 'admin' || normalizedRole === 'department_head') {
    return [
      ...common,
      {
        key: 'admin_ops',
        label: '管理工作流',
        description: '跨模組資料監控、公告、審核、系所/學校層級分析。',
        actions: ['查總覽', '審核導向', '公告草稿', '風險摘要'],
      },
    ];
  }
  if (normalizedRole === 'vendor') {
    return [
      ...common,
      {
        key: 'merchant_ops',
        label: '店家工作流',
        description: '菜單、訂單、接單狀態、取餐通知與營運摘要。',
        actions: ['查訂單', '更新餐點狀態', '菜單導向', '店家通知'],
      },
    ];
  }
  if (normalizedRole === 'student') {
    return [
      ...common,
      {
        key: 'student_life',
        label: '學生校園生活',
        description: '課表、作業、成績摘要、餐飲、圖書館、宿舍、列印、衛保與提醒。',
        actions: ['查課表', '查作業', '點餐確認', '預約/報修', '提醒草稿'],
      },
    ];
  }
  return [
    ...common,
    {
      key: 'guest_public',
      label: '訪客公開資料',
      description: '只能回答公開校園資訊，不能讀私人課表或代操作。',
      actions: ['公開公告', '地點資訊', '功能導覽'],
    },
  ];
}

export function getCrossRoleEffectsForIntent(params: {
  role?: CampusActorRole | null;
  intent: AIToolLayerIntent;
  message?: string;
}): AICrossRoleEffect[] {
  const role = (params.role ?? 'guest') as AICrossRoleEffect['sourceRole'];
  const msg = params.message ?? '';
  const effects: AICrossRoleEffect[] = [];
  const add = (effect: Omit<AICrossRoleEffect, 'sourceRole'>) => {
    effects.push({ sourceRole: role, ...effect });
  };

  if (params.intent === 'order_action') {
    add({
      action: '餐飲點餐/下單',
      targetRoles: ['vendor', 'staff'],
      targetWork: '店家端收到訂單、確認/拒單、準備餐點、更新取餐狀態',
      confirmationRequired: true,
      dataScope: 'cross_role',
      notes: '未確認前只能產生候選餐點或草稿；確認後才可寫入訂單。',
    });
  }
  if (params.intent === 'repair_status' || /報修|維修|壞|漏水|冷氣|網路/.test(msg)) {
    add({
      action: '宿舍/校園報修',
      targetRoles: ['staff'],
      targetWork: '宿舍管理員或總務維修人員收到工單、派工、回覆處理狀態',
      confirmationRequired: true,
      dataScope: 'cross_role',
      notes: '需要房號、問題描述、照片/位置等資料才能正式送出。',
    });
  }
  if (params.intent === 'health_status' || /掛號|看診|諮商|衛保/.test(msg)) {
    add({
      action: '衛保/諮商預約',
      targetRoles: ['staff'],
      targetWork: '衛保組或諮商中心收到預約需求、排定時段、回覆確認',
      confirmationRequired: true,
      dataScope: 'private',
    });
  }
  if (params.intent === 'seat_status' || /預約.*(座位|討論室)|自習室/.test(msg)) {
    add({
      action: '圖書館座位預約',
      targetRoles: ['staff'],
      targetWork: '圖書館系統保留座位或討論室，逾時未報到會釋放',
      confirmationRequired: true,
      dataScope: 'cross_role',
    });
  }
  if (params.intent === 'print_status' || /列印|影印|印報告/.test(msg)) {
    add({
      action: '列印送件',
      targetRoles: ['staff'],
      targetWork: '列印服務端收到檔案、頁數、付款/取件狀態',
      confirmationRequired: true,
      dataScope: 'cross_role',
    });
  }
  if (/請假/.test(msg)) {
    add({
      action: '請假申請',
      targetRoles: ['teacher', 'faculty', 'staff'],
      targetWork: '授課教師或課務承辦收到申請，審核假別與證明文件',
      confirmationRequired: true,
      dataScope: 'private',
    });
  }
  if (/發作業|發布作業|互評|出席警示|通知學生/.test(msg)) {
    add({
      action: '教學端任務發布',
      targetRoles: ['student'],
      targetWork: '學生端收到作業、互評、出席警示或課程通知',
      confirmationRequired: true,
      dataScope: 'cross_role',
    });
  }
  if (/公告|發布公告|審核/.test(msg)) {
    add({
      action: '公告/審核流程',
      targetRoles: ['student', 'teacher', 'faculty', 'staff', 'admin'],
      targetWork: '目標角色收到公告、待審核項目或狀態更新',
      confirmationRequired: true,
      dataScope: 'school',
    });
  }

  return effects;
}

export function buildUserComputationInsights(context?: AIContext, now = new Date()): AIToolLayerInsight[] {
  const insights: AIToolLayerInsight[] = [];
  const today = startOfDay(now);
  const tomorrow = addDays(today, 1);
  const inSevenDays = addDays(today, 7);

  const lateAssignments = (context?.pendingAssignments ?? []).filter((assignment) => assignment.isLate);
  const dueSoonAssignments = (context?.pendingAssignments ?? []).filter((assignment) => {
    const due = toDate(assignment.dueAt);
    return due ? due >= today && due <= inSevenDays : false;
  });
  if (lateAssignments.length > 0) {
    insights.push({
      key: 'late_assignments',
      label: '逾期作業',
      value: `${lateAssignments.length} 份逾期`,
      severity: 'critical',
      evidence: lateAssignments.slice(0, 3).map((item) => item.title),
    });
  }
  if (dueSoonAssignments.length > 0) {
    insights.push({
      key: 'due_soon_assignments',
      label: '七日內截止作業',
      value: `${dueSoonAssignments.length} 份即將截止`,
      severity: 'warning',
      evidence: dueSoonAssignments.slice(0, 3).map((item) => item.title),
    });
  }

  const tomorrowCourses = (context?.courses ?? []).flatMap((course) =>
    getCourseMeetings(course)
      .filter((meeting) => meeting.dayOfWeek === tomorrow.getDay())
      .map((meeting) => `${course.name} ${formatMeetingTime(meeting)}`),
  );
  insights.push({
    key: 'tomorrow_courses',
    label: '明日課表演算',
    value: tomorrowCourses.length > 0 ? `${tomorrowCourses.length} 堂課` : '明天沒有課或沒有課表時段',
    severity: 'info',
    evidence: tomorrowCourses.slice(0, 4),
  });

  const upcomingEvents = (context?.calendarEvents ?? []).filter((event) => {
    const start = toDate(event.startAt);
    return start ? start >= today && start <= inSevenDays : false;
  });
  if (upcomingEvents.length > 0) {
    insights.push({
      key: 'upcoming_events',
      label: '七日內行程',
      value: `${upcomingEvents.length} 筆行程`,
      severity: 'info',
      evidence: upcomingEvents.slice(0, 4).map((event) => event.title),
    });
  }

  const activeOrders = (context?.orders ?? []).filter((order) =>
    /pending|preparing|ready|created|confirmed|待|準備|完成/.test(order.status),
  );
  if (activeOrders.length > 0) {
    insights.push({
      key: 'active_orders',
      label: '餐飲訂單',
      value: `${activeOrders.length} 筆近期訂單`,
      severity: 'info',
      evidence: activeOrders.slice(0, 3).map((order) => `${order.cafeteria ?? order.merchantName ?? '餐廳'} ${order.status}`),
    });
  }

  const openRepairs = (context?.repairRequests ?? []).filter((item) => !/done|closed|resolved|完成|結案/.test(item.status));
  if (openRepairs.length > 0) {
    insights.push({
      key: 'open_repairs',
      label: '未完成報修',
      value: `${openRepairs.length} 筆處理中`,
      severity: 'warning',
      evidence: openRepairs.slice(0, 3).map((item) => `${item.title ?? item.type} ${item.status}`),
    });
  }

  const dueLoans = (context?.libraryLoans ?? []).filter((loan) => {
    const due = toDate(loan.dueAt);
    return due ? due >= today && due <= inSevenDays : false;
  });
  if (dueLoans.length > 0) {
    insights.push({
      key: 'library_due',
      label: '借閱到期',
      value: `${dueLoans.length} 本七日內到期`,
      severity: 'warning',
      evidence: dueLoans.slice(0, 3).map((loan) => loan.bookTitle ?? loan.bookId),
    });
  }

  const blocked = context?.appDataCoverage?.filter((item) => item.state === 'blocked') ?? [];
  if (blocked.length > 0) {
    insights.push({
      key: 'blocked_sources',
      label: '資料權限不足',
      value: `${blocked.length} 類資料被權限阻擋`,
      severity: 'warning',
      evidence: blocked.slice(0, 4).map((item) => item.label),
    });
  }

  return insights;
}

function formatInsights(insights: AIToolLayerInsight[]): string {
  if (insights.length === 0) return '目前沒有需要特別提醒的演算結果。';
  return insights
    .slice(0, 8)
    .map((insight) => {
      const evidence = insight.evidence?.length ? `：${insight.evidence.join('、')}` : '';
      return `- ${insight.label}：${insight.value}${evidence}`;
    })
    .join('\n');
}

function formatCrossRoleEffects(effects: AICrossRoleEffect[]): string {
  if (effects.length === 0) return '沒有觸發其他角色的待辦。';
  return effects
    .slice(0, 6)
    .map(
      (effect) =>
        `- ${ROLE_LABELS[String(effect.sourceRole)] ?? effect.sourceRole}「${effect.action}」→ ${effect.targetRoles
          .map((role) => ROLE_LABELS[String(role)] ?? String(role))
          .join('、')}：${effect.targetWork}${effect.confirmationRequired ? '（需確認）' : ''}`,
    )
    .join('\n');
}

function retrieveRecords(context: AIContext | undefined, message: string): NonNullable<AIContext['appDataRecords']> {
  const records = context?.appDataRecords ?? [];
  const tokens = Array.from(
    new Set(
      (normalize(message).match(/[\u4e00-\u9fff]{2,}|[a-z0-9]{2,}/gi) ?? [])
        .map((part) => part.trim())
        .filter(Boolean),
    ),
  );
  if (tokens.length === 0) return records.slice(0, 6);
  return records
    .map((record) => {
      const text = normalize(`${record.label} ${record.text}`);
      const score = tokens.reduce((sum, token) => sum + (text.includes(token) ? 1 : 0), record.priority ?? 0);
      return { record, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.record)
    .slice(0, 8);
}

export function runAIToolLayer(params: {
  message: string;
  context?: AIContext;
  now?: Date;
}): AIToolLayerResult {
  const { message, context, now = new Date() } = params;
  const detected = detectIntent(message);
  const insights = buildUserComputationInsights(context, now);
  const crossRoleEffects = getCrossRoleEffectsForIntent({
    role: context?.role,
    intent: detected.intent,
    message,
  });
  const steps: AIToolLayerStep[] = [
    {
      step: '先看你的問題',
      detail: `歸在「${detected.toolName}」這一類`,
      status: detected.confidence >= 0.7 ? 'done' : 'checking',
    },
    {
      step: '讀一下 App 裡的資料',
      detail: `約 ${context?.appDataRecords?.length ?? 0} 筆可搜、${context?.appDataCoverage?.length ?? 0} 類有載入`,
      status: (context?.appDataRecords?.length ?? 0) > 0 ? 'done' : 'warning',
    },
    {
      step: '整理重點',
      detail: `順手標出 ${insights.length} 件可能和你有關的狀態`,
      status: 'done',
    },
    {
      step: '會不會牽連到別人',
      detail:
        crossRoleEffects.length > 0
          ? `可能會通知到：${crossRoleEffects.map((effect) => effect.targetRoles.join('、')).join('；')}`
          : '這題多半只動到你手機裡的資料，不會丟給店家或行政',
      status: crossRoleEffects.some((effect) => effect.confirmationRequired) ? 'warning' : 'done',
    },
  ];

  switch (detected.intent) {
    case 'schedule_lookup': {
      const { date, label } = parseRequestedDate(message, now);
      const rows = (context?.courses ?? [])
        .flatMap((course) =>
          getCourseMeetings(course)
            .filter((meeting) => meeting.dayOfWeek === date.getDay())
            .map((meeting) => ({ course, meeting })),
        )
        .sort((a, b) => meetingSortValue(a.meeting) - meetingSortValue(b.meeting));
      if ((context?.courses?.length ?? 0) === 0) {
        return {
          ...detected,
          handled: true,
          steps,
          insights,
          crossRoleEffects,
          answer: '目前沒有載入課程資料，所以不能判斷課表。請先同步課表；同步後我會用結構化課表演算，不會用模型猜。',
          actions: [{ label: '前往課表同步', action: 'navigate', params: { screen: '課程', nested: 'CourseSchedule' } }],
        };
      }
      if (rows.length === 0) {
        return {
          ...detected,
          handled: true,
          steps,
          insights,
          crossRoleEffects,
          answer: `${label}沒有課。\n\n我是用已載入的 ${context?.courses?.length ?? 0} 門課逐筆比對 ${DAY_NAMES[date.getDay()]} 的上課時段後得到這個結果。`,
        };
      }
      const list = rows
        .map(({ course, meeting }, i) => {
          const teacher = course.teacher ? `，${course.teacher}` : '';
          return `${i + 1}. ${course.name}（${formatMeetingTime(meeting)}${meeting.location ? `，${meeting.location}` : ''}${teacher}）`;
        })
        .join('\n');
      return {
        ...detected,
        handled: true,
        steps,
        insights,
        crossRoleEffects,
        answer: `${label}有 ${rows.length} 堂課：\n\n${list}`,
        actions: [{ label: '開啟課表', action: 'navigate', params: { screen: '課程', nested: 'CourseSchedule' } }],
      };
    }

    case 'recommend_lunch': {
      const menus = context?.menus ?? [];
      if (menus.length === 0) {
        return {
          ...detected,
          handled: true,
          steps,
          insights,
          crossRoleEffects,
          answer:
            '目前沒有載入菜單，我沒辦法幫你挑餐。請先到「校園 → 點餐」或餐廳頁同步菜單，再問我一次。',
          actions: [{ label: '開啟點餐', action: 'navigate', params: { screen: '校園', nested: 'Ordering' } }],
        };
      }
      const budget = parseBudgetCapFromMessage(message);
      const mealLabel = /晚餐|晚飯|今晚/.test(message) ? '晚餐' : /早餐|早飯/.test(message) ? '早餐' : '午餐';
      const { items } = recommendLunchCandidates(menus, { budgetCap: budget, maxItems: 3 });
      return {
        ...detected,
        handled: true,
        steps,
        insights,
        crossRoleEffects,
        answer: formatLunchRecommendationReply(items, { mealLabel }),
        actions: [{ label: '開啟點餐', action: 'navigate', params: { screen: '校園', nested: 'Ordering' } }],
      };
    }

    case 'assignment_lookup': {
      const assignments = context?.pendingAssignments ?? [];
      const wantsSprintPlan = /拆|步驟|衝刺|今天最重要|最重要|可執行|可用時間|讀書節奏|安排/.test(message);
      if (assignments.length === 0) {
        return {
          ...detected,
          handled: true,
          steps,
          insights,
          crossRoleEffects,
          answer:
            '我目前沒有拿到可驗證的作業/測驗清單，所以不能判定「沒有作業」。請先同步課程平台或打開學習/Inbox 資料；同步後我會依截止時間、測驗與成績趨勢幫你排優先順序。',
          actions: [{ label: '開啟學習資料', action: 'navigate', params: { screen: '學習' } }],
        };
      }
      if (wantsSprintPlan) {
        return {
          ...detected,
          handled: true,
          steps,
          insights,
          crossRoleEffects,
          answer: formatAssignmentSprintReply(assignments, context),
          actions: [{ label: '開啟學習資料', action: 'navigate', params: { screen: '學習' } }],
        };
      }
      const sorted = sortAssignmentsByUrgency(assignments);
      const list = sorted
        .slice(0, 8)
        .map((assignment, i) => `${i + 1}. ${assignment.isLate ? '逾期 ' : ''}${assignment.title}（${assignment.groupName}）${assignment.dueAt ? ` 截止：${assignment.dueAt}` : ''}`)
        .join('\n');
      return { ...detected, handled: true, steps, insights, crossRoleEffects, answer: `你目前有 ${assignments.length} 份待處理作業：\n\n${list}` };
    }

    case 'dining_lookup':
    case 'order_action': {
      const menus = context?.menus ?? [];
      if (menus.length === 0) {
        return {
          ...detected,
          handled: true,
          steps,
          insights,
          crossRoleEffects,
          answer: '目前沒有載入可驗證菜單，所以我不能亂編餐點或價格。請先開啟餐廳/點餐頁同步菜單，或指定餐廳讓我查已載入的官方 catalog。',
          actions: [{ label: '開啟餐廳/點餐', action: 'navigate', params: { screen: '校園', nested: 'Ordering' } }],
        };
      }
      const q = normalize(message);
      const wantsCheap = /便宜|平價|划算|省/.test(message);
      const wantsVeg = /素|蔬|菜|健康|清淡/.test(message);
      const basePool = messageWantsMainMealRecommendation(message) ? filterMainMealCandidates(menus) : [...menus];
      let filtered = basePool.filter(
        (menu) => normalize(`${menu.name}${menu.cafeteria ?? ''}`).includes(q) || q.includes(normalize(menu.name)),
      );
      if (filtered.length === 0 && wantsVeg) filtered = basePool.filter((menu) => /素|蔬|菜|沙拉/.test(menu.name));
      if (filtered.length === 0) filtered = [...basePool];
      if (wantsCheap) filtered.sort((a, b) => (a.price ?? 9999) - (b.price ?? 9999));
      const list = filtered
        .slice(0, 6)
        .map((menu, i) => `${i + 1}. ${menu.name}${typeof menu.price === 'number' ? ` $${menu.price}` : ' 價格未提供'}${menu.cafeteria ? `（${menu.cafeteria}）` : ''}`)
        .join('\n');
      return {
        ...detected,
        handled: detected.intent !== 'order_action',
        steps,
        insights,
        crossRoleEffects,
        answer:
          detected.intent === 'order_action'
            ? `我先查了可用菜單，找到這些候選餐點：\n\n${list}\n\n要正式下單必須選定餐點並顯示確認卡；確認後才會交給 App 點餐 executor。`
            : `我查了目前可用菜單，推薦：\n\n${list}`,
        actions: [{ label: '開啟點餐功能', action: 'navigate', params: { screen: '校園', nested: 'Ordering' }, status: 'pending_confirmation' }],
      };
    }

    case 'role_capability': {
      const capabilities = getRoleToolCapabilities(context?.role);
      return {
        ...detected,
        handled: true,
        steps,
        insights,
        crossRoleEffects,
        answer: `目前角色：${ROLE_LABELS[String(context?.role ?? 'guest')] ?? context?.role ?? '訪客'}。\n\n${capabilities
          .map((capability) => `- ${capability.label}：${capability.actions.join('、')}`)
          .join('\n')}`,
      };
    }

    case 'app_data_search': {
      const records = retrieveRecords(context, message);
      const recordText = records.length
        ? records.map((record, i) => `${i + 1}. ${record.label}：${record.text}`).join('\n')
        : '沒有找到足夠相關的 App 資料。';
      return {
        ...detected,
        handled: true,
        steps,
        insights,
        crossRoleEffects,
        answer: `我目前掌握的使用者狀態演算：\n${formatInsights(insights)}\n\n本題相關 App 資料：\n${recordText}`,
      };
    }

    case 'order_status':
      return {
        ...detected,
        handled: true,
        steps,
        insights,
        crossRoleEffects,
        answer:
          (context?.orders?.length ?? 0) > 0
            ? `近期訂單：\n${context!.orders!.slice(0, 5).map((order, i) => `${i + 1}. ${order.cafeteria ?? order.merchantName ?? '餐廳'}：${order.status}${typeof order.total === 'number' ? `，$${order.total}` : ''}`).join('\n')}`
            : '目前沒有查到近期訂單。',
      };

    case 'repair_status':
      return {
        ...detected,
        handled: true,
        steps,
        insights,
        crossRoleEffects,
        answer:
          (context?.repairRequests?.length ?? 0) > 0
            ? `報修狀態：\n${context!.repairRequests!.slice(0, 5).map((item, i) => `${i + 1}. ${item.title ?? item.type}：${item.status}${item.room ? `，${item.room}` : ''}`).join('\n')}`
            : '目前沒有查到報修案件。',
      };

    case 'library_status':
      return {
        ...detected,
        handled: true,
        steps,
        insights,
        crossRoleEffects,
        answer:
          (context?.libraryLoans?.length ?? 0) > 0
            ? `借閱狀態：\n${context!.libraryLoans!.slice(0, 5).map((loan, i) => `${i + 1}. ${loan.bookTitle ?? loan.bookId}：${loan.status}${loan.dueAt ? `，到期 ${loan.dueAt}` : ''}`).join('\n')}`
            : '目前沒有查到借閱資料。',
      };

    default: {
      const records = retrieveRecords(context, message);
      return {
        ...detected,
        handled: false,
        steps,
        insights,
        crossRoleEffects,
        answer:
          records.length > 0
            ? `本題可用資料：\n${records.map((record, i) => `${i + 1}. ${record.label}：${record.text}`).join('\n')}`
            : undefined,
      };
    }
  }
}

export function formatAIToolLayerForPrompt(result: AIToolLayerResult): string {
  const parts = [
    `意圖：${result.toolName}（confidence=${result.confidence.toFixed(2)}）`,
    `是否已有工具層答案：${result.handled ? '是' : '否'}`,
    `思考步驟：${result.steps.map((step) => `${step.step}/${step.status}`).join(' → ')}`,
    `使用者演算：${formatInsights(result.insights)}`,
    `跨角色影響：${formatCrossRoleEffects(result.crossRoleEffects)}`,
  ];
  if (result.answer) parts.push(`工具層答案草稿：${result.answer}`);
  return parts.join('\n');
}
