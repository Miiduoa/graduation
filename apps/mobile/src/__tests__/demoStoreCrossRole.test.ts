/**
 * demoStoreCrossRole.test.ts
 *
 * 端到端驗證：5 個 demo 角色 (student/teacher/ta/admin/department_head/club_officer/vendor→admin fallback)
 * 在 demoStore 的 8 條動作鏈中互相收發訊息是否正確。
 *
 * 對應口試 Demo 的「訊息功能 + 角色間動作關聯」驗證 checklist。
 */

import {
  resetDemoStore,
  getDemoStore,
  getMessagesForRole,
  getUnreadCount,
  markDynamicMessageRead,
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
  rejectClubMember,
  submitAssignment,
  publishAnnouncement,
  approveAnnouncement,
  rejectAnnouncementWithReason,
  seedDemoQueues,
  sendMessage,
} from '../services/demoStore';

const STUDENT = { id: 'stu-001', name: '王小明' };

beforeEach(async () => {
  await resetDemoStore();
});

describe('動作鏈 1：請假 student → teacher/department_head → student', () => {
  test('學生送出請假 → teacher 與 department_head 收到 action 訊息；學生未收到', () => {
    requestLeave({
      courseId: 'c1',
      courseName: '資料庫',
      studentId: STUDENT.id,
      studentName: STUDENT.name,
      reason: '看醫生',
      dateFrom: '2026-05-21',
      dateTo: '2026-05-21',
    });
    expect(getMessagesForRole('teacher')).toHaveLength(1);
    expect(getMessagesForRole('department_head')).toHaveLength(1);
    expect(getMessagesForRole('student')).toHaveLength(0);
    expect(getMessagesForRole('teacher')[0].type).toBe('action');
    expect(getMessagesForRole('teacher')[0].relatedLeaveId).toBeDefined();
  });

  test('教師核准 → 學生收到 success 通知', () => {
    const leave = requestLeave({
      studentId: STUDENT.id,
      studentName: STUDENT.name,
      reason: '感冒',
      dateFrom: '2026-05-21',
      dateTo: '2026-05-21',
    });
    decideLeave({ leaveId: leave.id, decision: 'approved', decidedBy: '張怡君老師' });
    const stuMsgs = getMessagesForRole('student');
    expect(stuMsgs).toHaveLength(1);
    expect(stuMsgs[0].type).toBe('success');
    expect(stuMsgs[0].subject).toContain('已核准');
  });

  test('教師退回 → 學生收到 warning 通知', () => {
    const leave = requestLeave({
      studentId: STUDENT.id,
      studentName: STUDENT.name,
      reason: 'x',
      dateFrom: '2026-05-21',
      dateTo: '2026-05-21',
    });
    decideLeave({ leaveId: leave.id, decision: 'rejected', decidedBy: '張怡君' });
    const stuMsgs = getMessagesForRole('student');
    expect(stuMsgs[0].type).toBe('warning');
  });
});

describe('動作鏈 2：宿舍報修 student → admin → student', () => {
  test('學生報修 → admin 收到 action；學生未收到', () => {
    submitDormRepair({
      building: '靜園',
      room: '305',
      description: '水龍頭壞',
      studentId: STUDENT.id,
      studentName: STUDENT.name,
    });
    expect(getMessagesForRole('admin')).toHaveLength(1);
    expect(getMessagesForRole('admin')[0].relatedDormRepairId).toBeDefined();
    expect(getMessagesForRole('student')).toHaveLength(0);
  });

  test('admin 派工 + 完工 → 學生連收兩則', () => {
    const r = submitDormRepair({
      building: '靜園',
      room: '305',
      description: '燈泡',
      studentId: STUDENT.id,
      studentName: STUDENT.name,
    });
    setDormRepairStatus(r.id, 'dispatched');
    setDormRepairStatus(r.id, 'resolved');
    const stuMsgs = getMessagesForRole('student');
    expect(stuMsgs).toHaveLength(2);
    expect(stuMsgs[0].subject).toContain('已修復');
    expect(stuMsgs[1].subject).toContain('已派工');
  });
});

