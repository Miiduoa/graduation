import { randomUUID } from 'node:crypto';
import { NuniError } from '@campus/shared/src/nuni';
import type { TronClassAgentGrant, TronClassAgentScope, TronClassRequiredAgentGrant } from '@campus/shared/src/tronClassAgentPermissions';
import type {
  TronClassAgentAction, TronClassAgentAskInput, TronClassAgentCapabilities,
  TronClassAgentCapabilityResult, TronClassAgentReply, TronClassAgentStep,
} from '../tronClassAgentTypes';
import { TRONCLASS_AGENT_MAX_ACTIONS } from '../tronClassAgentTypes';
import { parseTronClassAgentIntent } from '../tronClassAgentIntent';
import type { TronClassHomeworkItem, TronClassPreparation, TronClassSnapshot } from '../tronClassIntegrationTypes';
import { tronClassUploadKey } from '../tronClassIntegrationClient';
import { createTronClassAgentGrantService } from './tronClassAgentGrants';
import { createTronClassIntegrationReader } from './tronClassIntegrationSource';
import { getDefaultTronClassSubmissionService } from './tronClassSubmission';

export type TronClassAgentGrants = Pick<ReturnType<typeof createTronClassAgentGrantService>, 'get' | 'require' | 'assertCurrent'>;
export type TronClassAgentDependencies = {
  grants?: TronClassAgentGrants;
  read?: ReturnType<typeof createTronClassIntegrationReader>;
  prepare?: (ownerKey: string, input: { courseId: number; homeworkId: number }) => Promise<TronClassPreparation>;
  now?: () => number;
  requestId?: () => string;
  /** Reauthenticate the nuni actor before the final grant check and response. */
  beforeResult?: () => Promise<void>;
};

const AGENT_PREPARATION_ONLY = 'Agent 已開啟作業準備區；目前不會代為上傳附件或送交作業。';
const normalize = (value: string) => value.normalize('NFKC').replace(/\s+/g, '').toLocaleLowerCase();
const containsName = (question: string, name: string) => normalize(name).length > 1 && normalize(question).includes(normalize(name));
const positiveId = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0;

export function tronClassAgentCapabilities(grant: TronClassAgentGrant): TronClassAgentCapabilities {
  const read = grant.permissions.readCourseData && grant.version !== null;
  return {
    readCourseData: read,
    downloadMaterials: read && grant.permissions.downloadMaterials,
    prepareHomework: read && grant.permissions.prepareHomework,
    submitHomework: false,
    limitations: [
      'Agent 可在你開啟對應權限後查詢課程、下載教材、準備作業。',
      '目前尚未核實校方的寫入契約，Agent 不會送交作業、發文、填答或修改校方資料。',
    ],
  };
}

function sameGrant(first: TronClassAgentGrant, second: TronClassAgentGrant): void {
  if (first.revision !== second.revision || first.version !== second.version) throw new NuniError(409, 'TRONCLASS_AGENT_PERMISSION_CHANGED');
}

/** Compare literals only. School text is data and never enters the command router. */
function isUnqualifiedRequest(question: string, names: string[]): boolean {
  let remainder = normalize(question);
  for (const name of names) if (normalize(name).length > 1) remainder = remainder.split(normalize(name)).join('');
  return remainder
    .replace(/tronclass|創課|玩課雲|請問|可以|麻煩|能不能|幫我|替我|請|我要|我想|我的|這個|這門|這份|這|全部|所有|一下|的|把|將/g, '')
    .replace(/下載|教材|講義|檔案|附件|準備|預覽|草稿|作業|課程|未交|未繳|待交|待繳|尚未|還沒/g, '')
    .replace(/please|download|prepare|draft|my|the|all|materials?|handouts?|files?|homework|assignments?|courses?/g, '')
    .replace(/[\p{P}\p{S}]/gu, '').length === 0;
}

