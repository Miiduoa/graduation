/**
 * Campus Sprite Engine — 校園精靈狀態計算
 *
 * 設計原則（與 Wellbeing 護欄一致）：
 *  - 不會餓死、不會病死、不打 streak 懲罰
 *  - 期考週 / 病假 / 寒暑假 → 自動 hibernate，需求降至 0
 *  - 偵測 burnout → 主動建議休息，不施壓
 *  - 進化由「累積天數 × 活動廣度」決定，不靠 grind
 *  - 純函式：input → output，無 I/O、無 side effect
 */

// ─────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────

export type SpriteNeedKey = 'study' | 'move' | 'nourish' | 'social';

export interface DailyActivitySignal {
  /** ISO date YYYY-MM-DD */
  date: string;
  // ── 學 Study：對應 LMS 主幹 ──
  studyMinutes: number;
  assignmentsSubmitted: number;
  materialsRead: number;
  quizAttempts: number;
  attendanceCheckins: number;
  /** 圖書館：借書、續借、座位預約、自習打卡 */
  libraryActions: number;
  /** AI 學習對話次數（AICourseAdvisor / AIChat 學習相關） */
  aiTutorTurns: number;
  /** 列印行為（複習講義） */
  printJobs: number;
  // ── 動 Move：對應校園服務 ──
  campusStepsEstimate: number;
  campusVisitsCount: number;
  /** 公車 / 校車打卡 */
  busCheckins: number;
  /** AR 導航完成次數 */
  arNavigationCompleted: number;
  /** 健康中心、運動場館 */
  healthCenterVisits: number;
  // ── 食 Nourish ──
  mealsOrdered: number;
  distinctVendors: number;
  /** 訂閱菜單、查看人潮預測 */
  cafeteriaInteractions: number;
  /** 預算追蹤頁面查看次數（培養理財感） */
  budgetChecks: number;
  // ── 友 Social ──
  socialInteractions: number;
  groupOrderJoined: number;
  /** 互評：交出 / 收到 */
  peerReviewsGiven: number;
  peerReviewsReceived: number;
  /** 討論串發文 / 回覆 / 標 useful */
  discussionPosts: number;
  /** 鼓勵雲收發 */
  encouragementsSent: number;
  encouragementsReceived: number;
  // ── 校園生活 Life ──
  /** 失物招領：發布 / 認領 */
  lostFoundActions: number;
  /** 宿舍報修：發單 */
  dormRepairCreated: number;
  /** 活動報名 / 簽到 */
  eventAttendance: number;
  /** 學分試算頁打開 */
  creditAuditChecks: number;
  /** 通知執行（從 inbox 直接完成任務） */
  inboxActionsTaken: number;
  // ── 控制 ──
  /** 是否標記為 hibernate（病假 / 期考週 / 寒暑假） */
  hibernated?: boolean;
}

export interface SpriteProfile {
  /** 帳號建立日（ISO） */
  createdAt: string;
  /** 學年（1-4） */
  studyYear: 1 | 2 | 3 | 4;
  /** 學期月份（1-12） */
  currentMonth: number;
  /** 學校 ID（決定季節限定外觀） */
  schoolId?: string;
}

export type EvolutionStage = 'egg' | 'sprout' | 'fledgling' | 'companion' | 'guardian';

export type MoodTag =
  | 'sleepy' // hibernate / 半夜
  | 'energetic' // 多面向活動
  | 'focused' // 學習為主
  | 'curious' // 探索為主
  | 'caring' // 社交為主
  | 'tired' // 偵測 burnout
  | 'lonely'; // 完全沒互動

export interface NeedBalance {
  study: number; // 0-100
  move: number;
  nourish: number;
  social: number;
}

