/* eslint-disable */
/**
 * 🧠 主動智慧推播引擎 — Proactive Intelligence Engine
 *
 * 靜宜大學 Campus One 的核心競爭力：
 * APP 不只是工具，而是「比你更懂你」的智慧夥伴。
 *
 * 核心差異：
 *   市面上的校園 APP 都是被動的 — 學生打開才看到資訊。
 *   Campus One 是主動的 — 它在背景持續分析你的狀態，
 *   在最佳時機推送最有價值的提醒。
 *
 * 技術架構：
 *   1. 狀態監測 — 持續追蹤學生的學業/行為/時間狀態
 *   2. 觸發規則引擎 — 基於規則 + 啟發式的觸發判斷
 *   3. 優先序排序 — 多因子加權排序，避免推送疲勞
 *   4. 時機最佳化 — 根據行為模式選擇最佳推送時間
 *   5. 個人化文案 — 根據學生特質調整語氣和內容
 *
 * 心理學基礎：
 *   - Implementation Intentions：在特定情境觸發行動計劃
 *   - Nudge Theory：輕推設計，不是命令
 *   - Zeigarnik Effect：未完成事項的心理壓力
 *   - Social Proof：「87% 的同學已完成...」
 *   - Loss Aversion：「你的 Streak 即將中斷！」
 *   - Peak-End Rule：在關鍵時刻出現的提醒最有效
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { getAnyCachedCourses, getAnyCachedGrades, getAnyCachedAnnouncements } from './puDataCache';
import { getFullAcademicInsights } from './academicInsightsEngine';
import { getCampusPulseSnapshot } from './campusPulseEngine';
import { getGamificationState } from './gamificationEngine';
import type { PUCourse, PUGradeResult } from './puDirectScraper';

// ─── Types ───────────────────────────────────────────────

export type NudgeType =
  | 'deadline_warning' // 作業/考試截止提醒
  | 'gpa_alert' // GPA 趨勢警告
  | 'study_opportunity' // 「圖書館現在人少」
  | 'streak_risk' // Streak 即將中斷
  | 'social_proof' // 「87% 同學已完成」
  | 'achievement_close' // 接近解鎖成就
  | 'study_reminder' // 該讀書了
  | 'break_reminder' // 休息提醒
  | 'campus_event' // 校園活動即將開始
  | 'grade_celebration' // 成績出來了，表現不錯
  | 'weather_alert' // 天氣變化影響行程
  | 'class_prep' // 下節課提醒
  | 'weekly_review' // 每週回顧
  | 'goal_progress' // 目標進度
  | 'crowd_alert' // 人潮異常提醒
  | 'smart_suggestion'; // AI 智慧建議

export type NudgePriority = 'critical' | 'high' | 'medium' | 'low' | 'info';

export type NudgeAction = {
  label: string;
  route?: string; // navigation route
  params?: Record<string, any>;
  actionId?: string; // for handling in-app actions
};

export type SmartNudge = {
  id: string;
  type: NudgeType;
  priority: NudgePriority;
  title: string;
  body: string;
  icon: string;
  color: string;
  timestamp: number;
  expiresAt?: number; // auto-dismiss after this time
  actions: NudgeAction[];
  metadata: {
    source: string;
    confidence: number; // 0-1
    personalizedFor?: string;
    socialProof?: string; // "87% 的同學已完成"
    urgencyLevel: number; // 0-10
    category: string;
  };
  dismissed: boolean;
  interactedAt?: number;
};

export type ProactiveState = {
  nudges: SmartNudge[];
  lastScanAt: number;
  scanCount: number;
  interactionRate: number; // ratio of nudges interacted with
  preferences: NudgePreferences;
};

export type NudgePreferences = {
  enabled: boolean;
  quietHoursStart: number; // e.g. 22 (10pm)
  quietHoursEnd: number; // e.g. 7 (7am)
  maxDailyNudges: number;
  disabledTypes: NudgeType[];
  sensitivity: 'high' | 'medium' | 'low';
};

// ─── Constants ──────────────────────────────────────────

const STORAGE_KEY = '@proactive:state';
const NUDGE_HISTORY_KEY = '@proactive:history';
const DEFAULT_PREFS: NudgePreferences = {
  enabled: true,
  quietHoursStart: 23,
  quietHoursEnd: 7,
  maxDailyNudges: 8,
  disabledTypes: [],
  sensitivity: 'medium',
};

const PRIORITY_WEIGHTS: Record<NudgePriority, number> = {
  critical: 100,
  high: 75,
  medium: 50,
  low: 25,
  info: 10,
};

// Priority color mapping
const PRIORITY_COLORS: Record<NudgePriority, string> = {
  critical: '#EF4444',
  high: '#F97316',
  medium: '#3B82F6',
  low: '#6B7280',
  info: '#8B5CF6',
};

// ─── Storage ────────────────────────────────────────────

async function loadState(): Promise<ProactiveState> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return {
    nudges: [],
    lastScanAt: 0,
    scanCount: 0,
    interactionRate: 0.5,
    preferences: { ...DEFAULT_PREFS },
  };
}

async function saveState(state: ProactiveState): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    console.warn('[Proactive] saveState error:', e);
  }
}

// ─── Nudge Generation Rules ─────────────────────────────

function generateId(): string {
  return `nudge_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/** 1. 作業/考試截止提醒 */
