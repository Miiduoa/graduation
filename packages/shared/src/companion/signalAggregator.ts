/**
 * Campus Companion — Signal Aggregator
 *
 * 把 APP 各畫面 / 服務發出的原始 events，按日期聚合成 DailyActivitySignal
 * 同時計算「累積值（lifetime / weekly）」供 achievements 引擎判斷解鎖。
 *
 * 純函式，方便 Cloud Function cron 與 mobile 端通用。
 */

import type { DailyActivitySignal } from './spriteEngine';

// ─────────────────────────────────────────────────────────
// 事件型別（從 APP 各畫面送進來的原始事件）
// ─────────────────────────────────────────────────────────

export type CompanionEventKind =
  // LMS
  | 'assignment_submitted'
  | 'material_read'
  | 'quiz_attempt_submitted'
  | 'quiz_perfect_score'
  | 'attendance_checkin'
  | 'study_session_logged' // {minutes}
  | 'ai_tutor_turn'
  // Library
  | 'library_borrow'
  | 'library_renew'
  | 'library_seat_reserved'
  // Cafeteria
  | 'meal_ordered' // {vendorId, balanced?}
  | 'cafeteria_viewed'
  | 'budget_checked'
  // Campus / Map
  | 'poi_visited' // {poiId}
  | 'ar_navigation_completed'
  | 'steps_logged' // {steps}
  // Transport
  | 'bus_checkin'
  // Print
  | 'print_job_created'
  // Health
  | 'health_appointment_created'
  // Dorm
  | 'dorm_repair_created'
  // Lost & Found
  | 'lost_found_posted'
  | 'lost_found_claimed'
  // Social
  | 'group_post_created'
  | 'group_comment_created'
  | 'group_order_joined'
  | 'peer_review_given'
  | 'peer_review_received'
  | 'discussion_post_created'
  | 'discussion_marked_useful'
  | 'encouragement_sent'
  | 'encouragement_received'
  // Event
  | 'event_signup'
  | 'event_checkin'
  // System
  | 'inbox_action_taken'
  | 'credit_audit_viewed'
  | 'plant_harvested'
  | 'legacy_tree_planted'
  | 'study_year_advanced' // {newYear}
  // 控制
  | 'mark_hibernate';

export interface CompanionEvent {
  kind: CompanionEventKind;
  /** ISO datetime */
  at: string;
  /** 事件唯一識別，用於去重 */
  eventId: string;
  /** 額外 payload */
  payload?: Record<string, unknown>;
}

// ─────────────────────────────────────────────────────────
// 內部 helpers
// ─────────────────────────────────────────────────────────

function dateOf(iso: string): string {
  return iso.slice(0, 10);
}

function emptyDay(date: string): DailyActivitySignal {
  return {
    date,
    studyMinutes: 0,
    assignmentsSubmitted: 0,
    materialsRead: 0,
    quizAttempts: 0,
    attendanceCheckins: 0,
    libraryActions: 0,
    aiTutorTurns: 0,
    printJobs: 0,
    campusStepsEstimate: 0,
    campusVisitsCount: 0,
    busCheckins: 0,
    arNavigationCompleted: 0,
    healthCenterVisits: 0,
    mealsOrdered: 0,
    distinctVendors: 0,
    cafeteriaInteractions: 0,
    budgetChecks: 0,
    socialInteractions: 0,
    groupOrderJoined: 0,
    peerReviewsGiven: 0,
    peerReviewsReceived: 0,
    discussionPosts: 0,
    encouragementsSent: 0,
    encouragementsReceived: 0,
    lostFoundActions: 0,
    dormRepairCreated: 0,
    eventAttendance: 0,
    creditAuditChecks: 0,
    inboxActionsTaken: 0,
  };
}

// ─────────────────────────────────────────────────────────
// Aggregator
// ─────────────────────────────────────────────────────────

export interface AggregateResult {
  /** 依日期排序的 DailyActivitySignal 陣列 */
  days: DailyActivitySignal[];
  /** 達成 achievement 用的累積信號（lifetime） */
  lifetimeCounters: Record<string, number>;
  /** 本批內每個 POI 是否首訪 */
  distinctPoisVisited: Set<string>;
  /** 本批內每家店是否首訪 */
  distinctVendorsVisited: Set<string>;
}

