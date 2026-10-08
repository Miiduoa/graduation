export type NuniRole = 'owner-teacher' | 'co-teacher' | 'student';
export type NuniWorkspace = {
  id: string;
  title: string;
  state: 'active' | 'archived';
  memberRole: NuniRole;
};
export type NuniSubmission = {
  assignmentId: string;
  platformAccountId: string;
  displayName: string;
  body: string;
  state: 'submitted';
  submittedAt: string;
  teacherFeedback: string | null;
};
export type NuniAssignment = {
  id: string;
  workspaceId: string;
  title: string;
  instructions: string;
  state: 'open' | 'closed';
  dueAt: string | null;
  submissionCount: number;
  mySubmission: NuniSubmission | null;
};
export type NuniPrincipal = { platformAccountId: string; isPlatformOperator: boolean };

export class NuniError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
  ) {
    super(code);
    this.name = 'NuniError';
  }
}

export function nuniRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new NuniError(502, 'INVALID_RESPONSE');
  }
  return value as Record<string, unknown>;
}

function string(value: unknown, limit = 8000): string {
  if (typeof value !== 'string' || value.length > limit)
    throw new NuniError(502, 'INVALID_RESPONSE');
  return value;
}

export function nuniId(value: unknown, prefix: 'cw' | 'cwa' | 'pa'): string {
  const result = string(value, 40);
  if (
    !new RegExp(`^${prefix}_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`).test(
      result,
    )
  ) {
    throw new NuniError(502, 'INVALID_RESPONSE');
  }
  return result;
}

function choice<T extends string>(value: unknown, choices: readonly T[]): T {
  if (!choices.includes(value as T)) throw new NuniError(502, 'INVALID_RESPONSE');
  return value as T;
}

function date(value: unknown): string {
  const result = string(value, 40);
  if (!Number.isFinite(Date.parse(result))) throw new NuniError(502, 'INVALID_RESPONSE');
  return result;
}

function array<T>(value: unknown, parse: (item: unknown) => T): T[] {
  if (!Array.isArray(value) || value.length > 5000) throw new NuniError(502, 'INVALID_RESPONSE');
  return value.map(parse);
}

export function parseNuniPrincipal(value: unknown): NuniPrincipal {
  const item = nuniRecord(value);
  if (item.authenticated !== true || typeof item.isPlatformOperator !== 'boolean') {
    throw new NuniError(502, 'INVALID_RESPONSE');
  }
  return {
    platformAccountId: nuniId(item.platformAccountId, 'pa'),
    isPlatformOperator: item.isPlatformOperator,
  };
}

export function parseNuniWorkspace(value: unknown): NuniWorkspace {
  const item = nuniRecord(value);
  return {
    id: nuniId(item.id, 'cw'),
    title: string(item.title, 120),
    state: choice(item.state, ['active', 'archived']),
    memberRole: choice(item.memberRole, ['owner-teacher', 'co-teacher', 'student']),
  };
}

export function parseNuniSubmission(value: unknown): NuniSubmission {
  const item = nuniRecord(value);
  return {
    assignmentId: nuniId(item.assignmentId, 'cwa'),
    platformAccountId: nuniId(item.platformAccountId, 'pa'),
    displayName: string(item.displayName, 300),
    body: string(item.body),
    state: choice(item.state, ['submitted']),
    submittedAt: date(item.submittedAt),
    teacherFeedback: item.teacherFeedback === null ? null : string(item.teacherFeedback, 4000),
  };
}

