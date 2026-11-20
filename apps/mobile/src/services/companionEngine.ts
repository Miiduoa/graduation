/**
 * 校園同伴引擎 — 與 XP、campusEventBus、各功能畫面深度連動。
 * 無懲罰性設計：離線僅「緩慢成長」，不中斷校務動線。
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { XPAction } from './gamificationEngine';
import companionContent from '../data/companionContent.json';

const STORAGE_KEY = '@companion:v1';
const HIDDEN_KEY = '@companion:hidden';

/** 每日離線有效成長上限（毫秒）：約 8 小時 */
const OFFLINE_CAP_MS_PER_DAY = 8 * 60 * 60 * 1000;
const TICK_TO_GROWTH_MS = 120000; // 每 2 分鐘有效離線時間 → +1 growth（上限內）

export type CompanionDomain =
  | 'today'
  | 'ai'
  | 'learn'
  | 'campus_map'
  | 'life_services'
  | 'social'
  | 'messages'
  | 'default';

export type CompanionDailySlots = {
  /** 開啟 Today／簽到脈絡 */
  touchedTodayHub: boolean;
  /** AI 對話／代理人 */
  touchedAi: boolean;
  /** 校園貢獻：人潮／訂餐／失物／圖書／報修等 */
  touchedCampusLife: boolean;
  calendarDay: string;
};

export type CompanionStoredState = {
  petGrowth: number;
  cropGrowth: number;
  mood: number;
  /** 各領域熱度 0–100（視覺／台詞加權） */
  domainHeat: Record<CompanionDomain, number>;
  daily: CompanionDailySlots;
  lastCompanionTickMs: number;
  offlineGrowthBudgetMsUsedToday: number;
  offlineBudgetCalendarDay: string;
  unlockedDecor: string[];
};

export type CompanionPublicSnapshot = {
  hidden: boolean;
  petGrowth: number;
  petStageTitle: string;
  petStageSubtitle: string;
  cropGrowth: number;
  cropStageLabel: string;
  moodLabel: string;
  dailyProgressText: string;
  quote: string;
  domainHeat: Record<CompanionDomain, number>;
};

function todayStr(): string {
  return new Date().toISOString().split('T')[0];
}

function defaultDaily(): CompanionDailySlots {
  const d = todayStr();
  return {
    touchedTodayHub: false,
    touchedAi: false,
    touchedCampusLife: false,
    calendarDay: d,
  };
}

function defaultState(): CompanionStoredState {
  const domains: CompanionDomain[] = [
    'today',
    'ai',
    'learn',
    'campus_map',
    'life_services',
    'social',
    'messages',
    'default',
  ];
  const domainHeat = {} as Record<CompanionDomain, number>;
  for (const k of domains) domainHeat[k] = 0;

  const d = todayStr();
  return {
    petGrowth: 5,
    cropGrowth: 0,
    mood: 70,
    domainHeat,
    daily: defaultDaily(),
    lastCompanionTickMs: Date.now(),
    offlineGrowthBudgetMsUsedToday: 0,
    offlineBudgetCalendarDay: d,
    unlockedDecor: [],
  };
}

async function loadRaw(): Promise<CompanionStoredState> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    const p = JSON.parse(raw) as CompanionStoredState;
    if (!p.daily?.calendarDay) p.daily = defaultDaily();
    if (!p.domainHeat) p.domainHeat = defaultState().domainHeat;
    return p;
  } catch {
    return defaultState();
  }
}

async function saveRaw(s: CompanionStoredState): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(s));
}

export async function isCompanionHidden(): Promise<boolean> {
  try {
    const v = await AsyncStorage.getItem(HIDDEN_KEY);
    return v === '1';
  } catch {
    return false;
  }
}

export async function setCompanionHidden(hidden: boolean): Promise<void> {
  await AsyncStorage.setItem(HIDDEN_KEY, hidden ? '1' : '0');
}

