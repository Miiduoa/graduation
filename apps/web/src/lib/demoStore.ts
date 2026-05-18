'use client';

/**
 * demoStore.ts — 跨角色動作關聯的核心狀態管理
 *
 * 使用 localStorage 實現跨頁 / 跨角色的資料同步。
 * 任何角色的動作（新增作業、點名、發布成績…）都會寫入此 store，
 * 其他角色頁面從這裡讀到更新後的狀態，呈現真實因果關係。
 *
 * KEY:   'demoStore_v1'
 * 事件:  'demoStoreChange' (CustomEvent)，同頁跨元件同步
 * 跨頁:  window storage event
 *
 * 2026-05-17 擴充：新增 9 條動作鏈（求助/評語/討論/訂餐/請假/報修/同儕互評/批量提醒/系所廣播）
 * 並修正既有 publishGrades / approveClubMember / endAttendanceSession 寫死 stu-001 的問題。
 */

import { useEffect, useState } from 'react';
import {
  DEMO_MESSAGES,
  DEMO_STUDENTS,
  DEMO_CLUBS,
  type DemoMessage,
  type DemoUserRole,
} from './demoData';

// ─────────────────────────────────────────────────────────────
// 常數
// ─────────────────────────────────────────────────────────────

export const STORE_KEY = 'demoStore_v1';
export const STORE_EVENT = 'demoStoreChange';

// ─────────────────────────────────────────────────────────────
// 型別
// ─────────────────────────────────────────────────────────────

/** 動態訊息（角色動作觸發，與靜態 DEMO_MESSAGES 合併顯示） */
export interface StoreDynamicMessage {
  id: string;
  fromName: string;
  fromAvatar: string;
  subject: string;
  body: string;
  sentAt: string;
  isRead: boolean;
  type: 'info' | 'warning' | 'action' | 'success';
  relatedCourseId?: string;
  relatedClubId?: string;
  relatedAnnouncementId?: string;
  recipientRoles: DemoUserRole[];
}

/** 教師新增的作業（補充靜態 STUDENT_ASSIGNMENTS） */
export interface StoreDynamicAssignment {
  id: string;
  courseId: string;
  courseName: string;
  title: string;
  due: string;     // YYYY-MM-DD
  points: number;
  createdAt: string; // ISO
}

/** 學生作業繳交紀錄 */
export interface StoreSubmission {
  id: string;
  assignmentId: string;
  courseId: string;
  studentId: string;
  studentName: string;
  submittedAt: string; // ISO
  score?: number;
  graded: boolean;
}

/** 社團入社申請 */
export interface StoreClubMembership {
  id: string;
  clubId: string;
  clubName: string;
  studentId: string;
  studentName: string;
  status: 'pending' | 'approved' | 'rejected';
  appliedAt: string; // ISO
}

/** 點名 session 狀態 */
export interface StoreAttendanceSession {
  courseId: string;
  active: boolean;
  startedAt: string; // ISO
}

/** 已發布成績（讓學生看到） */
export interface StorePublishedGrade {
  courseId: string;
  courseName: string;
  studentId: string;
  score: number;
  grade: string;
  publishedAt: string; // ISO
}

/** 圖書館借閱覆寫（續借後更新到期日） */
export interface StoreBorrowingOverride {
  dueDate: string;    // YYYY-MM-DD
  renewCount: number;
}

/** 公告編輯草稿 / 下架紀錄 */
export interface StoreAnnouncementEdit {
  id: string;          // 對應 DEMO_ANNOUNCEMENTS.id
  title?: string;
  body?: string;
  editedAt: string;    // ISO
  editedBy: string;    // demoRole label
}

/** 校友回娘家 / 校友活動報名 */
export interface StoreAlumniEventRsvp {
  eventId: string;
  eventName: string;
  rsvpAt: string;     // ISO
  by: string;         // 報名人姓名 / 學號
}

/** 整個 demo 共享狀態
 *
 *  新增欄位（2026-05-17 擴充）：feedbackDrafts / discussionPosts / helpRequests /
 *  orders / leaveRequests / dormRepairs / peerReviews / disabledUsers / libraryReservations
 *  這些都標為 optional 以保留 backwards-compat（已存的 localStorage 不會壞）。
 */
export interface DemoStore {
  dynamicMessages: StoreDynamicMessage[];
  dynamicAssignments: StoreDynamicAssignment[];
  submissions: StoreSubmission[];
  clubMemberships: StoreClubMembership[];
  attendanceSessions: StoreAttendanceSession[];
  publishedGrades: StorePublishedGrade[];
  borrowingOverrides: Record<string, StoreBorrowingOverride>;
  readMessageIds: string[];
  // ── 擴充 ──
  feedbackDrafts?: StoreFeedbackDraft[];
  discussionPosts?: StoreDiscussionPost[];
  helpRequests?: StoreHelpRequest[];
  orders?: StoreOrder[];
  leaveRequests?: StoreLeaveRequest[];
  dormRepairs?: StoreDormRepair[];
  peerReviews?: StorePeerReview[];
  disabledUsers?: StoreDisabledUser[];
  libraryReservations?: StoreLibraryReservation[];
  /** 公告編輯草稿（id 對應 DEMO_ANNOUNCEMENTS.id；持久化） */
  announcementEdits?: StoreAnnouncementEdit[];
  /** 已下架的公告 id 列表（announcements 與 announcement detail 都會 filter 掉） */
  takendownAnnIds?: string[];
  /** 校友活動報名（含 校友回娘家） */
  alumniEventRsvps?: StoreAlumniEventRsvp[];
  /** 好友關係（雙向；status=accepted 才算朋友） */
  friendships?: StoreFriendship[];
  /** 私訊執行緒（單對單；id 由 [a,b].sort().join('_') 推得） */
  directThreads?: StoreDirectThread[];
  /** 私訊訊息 */
  directMessages?: StoreDirectMessage[];
}

/** 好友關係 */
export interface StoreFriendship {
  /** 由發起者排序 a<b 的兩端 uid 組成 */
  fromUid: string;
  toUid: string;
  status: 'pending' | 'accepted' | 'blocked';
  /** 發出邀請的時間 */
  createdAt: string;
}

/** 私訊執行緒（兩人對話的容器） */
export interface StoreDirectThread {
  id: string;          // sortedUids.join('_')
  participantUids: [string, string];
  lastMessagePreview: string;
  lastSentAt: string;  // ISO
  /** 對應每個 uid 最後一次「進入此 thread」的時間，用以計算未讀 */
  readAt: Record<string, string>;
}

/** 私訊訊息 */
export interface StoreDirectMessage {
  id: string;
  threadId: string;
  fromUid: string;
  body: string;
  sentAt: string;  // ISO
}

const EMPTY_STORE: DemoStore = {
  dynamicMessages: [],
  dynamicAssignments: [],
  submissions: [],
  clubMemberships: [],
  attendanceSessions: [],
  publishedGrades: [],
  borrowingOverrides: {},
  readMessageIds: [],
  feedbackDrafts: [],
  discussionPosts: [],
  helpRequests: [],
  orders: [],
  leaveRequests: [],
  dormRepairs: [],
  peerReviews: [],
  disabledUsers: [],
  libraryReservations: [],
  announcementEdits: [],
  takendownAnnIds: [],
  alumniEventRsvps: [],
  friendships: [],
  directThreads: [],
  directMessages: [],
};

// ─────────────────────────────────────────────────────────────
// 公告編輯 / 下架 helpers
// ─────────────────────────────────────────────────────────────
export function editAnnouncementDraft(edit: Omit<StoreAnnouncementEdit, 'editedAt'> & { editedAt?: string }): void {
  updateDemoStore((store) => {
    const list = store.announcementEdits ?? [];
    const filtered = list.filter((e) => e.id !== edit.id);
    return {
      ...store,
      announcementEdits: [
        { ...edit, editedAt: edit.editedAt ?? new Date().toISOString() },
        ...filtered,
      ],
    };
  });
}

export function getAnnouncementEdit(id: string, store: DemoStore): StoreAnnouncementEdit | undefined {
  return (store.announcementEdits ?? []).find((e) => e.id === id);
}

