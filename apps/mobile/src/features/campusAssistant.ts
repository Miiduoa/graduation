import { getSchoolContactAnswer } from '@campus/shared/src/schoolContactAnswer';
import { resolvePublicCourseAssistantIntent } from '@campus/shared/src/publicCourseAssistant';
import { answerPublicCourseQuestion, type PublicCourseAssistantRead } from '@campus/shared/src/publicCourseAssistantClient';
import { httpsCallable } from 'firebase/functions';
import { ASSISTANT_SERVICES, resolveAssistantServiceIntent } from '@campus/shared/src/assistantServices';
import { parseImportedAcademicIntent, summarizeImportedAcademics,
  formatImportedAcademicSummary } from '@campus/shared/src/importedAcademicSummary';
import { getAuthInstance, getFunctionsInstance, isFirebaseMockMode } from '../firebase';
import { campusAgentWriteProposals, type CampusAgentWriteProposal } from './campusAssistantActions';
import { validCampusSenseSnapshot, type CampusSenseSnapshot } from '../services/campusSenseSnapshot';
import type { CampusEvidencePlan } from '../services/offlineCampusPlanner';
import type { LocalCampusReadResult } from '../services/localCampusToolProtocol';

import { abortableCampusRead } from '../services/abortableCampusRead';
import type { PlatformTimetableAccess } from '../services/assistantTimetableSource';
import type { AnnouncementRead, AssignmentRead, OfflineCampusToolResult } from '../services/offlineCampusTools';
import {
  answerSavedClassGapQuery, savedClassGapFollowUp, savedClassGapQuery,
  isSavedClassGapQuestion, isSavedClassGapRefinement, type SavedClassGapQuery,
} from '../services/savedClassGapQuery';
import { answerSavedClassQuery, savedClassQuery, type SavedClassRead } from '../services/savedClassQuery';
import { answerCourseworkReminder, isCourseworkReminderQuestion } from './nuniCourseworkReminder';
import { courseworkSnapshotAnswer } from './nuniCourseworkSnapshot';
import { answerCourseworkStudyIntent, type CourseworkStudyChoice, type CourseworkStudySelection } from './nuniCourseworkStudyIntent';
import { answerNuniCoursework, classCourseworkQuestion, type CourseworkChoice,
  type CourseworkRead, type CourseworkRequests } from './nuniCourseworkFollowUp';
import { taipeiDayNumber } from '../services/campusStudyAgenda';
import { assignmentFollowUp } from '../services/assignmentFollowUp';
import type { AssistantServiceSelection } from '../services/assistantServiceNavigation';
import { parseAssistantCalendarIntent } from '../services/assistantCalendarIntent';
import { parseAssistantCalendarBatchIntent } from '../services/assistantCalendarBatchIntent';
import { prepareAssistantCalendarBatch, type AssistantCalendarBatchView } from '../services/assistantCalendarBatchExecution';
import { assistantCalendarOwner, createAssistantCalendarTask, findPersistedAssistantCalendarTask,
  recheckAssistantCalendarTask, sameAssistantCalendarEvent,
  type AssistantCalendarTask } from '../services/assistantCalendarExecution';
import { isNuniCampusPlanningQuestion } from '../services/nuniCampusPlanner';

export type ImportedAcademicRead = { owner: string; schoolId: string; checkedAt: string };

type ClassGapRead = SavedClassGapQuery & { owner: string; schoolId: string; checkedAt: string };

export type CampusAssistantMessage = {
  role: 'user' | 'assistant';
  content: string;
  tool?: OfflineCampusToolResult['tool'] | 'local-agent' | 'saved-academics' | 'calendar-action' | 'school-directory' | 'public-course-catalog';
  route?: string;
  serviceSelection?: AssistantServiceSelection;
  academicRead?: ImportedAcademicRead;
  calendarTask?: AssistantCalendarTask;
  calendarBatch?: AssistantCalendarBatchView;
  assignmentRead?: AssignmentRead;
  announcementRead?: AnnouncementRead;
  savedClassRead?: SavedClassRead;
  classGapRead?: ClassGapRead;
  courseworkRead?: CourseworkRead;
  publicCourseRead?: PublicCourseAssistantRead;
  courseworkStudy?: CourseworkStudySelection;
  courseworkStudyCheckedAt?: string;
};
export type CampusAssistantScope = { uid: string; schoolId: string };
export type CampusAssistantMode = 'device' | 'campus';