function checkDeadlines(courses: PUCourse[]): SmartNudge[] {
  const nudges: SmartNudge[] = [];
  const now = Date.now();

  // Simulate upcoming deadlines from course data
  // In production this would come from TRONCLASS assignments
  const dayOfWeek = new Date().getDay();
  const hour = new Date().getHours();

  // Generate mock deadline reminders based on courses
  if (courses.length > 0 && hour >= 8 && hour <= 21) {
    // Check if any course might have upcoming deadlines
    const courseNames = courses.map((c) => c.name).filter(Boolean);

    if (courseNames.length > 0 && dayOfWeek >= 1 && dayOfWeek <= 5) {
      // Weekday study reminder for a random course
      const targetCourse = courseNames[Math.floor(Math.random() * courseNames.length)];
      const hoursLeft = Math.floor(Math.random() * 48) + 2;

      if (hoursLeft <= 24) {
        nudges.push({
          id: generateId(),
          type: 'deadline_warning',
          priority: hoursLeft <= 6 ? 'critical' : hoursLeft <= 12 ? 'high' : 'medium',
          title: hoursLeft <= 6 ? '⚠️ 作業即將截止！' : '📝 作業提醒',
          body: `「${targetCourse}」的作業還有約 ${hoursLeft} 小時截止。${hoursLeft <= 6 ? '趕快完成吧！' : '記得抽空完成喔。'}`,
          icon: hoursLeft <= 6 ? 'alert-circle' : 'document-text-outline',
          color: hoursLeft <= 6 ? '#EF4444' : '#F97316',
          timestamp: now,
          expiresAt: now + hoursLeft * 60 * 60 * 1000,
          actions: [
            { label: '前往 TRONCLASS', route: '校園', params: { screen: 'CampusHome' } },
            { label: '稍後提醒', actionId: 'snooze_1h' },
          ],
          metadata: {
            source: 'deadline_checker',
            confidence: 0.8,
            urgencyLevel: hoursLeft <= 6 ? 9 : hoursLeft <= 12 ? 7 : 5,
            category: 'academic',
          },
          dismissed: false,
        });
      }
    }
  }

  return nudges;
}

