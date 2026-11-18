import type {
  TronClassAgentGrant,
  TronClassAgentPermissions,
} from '@campus/shared/src/tronClassAgentPermissions';
import {
  downloadedTronClassFile,
  parseTronClassResult,
  tronClassUploadKey,
  TronClassRequestError,
  type TronClassIdentity,
} from './tronClassIntegrationClient';
import type { TronClassPreparation, TronClassSnapshot } from './tronClassIntegrationTypes';
import type { TronClassAgentCapabilities, TronClassAgentReply } from './tronClassAgentTypes';
import { TRONCLASS_AGENT_MAX_ACTIONS } from './tronClassAgentTypes';
import { parseTronClassAgentIntent } from './tronClassAgentIntent';

export type TronClassAgentQuestion = { question: string; courseId?: number; homeworkId?: number };

export function isTronClassAuthorityError(reason: unknown): boolean {
  return reason instanceof TronClassRequestError && (reason.status === 401 || [
    'SESSION_CHANGED', 'TRONCLASS_NOT_CONNECTED', 'TRONCLASS_RECONNECT_REQUIRED',
    'TRONCLASS_BINDING_CHANGED', 'TRONCLASS_AGENT_PERMISSION_REQUIRED',
    'TRONCLASS_AGENT_PERMISSION_CHANGED', 'TRONCLASS_DISABLED',
  ].includes(reason.code));
}

const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === 'string';
const id = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
const revision = (value: unknown): value is string =>
  text(value) && /^[a-f0-9]{32}$/.test(value);
const time = (value: unknown): value is string => text(value) && Number.isFinite(Date.parse(value));
const invalid = (): never => {
  throw new TronClassRequestError('INVALID_RESPONSE', '尚未收到可確認的回覆，請重新查詢 TronClass。');
};

function permissions(value: unknown): value is TronClassAgentPermissions {
  return record(value) &&
    typeof value.readCourseData === 'boolean' &&
    typeof value.downloadMaterials === 'boolean' &&
    typeof value.prepareHomework === 'boolean' &&
    (value.readCourseData || (!value.downloadMaterials && !value.prepareHomework));
}

function parseGrant(value: unknown): TronClassAgentGrant {
  if (!record(value) || !revision(value.revision) ||
    !(value.version === null || revision(value.version)) || !permissions(value.permissions) ||
    !(value.updatedAt === null || time(value.updatedAt))) return invalid();
  return value as TronClassAgentGrant;
}

function capabilities(value: unknown): value is TronClassAgentCapabilities {
  return record(value) && value.submitHomework === false &&
    Array.isArray(value.limitations) && value.limitations.length <= 30 && value.limitations.every(text) && permissions(value);
}

function parseReply(value: unknown): TronClassAgentReply {
  if (!record(value) || value.source !== 'tronclass' || !text(value.requestId) ||
    !/^[A-Za-z0-9_-]{16,80}$/.test(value.requestId) || !revision(value.revision) ||
    !revision(value.grantVersion) || !time(value.fetchedAt) || !text(value.answer) ||
    !['courses', 'homework', 'announcements', 'materials', 'download', 'prepare', 'capabilities', 'unsupported'].includes(String(value.intent)) ||
    ![null, 'course', 'homework'].includes(value.selection as null | string) ||
    !capabilities(value.capabilities) || !Array.isArray(value.actions) || value.actions.length > TRONCLASS_AGENT_MAX_ACTIONS ||
    !Array.isArray(value.steps) || value.steps.length > 50 || !value.steps.every(step =>
      record(step) && text(step.id) && text(step.message) &&
      ['read_courses', 'read_homework', 'read_announcements', 'read_materials', 'prepare_homework', 'select_target'].includes(String(step.tool)) &&
      ['completed', 'partial', 'blocked'].includes(String(step.status)))) return invalid();
  const snapshot = value.snapshot === null ? null :
    parseTronClassResult('sync', value.snapshot, {}) as TronClassSnapshot;
  if (snapshot && snapshot.revision !== value.revision) return invalid();
  if (value.preparation !== null) {
    if (!record(value.preparation) || !id(value.preparation.courseId) || !id(value.preparation.homeworkId)) return invalid();
    const preparation = parseTronClassResult('prepare', value.preparation, {
      courseId: value.preparation.courseId, homeworkId: value.preparation.homeworkId,
    }) as TronClassPreparation;
    if (preparation.revision !== value.revision || preparation.canSubmit || !value.capabilities.prepareHomework ||
      !snapshot?.homework.some(item => item.courseId === preparation.courseId && item.id === preparation.homeworkId)) return invalid();
  }
  const actionIds = new Set<string>();
  for (const action of value.actions) {
    if (!record(action) || !text(action.id) || !action.id || actionIds.has(action.id) ||
      action.revision !== value.revision || !id(action.courseId)) return invalid();
    actionIds.add(action.id);
    if (action.kind === 'download_material') {
      if (!id(action.activityId) || !text(action.uploadKey) || !text(action.name) ||
        typeof action.automatic !== 'boolean' || !value.capabilities.downloadMaterials ||
        !snapshot?.materials.some(material => material.courseId === action.courseId &&
          String(material.id) === String(action.activityId) && material.files.some(file =>
            file.allowDownload && tronClassUploadKey(file.downloadHref) === action.uploadKey))) return invalid();
    } else if (action.kind === 'prepare_homework') {
      if (!id(action.homeworkId) || !text(action.title) || !value.capabilities.prepareHomework ||
        !snapshot?.homework.some(item => item.courseId === action.courseId && item.id === action.homeworkId)) return invalid();
    } else return invalid();
  }
  const automatic = value.actions.filter(action => record(action) && action.kind === 'download_material' && action.automatic);
  if (automatic.length > 1 || (automatic.length === 1 && value.intent !== 'download')) return invalid();
  return value as TronClassAgentReply;
}

