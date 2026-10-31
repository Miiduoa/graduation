import { parseTaipeiInstant } from './taipeiTime';

export type NuniRole = 'owner-teacher' | 'co-teacher' | 'student';
export type NuniWorkspace = {
  id: string;
  title: string;
  state: 'active' | 'archived';
  memberRole: NuniRole;
};
export type NuniUnit = {
  id: string;
  workspaceId: string;
  title: string;
  position: number;
  createdAt: string;
};
export type NuniMaterial = {
  id: string;
  workspaceId: string;
  title: string;
  body: string;
  unitId: string | null;
  unitTitle: string | null;
  createdByPlatformAccountId: string;
  createdAt: string;
};
export type NuniMaterialPage = { materials: NuniMaterial[]; nextCursor: string | null };
export type NuniSubmissionFile = {
  id: string;
  originalName: string;
  contentType: string;
  byteSize: number;
  kind: 'image' | 'file';
  downloadPath: string;
  downloadExp: string;
  downloadSig: string;
};
export type NuniSubmission = {
  assignmentId: string;
  platformAccountId: string;
  displayName: string;
  body: string;
  state: 'submitted';
  submittedAt: string;
  late?: boolean;
  files?: NuniSubmissionFile[];
  teacherFeedback: string | null;
  reviewedAt: string | null;
};
export type NuniAssignment = {
  id: string;
  workspaceId: string;
  title: string;
  instructions: string;
  state: 'open' | 'closed';
  createdAt: string;
  closedAt: string | null;
  dueAt: string | null;
  unitId: string | null;
  unitTitle: string | null;
  submissionCount: number;
  mySubmission: NuniSubmission | null;
};
export type NuniQuizResponse = {
  quizId: string;
  platformAccountId: string;
  displayName: string;
  answer: string;
  state: 'submitted';
  submittedAt: string;
  teacherFeedback: string | null;
  reviewedAt: string | null;
};
export type NuniQuiz = {
  id: string;
  workspaceId: string;
  title: string;
  prompt: string;
  state: 'open' | 'closed';
  createdAt: string;
  closedAt: string | null;
  dueAt: string | null;
  unitId: string | null;
  unitTitle: string | null;
  responseCount: number;
  myResponse: NuniQuizResponse | null;
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

function content(value: unknown, limit = 8000): string {
  const result = string(value, limit);
  if (!result.trim()) throw new NuniError(502, 'INVALID_RESPONSE');
  return result;
}

export function nuniId(
  value: unknown,
  prefix: 'cw' | 'cwu' | 'cwm' | 'cwa' | 'cwq' | 'cwf' | 'pa',
): string {
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
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(result)) {
    if (!Number.isFinite(Date.parse(result))) throw new NuniError(502, 'INVALID_RESPONSE');
    return result;
  }
  if (
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(result) &&
    parseTaipeiInstant(result) !== null
  ) {
    return result;
  }
  throw new NuniError(502, 'INVALID_RESPONSE');
}

function count(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0)
    throw new NuniError(502, 'INVALID_RESPONSE');
  return Number(value);
}

function array<T>(value: unknown, parse: (item: unknown) => T): T[] {
  if (!Array.isArray(value) || value.length > 5000) throw new NuniError(502, 'INVALID_RESPONSE');
  return value.map(parse);
}

function unitFields(item: Record<string, unknown>) {
  const unitId = item.unitId === null ? null : nuniId(item.unitId, 'cwu');
  const unitTitle = item.unitTitle === null ? null : content(item.unitTitle, 80);
  if ((unitId === null) !== (unitTitle === null)) throw new NuniError(502, 'INVALID_RESPONSE');
  return { unitId, unitTitle };
}

function feedbackFields(item: Record<string, unknown>) {
  const teacherFeedback =
    item.teacherFeedback === null ? null : content(item.teacherFeedback, 4000);
  const reviewedAt = item.reviewedAt === null ? null : date(item.reviewedAt);
  if ((teacherFeedback === null) !== (reviewedAt === null))
    throw new NuniError(502, 'INVALID_RESPONSE');
  return { teacherFeedback, reviewedAt };
}

