import type { AssistantChoiceMenu } from '../data/types';
import {
  emitLeaveDecision,
  loadVisibleRoleEventInbox,
  type LeaveRequestedPayload,
  type RoleEvent,
} from './roleEventBus';
import {
  decideLeave,
  getDemoStore,
  hydrateDemoStore,
  type StoreLeaveRequest,
} from './demoStore';

export type LeaveReviewDecision = 'approved' | 'rejected';

type LeaveReviewCandidate = {
  leaveId: string;
  studentUid?: string;
  studentName: string;
  courseId: string | number;
  courseName: string;
  fromDate: string;
  toDate: string;
  reason: string;
  source: 'role_event' | 'demo_store';
};

export type DemoLeaveReviewResult = {
  handled: boolean;
  success: boolean;
  summary: string;
  isWrite: boolean;
  data?: unknown;
  choiceMenu?: AssistantChoiceMenu;
};

const REVIEW_WORDS = /審核|核准|批准|同意|通過|退回|駁回|拒絕|不准|請假單|假單|leave/i;

export function isLeaveReviewIntent(message: string): boolean {
  const text = message.trim();
  return /請假|假單|leave/i.test(text) && REVIEW_WORDS.test(text);
}

export function detectLeaveReviewDecision(
  message: string,
  explicit?: unknown,
): LeaveReviewDecision | null {
  const raw = String(explicit ?? '').toLowerCase();
  if (raw === 'approved' || raw === 'approve' || raw === '核准') return 'approved';
  if (raw === 'rejected' || raw === 'reject' || raw === '退回' || raw === '駁回') return 'rejected';
  if (/退回|駁回|拒絕|不准|reject|rejected/i.test(message)) return 'rejected';
  if (/核准|批准|同意|通過|approve|approved/i.test(message)) return 'approved';
  return null;
}

export function canReviewLeave(role?: string | null): boolean {
  return (
    role === 'teacher' ||
    role === 'professor' ||
    role === 'department_head' ||
    role === 'principal' ||
    role === 'admin' ||
    role === 'school'
  );
}

function fromStore(row: StoreLeaveRequest): LeaveReviewCandidate {
  return {
    leaveId: row.id,
    studentUid: row.studentId,
    studentName: row.studentName,
    courseId: row.courseId ?? 'demo-leave',
    courseName: row.courseId ? `課程 ${row.courseId}` : '一般請假',
    fromDate: row.dateFrom,
    toDate: row.dateTo,
    reason: row.reason,
    source: 'demo_store',
  };
}

function fromEvent(event: RoleEvent<LeaveRequestedPayload>): LeaveReviewCandidate {
  return {
    leaveId: event.payload.leaveId,
    studentUid: event.actorUid,
    studentName: event.payload.studentName,
    courseId: event.courseId,
    courseName: event.courseName,
    fromDate: event.payload.fromDate,
    toDate: event.payload.toDate,
    reason: event.payload.reason,
    source: 'role_event',
  };
}

function formatCandidate(candidate: LeaveReviewCandidate, index: number): string {
  return `${index + 1}. ${candidate.studentName}｜${candidate.courseName}｜${candidate.fromDate}${candidate.toDate !== candidate.fromDate ? ` ~ ${candidate.toDate}` : ''}｜${candidate.reason}`;
}

function selectCandidate(
  candidates: LeaveReviewCandidate[],
  args: { leaveId?: unknown; studentName?: unknown; message: string },
): LeaveReviewCandidate | null {
  const leaveId = String(args.leaveId ?? '').trim();
  if (leaveId) {
    const byId = candidates.find((candidate) => candidate.leaveId === leaveId);
    if (byId) return byId;
  }
  const studentName = String(args.studentName ?? '').trim();
  if (studentName) {
    const byStudent = candidates.find((candidate) => candidate.studentName.includes(studentName));
    if (byStudent) return byStudent;
  }
  const msgHit = candidates.find((candidate) => args.message.includes(candidate.studentName));
  if (msgHit) return msgHit;
  const ordinal = parseOrdinal(args.message);
  if (ordinal != null && candidates[ordinal - 1]) return candidates[ordinal - 1];
  return candidates.length === 1 ? candidates[0] : null;
}

