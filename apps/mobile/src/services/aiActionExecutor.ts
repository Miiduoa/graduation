import type { DataSource } from '../data/source';
import type {
  ActionQueueItem,
  AssistantActionProposal,
  Cafeteria,
  CalendarEvent,
  CampusActorRole,
  HealthDepartment,
  LibrarySeat,
  LostFoundCategory,
  MenuItem,
  Printer,
  RepairType,
} from '../data/types';
import type { AgentRole, AgentTool } from '../data/puAIAgentData';

type CourseLike = {
  id?: string;
  groupId?: string;
  courseId?: string;
  name?: string;
  title?: string;
  teacher?: string;
};

export type AIActionExecutionKind = 'executed' | 'drafted' | 'blocked';

export type AIActionExecutionResult = {
  kind: AIActionExecutionKind;
  message: string;
  recordId?: string;
  actions?: AssistantActionProposal[];
};

export type AIActionExecutorContext = {
  tool: AgentTool;
  params: Record<string, any>;
  userId?: string | null;
  schoolId?: string | null;
  role: AgentRole;
  dataSource: DataSource;
  isOnline?: boolean;
  courses?: CourseLike[];
  cafeterias?: Cafeteria[];
  menus?: MenuItem[];
  pendingAssignments?: Array<Record<string, any>>;
  userMessage?: string;
};

const DRAFT_ONLY_TOOLS = new Set([
  'peer_review',
  'peer_review_assign',
  'attendance_alert',
  'learning_insight',
  'study_group_match',
  'group_order',
  'tutoring_request',
  'event_invite',
  'carpool_match',
  'secondhand_trade',
  'share_notes',
]);

const DIRECT_EXECUTION_TOOLS = new Set([
  'order_meal',
  'book_health',
  'reserve_seat',
  'report_repair',
  'post_lost',
  'print_file',
  'set_reminder',
  'send_message',
  'assignment_publish',
]);

function navAction(
  label: string,
  params: Record<string, unknown>,
  sensitivity: AssistantActionProposal['sensitivity'] = 'low',
): AssistantActionProposal {
  return { label, action: 'navigate', params, sensitivity };
}

function blocked(message: string, actions?: AssistantActionProposal[]): AIActionExecutionResult {
  return { kind: 'blocked', message, actions };
}

function executed(
  message: string,
  recordId?: string,
  actions?: AssistantActionProposal[],
): AIActionExecutionResult {
  return { kind: 'executed', message, recordId, actions };
}

function normalizeText(value: unknown): string {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[０-９]/g, (digit) => String.fromCharCode(digit.charCodeAt(0) - 0xfee0))
    .replace(/[\s｜|、，,。．.（）()【】\[\]{}「」『』\-—_]/g, '');
}

function asString(value: unknown): string {
  return String(value ?? '').trim();
}

function isRoleAllowed(tool: AgentTool, role: AgentRole): boolean {
  return role === 'admin' || tool.roleAccess.includes(role);
}

function toCampusActorRole(role: AgentRole): CampusActorRole {
  if (role === 'faculty') return 'teacher';
  if (role === 'vendor') return 'staff';
  return role;
}

function requireSignedIn(userId?: string | null): AIActionExecutionResult | null {
  return userId ? null : blocked('需要先登入，AI 才能替你送出這項操作。');
}

function requireSchool(schoolId?: string | null): AIActionExecutionResult | null {
  return schoolId ? null : blocked('目前無法判斷學校，不能送出會寫入校園資料的操作。');
}

function parseDateValue(value: unknown, fallbackOffsetDays = 0): string {
  const raw = asString(value);
  const base = new Date();
  const date = new Date(base);

  if (/後天/.test(raw)) date.setDate(base.getDate() + 2);
  else if (/明天/.test(raw)) date.setDate(base.getDate() + 1);
  else if (/今天/.test(raw)) date.setDate(base.getDate());
  else if (raw) {
    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
    date.setDate(base.getDate() + fallbackOffsetDays);
  } else {
    date.setDate(base.getDate() + fallbackOffsetDays);
  }

  return date.toISOString().slice(0, 10);
}