function rolloverDailyIfNeeded(s: CompanionStoredState): void {
  const d = todayStr();
  if (s.daily.calendarDay !== d) {
    s.daily = {
      touchedTodayHub: false,
      touchedAi: false,
      touchedCampusLife: false,
      calendarDay: d,
    };
  }
  if (s.offlineBudgetCalendarDay !== d) {
    s.offlineGrowthBudgetMsUsedToday = 0;
    s.offlineBudgetCalendarDay = d;
  }
}

/** App 進前景時呼叫：離線緩速成長（ capped ） */
export async function applyForegroundCompanionTick(): Promise<CompanionPublicSnapshot | null> {
  if (await isCompanionHidden()) return null;
  const s = await loadRaw();
  rolloverDailyIfNeeded(s);
  const now = Date.now();
  const dt = Math.max(0, now - (s.lastCompanionTickMs || now));
  s.lastCompanionTickMs = now;

  const budgetLeft = Math.max(0, OFFLINE_CAP_MS_PER_DAY - s.offlineGrowthBudgetMsUsedToday);
  const applied = Math.min(dt, budgetLeft);
  s.offlineGrowthBudgetMsUsedToday += applied;

  const growthTicks = Math.floor(applied / TICK_TO_GROWTH_MS);
  if (growthTicks > 0) {
    s.petGrowth = Math.min(100, s.petGrowth + Math.min(growthTicks, 4));
    s.cropGrowth = Math.min(100, s.cropGrowth + Math.min(growthTicks, 3));
    s.mood = Math.min(100, s.mood + 1);
  }

  await saveRaw(s);
  return buildSnapshot(s);
}

function bumpDomain(s: CompanionStoredState, domain: CompanionDomain, delta: number): void {
  const cur = s.domainHeat[domain] ?? 0;
  s.domainHeat[domain] = Math.min(100, Math.max(0, cur + delta));
}

/** XP 動作對應同伴領域與每日槽 */
export async function notifyFromXpAction(action: XPAction): Promise<void> {
  if (await isCompanionHidden()) return;
  const s = await loadRaw();
  rolloverDailyIfNeeded(s);

  switch (action) {
    case 'daily_login':
      bumpDomain(s, 'today', 8);
      s.daily.touchedTodayHub = true;
      s.petGrowth = Math.min(100, s.petGrowth + 2);
      break;
    case 'use_ai_chat':
      bumpDomain(s, 'ai', 10);
      s.daily.touchedAi = true;
      s.petGrowth = Math.min(100, s.petGrowth + 1);
      s.mood = Math.min(100, s.mood + 2);
      break;
    case 'report_crowd':
      bumpDomain(s, 'campus_map', 12);
      s.daily.touchedCampusLife = true;
      s.cropGrowth = Math.min(100, s.cropGrowth + 4);
      break;
    case 'read_announcement':
      bumpDomain(s, 'today', 6);
      s.daily.touchedTodayHub = true;
      break;
    case 'explore_campus':
      bumpDomain(s, 'campus_map', 8);
      s.daily.touchedCampusLife = true;
      break;
    case 'attend_class':
    case 'submit_assignment':
    case 'complete_quiz':
    case 'study_session':
    case 'check_grades':
    case 'plan_schedule':
      bumpDomain(s, 'learn', 10);
      s.daily.touchedTodayHub = true;
      s.petGrowth = Math.min(100, s.petGrowth + 2);
      break;
    case 'write_review':
    case 'join_study_group':
    case 'help_peer':
      bumpDomain(s, 'social', 10);
      s.daily.touchedCampusLife = true;
      break;
    default:
      bumpDomain(s, 'default', 4);
      s.petGrowth = Math.min(100, s.petGrowth + 1);
  }

  maybeCareBonus(s);
  await saveRaw(s);
}