export interface OnDeviceAssistantReadiness {
  available: boolean;
  modelId: string;
  ready: boolean;
  reason: string | null;
}

export class OnDeviceAssistantError extends Error {
  constructor(public readonly code: 'native-unavailable' | 'model-required' | 'model-failed' | 'model-busy' | 'cancelled' | 'session-changed') {
    super(code === 'session-changed' ? 'Assistant session changed' : code);
    this.name = 'OnDeviceAssistantError';
  }
}

function engine() {
  // Lazy import avoids loading a native inference module on the cloud-only path.
  return require('../services/localLLMInference') as typeof import('../services/localLLMInference');
}

function scopeCheck(input: { scope: CampusAssistantScope; isCurrent: () => boolean; platformTimetable?: PlatformTimetableAccess }, requiresAuth: boolean) {
  if (!input.isCurrent()) throw new OnDeviceAssistantError('session-changed');
  if (input.platformTimetable) {
    if (requiresAuth || input.scope.uid || !input.scope.schoolId || !input.platformTimetable.accountId ||
        !input.platformTimetable.isCurrent()) throw new OnDeviceAssistantError('session-changed');
    return;
  }
  if (requiresAuth && (isFirebaseMockMode() || !input.scope.uid || !input.scope.schoolId ||
      getAuthInstance().currentUser?.uid !== input.scope.uid)) {
    throw new OnDeviceAssistantError('session-changed');
  }
  if (!requiresAuth && input.scope.uid && !isFirebaseMockMode() &&
      getAuthInstance().currentUser?.uid !== input.scope.uid) {
    throw new OnDeviceAssistantError('session-changed');
  }
}

/** Never downloads or calls a paid provider while checking status. */
export async function getOnDeviceAssistantReadiness(): Promise<OnDeviceAssistantReadiness> {
  const { localLLM, getDefaultLocalLlmModelId } = engine();
  const runtime = localLLM.getRuntimeAvailability();
  const saved = await localLLM.getSavedModelId();
  const modelId = saved || getDefaultLocalLlmModelId();
  if (!runtime.available) {
    return { available: false, modelId, ready: false, reason: runtime.reason || '手機 AI 引擎尚未載入' };
  }
  if (await localLLM.isModelDownloaded(modelId)) {
    return { available: true, modelId, ready: true, reason: null };
  }
  const alternatives = await localLLM.getDownloadedModels();
  if (alternatives.length) {
    return { available: true, modelId: alternatives[0], ready: true, reason: null };
  }
  return { available: true, modelId, ready: false, reason: '請先下載免費模型；下載後可在沒有網路時使用。' };
}