function parseDateTime(value: unknown, fallbackOffsetMinutes = 60): Date {
  const raw = asString(value);
  const date = new Date();
  date.setSeconds(0, 0);

  if (/後天/.test(raw)) date.setDate(date.getDate() + 2);
  else if (/明天/.test(raw)) date.setDate(date.getDate() + 1);
  else if (/今天/.test(raw)) date.setDate(date.getDate());
  else if (raw) {
    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  } else {
    date.setMinutes(date.getMinutes() + fallbackOffsetMinutes);
  }

  const timeMatch = raw.match(/(\d{1,2})(?:[:：點])(\d{1,2})?/);
  if (timeMatch) {
    date.setHours(Number(timeMatch[1]), Number(timeMatch[2] ?? 0), 0, 0);
  } else if (raw) {
    date.setHours(9, 0, 0, 0);
  }
  return date;
}

function timeSlotRange(slot: unknown): { start: string; end: string; label: string } {
  const value = asString(slot);
  if (value === 'morning') return { start: '08:00', end: '12:00', label: '上午' };
  if (value === 'evening') return { start: '17:00', end: '21:30', label: '晚上' };
  if (value === 'afternoon') return { start: '12:00', end: '17:00', label: '下午' };
  const match = value.match(/(\d{1,2}[:：]\d{2})\s*[-~到至]\s*(\d{1,2}[:：]\d{2})/);
  if (match)
    return { start: match[1].replace('：', ':'), end: match[2].replace('：', ':'), label: value };
  return { start: '10:00', end: '11:00', label: value || '預設時段' };
}

function mapHealthDepartment(value: unknown): HealthDepartment {
  const raw = asString(value);
  if (raw === 'mental') return 'mental';
  if (raw === 'dental') return 'dental';
  if (raw === 'sports_injury') return 'physical';
  return 'general';
}

function mapRepairType(value: unknown): RepairType {
  const raw = asString(value);
  if (raw === 'electrical') return 'electrical';
  if (raw === 'plumbing') return 'plumbing';
  if (raw === 'furniture') return 'furniture';
  if (raw === 'ac') return 'ac';
  if (raw === 'network') return 'internet';
  return 'other';
}

function mapRepairPriority(value: unknown): 'low' | 'normal' | 'high' | 'urgent' {
  const raw = asString(value);
  if (raw === 'high') return 'high';
  if (raw === 'low') return 'low';
  return 'normal';
}

function mapLostFoundCategory(value: unknown): LostFoundCategory {
  const raw = asString(value);
  if (raw === 'phone' || raw === 'earbuds') return 'electronics';
  if (raw === 'student_card') return 'cards';
  if (raw === 'wallet') return 'wallet';
  if (raw === 'keys') return 'keys';
  if (raw === 'books') return 'books';
  if (raw === 'clothing') return 'clothing';
  return 'other';
}

function chooseMenu(
  params: Record<string, any>,
  menus: MenuItem[] = [],
  userMessage = '',
): MenuItem | undefined {
  const id = asString(params.menuItemId ?? params.itemId);
  if (id) {
    const byId = menus.find((menu) => menu.id === id);
    if (byId) return byId;
  }

  const requested = normalizeText(params.items ?? params.item ?? params.title ?? userMessage);
  if (!requested) return undefined;

  return menus.find((menu) => {
    const name = normalizeText(menu.name);
    return name === requested || name.includes(requested) || requested.includes(name);
  });
}

function chooseCafeteria(
  params: Record<string, any>,
  cafeterias: Cafeteria[] = [],
  selectedMenu?: MenuItem,
  userMessage = '',
): Cafeteria | undefined {
  if (selectedMenu?.cafeteriaId) {
    const byId = cafeterias.find((cafeteria) => cafeteria.id === selectedMenu.cafeteriaId);
    if (byId) return byId;
  }

  const requested = normalizeText(params.cafeteria ?? selectedMenu?.cafeteria ?? userMessage);
  if (!requested) return undefined;

  return cafeterias.find((cafeteria) => {
    const name = normalizeText(cafeteria.name);
    return (
      name === requested ||
      name.includes(requested) ||
      requested.includes(name) ||
      normalizeText(cafeteria.id) === requested
    );
  });
}

function findCourse(
  params: Record<string, any>,
  courses: CourseLike[] = [],
): CourseLike | undefined {
  const requested = normalizeText(params.course ?? params.courseName ?? params.groupId);
  if (!requested) return undefined;
  return courses.find((course) => {
    const name = normalizeText(course.name ?? course.title ?? course.id ?? course.groupId);
    return name === requested || name.includes(requested) || requested.includes(name);
  });
}

