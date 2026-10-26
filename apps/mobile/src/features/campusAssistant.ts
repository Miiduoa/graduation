import { httpsCallable } from 'firebase/functions';
import { getAuthInstance, getFunctionsInstance, isFirebaseMockMode } from '../firebase';
import { campusAgentWriteProposals, type CampusAgentWriteProposal } from './campusAssistantActions';

export type CampusAssistantMessage = { role: 'user' | 'assistant'; content: string };
export type CampusAssistantScope = { uid: string; schoolId: string };
export type CampusAssistantMode = 'device' | 'campus';

export interface OnDeviceAssistantReadiness {
  available: boolean;
  modelId: string;
  ready: boolean;
  reason: string | null;
}

export class OnDeviceAssistantError extends Error {
  constructor(public readonly code: 'native-unavailable' | 'model-required' | 'model-failed' | 'session-changed') {
    super(code === 'session-changed' ? 'Assistant session changed' : code);
    this.name = 'OnDeviceAssistantError';
  }
}

function engine() {
  // Lazy import avoids loading a native inference module on the cloud-only path.
  return require('../services/localLLMInference') as typeof import('../services/localLLMInference');
}

function scopeCheck(input: { scope: CampusAssistantScope; isCurrent: () => boolean }, requiresAuth: boolean) {
  if (!input.isCurrent()) throw new OnDeviceAssistantError('session-changed');
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
  schoolName?: string | null;
  /** Offline by default. Campus mode is explicit and requires an authenticated backend. */
  mode?: CampusAssistantMode;
}): Promise<{
  content: string;
  hasActions: boolean;
  source: CampusAssistantMode;
  tool?: 'saved-timetable' | 'online-required' | 'open-service';
  route?: string;
  proposals?: CampusAgentWriteProposal[];
}> {
  const mode = input.mode ?? 'device';
  scopeCheck(input, mode === 'campus');
  const messages = input.messages
    .slice(-20)
    .map((message) => ({
      role: message.role,
      content: message.content.trim().slice(0, 1600),
    }));
  if (!messages.length || messages[messages.length - 1].role !== 'user' ||
      !messages[messages.length - 1].content) {
    throw new Error('Missing question');
  }

  if (mode === 'device') {
    const { collectOnDeviceSchoolContext, formatOnDeviceSchoolPrompt } =
      require('../services/onDeviceSchoolContext') as typeof import('../services/onDeviceSchoolContext');
    const { runOfflineCampusTool } =
      require('../services/offlineCampusTools') as typeof import('../services/offlineCampusTools');

    const uid = input.scope.uid && !isFirebaseMockMode() ? input.scope.uid : '';
    const snapshot = await collectOnDeviceSchoolContext({
      uid,
      schoolId: input.scope.schoolId,
      schoolName: input.schoolName,
    });
    scopeCheck(input, false);

    // Safe read-only tools run even without a GGUF download or a native runtime.
    // They do not query a backend, perform mutations, or invent missing school data.
    const localAnswer = runOfflineCampusTool(messages[messages.length - 1].content, snapshot);
    if (localAnswer) {
      return {
        content: localAnswer.content,
        hasActions: false,
        source: 'device',
        tool: localAnswer.tool,
        route: localAnswer.route,
      };
    }

    const { localLLM } = engine();
    const readiness = await getOnDeviceAssistantReadiness();
    scopeCheck(input, false);
    if (!readiness.available) throw new OnDeviceAssistantError('native-unavailable');
    if (!readiness.ready) throw new OnDeviceAssistantError('model-required');
    const state = localLLM.getState();
    if (state.status !== 'ready' || state.modelId !== readiness.modelId) {
      const loaded = await localLLM.loadModel(readiness.modelId);
      scopeCheck(input, false);
      if (!loaded) throw new OnDeviceAssistantError('model-failed');
    }

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
        { role: 'system', content: formatOnDeviceSchoolPrompt(snapshot) },
        ...compactHistory,
      ],
      maxTokens: readiness.modelId === 'qwen2.5-0.5b' ? 512 : 700,
      temperature: 0.45,
    });
    scopeCheck(input, false);
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
  const result = await callable({
    messages,
    context: {
      schoolId: input.scope.schoolId,
      ...(schoolName ? { schoolName } : {}),
      screen: 'campus-assistant',
      locale: 'zh-TW',
      timezone: 'Asia/Taipei',
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
