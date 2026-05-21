import {
  DEMO_ANNOUNCEMENTS,
  getDemoAnnouncementsByCourse,
  getDemoAttendanceByCourse,
  getDemoCoursesForUid,
  getDemoDiscussionsByCourse,
  getDemoExamsByCourse,
  getDemoHomeworksByCourse,
  getDemoMaterialsByCourse,
  getDemoModulesByCourse,
  getDemoScoreItemsByCourse,
  type MockCourse,
} from '../data/demoCoursesMock';
import {
  DEMO_EXAM_BENTO_MERCHANT_ID,
  DEMO_MENU,
  DEMO_MERCHANTS,
  DEMO_MERCHANT_ORDERS,
  getDemoMerchantAssignmentsForUid,
  getDemoMerchantById,
  getDemoMenuByMerchant,
  getDemoPopularByMerchant,
  getDemoStaffByMerchant,
  type DemoMerchantOrder,
} from '../data/demoMerchants';
import {
  getDemoUserStory,
  storyToPromptBlock,
  type DemoUserStory,
} from '../data/demoUserStories';
import {
  getPersonaConversationSummaries,
  getPersonaInbox,
  getPersonaMissions,
} from '../data/demoPersona';
import type { AIContext } from './ai';
import type { AIAppContextInput, AIAppRuntimeData } from './aiAppContext';
import type { AgentRole } from '../data/puAIAgentData';
import { listDemoMerchantOrders, listDemoOrdersForStudent } from './demoMerchantOrders';
import { loadVisibleRoleEventInbox } from './roleEventBus';

type AppDataRecord = NonNullable<AIContext['appDataRecords']>[number];

function isDemoUid(uid?: string | null): uid is string {
  return typeof uid === 'string' && uid.startsWith('demo_');
}

const DEMO_UID_BY_ROLE: Record<string, string> = {
  student: 'demo_student_kuchih',
  teacher: 'demo_teacher_chang',
  professor: 'demo_teacher_chang',
  ta: 'demo_ta_lin',
  club_officer: 'demo_club_wei',
  department_head: 'demo_admin_huang',
  principal: 'demo_admin_huang',
  admin: 'demo_admin_sys',
  staff: 'demo_admin_sys',
  vendor: 'demo_cafeteria',
  alumni: 'demo_alumni_chang',
  guest: 'demo_guest',
};

export type EffectiveDemoAIUser = {
  uid: string | null;
  displayName: string | null;
  schoolId: string | null;
  role: string | null;
  isDemo: boolean;
  signedInForAI: boolean;
  agentRole: AgentRole;
  campusRole?: AIContext['role'];
  appContextRole?: AIAppContextInput['role'];
};

export function getDemoUidForRole(role?: string | null): string | null {
  if (!role) return null;
  return DEMO_UID_BY_ROLE[String(role)] ?? null;
}

export function roleToAgentRole(role?: string | null): AgentRole {
  switch (role) {
    case 'vendor':
      return 'vendor';
    case 'admin':
    case 'department_head':
    case 'principal':
    case 'department':
      return 'admin';
    case 'teacher':
    case 'professor':
    case 'ta':
      return 'faculty';
    case 'staff':
      return 'staff';
    case 'alumni':
      return 'alumni';
    case 'guest':
      return 'guest';
    default:
      return 'student';
  }
}

export function roleToCampusRole(role?: string | null): AIContext['role'] | undefined {
  switch (role) {
    case 'teacher':
    case 'professor':
    case 'ta':
      return 'teacher';
    case 'department_head':
    case 'principal':
    case 'department':
      return 'department_head';
    case 'admin':
      return 'admin';
    case 'staff':
      return 'staff';
    case 'vendor':
      return 'vendor';
    case 'student':
    case 'club_officer':
      return 'student';
    default:
      return undefined;
  }
}