function chooseSeat(params: Record<string, any>, seats: LibrarySeat[]): LibrarySeat | undefined {
  const explicitSeat = asString(params.seatId);
  if (explicitSeat)
    return seats.find((seat) => seat.id === explicitSeat || seat.seatNumber === explicitSeat);

  const floor = asString(params.floor);
  const type = asString(params.type);
  return (
    seats.find((seat) => {
      if (seat.status !== 'available') return false;
      if (floor && seat.floor !== floor && !normalizeText(seat.name).includes(normalizeText(floor)))
        return false;
      if (type === 'quiet_zone' && !seat.isQuietZone) return false;
      return true;
    }) ?? seats.find((seat) => seat.status === 'available')
  );
}

function choosePrinter(params: Record<string, any>, printers: Printer[]): Printer | undefined {
  const explicit = asString(params.printer ?? params.printerId);
  if (explicit) {
    const byId = printers.find(
      (printer) =>
        printer.id === explicit || normalizeText(printer.name).includes(normalizeText(explicit)),
    );
    if (byId) return byId;
  }
  return printers.find((printer) => printer.status === 'online') ?? printers[0];
}

async function createActionDraft(
  ctx: AIActionExecutorContext,
  reason?: string,
): Promise<AIActionExecutionResult> {
  const { dataSource, params, schoolId, tool, userId, role } = ctx;
  const authBlock = requireSignedIn(userId);
  if (authBlock) return authBlock;

  const input = {
    userId: userId!,
    schoolId: schoolId ?? undefined,
    label: tool.name,
    action: tool.id,
    params,
    requiresConfirmation: true as const,
    sensitivity: tool.requiresConfirmation ? ('high' as const) : ('medium' as const),
    status: 'pending_confirmation' as const,
    actorRole: toCampusActorRole(role),
    permissionScope: 'user_private' as const,
    evidenceRefs: [],
  };

  let item: ActionQueueItem | null = null;
  if (dataSource.createActionQueueItem) {
    item = await dataSource.createActionQueueItem(input);
  }

  const actionId = item?.id;
  return {
    kind: 'drafted',
    recordId: actionId,
    message: [
      `已建立「${tool.name}」草稿，尚未送出正式操作。`,
      reason ? `原因：${reason}` : '',
      actionId ? `草稿編號：${actionId}` : '',
      '請到對應功能確認內容後再送出。',
    ]
      .filter(Boolean)
      .join('\n'),
    actions: defaultActionsForTool(tool),
  };
}

function defaultActionsForTool(tool: AgentTool): AssistantActionProposal[] {
  switch (tool.id) {
    case 'book_health':
      return [navAction('開啟校園健康功能', { screen: '校園', nested: 'Health' }, 'medium')];
    case 'reserve_seat':
    case 'search_book':
      return [navAction('開啟圖書館功能', { screen: '校園', nested: 'Library' })];
    case 'report_repair':
      return [navAction('開啟宿舍服務', { screen: '校園', nested: 'Dormitory' }, 'medium')];
    case 'post_lost':
      return [navAction('開啟失物招領', { screen: '校園', nested: 'LostFound' }, 'medium')];
    case 'print_file':
      return [navAction('開啟列印服務', { screen: '校園', nested: 'PrintService' })];
    case 'set_reminder':
      return [navAction('開啟智慧行事曆', { screen: 'Today', nested: 'SmartCalendarScreen' })];
    case 'send_message':
      return [navAction('開啟訊息', { screen: '收件匣', nested: 'MessagesHome' }, 'medium')];
    case 'assignment_publish':
    case 'peer_review_assign':
    case 'attendance_alert':
    case 'learning_insight':
      return [navAction('開啟教學管理功能', { screen: '教學', nested: 'CourseHub' }, 'high')];
    default:
      return [];
  }
}

