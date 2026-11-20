import { httpsCallable } from 'firebase/functions';
import type { PostLoginContext } from '../../data/postLoginTypes';
import { chatWithLocalLLMStreaming } from '../../services/ai';
import { computeRealtimeInsights } from '../../services/aiRealtimeAnalytics';
import { computeCrossModuleInsights, generateDailyBriefing } from '../../services/aiCrossModuleInference';
import { detectAndExecuteSmartAction } from '../../services/aiSmartActions';
import { getInMemoryPostLoginContext } from '../../services/postLoginContextHolder';
import { bindVerifiedSchoolAiScope } from '../../services/verifiedSchoolAiScope';

jest.mock('expo-constants', () => ({ expoConfig: { extra: { appEnv: 'production' } } }));
jest.mock('firebase/functions', () => ({ httpsCallable: jest.fn() }));
jest.mock('../../firebase', () => ({
  hasUsableFirebaseConfig: () => true,
  getFunctionsInstance: () => ({}),
}));
jest.mock('../../services/postLoginContextHolder', () => ({ getInMemoryPostLoginContext: jest.fn() }));
jest.mock('../../services/aiRealtimeAnalytics', () => ({
  computeRealtimeInsights: jest.fn(async () => ({})),
  insightsToPromptText: jest.fn(() => '目前帳號的洞察'),
}));
jest.mock('../../services/aiCrossModuleInference', () => ({
  computeCrossModuleInsights: jest.fn(async () => []),
  generateDailyBriefing: jest.fn(async () => ({})),
  crossInsightsToPromptText: jest.fn(() => ''),
  dailyBriefingToPromptText: jest.fn(() => ''),
}));
jest.mock('../../services/aiSmartActions', () => ({ detectAndExecuteSmartAction: jest.fn(async () => null) }));

// These providers are outside the managed-cloud branch exercised here.
jest.mock('../../data/puAIAgentData', () => ({}));
jest.mock('../../data/aiAssistantProfile', () => ({}));
jest.mock('../../services/webSearch', () => ({}));
jest.mock('../../services/webLearning', () => ({}));
jest.mock('../../services/aiAgentTools', () => ({}));
jest.mock('../../services/aiToolRegistry', () => ({}));
jest.mock('../../services/aiLocalAgent', () => ({ resetAdaptiveLearnedPatternsForTests: jest.fn() }));
jest.mock('../../services/assistantReplySupervisor', () => ({}));
jest.mock('../../services/aiDynamicTraining', () => ({}));
jest.mock('../../services/aiReflexion', () => ({}));
jest.mock('../../services/personaAiContext', () => ({}));
jest.mock('../../services/cloudFunctions', () => ({}));
jest.mock('@campus/shared/src', () => ({}));

const managedAI = jest.fn(async () => ({ data: { content: '平台助理正常回應' } }));
let currentSession: object;
let now = Date.now();
let clock: jest.SpyInstance;

function bindLogin(userId = 'owner-a') {
  const context: PostLoginContext = {
    uid: userId, schoolId: 'pu', origin: 'verified-school-login',
    roles: {
      primaryRole: 'student', subRoles: [], source: 'firestore',
      flags: { isStudent: true, isTeacher: false, isDeptAdmin: false, isAdmin: false },
    },
    latestAnnouncements: [], partialErrors: [], builtAt: new Date().toISOString(),
  };
  currentSession = {};
  const session = currentSession;
  jest.mocked(getInMemoryPostLoginContext).mockReturnValue(context);
  bindVerifiedSchoolAiScope(context, () => {
    if (currentSession !== session) throw new Error('school session changed');
  });
  return { userId, schoolId: 'pu' };
}