export async function askCampusAssistant(input: {
  scope: CampusAssistantScope;
  messages: CampusAssistantMessage[];
  isCurrent: () => boolean;
  platformTimetable?: PlatformTimetableAccess;
  courseworkRequests?: CourseworkRequests;
  courseworkChoice?: CourseworkChoice;
  courseworkStudyChoice?: CourseworkStudyChoice;
  /** Optional per-request native cancellation; never cancels unrelated tasks. */
  signal?: AbortSignal;
  schoolName?: string | null;
  /** Authorized campus reads are only used after an explicit user refresh. */
  senseSnapshot?: CampusSenseSnapshot | null;
  /** Device mode also supports explicit anonymous public lookups. Campus mode requires authentication. */
  mode?: CampusAssistantMode;
  /** Stable cloud conversation id; omit only when the caller has not started one. */
  sessionId?: string;
}): Promise<{
  content: string;
  hasActions: boolean;
  source: CampusAssistantMode;
  tool?: CampusAssistantMessage['tool'];
  serviceSelection?: AssistantServiceSelection;
  academicRead?: ImportedAcademicRead;
  calendarTask?: AssistantCalendarTask;
  calendarBatch?: AssistantCalendarBatchView;
  plan?: CampusEvidencePlan;
  localReads?: LocalCampusReadResult[];
  assignmentRead?: AssignmentRead;
  savedClassRead?: SavedClassRead;
  classGapRead?: ClassGapRead;
  courseworkRead?: CourseworkRead;
  courseworkStudy?: CourseworkStudySelection;
  announcementRead?: AnnouncementRead;
  publicCourseRead?: PublicCourseAssistantRead;
  route?: string;
  proposals?: CampusAgentWriteProposal[];
}> {
  const mode = input.mode ?? 'device';
  const assertNotCancelled = () => {
    if (mode === 'device' && input.signal?.aborted) {
      throw new OnDeviceAssistantError('cancelled');
    }
  };
  assertNotCancelled();
  scopeCheck(input, mode === 'campus');
  const messages = input.messages
    // Public catalog turns may describe another campus. Keep them in the UI,
    // but omit each public reply and its preceding question from model history.
    // The current question and input.messages used by scoped follow-ups stay intact.
    .filter((message, index, history) => {
      if (index === history.length - 1) return true;
      if (message.role === 'assistant' && message.tool === 'public-course-catalog') return false;
      const next = history[index + 1];
      return !(message.role === 'user' && next?.role === 'assistant' && next.tool === 'public-course-catalog');
    })
    .slice(-20)
    // Source-backed plans, local records and calendar tasks stay in the conversation without being
    // forwarded, together with their preceding question, to a later model.
    .filter((message, index, history) => {
      const privateRead = (item?: CampusAssistantMessage) => !!item &&
        (!!item.courseworkRead || !!item.courseworkStudy || !!item.classGapRead || ['campus-plan', 'saved-academics', 'calendar-action'].includes(item.tool ?? ''));
      return !privateRead(message) && !(message.role === 'user' && privateRead(history[index + 1]));
    })
    .map((message) => ({
      role: message.role,
      content: message.content.trim().slice(0, 1600),
    }));
  if (!messages.length || messages[messages.length - 1].role !== 'user' ||
      !messages[messages.length - 1].content) {
    throw new Error('Missing question');
  }

  const question = messages[messages.length - 1].content;
  const prior = input.messages[input.messages.length - 2];
  const sourceReply = prior?.role === 'assistant' ? prior : undefined;
  const study = answerCourseworkStudyIntent({
    question, read: sourceReply?.courseworkRead, previous: sourceReply?.courseworkStudy,
    choice: input.courseworkStudyChoice, accountId: input.platformTimetable?.accountId,
    schoolId: input.scope.schoolId,
    isCurrent: () => input.isCurrent() && !!input.platformTimetable?.isCurrent() && !input.signal?.aborted,
  });
  if (study) return { ...study, source: 'device', tool: 'calendar-action', hasActions: false };
  const batchIntent = parseAssistantCalendarBatchIntent(question);
  if (batchIntent) {
    if (batchIntent.kind === 'invalid') return { content: batchIntent.message,
      source: 'device', tool: 'calendar-action', hasActions: false };
    const context = { ...input.scope, platformTimetable: input.platformTimetable,
      isCurrent: () => input.isCurrent() && !input.signal?.aborted };
    if (!assistantCalendarOwner(context)) return { content: '請先登入自己的帳號，再建立多筆個人行程草稿。',
      source: 'device', tool: 'calendar-action', hasActions: false,
      serviceSelection: { kind: 'open', serviceIds: ['account'] } };
    try {
      const calendarBatch = await abortableCampusRead(
        () => prepareAssistantCalendarBatch(batchIntent.events, context), input.signal);
      scopeCheck(input, false);
      assertNotCancelled();
      return { content: '請逐筆核對下方安排。確認後會依序加入個人行事曆，每筆保存後都會讀回核對。',
        source: 'device', tool: 'calendar-action', hasActions: false, calendarBatch };
    } catch {
      scopeCheck(input, false);
      assertNotCancelled();
      return { content: '目前無法完整讀取或保存這份多筆行程草稿，尚未開始新的行程操作。請重新載入行程紀錄後再試。',
        source: 'device', tool: 'calendar-action', hasActions: false,
        serviceSelection: { kind: 'open', serviceIds: ['calendar'] } };
    }
  }
  const calendarIntent = parseAssistantCalendarIntent(question);
  if (calendarIntent) {
    if (calendarIntent.kind === 'invalid') return { content: calendarIntent.message,
      source: 'device', tool: 'calendar-action', hasActions: false };
    const context = { ...input.scope, platformTimetable: input.platformTimetable, isCurrent: input.isCurrent };
    const owner = assistantCalendarOwner(context);
    if (!owner) return { content: '請先登入自己的帳號，再建立個人行事曆草稿。',
      source: 'device', tool: 'calendar-action', hasActions: false,
      serviceSelection: { kind: 'open', serviceIds: ['account'] } };
    // Rephrasing the same appointment must not mint a fresh operation while a
    // previous attempt is unknown or already completed. Cancellation only
    // applies to a draft whose explicit confirmation has not happened yet.
    const previous = [...input.messages].reverse().find((message) => message.role === 'assistant' &&
      message.calendarTask && message.calendarTask.proposal.owner === owner &&
      message.calendarTask.proposal.schoolId === input.scope.schoolId && !['cancelled', 'blocked'].includes(message.calendarTask.state) &&
      sameAssistantCalendarEvent(message.calendarTask.proposal.event, calendarIntent.event))?.calendarTask;
    let restored: AssistantCalendarTask | null = null;
    if (!previous) {
      try {
        restored = await abortableCampusRead(() => findPersistedAssistantCalendarTask(calendarIntent.event,
          { ...context, isCurrent: () => input.isCurrent() && !input.signal?.aborted }), input.signal);
      } catch {
        scopeCheck(input, false);
        assertNotCancelled();
        return { content: '目前無法讀取先前的行程操作紀錄，暫時無法建立新的行程草稿。請重新載入行程紀錄，或先到個人行事曆查看。',
          source: 'device', tool: 'calendar-action', hasActions: false,
          serviceSelection: { kind: 'open', serviceIds: ['calendar'] } };
      }
    }
    const calendarTask = previous?.state === 'verified'
      ? await abortableCampusRead(() => recheckAssistantCalendarTask(previous.proposal,
        { ...context, isCurrent: () => input.isCurrent() && !input.signal?.aborted }, previous), input.signal)
        .catch((error: unknown) => { assertNotCancelled(); throw error; })
      : previous ?? restored ?? createAssistantCalendarTask(calendarIntent.event, context);
    scopeCheck(input, false);
    assertNotCancelled();
    return { content: previous || restored ? '這是先前同一筆行程的處理紀錄。' : '請核對行程名稱與時間，再確認加入個人行事曆。',
      source: 'device', tool: 'calendar-action', hasActions: false, calendarTask };
  }
  const serviceIntent = resolveAssistantServiceIntent(question);
  if (serviceIntent) {
    return {
      source: 'device', tool: 'open-service', hasActions: false,
      content: serviceIntent.kind === 'catalog'
        ? '選擇想使用的功能。查課表與已儲存成績也可以直接提問；送出申請、下單及發訊息仍在原服務確認。'
        : `可以從下方開啟${serviceIntent.service.label}，再接續處理。`,
      serviceSelection: serviceIntent.kind === 'catalog'
        ? { kind: 'catalog', serviceIds: ASSISTANT_SERVICES.map((service) => service.id) }
        : { kind: 'open', serviceIds: [serviceIntent.service.id] },
    };
  }
  // An explicit campus/live grade request retains the existing school reader.
  // Only an explicit saved/imported request can use the local source in that mode.
  const academicIntent = mode === 'device' || /匯入|儲存|保存/.test(question)
    ? parseImportedAcademicIntent(question) : null;
  if (academicIntent) {
    const platform = input.platformTimetable;
    const uid = input.scope.uid && !isFirebaseMockMode() ? input.scope.uid : '';
    const owner = platform ? `nuni:${platform.accountId}` : uid ? `firebase:${uid}` : '';
    if (!owner) {
      return { content: '請先登入自己的帳號，再查詢這台手機保存的成績與學分紀錄。',
        hasActions: false, source: 'device', tool: 'saved-academics',
        serviceSelection: { kind: 'open', serviceIds: ['account'] } };
    }
    const { snapshotPersonalImports } = require('../services/personalImports') as typeof import('../services/personalImports');
    const assertAcademicCurrent = () => {
      scopeCheck(input, false);
      if (input.signal?.aborted) throw new OnDeviceAssistantError('cancelled');
    };
    const active = () => {
      try { assertAcademicCurrent(); return true; } catch { return false; }
    };
    let ledger: Awaited<ReturnType<typeof snapshotPersonalImports>> | null = null;
    try {
      ledger = await abortableCampusRead(() => snapshotPersonalImports({ owner, schoolId: input.scope.schoolId }, active), input.signal);
    } catch {
      // Unreadable data is not an empty transcript. Account changes and aborts
      // must still discard the entire reply rather than expose the old scope.
      assertAcademicCurrent();
    }
    assertAcademicCurrent();
    const checkedAt = new Date().toISOString();
    const summary = summarizeImportedAcademics({
      records: ledger?.records,
      schoolId: input.scope.schoolId,
      availability: ledger ? 'available' : 'unavailable',
      fetchedAt: checkedAt,
      academicYear: academicIntent.academicYear,
      semester: academicIntent.semester,
    });
    return { content: formatImportedAcademicSummary(summary), hasActions: false,
      source: 'device', tool: 'saved-academics', academicRead: { owner, schoolId: input.scope.schoolId, checkedAt },
      serviceSelection: { kind: 'open', serviceIds: ['import'], importKind: 'grades' } };
  }

  if (mode === 'device') {
    const question = messages[messages.length - 1].content;
    const contact = getSchoolContactAnswer(input.scope.schoolId, question, input.schoolName);
    if (contact && !input.courseworkChoice) {
      return { content: contact, source: 'device', hasActions: false, tool: 'school-directory' };
    }
    // Public catalog reads need no account, personal timetable or downloaded model.
    // Keep the platform-account timetable assistant limited to its existing scope.
    if (!input.platformTimetable && !input.courseworkChoice &&
        resolvePublicCourseAssistantIntent(question, input.scope.schoolId)) {
      const publicCourses = await answerPublicCourseQuestion({
        question, schoolId: input.scope.schoolId, origin: 'mobile',
        signal: input.signal, isCurrent: input.isCurrent,
      }).catch((error: unknown) => {
        scopeCheck(input, false);
        assertNotCancelled();
        throw error;
      });
      scopeCheck(input, false);
      assertNotCancelled();
      if (publicCourses) return {
        content: publicCourses.content, source: 'device', hasActions: false,
        tool: 'public-course-catalog',
        ...(publicCourses.read ? { publicCourseRead: publicCourses.read } : {}),
      };
    }
    const { collectOnDeviceSchoolContext, formatOnDeviceSchoolPrompt } =
      require('../services/onDeviceSchoolContext') as typeof import('../services/onDeviceSchoolContext');
    const uid = input.scope.uid && !isFirebaseMockMode() ? input.scope.uid : '';
    const previous = input.messages[input.messages.length - 2];
    const lastReply = previous?.role === 'assistant' ? previous : undefined;
    const lastClass = lastReply?.savedClassRead ?? lastReply?.courseworkRead?.anchor;
    const classQuery = savedClassQuery(question, lastClass);
    const platform = input.platformTimetable;
    const owner = platform && `nuni:${platform.accountId}`;
    let choice = input.courseworkChoice;
    if (platform && !choice && isNuniCampusPlanningQuestion(question)) {
      const { buildNuniCampusPlan } = require('../services/nuniCampusPlanner') as typeof import('../services/nuniCampusPlanner');
      const plan = await abortableCampusRead(() => buildNuniCampusPlan({
        question, schoolId: input.scope.schoolId, platformTimetable: platform,
        ...input.courseworkRequests, isCurrent: input.isCurrent, signal: input.signal,
      }), input.signal).catch((error: unknown) => { assertNotCancelled(); throw error; });
      scopeCheck(input, false);
      assertNotCancelled();
      if (!plan) throw new OnDeviceAssistantError('session-changed');
      return { content: plan.content, source: 'device', tool: 'campus-plan', hasActions: false, plan };
    }
    if (platform && (choice ? 'reminder' in choice : lastReply?.courseworkRead?.view?.kind === 'reminder' || isCourseworkReminderQuestion(question))) {
      const selected = choice && 'reminder' in choice ? choice : undefined;
      const reminder = await abortableCampusRead(() => answerCourseworkReminder(lastReply?.courseworkRead,
        question, platform, input.scope.schoolId, () => input.isCurrent() && platform.isCurrent() && !input.signal?.aborted,
        input.courseworkRequests, selected), input.signal).catch((error: unknown) => { assertNotCancelled(); throw error; });
      scopeCheck(input, false);
      assertNotCancelled();
      if (reminder) return { ...reminder, source: 'device', hasActions: false };
    }
    if (platform && (!choice || 'assignmentId' in choice)) {
      const local = courseworkSnapshotAnswer(lastReply?.courseworkRead, question, platform.accountId,
        input.scope.schoolId, choice && 'assignmentId' in choice ? choice.assignmentId : undefined);
      if (local) {
        if ('content' in local) return { ...local, source: 'device', hasActions: false };
        choice = local;
      }
    }
    const coursework = platform && classCourseworkQuestion(question, !!lastClass?.classes.length);
    if (platform && (choice || coursework)) {
      let sourceReply = lastReply;
      if (!choice && (coursework !== 'context' || !lastClass)) {
        const window = coursework === 'next' ? 'next' : 'current';
        const snapshot = await collectOnDeviceSchoolContext({
          uid, schoolId: input.scope.schoolId, schoolName: input.schoolName, platformTimetable: platform,
          ...(window === 'next' ? { includeNextClasses: true } : { includeCurrentClasses: true }),
        });
        scopeCheck(input, false);
        assertNotCancelled();
        const course = answerSavedClassQuery({ window }, snapshot, uid, undefined, owner);
        if (!course.savedClassRead?.classes.length) return { ...course, source: 'device', hasActions: false };
        sourceReply = { role: 'assistant', ...course };
      }
      const work = await abortableCampusRead(() => answerNuniCoursework(sourceReply, platform, input.scope.schoolId,
        () => input.isCurrent() && platform.isCurrent() && !input.signal?.aborted, input.courseworkRequests, choice),
      input.signal).catch((error: unknown) => { assertNotCancelled(); throw error; });
      scopeCheck(input, false);
      assertNotCancelled();
      return { ...work, source: 'device', hasActions: false };
    }
    const previousGap = lastReply?.classGapRead;
    const gapFollowUp = previousGap && savedClassGapFollowUp(question, previousGap);
    const refiningGap = !!previousGap && (!!gapFollowUp || isSavedClassGapRefinement(question));
    // A conflicting refinement cannot become a fresh lookup that drops prior conditions.
    const gapQuery = refiningGap ? gapFollowUp : savedClassGapQuery(question);
    const gapOwner = owner || (uid && `firebase:${uid}`);
    if (gapQuery && !gapOwner) {
      return { source: 'device', tool: 'saved-timetable', hasActions: false,
        content: '請先登入帳號並儲存個人課表，再查課間空堂。' };
    }
    if (previousGap && refiningGap && (previousGap.owner !== gapOwner || previousGap.schoolId !== input.scope.schoolId)) {
      return { source: 'device', tool: 'saved-timetable', hasActions: false,
        content: '帳號或學校已變更。請重新問「今天有哪些空堂？」來查目前的課表。' };
    }
    if (!gapQuery && (refiningGap || isSavedClassGapQuestion(question))) {
      return { source: 'device', tool: 'saved-timetable', hasActions: false, route: '/timetable',
        content: '這個空堂條件還無法完整辨識，這次沒有套用。可以查今天、明天或後天，並指定「下午三點半以後」、「15:30–17:00」或「至少 45 分鐘」。若條件互相衝突，請重新問完整問題，例如「明天下午有哪些空堂？」。' };
    }
    if (platform && !classQuery && !gapQuery) {
      return { source: 'device', tool: 'saved-timetable', hasActions: false,
        content: '可以問「幫我安排未來七天的課表與作業」、「我現在有課嗎？」、「下一堂課在哪裡？」或「今天有哪些空堂？」。查到課程後，也可以接著問教室與下課時間。' };
    }
    const collected = await abortableCampusRead(() => collectOnDeviceSchoolContext({
      uid,
      schoolId: input.scope.schoolId,
      schoolName: input.schoolName,
      ...(platform && { platformTimetable: platform }),
      ...(gapQuery && { gapDay: gapQuery.day }),
      ...(classQuery?.window === 'current' && { includeCurrentClasses: true }),
      ...(classQuery && classQuery.window !== 'current' && { includeNextClasses: true }),
      ...(classQuery?.followUp && lastClass?.uid === uid && lastClass.owner === owner &&
        lastClass.schoolId === input.scope.schoolId ? { classFollowUp: lastClass.classes } : {}),
    }), input.signal).catch((error: unknown) => { assertNotCancelled(); throw error; });
    scopeCheck(input, false);
    assertNotCancelled();
    // A cached context can outlive an account switch or be restored without
    // owner metadata. Direct timetable and planning tools must fail closed,
    // not just the native prompt and model-selected semantic reads.
    const snapshot = !platform && (!uid || collected.ownerUid !== uid)
      ? { ...collected, timetable: { source: 'not-available' as const, updatedAt: null, courses: [] } }
      : collected;

    // Safe read-only tools run even without a GGUF download or a native runtime.
    // They do not query a backend, perform mutations, or invent missing school data.
    if (gapQuery) {
      if (gapFollowUp && previousGap && taipeiDayNumber(Date.parse(previousGap.checkedAt)) !== taipeiDayNumber(Date.parse(snapshot.checkedAt))) {
        return { source: 'device', tool: 'saved-timetable', hasActions: false,
          content: '現在已經換日，請重新問「今天有哪些空堂？」或「明天有哪些空堂？」。' };
      }
      const answer = answerSavedClassGapQuery(gapQuery, snapshot);
      return {
        ...answer, source: 'device', hasActions: false,
        ...(platform && snapshot.timetable.source === 'not-available' && { route: '/timetable/import' }),
        ...(snapshot.timetable.classGaps && { classGapRead: {
          ...gapQuery, owner: gapOwner, schoolId: input.scope.schoolId, checkedAt: snapshot.checkedAt,
        } }),
      };
    }
    if (classQuery) {
      const answer = answerSavedClassQuery(classQuery, snapshot, uid, lastClass, owner);
      return { ...answer, source: 'device', hasActions: false };
    }
    const { runOfflineCampusTool, announcementDateFollowUp } =
      require('../services/offlineCampusTools') as typeof import('../services/offlineCampusTools');
    const senseSnapshot = validCampusSenseSnapshot(input.senseSnapshot, { ...input.scope, uid });
    const now = Date.parse(snapshot.checkedAt);
    const previousAnnouncements = lastReply?.announcementRead;
    const askedAnnouncements = previousAnnouncements ||
      (lastReply?.tool === 'campus-snapshot' && lastReply.route === '/announcements');
    const period = askedAnnouncements ? announcementDateFollowUp(question, now) : null;
    if (period && previousAnnouncements && (senseSnapshot?.announcements.status !== 'available' ||
        previousAnnouncements.userId !== uid || previousAnnouncements.schoolId !== input.scope.schoolId)) {
      return { content: '上次的公告摘要已失效。請重新同步，再選擇要查的日期。',
        tool: 'online-required', route: '/announcements', source: 'device', hasActions: false };
    }
    const readQuestion = period ? period + '有哪些校園公告？' : question;
    const followUp = assignmentFollowUp(question, lastReply?.assignmentRead, senseSnapshot, now);
    const lookup = followUp && 'question' in followUp ? followUp : null;
    const localAnswer = followUp && 'reply' in followUp ? followUp.reply
      : runOfflineCampusTool(lookup?.question ?? readQuestion, snapshot, senseSnapshot, uid, lookup?.filter, lookup?.page);
    if (localAnswer) {
      return {
        content: localAnswer.content,
        hasActions: false,
        source: 'device',
        tool: localAnswer.tool,
        route: localAnswer.route,
        ...(localAnswer.announcementRead ? { announcementRead: localAnswer.announcementRead } : {}),
        ...(localAnswer.plan ? { plan: localAnswer.plan } : {}),
        ...(localAnswer.assignmentRead ? { assignmentRead: localAnswer.assignmentRead } : {}),
      };
    }

    const { localLLM } = engine();
    const readiness = await getOnDeviceAssistantReadiness();
    scopeCheck(input, false);
    assertNotCancelled();
    if (!readiness.available) throw new OnDeviceAssistantError('native-unavailable');
    const state = localLLM.getState();
    // The inference engine is shared with other mobile features. Reloading a
    // context while it is generating can release native memory still in use.
    if (state.status === 'generating' || state.status === 'loading' ||
        state.status === 'downloading') {
      throw new OnDeviceAssistantError('model-busy');
    }
    if (!readiness.ready) throw new OnDeviceAssistantError('model-required');
    if (state.status !== 'ready' || state.modelId !== readiness.modelId) {
      const loaded = await localLLM.loadModel(readiness.modelId);
      scopeCheck(input, false);
      assertNotCancelled();
      if (!loaded) throw new OnDeviceAssistantError('model-failed');
    }

    // Unmatched paraphrases/follow-ups can use the installed model to select
    // bounded reads. Facts are still produced by scoped deterministic tools.
    const { resolveLocalCampusSemanticReads } = require('../services/localCampusSemanticReads') as
      typeof import('../services/localCampusSemanticReads');
    // A notice mention that the read tool declined (e.g. translating supplied text)
    // should use the conversation, without substituting public titles or personal records.
    const useCampusReads = !/公告|通知/.test(question);
    const selectedReads = useCampusReads ? await resolveLocalCampusSemanticReads({
      messages, context: snapshot, snapshot: senseSnapshot,
      uid, schoolId: input.scope.schoolId,
      assertCurrent: () => { scopeCheck(input, false); assertNotCancelled(); },
      generate: (prompt) => localLLM.generate({
        messages: prompt, maxTokens: 192, temperature: 0,
        signal: input.signal,
      }),
    }).catch((error) => {
      scopeCheck(input, false);
      assertNotCancelled();
      throw error;
    }) : null;
    if (selectedReads) {
      return {
        content: selectedReads.content,
        hasActions: false, source: 'device', tool: 'local-agent',
        localReads: selectedReads.results,
      };
    }
    // Another screen must not swap the shared context between the selection
    // inference and fallback chat. Do not reload or steal that screen's work.
    const afterSelection = localLLM.getState();
    if (afterSelection.status !== 'ready' || afterSelection.modelId !== readiness.modelId) {
      throw new OnDeviceAssistantError('model-busy');
    }

    // Native inference can consume private context before an eventual response is discarded.
    // Recheck after the selector and shared engine state, immediately before sending it.
    scopeCheck(input, false);
    assertNotCancelled();

    // Each request gets explicitly scoped history; never reuse a global chat history
    // that could contain data from a previous account or campus.
    // Reserve enough context for the instruction, trusted data and generated answer.
    // Models above 0.5B currently use a 4K window; unbounded 8x550 Chinese
    // characters can exceed that limit before generation starts.
    const compact = readiness.modelId === 'qwen2.5-0.5b';
    const compactHistory = messages.slice(compact ? -3 : -6).map((message) => ({
      role: message.role,
      content: message.content.slice(0, compact ? 160 : 220),
    }));
    const completion = await localLLM.generate({
      messages: [
        { role: 'system', content: formatOnDeviceSchoolPrompt(
          { ...snapshot, checkedAt: new Date().toISOString() },
          useCampusReads ? validCampusSenseSnapshot(input.senseSnapshot, { ...input.scope, uid }) : null,
          uid,
        ) },
        ...compactHistory,
      ],
      maxTokens: readiness.modelId === 'qwen2.5-0.5b' ? 512 : 700,
      temperature: 0.45,
      signal: input.signal,
    }).catch((error) => {
      // Native aborts can reject instead of returning an empty completion.
      // Distinguish an intentional cancellation from a broken GGUF model.
      assertNotCancelled();
      throw error;
    });
    scopeCheck(input, false);
    assertNotCancelled();
    const answer = completion.content.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
    if (!answer || answer.includes('<think>')) throw new OnDeviceAssistantError('model-failed');
    return { content: answer, hasActions: false, source: 'device' };
  }

  const callable = httpsCallable<
    unknown,
    { content?: string; error?: unknown; actions?: unknown[]; run?: { status?: string; runId?: string } }
  >(getFunctionsInstance(), 'askCampusAssistant');
  const schoolName = typeof input.schoolName === 'string'
    ? input.schoolName.trim().slice(0, 160)
    : '';
  const sessionId = typeof input.sessionId === 'string' ? input.sessionId.trim() : '';
  const result = await callable({
    messages,
    context: {
      schoolId: input.scope.schoolId,
      ...(schoolName ? { schoolName } : {}),
      screen: 'campus-assistant',
      locale: 'zh-TW',
      timezone: 'Asia/Taipei',
      ...(sessionId ? { sessionId } : {}),
    },
  });
  scopeCheck(input, true);
  if (result.data.error ||
      !['completed', 'blocked'].includes(result.data.run?.status ?? '') ||
      typeof result.data.content !== 'string' || !result.data.content.trim()) {
    throw new Error('Assistant reply not confirmed');
  }
  const proposals = campusAgentWriteProposals({
    run: result.data.run,
    actions: result.data.actions,
  });
  return {
    content: result.data.content.trim(),
    hasActions: Array.isArray(result.data.actions) && result.data.actions.length > 0,
    source: 'campus',
    ...(proposals.length ? { proposals } : {}),
  };
}
