import {
  ASSISTANT_SERVICES,
  getAssistantService,
  type AssistantServiceId,
} from './assistantServices';

export type AssistantTaskStatus = 'completed' | 'ready' | 'partial' | 'blocked' | 'handoff';

/** Display evidence only. Neither a status nor a card ID grants permission to execute. */
export type AssistantTaskStep = {
  id: string;
  label: string;
  serviceId: AssistantServiceId;
  dependsOn: string[];
  status: AssistantTaskStatus;
  summary: string;
  cardIds?: string[];
  href?: string;
};

export type AssistantTaskPlan = { version: 1; steps: AssistantTaskStep[] };

export type AssistantServiceCapabilityMode = 'read' | 'prepare' | 'handoff';
export type AssistantServiceCapability = {
  readonly serviceId: AssistantServiceId;
  readonly modes: readonly AssistantServiceCapabilityMode[];
  readonly summary: string;
  readonly tools: readonly string[];
};

type CapabilityDescription = Omit<AssistantServiceCapability, 'serviceId'>;
const handoff = (summary: string): CapabilityDescription => ({
  modes: ['handoff'], summary, tools: ['list_campus_services', 'propose_open_page'],
});

/**
 * Web V2's connected readers and proposal tools, not the capabilities of every
 * backend or the current account. Runtime permissions and source availability
 * must still be checked by the original tool. A prepared action is not a write.
 */
const capabilityDescriptions = {
  today: {
    modes: ['read', 'prepare'],
    summary: '可查今天的課表、個人行程與課程待辦，並準備待確認的讀書行程。',
    tools: ['get_today_context', 'get_day_overview', 'get_due_work', 'propose_study_plan'],
  },
  timetable: {
    modes: ['read'],
    summary: '可查目前帳號已同步的課表並核對課間空堂；不會代替校方選課。',
    tools: ['get_schedule', 'find_free_time'],
  },
  classroom: {
    modes: ['read', 'prepare'],
    summary: '可查本人有權限的 nuni 課程、作業、測驗與教材，並準備讀書行程；不會代交作業或作答。',
    tools: ['list_courses', 'get_course_work', 'get_due_work', 'get_materials', 'propose_study_plan'],
  },
  'material-bookmarks': handoff('可開啟教材收藏；本助理尚未讀取裝置收藏或代替收藏。'),
  calendar: {
    modes: ['read', 'prepare'],
    summary: '可查個人行程、核對空堂並準備新增行程；仍需確認與讀回，才算建立完成。',
    tools: ['get_calendar', 'find_free_time', 'propose_personal_event'],
  },
  grades: handoff('可開啟學期成績頁；校方成績尚未接入本助理的資料查詢。'),
  'grade-feedback': handoff('可開啟課程成績回饋；本助理尚未讀取老師評語或評分。'),
  credits: {
    modes: ['read'],
    summary: '可查已保存的個人匯入學業紀錄；不計算正式採計、GPA 或畢業資格，學分規劃需回原頁核對。',
    tools: ['get_imported_academics'],
  },
  import: {
    modes: ['read'],
    summary: '可查已保存的匯入學業紀錄；新增或更改匯入資料需到匯入頁核對。',
    tools: ['get_imported_academics'],
  },
  'school-courses': {
    modes: ['read', 'handoff'],
    summary: '可查清大、暨大的已接通公開開課資料，保留校名、關鍵字、星期與學分條件；其他校園保留入口，匯入課表與正式選課仍須在原流程核對。',
    tools: ['get_public_courses', 'list_campus_services', 'propose_open_page'],
  },
  'school-lms': handoff('可開啟校方作業與教材入口；本助理尚未接通校方作業繳交。'),
  attendance: handoff('可開啟課程的點名與出席入口；本助理尚未代查或代送點名。'),
  announcements: handoff('可提供所選校園的公告入口；此工具不會讀取公告全文。'),
  events: handoff('可提供所選校園的活動入口；此工具不會讀取活動內容或代報名。'),
  library: handoff('可提供圖書館服務與官方來源入口；此工具不會查借閱紀錄、續借或預約座位。'),
  map: handoff('可提供所選校園的地圖與官方來源入口；此工具不會建立實際導航路線。'),
  bus: {
    modes: ['read'],
    summary: '可查所選校園的站點與到站資料；保留來源失敗、即時或表定狀態。',
    tools: ['get_transit'],
  },
  'school-info': handoff('可開啟學校資訊；詳細聯絡方式需到原頁核對。'),
  'student-card': handoff('可開啟本人的學生證頁；本助理不會變更校籍、出示憑證或感應門禁。'),
  cafeteria: {
    modes: ['read'],
    summary: '可查餐廳與已提供的菜單資料；實際下單由點餐流程另行確認。',
    tools: ['get_dining', 'get_food_locations', 'get_food_menu'],
  },
  food: {
    modes: ['read', 'prepare'],
    summary: '可查可用店家、菜單與本人訂單，準備餐點提議；入口或購物車備妥不代表已下單或付款。',
    tools: ['get_food_locations', 'get_food_menu', 'list_food_orders', 'get_food_order', 'propose_food_order', 'reorder_last_food_order'],
  },
  orders: {
    modes: ['read'],
    summary: '可查本人可用平台店家的訂單與明細；不會自動取消、付款或完成取餐。',
    tools: ['list_food_orders', 'get_food_order'],
  },
  'app-orders': handoff('可開啟學校帳號的 App 餐廳訂單；不與平台店家訂單混用。'),
  dormitory: handoff('可開啟宿舍服務；本助理尚未代查包裹或代送宿舍報修。'),
  leave: handoff('可開啟請假頁；本助理尚未代填或代送假單。'),
  'leave-review': handoff('可開啟請假核閱；教師資格與每筆核閱仍由原頁確認。'),
  appeals: handoff('可開啟本人課程申訴；本助理尚未代查或代送申訴。'),
  teacher: handoff('可開啟課務申訴審核；教師資格與審核操作仍由原頁確認。'),
  'lost-found': handoff('可開啟失物招領；本助理尚未搜尋內容、發布或聯絡他人。'),
  'public-social': handoff('可開啟跨校公開交流；本助理尚未讀取貼文或代發內容。'),
  community: handoff('可開啟校園社群；本助理尚未讀取貼文或代發內容。'),
  messages: handoff('可開啟私人訊息；本助理尚未讀取或傳送私人對話。'),
  notifications: handoff('可開啟通知中心；正式服務尚未接入本助理的通知查詢。'),
  groups: handoff('可開啟群組；本助理尚未讀取群組內容或傳送訊息。'),
  friends: handoff('可開啟好友管理；本助理尚未搜尋同學或送出邀請。'),
  clubs: {
    modes: ['read'],
    summary: '可查有權限的社團目錄、成員關係與社團動態；不會代替入社、發文或報名。',
    tools: ['list_clubs', 'get_club_feed'],
  },
  account: handoff('可開啟我的帳號；本助理不會變更個人資料或登入身分。'),
  'school-account': handoff('可開啟學校資格頁；本助理不會核發或變更學校資格。'),
  'account-deletion': handoff('可開啟刪除帳號說明；此入口不會提出或執行刪帳。'),
  settings: handoff('可開啟設定；本助理不會自行更改設定。'),
  'assistant-permissions': handoff('可開啟助理權限設定；授權變更由本人確認。'),
  assistant: handoff('可開啟校園助理；每項資料查詢與提議仍依原功能權限執行。'),
  merchant: handoff('可開啟店家工作區；本助理不會授予門市資格或代替管理店家。'),
  admin: handoff('可開啟平台管理；本助理不會取得管理權限或代替管理操作。'),
  support: handoff('可開啟使用說明與支援；本助理不會代送聯絡訊息。'),
} satisfies Record<AssistantServiceId, CapabilityDescription>;