function stream(identity: { userId?: string; schoolId: string }) {
  now += 1000;
  return chatWithLocalLLMStreaming([{ role: 'user', content: '你好' }], identity, jest.fn());
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

beforeEach(() => {
  jest.clearAllMocks();
  clock = jest.spyOn(Date, 'now').mockImplementation(() => now);
  jest.mocked(httpsCallable).mockReturnValue(managedAI as ReturnType<typeof httpsCallable>);
  bindLogin();
});

afterEach(() => { clock.mockRestore(); });

test.each([
  { schoolId: 'nthu', userId: 'owner-a' },
  { schoolId: 'pu', userId: 'owner-b' },
  { schoolId: 'pu' },
])('keeps the platform assistant available without raw PU enrichment for %j', async (identity) => {
  await expect(stream(identity)).resolves.toMatchObject({ content: '平台助理正常回應' });
  expect(computeRealtimeInsights).not.toHaveBeenCalled();
  expect(computeCrossModuleInsights).not.toHaveBeenCalled();
  expect(generateDailyBriefing).not.toHaveBeenCalled();
  expect(detectAndExecuteSmartAction).not.toHaveBeenCalled();
  expect(managedAI).toHaveBeenCalledWith(expect.objectContaining({
    context: expect.objectContaining({ schoolId: identity.schoolId }),
  }));
});

test('insight caching is reusable only within the same verified login', async () => {
  const ownerA = { userId: 'owner-a', schoolId: 'pu' };
  await stream(ownerA);
  await stream(ownerA);
  expect(computeRealtimeInsights).toHaveBeenCalledTimes(1);
  await stream(bindLogin());
  expect(computeRealtimeInsights).toHaveBeenCalledTimes(2);
  await stream(bindLogin('owner-b'));
  expect(computeRealtimeInsights).toHaveBeenCalledTimes(3);
});

test('profile refresh pauses enrichment and restores the same live login cache after JSON hydration', async () => {
  const identity = { userId: 'owner-a', schoolId: 'pu' };
  const context = getInMemoryPostLoginContext();
  await stream(identity);
  jest.mocked(getInMemoryPostLoginContext).mockReturnValue(null);
  await stream(identity);
  expect(computeRealtimeInsights).toHaveBeenCalledTimes(1);
  expect(detectAndExecuteSmartAction).toHaveBeenCalledTimes(1);
  jest.mocked(getInMemoryPostLoginContext).mockReturnValue(JSON.parse(JSON.stringify(context)));
  await stream(identity);
  expect(computeRealtimeInsights).toHaveBeenCalledTimes(1);
  expect(detectAndExecuteSmartAction).toHaveBeenCalledTimes(2);
});

test.each(['realtime', 'cross', 'briefing'] as const)('stops enrichment when its session expires during %s computation', async (stage) => {
  const started = deferred<void>();
  const waiting = deferred<never>();
  const calculate = stage === 'realtime' ? computeRealtimeInsights
    : stage === 'cross' ? computeCrossModuleInsights : generateDailyBriefing;
  jest.mocked(calculate).mockImplementationOnce(() => {
    started.resolve();
    return waiting.promise;
  });
  const pending = stream({ userId: 'owner-a', schoolId: 'pu' });
  await started.promise;
  currentSession = {};
  waiting.resolve(undefined as never);
  await expect(pending).resolves.toMatchObject({ content: '平台助理正常回應' });
  expect(detectAndExecuteSmartAction).not.toHaveBeenCalled();
  if (stage === 'realtime') expect(computeCrossModuleInsights).not.toHaveBeenCalled();
  if (stage !== 'briefing') expect(generateDailyBriefing).not.toHaveBeenCalled();
});

test('a late computation cannot overwrite the newer account cache', async () => {
  const started = deferred<void>();
  const waiting = deferred<Awaited<ReturnType<typeof computeRealtimeInsights>>>();
  jest.mocked(computeRealtimeInsights).mockImplementationOnce(() => {
    started.resolve();
    return waiting.promise;
  });
  const previous = stream({ userId: 'owner-a', schoolId: 'pu' });
  await started.promise;
  const current = bindLogin('owner-b');
  await stream(current);
  waiting.resolve({} as Awaited<ReturnType<typeof computeRealtimeInsights>>);
  await previous;
  await stream(current);
  expect(computeRealtimeInsights).toHaveBeenCalledTimes(2);
  expect(computeCrossModuleInsights).toHaveBeenCalledTimes(1);
  expect(generateDailyBriefing).toHaveBeenCalledTimes(1);
  expect(detectAndExecuteSmartAction).toHaveBeenCalledTimes(2);
});