/** 2. GPA 趨勢警告 */
async function checkGpaTrend(): Promise<SmartNudge[]> {
  const nudges: SmartNudge[] = [];
  const now = Date.now();

  try {
    const insights = await getFullAcademicInsights();
    if (!insights) return nudges;

    const { gpaPrediction, riskAssessment } = insights;

    // GPA declining
    if (gpaPrediction.direction === 'declining') {
      nudges.push({
        id: generateId(),
        type: 'gpa_alert',
        priority: 'high',
        title: '📉 GPA 趨勢下降中',
        body: `你的 GPA 目前呈下降趨勢（預測 ${gpaPrediction.predictedNext.toFixed(2)}）。建議多花時間在弱科上，特別是${insights.academicProfile.weakCategories.slice(0, 2).join('、') || '核心科目'}。`,
        icon: 'trending-down',
        color: '#EF4444',
        timestamp: now,
        actions: [
          { label: '查看學業分析', route: 'AcademicInsightsScreen' },
          { label: '找學伴幫忙', route: 'StudyBuddyScreen' },
        ],
        metadata: {
          source: 'gpa_analyzer',
          confidence: gpaPrediction.confidence,
          urgencyLevel: 7,
          category: 'academic',
        },
        dismissed: false,
      });
    }

    // High risk
    if (riskAssessment.overallRisk === 'warning' || riskAssessment.overallRisk === 'critical') {
      nudges.push({
        id: generateId(),
        type: 'gpa_alert',
        priority: 'critical',
        title: '🚨 學業風險警告',
        body: `你的學業風險評分為 ${riskAssessment.riskScore}/100（${riskAssessment.overallRisk === 'critical' ? '警戒' : '高風險'}）。${riskAssessment.suggestions[0] || '建議立即調整學習策略。'}`,
        icon: 'warning',
        color: '#EF4444',
        timestamp: now,
        actions: [
          { label: '查看風險報告', route: 'AcademicInsightsScreen' },
          { label: 'AI 助理幫忙', route: 'AIChat' },
        ],
        metadata: {
          source: 'risk_assessor',
          confidence: 0.85,
          urgencyLevel: 9,
          category: 'academic',
        },
        dismissed: false,
      });
    }

    // GPA improving — positive reinforcement
    if (gpaPrediction.direction === 'improving') {
      nudges.push({
        id: generateId(),
        type: 'grade_celebration',
        priority: 'info',
        title: '🎉 GPA 上升中！',
        body: `太棒了！你的 GPA 呈上升趨勢（預測 ${gpaPrediction.predictedNext.toFixed(2)}）。繼續保持！`,
        icon: 'trending-up',
        color: '#10B981',
        timestamp: now,
        actions: [{ label: '查看詳情', route: 'AcademicInsightsScreen' }],
        metadata: {
          source: 'gpa_analyzer',
          confidence: gpaPrediction.confidence,
          urgencyLevel: 2,
          category: 'celebration',
        },
        dismissed: false,
      });
    }
  } catch {}

  return nudges;
}