export function roleToAIAppContextRole(role?: string | null): AIAppContextInput['role'] {
  switch (role) {
    case 'teacher':
    case 'professor':
    case 'ta':
      return 'faculty';
    case 'department_head':
    case 'principal':
    case 'department':
      return 'department_head';
    case 'admin':
      return 'admin';
    case 'staff':
      return 'staff';
    case 'vendor':
      return 'vendor';
    case 'student':
    case 'club_officer':
      return 'student';
    case 'alumni':
    case 'guest':
      return 'guest';
    default:
      return undefined;
  }
}

export function resolveEffectiveDemoAIUser(params: {
  profile?: {
    uid?: string | null;
    role?: string | null;
    displayName?: string | null;
    schoolId?: string | null;
    primarySchoolId?: string | null;
    serviceRoles?: string[] | null;
    merchantAssignments?: unknown[] | null;
  } | null;
  user?: {
    uid?: string | null;
    displayName?: string | null;
    email?: string | null;
  } | null;
  demoRole?: string | null;
}): EffectiveDemoAIUser {
  const authUid = params.profile?.uid ?? params.user?.uid ?? null;
  const demoUid = isDemoUid(authUid)
    ? authUid
    : authUid
      ? null
      : getDemoUidForRole(params.demoRole ?? params.profile?.role ?? null);
  const uid = authUid ?? demoUid;
  const story = getDemoUserStory(uid ?? undefined);
  const role = params.profile?.role ?? story?.role ?? params.demoRole ?? null;
  const displayName =
    params.profile?.displayName ??
    params.user?.displayName ??
    story?.fullName ??
    null;
  const schoolId =
    params.profile?.schoolId ??
    params.profile?.primarySchoolId ??
    story?.schoolId ??
    null;
  const effectiveUid = uid ?? story?.uid ?? null;
  const isDemo = Boolean(story) || isDemoUid(effectiveUid);
  const serviceRoles = params.profile?.serviceRoles ?? [];
  const agentRole =
    Array.isArray(params.profile?.merchantAssignments) && params.profile!.merchantAssignments!.length > 0
      ? 'vendor'
      : serviceRoles.includes('vendor') || serviceRoles.includes('merchant')
        ? 'vendor'
        : roleToAgentRole(role);

  return {
    uid: effectiveUid,
    displayName,
    schoolId,
    role,
    isDemo,
    signedInForAI: Boolean(effectiveUid) || isDemo,
    agentRole,
    campusRole: roleToCampusRole(role),
    appContextRole: roleToAIAppContextRole(role),
  };
}

function compactJson(value: unknown, maxChars = 900): string {
  try {
    const text = JSON.stringify(value);
    return text.length > maxChars ? `${text.slice(0, maxChars)}...` : text;
  } catch {
    return String(value ?? '').slice(0, maxChars);
  }
}

function roleForAIInput(story: DemoUserStory | null): AIAppContextInput['role'] {
  if (!story) return undefined;
  return roleToAIAppContextRole(story.role);
}

function courseName(courseId: number): string {
  return getDemoCoursesForUid(null).find((course) => course.id === courseId)?.name ?? `課程 ${courseId}`;
}

function mapCourse(course: MockCourse): NonNullable<AIAppContextInput['courses']>[number] {
  return {
    id: String(course.id),
    code: course.course_code,
    name: course.name,
    instructor: course.instructor,
    teacher: course.instructor,
    credits: course.credit,
    semester: course.semester,
  } as NonNullable<AIAppContextInput['courses']>[number];
}

function buildDemoAssignments(uid: string): NonNullable<AIAppContextInput['pendingAssignments']> {
  const story = getDemoUserStory(uid);
  const visibleCourses = getDemoCoursesForUid(uid);
  const rows: NonNullable<AIAppContextInput['pendingAssignments']> = [];

  for (const course of visibleCourses) {
    const homeworks = getDemoHomeworksByCourse(course.id);
    for (const hw of homeworks) {
      const shouldShow =
        story?.role === 'teacher' ||
        story?.role === 'ta' ||
        story?.role === 'department_head' ||
        story?.role === 'admin'
          ? hw.submitted && !hw.graded
          : !hw.submitted;
      if (!shouldShow) continue;
      rows.push({
        id: `demo-hw-${hw.id}`,
        title:
          story?.role === 'teacher' || story?.role === 'ta'
            ? `${hw.title}（待批改）`
            : hw.title,
        groupName: course.name,
        dueAt: hw.dueAt,
        isLate: hw.isLate,
      });
    }
  }

  return rows;
}