describe('動作鏈 3：訂餐 student → admin/vendor → student', () => {
  test('下單 → 學生收到訂單成立(success)；admin/vendor 收到新訂單(action)', () => {
    placeOrder({
      studentId: STUDENT.id,
      studentName: STUDENT.name,
      vendorName: '校園小棧',
      items: [{ name: '雞排便當', qty: 1, price: 90 }],
    });
    const stuMsgs = getMessagesForRole('student');
    expect(stuMsgs).toHaveLength(1);
    expect(stuMsgs[0].type).toBe('success');
    expect(stuMsgs[0].subject).toContain('訂單成立');

    const adminMsgs = getMessagesForRole('admin');
    expect(adminMsgs).toHaveLength(1);
    expect(adminMsgs[0].type).toBe('action');
    expect(adminMsgs[0].relatedOrderId).toBeDefined();
  });

  test('訂單成立給學生的訊息 senderRole 必須是 admin（已修復的 bug）', () => {
    placeOrder({
      studentId: STUDENT.id,
      studentName: STUDENT.name,
      vendorName: 'X',
      items: [{ name: 'A', qty: 1, price: 50 }],
    });
    const orderConfirm = getMessagesForRole('student')[0];
    // bug fix verification: senderRole 應該是商家 (admin)，不應該再是 'student'
    expect(orderConfirm.senderRole).toBe('admin');
  });

  test('admin 推進狀態 → 學生收到對應通知', () => {
    const order = placeOrder({
      studentId: STUDENT.id,
      studentName: STUDENT.name,
      vendorName: 'X',
      items: [{ name: 'A', qty: 1, price: 50 }],
    });
    updateOrderStatus(order.id, 'processing');
    updateOrderStatus(order.id, 'ready');
    const stuMsgs = getMessagesForRole('student');
    // 1 (成立) + 2 (進度) = 3
    expect(stuMsgs).toHaveLength(3);
    expect(stuMsgs[0].subject).toContain('已備好可取餐');
    expect(stuMsgs[0].type).toBe('action');
  });
});

describe('動作鏈 4：求助 student → ta/teacher → student', () => {
  test('學生求助 → ta 與 teacher 同時收到', () => {
    requestHelp({
      topic: '鏈結串列卡關',
      studentId: STUDENT.id,
      studentName: STUDENT.name,
    });
    expect(getMessagesForRole('ta')).toHaveLength(1);
    expect(getMessagesForRole('teacher')).toHaveLength(1);
  });

  test('TA 回覆 → 學生收到 success 通知', () => {
    const h = requestHelp({
      topic: '矩陣',
      studentId: STUDENT.id,
      studentName: STUDENT.name,
    });
    replyHelpRequest({ helpId: h.id, reply: '可以這樣做...', replierName: '林助教' });
    const stuMsgs = getMessagesForRole('student');
    expect(stuMsgs).toHaveLength(1);
    expect(stuMsgs[0].type).toBe('success');
    expect(stuMsgs[0].body).toContain('可以這樣做');
  });
});

describe('動作鏈 5：社團申請 student → club_officer → student', () => {
  test('申請 → club_officer 收到 action；admin 不應該收到', () => {
    applyClub({
      clubId: 'club-1',
      clubName: '攝影社',
      studentId: STUDENT.id,
      studentName: STUDENT.name,
    });
    expect(getMessagesForRole('club_officer')).toHaveLength(1);
    expect(getMessagesForRole('admin')).toHaveLength(0);
  });

  test('重複申請同社團 → 不重複建立 membership', () => {
    const a = applyClub({
      clubId: 'club-1',
      clubName: '攝影社',
      studentId: STUDENT.id,
      studentName: STUDENT.name,
    });
    const b = applyClub({
      clubId: 'club-1',
      clubName: '攝影社',
      studentId: STUDENT.id,
      studentName: STUDENT.name,
    });
    expect(a).not.toBeNull();
    expect(b).toBeNull();
  });

  test('社長核准 → 學生收到 success；拒絕 → 學生收到 warning', () => {
    const m1 = applyClub({
      clubId: 'c1',
      clubName: 'A',
      studentId: STUDENT.id,
      studentName: STUDENT.name,
    });
    approveClubMember(m1!.id, { officerName: '魏社長' });
    let stuMsgs = getMessagesForRole('student');
    expect(stuMsgs.filter((m) => m.type === 'success')).toHaveLength(1);

    const m2 = applyClub({
      clubId: 'c2',
      clubName: 'B',
      studentId: STUDENT.id,
      studentName: STUDENT.name,
    });
    rejectClubMember(m2!.id);
    stuMsgs = getMessagesForRole('student');
    expect(stuMsgs.filter((m) => m.type === 'warning')).toHaveLength(1);
  });
});

describe('動作鏈 6：作業繳交 student → teacher/ta', () => {
  test('學生繳交 → teacher 與 ta 收到 action 訊息含 relatedAssignmentId', () => {
    submitAssignment({
      assignmentId: 'hw1',
      courseId: 'c1',
      courseName: '資料結構',
      assignmentTitle: '期中作業',
      studentId: STUDENT.id,
      studentName: STUDENT.name,
    });
    expect(getMessagesForRole('teacher')[0].relatedAssignmentId).toBe('hw1');
    expect(getMessagesForRole('ta')[0].relatedAssignmentId).toBe('hw1');
  });
});