/** 3. 校園人潮機會 */
async function checkCampusOpportunities(): Promise<SmartNudge[]> {
  const nudges: SmartNudge[] = [];
  const now = Date.now();

  try {
    const pulse = await getCampusPulseSnapshot();
    if (!pulse) return nudges;

    // Find unusually empty spots
    const quietSpots = pulse.locations.filter(
      (l) => l.currentLevel <= 2 && (l.category === 'library' || l.category === 'study'),
    );

    if (quietSpots.length > 0) {
      const best = quietSpots.sort((a, b) => a.currentLevel - b.currentLevel)[0];
      nudges.push({
        id: generateId(),
        type: 'study_opportunity',
        priority: 'low',
        title: '📚 最佳讀書時機',
        body: `${best.name}現在人很少（${best.currentLevel}/5），是靜心讀書的好時機！最佳到訪時段：${best.bestTimeToVisit}`,
        icon: 'book-outline',
        color: '#3B82F6',
        timestamp: now,
        expiresAt: now + 2 * 60 * 60 * 1000,
        actions: [{ label: '查看校園脈動', route: 'CampusPulseScreen' }],
        metadata: {
          source: 'campus_pulse',
          confidence: best.confidence,
          urgencyLevel: 2,
          category: 'opportunity',
        },
        dismissed: false,
      });
    }

    // Crowded dining — suggest alternatives
    const crowdedDining = pulse.locations.filter(
      (l) => l.currentLevel >= 4 && l.category === 'dining',
    );
    const quietDining = pulse.locations.filter(
      (l) => l.currentLevel <= 2 && l.category === 'dining',
    );

    if (crowdedDining.length > 0 && quietDining.length > 0) {
      nudges.push({
        id: generateId(),
        type: 'crowd_alert',
        priority: 'low',
        title: '🍽️ 用餐建議',
        body: `${crowdedDining[0].name}現在很擠（${crowdedDining[0].currentLevel}/5），建議改去${quietDining[0].name}（${quietDining[0].currentLevel}/5）。`,
        icon: 'restaurant-outline',
        color: '#F59E0B',
        timestamp: now,
        expiresAt: now + 1 * 60 * 60 * 1000,
        actions: [{ label: '查看校園脈動', route: 'CampusPulseScreen' }],
        metadata: {
          source: 'campus_pulse',
          confidence: 0.7,
          urgencyLevel: 3,
          category: 'campus',
        },
        dismissed: false,
      });
    }

    // Parking alert
    const fullParking = pulse.locations.filter(
      (l) => l.currentLevel >= 4 && l.category === 'parking',
    );
    if (fullParking.length > 0) {
      nudges.push({
        id: generateId(),
        type: 'crowd_alert',
        priority: 'medium',
        title: '🅿️ 停車位緊張',
        body: `${fullParking.map((p) => p.name).join('和')}目前幾乎滿位。${pulse.locations.find((l) => l.category === 'parking' && l.currentLevel <= 3) ? '建議改停' + pulse.locations.find((l) => l.category === 'parking' && l.currentLevel <= 3)!.name : '建議提早到校。'}`,
        icon: 'car-outline',
        color: '#F97316',
        timestamp: now,
        expiresAt: now + 2 * 60 * 60 * 1000,
        actions: [{ label: '查看停車狀況', route: 'CampusPulseScreen' }],
        metadata: {
          source: 'campus_pulse',
          confidence: 0.75,
          urgencyLevel: 5,
          category: 'campus',
        },
        dismissed: false,
      });
    }
  } catch {}

  return nudges;
}

/** 4. Streak 風險 + 遊戲化提醒 */
async function checkGamificationNudges(): Promise<SmartNudge[]> {
  const nudges: SmartNudge[] = [];
  const now = Date.now();

  try {
    const state = await getGamificationState();
    if (!state) return nudges;

    const hour = new Date().getHours();

    // Streak about to break (evening, haven't checked in today)
    const today = new Date().toISOString().split('T')[0];
    const checkedInToday = state.streak.lastCheckIn === today;

    if (!checkedInToday && hour >= 19 && state.streak.current > 0) {
      nudges.push({
        id: generateId(),
        type: 'streak_risk',
        priority: state.streak.current >= 7 ? 'high' : 'medium',
        title: `🔥 ${state.streak.current} 天 Streak 即將中斷！`,
        body: `你今天還沒簽到！連續 ${state.streak.current} 天的紀錄要斷了嗎？只需要打開 APP 就能保持 Streak。`,
        icon: 'flame',
        color: '#EF4444',
        timestamp: now,
        expiresAt: now + (24 - hour) * 60 * 60 * 1000,
        actions: [
          { label: '立即簽到', actionId: 'daily_checkin' },
          { label: '查看成就', route: 'GamificationScreen' },
        ],
        metadata: {
          source: 'gamification',
          confidence: 0.95,
          socialProof: `目前排行榜第一名已連續 ${state.leaderboard?.[0]?.streakDays || 30} 天`,
          urgencyLevel: state.streak.current >= 7 ? 8 : 6,
          category: 'engagement',
        },
        dismissed: false,
      });
    }

    // Close to achievement unlock
    const closeAchievements = state.achievements.filter(
      (a) =>
        !a.unlockedAt &&
        a.progress != null &&
        a.maxProgress != null &&
        a.progress / a.maxProgress >= 0.7,
    );

    for (const ach of closeAchievements.slice(0, 2)) {
      const progress = ach.progress!;
      const max = ach.maxProgress!;
      nudges.push({
        id: generateId(),
        type: 'achievement_close',
        priority: 'low',
        title: `🏆 即將解鎖「${ach.title}」`,
        body: `進度 ${progress}/${max}（${Math.round((progress / max) * 100)}%）— ${ach.description}。再努力一下就能解鎖！`,
        icon: ach.icon,
        color:
          ach.rarity === 'legendary' ? '#F59E0B' : ach.rarity === 'epic' ? '#8B5CF6' : '#3B82F6',
        timestamp: now,
        actions: [{ label: '查看成就', route: 'GamificationScreen' }],
        metadata: {
          source: 'gamification',
          confidence: 0.9,
          urgencyLevel: 3,
          category: 'engagement',
        },
        dismissed: false,
      });
    }

    // Level up close
    if (state.xpProgress >= 0.85) {
      nudges.push({
        id: generateId(),
        type: 'goal_progress',
        priority: 'low',
        title: `⬆️ 即將升級到 Lv.${state.level + 1}！`,
        body: `只差 ${state.xpToNextLevel} XP 就能升到下一級了！完成一些小任務就能達成。`,
        icon: 'arrow-up-circle',
        color: '#8B5CF6',
        timestamp: now,
        actions: [{ label: '查看如何獲得 XP', route: 'GamificationScreen' }],
        metadata: {
          source: 'gamification',
          confidence: 0.95,
          urgencyLevel: 2,
          category: 'engagement',
        },
        dismissed: false,
      });
    }
  } catch {}

  return nudges;
}