function demoMenuRows(): NonNullable<AIAppContextInput['menus']> {
  return DEMO_MENU.map((item) => {
    const merchant = getDemoMerchantById(item.merchantId);
    return {
      id: item.id,
      name: item.name,
      price: item.price,
      cafeteria: merchant?.name ?? item.merchantId,
      category: item.category,
      popular: item.tags.includes('熱賣') || item.tags.includes('口試demo'),
    } as NonNullable<AIAppContextInput['menus']>[number];
  });
}

function demoCafeteriaRows(): NonNullable<AIAppContextInput['cafeterias']> {
  return DEMO_MERCHANTS.map((merchant) => ({
    id: merchant.id,
    name: merchant.name,
    location: merchant.location,
    isOpen: merchant.isOpen,
    rating: merchant.rating,
    reviewCount: merchant.reviewCount,
    category: merchant.category,
    description: merchant.description,
  } as NonNullable<AIAppContextInput['cafeterias']>[number]));
}

function demoAnnouncementRows(uid: string): NonNullable<AIAppContextInput['announcements']> {
  const visible = getDemoCoursesForUid(uid);
  const rows = visible.flatMap((course) =>
    getDemoAnnouncementsByCourse(course.id).map((announcement) => ({
      id: String(announcement.id),
      title: announcement.title,
      body: announcement.content,
      publishedAt: announcement.postedAt,
      source: course.name,
    })),
  );
  if (rows.length > 0) return rows;
  return DEMO_ANNOUNCEMENTS.slice(0, 3).map((announcement) => ({
    id: String(announcement.id),
    title: announcement.title,
    body: announcement.content,
    publishedAt: announcement.postedAt,
    source: '公開課程公告',
  }));
}

function demoEventRows(story: DemoUserStory | null): NonNullable<AIAppContextInput['events']> {
  const clubEvents =
    story?.clubs?.events.map((event, index) => ({
      id: `demo-club-event-${story.uid}-${index}`,
      title: event.name,
      location: story.clubs?.active[0]?.name ?? '校園',
      startsAt: event.date,
      source: 'demo 角色社團資料',
    })) ?? [];
  const alumniEvents =
    story?.role === 'alumni'
      ? [
          {
            id: 'demo-alumni-homecoming',
            title: '109 屆十週年同學會',
            location: '台中市西屯區',
            startsAt: '2026-07-15T18:00:00+08:00',
            source: '系友會',
          },
        ]
      : [];
  const publicEvents =
    story?.role === 'guest'
      ? [
          {
            id: 'demo-public-tour',
            title: '靜宜校園參觀與系所導覽',
            location: '主顧樓 1F',
            startsAt: '2026-05-24T10:00:00+08:00',
            source: '公開活動',
          },
        ]
      : [];
  return [...clubEvents, ...alumniEvents, ...publicEvents];
}

export function buildDemoAIContextInputPatch(
  uid: string | null | undefined,
): Partial<AIAppContextInput> {
  if (!isDemoUid(uid)) return {};
  const story = getDemoUserStory(uid);
  if (!story) return {};

  return {
    userName: story.fullName,
    role: roleForAIInput(story),
    courses: getDemoCoursesForUid(uid).map(mapCourse),
    pendingAssignments: buildDemoAssignments(uid),
    announcements: demoAnnouncementRows(uid),
    events: demoEventRows(story),
    cafeterias: demoCafeteriaRows(),
    menus: demoMenuRows(),
  };
}

function addRecord(records: AppDataRecord[], key: string, label: string, text: string, priority: number): void {
  const clean = text.trim();
  if (!clean) return;
  records.push({ key, label, text: clean, priority });
}