export interface SpriteState {
  evolutionStage: EvolutionStage;
  /** 0-100 整體健康度（不會 < 0；hibernate 時保持原值不掉） */
  vitality: number;
  mood: MoodTag;
  needs: NeedBalance;
  /** 季節 / 校園氣象的外觀標籤 */
  appearance: {
    season: 'spring' | 'summer' | 'autumn' | 'winter';
    seasonalAccessory: string;
    weatherMood: 'sunny' | 'cloudy' | 'rainy' | 'snowy' | 'starry';
  };
  /** 給使用者的訊息（不一定每次出現） */
  message: string | null;
  /** burnout / wellbeing 警示 */
  careHint: {
    kind: 'rest' | 'meal' | 'social' | 'celebrate' | 'none';
    text: string;
    ctaTarget?: string;
  };
  /** debug / 顯示用 */
  daysActive: number;
  daysHibernated: number;
}

// ─────────────────────────────────────────────────────────
// 內部計分器
// ─────────────────────────────────────────────────────────

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, n));
}

function studyScoreOf(d: DailyActivitySignal): number {
  // 上限 100
  const minutes = Math.min(d.studyMinutes / 60, 4) * 8; // 0-32
  const materials = Math.min(d.materialsRead, 4) * 4; // 0-16
  const tasks = Math.min(d.assignmentsSubmitted + d.quizAttempts, 4) * 4; // 0-16
  const attend = Math.min(d.attendanceCheckins, 2) * 8; // 0-16
  const library = Math.min(d.libraryActions, 3) * 4; // 0-12
  const aiTutor = Math.min(d.aiTutorTurns, 5) * 0.8; // 0-4
  const printing = Math.min(d.printJobs, 2) * 2; // 0-4
  return clamp01(minutes + materials + tasks + attend + library + aiTutor + printing);
}

function moveScoreOf(d: DailyActivitySignal): number {
  const steps = Math.min(d.campusStepsEstimate / 3000, 1) * 40;
  const visits = Math.min(d.campusVisitsCount, 4) * 7;
  const bus = Math.min(d.busCheckins, 3) * 4; // 0-12
  const ar = Math.min(d.arNavigationCompleted, 2) * 5; // 0-10
  const health = Math.min(d.healthCenterVisits, 1) * 10; // 0-10
  return clamp01(steps + visits + bus + ar + health);
}

function nourishScoreOf(d: DailyActivitySignal): number {
  const ordered = Math.min(d.mealsOrdered, 3) * 14; // 0-42
  const variety = Math.min(d.distinctVendors, 3) * 14; // 0-42
  const interactions = Math.min(d.cafeteriaInteractions, 2) * 5; // 0-10
  const budget = Math.min(d.budgetChecks, 1) * 6; // 0-6
  return clamp01(ordered + variety + interactions + budget);
}

function socialScoreOf(d: DailyActivitySignal): number {
  const inter = Math.min(d.socialInteractions, 5) * 6; // 0-30
  const group = Math.min(d.groupOrderJoined, 2) * 12; // 0-24
  const peerG = Math.min(d.peerReviewsGiven, 2) * 6; // 0-12
  const peerR = Math.min(d.peerReviewsReceived, 2) * 4; // 0-8
  const discussion = Math.min(d.discussionPosts, 3) * 4; // 0-12
  const enc = Math.min(d.encouragementsSent + d.encouragementsReceived, 4) * 3.5; // 0-14
  return clamp01(inter + group + peerG + peerR + discussion + enc);
}

/**
 * 校園生活分數（life）：副指標，不直接進四象限，但影響星圖與成就。
 */
export function lifeScoreOf(d: DailyActivitySignal): number {
  const lost = Math.min(d.lostFoundActions, 1) * 20;
  const dorm = Math.min(d.dormRepairCreated, 1) * 20;
  const event = Math.min(d.eventAttendance, 2) * 15;
  const credit = Math.min(d.creditAuditChecks, 1) * 15;
  const inbox = Math.min(d.inboxActionsTaken, 4) * 7.5;
  return clamp01(lost + dorm + event + credit + inbox);
}

// ─────────────────────────────────────────────────────────
// 季節 / 氣象
// ─────────────────────────────────────────────────────────