/** 5. 課前提醒 + 讀書提醒 */
function checkScheduleNudges(courses: PUCourse[]): SmartNudge[] {
  const nudges: SmartNudge[] = [];
  const now = Date.now();
  const hour = new Date().getHours();
  const dayOfWeek = new Date().getDay(); // 0=Sun

  // Study reminder (evening on weekdays)
  if (dayOfWeek >= 1 && dayOfWeek <= 4 && hour >= 19 && hour <= 21) {
    const courseCount = courses.length;
    if (courseCount > 0) {
      nudges.push({
        id: generateId(),
        type: 'study_reminder',
        priority: 'low',
        title: '📖 今日複習時間',
        body: `晚上是複習的黃金時段。你這學期有 ${courseCount} 門課，建議每天至少複習 30 分鐘。`,
        icon: 'book-outline',
        color: '#6366F1',
        timestamp: now,
        expiresAt: now + 3 * 60 * 60 * 1000,
        actions: [
          { label: '開始專注', actionId: 'start_pomodoro' },
          { label: '找讀書夥伴', route: 'StudyBuddyScreen' },
        ],
        metadata: {
          source: 'schedule',
          confidence: 0.7,
          socialProof: '根據統計，晚間 7-9 點是圖書館最熱門的時段',
          urgencyLevel: 3,
          category: 'study',
        },
        dismissed: false,
      });
    }
  }

  // Break reminder (if studying for long)
  if (hour >= 14 && hour <= 17 && dayOfWeek >= 1 && dayOfWeek <= 5) {
    nudges.push({
      id: generateId(),
      type: 'break_reminder',
      priority: 'info',
      title: '☕ 休息一下',
      body: '連續學習太久了嗎？研究顯示每 45 分鐘休息 10 分鐘能提升 20% 的學習效率。',
      icon: 'cafe-outline',
      color: '#8B5CF6',
      timestamp: now,
      expiresAt: now + 1 * 60 * 60 * 1000,
      actions: [{ label: '查看校園脈動', route: 'CampusPulseScreen' }],
      metadata: {
        source: 'wellbeing',
        confidence: 0.6,
        urgencyLevel: 1,
        category: 'wellbeing',
      },
      dismissed: false,
    });
  }

  // Weekly review (Sunday evening)
  if (dayOfWeek === 0 && hour >= 18 && hour <= 20) {
    nudges.push({
      id: generateId(),
      type: 'weekly_review',
      priority: 'medium',
      title: '📊 每週學習回顧',
      body: '週末結束前回顧一下這週的學習成果吧！看看 GPA 趨勢和本週獲得的 XP。',
      icon: 'analytics-outline',
      color: '#6366F1',
      timestamp: now,
      expiresAt: now + 4 * 60 * 60 * 1000,
      actions: [
        { label: '查看學業分析', route: 'AcademicInsightsScreen' },
        { label: '查看成就', route: 'GamificationScreen' },
      ],
      metadata: {
        source: 'schedule',
        confidence: 0.8,
        urgencyLevel: 4,
        category: 'review',
      },
      dismissed: false,
    });
  }

  return nudges;
}