function addStoryDimensionRecords(records: AppDataRecord[], story: DemoUserStory): void {
  addRecord(
    records,
    'demo_life_identity',
    'Demo 身分/角色',
    compactJson(
      {
        uid: story.uid,
        fullName: story.fullName,
        role: story.role,
        department: story.department,
        schoolId: story.schoolId,
        joinedYear: story.joinedYear,
      },
      700,
    ),
    97,
  );
  if (story.dorm) {
    addRecord(records, 'demo_life_dorm', 'Demo 宿舍/室友/報修/門禁', compactJson(story.dorm, 1100), 91);
  }
  if (story.library) {
    addRecord(records, 'demo_life_library', 'Demo 圖書館借閱/研討室', compactJson(story.library, 1000), 91);
  }
  if (story.printing) {
    addRecord(records, 'demo_life_printing', 'Demo 列印餘額/列印紀錄', compactJson(story.printing, 850), 89);
  }
  if (story.parking) {
    addRecord(records, 'demo_life_parking', 'Demo 停車證/車輛進出', compactJson(story.parking, 850), 88);
  }
  if (story.clubs) {
    addRecord(records, 'demo_life_clubs', 'Demo 社團/活動', compactJson(story.clubs, 850), 86);
  }
  if (story.health) {
    addRecord(records, 'demo_life_health', 'Demo 健康/保險/緊急聯絡', compactJson(story.health, 900), 86);
  }
  if (story.bus) {
    addRecord(records, 'demo_life_bus', 'Demo 公車/通勤', compactJson(story.bus, 750), 84);
  }
  if (story.fitness) {
    addRecord(records, 'demo_life_fitness', 'Demo 運動設施', compactJson(story.fitness, 650), 82);
  }
  if (story.finance) {
    addRecord(records, 'demo_life_finance', 'Demo 財務/餐費/學雜費', compactJson(story.finance, 850), 88);
  }
  if (story.office) {
    addRecord(records, 'demo_life_office', 'Demo 辦公室/Office Hour', compactJson(story.office, 900), 90);
  }
  if (story.merchant) {
    addRecord(records, 'demo_life_merchant_contract', 'Demo 店家合約/員工班表', compactJson(story.merchant, 1000), 94);
  }
}

function buildCourseRecord(uid: string): string {
  const courses = getDemoCoursesForUid(uid);
  if (courses.length === 0) return '此角色沒有目前學期課程資料，這是刻意的 demo 權限隔離。';
  return courses
    .map((course) => {
      const homeworks = getDemoHomeworksByCourse(course.id).map((hw) => ({
        title: hw.title,
        dueAt: hw.dueAt,
        submitted: hw.submitted,
        graded: hw.graded,
        score: hw.score,
        isLate: hw.isLate,
      }));
      const exams = getDemoExamsByCourse(course.id).map((exam) => ({
        title: exam.title,
        type: exam.type,
        startAt: exam.startAt,
        score: exam.studentScore,
        submitted: exam.submitted,
      }));
      const scoreItems = getDemoScoreItemsByCourse(course.id).map((item) => ({
        name: item.name,
        weight: item.weight,
        score: item.studentScore,
        total: item.totalScore,
      }));
      const attendance = getDemoAttendanceByCourse(course.id).map((item) => ({
        active: item.active,
        status: item.myStatus,
        attendeeCount: item.attendeeCount,
        totalCount: item.totalCount,
      }));
      return {
        id: course.id,
        name: course.name,
        instructor: course.instructor,
        credit: course.credit,
        modules: getDemoModulesByCourse(course.id).slice(0, 4).map((m) => m.name),
        materials: getDemoMaterialsByCourse(course.id).slice(0, 4).map((m) => m.title),
        homeworks,
        exams,
        discussions: getDemoDiscussionsByCourse(course.id).slice(0, 3).map((d) => ({
          title: d.title,
          replies: d.replyCount,
          teacherEndorsed: d.hasTeacherEndorsement,
        })),
        scoreItems,
        attendance,
      };
    })
    .map((course) => compactJson(course, 1200))
    .join('\n');
}