function activityFields(item: Record<string, unknown>) {
  const state = choice(item.state, ['open', 'closed']);
  const closedAt = item.closedAt === null ? null : date(item.closedAt);
  if ((state === 'open') !== (closedAt === null)) throw new NuniError(502, 'INVALID_RESPONSE');
  return {
    workspaceId: nuniId(item.workspaceId, 'cw'),
    title: content(item.title, 160),
    state,
    createdAt: date(item.createdAt),
    closedAt,
    dueAt: item.dueAt === null ? null : date(item.dueAt),
    ...unitFields(item),
  };
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
    title: content(item.title, 120),
    state: choice(item.state, ['active', 'archived']),
    memberRole: choice(item.memberRole, ['owner-teacher', 'co-teacher', 'student']),
  };
}

export function parseNuniUnit(value: unknown): NuniUnit {
  const item = nuniRecord(value);
  return {
    id: nuniId(item.id, 'cwu'),
    workspaceId: nuniId(item.workspaceId, 'cw'),
    title: content(item.title, 80),
    position: count(item.position),
    createdAt: date(item.createdAt),
  };
}

export function parseNuniMaterial(value: unknown): NuniMaterial {
  const item = nuniRecord(value);
  return {
    id: nuniId(item.id, 'cwm'),
    workspaceId: nuniId(item.workspaceId, 'cw'),
    title: content(item.title, 160),
    body: content(item.body),
    ...unitFields(item),
    createdByPlatformAccountId: nuniId(item.createdByPlatformAccountId, 'pa'),
    createdAt: date(item.createdAt),
  };
}

export function parseNuniSubmissionFile(value: unknown): NuniSubmissionFile {
  const item = nuniRecord(value);
  return {
    id: nuniId(item.id, 'cwf'),
    originalName: content(item.originalName, 200),
    contentType: content(item.contentType, 120),
    byteSize: count(item.byteSize),
    kind: choice(item.kind, ['image', 'file']),
    downloadPath: content(item.downloadPath, 300),
    downloadExp: content(item.downloadExp, 40),
    downloadSig: content(item.downloadSig, 128),
  };
}

function parseAssignmentFileIntent(value: unknown) {
  const item = nuniRecord(value);
  return {
    id: nuniId(item.id, 'cwf'),
    uploadPath: content(item.uploadPath, 300),
    originalName: content(item.originalName, 200),
    contentType: content(item.contentType, 120),
    byteSize: count(item.byteSize),
    kind: choice(item.kind, ['image', 'file']),
  };
}

function optionalSubmissionFiles(item: Record<string, unknown>): NuniSubmissionFile[] | undefined {
  if (item.files === undefined) return undefined;
  const files = array(item.files, parseNuniSubmissionFile);
  if (new Set(files.map((file) => file.id)).size !== files.length)
    throw new NuniError(502, 'INVALID_RESPONSE');
  return files;
}

export function parseNuniSubmission(value: unknown): NuniSubmission {
  const item = nuniRecord(value);
  const files = optionalSubmissionFiles(item);
  if (item.late !== undefined && typeof item.late !== 'boolean')
    throw new NuniError(502, 'INVALID_RESPONSE');
  return {
    assignmentId: nuniId(item.assignmentId, 'cwa'),
    platformAccountId: nuniId(item.platformAccountId, 'pa'),
    displayName: string(item.displayName, 300),
    body: content(item.body),
    state: choice(item.state, ['submitted']),
    submittedAt: date(item.submittedAt),
    ...(typeof item.late === 'boolean' ? { late: item.late } : {}),
    ...(files ? { files } : {}),
    ...feedbackFields(item),
  };
}