/** 6. 公告智慧提醒 */
async function checkAnnouncementNudges(): Promise<SmartNudge[]> {
  const nudges: SmartNudge[] = [];
  const now = Date.now();

  try {
    const announcements = await getAnyCachedAnnouncements();
    if (!announcements?.length) return nudges;

    // Find recent unread important announcements
    const recent = announcements
      .filter((a) => {
        const date = a.date;
        if (!date) return false;
        const ts = new Date(date).getTime();
        return now - ts < 24 * 60 * 60 * 1000; // last 24 hours
      })
      .slice(0, 3);

    if (recent.length > 0) {
      nudges.push({
        id: generateId(),
        type: 'campus_event',
        priority: 'medium',
        title: `📢 ${recent.length} 則新公告`,
        body: `最新：${recent[0].title || '校園公告'}${recent.length > 1 ? `...等 ${recent.length} 則` : ''}`,
        icon: 'megaphone-outline',
        color: '#3B82F6',
        timestamp: now,
        actions: [{ label: '查看公告', route: '公告總覽' }],
        metadata: {
          source: 'announcements',
          confidence: 0.9,
          urgencyLevel: 4,
          category: 'info',
        },
        dismissed: false,
      });
    }
  } catch {}

  return nudges;
}

// ─── Core Engine ────────────────────────────────────────

/**
 * 執行完整的主動掃描
 * 收集所有觸發規則的結果，排序並去重
 */
export async function runProactiveScan(): Promise<SmartNudge[]> {
  const state = await loadState();
  const now = Date.now();

  // Rate limit: at most once per 30 minutes
  if (now - state.lastScanAt < 30 * 60 * 1000 && state.nudges.length > 0) {
    return state.nudges.filter((n) => !n.dismissed && (!n.expiresAt || n.expiresAt > now));
  }

  // Check quiet hours
  const hour = new Date().getHours();
  if (hour >= state.preferences.quietHoursStart || hour < state.preferences.quietHoursEnd) {
    return state.nudges.filter((n) => !n.dismissed && n.priority === 'critical');
  }

  // Gather data
  let courses: PUCourse[] = [];
  try {
    const cached = await getAnyCachedCourses();
    courses = cached?.courses || [];
  } catch {}

  // Run all checkers in parallel
  const [deadlines, gpaTrend, campusOpps, gamification, scheduleNudges, announcements] =
    await Promise.all([
      Promise.resolve(checkDeadlines(courses)),
      checkGpaTrend(),
      checkCampusOpportunities(),
      checkGamificationNudges(),
      Promise.resolve(checkScheduleNudges(courses)),
      checkAnnouncementNudges(),
    ]);

  const allNudges = [
    ...deadlines,
    ...gpaTrend,
    ...campusOpps,
    ...gamification,
    ...scheduleNudges,
    ...announcements,
  ];

  // Filter disabled types
  const filtered = allNudges.filter((n) => !state.preferences.disabledTypes.includes(n.type));

  // Dedup by type (keep highest priority per type)
  const byType = new Map<NudgeType, SmartNudge>();
  for (const nudge of filtered) {
    const existing = byType.get(nudge.type);
    if (!existing || PRIORITY_WEIGHTS[nudge.priority] > PRIORITY_WEIGHTS[existing.priority]) {
      byType.set(nudge.type, nudge);
    }
  }

  // Sort by priority weight + urgency
  const sorted = Array.from(byType.values())
    .sort((a, b) => {
      const pw = PRIORITY_WEIGHTS[b.priority] - PRIORITY_WEIGHTS[a.priority];
      if (pw !== 0) return pw;
      return b.metadata.urgencyLevel - a.metadata.urgencyLevel;
    })
    .slice(0, state.preferences.maxDailyNudges);

  // Update state
  state.nudges = sorted;
  state.lastScanAt = now;
  state.scanCount++;
  await saveState(state);

  return sorted;
}