function orderFromStatic(o: DemoMerchantOrder): AIAppRuntimeData['orders'][number] {
  return {
    id: o.id,
    userId: o.studentUid ?? 'demo_student_kuchih',
    customerName: o.studentName,
    customerRole: o.studentRole,
    status: o.status === 'processing' ? 'preparing' : o.status,
    cafeteria: o.merchantId,
    cafeteriaId: o.merchantId,
    merchantId: o.merchantId,
    merchantName: getDemoMerchantById(o.merchantId)?.name ?? o.merchantId,
    total: o.total,
    totalAmount: o.total,
    totalPrice: o.total,
    items: [{ menuItemId: `${o.id}-line`, name: o.items, quantity: 1, price: o.total }],
    note: o.note,
    createdAt: o.orderedAt,
    paymentStatus: 'paid',
  } as unknown as AIAppRuntimeData['orders'][number];
}

function buildRoleOrders(uid: string, story: DemoUserStory | null): AIAppRuntimeData['orders'] {
  if (story?.role === 'vendor') {
    return getDemoMerchantAssignmentsForUid(uid)
      .flatMap((assignment) => listDemoMerchantOrders(assignment.merchantId))
      .slice(0, 30);
  }

  const live = listDemoOrdersForStudent(uid);
  const staticOrders = DEMO_MERCHANT_ORDERS.filter((order) => order.studentUid === uid).map(orderFromStatic);
  const seen = new Set<string>();
  return [...live, ...staticOrders].filter((order) => {
    if (seen.has(order.id)) return false;
    seen.add(order.id);
    return true;
  });
}

export function buildDemoAIAppDataRecords(uid: string | null | undefined): AppDataRecord[] {
  if (!isDemoUid(uid)) return [];
  const story = getDemoUserStory(uid);
  if (!story) return [];
  const records: AppDataRecord[] = [];

  addRecord(records, 'demo_persona', 'Demo 角色完整檔案', storyToPromptBlock(uid), 100);
  addRecord(records, 'demo_story_json', 'Demo 角色生活資料', compactJson(story, 1800), 96);
  addStoryDimensionRecords(records, story);
  addRecord(records, 'demo_courses_full', 'Demo 課程/作業/成績/討論/點名', buildCourseRecord(uid), 94);

  const orders = buildRoleOrders(uid, story);
  addRecord(records, 'demo_orders', 'Demo 訂單與餐廳後台', compactJson(orders, 1400), 92);

  const menus = [
    ...getDemoMenuByMerchant(DEMO_EXAM_BENTO_MERCHANT_ID),
    ...DEMO_MENU.filter((item) => item.merchantId !== DEMO_EXAM_BENTO_MERCHANT_ID).slice(0, 10),
  ].map((item) => ({
    ...item,
    merchantName: getDemoMerchantById(item.merchantId)?.name ?? item.merchantId,
  }));
  addRecord(records, 'demo_menu', 'Demo 可下單菜單', compactJson(menus, 1200), 88);

  if (story.role === 'vendor') {
    const assignments = getDemoMerchantAssignmentsForUid(uid).map((assignment) => {
      const merchant = getDemoMerchantById(assignment.merchantId);
      return {
        ...assignment,
        merchant,
        popular: getDemoPopularByMerchant(assignment.merchantId),
        staff: getDemoStaffByMerchant(assignment.merchantId),
        orders: listDemoMerchantOrders(assignment.merchantId).slice(0, 8),
      };
    });
    addRecord(records, 'demo_vendor_ops', 'Demo 店家營運/訂單/員工', compactJson(assignments, 1800), 98);
  }

  addRecord(
    records,
    'demo_conversations',
    'Demo 訊息對話摘要',
    compactJson(getPersonaConversationSummaries(uid), 1200),
    82,
  );
  addRecord(records, 'demo_inbox_tasks', 'Demo 收件匣任務', compactJson(getPersonaInbox(uid), 1200), 84);
  addRecord(records, 'demo_ai_missions', 'Demo AI 主動任務', compactJson(getPersonaMissions(uid), 1200), 86);

  return records;
}

function mergeById<T extends { id?: string }>(base: T[], extra: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of [...extra, ...base]) {
    const id = String(item.id ?? compactJson(item, 120));
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(item);
  }
  return out;
}