function seasonOf(month: number): SpriteState['appearance']['season'] {
  if (month >= 3 && month <= 5) return 'spring';
  if (month >= 6 && month <= 8) return 'summer';
  if (month >= 9 && month <= 11) return 'autumn';
  return 'winter';
}

const SEASONAL_ACCESSORY: Record<SpriteState['appearance']['season'], string> = {
  spring: '櫻花花環',
  summer: '草帽',
  autumn: '楓葉披風',
  winter: '毛球圍巾',
};

// ─────────────────────────────────────────────────────────
// Burnout 偵測：連 5 天 study 高、move/social/nourish 低
// ─────────────────────────────────────────────────────────

export function detectBurnoutSignal(signals: DailyActivitySignal[]): boolean {
  const recent = signals.filter((s) => !s.hibernated).slice(-5);
  if (recent.length < 5) return false;
  return recent.every((d) => {
    const stu = studyScoreOf(d);
    const mov = moveScoreOf(d);
    const nou = nourishScoreOf(d);
    const soc = socialScoreOf(d);
    // 學習得分高（≥ 50，新引擎多維後門檻略降），其他至少一項極低 → burnout
    return stu >= 50 && (mov < 25 || nou < 25 || soc < 20);
  });
}

// ─────────────────────────────────────────────────────────
// 進化階段：累積活躍天數 + 學年
// ─────────────────────────────────────────────────────────

export function getEvolutionStage(daysActive: number, studyYear: number): EvolutionStage {
  // 大一前 14 天為 egg，避免新生壓力
  if (daysActive < 14) return 'egg';
  if (daysActive < 60) return 'sprout';
  if (daysActive < 180) return 'fledgling';
  if (daysActive < 540) return 'companion';
  return 'guardian'; // 大三大四以上
}

// ─────────────────────────────────────────────────────────
// 主函式：計算精靈狀態
// ─────────────────────────────────────────────────────────

export interface ComputeSpriteStateInput {
  signals: DailyActivitySignal[];
  profile: SpriteProfile;
  /** 校園氣象（系統層級） */
  campusWeather?: SpriteState['appearance']['weatherMood'];
  /** 上一輪 vitality（hibernate 時保持） */
  previousVitality?: number;
}

export function computeSpriteState(input: ComputeSpriteStateInput): SpriteState {
  const { signals, profile } = input;

  const activeDays = signals.filter((s) => !s.hibernated);
  const hibernated = signals.filter((s) => s.hibernated);

  // 平均最近 7 天的四象限
  const recent = activeDays.slice(-7);
  const avg = (fn: (s: DailyActivitySignal) => number) =>
    recent.length > 0
      ? Math.round((recent.reduce((acc, s) => acc + fn(s), 0) / recent.length) * 10) / 10
      : 0;

  const needs: NeedBalance = {
    study: avg(studyScoreOf),
    move: avg(moveScoreOf),
    nourish: avg(nourishScoreOf),
    social: avg(socialScoreOf),
  };

  // hibernate：保留原值（不衰減）
  if (recent.length === 0) {
    return makeHibernatedState(profile, input.previousVitality ?? 70, signals);
  }

  const balanceMean = (needs.study + needs.move + needs.nourish + needs.social) / 4;
  const balanceStdev = Math.sqrt(
    (Math.pow(needs.study - balanceMean, 2) +
      Math.pow(needs.move - balanceMean, 2) +
      Math.pow(needs.nourish - balanceMean, 2) +
      Math.pow(needs.social - balanceMean, 2)) /
      4,
  );
  // 平衡分：mean 高 + stdev 低 越好
  const vitality = clamp01(balanceMean - balanceStdev * 0.3);

  // mood
  const burnout = detectBurnoutSignal(signals);
  const mood: MoodTag = burnout
    ? 'tired'
    : balanceStdev < 15 && balanceMean > 50
    ? 'energetic'
    : needs.social < 15 && needs.study > 40
    ? 'lonely'
    : needs.study > Math.max(needs.move, needs.nourish, needs.social) + 25
    ? 'focused'
    : needs.move > Math.max(needs.study, needs.nourish, needs.social) + 25
    ? 'curious'
    : needs.social > Math.max(needs.study, needs.move, needs.nourish) + 25
    ? 'caring'
    : 'energetic';

  const season = seasonOf(profile.currentMonth);
  const weatherMood = input.campusWeather ?? defaultWeatherFromMood(mood);
  const evolutionStage = getEvolutionStage(activeDays.length, profile.studyYear);

  const careHint = generateCareHint({ needs, mood, burnout });
  const message = generateMessage({ mood, evolutionStage, balanceMean, profile });

  return {
    evolutionStage,
    vitality: Math.round(vitality * 10) / 10,
    mood,
    needs,
    appearance: {
      season,
      seasonalAccessory: SEASONAL_ACCESSORY[season],
      weatherMood,
    },
    message,
    careHint,
    daysActive: activeDays.length,
    daysHibernated: hibernated.length,
  };
}