async function executeOrderMeal(ctx: AIActionExecutorContext): Promise<AIActionExecutionResult> {
  const { params, userId, schoolId, dataSource, menus, cafeterias, userMessage } = ctx;
  const authBlock = requireSignedIn(userId);
  if (authBlock) return authBlock;
  const schoolBlock = requireSchool(schoolId);
  if (schoolBlock) return schoolBlock;
  if (ctx.isOnline === false) return blocked('目前離線，不能送到餐廳點餐系統。');

  const menu = chooseMenu(params, menus, userMessage);
  const cafeteria = chooseCafeteria(params, cafeterias, menu, userMessage);
  if (!cafeteria)
    return blocked('缺少可驗證的餐廳資料，不能建立正式訂單。', defaultActionsForTool(ctx.tool));
  if (
    cafeteria.orderingEnabled !== true ||
    cafeteria.pilotStatus === 'inactive' ||
    (cafeteria.activeOperatorCount ?? 0) <= 0
  ) {
    return blocked(
      '這間餐廳尚未開通 APP 接單或沒有店員在線，不能假裝已下單。',
      defaultActionsForTool(ctx.tool),
    );
  }
  if (!menu || typeof menu.price !== 'number') {
    return blocked(
      '找不到可下單的正式品項或價格，請從餐廳頁選擇可下單餐點。',
      defaultActionsForTool(ctx.tool),
    );
  }

  const quantity = typeof params.quantity === 'number' && params.quantity > 0 ? params.quantity : 1;
  const totalAmount = menu.price * quantity;
  const order = await dataSource.createOrder({
    userId: userId!,
    schoolId: schoolId!,
    cafeteriaId: cafeteria.id,
    merchantId: cafeteria.merchantId ?? cafeteria.id,
    cafeteria: cafeteria.name,
    merchantName: cafeteria.name,
    items: [
      {
        menuItemId: menu.id,
        name: menu.name,
        price: menu.price,
        quantity,
        note: params.note,
      },
    ],
    totalAmount,
    pickupTime: params.pickup_time,
    note: params.note,
  });

  return executed(
    [
      '下單成功，餐廳點餐系統已收到訂單。',
      `訂單編號：${order.id}`,
      `餐廳：${cafeteria.name}`,
      `餐點：${menu.name} x ${quantity}`,
      `金額：$${totalAmount}`,
      `狀態：${order.status === 'pending' ? '待店家確認' : order.status}`,
    ].join('\n'),
    order.id,
    [navAction('查看我的訂單', { screen: '校園', nested: 'Ordering', initialTab: 2 }, 'low')],
  );
}

async function executeHealthBooking(
  ctx: AIActionExecutorContext,
): Promise<AIActionExecutionResult> {
  const { params, userId, schoolId, dataSource } = ctx;
  const authBlock = requireSignedIn(userId);
  if (authBlock) return authBlock;
  const schoolBlock = requireSchool(schoolId);
  if (schoolBlock) return schoolBlock;

  const date = parseDateValue(params.date, 1);
  const appointment = await dataSource.createHealthAppointment({
    userId: userId!,
    schoolId: schoolId!,
    department: mapHealthDepartment(params.department),
    date,
    timeSlot: asString(params.timeSlot ?? params.time_slot) || '10:00',
    reason: asString(params.symptom ?? params.reason) || undefined,
    notes: asString(params.note) || undefined,
  });
  return executed(
    `已預約健康服務。\n預約編號：${appointment.id}\n日期：${appointment.date}\n時段：${appointment.timeSlot}`,
    appointment.id,
    defaultActionsForTool(ctx.tool),
  );
}

async function executeSeatReservation(
  ctx: AIActionExecutorContext,
): Promise<AIActionExecutionResult> {
  const { params, userId, schoolId, dataSource } = ctx;
  const authBlock = requireSignedIn(userId);
  if (authBlock) return authBlock;
  const schoolBlock = requireSchool(schoolId);
  if (schoolBlock) return schoolBlock;

  const seats = await dataSource.listSeats(schoolId!, asString(params.floor) || undefined);
  const seat = chooseSeat(params, seats);
  if (!seat)
    return blocked('目前找不到可預約的圖書館座位，沒有建立預約。', defaultActionsForTool(ctx.tool));

  const date = parseDateValue(params.date);
  const slot = timeSlotRange(params.time_slot ?? params.timeSlot);
  const reservation = await dataSource.reserveSeat(
    seat.id,
    userId!,
    date,
    slot.start,
    slot.end,
    schoolId!,
  );
  return executed(
    `已預約圖書館座位。\n座位：${seat.name ?? seat.seatNumber}\n日期：${date}\n時段：${slot.label}`,
    reservation.id,
    defaultActionsForTool(ctx.tool),
  );
}