export function takedownAnnouncement(id: string, by: string): void {
  updateDemoStore((store) => ({
    ...store,
    takendownAnnIds: Array.from(new Set([...(store.takendownAnnIds ?? []), id])),
  }));
  // 通知原發布者
  sendMessage({
    fromName: by,
    fromAvatar: '🛡️',
    subject: `你的公告已被下架`,
    body: `公告（id: ${id}）已被 ${by} 下架。若有疑問，請與審核者聯絡。`,
    sentAt: '剛剛',
    isRead: false,
    type: 'warning',
    recipientRoles: ['teacher', 'club_officer'],
  });
}

export function restoreAnnouncement(id: string): void {
  updateDemoStore((store) => ({
    ...store,
    takendownAnnIds: (store.takendownAnnIds ?? []).filter((x) => x !== id),
  }));
}

export function isAnnouncementTakenDown(id: string, store: DemoStore): boolean {
  return (store.takendownAnnIds ?? []).includes(id);
}

/** 公告審核退回（含原因）+ 通知原提交者
 *
 * 取代原本 admin / announcements 兩處重複把「退回」當「核准」的爛邏輯。
 * 退回會：（1）將公告移出待審佇列（呼叫 approvePendingAnn 標記已處理）
 *         （2）發訊息給對應角色（依 submitterRole 路由）
 */
export function rejectAnnouncementWithReason(params: {
  pendingId: string;
  title: string;
  reason: string;
  submitterRole: DemoUserRole;
  reviewedByLabel: string;
}): void {
  // 1. 移出佇列（重用既有 approvePendingAnn 把它標為「已處理」）
  if (typeof window !== 'undefined') {
    try {
      const raw = window.localStorage.getItem('demoApprovedAnn');
      const approved: string[] = raw ? (JSON.parse(raw) as string[]) : [];
      if (!approved.includes(params.pendingId)) approved.push(params.pendingId);
      window.localStorage.setItem('demoApprovedAnn', JSON.stringify(approved));
      window.dispatchEvent(new CustomEvent('demoPendingAnnChange'));
    } catch { /* ignore */ }
  }
  // 2. 通知原提交者
  sendMessage({
    fromName: '公告審核系統',
    fromAvatar: '🔄',
    subject: `你的公告被退回：${params.title}`,
    body: `${params.reviewedByLabel} 已將公告退回，請補充後重新送審。\n\n退回原因：${params.reason}\n\n請至公告頁面修改後重新提交。`,
    sentAt: '剛剛',
    isRead: false,
    type: 'warning',
    recipientRoles: [params.submitterRole],
  });
}

// ─────────────────────────────────────────────────────────────
// 讀 / 寫
// ─────────────────────────────────────────────────────────────

export function getDemoStore(): DemoStore {
  if (typeof window === 'undefined') return EMPTY_STORE;
  try {
    const raw = window.localStorage.getItem(STORE_KEY);
    if (!raw) return EMPTY_STORE;
    return { ...EMPTY_STORE, ...(JSON.parse(raw) as Partial<DemoStore>) };
  } catch {
    return EMPTY_STORE;
  }
}

function setDemoStore(store: DemoStore): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORE_KEY, JSON.stringify(store));
    window.dispatchEvent(new CustomEvent(STORE_EVENT));
  } catch { /* storage full or private mode */ }
}

function updateDemoStore(updater: (prev: DemoStore) => DemoStore): void {
  setDemoStore(updater(getDemoStore()));
}

// ─────────────────────────────────────────────────────────────
// React Hook
// ─────────────────────────────────────────────────────────────

export function useDemoStore(): DemoStore {
  const [store, setStore] = useState<DemoStore>(() => getDemoStore());

  useEffect(() => {
    const refresh = () => setStore(getDemoStore());
    const storageHandler = (e: StorageEvent) => {
      if (e.key === STORE_KEY) refresh();
    };
    window.addEventListener(STORE_EVENT, refresh);
    window.addEventListener('storage', storageHandler);
    return () => {
      window.removeEventListener(STORE_EVENT, refresh);
      window.removeEventListener('storage', storageHandler);
    };
  }, []);

  return store;
}

// ─────────────────────────────────────────────────────────────
// 訊息 helpers
// ─────────────────────────────────────────────────────────────

