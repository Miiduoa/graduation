/**
 * Action Graph — 跨角色 × 動作 × 下游影響地圖
 *
 * 給 AI、Inbox、Companion、Audit、口試簡報共用：
 *   queryActionGraph(role, action) → 哪些資料寫入、哪些其他角色看得到、
 *                                   哪些 companion signal、哪些 AI tool 觸發、
 *                                   哪些 inbox 卡片
 *
 * 純函式 / 純靜態資料；不寫 Firestore。
 */

export type Role = 'student' | 'teacher' | 'admin' | 'staff' | 'department_head' | 'vendor' | 'visitor';

export type DataEntity =
  | 'courseSpaces'
  | 'modules'
  | 'materials'
  | 'assignments'
  | 'submissions'
  | 'quizzes'
  | 'quizAttempts'
  | 'attendanceSessions'
  | 'attendanceRecords'
  | 'gradeItems'
  | 'gradebookEntries'
  | 'discussions'
  | 'rubrics'
  | 'questionBanks'
  | 'announcements'
  | 'orders'
  | 'menus'
  | 'dormRepairs'
  | 'leaveRequests'
  | 'libraryLoans'
  | 'librarySeats'
  | 'printJobs'
  | 'healthAppointments'
  | 'lostFoundItems'
  | 'inbox'
  | 'companionSignals'
  | 'companionUnlocks'
  | 'riskSnapshots'
  | 'auditLogs';

export interface ActionEffect {
  /** 此動作會「寫入」哪些 entity */
  writes: DataEntity[];
  /** 哪些角色能立即看到結果 */
  visibleTo: Role[];
  /** 觸發哪個 companion signal（對應 companionHooks 的 function） */
  companionSignal?: string;
  /** 觸發哪個 AI tool 重新計算 / 主動回報 */
  aiTrigger?: string;
  /** 寫入哪個 inbox kind */
  inboxKinds?: Array<'assignment' | 'quiz' | 'live' | 'group' | 'announcement' | 'achievement_unlock' | 'assistant_queue' | 'risk_alert'>;
  /** 對應 TronClass 端點（若有） */
  tronclassEndpoint?: string;
  /** 簡短說明，給文件 + AI 用 */
  notes?: string;
}

export interface ActionDef {
  role: Role;
  action: string;
  label: string;
  effect: ActionEffect;
}

// ─────────────────────────────────────────────────────────
// 30 個跨角色關鍵動作
// ─────────────────────────────────────────────────────────