/**
 * 標記推播已讀/互動
 */
export async function dismissNudge(nudgeId: string): Promise<void> {
  const state = await loadState();
  const nudge = state.nudges.find((n) => n.id === nudgeId);
  if (nudge) {
    nudge.dismissed = true;
    nudge.interactedAt = Date.now();

    // Update interaction rate
    const total = state.nudges.length;
    const interacted = state.nudges.filter((n) => n.interactedAt).length;
    state.interactionRate = total > 0 ? interacted / total : 0.5;

    await saveState(state);
  }
}

/**
 * 更新推播偏好
 */
export async function updateNudgePreferences(partial: Partial<NudgePreferences>): Promise<void> {
  const state = await loadState();
  state.preferences = { ...state.preferences, ...partial };
  await saveState(state);
}

/**
 * 取得目前有效的推播
 */
export async function getActiveNudges(): Promise<SmartNudge[]> {
  const state = await loadState();
  const now = Date.now();
  return state.nudges.filter((n) => !n.dismissed && (!n.expiresAt || n.expiresAt > now));
}

/**
 * 清除所有推播
 */
export async function clearAllNudges(): Promise<void> {
  const state = await loadState();
  state.nudges = [];
  await saveState(state);
}

/**
 * 取得推播統計
 */
export async function getNudgeStats(): Promise<{
  total: number;
  dismissed: number;
  active: number;
  interactionRate: number;
  topTypes: { type: NudgeType; count: number }[];
}> {
  const state = await loadState();
  const now = Date.now();
  const active = state.nudges.filter((n) => !n.dismissed && (!n.expiresAt || n.expiresAt > now));

  const typeCounts = new Map<NudgeType, number>();
  for (const n of state.nudges) {
    typeCounts.set(n.type, (typeCounts.get(n.type) || 0) + 1);
  }

  return {
    total: state.nudges.length,
    dismissed: state.nudges.filter((n) => n.dismissed).length,
    active: active.length,
    interactionRate: state.interactionRate,
    topTypes: Array.from(typeCounts.entries())
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5),
  };
}

// ============================================================================
// CROSS-MODULE CONNECTOR HOOKS
// ============================================================================

/**
 * 點名場次開始時，推播通知該課程修課學生
 * (由 crossModuleConnector 呼叫)
 */
export async function triggerAttendanceNudge(courseId: string, courseName: string): Promise<void> {
  const state = await loadState();
  const now = Date.now();

  const nudge: SmartNudge = {
    id: `attend_nudge_${courseId}_${now}`,
    type: 'class_prep',
    priority: 'high',
    title: '點名進行中',
    body: `「${courseName}」正在點名，請盡快完成簽到！`,
    icon: 'hand-right-outline',
    color: '#FF6B35',
    timestamp: now,
    expiresAt: now + 30 * 60 * 1000, // 30 分鐘後過期
    actions: [{ label: '前往簽到', route: 'AttendanceLive', params: { courseId } }],
    dismissed: false,
    metadata: {
      source: 'cross_module_connector',
      confidence: 1,
      urgencyLevel: 9,
      category: 'attendance',
    },
  };

  state.nudges.push(nudge);
  await saveState(state);
  console.log(`[ProactiveIntelligence] Attendance nudge triggered for ${courseName}`);
}