export function createTronClassAgentClient(identity: TronClassIdentity) {
  async function authHeaders(): Promise<Record<string, string>> {
    return identity.kind === 'platform'
      ? { 'X-Campus-Session': identity.context }
      : { Authorization: `Bearer ${await identity.getIdToken()}` };
  }

  async function responseValue(response: Response): Promise<unknown> {
    let value: unknown;
    try { value = await response.json(); } catch { return invalid(); }
    if (!response.ok) {
      throw new TronClassRequestError(
        record(value) && text(value.error) ? value.error : 'REQUEST_FAILED',
        record(value) && text(value.message) ? value.message : '暫時無法完成 TronClass 操作，請稍後再試。',
        response.status,
      );
    }
    return value;
  }

  async function request(path: string, input: object, signal?: AbortSignal): Promise<Response> {
    const headers = await authHeaders();
    const timeout = AbortSignal.timeout(60000);
    const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
    requestSignal.throwIfAborted();
    const response = await fetch(path, {
      method: 'POST', credentials: 'same-origin', cache: 'no-store', redirect: 'error',
      signal: requestSignal, headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    requestSignal.throwIfAborted();
    return response;
  }

  return {
    async grant(signal?: AbortSignal): Promise<TronClassAgentGrant> {
      return parseGrant(await responseValue(await request('/api/tronclass/agent-permissions', { action: 'status' }, signal)));
    },
    async setGrant(input: {
      revision: string; expectedVersion: string | null; permissions: TronClassAgentPermissions;
    }, signal?: AbortSignal): Promise<TronClassAgentGrant> {
      if (!revision(input.revision) || !(input.expectedVersion === null || revision(input.expectedVersion)) ||
        !permissions(input.permissions)) return invalid();
      const result = parseGrant(await responseValue(await request('/api/tronclass/agent-permissions', { ...input, action: 'set' }, signal)));
      if (result.revision !== input.revision || !result.version || result.version === input.expectedVersion ||
        Object.keys(input.permissions).some(key => result.permissions[key as keyof TronClassAgentPermissions] !== input.permissions[key as keyof TronClassAgentPermissions])) return invalid();
      return result;
    },
    async ask(input: TronClassAgentQuestion, signal?: AbortSignal): Promise<TronClassAgentReply> {
      const intent = parseTronClassAgentIntent(input.question);
      if (!input.question.trim() || input.question.length > 1000 ||
        !intent ||
        (input.courseId !== undefined && !id(input.courseId)) ||
        (input.homeworkId !== undefined && (!id(input.homeworkId) || !id(input.courseId) || intent.intent !== 'prepare'))) return invalid();
      const result = parseReply(await responseValue(await request('/api/tronclass/agent', { ...input, action: 'ask' }, signal)));
      if (result.intent !== intent.intent || (input.homeworkId !== undefined && result.preparation &&
        (result.preparation.courseId !== input.courseId || result.preparation.homeworkId !== input.homeworkId)) ||
        (input.courseId !== undefined && result.snapshot && (
          !result.snapshot.courses.some(course => course.id === input.courseId) ||
          [...result.snapshot.homework, ...result.snapshot.announcements, ...result.snapshot.materials]
            .some(item => item.courseId !== input.courseId)
        ))) return invalid();
      return result;
    },
    async prepare(courseId: number, homeworkId: number, signal?: AbortSignal): Promise<TronClassPreparation> {
      if (!id(courseId) || !id(homeworkId)) return invalid();
      const value = parseTronClassResult('prepare', await responseValue(await request('/api/tronclass/agent', {
        action: 'prepare', courseId, homeworkId,
      }, signal)), { courseId, homeworkId }) as TronClassPreparation;
      if (value.canSubmit) return invalid();
      return value;
    },
    async downloadMaterial(input: { courseId: number; activityId: number; uploadKey: string; revision: string }, signal?: AbortSignal): Promise<{ blob: Blob; filename: string }> {
      if (!id(input.courseId) || !id(input.activityId) || !revision(input.revision) ||
        !/^[A-Za-z0-9._-]{1,200}$/.test(input.uploadKey) || ['.', '..'].includes(input.uploadKey)) return invalid();
      const response = await request('/api/tronclass/agent/download', input, signal);
      if (!response.ok) await responseValue(response);
      const file = await downloadedTronClassFile(response);
      signal?.throwIfAborted();
      return file;
    },
  };
}

export type TronClassAgentClient = ReturnType<typeof createTronClassAgentClient>;