function selectedSnapshot(snapshot: TronClassSnapshot, options: {
  courseId?: number; homework?: TronClassHomeworkItem[]; announcements?: boolean; materials?: boolean;
} = {}): TronClassSnapshot {
  return {
    ...snapshot,
    courses: options.courseId ? snapshot.courses.filter((course) => course.id === options.courseId) : snapshot.courses,
    homework: options.homework ?? [],
    announcements: options.announcements ? snapshot.announcements : [],
    materials: options.materials ? snapshot.materials : [],
  };
}

function homeworkAnswer(snapshot: TronClassSnapshot, pendingOnly: boolean): string {
  const pending = snapshot.homework.filter((item) => item.submitted === false).length;
  const unknown = snapshot.homework.filter((item) => item.submitted === null).length;
  const submitted = snapshot.homework.filter((item) => item.submitted === true).length;
  const prefix = snapshot.partial ? '這次只讀到部分課程資料。' : '';
  if (!snapshot.homework.length) return `${prefix}${snapshot.partial
    ? '目前沒有可確認的作業結果，不能據此判定全部作業已繳交。'
    : pendingOnly ? '這次同步沒有找到未繳交或狀態待確認的作業。' : '這次同步沒有找到作業。'}`;
  return `${prefix}已確認 ${pending} 份作業尚未繳交${!pendingOnly ? `、${submitted} 份已繳交` : ''}。${unknown
    ? `另有 ${unknown} 份的繳交狀態尚未確認，已另外標示，請勿當作未交或已交。` : ''}`;
}

