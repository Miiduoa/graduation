export const DORM_TICKET_LABELS = {
  sent: '已送給輔導員',
  received: '輔導員已收到',
  scheduled: '已安排維修',
  fixed: '已修好，請確認',
  closed: '已結案',
} as const;
export const DORM_LEAVE_LABELS = {
  pending: '待核可',
  approved: '已核可',
  rejected: '不核可',
} as const;
export type DormTicketStatus = keyof typeof DORM_TICKET_LABELS;
export type DormLeaveStatus = keyof typeof DORM_LEAVE_LABELS;
export type DormWorkflowConfig = {
  enabled: boolean;
  repairs: boolean;
  packages: boolean;
  admin: boolean;
  role: 'dorm_staff' | 'student';
};
export type DormTicket = {
  id: string;
  title: string;
  description: string;
  dormitory: string;
  room: string;
  dormStatus: DormTicketStatus;
  schoolReference?: string;
  vendor?: string;
  expectedDate?: string;
  history: Array<{ status: DormTicketStatus; at: number }>;
  /** Photo indices only; resolve via the authorized repairPhoto callable. */
  images?: string[];
};
export type DormLeave = {
  applicantName?: string;
  maskedStudentId?: string;
  id: string;
  building: string;
  room: string;
  date: string;
  reason: string;
  status: DormLeaveStatus;
  history: Array<{ status: DormLeaveStatus; at: number }>;
};
export type DormResident = {
  id: string;
  /** Masked for display; use id for resident selection. */
  studentId: string;
  name: string;
  building: string;
  room: string;
  bed: string;
};
export type DormStaffParcel = {
  id: string;
  /** Masked for display. */
  studentId: string;
  building: string;
  description: string;
  location: string;
  status: string;
  arrivedAt: number | { _seconds: number };
};
export type DormWorkflowRows = {
  nextCursors?: Record<string, string | null>;
  announcements?: Array<{ id: string; building: string; title: string; body: string; publishedAt?: number }>;
  repairs: DormTicket[];
  leaves: DormLeave[];
  packages: DormStaffParcel[];
  residents: DormResident[];
};
export type DormWorkflowCall = <T>(data: Record<string, unknown>) => Promise<T>;
export function dormAnnouncementDraftError(building: string, title: string, body: string): string | null {
  if (!building.trim()) return '請填寫要發布公告的棟別。';
  if (building.trim().length > 70) return '棟別最多可輸入 70 個字。';
  if (!title.trim()) return '請填寫公告標題。';
  if (title.trim().length > 120) return '公告標題最多可輸入 120 個字。';
  if (!body.trim()) return '請填寫公告內容。';
  if (body.trim().length > 2000) return '公告內容最多可輸入 2,000 個字。';
  return null;
}
export type DormAnnouncementReceipt = {
  recipients?: number;
  acceptedRecipients?: number;
  pendingRecipients?: number;
  unconfirmedRecipients?: number;
};
/** Continue a confirmed publication while its saved audience is making progress. */
export async function deliverDormAnnouncementBatches<T extends DormAnnouncementReceipt>(
  send: () => Promise<T>,
  isCurrent: () => boolean,
  onProgress: (receipt: T) => void,
): Promise<T> {
  let receipt = await send();
  let lastPending = Infinity;
  while (isCurrent() && receipt.pendingRecipients !== undefined && receipt.pendingRecipients > 0) {
    onProgress(receipt);
    const pending = receipt.pendingRecipients;
    if (pending >= lastPending) break;
    lastPending = pending;
    receipt = await send();
  }
  return receipt;
}
export function dormAnnouncementReceipt(result: DormAnnouncementReceipt): string {
  const { recipients, acceptedRecipients, pendingRecipients = 0, unconfirmedRecipients = 0 } = result;
  // Earlier servers counted resolved push calls, including skipped deliveries.
  if (recipients === undefined || acceptedRecipients === undefined)
    return '公告已發布，可在宿舍頁查看。推播結果尚未確認。';
  if (recipients === 0) return '公告已發布，目前本棟名冊沒有可通知的住宿生。';
  if (pendingRecipients || unconfirmedRecipients) {
    const parts = [`公告已發布。名冊共 ${recipients} 人，推播服務已受理 ${acceptedRecipients} 人。`];
    if (pendingRecipients) parts.push(`還有 ${pendingRecipients} 人待處理。`);
    if (unconfirmedRecipients) parts.push(`另有 ${unconfirmedRecipients} 人的推播結果尚未確認。`);
    return parts.join('');
  }
  if (acceptedRecipients === 0) return '公告已發布，目前沒有推播受理紀錄。';
  return `公告已發布。名冊共 ${recipients} 人，推播服務已受理其中 ${acceptedRecipients} 人的通知。`;
}
export function formatDormWorkflowTime(at: number): string {
  return new Date(at).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false });
}
export function dormAnnouncementPublishedTime(at?: number): string {
  if (!at || at < 0 || !Number.isFinite(new Date(at).getTime())) return '發布時間未提供';
  return `發布於 ${formatDormWorkflowTime(at)}`;
}
export function dormWorkdaysSince(at: number, now = Date.now()): number {
  let days = 0;
  const date = new Date(at + 8 * 3600000),
    end = new Date(now + 8 * 3600000);
  date.setUTCHours(0, 0, 0, 0);
  end.setUTCHours(0, 0, 0, 0);
  while (date < end) {
    date.setUTCDate(date.getUTCDate() + 1);
    if (![0, 6].includes(date.getUTCDay())) days++;
  }
  return days;
}
export function dormTicketOverdue(ticket: DormTicket, now = Date.now()): boolean {
  const latest = [...ticket.history].reverse().find((h) => h.status === 'sent');
  return (
    ['sent', 'received'].includes(ticket.dormStatus) &&
    !!latest &&
    dormWorkdaysSince(latest.at, now) > 3
  );
}
export function parseDormResidentsCsv(
  csv: string,
): Array<{ studentId: string; building: string; room: string; bed: string }> {
  const lines = csv
    .replace(/^\uFEFF/, '')
    .trim()
    .split(/\r?\n/)
    .filter(Boolean);
  if (/學號|studentId/.test(lines[0] || '')) lines.shift();
  const seen = new Set<string>();
  return lines.map((line) => {
    const parts = line.split(',').map((v) => v.trim());
    if (parts.length !== 4 || parts.some((v) => !v || /["\n]/.test(v)) || seen.has(parts[0]))
      throw new Error('CSV 需要不重複的學號、棟、房、床四欄');
    seen.add(parts[0]);
    return { studentId: parts[0], building: parts[1], room: parts[2], bed: parts[3] };
  });
}
export function dormRequestKey(): string {
  return Date.now().toString(36) + '_' + Math.random().toString(36).slice(2);
}
export function dormWorkflowSummary(rows: DormWorkflowRows): string {
  // Counts only: safe to project or share without student identities.
  return (
    '宿舍,待領包裹,處理中報修,待核可外宿\n' +
    [
      ...new Set([
        ...rows.repairs.map((r) => r.dormitory),
        ...rows.packages.map((p) => p.building),
        ...rows.leaves.map((l) => l.building),
      ]),
    ]
      .sort()
      .map((b) =>
        [
          b,
          rows.packages.filter((p) => p.building === b && p.status === 'waiting').length,
          rows.repairs.filter((r) => r.dormitory === b && r.dormStatus !== 'closed').length,
          rows.leaves.filter((l) => l.building === b && l.status === 'pending').length,
        ]
          .map(
            (x) =>
              '"' +
              String(x)
                .replace(/"/g, '""')
                .replace(/^[=+@-]/, "'") +
              '"',
          )
          .join(','),
      )
      .join('\n')
  );
}
