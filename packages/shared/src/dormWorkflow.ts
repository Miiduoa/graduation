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
  announcements?: Array<{ id: string; building: string; title: string; body: string }>;
  repairs: DormTicket[];
  leaves: DormLeave[];
  packages: DormStaffParcel[];
  residents: DormResident[];
};
export type DormWorkflowCall = <T>(data: Record<string, unknown>) => Promise<T>;
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