export function parseNuniAssignment(value: unknown): NuniAssignment {
  const item = nuniRecord(value);
  const id = nuniId(item.id, 'cwa');
  const mySubmission = item.mySubmission === null ? null : parseNuniSubmission(item.mySubmission);
  if (mySubmission && mySubmission.assignmentId !== id)
    throw new NuniError(502, 'INVALID_RESPONSE');
  return {
    id,
    ...activityFields(item),
    instructions: content(item.instructions),
    submissionCount: count(item.submissionCount),
    mySubmission,
  };
}

export function parseNuniQuizResponse(value: unknown): NuniQuizResponse {
  const item = nuniRecord(value);
  return {
    quizId: nuniId(item.quizId, 'cwq'),
    platformAccountId: nuniId(item.platformAccountId, 'pa'),
    displayName: string(item.displayName, 300),
    answer: content(item.answer, 2000),
    state: choice(item.state, ['submitted']),
    submittedAt: date(item.submittedAt),
    ...feedbackFields(item),
  };
}

export function parseNuniQuiz(value: unknown): NuniQuiz {
  const item = nuniRecord(value);
  const id = nuniId(item.id, 'cwq');
  const myResponse = item.myResponse === null ? null : parseNuniQuizResponse(item.myResponse);
  if (myResponse && myResponse.quizId !== id) throw new NuniError(502, 'INVALID_RESPONSE');
  return {
    id,
    ...activityFields(item),
    prompt: content(item.prompt, 4000),
    responseCount: count(item.responseCount),
    myResponse,
  };
}

export type NuniTransport = (
  path: string,
  input?: Record<string, unknown>,
  query?: Record<string, string>,
) => Promise<unknown>;
export type NuniBinaryUpload = (
  path: string,
  body: Uint8Array,
  contentType: string,
) => Promise<unknown>;
export type NuniAccountContext = string | (() => Promise<string>);

