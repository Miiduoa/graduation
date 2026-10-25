import { NuniError, nuniRecord } from '@campus/shared/src/nuni';

export type OversightTenantState = 'provisioned' | 'open' | 'suspended';
export type OversightPersonRole = 'school_admin' | 'school_staff';
export type OversightPersonState = 'active' | 'suspended' | 'revoked';
export type OversightMerchantMode = 'full' | 'showcase_link' | 'info_only';
export type OversightLocationStatus = 'open' | 'closed' | 'suspended';
export type OversightInterestState = 'submitted' | 'approved' | 'rejected';

export type OversightPerson = {
  personId: string;
  displayName: string;
  email: string | null;
  role: OversightPersonRole;
  roleLabel: string;
  state: OversightPersonState;
  stateLabel: string;
};

export type OversightPeople = {
  tenantId: string;
  displayName: string;
  tenantState: OversightTenantState;
  hasRoleAdmin: boolean;
  roleAdmins: Array<{ personId: string; displayName: string }>;
  people: OversightPerson[];
  honesty: string;
};

export type OversightMerchantInterest = {
  id: string;
  brandName: string;
  schoolName: string;
  contactName: string;
  contactEmail: string;
  note: string | null;
  state: OversightInterestState;
  createdAt: string;
  decidedAt: string | null;
};

export type OversightMerchantApplication = {
  tenantId: string;
  tenantName: string;
  applicationId: string;
  brandName: string;
  locationName: string;
  contactName: string;
  contactEmail: string;
  state: string;
  version: number;
  submittedAt: string;
};

export type OversightMerchantCatalogRow = {
  tenantId: string;
  tenantName: string;
  locationId: string;
  locationName: string;
  merchantMode: OversightMerchantMode;
  merchantModeLabel: string;
  sourceLabel: string;
  sourceUpdatedAt: string | null;
  published: boolean;
  locationStatus: OversightLocationStatus;
  publicAccess: boolean;
};

export type OversightMerchants = {
  interest: OversightMerchantInterest[];
  applications: OversightMerchantApplication[];
  catalog: OversightMerchantCatalogRow[];
  honesty: string;
};

const tenantStates = ['provisioned', 'open', 'suspended'] as const;
const personRoles = ['school_admin', 'school_staff'] as const;
const personStates = ['active', 'suspended', 'revoked'] as const;
const merchantModes = ['full', 'showcase_link', 'info_only'] as const;
const locationStatuses = ['open', 'closed', 'suspended'] as const;
const interestStates = ['submitted', 'approved', 'rejected'] as const;

const interestStateLabels: Record<OversightInterestState, string> = {
  submitted: '待審核',
  approved: '已核准',
  rejected: '未通過',
};

const applicationStateLabels: Record<string, string> = {
  submitted: '待審核',
  'under-review': '審核中',
  'needs-information': '待補件',
  approved: '已核准',
  rejected: '未通過',
  withdrawn: '已撤回',
};

const locationStatusLabels: Record<OversightLocationStatus, string> = {
  open: '營業中',
  closed: '已打烊',
  suspended: '已停用',
};

const tenantStateLabels: Record<OversightTenantState, string> = {
  provisioned: '建檔未開放',
  open: '已開通',
  suspended: '已關閉',
};

function invalid(): never {
  throw new NuniError(502, 'INVALID_RESPONSE');
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : invalid();
}

function nullableText(value: unknown): string | null {
  return value === null ? null : text(value);
}

function bool(value: unknown): boolean {
  return typeof value === 'boolean' ? value : invalid();
}

function count(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : invalid();
}

function enumeration<T extends string>(value: unknown, options: readonly T[]): T {
  return typeof value === 'string' && options.includes(value as T) ? (value as T) : invalid();
}

function requireIso(value: unknown): string {
  const raw = text(value);
  if (!Number.isFinite(Date.parse(raw))) invalid();
  return raw;
}

function nullableIso(value: unknown): string | null {
  return value === null ? null : requireIso(value);
}

function parseRoleAdmin(value: unknown): { personId: string; displayName: string } {
  const row = nuniRecord(value);
  return { personId: text(row.personId), displayName: text(row.displayName) };
}

