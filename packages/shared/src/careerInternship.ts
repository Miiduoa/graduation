/** Approval-isolated internship contract; no production entry point exports this module. */
export const INTERNSHIP_STEPS = ['申請', '計畫書', '時數登錄', '成果報告', '指導老師確認'] as const;
export type InternshipAudience = 'student' | 'staff' | 'ops';
export type InternshipRule = {
  id: string;
  revision: number;
  department: string;
  term: string;
  credits: number;
  hoursPerCredit: number;
  sourceUrl: string;
  applicationUrl: string;
  documents: { title: string; recipient: string; deadline: string }[];
};
export type InternshipDocument = {
  submitted: boolean;
  url: string;
  verified: boolean;
  message: string;
};
export type InternshipRecord = {
  id: string;
  revision: number;
  uid: string;
  rule: InternshipRule;
  organization: string;
  teacher: string;
  teacherUid: string;
  hours: { id: string; date: string; hours: number; note: string; verified: boolean }[];
  documents: InternshipDocument[];
  confirmed: boolean;
  updatedAt: string;
};
export type InternshipAudit = { id: string; action: string; targetId: string; at: string };
export type InternshipSnapshot = {
  rules: InternshipRule[];
  records: InternshipRecord[];
  audit: InternshipAudit[];
};
export type InternshipCommand =
  | { action: 'list'; audience: InternshipAudience }
  | { action: 'rule'; rule: InternshipRule }
  | {
      action: 'create';
      id: string;
      ruleId: string;
      ruleRevision: number;
      organization: string;
      teacher: string;
      teacherUid: string;
    }
  | {
      action: 'hours';
      id: string;
      revision: number;
      entry: { id: string; date: string; hours: number; note: string };
    }
  | {
      action: 'document';
      id: string;
      revision: number;
      index: number;
      url: string;
      submitted: boolean;
    }
  | { action: 'removeHours'; id: string; revision: number; entryId: string }
  | { action: 'verifyHours'; id: string; revision: number; entryId: string; verified: boolean }
  | {
      action: 'verifyDocument';
      id: string;
      revision: number;
      index: number;
      verified: boolean;
      message: string;
    }
  | { action: 'confirm'; id: string; revision: number };
export type InternshipReply = { snapshot?: InternshipSnapshot; id?: string };
export type InternshipTransport = (
  schoolId: string,
  command: InternshipCommand,
) => Promise<InternshipReply>;
export function createInternshipService(schoolId: string, transport: InternshipTransport) {
  return {
    async load(audience: InternshipAudience) {
      const reply = await transport(schoolId, { action: 'list', audience });
      if (!reply.snapshot) throw new Error('實習資料不完整，請重新整理。');
      return reply.snapshot;
    },
    execute: (command: Exclude<InternshipCommand, { action: 'list' }>) =>
      transport(schoolId, command),
  };
}
export type InternshipService = ReturnType<typeof createInternshipService>;
export function internshipProgress(record: InternshipRecord) {
  const required = record.rule.credits * record.rule.hoursPerCredit;
  const logged = record.hours.reduce((sum, h) => sum + h.hours, 0);
  const verified = record.hours.filter((h) => h.verified).reduce((sum, h) => sum + h.hours, 0);
  const next = record.rule.documents.findIndex((_, i) => !record.documents[i]?.verified);
  const step = record.confirmed
    ? 5
    : next === 0
      ? 0
      : next === 1
        ? 1
        : verified < required
          ? 2
          : next >= 0
            ? 3
            : 4;
  return {
    required,
    logged,
    verified,
    percent: Math.min(100, (logged / required) * 100),
    next,
    step,
  };
}
export function internshipDeadlineState(deadline: string, now = Date.now()) {
  const remaining = Date.parse(deadline) - now;
  return remaining < 0 ? '已逾期' : remaining <= 7 * 86400000 ? '七天內到期' : '待繳交';
}
/** Hand off to the existing calendar host; deterministic id supports deduplication there. */
export function internshipCalendarItem(record: InternshipRecord, index: number) {
  const doc = record.rule.documents[index];
  return {
    id: `internship-${record.id}-${index}`,
    title: `實習：${doc.title}`,
    startsAt: doc.deadline,
    endsAt: new Date(Date.parse(doc.deadline) + 30 * 60000).toISOString(),
    description: `交給：${doc.recipient}\n來源：${record.rule.sourceUrl}`,
    sourceUrl: record.rule.sourceUrl,
  };
}
export type InternshipCalendarItem = ReturnType<typeof internshipCalendarItem>;

export function createInternshipCallableTransport({
  endpoint,
  authHeaders,
  fetcher = fetch,
}: {
  endpoint: string;
  authHeaders: () => Promise<Record<string, string>>;
  fetcher?: typeof fetch;
}): InternshipTransport {
  return async (schoolId, command) => {
    const response = await fetcher(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
      body: JSON.stringify({ data: { ...command, schoolId } }),
    });
    const body = (await response.json()) as {
      result?: InternshipReply;
      error?: { message?: string };
    };
    if (!response.ok || body.error || !body.result)
      throw new Error(body.error?.message || '實習服務暫時無法使用，請稍後重試。');
    return body.result;
  };
}