/** 傳送動態訊息（角色動作呼叫） */
export function sendMessage(msg: Omit<StoreDynamicMessage, 'id'>): void {
  updateDemoStore((store) => ({
    ...store,
    dynamicMessages: [
      {
        ...msg,
        id: `dyn-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      },
      ...store.dynamicMessages,
    ],
  }));
}

/** 標記動態訊息為已讀 */
export function markDynamicMessageRead(msgId: string): void {
  updateDemoStore((store) => ({
    ...store,
    readMessageIds: store.readMessageIds.includes(msgId)
      ? store.readMessageIds
      : [...store.readMessageIds, msgId],
  }));
}

/**
 * 取得某角色的完整收件匣
 * = 靜態 DEMO_MESSAGES（filter recipientRoles） + 動態 dynamicMessages（倒序）
 */
export type AnyMessage = (DemoMessage | StoreDynamicMessage) & { _dynamic?: boolean };

export function getAllMessagesForRole(
  role: DemoUserRole,
  store: DemoStore,
): AnyMessage[] {
  // 訪客不應該收到任何訊息（隱私邊界）
  if (role === 'guest') return [];
  const staticMsgs = DEMO_MESSAGES.filter((m) => m.recipientRoles.includes(role));
  const dynamicMsgs = store.dynamicMessages
    .filter((m) => m.recipientRoles.includes(role))
    .map((m) => ({ ...m, _dynamic: true as const }));
  return [...dynamicMsgs, ...staticMsgs];
}

/** 動態 + 靜態未讀數 */
export function getUnreadCountDynamic(
  role: DemoUserRole,
  store: DemoStore,
): number {
  const all = getAllMessagesForRole(role, store);
  return all.filter(
    (m) => !m.isRead && !store.readMessageIds.includes(m.id),
  ).length;
}

// ─────────────────────────────────────────────────────────────
// 動作鏈 1：作業流程
// ─────────────────────────────────────────────────────────────

/** 教師新增作業 → 學生收到通知 */
export function addAssignment(
  assignment: Omit<StoreDynamicAssignment, 'id' | 'createdAt'>,
): void {
  const newAssign: StoreDynamicAssignment = {
    ...assignment,
    id: `dyn-hw-${Date.now()}`,
    createdAt: new Date().toISOString(),
  };
  updateDemoStore((store) => ({
    ...store,
    dynamicAssignments: [newAssign, ...store.dynamicAssignments],
  }));
  // 通知學生
  sendMessage({
    fromName: '王大明 老師',
    fromAvatar: '🧑‍🏫',
    subject: `【新作業】${assignment.courseName}：${assignment.title}`,
    body: `老師剛發布了新作業「${assignment.title}」，截止日為 ${assignment.due}，配分 ${assignment.points} 分。\n\n請前往課程頁面查看詳情並準時繳交。`,
    sentAt: '剛剛',
    isRead: false,
    type: 'action',
    relatedCourseId: assignment.courseId,
    recipientRoles: ['student'],
  });
}

/** 學生繳交作業 → 教師 / TA 收到通知 */
export function submitAssignment(params: {
  assignmentId: string;
  courseId: string;
  courseName: string;
  assignmentTitle: string;
  studentId: string;
  studentName: string;
}): void {
  const sub: StoreSubmission = {
    id: `sub-${Date.now()}`,
    assignmentId: params.assignmentId,
    courseId: params.courseId,
    studentId: params.studentId,
    studentName: params.studentName,
    submittedAt: new Date().toISOString(),
    graded: false,
  };
  updateDemoStore((store) => ({
    ...store,
    submissions: [sub, ...store.submissions],
  }));
  sendMessage({
    fromName: `${params.studentName}（系統通知）`,
    fromAvatar: '📬',
    subject: `【作業繳交】${params.studentName} 已繳交：${params.assignmentTitle}`,
    body: `${params.studentName} 已於 ${new Date().toLocaleString('zh-TW')} 繳交「${params.assignmentTitle}」（${params.courseName}）。\n\n請前往成績簿進行批改。`,
    sentAt: '剛剛',
    isRead: false,
    type: 'action',
    relatedCourseId: params.courseId,
    recipientRoles: ['teacher', 'ta'],
  });
}

/** 某學生某作業是否已繳交 */
export function isSubmitted(
  assignmentId: string,
  studentId: string,
  store: DemoStore,
): boolean {
  return store.submissions.some(
    (s) => s.assignmentId === assignmentId && s.studentId === studentId,
  );
}

/** 取得某課程的所有待批改繳交 */
export function getPendingSubmissions(
  courseId: string,
  store: DemoStore,
): StoreSubmission[] {
  return store.submissions.filter(
    (s) => s.courseId === courseId && !s.graded,
  );
}

// ─────────────────────────────────────────────────────────────
// 動作鏈 2：公告審核流程
// ─────────────────────────────────────────────────────────────

/** 教師 / 幹部新增公告後，通知系主任 */
export function notifyDeptHeadNewAnn(title: string, source: string): void {
  sendMessage({
    fromName: source,
    fromAvatar: '⏳',
    subject: `【待審核公告】${title}`,
    body: `${source} 剛提交了一則待審公告：「${title}」\n\n請前往公告頁面的「待審核」Tab 進行審核。`,
    sentAt: '剛剛',
    isRead: false,
    type: 'action',
    recipientRoles: ['department_head'],
  });
}

/** 系主任核准公告後，通知學生 */
export function notifyStudentsAnnApproved(title: string, source: string): void {
  sendMessage({
    fromName: source,
    fromAvatar: '📣',
    subject: `【新公告】${title}`,
    body: `一則新公告已發布：「${title}」\n\n請前往公告頁面查看詳情。`,
    sentAt: '剛剛',
    isRead: false,
    type: 'info',
    recipientRoles: ['student'],
  });
}

// ─────────────────────────────────────────────────────────────
// 動作鏈 3：社團申請流程
// ─────────────────────────────────────────────────────────────

/** 學生申請加入社團 */
export function applyClub(params: {
  clubId: string;
  clubName: string;
  studentId: string;
  studentName: string;
}): void {
  const existing = getDemoStore().clubMemberships.find(
    (m) => m.clubId === params.clubId && m.studentId === params.studentId,
  );
  if (existing) return;

  const membership: StoreClubMembership = {
    id: `cm-${Date.now()}`,
    clubId: params.clubId,
    clubName: params.clubName,
    studentId: params.studentId,
    studentName: params.studentName,
    status: 'pending',
    appliedAt: new Date().toISOString(),
  };
  updateDemoStore((store) => ({
    ...store,
    clubMemberships: [membership, ...store.clubMemberships],
  }));
  sendMessage({
    fromName: `${params.studentName}（申請加入）`,
    fromAvatar: '📨',
    subject: `【社員申請】${params.studentName} 申請加入 ${params.clubName}`,
    body: `${params.studentName} 剛剛申請加入 ${params.clubName}，請前往社團頁面審核這份申請。`,
    sentAt: '剛剛',
    isRead: false,
    type: 'action',
    relatedClubId: params.clubId,
    recipientRoles: ['club_officer'],
  });
}

/** 社長核准社員申請（fromName / clubName 從 store + DEMO_CLUBS 動態讀，不再寫死陳社長） */
export function approveClubMember(membershipId: string, opts?: { officerName?: string }): void {
  let memberName = '';
  let clubId = '';
  let clubName = '';
  updateDemoStore((store) => {
    const updated = store.clubMemberships.map((m) => {
      if (m.id === membershipId) {
        memberName = m.studentName;
        clubId = m.clubId;
        clubName = m.clubName;
        return { ...m, status: 'approved' as const };
      }
      return m;
    });
    return { ...store, clubMemberships: updated };
  });
  if (memberName) {
    // 若沒帶 officerName，從 DEMO_CLUBS 找出該社團的代表幹部稱呼（fallback：「社長」）
    const club = DEMO_CLUBS.find((c) => c.id === clubId);
    const officerName = opts?.officerName ?? `${club?.name ?? clubName} 社長`;
    sendMessage({
      fromName: officerName,
      fromAvatar: club?.icon ?? '🎯',
      subject: `【${clubName}】你的入社申請已通過！`,
      body: `恭喜！你申請加入 ${clubName} 的申請已通過審核。\n\n歡迎加入我們！近期活動訊息請關注社團公告。`,
      sentAt: '剛剛',
      isRead: false,
      type: 'success',
      relatedClubId: clubId,
      recipientRoles: ['student'],
    });
  }
}

/** 社長退回社員申請 → 學生收到「申請未通過」通知 */
export function rejectClubMember(membershipId: string): void {
  let memberName = '';
  let clubId = '';
  let clubName = '';
  updateDemoStore((store) => {
    const updated = store.clubMemberships.map((m) => {
      if (m.id === membershipId) {
        memberName = m.studentName;
        clubId = m.clubId;
        clubName = m.clubName;
        return { ...m, status: 'rejected' as const };
      }
      return m;
    });
    return { ...store, clubMemberships: updated };
  });
  if (memberName) {
    const club = DEMO_CLUBS.find((c) => c.id === clubId);
    const officerName = `${club?.name ?? clubName} 社長`;
    sendMessage({
      fromName: officerName,
      fromAvatar: club?.icon ?? '🎯',
      subject: `【${clubName}】你的入社申請未通過`,
      body: `感謝你申請加入 ${clubName}。\n\n非常遺憾，你的申請在這次審核中未能通過。如有疑問，歡迎聯繫我們了解詳情，也歡迎下次再次申請！`,
      sentAt: '剛剛',
      isRead: false,
      type: 'warning',
      relatedClubId: clubId,
      recipientRoles: ['student'],
    });
  }
}

/** 是否已申請（pending or approved） */
export function getClubMembershipStatus(
  clubId: string,
  studentId: string,
  store: DemoStore,
): 'none' | 'pending' | 'approved' | 'rejected' {
  const m = store.clubMemberships.find(
    (x) => x.clubId === clubId && x.studentId === studentId,
  );
  return m ? m.status : 'none';
}

/** 取得某社團的待審核申請 */
export function getPendingClubMembers(
  clubId: string,
  store: DemoStore,
): StoreClubMembership[] {
  return store.clubMemberships.filter(
    (m) => m.clubId === clubId && m.status === 'pending',
  );
}

// ─────────────────────────────────────────────────────────────
// 動作鏈 4：課程點名流程
// ─────────────────────────────────────────────────────────────

/** 教師開始點名（在 localStorage 設旗） */
export function startAttendanceSession(courseId: string): void {
  updateDemoStore((store) => ({
    ...store,
    attendanceSessions: [
      { courseId, active: true, startedAt: new Date().toISOString() },
      ...store.attendanceSessions.filter(
        (s) => !(s.courseId === courseId && s.active),
      ),
    ],
  }));
}

/** 教師結束點名，所有缺席學生都收到訊息（不再只通知 stu-001）。
 *  demo 簡化：因為 message 是按角色廣播（不是按 uid 點對點），
 *  只要 absentUids 非空就會發出一則「N 位學生缺席」的廣播給 student 角色，
 *  訊息內容會列出缺席學生姓名，讓 demo 看得到「多人缺席」的情境。
 */
export function endAttendanceSession(
  courseId: string,
  courseName: string,
  absentUids: string[],
): void {
  updateDemoStore((store) => ({
    ...store,
    attendanceSessions: store.attendanceSessions.map((s) =>
      s.courseId === courseId && s.active ? { ...s, active: false } : s,
    ),
  }));
  if (absentUids.length > 0) {
    const absentNames = absentUids
      .map((uid) => DEMO_STUDENTS.find((s) => s.uid === uid)?.displayName ?? uid)
      .join('、');
    sendMessage({
      fromName: '課程系統',
      fromAvatar: '📋',
      subject: `【${courseName}】今日點名：${absentUids.length} 位學生缺席`,
      body: `本次 ${courseName} 課程點名共有 ${absentUids.length} 位學生缺席：${absentNames}。\n\n若為本人且有異議，請在 48 小時內聯絡授課教師。`,
      sentAt: '剛剛',
      isRead: false,
      type: 'warning',
      relatedCourseId: courseId,
      recipientRoles: ['student'],
    });
  }
}

/** 某課程是否正在點名中（學生端用） */
export function getActiveAttendance(courseId: string): boolean {
  return getDemoStore().attendanceSessions.some(
    (s) => s.courseId === courseId && s.active,
  );
}

// ─────────────────────────────────────────────────────────────
// 動作鏈 5：圖書館續借
// ─────────────────────────────────────────────────────────────

/** 續借書本（到期日 +14 天） */
export function renewBook(
  bookId: string,
  currentDueDate: string,
  currentRenewCount: number,
): void {
  const due = new Date(currentDueDate);
  due.setDate(due.getDate() + 14);
  const newDueDate = due.toISOString().slice(0, 10);
  updateDemoStore((store) => ({
    ...store,
    borrowingOverrides: {
      ...store.borrowingOverrides,
      [bookId]: { dueDate: newDueDate, renewCount: currentRenewCount + 1 },
    },
  }));
}

// ─────────────────────────────────────────────────────────────
// 動作鏈 6：成績發布
// ─────────────────────────────────────────────────────────────

/** 教師發布成績 → 全班學生收到通知（不再寫死 stu-001）。
 *  若帶入 studentScores，會逐筆寫入個人成績；否則用 DEMO_STUDENTS 全班的 final 平均。
 */
export function publishGrades(params: {
  courseId: string;
  courseName: string;
  /** 不帶就用 DEMO_STUDENTS 全班 final 分數；帶的話為個別學生成績 */
  studentScores?: { studentId: string; score: number; grade: string }[];
  /** 廣播版本：通知全班這次成績已發布（demo 顯示用） */
  summaryGrade?: string;
  summaryScore?: number;
}): void {
  const entries: StorePublishedGrade[] =
    params.studentScores && params.studentScores.length > 0
      ? params.studentScores.map((s) => ({
          courseId: params.courseId,
          courseName: params.courseName,
          studentId: s.studentId,
          score: s.score,
          grade: s.grade,
          publishedAt: new Date().toISOString(),
        }))
      : DEMO_STUDENTS.map((s) => {
          const score = s.scores.final;
          const grade =
            score >= 90 ? 'A' : score >= 80 ? 'B' : score >= 70 ? 'C' : score >= 60 ? 'D' : 'F';
          return {
            courseId: params.courseId,
            courseName: params.courseName,
            studentId: s.uid,
            score,
            grade,
            publishedAt: new Date().toISOString(),
          };
        });
  updateDemoStore((store) => ({
    ...store,
    publishedGrades: [
      ...entries,
      ...store.publishedGrades.filter((g) => g.courseId !== params.courseId),
    ],
  }));
  // 廣播一則訊息給 student 角色（demo 簡化：所有 demo 學生都收到「成績已發布」）
  const headlineScore = params.summaryScore ?? DEMO_STUDENTS[0]?.scores.final ?? 0;
  const headlineGrade =
    params.summaryGrade ??
    (headlineScore >= 90 ? 'A' : headlineScore >= 80 ? 'B' : headlineScore >= 70 ? 'C' : 'D');
  sendMessage({
    fromName: '課程系統',
    fromAvatar: '🎓',
    subject: `【${params.courseName}】成績已發布（全班 ${entries.length} 位）`,
    body: `${params.courseName} 的最終成績已由教師發布。\n\n你的成績：${headlineGrade}（${headlineScore} 分）\n\n可前往成績頁面查看詳情。`,
    sentAt: '剛剛',
    isRead: false,
    type: 'success',
    relatedCourseId: params.courseId,
    recipientRoles: ['student'],
  });
}

// ─────────────────────────────────────────────────────────────
// 其他 helpers
// ─────────────────────────────────────────────────────────────

/** 取得某課程的動態作業（教師新增的） */
export function getDynamicAssignmentsForCourse(
  courseId: string,
  store: DemoStore,
): StoreDynamicAssignment[] {
  return store.dynamicAssignments.filter((a) => a.courseId === courseId);
}

/** 重置 demo store（開發用 / 角色切換時可選擇是否清空） */
export function resetDemoStore(): void {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(STORE_KEY);
  window.dispatchEvent(new CustomEvent(STORE_EVENT));
}

// ─────────────────────────────────────────────────────────────
// 動作鏈 7：教師起草評語 → 學生收到評語
// ─────────────────────────────────────────────────────────────

export interface StoreFeedbackDraft {
  id: string;
  courseId: string;
  studentId: string;
  studentName: string;
  draftPreview: string;
  createdAt: string;
}

export function submitFeedback(params: {
  courseId: string;
  courseName: string;
  studentId: string;
  studentName: string;
  draftPreview: string;
}): void {
  const fb: StoreFeedbackDraft = {
    id: `fb-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    courseId: params.courseId,
    studentId: params.studentId,
    studentName: params.studentName,
    draftPreview: params.draftPreview,
    createdAt: new Date().toISOString(),
  };
  updateDemoStore((store) => ({
    ...store,
    feedbackDrafts: [fb, ...(store.feedbackDrafts ?? [])],
  }));
  sendMessage({
    fromName: '王大明 老師',
    fromAvatar: '🧑‍🏫',
    subject: `【${params.courseName}】老師為你起草了個人化評語`,
    body: `${params.studentName} 同學，老師剛起草了一份針對你作業表現的評語：\n\n${params.draftPreview}\n\n可前往成績頁查看完整批改。`,
    sentAt: '剛剛',
    isRead: false,
    type: 'info',
    relatedCourseId: params.courseId,
    recipientRoles: ['student'],
  });
}

// ─────────────────────────────────────────────────────────────
// 動作鏈 8：學生發討論 → 同學/老師/TA 收通知
// ─────────────────────────────────────────────────────────────

export interface StoreDiscussionPost {
  id: string;
  courseId: string;
  authorId: string;
  authorName: string;
  preview: string;
  createdAt: string;
  replies: number;
}

export function postDiscussion(params: {
  courseId: string;
  courseName: string;
  authorId: string;
  authorName: string;
  preview: string;
}): void {
  const post: StoreDiscussionPost = {
    id: `disc-${Date.now()}`,
    courseId: params.courseId,
    authorId: params.authorId,
    authorName: params.authorName,
    preview: params.preview,
    createdAt: new Date().toISOString(),
    replies: 0,
  };
  updateDemoStore((store) => ({
    ...store,
    discussionPosts: [post, ...(store.discussionPosts ?? [])],
  }));
  sendMessage({
    fromName: `${params.authorName}（討論串）`,
    fromAvatar: '💬',
    subject: `【${params.courseName}】新討論：${params.preview.slice(0, 30)}…`,
    body: `${params.authorName} 在 ${params.courseName} 討論區發了新貼文：\n\n「${params.preview}」\n\n前往課程頁面參與討論。`,
    sentAt: '剛剛',
    isRead: false,
    type: 'info',
    relatedCourseId: params.courseId,
    recipientRoles: ['student', 'teacher', 'ta'],
  });
}

// ─────────────────────────────────────────────────────────────
// 動作鏈 9：學生求助 → TA 佇列 / TA 回覆 → 學生收答覆
// ─────────────────────────────────────────────────────────────

export interface StoreHelpRequest {
  id: string;
  courseId?: string;
  topic: string;
  urgency: 'low' | 'normal' | 'high';
  studentId: string;
  studentName: string;
  status: 'open' | 'replied' | 'resolved';
  reply?: string;
  createdAt: string;
}

export function requestHelp(params: {
  courseId?: string;
  courseName?: string;
  topic: string;
  urgency?: 'low' | 'normal' | 'high';
  studentId: string;
  studentName: string;
}): void {
  const req: StoreHelpRequest = {
    id: `help-${Date.now()}`,
    courseId: params.courseId,
    topic: params.topic,
    urgency: params.urgency ?? 'normal',
    studentId: params.studentId,
    studentName: params.studentName,
    status: 'open',
    createdAt: new Date().toISOString(),
  };
  updateDemoStore((store) => ({
    ...store,
    helpRequests: [req, ...(store.helpRequests ?? [])],
  }));
  sendMessage({
    fromName: `${params.studentName}（求助）`,
    fromAvatar: '🙋',
    subject: `【求助】${params.topic}`,
    body: `${params.studentName} 在 ${params.courseName ?? '系統'} 提出求助：\n\n「${params.topic}」\n\n緊急度：${req.urgency === 'high' ? '🔥 高' : req.urgency === 'low' ? '🟢 低' : '🟡 一般'}`,
    sentAt: '剛剛',
    isRead: false,
    type: 'action',
    relatedCourseId: params.courseId,
    recipientRoles: ['ta', 'teacher'],
  });
}

export function replyHelpRequest(params: {
  helpId: string;
  reply: string;
  replierName: string;
}): void {
  let target: StoreHelpRequest | undefined;
  updateDemoStore((store) => {
    const updated = (store.helpRequests ?? []).map((h) => {
      if (h.id === params.helpId) {
        target = h;
        return { ...h, status: 'replied' as const, reply: params.reply };
      }
      return h;
    });
    return { ...store, helpRequests: updated };
  });
  if (target) {
    sendMessage({
      fromName: params.replierName,
      fromAvatar: '🧑‍💻',
      subject: `【回覆】${target.topic}`,
      body: `${params.replierName} 回覆了你的求助：\n\n${params.reply}\n\n如已解決，可在求助頁標記「已解決」。`,
      sentAt: '剛剛',
      isRead: false,
      type: 'success',
      relatedCourseId: target.courseId,
      recipientRoles: ['student'],
    });
  }
}

export function getOpenHelpRequests(store: DemoStore): StoreHelpRequest[] {
  return (store.helpRequests ?? []).filter((h) => h.status === 'open');
}

// ─────────────────────────────────────────────────────────────
// 動作鏈 10：訂餐 → vendor / vendor 推進 → student
// ─────────────────────────────────────────────────────────────

export type OrderStatus = 'placed' | 'processing' | 'ready' | 'completed' | 'cancelled';

export interface StoreOrder {
  id: string;
  studentId: string;
  studentName: string;
  vendorName: string;
  items: { name: string; qty: number; price: number }[];
  total: number;
  status: OrderStatus;
  placedAt: string;
}

export function placeOrder(params: {
  studentId: string;
  studentName: string;
  vendorName: string;
  items: { name: string; qty: number; price: number }[];
}): StoreOrder {
  const total = params.items.reduce((sum, i) => sum + i.qty * i.price, 0);
  const order: StoreOrder = {
    id: `ord-${Date.now()}`,
    studentId: params.studentId,
    studentName: params.studentName,
    vendorName: params.vendorName,
    items: params.items,
    total,
    status: 'placed',
    placedAt: new Date().toISOString(),
  };
  updateDemoStore((store) => ({
    ...store,
    orders: [order, ...(store.orders ?? [])],
  }));
  // 訊息：給 alumni 用的「您的訂單已成立」回執
  sendMessage({
    fromName: params.vendorName,
    fromAvatar: '🍱',
    subject: `【訂單成立】${params.vendorName}`,
    body: `已收到你的訂單：\n${params.items.map((i) => `· ${i.name} × ${i.qty}`).join('\n')}\n\n總計 NT$${total}。我們會盡快備餐。`,
    sentAt: '剛剛',
    isRead: false,
    type: 'success',
    recipientRoles: ['student'],
  });
  return order;
}

export function updateOrderStatus(orderId: string, status: OrderStatus): void {
  let target: StoreOrder | undefined;
  updateDemoStore((store) => {
    const updated = (store.orders ?? []).map((o) => {
      if (o.id === orderId) {
        target = { ...o, status };
        return target;
      }
      return o;
    });
    return { ...store, orders: updated };
  });
  if (target) {
    const label =
      status === 'processing' ? '🍳 準備中'
      : status === 'ready' ? '🛎️ 已備好可取餐'
      : status === 'completed' ? '✅ 已完成'
      : status === 'cancelled' ? '❌ 已取消' : '已下單';
    sendMessage({
      fromName: target.vendorName,
      fromAvatar: '🍱',
      subject: `【訂單狀態】${label}`,
      body: `你在 ${target.vendorName} 的訂單狀態更新為「${label}」。\n\n總計 NT$${target.total}`,
      sentAt: '剛剛',
      isRead: false,
      type: status === 'ready' ? 'action' : 'info',
      recipientRoles: ['student'],
    });
  }
}

// ─────────────────────────────────────────────────────────────
// 動作鏈 11：請假 → teacher 核准/退回 → student
// ─────────────────────────────────────────────────────────────

export interface StoreLeaveRequest {
  id: string;
  courseId?: string;
  studentId: string;
  studentName: string;
  reason: string;
  dateFrom: string;
  dateTo: string;
  status: 'pending' | 'approved' | 'rejected';
  decidedBy?: string;
  createdAt: string;
}

export function requestLeave(params: {
  courseId?: string;
  courseName?: string;
  studentId: string;
  studentName: string;
  reason: string;
  dateFrom: string;
  dateTo: string;
}): void {
  const leave: StoreLeaveRequest = {
    id: `lv-${Date.now()}`,
    courseId: params.courseId,
    studentId: params.studentId,
    studentName: params.studentName,
    reason: params.reason,
    dateFrom: params.dateFrom,
    dateTo: params.dateTo,
    status: 'pending',
    createdAt: new Date().toISOString(),
  };
  updateDemoStore((store) => ({
    ...store,
    leaveRequests: [leave, ...(store.leaveRequests ?? [])],
  }));
  sendMessage({
    fromName: `${params.studentName}（請假申請）`,
    fromAvatar: '📅',
    subject: `【請假申請】${params.studentName}：${params.dateFrom} ~ ${params.dateTo}`,
    body: `${params.studentName} 提交請假申請：\n\n課程：${params.courseName ?? '一般請假'}\n日期：${params.dateFrom} ~ ${params.dateTo}\n原因：${params.reason}\n\n請至課程頁面審核。`,
    sentAt: '剛剛',
    isRead: false,
    type: 'action',
    relatedCourseId: params.courseId,
    recipientRoles: ['teacher', 'department_head'],
  });
}

export function decideLeave(params: {
  leaveId: string;
  decision: 'approved' | 'rejected';
  decidedBy: string;
  note?: string;
}): void {
  let target: StoreLeaveRequest | undefined;
  updateDemoStore((store) => {
    const updated = (store.leaveRequests ?? []).map((l) => {
      if (l.id === params.leaveId) {
        target = { ...l, status: params.decision, decidedBy: params.decidedBy };
        return target;
      }
      return l;
    });
    return { ...store, leaveRequests: updated };
  });
  if (target) {
    const label = params.decision === 'approved' ? '✅ 已核准' : '❌ 已退回';
    sendMessage({
      fromName: params.decidedBy,
      fromAvatar: '📅',
      subject: `【請假結果】${label}`,
      body: `你的請假申請（${target.dateFrom} ~ ${target.dateTo}）已${params.decision === 'approved' ? '核准' : '退回'}。${params.note ? `\n\n附註：${params.note}` : ''}`,
      sentAt: '剛剛',
      isRead: false,
      type: params.decision === 'approved' ? 'success' : 'warning',
      relatedCourseId: target.courseId,
      recipientRoles: ['student'],
    });
  }
}

// ─────────────────────────────────────────────────────────────
// 動作鏈 12：宿舍報修 → admin 處理
// ─────────────────────────────────────────────────────────────

export interface StoreDormRepair {
  id: string;
  building: string;
  room: string;
  urgency: 'low' | 'normal' | 'high';
  description: string;
  studentId: string;
  studentName: string;
  status: 'reported' | 'dispatched' | 'resolved';
  createdAt: string;
}

export function submitDormRepair(params: {
  building: string;
  room: string;
  urgency?: 'low' | 'normal' | 'high';
  description: string;
  studentId: string;
  studentName: string;
}): void {
  const r: StoreDormRepair = {
    id: `dr-${Date.now()}`,
    building: params.building,
    room: params.room,
    urgency: params.urgency ?? 'normal',
    description: params.description,
    studentId: params.studentId,
    studentName: params.studentName,
    status: 'reported',
    createdAt: new Date().toISOString(),
  };
  updateDemoStore((store) => ({
    ...store,
    dormRepairs: [r, ...(store.dormRepairs ?? [])],
  }));
  sendMessage({
    fromName: `${params.studentName}（宿舍報修）`,
    fromAvatar: '🔧',
    subject: `【宿舍報修】${params.building} ${params.room}`,
    body: `${params.studentName} 報修：\n\n地點：${params.building} ${params.room}\n問題：${params.description}\n緊急度：${r.urgency}\n\n請至管理後台派工。`,
    sentAt: '剛剛',
    isRead: false,
    type: 'action',
    recipientRoles: ['admin'],
  });
}

export function setDormRepairStatus(repairId: string, status: StoreDormRepair['status']): void {
  let target: StoreDormRepair | undefined;
  updateDemoStore((store) => {
    const updated = (store.dormRepairs ?? []).map((r) => {
      if (r.id === repairId) {
        target = { ...r, status };
        return target;
      }
      return r;
    });
    return { ...store, dormRepairs: updated };
  });
  if (target) {
    const label = status === 'dispatched' ? '已派工' : status === 'resolved' ? '已修復' : '已收件';
    sendMessage({
      fromName: '宿舍管理組',
      fromAvatar: '🔧',
      subject: `【報修狀態】${label}`,
      body: `你的宿舍報修（${target.building} ${target.room}）狀態更新為「${label}」。`,
      sentAt: '剛剛',
      isRead: false,
      type: status === 'resolved' ? 'success' : 'info',
      recipientRoles: ['student'],
    });
  }
}

// ─────────────────────────────────────────────────────────────
// 動作鏈 13：同儕互評（指派 + 提交）
// ─────────────────────────────────────────────────────────────

export interface StorePeerReview {
  id: string;
  courseId: string;
  assignmentTitle: string;
  reviewerId: string;
  revieweeId: string;
  reviewerName: string;
  revieweeName: string;
  dueDate: string;
  status: 'pending' | 'submitted';
  comment?: string;
  rating?: number;
  createdAt: string;
}

export function assignPeerReview(params: {
  courseId: string;
  courseName: string;
  assignmentTitle: string;
  pairs: { reviewerId: string; reviewerName: string; revieweeId: string; revieweeName: string }[];
  dueDate: string;
}): void {
  const reviews: StorePeerReview[] = params.pairs.map((p) => ({
    id: `pr-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    courseId: params.courseId,
    assignmentTitle: params.assignmentTitle,
    reviewerId: p.reviewerId,
    revieweeId: p.revieweeId,
    reviewerName: p.reviewerName,
    revieweeName: p.revieweeName,
    dueDate: params.dueDate,
    status: 'pending',
    createdAt: new Date().toISOString(),
  }));
  updateDemoStore((store) => ({
    ...store,
    peerReviews: [...reviews, ...(store.peerReviews ?? [])],
  }));
  sendMessage({
    fromName: '課程系統',
    fromAvatar: '🔁',
    subject: `【同儕互評】${params.courseName}：${params.assignmentTitle}`,
    body: `已指派 ${reviews.length} 組同儕互評，截止 ${params.dueDate}。請至課程頁進行互評。`,
    sentAt: '剛剛',
    isRead: false,
    type: 'action',
    relatedCourseId: params.courseId,
    recipientRoles: ['student'],
  });
}

export function submitPeerReview(params: {
  reviewId: string;
  comment: string;
  rating: number;
}): void {
  let target: StorePeerReview | undefined;
  updateDemoStore((store) => {
    const updated = (store.peerReviews ?? []).map((r) => {
      if (r.id === params.reviewId) {
        target = { ...r, status: 'submitted', comment: params.comment, rating: params.rating };
        return target;
      }
      return r;
    });
    return { ...store, peerReviews: updated };
  });
  if (target) {
    sendMessage({
      fromName: `${target.reviewerName}（同儕回饋）`,
      fromAvatar: '🔁',
      subject: `【互評收到】${target.assignmentTitle}`,
      body: `你的同儕 ${target.reviewerName} 完成了一份互評：\n\n評分：${params.rating}/5\n回饋：${params.comment}`,
      sentAt: '剛剛',
      isRead: false,
      type: 'info',
      relatedCourseId: target.courseId,
      recipientRoles: ['student'],
    });
  }
}

// ─────────────────────────────────────────────────────────────
// 動作鏈 14：批量提醒（teacher 對未交作業的學生）
// ─────────────────────────────────────────────────────────────

export function bulkRemind(params: {
  courseName: string;
  homeworkTitle: string;
  count: number;
  fromName?: string;
}): void {
  sendMessage({
    fromName: params.fromName ?? '王大明 老師',
    fromAvatar: '⏰',
    subject: `【提醒】${params.courseName}：${params.homeworkTitle} 即將截止`,
    body: `老師注意到你尚未繳交 ${params.courseName} 的「${params.homeworkTitle}」。\n\n請盡快前往課程頁面繳交，避免影響成績。`,
    sentAt: '剛剛',
    isRead: false,
    type: 'warning',
    recipientRoles: ['student'],
  });
}

// ─────────────────────────────────────────────────────────────
// 動作鏈 15：系所廣播（dept_head → 全系）
// ─────────────────────────────────────────────────────────────

export function sendDeptBroadcast(params: {
  title: string;
  body: string;
  audience?: DemoUserRole[];
  fromName?: string;
}): void {
  const audience = params.audience ?? ['student', 'teacher', 'ta'];
  sendMessage({
    fromName: params.fromName ?? '黃主任',
    fromAvatar: '🏛️',
    subject: `【系所廣播】${params.title}`,
    body: params.body,
    sentAt: '剛剛',
    isRead: false,
    type: 'info',
    recipientRoles: audience,
  });
}

/** 公告核准 → 通知原提交者 */
export function notifySubmitterAnnApproved(params: {
  title: string;
  submitterRole: DemoUserRole;
  approvedBy?: string;
}): void {
  sendMessage({
    fromName: params.approvedBy ?? '黃主任',
    fromAvatar: '✅',
    subject: `【公告已核准】${params.title}`,
    body: `你提交的公告「${params.title}」已通過審核並發布。學生現在可以看到了。`,
    sentAt: '剛剛',
    isRead: false,
    type: 'success',
    recipientRoles: [params.submitterRole],
  });
}

// ─────────────────────────────────────────────────────────────
// 動作鏈 16：管理員停用 / 啟用使用者
// ─────────────────────────────────────────────────────────────

export interface StoreDisabledUser {
  uid: string;
  disabledAt: string;
  reason?: string;
}

export function setUserDisabled(uid: string, disabled: boolean, reason?: string): void {
  updateDemoStore((store) => {
    const current = store.disabledUsers ?? [];
    if (disabled) {
      if (current.some((u) => u.uid === uid)) return store;
      return {
        ...store,
        disabledUsers: [
          { uid, disabledAt: new Date().toISOString(), reason },
          ...current,
        ],
      };
    } else {
      return {
        ...store,
        disabledUsers: current.filter((u) => u.uid !== uid),
      };
    }
  });
}

export function isUserDisabled(uid: string, store: DemoStore): boolean {
  return (store.disabledUsers ?? []).some((u) => u.uid === uid);
}

// ─────────────────────────────────────────────────────────────
// 動作鏈 17：圖書館 預約 / 轉讓（補齊原本只能續借）
// ─────────────────────────────────────────────────────────────

export interface StoreLibraryReservation {
  id: string;
  bookId: string;
  bookTitle: string;
  studentId: string;
  studentName: string;
  reservedAt: string;
}

export function reserveBook(params: {
  bookId: string;
  bookTitle: string;
  studentId: string;
  studentName: string;
}): void {
  const r: StoreLibraryReservation = {
    id: `rsv-${Date.now()}`,
    bookId: params.bookId,
    bookTitle: params.bookTitle,
    studentId: params.studentId,
    studentName: params.studentName,
    reservedAt: new Date().toISOString(),
  };
  updateDemoStore((store) => ({
    ...store,
    libraryReservations: [r, ...(store.libraryReservations ?? [])],
  }));
  sendMessage({
    fromName: '圖書館系統',
    fromAvatar: '📚',
    subject: `【預約成功】${params.bookTitle}`,
    body: `你已成功預約《${params.bookTitle}》。當該書歸還後，系統會通知你前來借閱。`,
    sentAt: '剛剛',
    isRead: false,
    type: 'success',
    recipientRoles: ['student'],
  });
}

export function transferBook(params: {
  bookId: string;
  bookTitle: string;
  fromStudentName: string;
  toStudentName: string;
}): void {
  sendMessage({
    fromName: '圖書館系統',
    fromAvatar: '📚',
    subject: `【借閱轉讓】${params.bookTitle}`,
    body: `《${params.bookTitle}》已從 ${params.fromStudentName} 轉讓給 ${params.toStudentName}。`,
    sentAt: '剛剛',
    isRead: false,
    type: 'info',
    recipientRoles: ['student'],
  });
}

// ─────────────────────────────────────────────────────────────
// 校友活動報名（校友回娘家）
// ─────────────────────────────────────────────────────────────
export function rsvpAlumniEvent(params: { eventId: string; eventName: string; by: string }): {
  alreadyRegistered: boolean;
} {
  let alreadyRegistered = false;
  updateDemoStore((store) => {
    const list = store.alumniEventRsvps ?? [];
    const existing = list.find((r) => r.eventId === params.eventId && r.by === params.by);
    if (existing) {
      alreadyRegistered = true;
      return store;
    }
    return {
      ...store,
      alumniEventRsvps: [
        {
          eventId: params.eventId,
          eventName: params.eventName,
          by: params.by,
          rsvpAt: new Date().toISOString(),
        },
        ...list,
      ],
    };
  });
  return { alreadyRegistered };
}

export function getAlumniEventRsvps(store: DemoStore, by?: string): StoreAlumniEventRsvp[] {
  const list = store.alumniEventRsvps ?? [];
  return by ? list.filter((r) => r.by === by) : list;
}

// ─────────────────────────────────────────────────────────────
// 好友 / 私訊（DM）— 真正可用的聊天系統
// ─────────────────────────────────────────────────────────────

/** 計算雙人 thread 的固定 id（與排序順序無關） */
export function buildThreadId(a: string, b: string): string {
  return [a, b].sort().join('__');
}

/** 取得兩人之間的好友關係狀態（不限發起方向） */
export function getFriendshipStatus(
  selfUid: string,
  otherUid: string,
  store: DemoStore,
): 'none' | 'pending_outgoing' | 'pending_incoming' | 'accepted' | 'blocked' {
  const list = store.friendships ?? [];
  const f = list.find(
    (x) =>
      (x.fromUid === selfUid && x.toUid === otherUid) ||
      (x.fromUid === otherUid && x.toUid === selfUid),
  );
  if (!f) return 'none';
  if (f.status === 'accepted') return 'accepted';
  if (f.status === 'blocked') return 'blocked';
  return f.fromUid === selfUid ? 'pending_outgoing' : 'pending_incoming';
}

/** 列出某使用者已接受的好友 uid */
export function listFriendUids(selfUid: string, store: DemoStore): string[] {
  return (store.friendships ?? [])
    .filter((f) => f.status === 'accepted' && (f.fromUid === selfUid || f.toUid === selfUid))
    .map((f) => (f.fromUid === selfUid ? f.toUid : f.fromUid));
}

/** 列出收到的待處理好友邀請（對方→自己） */
export function listIncomingFriendRequests(
  selfUid: string,
  store: DemoStore,
): StoreFriendship[] {
  return (store.friendships ?? []).filter(
    (f) => f.status === 'pending' && f.toUid === selfUid,
  );
}

/** 列出自己發出但對方尚未回覆的邀請 */
export function listOutgoingFriendRequests(
  selfUid: string,
  store: DemoStore,
): StoreFriendship[] {
  return (store.friendships ?? []).filter(
    (f) => f.status === 'pending' && f.fromUid === selfUid,
  );
}

/** 發送好友邀請（若已存在不重複） */
export function sendFriendRequest(fromUid: string, toUid: string): {
  ok: boolean;
  reason?: string;
} {
  if (!fromUid || !toUid || fromUid === toUid) {
    return { ok: false, reason: '無效的對象' };
  }
  let reason: string | undefined;
  let ok = true;
  updateDemoStore((store) => {
    const list = store.friendships ?? [];
    const existing = list.find(
      (x) =>
        (x.fromUid === fromUid && x.toUid === toUid) ||
        (x.fromUid === toUid && x.toUid === fromUid),
    );
    if (existing) {
      if (existing.status === 'accepted') {
        ok = false;
        reason = '你們已經是好友';
      } else if (existing.status === 'pending') {
        ok = false;
        reason = existing.fromUid === fromUid ? '已送出邀請，等待對方回覆' : '對方已邀請你，請至「好友邀請」回覆';
      } else if (existing.status === 'blocked') {
        ok = false;
        reason = '此使用者已封鎖往來';
      }
      return store;
    }
    const next: StoreFriendship = {
      fromUid,
      toUid,
      status: 'pending',
      createdAt: new Date().toISOString(),
    };
    return { ...store, friendships: [next, ...list] };
  });
  return { ok, reason };
}

/** 接受好友邀請 */
export function acceptFriendRequest(fromUid: string, toUid: string): void {
  updateDemoStore((store) => {
    const list = store.friendships ?? [];
    return {
      ...store,
      friendships: list.map((f) =>
        f.fromUid === fromUid && f.toUid === toUid && f.status === 'pending'
          ? { ...f, status: 'accepted' as const }
          : f,
      ),
    };
  });
}

/** 拒絕邀請（直接移除） */
export function rejectFriendRequest(fromUid: string, toUid: string): void {
  updateDemoStore((store) => ({
    ...store,
    friendships: (store.friendships ?? []).filter(
      (f) => !(f.fromUid === fromUid && f.toUid === toUid && f.status === 'pending'),
    ),
  }));
}

/** 移除好友（雙向移除） */
export function removeFriend(selfUid: string, otherUid: string): void {
  updateDemoStore((store) => ({
    ...store,
    friendships: (store.friendships ?? []).filter(
      (f) =>
        !(
          (f.fromUid === selfUid && f.toUid === otherUid) ||
          (f.fromUid === otherUid && f.toUid === selfUid)
        ),
    ),
  }));
}

/** 取得（或建立）某兩人的私訊 thread */
export function getOrCreateThread(selfUid: string, otherUid: string): StoreDirectThread {
  const id = buildThreadId(selfUid, otherUid);
  const existing = (getDemoStore().directThreads ?? []).find((t) => t.id === id);
  if (existing) return existing;
  const fresh: StoreDirectThread = {
    id,
    participantUids: [selfUid, otherUid].sort() as [string, string],
    lastMessagePreview: '',
    lastSentAt: new Date(0).toISOString(),
    readAt: { [selfUid]: new Date().toISOString() },
  };
  updateDemoStore((store) => ({
    ...store,
    directThreads: [fresh, ...(store.directThreads ?? [])],
  }));
  return fresh;
}

/** 寄出私訊（自動建立 thread 如不存在） */
export function sendDirectMessage(params: {
  fromUid: string;
  toUid: string;
  body: string;
}): StoreDirectMessage | null {
  if (!params.body.trim()) return null;
  const threadId = buildThreadId(params.fromUid, params.toUid);
  const now = new Date().toISOString();
  const msg: StoreDirectMessage = {
    id: `dm-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    threadId,
    fromUid: params.fromUid,
    body: params.body.trim(),
    sentAt: now,
  };
  updateDemoStore((store) => {
    const threads = store.directThreads ?? [];
    const sortedPair = [params.fromUid, params.toUid].sort() as [string, string];
    const found = threads.find((t) => t.id === threadId);
    const updatedThread: StoreDirectThread = found
      ? {
          ...found,
          lastMessagePreview: msg.body.slice(0, 80),
          lastSentAt: now,
          readAt: { ...found.readAt, [params.fromUid]: now },
        }
      : {
          id: threadId,
          participantUids: sortedPair,
          lastMessagePreview: msg.body.slice(0, 80),
          lastSentAt: now,
          readAt: { [params.fromUid]: now },
        };
    return {
      ...store,
      directThreads: found
        ? threads.map((t) => (t.id === threadId ? updatedThread : t))
        : [updatedThread, ...threads],
      directMessages: [...(store.directMessages ?? []), msg],
    };
  });
  return msg;
}

/** 標記某 thread 已被自己讀過（更新 readAt） */
export function markThreadRead(threadId: string, selfUid: string): void {
  updateDemoStore((store) => ({
    ...store,
    directThreads: (store.directThreads ?? []).map((t) =>
      t.id === threadId
        ? { ...t, readAt: { ...t.readAt, [selfUid]: new Date().toISOString() } }
        : t,
    ),
  }));
}

/** 取得某使用者的全部 threads，依最後發送時間排序 */
export function listThreadsFor(selfUid: string, store: DemoStore): StoreDirectThread[] {
  return (store.directThreads ?? [])
    .filter((t) => t.participantUids.includes(selfUid))
    .sort((a, b) => (a.lastSentAt < b.lastSentAt ? 1 : -1));
}

/** 取得 thread 的所有訊息（時間正序） */
export function listMessagesInThread(threadId: string, store: DemoStore): StoreDirectMessage[] {
  return (store.directMessages ?? [])
    .filter((m) => m.threadId === threadId)
    .sort((a, b) => (a.sentAt < b.sentAt ? -1 : 1));
}

/** 計算某 thread 對自己的未讀數 */
export function countUnreadInThread(
  thread: StoreDirectThread,
  selfUid: string,
  store: DemoStore,
): number {
  const lastRead = thread.readAt[selfUid] ?? new Date(0).toISOString();
  return (store.directMessages ?? []).filter(
    (m) => m.threadId === thread.id && m.fromUid !== selfUid && m.sentAt > lastRead,
  ).length;
}

/** 計算所有 thread 對自己的未讀數總和（給訊息圖示徽章用） */
export function countTotalDmUnread(selfUid: string, store: DemoStore): number {
  return listThreadsFor(selfUid, store).reduce(
    (sum, t) => sum + countUnreadInThread(t, selfUid, store),
    0,
  );
}

// ─────────────────────────────────────────────────────────────
// 預設好友/私訊資料種子（首次進站時注入，讓 demo 一打開就有內容）
// ─────────────────────────────────────────────────────────────
let _seeded = false;
export function seedFriendsIfNeeded(): void {
  if (_seeded) return;
  if (typeof window === 'undefined') return;
  _seeded = true;
  const store = getDemoStore();
  // 若已經種過，跳過
  if ((store.friendships?.length ?? 0) > 0 || (store.directThreads?.length ?? 0) > 0) return;
  const now = new Date();
  const minutesAgo = (m: number) => new Date(now.getTime() - m * 60_000).toISOString();
  const seededFriendships: StoreFriendship[] = [
    { fromUid: 'demo-student-1', toUid: 'demo-teacher-1', status: 'accepted', createdAt: minutesAgo(60 * 24 * 30) },
    { fromUid: 'demo-student-1', toUid: 'demo-ta-1', status: 'accepted', createdAt: minutesAgo(60 * 24 * 21) },
    { fromUid: 'demo-student-1', toUid: 'stu-002', status: 'accepted', createdAt: minutesAgo(60 * 24 * 60) },
    { fromUid: 'stu-003', toUid: 'demo-student-1', status: 'accepted', createdAt: minutesAgo(60 * 24 * 14) },
    { fromUid: 'demo-club-1', toUid: 'demo-student-1', status: 'pending', createdAt: minutesAgo(60 * 2) },
    { fromUid: 'demo-teacher-1', toUid: 'demo-ta-1', status: 'accepted', createdAt: minutesAgo(60 * 24 * 90) },
  ];
  const t1 = buildThreadId('demo-student-1', 'demo-teacher-1');
  const t2 = buildThreadId('demo-student-1', 'demo-ta-1');
  const t3 = buildThreadId('demo-student-1', 'stu-002');
  const t4 = buildThreadId('demo-teacher-1', 'demo-ta-1');

  const seededMessages: StoreDirectMessage[] = [
    {
      id: 'dm-seed-1',
      threadId: t1,
      fromUid: 'demo-student-1',
      body: '王老師好，想請問期末專題的題目可以自訂嗎?',
      sentAt: minutesAgo(180),
    },
    {
      id: 'dm-seed-2',
      threadId: t1,
      fromUid: 'demo-teacher-1',
      body: '可以自訂,但需要先把題目大綱寄給我審核哦。',
      sentAt: minutesAgo(120),
    },
    {
      id: 'dm-seed-3',
      threadId: t1,
      fromUid: 'demo-student-1',
      body: '了解!我大概想做「校園活動推薦系統」,使用協同過濾。',
      sentAt: minutesAgo(60),
    },
    {
      id: 'dm-seed-4',
      threadId: t2,
      fromUid: 'demo-ta-1',
      body: '小明你好,作業二第三題你用遞迴的版本我看過了,寫得很好,只有 base case 的條件可以再簡化。',
      sentAt: minutesAgo(45),
    },
    {
      id: 'dm-seed-5',
      threadId: t3,
      fromUid: 'stu-002',
      body: '今天的點名沒到我幫你點了一下,記得下次來!',
      sentAt: minutesAgo(30),
    },
    {
      id: 'dm-seed-6',
      threadId: t3,
      fromUid: 'demo-student-1',
      body: '謝啦雅婷,我下次會準時!',
      sentAt: minutesAgo(25),
    },
    {
      id: 'dm-seed-7',
      threadId: t4,
      fromUid: 'demo-teacher-1',
      body: '林助教,作業二批改進度怎麼樣?',
      sentAt: minutesAgo(15),
    },
    {
      id: 'dm-seed-8',
      threadId: t4,
      fromUid: 'demo-ta-1',
      body: '已批改完前 5 份,評語都填好了,週末會完成剩下的。',
      sentAt: minutesAgo(10),
    },
  ];
  const seededThreads: StoreDirectThread[] = [
    {
      id: t1,
      participantUids: ['demo-student-1', 'demo-teacher-1'].sort() as [string, string],
      lastMessagePreview: '了解!我大概想做「校園活動推薦系統」,使用協同過濾。',
      lastSentAt: minutesAgo(60),
      readAt: { 'demo-teacher-1': minutesAgo(90) },
    },
    {
      id: t2,
      participantUids: ['demo-student-1', 'demo-ta-1'].sort() as [string, string],
      lastMessagePreview: '小明你好,作業二第三題你用遞迴的版本我看過了...',
      lastSentAt: minutesAgo(45),
      readAt: {},
    },
    {
      id: t3,
      participantUids: ['demo-student-1', 'stu-002'].sort() as [string, string],
      lastMessagePreview: '謝啦雅婷,我下次會準時!',
      lastSentAt: minutesAgo(25),
      readAt: { 'demo-student-1': minutesAgo(20) },
    },
    {
      id: t4,
      participantUids: ['demo-teacher-1', 'demo-ta-1'].sort() as [string, string],
      lastMessagePreview: '已批改完前 5 份,評語都填好了...',
      lastSentAt: minutesAgo(10),
      readAt: {},
    },
  ];
  updateDemoStore((s) => ({
    ...s,
    friendships: seededFriendships,
    directThreads: seededThreads,
    directMessages: seededMessages,
  }));
}