function parsePerson(value: unknown): OversightPerson {
  const row = nuniRecord(value);
  return {
    personId: text(row.personId),
    displayName: text(row.displayName),
    email: nullableText(row.email),
    role: enumeration(row.role, personRoles),
    roleLabel: text(row.roleLabel),
    state: enumeration(row.state, personStates),
    stateLabel: text(row.stateLabel),
  };
}

export function parseOversightPeople(value: unknown): OversightPeople {
  const row = nuniRecord(value);
  const roleAdminsRaw = row.roleAdmins;
  const peopleRaw = row.people;
  if (!Array.isArray(roleAdminsRaw) || !Array.isArray(peopleRaw)) invalid();
  const roleAdmins = roleAdminsRaw.map(parseRoleAdmin);
  const people = peopleRaw.map(parsePerson);
  const hasRoleAdmin = bool(row.hasRoleAdmin);
  if (hasRoleAdmin !== roleAdmins.length > 0) invalid();
  return {
    tenantId: text(row.tenantId),
    displayName: text(row.displayName),
    tenantState: enumeration(row.tenantState, tenantStates),
    hasRoleAdmin,
    roleAdmins,
    people,
    honesty: text(row.honesty),
  };
}

/** Stable factory: rejects payloads that do not match the selected school. */
export function createPeopleParser(expectedTenantId: string): (value: unknown) => OversightPeople {
  return (value: unknown) => {
    const parsed = parseOversightPeople(value);
    if (parsed.tenantId !== expectedTenantId) invalid();
    return parsed;
  };
}

function parseInterest(value: unknown): OversightMerchantInterest {
  const row = nuniRecord(value);
  return {
    id: text(row.id),
    brandName: text(row.brandName),
    schoolName: text(row.schoolName),
    contactName: text(row.contactName),
    contactEmail: text(row.contactEmail),
    note: nullableText(row.note),
    state: enumeration(row.state, interestStates),
    createdAt: requireIso(row.createdAt),
    decidedAt: nullableIso(row.decidedAt),
  };
}

function parseApplication(value: unknown): OversightMerchantApplication {
  const row = nuniRecord(value);
  const version = count(row.version);
  if (version < 1) invalid();
  return {
    tenantId: text(row.tenantId),
    tenantName: text(row.tenantName),
    applicationId: text(row.applicationId),
    brandName: text(row.brandName),
    locationName: text(row.locationName),
    contactName: text(row.contactName),
    contactEmail: text(row.contactEmail),
    state: text(row.state),
    version,
    submittedAt: requireIso(row.submittedAt),
  };
}

function parseCatalogRow(value: unknown): OversightMerchantCatalogRow {
  const row = nuniRecord(value);
  return {
    tenantId: text(row.tenantId),
    tenantName: text(row.tenantName),
    locationId: text(row.locationId),
    locationName: text(row.locationName),
    merchantMode: enumeration(row.merchantMode, merchantModes),
    merchantModeLabel: text(row.merchantModeLabel),
    sourceLabel: text(row.sourceLabel),
    sourceUpdatedAt: nullableIso(row.sourceUpdatedAt),
    published: bool(row.published),
    locationStatus: enumeration(row.locationStatus, locationStatuses),
    publicAccess: bool(row.publicAccess),
  };
}

export function parseOversightMerchants(value: unknown): OversightMerchants {
  const row = nuniRecord(value);
  const interest = row.interest;
  const applications = row.applications;
  const catalog = row.catalog;
  if (!Array.isArray(interest) || !Array.isArray(applications) || !Array.isArray(catalog))
    invalid();
  return {
    interest: interest.map(parseInterest),
    applications: applications.map(parseApplication),
    catalog: catalog.map(parseCatalogRow),
    honesty: text(row.honesty),
  };
}

export function interestStateLabel(state: OversightInterestState): string {
  return interestStateLabels[state];
}

export function applicationStateLabel(state: string): { label: string; unknown: boolean } {
  const known = applicationStateLabels[state];
  if (known) return { label: known, unknown: false };
  return { label: '待確認', unknown: true };
}

export function locationStatusLabel(status: OversightLocationStatus): string {
  return locationStatusLabels[status];
}

export function tenantStateLabel(state: OversightTenantState): string {
  return tenantStateLabels[state];
}

export function merchantModeOrderableCopy(mode: OversightMerchantMode): string {
  if (mode === 'full') return '完整服務，接單依開通與營業狀態';
  if (mode === 'showcase_link') return '外連點餐，不在此下單';
  return '僅資訊展示，不可點餐';
}