async function executeRepairRequest(
  ctx: AIActionExecutorContext,
): Promise<AIActionExecutionResult> {
  const { params, userId, schoolId, dataSource, userMessage } = ctx;
  const authBlock = requireSignedIn(userId);
  if (authBlock) return authBlock;
  const schoolBlock = requireSchool(schoolId);
  if (schoolBlock) return schoolBlock;
  const room = asString(params.room);
  if (!room) return createActionDraft(ctx, '缺少房號，不能直接送出報修單。');

  const type = mapRepairType(params.category ?? params.type);
  const repair = await dataSource.createRepairRequest({
    userId: userId!,
    schoolId: schoolId!,
    type,
    title: asString(params.title) || `${type === 'ac' ? '冷氣' : '宿舍'}報修`,
    description: asString(params.description) || asString(userMessage) || 'AI 代理建立的報修申請',
    room,
    priority: mapRepairPriority(params.urgency ?? params.priority),
    images: Array.isArray(params.images) ? params.images : undefined,
  });
  return executed(
    `維修單已提交。\n工單編號：${repair.id}\n房號：${repair.room}\n狀態：${repair.status}`,
    repair.id,
    defaultActionsForTool(ctx.tool),
  );
}

async function executeLostFoundPost(
  ctx: AIActionExecutorContext,
): Promise<AIActionExecutionResult> {
  const { params, userId, schoolId, dataSource } = ctx;
  const authBlock = requireSignedIn(userId);
  if (authBlock) return authBlock;
  const schoolBlock = requireSchool(schoolId);
  if (schoolBlock) return schoolBlock;
  if (!asString(params.item) || !asString(params.location)) {
    return createActionDraft(ctx, '缺少物品名稱或地點，不能直接發布失物公告。');
  }

  const item = await dataSource.createLostFoundItem({
    type: 'lost',
    title: asString(params.item),
    description:
      asString(params.features) || asString(params.description) || 'AI 代理建立的遺失物公告',
    category: mapLostFoundCategory(params.category),
    location: asString(params.location),
    date: parseDateValue(params.date ?? params.time),
    reporterId: userId!,
    schoolId: schoolId!,
    contactInfo: asString(params.contactInfo) || undefined,
  });
  return executed(
    `遺失公告已發布。\n公告編號：${item.id}\n物品：${item.title}\n地點：${item.location}`,
    item.id,
    defaultActionsForTool(ctx.tool),
  );
}

async function executePrintJob(ctx: AIActionExecutorContext): Promise<AIActionExecutionResult> {
  const { params, userId, schoolId, dataSource } = ctx;
  const authBlock = requireSignedIn(userId);
  if (authBlock) return authBlock;
  const schoolBlock = requireSchool(schoolId);
  if (schoolBlock) return schoolBlock;
  const fileName = asString(params.file_name ?? params.fileName);
  if (!fileName) return createActionDraft(ctx, '缺少檔案名稱，不能直接建立列印工作。');

  const printers = await dataSource.listPrinters(schoolId!);
  const printer = choosePrinter(params, printers);
  if (!printer)
    return blocked('目前找不到可用印表機，沒有建立列印工作。', defaultActionsForTool(ctx.tool));

  const copies = Number(params.copies ?? 1) || 1;
  const color = asString(params.color) === 'color' || params.color === true;
  const duplex = asString(params.sides) === 'duplex' || params.duplex === true;
  const job = await dataSource.createPrintJob({
    userId: userId!,
    schoolId: schoolId!,
    printerId: printer.id,
    fileName,
    fileUrl: asString(params.fileUrl) || undefined,
    pages: Number(params.pages ?? 1) || 1,
    copies,
    color,
    duplex,
  });
  return executed(
    `列印工作已建立。\n工作編號：${job.id}\n印表機：${printer.name}\n檔案：${fileName}`,
    job.id,
    defaultActionsForTool(ctx.tool),
  );
}