export const ASSISTANT_SERVICE_CAPABILITIES: readonly AssistantServiceCapability[] = Object.freeze(
  ASSISTANT_SERVICES.map(({ id: serviceId }) => {
    const description = capabilityDescriptions[serviceId];
    return Object.freeze({
      serviceId,
      modes: Object.freeze([...description.modes]),
      summary: description.summary,
      tools: Object.freeze([...description.tools]),
    });
  }),
);

const capabilitiesById = new Map<string, AssistantServiceCapability>(
  ASSISTANT_SERVICE_CAPABILITIES.map((entry) => [entry.serviceId, entry]),
);

export function getAssistantServiceCapability(serviceId: unknown): AssistantServiceCapability | null {
  return typeof serviceId === 'string' ? capabilitiesById.get(serviceId) ?? null : null;
}

const STATUSES: readonly AssistantTaskStatus[] = ['completed', 'ready', 'partial', 'blocked', 'handoff'];
const STEP_FIELDS = ['id', 'label', 'serviceId', 'dependsOn', 'status', 'summary', 'cardIds', 'href'];
const REQUIRED_STEP_FIELDS = ['id', 'label', 'serviceId', 'dependsOn', 'status', 'summary'];

function record(raw: unknown, fields: readonly string[], required = fields): Record<string, unknown> | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const prototype = Object.getPrototypeOf(raw);
  if (prototype !== null && prototype !== Object.prototype) return null;
  const descriptors = Object.getOwnPropertyDescriptors(raw);
  const keys = Reflect.ownKeys(descriptors);
  if (keys.length > fields.length) return null;
  const result: Record<string, unknown> = Object.create(null);
  for (const key of keys) {
    if (typeof key !== 'string' || !fields.includes(key)) return null;
    const descriptor = descriptors[key];
    if (!descriptor.enumerable || !('value' in descriptor) || descriptor.value === undefined) return null;
    result[key] = descriptor.value;
  }
  return required.every((key) => Object.hasOwn(result, key)) ? result : null;
}