export function createNuniClasses(
  transport: NuniTransport,
  accountContext?: NuniAccountContext,
  upload?: NuniBinaryUpload,
) {
  const path = (id: string) => `class-workspaces/${nuniId(id, 'cw')}`;
  const account = async () =>
    nuniId(typeof accountContext === 'function' ? await accountContext() : accountContext, 'pa');
  const workspace = <T extends { workspaceId: string }>(item: T, id: string): T => {
    if (item.workspaceId !== id) throw new NuniError(502, 'INVALID_RESPONSE');
    return item;
  };
  const assignment = async (value: unknown, id: string, assignmentId?: string) => {
    const item = workspace(parseNuniAssignment(value), id);
    if (
      (assignmentId && item.id !== assignmentId) ||
      (item.mySubmission && item.mySubmission.platformAccountId !== (await account()))
    )
      throw new NuniError(502, 'INVALID_RESPONSE');
    return item;
  };
  const quiz = async (value: unknown, id: string, quizId?: string) => {
    const item = workspace(parseNuniQuiz(value), id);
    if (
      (quizId && item.id !== quizId) ||
      (item.myResponse && item.myResponse.platformAccountId !== (await account()))
    )
      throw new NuniError(502, 'INVALID_RESPONSE');
    return item;
  };
  const assignmentFeedback = async (
    id: string,
    assignmentId: string,
    platformAccountId: string,
    feedback: string,
    idempotencyKey: string,
  ) => {
    const item = parseNuniSubmission(
      await transport(
        `${path(id)}/assignments/${nuniId(assignmentId, 'cwa')}/submissions/${nuniId(platformAccountId, 'pa')}/feedback`,
        { feedback, idempotencyKey },
      ),
    );
    if (
      item.assignmentId !== assignmentId ||
      item.platformAccountId !== platformAccountId ||
      item.teacherFeedback === null ||
      item.reviewedAt === null
    )
      throw new NuniError(502, 'INVALID_RESPONSE');
    return item;
  };
  const quizFeedback = async (
    id: string,
    quizId: string,
    platformAccountId: string,
    feedback: string,
    idempotencyKey: string,
  ) => {
    const item = parseNuniQuizResponse(
      await transport(
        `${path(id)}/quizzes/${nuniId(quizId, 'cwq')}/responses/${nuniId(platformAccountId, 'pa')}/feedback`,
        { feedback, idempotencyKey },
      ),
    );
    if (
      item.quizId !== quizId ||
      item.platformAccountId !== platformAccountId ||
      item.teacherFeedback === null ||
      item.reviewedAt === null
    )
      throw new NuniError(502, 'INVALID_RESPONSE');
    return item;
  };
  return {
    async list() {
      return array(nuniRecord(await transport('class-workspaces')).workspaces, parseNuniWorkspace);
    },
    async get(id: string) {
      const item = parseNuniWorkspace(await transport(path(id)));
      if (item.id !== id) throw new NuniError(502, 'INVALID_RESPONSE');
      return item;
    },
    async create(title: string, idempotencyKey: string) {
      return parseNuniWorkspace(await transport('class-workspaces', { title, idempotencyKey }));
    },
    async join(code: string, idempotencyKey: string) {
      return parseNuniWorkspace(await transport('class-workspaces/join', { code, idempotencyKey }));
    },
    async invite(id: string, idempotencyKey: string, maxUses = 30) {
      if (!Number.isInteger(maxUses) || maxUses < 1 || maxUses > 100)
        throw new NuniError(422, 'INVALID_INPUT');
      const value = nuniRecord(
        await transport(`${path(id)}/invites`, { idempotencyKey, maxUses }),
      );
      const code = string(value.code, 24);
      if (!/^[A-Z0-9]{6,12}$/.test(code)) throw new NuniError(502, 'INVALID_RESPONSE');
      return { code };
    },
    async units(id: string) {
      return array(nuniRecord(await transport(`${path(id)}/units`)).units, parseNuniUnit).map(
        (item) => workspace(item, id),
      );
    },
    async createUnit(id: string, input: { title: string; idempotencyKey: string }) {
      return workspace(parseNuniUnit(await transport(`${path(id)}/units`, input)), id);
    },
    async materials(id: string) {
      return array(
        nuniRecord(await transport(`${path(id)}/materials`)).materials,
        parseNuniMaterial,
      ).map((item) => workspace(item, id));
    },
    async materialsPage(id: string, cursor?: string): Promise<NuniMaterialPage> {
      if (cursor !== undefined && !/^[A-Za-z0-9_-]{1,500}$/.test(cursor))
        throw new NuniError(422, 'CLASS_WORKSPACE_MATERIAL_CURSOR_INVALID');
      const endpoint = `${path(id)}/materials/page`;
      const value = nuniRecord(
        await (cursor === undefined
          ? transport(endpoint)
          : transport(endpoint, undefined, { cursor })),
      );
      const materials = array(value.materials, parseNuniMaterial).map((item) => workspace(item, id));
      if (
        materials.length > 50 ||
        new Set(materials.map((item) => item.id)).size !== materials.length ||
        (value.nextCursor !== null &&
          (typeof value.nextCursor !== 'string' ||
            !/^[A-Za-z0-9_-]{1,500}$/.test(value.nextCursor) ||
            value.nextCursor === cursor ||
            materials.length === 0))
      )
        throw new NuniError(502, 'INVALID_RESPONSE');
      return { materials, nextCursor: value.nextCursor as string | null };
    },
    async createMaterial(
      id: string,
      input: { title: string; body: string; unitId?: string; idempotencyKey: string },
    ) {
      const item = workspace(
        parseNuniMaterial(await transport(`${path(id)}/materials`, input)),
        id,
      );
      if (item.createdByPlatformAccountId !== (await account()))
        throw new NuniError(502, 'INVALID_RESPONSE');
      return item;
    },
    async assignments(id: string) {
      const items = array(
        nuniRecord(await transport(`${path(id)}/assignments`)).assignments,
        parseNuniAssignment,
      );
      return Promise.all(items.map((item) => assignment(item, id)));
    },
    async createAssignment(
      id: string,
      input: {
        title: string;
        instructions: string;
        dueAt: string | null;
        unitId?: string;
        idempotencyKey: string;
      },
    ) {
      return assignment(await transport(`${path(id)}/assignments`, input), id);
    },
    async submit(id: string, assignmentId: string, body: string, idempotencyKey: string) {
      const item = await assignment(
        await transport(`${path(id)}/assignments/${nuniId(assignmentId, 'cwa')}/submit`, {
          body,
          idempotencyKey,
        }),
        id,
        assignmentId,
      );
      if (!item.mySubmission) throw new NuniError(502, 'INVALID_RESPONSE');
      return item;
    },
    async createAssignmentFileIntent(
      id: string,
      assignmentId: string,
      input: {
        originalName: string;
        contentType: string;
        byteSize: number;
        idempotencyKey: string;
      },
    ) {
      const value = nuniRecord(
        await transport(
          `${path(id)}/assignments/${nuniId(assignmentId, 'cwa')}/files/intents`,
          input,
        ),
      );
      return parseAssignmentFileIntent(value);
    },
    async createAssignmentFileIntents(
      id: string,
      assignmentId: string,
      input: {
        files: {
          originalName: string;
          contentType: string;
          byteSize: number;
          idempotencyKey?: string;
        }[];
        idempotencyKey: string;
      },
    ) {
      const value = nuniRecord(
        await transport(`${path(id)}/assignments/${nuniId(assignmentId, 'cwa')}/files/intents`, {
          files: input.files,
          idempotencyKey: input.idempotencyKey,
        }),
      );
      const intents = array(value.intents, parseAssignmentFileIntent);
      if (intents.length !== input.files.length) throw new NuniError(502, 'INVALID_RESPONSE');
      return intents;
    },
    async uploadAssignmentFile(uploadPath: string, body: Uint8Array, contentType: string) {
      if (!upload || !/^[a-z0-9-]+(?:\/[A-Za-z0-9_-]+)*$/.test(uploadPath))
        throw new NuniError(503, 'ASSIGNMENT_FILE_UPLOAD_UNAVAILABLE');
      const value = nuniRecord(await upload(uploadPath, body, contentType));
      return parseNuniSubmissionFile(value);
    },
    async withdrawAssignment(id: string, assignmentId: string, submittedAt: string, idempotencyKey: string) {
      return assignment(await transport(`${path(id)}/assignments/${nuniId(assignmentId, 'cwa')}/withdraw-submission`, {
        submittedAt, idempotencyKey,
      }), id, assignmentId);
    },
    async submitFiles(
      id: string,
      assignmentId: string,
      input: { body?: string; fileIds: string[]; idempotencyKey: string },
    ) {
      const item = await assignment(
        await transport(`${path(id)}/assignments/${nuniId(assignmentId, 'cwa')}/submit-files`, {
          ...(input.body !== undefined ? { body: input.body } : {}),
          fileIds: input.fileIds,
          idempotencyKey: input.idempotencyKey,
        }),
        id,
        assignmentId,
      );
      if (!item.mySubmission) throw new NuniError(502, 'INVALID_RESPONSE');
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
    assignmentFeedback,
    reviewSubmission: assignmentFeedback,
    async closeAssignment(id: string, assignmentId: string) {
      const item = await assignment(
        await transport(`${path(id)}/assignments/${nuniId(assignmentId, 'cwa')}/close`, {}),
        id,
        assignmentId,
      );
      if (item.state !== 'closed') throw new NuniError(502, 'INVALID_RESPONSE');
      return item;
    },
    async quizzes(id: string) {
      const items = array(
        nuniRecord(await transport(`${path(id)}/quizzes`)).quizzes,
        parseNuniQuiz,
      );
      return Promise.all(items.map((item) => quiz(item, id)));
    },
    async createQuiz(
      id: string,
      input: {
        title: string;
        prompt: string;
        dueAt: string | null;
        unitId?: string;
        idempotencyKey: string;
      },
    ) {
      return quiz(await transport(`${path(id)}/quizzes`, input), id);
    },
    async submitQuiz(id: string, quizId: string, answer: string, idempotencyKey: string) {
      const item = await quiz(
        await transport(`${path(id)}/quizzes/${nuniId(quizId, 'cwq')}/submit`, {
          answer,
          idempotencyKey,
        }),
        id,
        quizId,
      );
      if (!item.myResponse) throw new NuniError(502, 'INVALID_RESPONSE');
      return item;
    },
    async quizResponses(id: string, quizId: string) {
      const result = nuniRecord(
        await transport(`${path(id)}/quizzes/${nuniId(quizId, 'cwq')}/responses`),
      );
      const items = array(result.responses, parseNuniQuizResponse);
      if (items.some((item) => item.quizId !== quizId))
        throw new NuniError(502, 'INVALID_RESPONSE');
      return items;
    },
    quizFeedback,
    reviewQuizResponse: quizFeedback,
    async closeQuiz(id: string, quizId: string) {
      const item = await quiz(
        await transport(`${path(id)}/quizzes/${nuniId(quizId, 'cwq')}/close`, {}),
        id,
        quizId,
      );
      if (item.state !== 'closed') throw new NuniError(502, 'INVALID_RESPONSE');
      return item;
    },
  };
}

export function nuniErrorMessage(error: unknown): string {
  if (error instanceof NuniError) {
    if (error.code === 'SESSION_CHANGED') return '帳號已變更，請重新整理後再操作。';
    if (error.code === 'CLASS_WORKSPACE_MATERIAL_CURSOR_INVALID')
      return '教材頁面已失效，請更新教材後再試。';
    if (error.code === 'ASSIGNMENT_FILE_TYPE_REJECTED')
      return '這個檔案類型不能繳交。請改傳照片、PDF、Word、文字或 ZIP。';
    if (error.code === 'ASSIGNMENT_FILE_TOO_LARGE')
      return '檔案太大。照片上限 10 MB，其他檔案上限 20 MB。';
    if (error.code === 'ASSIGNMENT_FILE_LIMIT') return '最多 8 張照片、2 個檔案，對齊課堂實務用量。';
    if (error.code === 'ASSIGNMENT_FILE_REQUIRED') return '請先拍照、選相簿或選檔，再送出。';
    if (error.code === 'ASSIGNMENT_FILE_NAME_INVALID') return '檔名無法使用，請重新命名後再選一次。';
    if (error.code === 'ASSIGNMENT_FILE_SIZE_REJECTED') return '檔案大小不正確，請重新選擇。';
    if (error.code === 'ASSIGNMENT_REVISION_CLOSED') return '已過截止時間，不能再修改或撤回繳交。';
    if (error.code === 'ASSIGNMENT_SUBMISSION_CHANGED') return '繳交內容已有更新，請重新整理後再試。';
    if (error.code === 'ASSIGNMENT_CLOSED') return '老師已停止收件，目前不能再繳交。';
    if (error.code === 'ASSIGNMENT_FILE_SUBMIT_DISABLED') return '檔案繳交尚未開放。';
    if (error.code === 'ASSIGNMENT_FILE_UPLOAD_UNAVAILABLE')
      return '目前無法上傳檔案。請保留已選內容，稍後重試。';
    if (error.status === 401) return '登入已逾時，請重新登入。';
    if (error.status === 403) return '你目前沒有這項操作的權限。';
    if (error.status === 404) return '找不到這筆資料，可能已被移除。';
    if (error.status === 409) return '資料已變更，請更新後確認目前狀態。';
    if (error.status === 429) return '操作較頻繁，請稍候再試。';
    if (error.status === 400 || error.status === 422) return '請確認填寫內容與邀請碼是否正確。';
  }
  return '目前無法連線。請保留填寫內容，稍後重試。';
}