export const ACTION_GRAPH: ActionDef[] = [
  // ─── Student ─────────────────────────────────────────
  {
    role: 'student',
    action: 'submit_assignment',
    label: '繳交作業',
    effect: {
      writes: ['submissions', 'inbox', 'companionSignals'],
      visibleTo: ['student', 'teacher'],
      companionSignal: 'onAssignmentSubmitted',
      aiTrigger: 'risk_radar',
      inboxKinds: ['assignment'],
      tronclassEndpoint: 'POST /courses/{id}/homework/{aid}/submissions',
      notes: '老師立即在 web 教師端看到 +1 繳交；學生 inbox 卡片變灰；植物 +growth；風險雷達該課的 missedAssignments -1',
    },
  },
  {
    role: 'student',
    action: 'take_quiz',
    label: '作答測驗（含自動計分）',
    effect: {
      writes: ['quizAttempts', 'gradebookEntries', 'companionSignals'],
      visibleTo: ['student', 'teacher'],
      companionSignal: 'onQuizAttempt',
      aiTrigger: 'risk_radar',
      inboxKinds: ['quiz'],
      tronclassEndpoint: 'POST /courses/{id}/quizzes/{qid}/attempts',
      notes: 'scoreQuizAttempt 直接算分；若有 essay 標 needsManualGrading；若 100% 解鎖滿分皇冠',
    },
  },
  {
    role: 'student',
    action: 'attendance_checkin',
    label: '掃 QR 簽到',
    effect: {
      writes: ['attendanceRecords', 'companionSignals'],
      visibleTo: ['student', 'teacher'],
      companionSignal: 'onAttendanceCheckin',
      aiTrigger: 'risk_radar',
      tronclassEndpoint: 'POST /courses/{id}/attendance/{sid}/check_in',
      notes: '老師 web 端即時看到出席率；連 5 工作日簽到 → 全勤光環',
    },
  },
  {
    role: 'student',
    action: 'read_material',
    label: '閱讀教材',
    effect: {
      writes: ['companionSignals'],
      visibleTo: ['student'],
      companionSignal: 'onMaterialRead',
      tronclassEndpoint: 'GET /materials/{id} (with progress callback)',
      notes: '該課植物 +growth；無 inbox 副作用',
    },
  },
  {
    role: 'student',
    action: 'order_meal',
    label: '點餐',
    effect: {
      writes: ['orders', 'companionSignals'],
      visibleTo: ['student', 'vendor'],
      companionSignal: 'onMealOrdered',
      notes: 'vendor 即時看到訂單；累積 10 家解鎖美食家',
    },
  },
  {
    role: 'student',
    action: 'borrow_book',
    label: '借書',
    effect: {
      writes: ['libraryLoans', 'companionSignals'],
      visibleTo: ['student', 'admin'],
      companionSignal: 'onLibraryBorrow',
      notes: '5 本 → 書蟲；管理員可看借閱統計',
    },
  },
  {
    role: 'student',
    action: 'reserve_seat',
    label: '預約圖書館座位',
    effect: {
      writes: ['librarySeats', 'companionSignals'],
      visibleTo: ['student', 'admin'],
      companionSignal: 'onLibrarySeatReserved',
    },
  },
  {
    role: 'student',
    action: 'submit_dorm_repair',
    label: '宿舍報修',
    effect: {
      writes: ['dormRepairs', 'inbox', 'companionSignals'],
      visibleTo: ['student', 'staff'],
      companionSignal: 'onDormRepairCreated',
      inboxKinds: ['assignment'],
      notes: '職員在服務頁看到新單；首次報修解鎖工具箱',
    },
  },
  {
    role: 'student',
    action: 'submit_leave_request',
    label: '請假申請',
    effect: {
      writes: ['leaveRequests', 'inbox'],
      visibleTo: ['student', 'teacher', 'department_head'],
      aiTrigger: 'getLeaveRequestStatus',
      inboxKinds: ['assistant_queue'],
      notes: '教師看到請假請求；系主任看本系待簽',
    },
  },
  {
    role: 'student',
    action: 'post_discussion',
    label: '在課程討論串發文',
    effect: {
      writes: ['discussions', 'companionSignals'],
      visibleTo: ['student', 'teacher'],
      companionSignal: 'onDiscussionPosted',
      inboxKinds: ['group'],
      notes: 'useful 5 次 → 助人之燈',
    },
  },
  {
    role: 'student',
    action: 'peer_review_given',
    label: '完成同儕互評',
    effect: {
      writes: ['submissions', 'companionSignals'],
      visibleTo: ['student'],
      companionSignal: 'onPeerReviewGiven',
      notes: '首次解鎖同儕勳章；雙方植物互相 +5%',
    },
  },
  {
    role: 'student',
    action: 'send_encouragement',
    label: '送鼓勵雲給同學',
    effect: {
      writes: ['inbox', 'companionSignals'],
      visibleTo: ['student'],
      companionSignal: 'onEncouragementSent',
      inboxKinds: ['group'],
      notes: '收方 vitality +2；10 次 → 鼓勵守護者',
    },
  },
  {
    role: 'student',
    action: 'harvest_plant',
    label: '採收學期植物',
    effect: {
      writes: ['companionSignals', 'companionUnlocks'],
      visibleTo: ['student'],
      companionSignal: 'onPlantHarvested',
      notes: '需 termEnded + 通過 + 健康 ≥ 60；換成知識點',
    },
  },
  {
    role: 'student',
    action: 'view_credit_audit',
    label: '查學分試算',
    effect: {
      writes: ['companionSignals'],
      visibleTo: ['student'],
      companionSignal: 'onCreditAuditViewed',
      notes: '加 lifeScore；不直接解鎖',
    },
  },
  {
    role: 'student',
    action: 'inbox_action_taken',
    label: '從收件匣執行任務',
    effect: {
      writes: ['inbox', 'companionSignals'],
      visibleTo: ['student'],
      companionSignal: 'onInboxActionTaken',
    },
  },
  // ─── Teacher ─────────────────────────────────────────
  {
    role: 'teacher',
    action: 'publish_assignment',
    label: '發布作業',
    effect: {
      writes: ['assignments', 'inbox'],
      visibleTo: ['teacher', 'student'],
      aiTrigger: 'getAssignments',
      inboxKinds: ['assignment'],
      tronclassEndpoint: 'POST /courses/{id}/homework',
      notes: '所有修課學生 inbox 跳新卡片；植物 budding 加速',
    },
  },
  {
    role: 'teacher',
    action: 'publish_quiz',
    label: '發布測驗',
    effect: {
      writes: ['quizzes', 'inbox'],
      visibleTo: ['teacher', 'student'],
      inboxKinds: ['quiz'],
      tronclassEndpoint: 'POST /courses/{id}/quizzes',
    },
  },
  {
    role: 'teacher',
    action: 'open_attendance',
    label: '開啟點名',
    effect: {
      writes: ['attendanceSessions', 'inbox'],
      visibleTo: ['teacher', 'student'],
      inboxKinds: ['live'],
      tronclassEndpoint: 'POST /courses/{id}/attendance',
      notes: '學生 mobile inbox 即時跳出「去簽到」卡片',
    },
  },
  {
    role: 'teacher',
    action: 'grade_submission',
    label: '批改作業 (Rubric)',
    effect: {
      writes: ['submissions', 'gradebookEntries'],
      visibleTo: ['teacher', 'student'],
      aiTrigger: 'computeGradebook',
      tronclassEndpoint: 'PATCH /submissions/{id}',
      notes: 'rubricScoring → 寫入 gradebook → 學生 inbox 看到「成績已發布」',
    },
  },
  {
    role: 'teacher',
    action: 'upsert_rubric',
    label: '建立 / 修改 Rubric',
    effect: {
      writes: ['rubrics'],
      visibleTo: ['teacher'],
      aiTrigger: 'upsertRubric',
    },
  },
  {
    role: 'teacher',
    action: 'upsert_question_bank',
    label: '建立 / 修改題庫',
    effect: {
      writes: ['questionBanks'],
      visibleTo: ['teacher'],
      aiTrigger: 'upsertQuestionBank',
    },
  },
  {
    role: 'teacher',
    action: 'draft_quiz_from_bank',
    label: '從題庫抽題建測驗',
    effect: {
      writes: ['quizzes'],
      visibleTo: ['teacher'],
      aiTrigger: 'draftQuizFromBank',
    },
  },
  {
    role: 'teacher',
    action: 'publish_announcement',
    label: '發布課程公告',
    effect: {
      writes: ['announcements', 'inbox'],
      visibleTo: ['teacher', 'student'],
      inboxKinds: ['announcement'],
      tronclassEndpoint: 'POST /courses/{id}/announcements',
    },
  },
  {
    role: 'teacher',
    action: 'publish_grades',
    label: '發布最終成績',
    effect: {
      writes: ['gradebookEntries', 'inbox'],
      visibleTo: ['teacher', 'student'],
      aiTrigger: 'computeGradebook',
      inboxKinds: ['announcement'],
      notes: '學生植物若達 fruiting → 立即可採收',
    },
  },
  // ─── Admin ───────────────────────────────────────────
  {
    role: 'admin',
    action: 'approve_vendor',
    label: '審核店家',
    effect: {
      writes: ['menus', 'inbox', 'auditLogs'],
      visibleTo: ['admin', 'vendor', 'student'],
      inboxKinds: ['announcement'],
    },
  },
  {
    role: 'admin',
    action: 'publish_school_announcement',
    label: '發布全校公告',
    effect: {
      writes: ['announcements', 'inbox'],
      visibleTo: ['admin', 'student', 'teacher', 'staff', 'department_head'],
      inboxKinds: ['announcement'],
    },
  },
  // ─── Staff ───────────────────────────────────────────
  {
    role: 'staff',
    action: 'process_dorm_repair',
    label: '處理宿舍報修',
    effect: {
      writes: ['dormRepairs', 'inbox'],
      visibleTo: ['staff', 'student'],
      inboxKinds: ['assignment'],
    },
  },
  // ─── Department Head ─────────────────────────────────
  {
    role: 'department_head',
    action: 'approve_leave',
    label: '簽核請假',
    effect: {
      writes: ['leaveRequests', 'inbox'],
      visibleTo: ['department_head', 'teacher', 'student'],
      inboxKinds: ['assistant_queue'],
    },
  },
  // ─── Vendor ──────────────────────────────────────────
  {
    role: 'vendor',
    action: 'update_menu',
    label: '更新菜單',
    effect: {
      writes: ['menus'],
      visibleTo: ['vendor', 'student', 'admin'],
    },
  },
  {
    role: 'vendor',
    action: 'accept_order',
    label: '接訂單',
    effect: {
      writes: ['orders', 'inbox'],
      visibleTo: ['vendor', 'student'],
      inboxKinds: ['assistant_queue'],
    },
  },
];

