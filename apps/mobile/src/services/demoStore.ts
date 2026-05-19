/**
 * apps/mobile/src/services/demoStore.ts —
 * Mobile 版的跨角色動作關聯狀態管理（對應 apps/web/src/lib/demoStore.ts）。
 *
 * 與 web 版同樣以「動作 → 寫 store → 切角色看到結果」為核心，但底層
 * 改用 AsyncStorage（無 window）+ 簡單 subscriber pattern 通知 React 重渲染。
 *
 * 範圍：覆蓋核心 7 條動作鏈
 *   1. requestLeave / decideLeave
 *   2. submitDormRepair / setDormRepairStatus
 *   3. placeOrder / updateOrderStatus
 *   4. requestHelp / replyHelpRequest
 *   5. applyClub / approveClubMember / rejectClubMember
 *   6. submitAssignment
 *   7. announcement workflow（pending / approved / rejected）
 *
 * Note: 與 web 版「不直接共享 localStorage」，但 schema 一致，方便日後接
 * Supabase Realtime 將雙端打通（路徑見 MOBILE_DEMOSTORE_NOTE.md）。
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

// 與 web 版完全相同的 schema（除型別 import 路徑外）
export type DemoUserRole =
  | 'student'
  | 'teacher'
  | 'ta'
  | 'club_officer'
  | 'department_head'
  | 'admin'
  | 'alumni'
  | 'guest';

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
  relatedLeaveId?: string;
  relatedDormRepairId?: string;
  relatedOrderId?: string;
  relatedHelpId?: string;
  relatedAssignmentId?: string;
  relatedClubMembershipId?: string;
  relatedPendingAnnId?: string;
  senderRole?: DemoUserRole;
  inReplyTo?: string;
  recipientRoles: DemoUserRole[];
}

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

export interface StoreClubMembership {
  id: string;
  clubId: string;
  clubName: string;
  studentId: string;
  studentName: string;
  status: 'pending' | 'approved' | 'rejected';
  appliedAt: string;
}

export interface StoreSubmission {
  id: string;
  assignmentId: string;
  courseId: string;
  studentId: string;
  studentName: string;
  submittedAt: string;
  score?: number;
  graded: boolean;
}

export interface DemoStore {
  dynamicMessages: StoreDynamicMessage[];
  leaveRequests: StoreLeaveRequest[];
  dormRepairs: StoreDormRepair[];
  orders: StoreOrder[];
  helpRequests: StoreHelpRequest[];
  clubMemberships: StoreClubMembership[];
  submissions: StoreSubmission[];
  readMessageIds: string[];
}

const EMPTY: DemoStore = {
  dynamicMessages: [],
  leaveRequests: [],
  dormRepairs: [],
  orders: [],
  helpRequests: [],
  clubMemberships: [],
  submissions: [],
  readMessageIds: [],
};

export const STORE_KEY = 'mobileDemoStore_v1';

// ─────────────────────────────────────────────────────────────
// 在記憶體內快取最新 snapshot + subscriber 機制
// ─────────────────────────────────────────────────────────────

let cached: DemoStore = { ...EMPTY };
let hydrated = false;
const subscribers = new Set<() => void>();
let pendingFlushTimer: ReturnType<typeof setTimeout> | null = null;

function emit() {
  for (const cb of subscribers) cb();
}

function scheduleFlush() {
  if (pendingFlushTimer) clearTimeout(pendingFlushTimer);
  pendingFlushTimer = setTimeout(() => {
    pendingFlushTimer = null;
    void AsyncStorage.setItem(STORE_KEY, JSON.stringify(cached)).catch(() => {
      /* storage full or quota exceeded — silently fail */
    });
  }, 100);
}

/** 初始化：從 AsyncStorage 載入持久化的 store（首次呼叫才會做） */
export async function hydrateDemoStore(): Promise<void> {
  if (hydrated) return;
  try {
    const raw = await AsyncStorage.getItem(STORE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<DemoStore>;
      cached = { ...EMPTY, ...parsed };
    }
  } catch {
    /* JSON 解析失敗或 storage 異常，保持 EMPTY */
  }
  hydrated = true;
  emit();
}