async function executeReminder(ctx: AIActionExecutorContext): Promise<AIActionExecutionResult> {
  const { params, userId, schoolId, dataSource } = ctx;
  const authBlock = requireSignedIn(userId);
  if (authBlock) return authBlock;
  const start = parseDateTime(params.datetime ?? params.date);
  const end = new Date(start.getTime() + 30 * 60 * 1000);
  const event: Omit<CalendarEvent, 'id'> = {
    userId: userId!,
    schoolId: schoolId ?? undefined,
    title: asString(params.title) || 'AI 提醒',
    description: asString(params.description ?? params.note) || 'AI 助理建立的提醒',
    startAt: start.toISOString(),
    endAt: end.toISOString(),
    allDay: false,
    type: 'personal',
    sourceType: 'custom',
    reminder: 0,
  };
  const created = await dataSource.createCalendarEvent(event);
  return executed(
    `已建立提醒。\n提醒編號：${created.id}\n內容：${created.title}\n時間：${created.startAt ?? created.startDate}`,
    created.id,
    defaultActionsForTool(ctx.tool),
  );
}

async function executeSendMessage(ctx: AIActionExecutorContext): Promise<AIActionExecutionResult> {
  const { params, userId, schoolId, dataSource } = ctx;
  const authBlock = requireSignedIn(userId);
  if (authBlock) return authBlock;
  const content = asString(params.content);
  const conversationId = asString(params.conversationId);
  const recipientId = asString(params.recipientId ?? params.userId);
  if (!content) return createActionDraft(ctx, '缺少訊息內容。');
  if (!conversationId && !recipientId)
    return createActionDraft(ctx, '無法解析收件人，不能直接送出訊息。');

  const conversation = conversationId
    ? { id: conversationId }
    : await dataSource.createConversation([userId!, recipientId], schoolId ?? undefined);
  const msg = await dataSource.sendMessage({
    conversationId: conversation.id,
    senderId: userId!,
    content,
    type: 'text',
    readBy: [userId!],
  });
  return executed(`訊息已送出。\n訊息編號：${msg.id}`, msg.id, defaultActionsForTool(ctx.tool));
}

async function executeAssignmentPublish(
  ctx: AIActionExecutorContext,
): Promise<AIActionExecutionResult> {
  const { params, userId, dataSource, courses } = ctx;
  const authBlock = requireSignedIn(userId);
  if (authBlock) return authBlock;
  const course = findCourse(params, courses);
  const groupId = asString(params.groupId ?? course?.groupId ?? course?.id);
  if (!groupId) return createActionDraft(ctx, '無法解析課程群組，不能直接發布作業。');
  if (!asString(params.title)) return createActionDraft(ctx, '缺少作業標題。');

  const assignment = await dataSource.createAssignment({
    groupId,
    courseId: asString(course?.courseId ?? course?.id) || undefined,
    title: asString(params.title),
    description: asString(params.description) || 'AI 代理建立的作業',
    dueAt: parseDateTime(params.deadline ?? params.dueAt, 24 * 60).toISOString(),
    type: 'homework',
    createdBy: userId!,
  });
  return executed(
    `作業已發布。\n作業編號：${assignment.id}\n課程：${course?.name ?? groupId}\n標題：${assignment.title}`,
    assignment.id,
    defaultActionsForTool(ctx.tool),
  );
}

export async function executeAgentToolAction(
  ctx: AIActionExecutorContext,
): Promise<AIActionExecutionResult> {
  const { tool, role } = ctx;
  if (!isRoleAllowed(tool, role)) {
    return blocked(`目前角色沒有權限執行「${tool.name}」。`);
  }

  if (DRAFT_ONLY_TOOLS.has(tool.id)) {
    return createActionDraft(ctx, '這項功能需要人工、第三方或後端流程確認，V1 只建立草稿。');
  }

  if (!DIRECT_EXECUTION_TOOLS.has(tool.id)) {
    return createActionDraft(ctx, '這項工具尚未接上可驗證的正式執行 API。');
  }

  switch (tool.id) {
    case 'order_meal':
      return executeOrderMeal(ctx);
    case 'book_health':
      return executeHealthBooking(ctx);
    case 'reserve_seat':
      return executeSeatReservation(ctx);
    case 'report_repair':
      return executeRepairRequest(ctx);
    case 'post_lost':
      return executeLostFoundPost(ctx);
    case 'print_file':
      return executePrintJob(ctx);
    case 'set_reminder':
      return executeReminder(ctx);
    case 'send_message':
      return executeSendMessage(ctx);
    case 'assignment_publish':
      return executeAssignmentPublish(ctx);
    default:
      return createActionDraft(ctx);
  }
}