function parseOrdinal(message: string): number | null {
  const cn: Record<string, number> = {
    一: 1,
    二: 2,
    兩: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
    十: 10,
  };
  const hit = message.match(/第\s*([一二兩三四五六七八九十\d]+)\s*(?:張|個|筆)?/);
  if (!hit) return null;
  const value = cn[hit[1]] ?? Number(hit[1]);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function buildChoiceMenu(
  candidates: LeaveReviewCandidate[],
  decision: LeaveReviewDecision | null,
): AssistantChoiceMenu {
  return {
    title: '待審請假單',
    prompt: decision ? '請選擇要處理哪一張假單。' : '請選擇假單與審核結果。',
    producedByTool: 'review_leave',
    options: candidates.slice(0, 8).flatMap((candidate, index) => {
      const label = `${candidate.studentName}｜${candidate.fromDate}`;
      const subtitle = `${candidate.courseName}｜${candidate.reason}`;
      if (decision) {
        return [
          {
            id: `${candidate.leaveId}:${decision}`,
            label,
            subtitle,
            sendAsUser: `${decision === 'approved' ? '核准' : '退回'} ${candidate.studentName} 的請假單 ${candidate.leaveId}`,
          },
        ];
      }
      return [
        {
          id: `${candidate.leaveId}:approved:${index}`,
          label: `核准 ${label}`,
          subtitle,
          sendAsUser: `核准 ${candidate.studentName} 的請假單 ${candidate.leaveId}`,
        },
        {
          id: `${candidate.leaveId}:rejected:${index}`,
          label: `退回 ${label}`,
          subtitle,
          sendAsUser: `退回 ${candidate.studentName} 的請假單 ${candidate.leaveId}`,
        },
      ];
    }),
  };
}

export async function reviewDemoLeaveRequest(params: {
  reviewerUid?: string | null;
  reviewerName?: string | null;
  reviewerRole?: string | null;
  message: string;
  leaveId?: unknown;
  decision?: unknown;
  studentName?: unknown;
  note?: unknown;
}): Promise<DemoLeaveReviewResult> {
  if (!isLeaveReviewIntent(params.message)) {
    return { handled: false, success: false, summary: '', isWrite: false };
  }
  if (!canReviewLeave(params.reviewerRole)) {
    return {
      handled: true,
      success: false,
      isWrite: false,
      summary: '目前角色沒有請假審核權限。學生可以送出請假；老師、系主任或管理員才能審核假單。',
    };
  }

  const reviewerUid = params.reviewerUid ?? 'demo_teacher_chang';
  const reviewerRole = params.reviewerRole ?? 'teacher';
  await hydrateDemoStore().catch(() => undefined);

  const storeLeaves = getDemoStore()
    .leaveRequests
    .filter((leave) => leave.status === 'pending')
    .map(fromStore);
  const events = await loadVisibleRoleEventInbox({
    uid: reviewerUid,
    role: reviewerRole,
  }).catch(() => [] as RoleEvent<unknown>[]);
  const eventLeaves = events
    .filter((event): event is RoleEvent<LeaveRequestedPayload> => event.kind === 'leave_requested')
    .map(fromEvent);
  const storeStatusById = new Map(getDemoStore().leaveRequests.map((leave) => [leave.id, leave.status]));
  const byId = new Map<string, LeaveReviewCandidate>();
  for (const candidate of [...eventLeaves, ...storeLeaves]) {
    if (storeStatusById.get(candidate.leaveId) && storeStatusById.get(candidate.leaveId) !== 'pending') {
      continue;
    }
    if (!byId.has(candidate.leaveId)) byId.set(candidate.leaveId, candidate);
  }
  const candidates = Array.from(byId.values());

  if (candidates.length === 0) {
    return {
      handled: true,
      success: true,
      isWrite: false,
      summary: '目前沒有待審請假單。若學生剛送出，請切到教師訊息或教師工作台重新整理一次。',
    };
  }

  const decision = detectLeaveReviewDecision(params.message, params.decision);
  const selected = selectCandidate(candidates, {
    leaveId: params.leaveId,
    studentName: params.studentName,
    message: params.message,
  });

  if (!decision || !selected) {
    return {
      handled: true,
      success: true,
      isWrite: false,
      summary: [
        `目前有 ${candidates.length} 張待審請假單：`,
        '',
        candidates.map(formatCandidate).join('\n'),
        '',
        decision ? '請指定要處理哪一張。' : '你可以說「核准第 1 張」或「退回顧晉瑋的假單」。',
      ].join('\n'),
      choiceMenu: buildChoiceMenu(candidates, decision),
    };
  }

  if (selected.source === 'demo_store') {
    decideLeave({
      leaveId: selected.leaveId,
      decision,
      decidedBy: params.reviewerName ?? 'demo 老師',
      note: String(params.note ?? '').trim() || undefined,
    });
  }

  await emitLeaveDecision({
    actorUid: reviewerUid,
    actorName: params.reviewerName ?? 'demo 老師',
    targetUids: selected.studentUid ? [selected.studentUid] : undefined,
    courseId: selected.courseId,
    courseName: selected.courseName,
    payload: {
      leaveId: selected.leaveId,
      decision,
      message:
        String(params.note ?? '').trim() ||
        (decision === 'approved' ? '請假已核准。' : '請假已退回，請補充原因或附件。'),
      decidedBy: params.reviewerName ?? 'demo 老師',
    },
  });

  return {
    handled: true,
    success: true,
    isWrite: true,
    data: { leaveId: selected.leaveId, decision, studentUid: selected.studentUid },
    summary: `${decision === 'approved' ? '已核准' : '已退回'} ${selected.studentName} 的請假單（${selected.courseName}，${selected.fromDate}）。學生端會收到審核結果。`,
  };
}