function deleteLoadIssues(loadIssues: Record<string, string> | undefined, keys: string[]): Record<string, string> {
  const next = { ...(loadIssues ?? {}) };
  for (const key of keys) delete next[key];
  return next;
}

export async function enrichDemoAIAppRuntimeData(
  data: AIAppRuntimeData,
  uid: string | null | undefined,
): Promise<AIAppRuntimeData> {
  if (!isDemoUid(uid)) return data;
  const story = getDemoUserStory(uid);
  if (!story) return data;

  const courses = getDemoCoursesForUid(uid);
  const orders = buildRoleOrders(uid, story);
  const conversations = getPersonaConversationSummaries(uid).map((summary) => ({
    id: summary.id,
    memberIds: [uid, summary.peerUid],
    unreadCount: summary.unread ? 1 : 0,
    lastMessageAt: summary.lastMessageAt,
    lastMessage: { content: summary.lastMessage, senderId: summary.lastFromPeer ? summary.peerUid : uid },
  })) as unknown as AIAppRuntimeData['conversations'];
  const personaInbox = getPersonaInbox(uid).map((task) => ({
    id: task.id,
    userId: uid,
    type: task.kind,
    title: task.title,
    body: task.subtitle,
    read: false,
    category: task.kind,
    createdAt: new Date().toISOString(),
  })) as unknown as AIAppRuntimeData['notifications'];
  const roleEvents = await loadVisibleRoleEventInbox({ uid, role: story.role }).catch(() => []);
  const roleEventNotifications = roleEvents.slice(0, 12).map((event) => ({
    id: event.id,
    userId: uid,
    type: event.kind,
    title: `${event.courseName}｜${event.kind}`,
    body: compactJson(event.payload, 240),
    read: false,
    category: event.kind,
    createdAt: event.occurredAt,
  })) as unknown as AIAppRuntimeData['notifications'];

  const courseModules = courses.flatMap((course) =>
    getDemoModulesByCourse(course.id).map((module) => ({
      id: String(module.id),
      groupId: String(course.id),
      groupName: course.name,
      courseSpaceId: String(course.id),
      title: module.name,
      description: module.description,
      order: module.sort,
    })),
  ) as unknown as AIAppRuntimeData['courseModules'];
  const quizzes = courses.flatMap((course) =>
    getDemoExamsByCourse(course.id).map((exam) => ({
      id: String(exam.id),
      assignmentId: String(exam.id),
      groupId: String(course.id),
      groupName: course.name,
      courseId: String(course.id),
      courseSpaceId: String(course.id),
      title: exam.title,
      type: exam.type,
      dueAt: exam.endAt,
      points: exam.totalScore,
      questionCount: exam.questionCount,
      source: 'demo',
    })),
  ) as unknown as AIAppRuntimeData['quizzes'];
  const attendanceSessions = courses.flatMap((course) =>
    getDemoAttendanceByCourse(course.id).map((session) => ({
      id: session.id,
      groupId: String(course.id),
      groupName: course.name,
      courseId: String(course.id),
      courseSpaceId: String(course.id),
      startedAt: session.startedAt,
      endedAt: null,
      active: session.active,
      mode: session.mode,
      attendeeCount: session.attendeeCount,
      totalCount: session.totalCount,
      status: session.myStatus,
      source: 'demo',
    })),
  ) as unknown as AIAppRuntimeData['attendanceSessions'];
  const grades = courses.flatMap((course) =>
    getDemoScoreItemsByCourse(course.id).map((item) => ({
      id: `demo-grade-${item.id}`,
      userId: uid,
      courseId: String(course.id),
      courseName: course.name,
      itemName: item.name,
      type: item.type,
      score: item.studentScore,
      totalScore: item.totalScore,
      weight: item.weight,
      credits: course.credit,
      semester: course.semester,
    })),
  ) as unknown as AIAppRuntimeData['grades'];
  const inboxTasks = getPersonaInbox(uid).map((task) => ({
    id: task.id,
    title: task.title,
    subtitle: task.subtitle,
    kind: task.kind,
    groupId: task.courseId ?? 'demo',
    groupName: task.courseId ?? 'demo',
    dueAt: task.dueAt,
    priority: task.priority,
  })) as unknown as AIAppRuntimeData['inboxTasks'];

  return {
    ...data,
    userProfile: data.userProfile ?? ({
      id: uid,
      uid,
      displayName: story.fullName,
      role: story.role,
      schoolId: story.schoolId,
      department: story.department,
      year: story.joinedYear,
      balance: story.finance?.diningBalance,
      email: `${uid}@demo.local`,
      createdAt: new Date().toISOString(),
    } as unknown as AIAppRuntimeData['userProfile']),
    orders: mergeById(data.orders, orders),
    notifications: mergeById(data.notifications, [...personaInbox, ...roleEventNotifications]),
    conversations: mergeById(data.conversations, conversations),
    nextBestActions: mergeById(
      data.nextBestActions,
      getPersonaMissions(uid).map((mission, index) => ({
        id: mission.id,
        title: mission.title,
        description: mission.detail,
        summary: mission.reason,
        reason: mission.reason,
        urgency: mission.severity === 'critical' ? 'critical' : mission.severity === 'warn' ? 'high' : 'medium',
        priority: index + 1,
        nextStep: mission.primaryAction.screen,
        actionLabel: mission.primaryActionLabel,
        evidenceRefs: [],
        requiresConfirmation: false,
        source: 'demo',
      })) as unknown as AIAppRuntimeData['nextBestActions'],
    ),
    groups: mergeById(
      data.groups,
      (story.clubs?.active ?? []).map((club) => ({
        id: `demo-club-${club.name}`,
        name: club.name,
        role: club.role,
        joinedAt: String(club.yearJoined),
        type: 'club',
        memberCount: 42,
        createdAt: new Date().toISOString(),
      })) as unknown as AIAppRuntimeData['groups'],
    ),
    calendarEvents: mergeById(
      data.calendarEvents,
      [
        ...(story.clubs?.events.map((event, index) => ({
          id: `demo-event-${uid}-${index}`,
          title: event.name,
          startAt: event.date,
          type: 'club',
        })) ?? []),
        ...(story.office?.officeHours.map((slot, index) => ({
          id: `demo-office-${uid}-${index}`,
          title: `${story.fullName} Office Hours`,
          startAt: `${slot.day} ${slot.from}`,
          endAt: `${slot.day} ${slot.to}`,
          location: `${story.office?.building} ${story.office?.room}`,
          type: 'office_hour',
        })) ?? []),
      ] as unknown as AIAppRuntimeData['calendarEvents'],
    ),
    repairRequests: mergeById(
      data.repairRequests,
      (story.dorm?.recentRepairs ?? []).map((repair) => ({
        id: repair.id,
        userId: uid,
        title: repair.title,
        description: repair.title,
        type: 'dorm',
        status: repair.status,
        room: story.dorm ? `${story.dorm.building} ${story.dorm.room}` : undefined,
        createdAt: repair.submittedAt,
      })) as unknown as AIAppRuntimeData['repairRequests'],
    ),
    libraryLoans: mergeById(
      data.libraryLoans,
      (story.library?.borrowed ?? []).map((loan, index) => ({
        id: `demo-loan-${uid}-${index}`,
        userId: uid,
        bookId: `demo-book-${index}`,
        book: { title: loan.title, author: loan.author },
        dueAt: loan.dueAt,
        dueDate: loan.dueAt,
        status: loan.renewable ? 'borrowed' : 'not_renewable',
      })) as unknown as AIAppRuntimeData['libraryLoans'],
    ),
    seatReservations: mergeById(
      data.seatReservations,
      (story.library?.studyRoomsBooked ?? []).map((room, index) => ({
        id: `demo-seat-${uid}-${index}`,
        userId: uid,
        seatId: room.room,
        date: room.date,
        startTime: room.time.split('-')[0] ?? room.time,
        endTime: room.time.split('-')[1] ?? '',
        status: 'active',
      })) as unknown as AIAppRuntimeData['seatReservations'],
    ),
    printJobs: mergeById(
      data.printJobs,
      (story.printing?.recentJobs ?? []).map((job, index) => ({
        id: `demo-print-${uid}-${index}`,
        userId: uid,
        printerId: story.printing?.defaultPrinter ?? 'demo-printer',
        fileName: job.name,
        pages: job.pages,
        cost: job.cost,
        status: 'completed',
        createdAt: job.at,
      })) as unknown as AIAppRuntimeData['printJobs'],
    ),
    healthRecords: mergeById(
      data.healthRecords,
      (story.health?.recentVisits ?? []).map((visit, index) => ({
        id: `demo-health-${uid}-${index}`,
        userId: uid,
        type: visit.reason,
        title: visit.reason,
        provider: visit.clinic,
        visitedAt: visit.at,
        date: visit.at,
        department: visit.clinic,
      })) as unknown as AIAppRuntimeData['healthRecords'],
    ),
    transactions: mergeById(
      data.transactions,
      story.finance
        ? ([
            {
              id: `demo-finance-dining-${uid}`,
              userId: uid,
              type: 'dining_balance',
              amount: story.finance.diningBalance,
              currency: 'TWD',
              status: 'completed',
              description: 'Demo 餐飲餘額',
              createdAt: new Date().toISOString(),
            },
            {
              id: `demo-finance-print-${uid}`,
              userId: uid,
              type: 'printing_balance',
              amount: story.finance.printingBalance,
              currency: 'TWD',
              status: 'completed',
              description: 'Demo 列印餘額',
              createdAt: new Date().toISOString(),
            },
          ] as unknown as AIAppRuntimeData['transactions'])
        : [],
    ),
    dormitoryInfo: data.dormitoryInfo ?? (story.dorm ? ({
      id: `demo-dorm-${uid}`,
      userId: uid,
      building: story.dorm.building,
      room: story.dorm.room,
      floor: story.dorm.floor,
      roomType: story.dorm.roomType,
      roommates: story.dorm.roommates,
      startDate: story.dorm.inDate,
      endDate: story.dorm.outDate,
    } as unknown as AIAppRuntimeData['dormitoryInfo']) : null),
    courseSpaces: mergeById(
      data.courseSpaces,
      courses.map((course) => ({
        id: String(course.id),
        groupId: String(course.id),
        name: course.name,
        code: course.course_code,
        teacherName: course.instructor,
        role: story.role === 'teacher' ? 'teacher' : story.role === 'ta' ? 'assistant' : 'student',
        unreadCount: 0,
        assignmentCount: getDemoHomeworksByCourse(course.id).length,
        dueSoonCount: getDemoHomeworksByCourse(course.id).filter((hw) => !hw.submitted).length,
        memberCount: story.role === 'teacher' ? 40 : 1,
        updatedAt: new Date().toISOString(),
      })) as unknown as AIAppRuntimeData['courseSpaces'],
    ),
    courseModules: mergeById(data.courseModules, courseModules),
    quizzes: mergeById(data.quizzes, quizzes),
    attendanceSessions: mergeById(data.attendanceSessions, attendanceSessions),
    grades: mergeById(data.grades, grades),
    inboxTasks: mergeById(data.inboxTasks, inboxTasks),
    busRoutes: mergeById(
      data.busRoutes,
      (story.bus?.subscribedRoutes ?? []).map((route) => ({
        id: route.id,
        name: route.name,
        nextDeparture: route.nextDeparture,
        stops: [],
        schedule: [],
      })) as unknown as AIAppRuntimeData['busRoutes'],
    ),
    loadIssues: deleteLoadIssues(data.loadIssues, [
      'userProfile',
      'orders',
      'notifications',
      'conversations',
      'groups',
      'calendarEvents',
      'repairRequests',
      'libraryLoans',
      'seatReservations',
      'printJobs',
      'healthRecords',
      'transactions',
      'dormitoryInfo',
      'courseSpaces',
      'courseModules',
      'quizzes',
      'attendanceSessions',
      'grades',
      'inboxTasks',
      'busRoutes',
    ]),
  };
}
