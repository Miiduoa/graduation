/**
 * @vitest-environment jsdom
 *
 * 跨角色動作鏈端到端契約測試。
 *
 * 主要驗證：每個 producer（學生 / 教師 / 社長 / admin / 系主任）的動作
 * 寫入 demoStore 後，正確的 recipientRoles 會收到訊息，且 deep-link
 * id（relatedLeaveId / relatedDormRepairId 等）正確帶在訊息上。
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// jsdom 29 在 vitest 環境下未自帶完整 localStorage（缺 removeItem），
// 必須在 import demoStore 前先 polyfill，否則模組 top-level 也會碰到。
function ensureLocalStorage() {
  if (typeof window === 'undefined') return;
  if (typeof window.localStorage?.removeItem === 'function') return;
  const memoryStore: Record<string, string> = {};
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      getItem(key: string) {
        return Object.prototype.hasOwnProperty.call(memoryStore, key) ? memoryStore[key] : null;
      },
      setItem(key: string, value: string) {
        memoryStore[key] = String(value);
      },
      removeItem(key: string) {
        delete memoryStore[key];
      },
      clear() {
        for (const k of Object.keys(memoryStore)) delete memoryStore[k];
      },
      key(index: number) {
        return Object.keys(memoryStore)[index] ?? null;
      },
      get length() {
        return Object.keys(memoryStore).length;
      },
    },
  });
}
ensureLocalStorage();

import {
  requestLeave,
  decideLeave,
  submitDormRepair,
  setDormRepairStatus,
  placeOrder,
  updateOrderStatus,
  requestHelp,
  replyHelpRequest,
  applyClub,
  approveClubMember,
  submitAssignment,
  getDemoStore,
  getAllMessagesForRole,
  resetDemoStore,
  type DemoStore,
} from './demoStore';

beforeEach(() => {
  ensureLocalStorage();
  window.localStorage.clear();
  resetDemoStore();
});

afterEach(() => {
  resetDemoStore();
});

function lastMessageForRole(role: Parameters<typeof getAllMessagesForRole>[0]) {
  const store = getDemoStore();
  const msgs = getAllMessagesForRole(role, store).filter((m) => m._dynamic);
  return msgs[0];
}

describe('cross-role action chains', () => {
  it('requestLeave → teacher / department_head receive with relatedLeaveId + senderRole', () => {
    requestLeave({
      courseId: 'c7',
      courseName: '資料庫系統',
      studentId: 'stu-001',
      studentName: '王小明',
      reason: '病假',
      dateFrom: '2026-05-21',
      dateTo: '2026-05-21',
    });

    const store = getDemoStore();
    expect(store.leaveRequests).toHaveLength(1);
    const leave = store.leaveRequests![0];

    const teacherMsg = lastMessageForRole('teacher');
    expect(teacherMsg).toBeDefined();
    expect(teacherMsg.subject).toContain('請假申請');
    // @ts-expect-error _dynamic message has optional deep-link fields
    expect(teacherMsg.relatedLeaveId).toBe(leave.id);
    // @ts-expect-error _dynamic message has optional deep-link fields
    expect(teacherMsg.senderRole).toBe('student');

    const deptMsg = lastMessageForRole('department_head');
    expect(deptMsg?.id).toBe(teacherMsg.id);
  });

  it('decideLeave → student receives approval / rejection notice', () => {
    requestLeave({
      courseId: 'c7',
      courseName: '資料庫系統',
      studentId: 'stu-001',
      studentName: '王小明',
      reason: '病假',
      dateFrom: '2026-05-21',
      dateTo: '2026-05-21',
    });
    const leaveId = getDemoStore().leaveRequests![0].id;

    decideLeave({
      leaveId,
      decision: 'approved',
      decidedBy: '王大明 老師',
    });

    const updated = getDemoStore().leaveRequests!.find((l) => l.id === leaveId);
    expect(updated?.status).toBe('approved');

    const studentMsg = lastMessageForRole('student');
    expect(studentMsg.subject).toContain('請假結果');
    expect(studentMsg.body).toContain('核准');
  });

  it('submitDormRepair → admin sees with relatedDormRepairId', () => {
    submitDormRepair({
      building: '靜園男舍',
      room: '305',
      description: '水龍頭漏水',
      studentId: 'stu-001',
      studentName: '王小明',
    });

    const store = getDemoStore();
    expect(store.dormRepairs).toHaveLength(1);
    const repair = store.dormRepairs![0];

    const adminMsg = lastMessageForRole('admin');
    expect(adminMsg).toBeDefined();
    expect(adminMsg.subject).toContain('宿舍報修');
    // @ts-expect-error _dynamic message has optional deep-link fields
    expect(adminMsg.relatedDormRepairId).toBe(repair.id);
  });

  it('setDormRepairStatus dispatched → student receives status update', () => {
    submitDormRepair({
      building: '靜園男舍',
      room: '305',
      description: '水龍頭漏水',
      studentId: 'stu-001',
      studentName: '王小明',
    });
    const repairId = getDemoStore().dormRepairs![0].id;

    setDormRepairStatus(repairId, 'dispatched');

    const studentMsg = lastMessageForRole('student');
    expect(studentMsg.subject).toContain('報修狀態');
    expect(studentMsg.body).toContain('已派工');
  });

  it('placeOrder → admin receives action msg + student receives receipt', () => {
    placeOrder({
      studentId: 'stu-001',
      studentName: '王小明',
      vendorName: '校園小棧',
      items: [{ name: '雞排便當', qty: 1, price: 90 }],
    });

    const store = getDemoStore();
    expect(store.orders).toHaveLength(1);
    const order = store.orders![0];

    // Admin gets action message
    const adminMsg = lastMessageForRole('admin');
    expect(adminMsg).toBeDefined();
    expect(adminMsg.type).toBe('action');
    // @ts-expect-error _dynamic message has optional deep-link fields
    expect(adminMsg.relatedOrderId).toBe(order.id);

    // Student gets receipt
    const studentMsg = lastMessageForRole('student');
    expect(studentMsg.subject).toContain('訂單成立');
  });

  it('updateOrderStatus ready → student receives pickup notification', () => {
    placeOrder({
      studentId: 'stu-001',
      studentName: '王小明',
      vendorName: '校園小棧',
      items: [{ name: '雞排便當', qty: 1, price: 90 }],
    });
    const orderId = getDemoStore().orders![0].id;

    updateOrderStatus(orderId, 'ready');

    const studentMsg = lastMessageForRole('student');
    expect(studentMsg.subject).toContain('訂單狀態');
    expect(studentMsg.body).toContain('已備好');
  });

  it('requestHelp → ta / teacher receive with relatedHelpId', () => {
    requestHelp({
      courseId: 'c1',
      courseName: '資料結構',
      topic: '遞迴卡關',
      studentId: 'stu-001',
      studentName: '王小明',
    });

    const store = getDemoStore();
    expect(store.helpRequests).toHaveLength(1);
    const help = store.helpRequests![0];

    const taMsg = lastMessageForRole('ta');
    expect(taMsg).toBeDefined();
    // @ts-expect-error _dynamic message has optional deep-link fields
    expect(taMsg.relatedHelpId).toBe(help.id);

    const teacherMsg = lastMessageForRole('teacher');
    expect(teacherMsg?.id).toBe(taMsg.id);
  });

  it('replyHelpRequest → student receives reply, status becomes replied', () => {
    requestHelp({
      courseId: 'c1',
      courseName: '資料結構',
      topic: '遞迴卡關',
      studentId: 'stu-001',
      studentName: '王小明',
    });
    const helpId = getDemoStore().helpRequests![0].id;

    replyHelpRequest({
      helpId,
      reply: '下週二 14:00 工程館 308 答疑',
      replierName: '林助教',
    });

    const help = getDemoStore().helpRequests!.find((h) => h.id === helpId);
    expect(help?.status).toBe('replied');
    expect(help?.reply).toContain('14:00');

    const studentMsg = lastMessageForRole('student');
    expect(studentMsg.subject).toContain('回覆');
  });

  it('applyClub → club_officer receives with relatedClubMembershipId', () => {
    applyClub({
      clubId: 'club-2',
      clubName: '攝影社',
      studentId: 'stu-001',
      studentName: '王小明',
    });

    const store = getDemoStore();
    expect(store.clubMemberships).toHaveLength(1);
    const membership = store.clubMemberships[0];

    const officerMsg = lastMessageForRole('club_officer');
    expect(officerMsg).toBeDefined();
    // @ts-expect-error _dynamic message has optional deep-link fields
    expect(officerMsg.relatedClubMembershipId).toBe(membership.id);
  });

  it('approveClubMember → student receives approval notice + status becomes approved', () => {
    applyClub({
      clubId: 'club-2',
      clubName: '攝影社',
      studentId: 'stu-001',
      studentName: '王小明',
    });
    const membershipId = getDemoStore().clubMemberships[0].id;

    approveClubMember(membershipId, { officerName: '陳社長' });

    const membership = getDemoStore().clubMemberships.find((m) => m.id === membershipId);
    expect(membership?.status).toBe('approved');

    const studentMsg = lastMessageForRole('student');
    expect(studentMsg.subject).toContain('入社申請');
    expect(studentMsg.body).toContain('通過');
  });

  it('submitAssignment → teacher / ta inbox + submission recorded', () => {
    submitAssignment({
      assignmentId: 'hw-final',
      courseId: 'c1',
      courseName: '資料結構',
      assignmentTitle: '期末專題提案',
      studentId: 'stu-001',
      studentName: '王小明',
    });

    const store = getDemoStore();
    expect(store.submissions).toHaveLength(1);
    expect(store.submissions[0].graded).toBe(false);

    const teacherMsg = lastMessageForRole('teacher');
    expect(teacherMsg.subject).toContain('作業繳交');
    // @ts-expect-error _dynamic message has optional deep-link fields
    expect(teacherMsg.relatedAssignmentId).toBe('hw-final');
  });

  it('does not deliver student-scoped action messages to guest', () => {
    requestLeave({
      courseId: 'c1',
      courseName: '資料結構',
      studentId: 'stu-001',
      studentName: '王小明',
      reason: '事假',
      dateFrom: '2026-05-21',
      dateTo: '2026-05-21',
    });

    const store: DemoStore = getDemoStore();
    const guestMsgs = getAllMessagesForRole('guest', store);
    expect(guestMsgs).toHaveLength(0);
  });
});
