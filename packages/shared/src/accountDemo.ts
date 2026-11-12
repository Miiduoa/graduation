/** Account-owned synthetic demonstration data. These permissions never grant campus authority. */
export const ACCOUNT_DEMO_FEATURES = [
  'timetable',
  'coursework',
  'assistant',
  'studentCard',
  'attendance',
  'leave',
  'library',
  'dormitory',
  'food',
  'community',
  'messages',
  'administration',
] as const;
export type AccountDemoFeature = (typeof ACCOUNT_DEMO_FEATURES)[number];
export type AccountDemoPermissions = Record<AccountDemoFeature, boolean>;
export const ACCOUNT_DEMO_FEATURE_LABELS: Record<AccountDemoFeature, string> = {
  timetable: '課表與行程',
  coursework: '課程與作業',
  assistant: 'AI 助理',
  studentCard: '學生證',
  attendance: '點名',
  leave: '請假',
  library: '圖書館',
  dormitory: '宿舍',
  food: '訂餐',
  community: '社群',
  messages: '訊息',
  administration: '管理展示',
};
export const ACCOUNT_DEMO_ACTIONS = [
  'submitAssignment',
  'checkIn',
  'requestLeave',
  'approveLeave',
  'publishGrade',
  'createOrder',
  'readyOrder',
  'postStory',
  'sendMessage',
  'reserveSeat',
  'renewBook',
  'requestRepair',
  'postAnnouncement',
] as const;
export type AccountDemoStateKey = (typeof ACCOUNT_DEMO_ACTIONS)[number];
export type AccountDemoAction = AccountDemoStateKey | 'reset';
export type AccountDemoState = Record<AccountDemoStateKey, boolean>;
export const ACCOUNT_DEMO_ACTION_LABELS: Record<AccountDemoAction, string> = {
  submitAssignment: '繳交作業',
  checkIn: '完成簽到',
  requestLeave: '送出請假',
  approveLeave: '核准請假',
  publishGrade: '發布成績',
  createOrder: '建立訂餐',
  readyOrder: '標示可取餐',
  postStory: '發布限時動態',
  sendMessage: '傳送訊息',
  reserveSeat: '預約座位',
  renewBook: '續借圖書',
  requestRepair: '送出報修',
  postAnnouncement: '發布公告',
  reset: '重設展示進度',
};
export const ACCOUNT_DEMO_ACTION_FEATURES: Record<
  AccountDemoStateKey,
  readonly AccountDemoFeature[]
> = {
  submitAssignment: ['coursework'],
  checkIn: ['attendance'],
  requestLeave: ['leave'],
  approveLeave: ['leave', 'administration'],
  publishGrade: ['coursework', 'administration'],
  createOrder: ['food'],
  readyOrder: ['food', 'administration'],
  postStory: ['community'],
  sendMessage: ['messages'],
  reserveSeat: ['library'],
  renewBook: ['library'],
  requestRepair: ['dormitory'],
  postAnnouncement: ['administration'],
};
export type AccountDemoProfile = {
  displayName: string;
  schoolId: string;
  schoolName: string;
  studentId: string;
  department: string;
};
export type AccountDemoSnapshot = {
  accountId: string;
  revision: number;
  profile: AccountDemoProfile;
  permissions: AccountDemoPermissions;
  state: AccountDemoState;
  /** ISO 8601 timestamp, also used by mobile clients. */
  expiresAt: string;
};
export type AccountDemoMutation =
  | { expectedRevision: number; permissions: AccountDemoPermissions }
  | { expectedRevision: number; action: AccountDemoAction };

