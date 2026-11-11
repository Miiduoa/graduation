import { NuniError, nuniRecord } from '@campus/shared/src/nuni';

export type AdminReviewState = 'pending' | 'approved' | 'rejected';

export type AdminSchoolApplication = {
  id: string;
  state: AdminReviewState;
  displayName: string;
  proposedTenantId: string;
  proposedEmailDomain: string;
  contactName: string;
  contactEmail: string;
  justification: string;
  tenantId: string | null;
  tenantState: 'provisioned' | 'open' | 'suspended' | null;
  createdAt: string;
  decidedAt: string | null;
};

export type AdminAffiliationApplication = {
  id: string;
  workspaceId: string;
  workspaceTitle: string;
  tenantId: string;
  sectionId: string | null;
  justification: string;
  state: AdminReviewState;
  createdAt: string;
  decidedAt: string | null;
  decisionReason: string | null;
};

const states = ['pending', 'approved', 'rejected'] as const;

export const adminReviewStateLabels: Record<AdminReviewState, string> = {
  pending: '待審核',
  approved: '已核准',
  rejected: '未通過',
};

function invalid(): never {
  throw new NuniError(502, 'INVALID_RESPONSE');
}

function text(value: unknown): string {
  return typeof value === 'string' && value.trim() ? value : invalid();
}

function nullableText(value: unknown): string | null {
  return value === null ? null : text(value);
}

function id(value: unknown): string {
  const result = text(value);
  return /^[A-Za-z0-9_-]{1,120}$/.test(result) ? result : invalid();
}

function tenant(value: unknown): string {
  const result = text(value);
  return /^[a-z0-9][a-z0-9-]{0,78}[a-z0-9]$/.test(result) ? result : invalid();
}

function date(value: unknown): string {
  const result = text(value);
  return Number.isFinite(Date.parse(result)) ? result : invalid();
}

function enumeration<T extends string>(value: unknown, allowed: readonly T[]): T {
  return typeof value === 'string' && allowed.includes(value as T) ? (value as T) : invalid();
}

function reviewFields(row: Record<string, unknown>) {
  const state = enumeration(row.state, states);
  const createdAt = date(row.createdAt);
  const decidedAt = row.decidedAt === null ? null : date(row.decidedAt);
  if ((state === 'pending') !== (decidedAt === null)) invalid();
  return { state, createdAt, decidedAt };
}

function applications<T extends { id: string }>(value: unknown, parse: (row: unknown) => T): T[] {
  const rows = nuniRecord(value).applications;
  if (!Array.isArray(rows)) invalid();
  const result = rows.map(parse);
  if (new Set(result.map((row) => row.id)).size !== result.length) invalid();
  return result;
}

// Projection contracts: deploy/nuni-api/source.json's pinned school-onboarding
// and class-workspace-affiliation services. A malformed list is not an empty queue.
export function parseSchoolApplication(value: unknown): AdminSchoolApplication {
  const row = nuniRecord(value);
  const result: AdminSchoolApplication = {
    id: id(row.id),
    ...reviewFields(row),
    displayName: text(row.displayName),
    proposedTenantId: tenant(row.proposedTenantId),
    proposedEmailDomain: text(row.proposedEmailDomain),
    contactName: text(row.contactName),
    contactEmail: text(row.contactEmail),
    justification: text(row.justification),
    tenantId: row.tenantId === null ? null : tenant(row.tenantId),
    tenantState:
      row.tenantState === null
        ? null
        : enumeration(row.tenantState, ['provisioned', 'open', 'suspended'] as const),
  };
  if ((result.tenantId === null) !== (result.tenantState === null)) invalid();
  if (result.state === 'approved' && result.tenantId === null) invalid();
  return result;
}

export function parseSchoolApplications(value: unknown): AdminSchoolApplication[] {
  return applications(value, parseSchoolApplication);
}

export function parseAffiliationApplication(value: unknown): AdminAffiliationApplication {
  const row = nuniRecord(value);
  return {
    id: id(row.id),
    workspaceId: id(row.workspaceId),
    workspaceTitle: text(row.workspaceTitle),
    tenantId: tenant(row.tenantId),
    sectionId: nullableText(row.sectionId),
    justification: text(row.justification),
    ...reviewFields(row),
    decisionReason: nullableText(row.decisionReason),
  };
}

export function parseAffiliationApplications(value: unknown): AdminAffiliationApplication[] {
  return applications(value, parseAffiliationApplication);
}
