import { NuniError, nuniRecord, type NuniTransport } from './nuni';

export type NuniMerchantProgram = {
  tenantId: string;
  name: string;
  note: string;
  campuses: { id: string; name: string }[];
};
export type MerchantApplicationState =
  | 'submitted'
  | 'under-review'
  | 'needs-information'
  | 'approved'
  | 'rejected'
  | 'withdrawn';
export type NuniMerchantApplication = {
  tenantId: string;
  applicationId: string;
  brandName: string;
  locationName: string;
  state: MerchantApplicationState;
  reviewerNote: string;
  submittedAt: string;
};
export type NuniMerchantWorkspace = {
  tenantId: string;
  tenantName: string;
  merchantName: string;
  locationId: string;
  locationName: string;
  campusName: string;
  merchantStatus: string;
  locationStatus: string;
  publicAccess: boolean;
  activated: boolean;
  missingRequirements: string[];
};
export type NuniMerchantApplicationInput = {
  tenantId: string;
  campusId: string;
  idempotencyKey: string;
  businessKind: 'company' | 'sole-proprietor' | 'campus-stall' | 'other';
  legalName: string;
  brandName: string;
  businessRegistrationNumber?: string;
  foodBusinessRegistrationNumber?: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  locationName: string;
  operatingAddress: string;
  serviceModes: ('pickup' | 'dine-in' | 'delivery')[];
};
const states: MerchantApplicationState[] = [
  'submitted',
  'under-review',
  'needs-information',
  'approved',
  'rejected',
  'withdrawn',
];
const invalid = () => new NuniError(502, 'INVALID_RESPONSE');
function text(value: unknown, max: number, empty = false): string {
  if (typeof value !== 'string' || value.length > max || (!empty && !value.trim())) throw invalid();
  return value;
}
function rows<T>(value: unknown, parse: (row: unknown) => T): T[] {
  if (!Array.isArray(value) || value.length > 10000) throw invalid();
  return value.map(parse);
}
function boolean(value: unknown): boolean {
  if (typeof value !== 'boolean') throw invalid();
  return value;
}
export function parseMerchantApplication(value: unknown): NuniMerchantApplication {
  const row = nuniRecord(value);
  if (!states.includes(row.state as MerchantApplicationState)) throw invalid();
  const submittedAt = text(row.submittedAt, 40);
  if (!Number.isFinite(Date.parse(submittedAt))) throw invalid();
  return {
    tenantId: text(row.tenantId, 200),
    applicationId: text(row.applicationId, 100),
    brandName: text(row.brandName, 200),
    locationName: text(row.locationName, 200),
    state: row.state as MerchantApplicationState,
    reviewerNote: text(row.reviewerNote, 4000, true),
    submittedAt,
  };
}
export function parseMerchantOverview(value: unknown): {
  programs: NuniMerchantProgram[];
  applications: NuniMerchantApplication[];
} {
  const row = nuniRecord(value);
  return {
    programs: rows(row.programs, (value) => {
      const program = nuniRecord(value);
      return {
        tenantId: text(program.tenantId, 200),
        name: text(program.name, 200),
        note: text(program.note, 4000, true),
        campuses: rows(program.campuses, (value) => {
          const campus = nuniRecord(value);
          return { id: text(campus.id, 64), name: text(campus.name, 200) };
        }),
      };
    }),
    applications: rows(row.applications, parseMerchantApplication),
  };
}
export function parseMerchantWorkspaces(value: unknown): NuniMerchantWorkspace[] {
  return rows(nuniRecord(value).workspaces, (value) => {
    const row = nuniRecord(value);
    return {
      tenantId: text(row.tenantId, 200),
      tenantName: text(row.tenantName, 200),
      merchantName: text(row.merchantName, 200),
      locationId: text(row.locationId, 200),
      locationName: text(row.locationName, 200),
      campusName: text(row.campusName, 200),
      merchantStatus: text(row.merchantStatus, 40),
      locationStatus: text(row.locationStatus, 40),
      publicAccess: boolean(row.publicAccess),
      activated: boolean(row.activated),
      missingRequirements: rows(row.missingRequirements, (value) => text(value, 100)),
    };
  });
}
export async function loadMerchantOverview(transport: NuniTransport) {
  const [programs, applications, workspaces] = await Promise.all([
    transport('merchant-onboarding-programs'),
    transport('merchant-applications'),
    transport('merchant-workspaces'),
  ]);
  return {
    ...parseMerchantOverview({
      programs: nuniRecord(programs).programs,
      applications: nuniRecord(applications).applications,
    }),
    workspaces: parseMerchantWorkspaces(workspaces),
  };
}
export function merchantApplicationStateLabel(state: MerchantApplicationState): string {
  return {
    submitted: '已送出',
    'under-review': '審核中',
    'needs-information': '待補件',
    approved: '已核准，請確認營運設定',
    rejected: '未通過',
    withdrawn: '已撤回',
  }[state];
}
export function merchantWorkspaceStateLabel(workspace: NuniMerchantWorkspace): string {
  if (!workspace.activated) return '已核准，待完成營運設定';
  if (workspace.merchantStatus !== 'active' || workspace.locationStatus === 'suspended')
    return '已停權，請聯絡場域管理者';
  if (workspace.locationStatus === 'open' && workspace.publicAccess) return '營業中';
  if (workspace.locationStatus === 'closed' && !workspace.publicAccess) return '暫停接單';
  return '營運狀態待確認';
}
export function validateMerchantApplicationInput(value: unknown): NuniMerchantApplicationInput {
  const fail = (): never => {
    throw new NuniError(422, 'INVALID_INPUT');
  };
  const input = nuniRecord(value);
  const allowed = [
    'tenantId',
    'campusId',
    'idempotencyKey',
    'businessKind',
    'legalName',
    'brandName',
    'businessRegistrationNumber',
    'foodBusinessRegistrationNumber',
    'contactName',
    'contactEmail',
    'contactPhone',
    'locationName',
    'operatingAddress',
    'serviceModes',
  ];
  if (Object.keys(input).some((key) => !allowed.includes(key))) fail();
  const field = (key: string, min: number, max: number): string => {
    const value = input[key];
    if (typeof value !== 'string' || value.trim().length < min || value.trim().length > max)
      return fail();
    return value.trim();
  };
  const tenantId = field('tenantId', 2, 200);
  const campusId = field('campusId', 1, 64);
  const businessKind = field('businessKind', 1, 30) as NuniMerchantApplicationInput['businessKind'];
  const contactEmail = field('contactEmail', 3, 254);
  if (
    !/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(tenantId) ||
    !/^[a-z][a-z0-9-]{0,63}$/.test(campusId) ||
    !['company', 'sole-proprietor', 'campus-stall', 'other'].includes(businessKind) ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)
  )
    fail();
  const modes = input.serviceModes;
  if (
    !Array.isArray(modes) ||
    modes.length < 1 ||
    modes.length > 3 ||
    modes.some((value) => !['pickup', 'dine-in', 'delivery'].includes(value)) ||
    new Set(modes).size !== modes.length
  )
    fail();
  return {
    tenantId,
    campusId,
    businessKind,
    contactEmail,
    idempotencyKey: field('idempotencyKey', 16, 100),
    legalName: field('legalName', 1, 200),
    brandName: field('brandName', 1, 200),
    contactName: field('contactName', 1, 120),
    contactPhone: field('contactPhone', 6, 30),
    locationName: field('locationName', 1, 200),
    operatingAddress: field('operatingAddress', 3, 300),
    ...(input.businessRegistrationNumber !== undefined
      ? { businessRegistrationNumber: field('businessRegistrationNumber', 3, 40) }
      : {}),
    ...(input.foodBusinessRegistrationNumber !== undefined
      ? { foodBusinessRegistrationNumber: field('foodBusinessRegistrationNumber', 3, 60) }
      : {}),
    serviceModes: modes as NuniMerchantApplicationInput['serviceModes'],
  };
}