export function parseNuniAssignment(value: unknown): NuniAssignment {
  const item = nuniRecord(value);
  const id = nuniId(item.id, 'cwa');
  const mySubmission = item.mySubmission === null ? null : parseNuniSubmission(item.mySubmission);
  if (mySubmission && mySubmission.assignmentId !== id)
    throw new NuniError(502, 'INVALID_RESPONSE');
  if (!Number.isSafeInteger(item.submissionCount) || Number(item.submissionCount) < 0) {
    throw new NuniError(502, 'INVALID_RESPONSE');
  }
  return {
    id,
    workspaceId: nuniId(item.workspaceId, 'cw'),
    title: string(item.title, 160),
    instructions: string(item.instructions),
    state: choice(item.state, ['open', 'closed']),
    dueAt: item.dueAt === null ? null : date(item.dueAt),
    submissionCount: Number(item.submissionCount),
    mySubmission,
  };
}

export type NuniTransport = (path: string, input?: Record<string, unknown>) => Promise<unknown>;

export function createNuniClasses(transport: NuniTransport) {
  const path = (id: string) => `class-workspaces/${nuniId(id, 'cw')}`;
  return {
    async list() {
      return array(nuniRecord(await transport('class-workspaces')).workspaces, parseNuniWorkspace);
    },
    async get(id: string) {
      return parseNuniWorkspace(await transport(path(id)));
    },
    async create(title: string, idempotencyKey: string) {
      return parseNuniWorkspace(await transport('class-workspaces', { title, idempotencyKey }));
    },
    async join(code: string, idempotencyKey: string) {
      return parseNuniWorkspace(await transport('class-workspaces/join', { code, idempotencyKey }));
    },
    async invite(id: string, idempotencyKey: string) {
      const value = nuniRecord(
        await transport(`${path(id)}/invites`, { idempotencyKey, maxUses: 30 }),
      );
      const code = string(value.code, 24);
      if (!/^[A-Z0-9]{6,12}$/.test(code)) throw new NuniError(502, 'INVALID_RESPONSE');
      return { code };
    },
    async assignments(id: string) {
      const items = array(
        nuniRecord(await transport(`${path(id)}/assignments`)).assignments,
        parseNuniAssignment,
      );
      if (items.some((item) => item.workspaceId !== id))
        throw new NuniError(502, 'INVALID_RESPONSE');
      return items;
    },
    async createAssignment(
      id: string,
      input: { title: string; instructions: string; dueAt: string | null; idempotencyKey: string },
    ) {
      const item = parseNuniAssignment(await transport(`${path(id)}/assignments`, input));
      if (item.workspaceId !== id) throw new NuniError(502, 'INVALID_RESPONSE');
      return item;
    },
    async submit(id: string, assignmentId: string, body: string, idempotencyKey: string) {
      const item = parseNuniAssignment(
        await transport(`${path(id)}/assignments/${nuniId(assignmentId, 'cwa')}/submit`, {
          body,
          idempotencyKey,
        }),
      );
      if (item.id !== assignmentId || item.workspaceId !== id || !item.mySubmission)
        throw new NuniError(502, 'INVALID_RESPONSE');
      return item;
    },
    async submissions(id: string, assignmentId: string) {
      const result = nuniRecord(
        await transport(`${path(id)}/assignments/${nuniId(assignmentId, 'cwa')}/submissions`),
      );
      const items = array(result.submissions, parseNuniSubmission);
      if (items.some((item) => item.assignmentId !== assignmentId))
        throw new NuniError(502, 'INVALID_RESPONSE');
      return items;
    },
  };
}

export function nuniErrorMessage(error: unknown): string {
  if (error instanceof NuniError) {
    if (error.code === 'SESSION_CHANGED') return '帳號已變更，請重新整理後再操作。';
    if (error.status === 401) return '登入已逾時，請重新登入。';
    if (error.status === 403) return '你目前沒有這項操作的權限。';
    if (error.status === 404) return '找不到這筆資料，可能已被移除。';
    if (error.status === 409) return '資料已變更，請更新後確認目前狀態。';
    if (error.status === 429) return '操作較頻繁，請稍候再試。';
    if (error.status === 400 || error.status === 422) return '請確認填寫內容與邀請碼是否正確。';
  }
  return '目前無法連線。請保留填寫內容，稍後重試。';
}