function array(raw: unknown, max: number, min = 0): unknown[] | null {
  if (!Array.isArray(raw) || Object.getPrototypeOf(raw) !== Array.prototype || raw.length < min || raw.length > max)
    return null;
  const descriptors = Object.getOwnPropertyDescriptors(raw);
  if (Reflect.ownKeys(descriptors).length !== raw.length + 1) return null;
  const result: unknown[] = [];
  for (let index = 0; index < raw.length; index++) {
    const descriptor = descriptors[String(index)];
    if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) return null;
    result.push(descriptor.value);
  }
  return result;
}

function safeText(raw: unknown, max: number): raw is string {
  if (typeof raw !== 'string' || !raw.trim() || raw !== raw.trim() || raw.length > max) return false;
  for (const character of raw) {
    const code = character.codePointAt(0)!;
    if (code < 32 || code === 127 || code === 0x2028 || code === 0x2029) return false;
  }
  return true;
}

function safeId(raw: unknown): raw is string {
  return typeof raw === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/.test(raw);
}

function safeHref(raw: unknown, serviceId: AssistantServiceId): raw is string {
  if (!safeText(raw, 512) || /\s|\\/.test(raw) || !raw.startsWith('/') || raw.startsWith('//')) return false;
  const service = getAssistantService(serviceId)!;
  const pathname = raw.split(/[?#]/, 1)[0];
  const canonicalPath = service.href.split(/[?#]/, 1)[0];
  if (pathname !== canonicalPath && !(serviceId === 'orders' && pathname === '/food')) return false;
  // The literal allowlisted path cannot redirect through encoded slashes or dot
  // segments. Also refuse control characters/backslashes hidden in parameters.
  let decoded = raw;
  for (let pass = 0; pass < 3; pass++) {
    const next = decodeURIComponent(decoded);
    if (!safeText(next, 512) || next.includes('\\')) return false;
    if (next === decoded || !/%[0-9a-f]{2}/i.test(next)) return true;
    decoded = next;
  }
  return !/%[0-9a-f]{2}/i.test(decoded);
}

/**
 * Validate a small, ordered dependency graph before rendering. The caller must
 * resolve cardIds against cards in this same reply and keep existing signed-card
 * confirmation/readback checks; this display contract does not replace them.
 */
export function parseAssistantTaskPlan(raw: unknown): AssistantTaskPlan | null {
  try {
    const value = record(raw, ['version', 'steps']);
    if (!value || value.version !== 1) return null;
    const items = array(value.steps, 16, 1);
    if (!items) return null;
    const steps: AssistantTaskStep[] = [];
    const seen = new Set<string>();
    for (const rawStep of items) {
      const step = record(rawStep, STEP_FIELDS, REQUIRED_STEP_FIELDS);
      if (!step || !safeId(step.id) || seen.has(step.id) || !safeText(step.label, 120) ||
          !safeText(step.summary, 1200) || !getAssistantService(step.serviceId) ||
          !STATUSES.includes(step.status as AssistantTaskStatus)) return null;
      const dependencies = array(step.dependsOn, 15);
      if (!dependencies || dependencies.some((dependency) => !safeId(dependency) || !seen.has(dependency)) ||
          new Set(dependencies).size !== dependencies.length) return null;
      const parsed: AssistantTaskStep = {
        id: step.id,
        label: step.label,
        serviceId: step.serviceId as AssistantServiceId,
        dependsOn: dependencies as string[],
        status: step.status as AssistantTaskStatus,
        summary: step.summary,
      };
      if (Object.hasOwn(step, 'cardIds')) {
        const cardIds = array(step.cardIds, 16, 1);
        if (!cardIds || cardIds.some((cardId) => !safeId(cardId)) || new Set(cardIds).size !== cardIds.length)
          return null;
        parsed.cardIds = cardIds as string[];
      }
      if (Object.hasOwn(step, 'href')) {
        if (!safeHref(step.href, parsed.serviceId)) return null;
        parsed.href = step.href;
      }
      seen.add(parsed.id);
      steps.push(parsed);
    }
    return { version: 1, steps };
  } catch {
    return null;
  }
}
