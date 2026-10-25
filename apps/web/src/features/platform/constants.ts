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

export function isOpsTab(value: string | null | undefined): value is OpsTab {
  return !!value && (OPS_TABS as readonly string[]).includes(value);
}

export const APPROVE_SCHOOL_REASON = '資料齊全，先建檔未開放註冊。';
export const REJECT_SCHOOL_REASON = '資料不足，請補件後再申請。';
export const OPEN_SCHOOL_REASON = '資料已核對，開放給學生找校。';

export const WORKSPACE_ID_PATTERN = /^cw_[0-9a-fA-F-]{36}$/u;

export function workspacePath(id: string): string {
  return `/auth/platform/class-workspace/${id}`;
}

export function accountReturnHref(path: string): string {
  return `/auth/account?returnUrl=${encodeURIComponent(path)}`;
}

export function adminLoginHref(path: string): string {
  return `/admin/login?returnUrl=${encodeURIComponent(path)}`;
}

export function currentPageReturnPath(fallback: string): string {
  if (typeof window === 'undefined') return fallback;
  return `${window.location.pathname}${window.location.search}${window.location.hash}` || fallback;
}
