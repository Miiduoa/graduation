import { collapseInternalPathHash, currentReturnPath } from '@/lib/navigation';

export const CLASS_HONESTY_STORAGE_KEY = 'nuni-class-honesty-banner';
export const CLASS_HONESTY_TEXT =
  '這是課班空間：可開班、邀請、課堂簽到與作業。不是學校正式學籍，也不是正式請假、校發證件或校內點餐。';

export const JOIN_PATH = '/auth/platform/class-workspace/join';
export const CREATE_PATH = '/auth/platform/class-workspace/new';
export const SCHOOL_REVIEW_PATH = '/admin/school-review';
export const OPS_PATH = '/admin/ops';
export const SCHOOL_APPLY_PATH = '/auth/platform/school-apply';
export const OPS_TABS = ['schools', 'people', 'merchants', 'affiliation', 'audit'] as const;
export type OpsTab = (typeof OPS_TABS)[number];

export function readOpsSchool(search: string | null | undefined): string | null {
  const params = new URLSearchParams((search || '').replace(/^\?/, ''));
  const candidate = params.get('school') ?? params.get('tenantId');
  return candidate && /^[a-z0-9](?:[a-z0-9-]{0,98}[a-z0-9])$/.test(candidate)
    ? candidate
    : null;
}

export function isOpsTab(value: string | null | undefined): value is OpsTab {
  return !!value && (OPS_TABS as readonly string[]).includes(value);
}

export function readOpsTab(
  search: string | null | undefined,
  hash: string | null | undefined,
): OpsTab {
  const queryTab = new URLSearchParams((search || '').replace(/^\?/, '')).get('tab');
  if (isOpsTab(queryTab)) return queryTab;
  const raw = hash || '';
  const withHash = !raw || raw.startsWith('#') ? raw : `#${raw}`;
  const fragment = collapseInternalPathHash(withHash).replace(/^#/, '');
  return isOpsTab(fragment) ? fragment : 'schools';
}

// The selected school is navigation context, never an authorization grant.
export function readOpsSchoolId(search: string | null | undefined): string | null {
  const tenantId = new URLSearchParams((search || '').replace(/^\?/, '')).get('tenantId');
  if (!tenantId || tenantId.length > 80 || !/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(tenantId))
    return null;
  return tenantId;
}

export function opsTabHref(tab: OpsTab, schoolId: string | null): string {
  const params = new URLSearchParams({ tab });
  if ((tab === 'schools' || tab === 'people') && schoolId && readOpsSchoolId(`?tenantId=${encodeURIComponent(schoolId)}`)) {
    params.set('tenantId', schoolId);
  }
  return `${OPS_PATH}?${params.toString()}`;
}

export const APPROVE_SCHOOL_REASON = '資料齊全，先建檔未開放註冊。';
export const REJECT_SCHOOL_REASON = '資料不足，請補件後再申請。';
export const OPEN_SCHOOL_REASON = '資料已核對，開放給學生找校。';

export function workspacePath(id: string): string {
  return `/classroom/course/${encodeURIComponent(id)}`;
}

export function accountReturnHref(path: string): string {
  return `/auth/account?returnUrl=${encodeURIComponent(path)}`;
}

export function adminLoginHref(path: string): string {
  const destination = collapseInternalPathHash(path);
  const href = `/admin/login?returnUrl=${encodeURIComponent(destination)}`;
  // Next.js <Link> keeps the current document fragment when the target has none.
  // Encoded %23 in returnUrl is not a fragment, so end with # to replace it.
  return destination.includes('#') ? `${href}#` : href;
}

export function currentPageReturnPath(fallback: string): string {
  if (typeof window === 'undefined') return fallback;
  return (
    currentReturnPath(window.location.pathname, window.location.search, window.location.hash) ||
    fallback
  );
}