function downloadActions(snapshot: TronClassSnapshot, question: string, mayAutomaticallyDownload: boolean): TronClassAgentAction[] {
  const candidates = snapshot.materials.flatMap((material) => {
    const activityId = typeof material.id === 'number' ? material.id : /^[1-9]\d*$/.test(material.id) ? Number(material.id) : null;
    if (!positiveId(material.courseId) || !positiveId(activityId)) return [];
    return material.files.flatMap((file) => {
      const uploadKey = file.allowDownload ? tronClassUploadKey(file.downloadHref) : null;
      return uploadKey ? [{ material, file, activityId, courseId: material.courseId!, uploadKey }] : [];
    });
  });
  const fileMatches = candidates.filter(({ file }) => containsName(question, file.name));
  const titleMatches = candidates.filter(({ material }) => containsName(question, material.title));
  const matching = fileMatches.length ? fileMatches : titleMatches;
  const seen = new Set<string>();
  const selected = (matching.length ? matching : candidates).filter(({ courseId, activityId, uploadKey }) => {
    const key = `${courseId}:${activityId}:${uploadKey}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  // A full known title or an otherwise generic request is required. "Latest",
  // "week 3", or an unknown filename cannot silently select a different file.
  const knownNames = [
    ...snapshot.courses.map((course) => course.name),
    ...selected.flatMap(({ material, file }) => [material.title, file.name]),
  ];
  const automatic = mayAutomaticallyDownload && !snapshot.partial && selected.length === 1 &&
    isUnqualifiedRequest(question, knownNames);
  return selected.map(({ file, activityId, courseId, uploadKey }) => {
    const key = `${courseId}:${activityId}:${uploadKey}`;
    return { kind: 'download_material' as const, id: `material:${key}`, courseId, activityId, uploadKey,
      name: file.name, revision: snapshot.revision, automatic };
  });
}

export function createTronClassAgentService(dependencies: TronClassAgentDependencies = {}) {
  const grants = dependencies.grants ?? createTronClassAgentGrantService();
  // One overview and one selected-course read remain bounded within a request.
  const read = dependencies.read ?? createTronClassIntegrationReader({ budgetMs: 20_000 });
  const prepareSource = dependencies.prepare ?? (async (ownerKey, input) => (await getDefaultTronClassSubmissionService()).prepare(ownerKey, input));
  const now = dependencies.now ?? Date.now;
  const requestId = dependencies.requestId ?? randomUUID;

  async function requireScopes(ownerKey: string, scope: TronClassAgentScope = 'readCourseData'): Promise<TronClassRequiredAgentGrant> {
    const grant = await grants.require(ownerKey, 'readCourseData');
    if (scope !== 'readCourseData') sameGrant(grant, await grants.require(ownerKey, scope));
    return grant;
  }
  async function assertScopes(ownerKey: string, grant: TronClassRequiredAgentGrant, scope: TronClassAgentScope): Promise<void> {
    await grants.assertCurrent(ownerKey, grant, 'readCourseData');
    if (scope !== 'readCourseData') await grants.assertCurrent(ownerKey, grant, scope);
  }
  async function prepareWithGrant(ownerKey: string, input: { courseId: number; homeworkId: number }, grant: TronClassRequiredAgentGrant) {
    if (!positiveId(input.courseId) || !positiveId(input.homeworkId)) throw new NuniError(422, 'TRONCLASS_INVALID_INPUT');
    await assertScopes(ownerKey, grant, 'prepareHomework');
    const result = await prepareSource(ownerKey, input);
    if (result.revision !== grant.revision || result.courseId !== input.courseId || result.homeworkId !== input.homeworkId) {
      throw new NuniError(409, 'TRONCLASS_BINDING_CHANGED');
    }
    await assertScopes(ownerKey, grant, 'prepareHomework');
    // A future provider rollout must not implicitly turn this read/prepare grant
    // into permission for Agent writes. Agent deliberately has no writer method.
    return { ...result, canSubmit: false, blockedReason: result.blockedReason || AGENT_PREPARATION_ONLY };
  }

  return {
    async capability(ownerKey: string): Promise<TronClassAgentCapabilityResult> {
      const grant = await grants.get(ownerKey);
      await dependencies.beforeResult?.();
      sameGrant(grant, await grants.get(ownerKey));
      return { source: 'tronclass', revision: grant.revision, grantVersion: grant.version, capabilities: tronClassAgentCapabilities(grant) };
    },
    async prepare(ownerKey: string, input: { courseId: number; homeworkId: number }): Promise<TronClassPreparation> {
      const grant = await requireScopes(ownerKey, 'prepareHomework');
      const result = await prepareWithGrant(ownerKey, input, grant);
      await dependencies.beforeResult?.();
      await assertScopes(ownerKey, grant, 'prepareHomework');
      return result;
    },
    async ask(ownerKey: string, input: TronClassAgentAskInput): Promise<TronClassAgentReply> {
      const query = parseTronClassAgentIntent(input.question);
      if (!query || (input.courseId !== undefined && !positiveId(input.courseId)) ||
        (input.homeworkId !== undefined && (!positiveId(input.homeworkId) || !input.courseId || query.intent !== 'prepare'))) {
        throw new NuniError(422, 'TRONCLASS_INVALID_INPUT');
      }
      const scope = query.intent === 'download' ? 'downloadMaterials' : query.intent === 'prepare' ? 'prepareHomework' : 'readCourseData';
      const grant = await requireScopes(ownerKey, scope);
      const capabilities = tronClassAgentCapabilities(grant);
      const steps: TronClassAgentStep[] = [];
      const base = { source: 'tronclass' as const, requestId: requestId(), intent: query.intent,
        revision: grant.revision, grantVersion: grant.version, fetchedAt: new Date(now()).toISOString(),
        capabilities, steps, preparation: null, actions: [], selection: null, snapshot: null };
      const finish = async (result: TronClassAgentReply): Promise<TronClassAgentReply> => {
        await dependencies.beforeResult?.();
        await assertScopes(ownerKey, grant, scope);
        if (result.actions.length > TRONCLASS_AGENT_MAX_ACTIONS) {
          const message = `目前列出前 ${TRONCLASS_AGENT_MAX_ACTIONS} 個操作選項，共有 ${result.actions.length} 個；可指定課程、作業名稱或教材檔名繼續操作。`;
          return { ...result, actions: result.actions.slice(0, TRONCLASS_AGENT_MAX_ACTIONS), answer: `${result.answer}${message}`,
            steps: [...result.steps, { id: 'action-limit', tool: 'select_target', status: 'partial', message }] };
        }
        return result;
      };
      if (query.intent === 'capabilities' || query.intent === 'unsupported') {
        return finish({ ...base, answer: query.intent === 'unsupported'
          ? query.unsupportedReason === 'multiple_actions'
            ? '請先選擇要下載教材，或要準備哪一份作業；確認一個目標後，我會完成該步驟，再處理下一項。'
            : '這項操作目前尚未開放給 Agent。可以協助查詢課程、作業狀態與公告、下載教材，或先準備作業；目前不會送交或修改校方資料。'
          : '可依你開啟的權限查詢 TronClass 課程與作業、整理公告教材、下載教材，並在對話內準備作業。送交、發文與其他校方寫入操作目前尚未開放。',
        steps: [{ id: 'capability', tool: 'select_target', status: query.intent === 'unsupported' ? 'blocked' : 'completed', message: '已核對 Agent 可用功能與授權範圍。' }] });
      }
      const guardedRead = async (courseId?: number) => {
        await assertScopes(ownerKey, grant, scope);
        const result = await read(ownerKey, courseId ? { courseId } : {});
        if (result.revision !== grant.revision) throw new NuniError(409, 'TRONCLASS_BINDING_CHANGED');
        if (courseId && !result.courses.some((course) => course.id === courseId)) throw new NuniError(403, 'TRONCLASS_COURSE_NOT_FOUND');
        await assertScopes(ownerKey, grant, scope);
        return result;
      };
      let snapshot = await guardedRead(input.courseId);
      steps.push({ id: 'courses', tool: 'read_courses', status: snapshot.errors.some((error) => error.area === 'courses') ? 'partial' : 'completed', message: `已核對目前帳號的 ${snapshot.courses.length} 門課程。` });
      if (query.intent === 'courses') return finish({ ...base, fetchedAt: snapshot.fetchedAt,
        snapshot: selectedSnapshot(snapshot, { courseId: input.courseId }),
        answer: `${snapshot.partial ? '部分課程資料尚未讀完。' : ''}已讀取 ${snapshot.courses.length} 門 TronClass 課程，可在這裡選擇課程查看作業、公告與教材。` });

      let courseId = input.courseId;
      if (!courseId) {
        const matches = snapshot.courses.filter((course) => containsName(input.question, course.name) ||
          (course.code.length > 1 && containsName(input.question, course.code)));
        if (matches.length === 1) courseId = matches[0].id;
        else if (['materials', 'announcements', 'download'].includes(query.intent) && snapshot.courses.length === 1 &&
          !snapshot.partial && isUnqualifiedRequest(input.question, ['公告', '通知', ...snapshot.courses.map((course) => course.name)])) {
          courseId = snapshot.courses[0].id;
        }
        if (courseId) snapshot = await guardedRead(courseId);
      }
      if (['materials', 'announcements', 'download'].includes(query.intent) && !courseId) {
        steps.push({ id: 'choose-course', tool: 'select_target', status: 'blocked', message: '尚未選定唯一課程，沒有替你猜測教材或公告來源。' });
        return finish({ ...base, fetchedAt: snapshot.fetchedAt, snapshot: selectedSnapshot(snapshot), selection: 'course',
          answer: snapshot.courses.length ? '請選擇要查詢的課程，我會接著讀取這門課的公告或教材。' : '這次未取得可選的課程，請重新整理 TronClass 連線。' });
      }
      if (query.intent === 'homework') {
        const homework = snapshot.homework.filter((item) => (!courseId || item.courseId === courseId) && (!query.pendingOnly || item.submitted !== true));
        const result = selectedSnapshot(snapshot, { courseId, homework });
        steps.push({ id: 'homework', tool: 'read_homework', status: snapshot.partial ? 'partial' : 'completed', message: '已讀取作業與校方提供的繳交狀態；未回傳狀態的項目保留為待確認。' });
        const actions: TronClassAgentAction[] = capabilities.prepareHomework ? homework.map((item) => ({ kind: 'prepare_homework', id: `homework:${item.courseId}:${item.id}`, courseId: item.courseId, homeworkId: item.id, title: item.title, revision: grant.revision })) : [];
        return finish({ ...base, fetchedAt: snapshot.fetchedAt, snapshot: result, actions, answer: homeworkAnswer(result, query.pendingOnly) });
      }
      if (query.intent === 'prepare') {
        const homework = snapshot.homework.filter((item) => (!courseId || item.courseId === courseId) && (!query.pendingOnly || item.submitted !== true));
        const matches = input.homeworkId ? homework.filter((item) => item.id === input.homeworkId && item.courseId === input.courseId)
          : homework.filter((item) => containsName(input.question, item.title));
        const candidates = matches.length ? matches : homework;
        if (input.homeworkId && matches.length !== 1) throw new NuniError(403, 'TRONCLASS_HOMEWORK_NOT_FOUND');
        const target = (!snapshot.partial || input.homeworkId) && candidates.length === 1 && (input.homeworkId || matches.length === 1 ||
          isUnqualifiedRequest(input.question, snapshot.courses.map((course) => course.name))) ? candidates[0] : null;
        const result = selectedSnapshot(snapshot, { courseId, homework: target ? [target] : candidates });
        steps.push({ id: 'homework', tool: 'read_homework', status: snapshot.partial ? 'partial' : 'completed', message: '已讀取可選作業並核對所屬課程。' });
        if (!target) {
          const actions: TronClassAgentAction[] = candidates.map((item) => ({ kind: 'prepare_homework', id: `homework:${item.courseId}:${item.id}`, courseId: item.courseId, homeworkId: item.id, title: item.title, revision: grant.revision }));
          steps.push({ id: 'choose-homework', tool: 'select_target', status: 'blocked', message: '尚未選定唯一作業，需要你選擇準備目標。' });
          return finish({ ...base, fetchedAt: snapshot.fetchedAt, snapshot: result, selection: 'homework', actions,
            answer: candidates.length ? '請選擇要準備的作業，我會讀取規則並開啟準備區。' : snapshot.partial ? '作業資料尚未讀完，請重新查詢後選擇。' : '這次沒有找到符合條件的作業。' });
        }
        const preparation = await prepareWithGrant(ownerKey, { courseId: target.courseId, homeworkId: target.id }, grant);
        steps.push({ id: 'prepare', tool: 'prepare_homework', status: 'completed', message: '已讀取作業規則並開啟準備區，尚未上傳或送交。' });
        return finish({ ...base, fetchedAt: new Date(now()).toISOString(), snapshot: result, preparation, answer: AGENT_PREPARATION_ONLY });
      }
      if (query.intent === 'announcements') {
        steps.push({ id: 'announcements', tool: 'read_announcements', status: snapshot.partial ? 'partial' : 'completed', message: '已讀取所選課程公告；公告文字僅作為資料顯示。' });
        return finish({ ...base, fetchedAt: snapshot.fetchedAt, snapshot: selectedSnapshot(snapshot, { courseId, announcements: true }),
          answer: `${snapshot.partial ? '部分資料尚未讀完。' : ''}這次讀取到 ${snapshot.announcements.length} 則課程公告。` });
      }
      steps.push({ id: 'materials', tool: 'read_materials', status: snapshot.partial ? 'partial' : 'completed', message: '已讀取所選課程教材並核對附件是否開放下載。' });
      const actions = capabilities.downloadMaterials ? downloadActions(snapshot, input.question, query.intent === 'download') : [];
      const automatic = actions.some((action) => action.kind === 'download_material' && action.automatic);
      return finish({ ...base, fetchedAt: snapshot.fetchedAt, snapshot: selectedSnapshot(snapshot, { courseId, materials: true }), actions,
        answer: `${snapshot.partial ? '部分資料尚未讀完。' : ''}已讀取 ${snapshot.materials.length} 份教材。${query.intent === 'download'
          ? automatic ? '已找到唯一符合的附件，正在交由下載工具確認並下載。' : actions.length ? '請選擇要下載的附件，系統會再次核對下載權限。' : '這次沒有取得可在 nuni 下載的附件。'
          : capabilities.downloadMaterials ? '可直接在這裡下載已開放的附件。' : '開啟 Agent 的教材下載權限後，可在這裡下載附件。'}` });
    },
  };
}