/** 非 XP 的功能節點（訂餐、失物、報修等） */
export async function recordCompanionFeatureSignal(
  signal:
    | 'cafeteria_order'
    | 'lost_found_post'
    | 'library_action'
    | 'dorm_repair'
    | 'print_job'
    | 'notification_batch'
    | 'chat_sent'
    | 'group_join'
    | 'post_created'
    | 'map_open'
    | 'bus_view'
    | 'health_action'
    | 'vendor_hub'
    | 'sso_login'
    | 'payment_completed',
): Promise<void> {
  if (await isCompanionHidden()) return;
  const s = await loadRaw();
  rolloverDailyIfNeeded(s);

  switch (signal) {
    case 'cafeteria_order':
      bumpDomain(s, 'campus_map', 10);
      bumpDomain(s, 'life_services', 6);
      s.daily.touchedCampusLife = true;
      s.cropGrowth = Math.min(100, s.cropGrowth + 5);
      break;
    case 'lost_found_post':
      bumpDomain(s, 'life_services', 14);
      s.daily.touchedCampusLife = true;
      s.mood = Math.min(100, s.mood + 5);
      break;
    case 'library_action':
      bumpDomain(s, 'learn', 8);
      s.daily.touchedCampusLife = true;
      break;
    case 'dorm_repair':
    case 'print_job':
      bumpDomain(s, 'life_services', 12);
      s.daily.touchedCampusLife = true;
      break;
    case 'notification_batch':
      bumpDomain(s, 'today', 5);
      break;
    case 'chat_sent':
      bumpDomain(s, 'messages', 10);
      bumpDomain(s, 'social', 4);
      break;
    case 'group_join':
    case 'post_created':
      bumpDomain(s, 'social', 12);
      s.daily.touchedCampusLife = true;
      break;
    case 'map_open':
    case 'bus_view':
      bumpDomain(s, 'campus_map', 8);
      s.daily.touchedCampusLife = true;
      break;
    case 'health_action':
      bumpDomain(s, 'life_services', 10);
      break;
    case 'vendor_hub':
      bumpDomain(s, 'campus_map', 6);
      break;
    case 'sso_login':
      bumpDomain(s, 'today', 4);
      break;
    case 'payment_completed':
      bumpDomain(s, 'life_services', 10);
      bumpDomain(s, 'today', 3);
      s.daily.touchedCampusLife = true;
      break;
    default:
      bumpDomain(s, 'default', 3);
  }

  maybeCareBonus(s);
  await saveRaw(s);
}

/** campusEventBus 事件深度綁定（不通過 XP 時仍更新同伴） */
export async function notifyCampusBusEvent(eventType: string): Promise<void> {
  if (await isCompanionHidden()) return;
  const map: Partial<Record<string, CompanionDomain>> = {
    'attendance:checked_in': 'learn',
    'assignment:submitted': 'learn',
    'assignment:graded': 'learn',
    'assignment:published': 'learn',
    'grade:updated': 'learn',
    'gpa:changed': 'learn',
    'leave:reviewed': 'today',
    'course:enrolled': 'learn',
    'course:created': 'learn',
    'course:approved': 'learn',
    'session:started': 'learn',
    'session:ended': 'learn',
    'group:joined': 'social',
    'buddy:matched': 'social',
    'post:created': 'social',
    'crowd:reported': 'campus_map',
    'cafeteria:order_placed': 'campus_map',
    'lostfound:posted': 'life_services',
    'user:daily_login': 'today',
    'achievement:unlocked': 'default',
    'streak:updated': 'today',
    'xp:earned': 'default',
    'post_login_context_ready': 'default',
    'post_login_data_routed': 'default',
    'role_updated': 'default',
  };

  const domain = map[eventType];
  if (!domain) return;

  const s = await loadRaw();
  rolloverDailyIfNeeded(s);

  bumpDomain(s, domain, eventType === 'crowd:reported' ? 10 : 7);

  if (
    eventType === 'crowd:reported' ||
    eventType === 'cafeteria:order_placed' ||
    eventType === 'lostfound:posted'
  ) {
    s.daily.touchedCampusLife = true;
  }
  if (eventType === 'user:daily_login') {
    s.daily.touchedTodayHub = true;
  }
  if (eventType === 'assignment:submitted' || eventType === 'attendance:checked_in') {
    s.daily.touchedTodayHub = true;
  }

  maybeCareBonus(s);
  await saveRaw(s);
}