// ─────────────────────────────────────────────────────────
// 查詢 API
// ─────────────────────────────────────────────────────────

export function queryActionGraph(role: Role, action: string): ActionDef | null {
  return ACTION_GRAPH.find((a) => a.role === role && a.action === action) ?? null;
}

export function listActionsByRole(role: Role): ActionDef[] {
  return ACTION_GRAPH.filter((a) => a.role === role);
}

export function listActionsAffectingRole(role: Role): ActionDef[] {
  return ACTION_GRAPH.filter((a) => a.effect.visibleTo.includes(role));
}

export function listActionsWritingEntity(entity: DataEntity): ActionDef[] {
  return ACTION_GRAPH.filter((a) => a.effect.writes.includes(entity));
}

export function listActionsTriggeringSignal(signalFn: string): ActionDef[] {
  return ACTION_GRAPH.filter((a) => a.effect.companionSignal === signalFn);
}

/**
 * 把某個動作的下游連鎖反應展開（給文件/口試簡報用）
 */
export function explainActionChain(role: Role, action: string): {
  primary: ActionDef | null;
  downstreamCompanion: string | null;
  downstreamAi: string | null;
  affectedRoles: Role[];
  inboxToSend: string[];
} {
  const def = queryActionGraph(role, action);
  return {
    primary: def,
    downstreamCompanion: def?.effect.companionSignal ?? null,
    downstreamAi: def?.effect.aiTrigger ?? null,
    affectedRoles: def?.effect.visibleTo ?? [],
    inboxToSend: def?.effect.inboxKinds ?? [],
  };
}