export class AccountDemoError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
  ) {
    super(code);
    this.name = 'AccountDemoError';
  }
}
function invalid(): never {
  throw new AccountDemoError(422, 'INVALID_DEMO_INPUT');
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
  return value as Record<string, unknown>;
}
function exact(value: Record<string, unknown>, keys: readonly string[]): void {
  if (Object.keys(value).length !== keys.length || keys.some((key) => !Object.hasOwn(value, key)))
    invalid();
}
function text(value: unknown, max: number): string {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim() || value.length > max)
    invalid();
  return value;
}
function booleans<T extends string>(value: unknown, keys: readonly T[]): Record<T, boolean> {
  const row = record(value);
  exact(row, keys);
  const result = {} as Record<T, boolean>;
  for (const key of keys) {
    if (typeof row[key] !== 'boolean') invalid();
    result[key] = row[key] as boolean;
  }
  return result;
}
export function createAccountDemoPermissions(enabled = false): AccountDemoPermissions {
  return Object.fromEntries(
    ACCOUNT_DEMO_FEATURES.map((key) => [key, enabled]),
  ) as AccountDemoPermissions;
}
export function createAccountDemoState(): AccountDemoState {
  return Object.fromEntries(ACCOUNT_DEMO_ACTIONS.map((key) => [key, false])) as AccountDemoState;
}
export function parseAccountDemoPermissions(value: unknown): AccountDemoPermissions {
  return booleans(value, ACCOUNT_DEMO_FEATURES);
}
export function parseAccountDemoState(value: unknown): AccountDemoState {
  return booleans(value, ACCOUNT_DEMO_ACTIONS);
}
export function parseAccountDemoProfile(value: unknown): AccountDemoProfile {
  const row = record(value);
  exact(row, ['displayName', 'schoolId', 'schoolName', 'studentId', 'department']);
  const profile = {
    displayName: text(row.displayName, 100),
    schoolId: text(row.schoolId, 80),
    schoolName: text(row.schoolName, 160),
    studentId: text(row.studentId, 36),
    department: text(row.department, 120),
  };
  if (
    !/^[a-z0-9][a-z0-9-]{1,79}$/.test(profile.schoolId) ||
    !/^DEMO[A-Z0-9_-]{4,32}$/.test(profile.studentId)
  )
    invalid();
  return profile;
}
export function parseAccountDemoSnapshot(value: unknown): AccountDemoSnapshot {
  const row = record(value);
  exact(row, ['accountId', 'revision', 'profile', 'permissions', 'state', 'expiresAt']);
  const accountId = text(row.accountId, 40);
  if (!/^pa_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(accountId))
    invalid();
  if (!Number.isSafeInteger(row.revision) || Number(row.revision) < 0) invalid();
  const expiresAt = text(row.expiresAt, 40);
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(expiresAt) ||
    !Number.isFinite(Date.parse(expiresAt))
  )
    invalid();
  return {
    accountId,
    revision: Number(row.revision),
    profile: parseAccountDemoProfile(row.profile),
    permissions: parseAccountDemoPermissions(row.permissions),
    state: parseAccountDemoState(row.state),
    expiresAt,
  };
}
export function parseAccountDemoMutation(value: unknown): AccountDemoMutation {
  const row = record(value);
  if (!Number.isSafeInteger(row.expectedRevision) || Number(row.expectedRevision) < 0) invalid();
  const expectedRevision = Number(row.expectedRevision);
  if (Object.hasOwn(row, 'permissions')) {
    exact(row, ['expectedRevision', 'permissions']);
    return { expectedRevision, permissions: parseAccountDemoPermissions(row.permissions) };
  }
  exact(row, ['expectedRevision', 'action']);
  if (row.action !== 'reset' && !ACCOUNT_DEMO_ACTIONS.includes(row.action as AccountDemoStateKey))
    invalid();
  return { expectedRevision, action: row.action as AccountDemoAction };
}
export function applyAccountDemoAction(
  snapshot: Pick<AccountDemoSnapshot, 'permissions' | 'state'>,
  action: AccountDemoAction,
): AccountDemoState {
  if (action === 'reset') return createAccountDemoState();
  if (!ACCOUNT_DEMO_ACTIONS.includes(action)) invalid();
  if (
    ACCOUNT_DEMO_ACTION_FEATURES[action].some((feature) => snapshot.permissions[feature] !== true)
  ) {
    throw new AccountDemoError(403, 'DEMO_FEATURE_DISABLED');
  }
  const prerequisite =
    action === 'approveLeave'
      ? 'requestLeave'
      : action === 'publishGrade'
        ? 'submitAssignment'
        : action === 'readyOrder'
          ? 'createOrder'
          : null;
  if (prerequisite && snapshot.state[prerequisite] !== true) {
    throw new AccountDemoError(409, 'DEMO_ACTION_NOT_READY');
  }
  return { ...snapshot.state, [action]: true };
}