export function getDemoStore(): DemoStore {
  return cached;
}

export function subscribeDemoStore(cb: () => void): () => void {
  subscribers.add(cb);
  return () => subscribers.delete(cb);
}

function updateStore(updater: (prev: DemoStore) => DemoStore): void {
  cached = updater(cached);
  emit();
  scheduleFlush();
}

export async function resetDemoStore(): Promise<void> {
  cached = { ...EMPTY };
  emit();
  await AsyncStorage.removeItem(STORE_KEY).catch(() => undefined);
}

// ─────────────────────────────────────────────────────────────
// 訊息核心
// ─────────────────────────────────────────────────────────────

export function sendMessage(msg: Omit<StoreDynamicMessage, 'id'>): StoreDynamicMessage {
  const built: StoreDynamicMessage = {
    ...msg,
    id: `dyn-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
  };
  updateStore((s) => ({ ...s, dynamicMessages: [built, ...s.dynamicMessages] }));
  return built;
}

export function markDynamicMessageRead(msgId: string): void {
  updateStore((s) =>
    s.readMessageIds.includes(msgId) ? s : { ...s, readMessageIds: [...s.readMessageIds, msgId] },
  );
}

export function getMessagesForRole(role: DemoUserRole, store: DemoStore = cached): StoreDynamicMessage[] {
  if (role === 'guest') return [];
  return store.dynamicMessages.filter((m) => m.recipientRoles.includes(role));
}

export function getUnreadCount(role: DemoUserRole, store: DemoStore = cached): number {
  const msgs = getMessagesForRole(role, store);
  return msgs.filter((m) => !m.isRead && !store.readMessageIds.includes(m.id)).length;
}

// ─────────────────────────────────────────────────────────────
// 動作鏈：請假
// ─────────────────────────────────────────────────────────────

export function requestLeave(params: {
  courseId?: string;
  courseName?: string;
  studentId: string;
  studentName: string;
  reason: string;
  dateFrom: string;
  dateTo: string;
}): StoreLeaveRequest {
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
  updateStore((s) => ({ ...s, leaveRequests: [leave, ...s.leaveRequests] }));
  sendMessage({
    fromName: `${params.studentName}（請假申請）`,
    fromAvatar: '📅',
    subject: `【請假申請】${params.studentName}：${params.dateFrom} ~ ${params.dateTo}`,
    body: `${params.studentName} 提交請假申請：\n\n課程：${params.courseName ?? '一般請假'}\n日期：${params.dateFrom} ~ ${params.dateTo}\n原因：${params.reason}\n\n請於收件匣點「核准 / 退回」處理。`,
    sentAt: '剛剛',
    isRead: false,
    type: 'action',
    relatedCourseId: params.courseId,
    relatedLeaveId: leave.id,
    senderRole: 'student',
    recipientRoles: ['teacher', 'department_head'],
  });
  return leave;
}

export function decideLeave(params: {
  leaveId: string;
  decision: 'approved' | 'rejected';
  decidedBy: string;
  note?: string;
}): void {
  let target: StoreLeaveRequest | undefined;
  updateStore((s) => {
    const updated = s.leaveRequests.map((l) => {
      if (l.id === params.leaveId) {
        target = { ...l, status: params.decision, decidedBy: params.decidedBy };
        return target;
      }
      return l;
    });
    return { ...s, leaveRequests: updated };
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
      senderRole: 'teacher',
      recipientRoles: ['student'],
    });
  }
}

// ─────────────────────────────────────────────────────────────
// 動作鏈：宿舍報修
// ─────────────────────────────────────────────────────────────

export function submitDormRepair(params: {
  building: string;
  room: string;
  urgency?: 'low' | 'normal' | 'high';
  description: string;
  studentId: string;
  studentName: string;
}): StoreDormRepair {
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
  updateStore((s) => ({ ...s, dormRepairs: [r, ...s.dormRepairs] }));
  sendMessage({
    fromName: `${params.studentName}（宿舍報修）`,
    fromAvatar: '🔧',
    subject: `【宿舍報修】${params.building} ${params.room}`,
    body: `${params.studentName} 報修：\n\n地點：${params.building} ${params.room}\n問題：${params.description}\n緊急度：${r.urgency}\n\n請於收件匣點「派工 / 完工」處理。`,
    sentAt: '剛剛',
    isRead: false,
    type: 'action',
    relatedDormRepairId: r.id,
    senderRole: 'student',
    recipientRoles: ['admin'],
  });
  return r;
}

export function setDormRepairStatus(repairId: string, status: StoreDormRepair['status']): void {
  let target: StoreDormRepair | undefined;
  updateStore((s) => {
    const updated = s.dormRepairs.map((r) => {
      if (r.id === repairId) {
        target = { ...r, status };
        return target;
      }
      return r;
    });
    return { ...s, dormRepairs: updated };
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
      senderRole: 'admin',
      recipientRoles: ['student'],
    });
  }
}

// ─────────────────────────────────────────────────────────────
// 動作鏈：訂餐
// ─────────────────────────────────────────────────────────────

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
  updateStore((s) => ({ ...s, orders: [order, ...s.orders] }));
  sendMessage({
    fromName: params.vendorName,
    fromAvatar: '🍱',
    subject: `【訂單成立】${params.vendorName}`,
    body: `已收到你的訂單：\n${params.items.map((i) => `· ${i.name} × ${i.qty}`).join('\n')}\n\n總計 NT$${total}。我們會盡快備餐。`,
    sentAt: '剛剛',
    isRead: false,
    type: 'success',
    relatedOrderId: order.id,
    senderRole: 'student',
    recipientRoles: ['student'],
  });
  sendMessage({
    fromName: `${params.studentName}（新訂單）`,
    fromAvatar: '🛎️',
    subject: `【新訂單】${params.vendorName} ${params.items.length} 項`,
    body: `${params.studentName} 在 ${params.vendorName} 下了新訂單：\n\n${params.items.map((i) => `· ${i.name} × ${i.qty}`).join('\n')}\n\n總計 NT$${total}。請於收件匣推進訂單狀態。`,
    sentAt: '剛剛',
    isRead: false,
    type: 'action',
    relatedOrderId: order.id,
    senderRole: 'student',
    recipientRoles: ['admin'],
  });
  return order;
}

export function updateOrderStatus(orderId: string, status: OrderStatus): void {
  let target: StoreOrder | undefined;
  updateStore((s) => {
    const updated = s.orders.map((o) => {
      if (o.id === orderId) {
        target = { ...o, status };
        return target;
      }
      return o;
    });
    return { ...s, orders: updated };
  });
  if (target) {
    const label =
      status === 'processing'
        ? '🍳 準備中'
        : status === 'ready'
          ? '🛎️ 已備好可取餐'
          : status === 'completed'
            ? '✅ 已完成'
            : status === 'cancelled'
              ? '❌ 已取消'
              : '已下單';
    sendMessage({
      fromName: target.vendorName,
      fromAvatar: '🍱',
      subject: `【訂單狀態】${label}`,
      body: `你在 ${target.vendorName} 的訂單狀態更新為「${label}」。\n\n總計 NT$${target.total}`,
      sentAt: '剛剛',
      isRead: false,
      type: status === 'ready' ? 'action' : 'info',
      senderRole: 'admin',
      recipientRoles: ['student'],
    });
  }
}

// ─────────────────────────────────────────────────────────────
// 動作鏈：求助
// ─────────────────────────────────────────────────────────────

export function requestHelp(params: {
  courseId?: string;
  courseName?: string;
  topic: string;
  urgency?: 'low' | 'normal' | 'high';
  studentId: string;
  studentName: string;
}): StoreHelpRequest {
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
  updateStore((s) => ({ ...s, helpRequests: [req, ...s.helpRequests] }));
  sendMessage({
    fromName: `${params.studentName}（求助）`,
    fromAvatar: '🙋',
    subject: `【求助】${params.topic}`,
    body: `${params.studentName} 在 ${params.courseName ?? '系統'} 提出求助：\n\n「${params.topic}」\n\n緊急度：${req.urgency === 'high' ? '🔥 高' : req.urgency === 'low' ? '🟢 低' : '🟡 一般'}\n\n請於收件匣點「快速回覆」處理。`,
    sentAt: '剛剛',
    isRead: false,
    type: 'action',
    relatedCourseId: params.courseId,
    relatedHelpId: req.id,
    senderRole: 'student',
    recipientRoles: ['ta', 'teacher'],
  });
  return req;
}

export function replyHelpRequest(params: { helpId: string; reply: string; replierName: string }): void {
  let target: StoreHelpRequest | undefined;
  updateStore((s) => {
    const updated = s.helpRequests.map((h) => {
      if (h.id === params.helpId) {
        target = { ...h, status: 'replied' as const, reply: params.reply };
        return target;
      }
      return h;
    });
    return { ...s, helpRequests: updated };
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
      senderRole: 'ta',
      recipientRoles: ['student'],
    });
  }
}

// ─────────────────────────────────────────────────────────────
// 動作鏈：社團申請
// ─────────────────────────────────────────────────────────────

export function applyClub(params: {
  clubId: string;
  clubName: string;
  studentId: string;
  studentName: string;
}): StoreClubMembership | null {
  const existing = cached.clubMemberships.find(
    (m) => m.clubId === params.clubId && m.studentId === params.studentId,
  );
  if (existing) return null;
  const membership: StoreClubMembership = {
    id: `cm-${Date.now()}`,
    clubId: params.clubId,
    clubName: params.clubName,
    studentId: params.studentId,
    studentName: params.studentName,
    status: 'pending',
    appliedAt: new Date().toISOString(),
  };
  updateStore((s) => ({ ...s, clubMemberships: [membership, ...s.clubMemberships] }));
  sendMessage({
    fromName: `${params.studentName}（申請加入）`,
    fromAvatar: '📨',
    subject: `【社員申請】${params.studentName} 申請加入 ${params.clubName}`,
    body: `${params.studentName} 剛剛申請加入 ${params.clubName}，可於收件匣直接點「核准 / 拒絕」處理。`,
    sentAt: '剛剛',
    isRead: false,
    type: 'action',
    relatedClubId: params.clubId,
    relatedClubMembershipId: membership.id,
    senderRole: 'student',
    recipientRoles: ['club_officer'],
  });
  return membership;
}

export function approveClubMember(membershipId: string, opts?: { officerName?: string }): void {
  let memberName = '';
  let clubName = '';
  updateStore((s) => {
    const updated = s.clubMemberships.map((m) => {
      if (m.id === membershipId) {
        memberName = m.studentName;
        clubName = m.clubName;
        return { ...m, status: 'approved' as const };
      }
      return m;
    });
    return { ...s, clubMemberships: updated };
  });
  if (memberName) {
    sendMessage({
      fromName: opts?.officerName ?? `${clubName} 社長`,
      fromAvatar: '🎯',
      subject: `【${clubName}】你的入社申請已通過！`,
      body: `恭喜！你申請加入 ${clubName} 的申請已通過審核。\n\n歡迎加入我們！近期活動訊息請關注社團公告。`,
      sentAt: '剛剛',
      isRead: false,
      type: 'success',
      senderRole: 'club_officer',
      recipientRoles: ['student'],
    });
  }
}

export function rejectClubMember(membershipId: string, opts?: { officerName?: string }): void {
  let memberName = '';
  let clubName = '';
  updateStore((s) => {
    const updated = s.clubMemberships.map((m) => {
      if (m.id === membershipId) {
        memberName = m.studentName;
        clubName = m.clubName;
        return { ...m, status: 'rejected' as const };
      }
      return m;
    });
    return { ...s, clubMemberships: updated };
  });
  if (memberName) {
    sendMessage({
      fromName: opts?.officerName ?? `${clubName} 社長`,
      fromAvatar: '🎯',
      subject: `【${clubName}】你的入社申請未通過`,
      body: `感謝你申請加入 ${clubName}。\n\n非常遺憾，你的申請在這次審核中未能通過。如有疑問，歡迎聯繫我們，也歡迎下次再次申請！`,
      sentAt: '剛剛',
      isRead: false,
      type: 'warning',
      senderRole: 'club_officer',
      recipientRoles: ['student'],
    });
  }
}

// ─────────────────────────────────────────────────────────────
// 動作鏈：作業繳交
// ─────────────────────────────────────────────────────────────

export function submitAssignment(params: {
  assignmentId: string;
  courseId: string;
  courseName: string;
  assignmentTitle: string;
  studentId: string;
  studentName: string;
}): StoreSubmission {
  const sub: StoreSubmission = {
    id: `sub-${Date.now()}`,
    assignmentId: params.assignmentId,
    courseId: params.courseId,
    studentId: params.studentId,
    studentName: params.studentName,
    submittedAt: new Date().toISOString(),
    graded: false,
  };
  updateStore((s) => ({ ...s, submissions: [sub, ...s.submissions] }));
  sendMessage({
    fromName: `${params.studentName}（系統通知）`,
    fromAvatar: '📬',
    subject: `【作業繳交】${params.studentName} 已繳交：${params.assignmentTitle}`,
    body: `${params.studentName} 已於 ${new Date().toLocaleString('zh-TW')} 繳交「${params.assignmentTitle}」（${params.courseName}）。\n\n請於收件匣點「前往成績簿批改」。`,
    sentAt: '剛剛',
    isRead: false,
    type: 'action',
    relatedCourseId: params.courseId,
    relatedAssignmentId: params.assignmentId,
    senderRole: 'student',
    recipientRoles: ['teacher', 'ta'],
  });
  return sub;
}

// ─────────────────────────────────────────────────────────────
// 一鍵 seed：對應 web 版的同名函式
// ─────────────────────────────────────────────────────────────

export function seedDemoQueues(): void {
  requestLeave({
    courseId: 'c7',
    courseName: '資料庫系統',
    studentId: 'stu-001',
    studentName: '王小明',
    reason: '感冒發燒（醫師建議在家休息）',
    dateFrom: '2026-05-21',
    dateTo: '2026-05-21',
  });
  submitDormRepair({
    building: '靜園男舍',
    room: '305',
    urgency: 'normal',
    description: '浴室水龍頭關不緊，整夜滴水',
    studentId: 'stu-001',
    studentName: '王小明',
  });
  placeOrder({
    studentId: 'stu-001',
    studentName: '王小明',
    vendorName: '校園小棧',
    items: [
      { name: '雞排便當', qty: 1, price: 90 },
      { name: '紅茶', qty: 1, price: 25 },
    ],
  });
  requestHelp({
    courseId: 'c1',
    courseName: '資料結構',
    topic: '鏈結串列遞迴實作卡關，能否安排答疑時間？',
    urgency: 'normal',
    studentId: 'stu-001',
    studentName: '王小明',
  });
  submitAssignment({
    assignmentId: 'hw-final',
    courseId: 'c1',
    courseName: '資料結構',
    assignmentTitle: '期末專題提案',
    studentId: 'stu-001',
    studentName: '王小明',
  });
  applyClub({
    clubId: 'club-2',
    clubName: '攝影社',
    studentId: 'stu-001',
    studentName: '王小明',
  });
}