export function aggregateCompanionEvents(events: CompanionEvent[]): AggregateResult {
  const byDate = new Map<string, DailyActivitySignal>();
  const seen = new Set<string>();
  const counters: Record<string, number> = {};
  const distinctPois = new Set<string>();
  const distinctVendors = new Set<string>();
  const dailyVendorsByDate = new Map<string, Set<string>>();

  function inc(key: string, n = 1) {
    counters[key] = (counters[key] ?? 0) + n;
  }

  function getDay(date: string): DailyActivitySignal {
    let d = byDate.get(date);
    if (!d) {
      d = emptyDay(date);
      byDate.set(date, d);
    }
    return d;
  }

  for (const e of events) {
    if (seen.has(e.eventId)) continue; // 去重
    seen.add(e.eventId);
    const date = dateOf(e.at);
    const d = getDay(date);
    const p = e.payload ?? {};

    switch (e.kind) {
      case 'mark_hibernate':
        d.hibernated = true;
        break;
      case 'assignment_submitted':
        d.assignmentsSubmitted += 1;
        inc('assignmentsSubmitted');
        break;
      case 'material_read':
        d.materialsRead += 1;
        inc('materialsRead');
        break;
      case 'quiz_attempt_submitted':
        d.quizAttempts += 1;
        inc('quizAttempts');
        break;
      case 'quiz_perfect_score':
        inc('quizPerfectScores');
        break;
      case 'attendance_checkin':
        d.attendanceCheckins += 1;
        inc('attendanceCheckins');
        break;
      case 'study_session_logged': {
        const minutes = Number(p.minutes ?? 30);
        d.studyMinutes += minutes;
        inc('studyMinutes', minutes);
        break;
      }
      case 'ai_tutor_turn':
        d.aiTutorTurns += 1;
        inc('aiTutorTurns');
        break;
      case 'library_borrow':
        d.libraryActions += 1;
        inc('libraryBorrowCount');
        break;
      case 'library_renew':
        d.libraryActions += 1;
        inc('libraryRenewCount');
        break;
      case 'library_seat_reserved':
        d.libraryActions += 1;
        inc('librarySeatReservations');
        break;
      case 'meal_ordered': {
        d.mealsOrdered += 1;
        inc('mealsOrderedLifetime');
        const vid = String(p.vendorId ?? '');
        if (vid) {
          const set = dailyVendorsByDate.get(date) ?? new Set<string>();
          if (!set.has(vid)) {
            set.add(vid);
            d.distinctVendors += 1;
          }
          dailyVendorsByDate.set(date, set);
          if (!distinctVendors.has(vid)) {
            distinctVendors.add(vid);
            inc('distinctVendorsLifetime');
          }
        }
        if (p.balanced === true) inc('balancedMealDays');
        break;
      }
      case 'cafeteria_viewed':
        d.cafeteriaInteractions += 1;
        break;
      case 'budget_checked':
        d.budgetChecks += 1;
        break;
      case 'poi_visited': {
        d.campusVisitsCount += 1;
        const pid = String(p.poiId ?? '');
        if (pid && !distinctPois.has(pid)) {
          distinctPois.add(pid);
          inc('distinctPoiVisited');
        }
        break;
      }
      case 'ar_navigation_completed':
        d.arNavigationCompleted += 1;
        inc('arNavigationCompletedLifetime');
        break;
      case 'steps_logged': {
        const steps = Number(p.steps ?? 0);
        d.campusStepsEstimate += steps;
        inc('stepsLifetime', steps);
        break;
      }
      case 'bus_checkin':
        d.busCheckins += 1;
        inc('busCheckinsLifetime');
        break;
      case 'print_job_created':
        d.printJobs += 1;
        inc('printJobsLifetime');
        break;
      case 'health_appointment_created':
        d.healthCenterVisits += 1;
        inc('healthCenterVisitsLifetime');
        break;
      case 'dorm_repair_created':
        d.dormRepairCreated += 1;
        inc('dormRepairCreatedLifetime');
        break;
      case 'lost_found_posted':
      case 'lost_found_claimed':
        d.lostFoundActions += 1;
        inc('lostFoundLifetime');
        break;
      case 'group_post_created':
      case 'group_comment_created':
        d.socialInteractions += 1;
        inc('socialInteractionsLifetime');
        break;
      case 'group_order_joined':
        d.groupOrderJoined += 1;
        inc('groupOrderJoinedLifetime');
        break;
      case 'peer_review_given':
        d.peerReviewsGiven += 1;
        inc('peerReviewsGivenLifetime');
        break;
      case 'peer_review_received':
        d.peerReviewsReceived += 1;
        inc('peerReviewsReceivedLifetime');
        break;
      case 'discussion_post_created':
        d.discussionPosts += 1;
        inc('discussionPostsLifetime');
        break;
      case 'discussion_marked_useful':
        inc('discussionUsefulMarks');
        break;
      case 'encouragement_sent':
        d.encouragementsSent += 1;
        inc('encouragementsSentLifetime');
        break;
      case 'encouragement_received':
        d.encouragementsReceived += 1;
        inc('encouragementsReceivedLifetime');
        break;
      case 'event_signup':
        inc('eventSignupsLifetime');
        break;
      case 'event_checkin':
        d.eventAttendance += 1;
        inc('eventAttendanceLifetime');
        break;
      case 'inbox_action_taken':
        d.inboxActionsTaken += 1;
        inc('inboxActionsLifetime');
        break;
      case 'credit_audit_viewed':
        d.creditAuditChecks += 1;
        break;
      case 'plant_harvested':
        inc('plantsHarvested');
        break;
      case 'legacy_tree_planted':
        inc('legacyTreesPlanted');
        break;
      case 'study_year_advanced':
        inc('studyYearReached', Number(p.newYear ?? 1));
        break;
    }
  }

  // 整週步數 ≥ 35000 → 加 highStepWeeks 計數
  const weeklySteps = new Map<string, number>();
  for (const d of byDate.values()) {
    const week = isoWeekOf(d.date);
    weeklySteps.set(week, (weeklySteps.get(week) ?? 0) + d.campusStepsEstimate);
  }
  for (const total of weeklySteps.values()) {
    if (total >= 35000) counters['highStepWeeks'] = (counters['highStepWeeks'] ?? 0) + 1;
  }

  // 全勤週：該週 attendanceCheckins ≥ 連 5 個工作日
  const weeklyAttendance = new Map<string, number>();
  for (const d of byDate.values()) {
    if (d.attendanceCheckins > 0) {
      const week = isoWeekOf(d.date);
      weeklyAttendance.set(week, (weeklyAttendance.get(week) ?? 0) + 1);
    }
  }
  for (const days of weeklyAttendance.values()) {
    if (days >= 5) counters['attendancePerfectWeeks'] = (counters['attendancePerfectWeeks'] ?? 0) + 1;
  }

  return {
    days: Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date)),
    lifetimeCounters: counters,
    distinctPoisVisited: distinctPois,
    distinctVendorsVisited: distinctVendors,
  };
}

function isoWeekOf(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  const dayNum = d.getUTCDay() === 0 ? 7 : d.getUTCDay();
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}