describe('動作鏈 7：公告審核 teacher → department_head → all', () => {
  test('提交公告 → 系主任收到 action（單獨）', () => {
    publishAnnouncement({
      title: '期末考試公告',
      content: '6/16-6/20',
      teacherName: '張怡君',
    });
    expect(getMessagesForRole('department_head')).toHaveLength(1);
    expect(getMessagesForRole('student')).toHaveLength(0);
    expect(getMessagesForRole('teacher')).toHaveLength(0);
  });

  test('系主任核准 → 全體（student/teacher/ta/alumni）+ 老師個別收到', () => {
    publishAnnouncement({ title: '考試', content: '...', teacherName: '張怡君' });
    approveAnnouncement({
      pendingId: 'ann-x',
      title: '考試',
      approverName: '黃主任',
      submitterName: '張怡君',
    });
    // 學生只看到 1 則發布通知（不會看到原本的待審）
    expect(getMessagesForRole('student').filter((m) => m.subject.includes('公告發布'))).toHaveLength(
      1,
    );
    // 老師收到「已核准」success 通知 + 不會看到「公告發布」（recipient 不含 teacher 的「已核准」？）
    // 實作：「公告發布」收件人為 student/teacher/ta/alumni → 老師會看到
    //       「已核准」收件人為 teacher → 老師會看到 success
    const teacherMsgs = getMessagesForRole('teacher');
    expect(teacherMsgs.find((m) => m.subject.includes('已核准'))).toBeDefined();
    expect(teacherMsgs.find((m) => m.subject.includes('公告發布'))).toBeDefined();
    // alumni 看得到公告發布
    expect(getMessagesForRole('alumni').find((m) => m.subject.includes('公告發布'))).toBeDefined();
    // guest 永遠看不到
    expect(getMessagesForRole('guest')).toHaveLength(0);
  });

  test('系主任退回 → 老師收到 warning 退件原因', () => {
    publishAnnouncement({ title: 't', content: 'x', teacherName: '張' });
    rejectAnnouncementWithReason({
      pendingId: 'pid',
      title: 't',
      approverName: '黃主任',
      reason: '格式錯誤',
    });
    const teacherMsgs = getMessagesForRole('teacher');
    const reject = teacherMsgs.find((m) => m.subject.includes('退回'));
    expect(reject).toBeDefined();
    expect(reject!.body).toContain('格式錯誤');
    expect(reject!.type).toBe('warning');
  });
});

describe('動作鏈 8：guest 永遠不收訊息', () => {
  test('guest 看不到任何 dynamic message', () => {
    seedDemoQueues();
    expect(getMessagesForRole('guest')).toHaveLength(0);
  });
});

describe('未讀計數與已讀標記', () => {
  test('seed 後每個角色未讀計數正確', () => {
    seedDemoQueues();
    // seed 後總共產生：請假(2 收件) + 報修(1) + 訂單(2) + 求助(2) + 作業(2) + 入社(1) + 公告(1)
    expect(getUnreadCount('student')).toBeGreaterThanOrEqual(1); // 學生會收到訂單確認
    expect(getUnreadCount('teacher')).toBeGreaterThanOrEqual(3); // 請假 + 求助 + 作業
    expect(getUnreadCount('department_head')).toBeGreaterThanOrEqual(2); // 請假 + 公告
    expect(getUnreadCount('admin')).toBeGreaterThanOrEqual(2); // 報修 + 訂單
    expect(getUnreadCount('club_officer')).toBeGreaterThanOrEqual(1); // 入社
    expect(getUnreadCount('ta')).toBeGreaterThanOrEqual(2); // 求助 + 作業
  });

  test('markDynamicMessageRead 後該訊息不再計入未讀', () => {
    requestLeave({
      studentId: STUDENT.id,
      studentName: STUDENT.name,
      reason: 'x',
      dateFrom: '1',
      dateTo: '1',
    });
    const before = getUnreadCount('teacher');
    const msg = getMessagesForRole('teacher')[0];
    markDynamicMessageRead(msg.id);
    expect(getUnreadCount('teacher')).toBe(before - 1);
  });
});

describe('角色權限隔離（reset 不洩漏）', () => {
  test('resetDemoStore 後所有角色都空', async () => {
    seedDemoQueues();
    await resetDemoStore();
    const roles = [
      'student',
      'teacher',
      'ta',
      'club_officer',
      'department_head',
      'admin',
      'alumni',
    ] as const;
    for (const r of roles) {
      expect(getMessagesForRole(r)).toHaveLength(0);
      expect(getUnreadCount(r)).toBe(0);
    }
  });
});

describe('seedDemoQueues 一鍵 seed 完整性', () => {
  test('七種動作鏈都至少產生一筆 store entry', () => {
    seedDemoQueues();
    const s = getDemoStore();
    expect(s.leaveRequests.length).toBeGreaterThanOrEqual(1);
    expect(s.dormRepairs.length).toBeGreaterThanOrEqual(1);
    expect(s.orders.length).toBeGreaterThanOrEqual(1);
    expect(s.helpRequests.length).toBeGreaterThanOrEqual(1);
    expect(s.submissions.length).toBeGreaterThanOrEqual(1);
    expect(s.clubMemberships.length).toBeGreaterThanOrEqual(1);
    // 公告 sendMessage 直接觸發，department_head 應該至少 1 則待審
    expect(getMessagesForRole('department_head').some((m) => m.relatedPendingAnnId)).toBe(true);
  });
});