function maybeCareBonus(s: CompanionStoredState): void {
  const slots = [s.daily.touchedTodayHub, s.daily.touchedAi, s.daily.touchedCampusLife];
  const n = slots.filter(Boolean).length;
  if (n >= 3) {
    s.petGrowth = Math.min(100, s.petGrowth + 2);
    s.cropGrowth = Math.min(100, s.cropGrowth + 3);
    s.mood = Math.min(100, s.mood + 3);
  }
}

/** 對外里程碑（等級／連續天數）同步 — 可由 Today 載入 gamification 後呼叫 */
export async function syncCompanionMilestones(level: number, streakDays: number): Promise<void> {
  if (await isCompanionHidden()) return;
  const s = await loadRaw();
  rolloverDailyIfNeeded(s);

  if (streakDays >= 7 && !s.unlockedDecor.includes('streak_7_badge')) {
    s.unlockedDecor.push('streak_7_badge');
  }
  if (level >= 10 && !s.unlockedDecor.includes('level_10_planter')) {
    s.unlockedDecor.push('level_10_planter');
  }
  if (level > 0 && level % 5 === 0) {
    s.petGrowth = Math.min(100, s.petGrowth + 2);
  }

  await saveRaw(s);
}

function pickQuote(s: CompanionStoredState): string {
  const heatPairs = Object.entries(s.domainHeat) as [CompanionDomain, number][];
  heatPairs.sort((a, b) => b[1] - a[1]);
  const top = heatPairs[0]?.[0] ?? 'default';
  const pool =
    (companionContent.quotesByDomain as Record<string, string[]>)[top] ??
    companionContent.quotesByDomain.default;
  const idx = Math.abs(Math.floor(s.petGrowth + s.mood)) % pool.length;
  return pool[idx] ?? companionContent.quotesByDomain.default[0];
}

function petStageForGrowth(g: number): { title: string; subtitle: string } {
  const stages = companionContent.petStages as Array<{ minGrowth: number; title: string; subtitle: string }>;
  let cur = stages[0];
  for (const st of stages) {
    if (g >= st.minGrowth) cur = st;
  }
  return { title: cur.title, subtitle: cur.subtitle };
}

function cropLabel(g: number): string {
  const arr = companionContent.cropStages as string[];
  const i = Math.min(arr.length - 1, Math.floor((g / 100) * arr.length));
  return arr[i];
}

export function buildSnapshot(s: CompanionStoredState): CompanionPublicSnapshot {
  const ps = petStageForGrowth(s.petGrowth);
  let moodLabel = '普通';
  if (s.mood >= 85) moodLabel = '超好';
  else if (s.mood >= 65) moodLabel = '不錯';
  else if (s.mood < 45) moodLabel = '想見你';

  const slots = [s.daily.touchedTodayHub, s.daily.touchedAi, s.daily.touchedCampusLife];
  const done = slots.filter(Boolean).length;

  return {
    hidden: false,
    petGrowth: s.petGrowth,
    petStageTitle: ps.title,
    petStageSubtitle: ps.subtitle,
    cropGrowth: s.cropGrowth,
    cropStageLabel: cropLabel(s.cropGrowth),
    moodLabel,
    dailyProgressText: `今日照顧 ${done}/3（Today／AI／校園生活）`,
    quote: pickQuote(s),
    domainHeat: { ...s.domainHeat },
  };
}

export async function getCompanionSnapshot(): Promise<CompanionPublicSnapshot | null> {
  if (await isCompanionHidden()) return null;
  const s = await loadRaw();
  rolloverDailyIfNeeded(s);
  await saveRaw(s);
  return buildSnapshot(s);
}