function makeHibernatedState(
  profile: SpriteProfile,
  vitality: number,
  signals: DailyActivitySignal[],
): SpriteState {
  const season = seasonOf(profile.currentMonth);
  return {
    evolutionStage: getEvolutionStage(signals.filter((s) => !s.hibernated).length, profile.studyYear),
    vitality,
    mood: 'sleepy',
    needs: { study: 0, move: 0, nourish: 0, social: 0 },
    appearance: {
      season,
      seasonalAccessory: SEASONAL_ACCESSORY[season],
      weatherMood: 'cloudy',
    },
    message: '精靈在養精蓄銳，回來時牠還在這裡 🌙',
    careHint: { kind: 'rest', text: '考試週／請假休息一下也沒關係。' },
    daysActive: signals.filter((s) => !s.hibernated).length,
    daysHibernated: signals.filter((s) => s.hibernated).length,
  };
}

function defaultWeatherFromMood(mood: MoodTag): SpriteState['appearance']['weatherMood'] {
  switch (mood) {
    case 'energetic':
      return 'sunny';
    case 'focused':
      return 'starry';
    case 'curious':
      return 'sunny';
    case 'caring':
      return 'sunny';
    case 'tired':
      return 'rainy';
    case 'lonely':
      return 'cloudy';
    case 'sleepy':
      return 'cloudy';
  }
}

function generateCareHint(args: {
  needs: NeedBalance;
  mood: MoodTag;
  burnout: boolean;
}): SpriteState['careHint'] {
  if (args.burnout || args.mood === 'tired') {
    return {
      kind: 'rest',
      text: '你最近很拚，要不要先走出去散個步？',
      ctaTarget: 'map',
    };
  }
  if (args.needs.nourish < 20) {
    return {
      kind: 'meal',
      text: '今天還沒看到你的餐點紀錄，去看看餐廳？',
      ctaTarget: 'cafeteria',
    };
  }
  if (args.needs.social < 15) {
    return {
      kind: 'social',
      text: '揪同學一起吃飯或讀書吧，精靈會跟著開心。',
      ctaTarget: 'groups',
    };
  }
  if (
    args.needs.study > 70 &&
    args.needs.move > 50 &&
    args.needs.nourish > 50 &&
    args.needs.social > 50
  ) {
    return {
      kind: 'celebrate',
      text: '本週四項都很均衡，記得替自己慶祝一下。',
    };
  }
  return { kind: 'none', text: '' };
}

function generateMessage(args: {
  mood: MoodTag;
  evolutionStage: EvolutionStage;
  balanceMean: number;
  profile: SpriteProfile;
}): string | null {
  if (args.evolutionStage === 'egg') return '精靈剛來這個校園，跟著你慢慢長大 🥚';
  if (args.mood === 'tired') return '精靈說「想睡了，但牠會等你回來」';
  if (args.mood === 'lonely') return '精靈在窗邊等朋友 🪟';
  if (args.balanceMean > 70) return '精靈狀態超好，連同學都看得出來 ✨';
  return null;
}
