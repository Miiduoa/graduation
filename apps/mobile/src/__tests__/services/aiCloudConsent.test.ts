jest.mock('firebase/functions', () => ({
  getFunctions: jest.fn(() => ({})),
  httpsCallable: jest.fn(() => mockCampusCallable),
}));

jest.mock('../../firebase', () => ({
  getFirebaseApp: jest.fn(() => ({})),
  getFunctionsInstance: jest.fn(() => ({})),
  hasUsableFirebaseConfig: jest.fn(() => true),
}));

jest.mock('../../services/cloudFunctions', () => ({
  getAIServerBaseUrl: jest.fn(() => 'https://local-model.invalid'),
  getFirebaseAuthHeaders: jest.fn(async () => ({})),
}));

jest.mock('../../services/aiAgentTools', () => ({
  toGeminiToolsPayload: jest.fn(() => []),
  parseGeminiFunctionCalls: jest.fn(() => ({
    functionCalls: [],
    textResponse: '合成 Gemini 回覆',
  })),
  executeTool: jest.fn(),
  formatToolResponseForGemini: jest.fn(),
}));

jest.mock('../../services/localAssistant', () => ({
  localAssistant: {
    isModelReady: jest.fn(() => false),
    restoreDownloadedModel: jest.fn(async () => false),
  },
}));

jest.mock('../../services/localLLMInference', () => ({
  MODEL_REGISTRY: {},
  localLLM: {
    getSavedModelId: jest.fn(async () => null),
    getDownloadedModels: jest.fn(async () => []),
    getRuntimeAvailability: jest.fn(() => ({ available: false })),
  },
}));

jest.mock('../../data/puAIAgentData', () => {
  const actual = jest.requireActual('../../data/puAIAgentData');
  return { ...actual, buildThinkingChain: jest.fn(actual.buildThinkingChain) };
});

import Constants from 'expo-constants';
import { httpsCallable } from 'firebase/functions';
import { buildThinkingChain } from '../../data/puAIAgentData';
import { chatWithCampusAssistant, type AIMessage } from '../../services/ai';
import { toGeminiToolsPayload } from '../../services/aiAgentTools';
import { getAIServerBaseUrl } from '../../services/cloudFunctions';
import { localAssistant } from '../../services/localAssistant';
import { localLLM } from '../../services/localLLMInference';

const mockCampusCallable = jest.fn();
const consentMessage =
  '請先在網頁校園助理確認這次要傳送的公開地點資料；手機版目前尚未提供此確認流程。';
const messages: AIMessage[] = [{ role: 'user', content: '你好' }];
const context = { schoolId: 'pu', userId: 'synthetic-user', role: 'student' as const };
const expoConfig = Constants.expoConfig as { extra?: Record<string, unknown> };
const envNames = ['EXPO_PUBLIC_DEV_PREFER_CLOUD_ASSISTANT', 'EXPO_PUBLIC_AI_TEST_FAST'];
let oldExtra: Record<string, unknown> | undefined;
let oldEnv: Map<string, string | undefined>;
let oldFetch: typeof global.fetch;
let time = Date.parse('2026-11-01T00:00:00Z');
let fetchMock: jest.Mock;

function configureProvider(aiProvider: string) {
  expoConfig.extra = {
    aiProvider,
    appEnv: 'development',
    apiEnv: 'development',
    isReleaseLike: false,
    forceRealData: false,
    devPreferCloudAssistant: false,
    aiWebSearchEnabled: false,
    geminiApiKey: 'fake-gemini-key',
  };
}

beforeEach(() => {
  oldExtra = expoConfig.extra;
  oldEnv = new Map(envNames.map((name) => [name, process.env[name]]));
  process.env.EXPO_PUBLIC_DEV_PREFER_CLOUD_ASSISTANT = 'false';
  process.env.EXPO_PUBLIC_AI_TEST_FAST = '0';
  time += 1000;
  jest.useFakeTimers({ now: time });
  jest.clearAllMocks();
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
  oldFetch = global.fetch;
  fetchMock = jest.fn(async () => ({
    ok: true,
    json: async () => ({ candidates: [{ content: { parts: [{ text: '合成 Gemini 回覆' }] } }] }),
  }));
  global.fetch = fetchMock as typeof global.fetch;
});

afterEach(() => {
  expoConfig.extra = oldExtra;
  for (const [name, value] of oldEnv) {
    if (value == null) delete process.env[name];
    else process.env[name] = value;
  }
  global.fetch = oldFetch;
  jest.useRealTimers();
  jest.restoreAllMocks();
});

test.each(['gemini', 'local-llm', 'offline'])(
  'cloud consent rejection is terminal in nonrelease %s mode',
  async (provider) => {
    configureProvider(provider);
    mockCampusCallable.mockRejectedValue({
      code: 'functions/failed-precondition',
      details: { reason: 'cloud-consent-required' },
    });

    await expect(chatWithCampusAssistant(messages, context)).resolves.toEqual({
      content: '',
      error: consentMessage,
    });

    expect(httpsCallable).toHaveBeenCalledWith(expect.anything(), 'askCampusAssistant');
    expect(mockCampusCallable).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(toGeminiToolsPayload).not.toHaveBeenCalled();
    expect(getAIServerBaseUrl).not.toHaveBeenCalled();
    expect(localLLM.getSavedModelId).not.toHaveBeenCalled();
    expect(localLLM.getDownloadedModels).not.toHaveBeenCalled();
    expect(localAssistant.isModelReady).not.toHaveBeenCalled();
    expect(localAssistant.restoreDownloadedModel).not.toHaveBeenCalled();
    // The existing mock response always builds a thinking chain before returning.
    expect(buildThinkingChain).not.toHaveBeenCalled();
  },
);

test.each([
  { code: 'functions/unavailable', details: { reason: 'cloud-consent-required' } },
  { code: 'functions/failed-precondition', details: { reason: 'different-precondition' } },
  { code: 'functions/failed-precondition' },
])('other failures preserve the existing nonrelease Gemini fallback: %j', async (error) => {
  configureProvider('gemini');
  mockCampusCallable.mockRejectedValue(error);
  await expect(chatWithCampusAssistant(messages, context)).resolves.toMatchObject({
    content: '合成 Gemini 回覆',
  });
  expect(mockCampusCallable).toHaveBeenCalledTimes(1);
  expect(toGeminiToolsPayload).toHaveBeenCalledTimes(1);
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

test('an ordinary callable network error preserves the existing offline fallback', async () => {
  configureProvider('offline');
  mockCampusCallable.mockRejectedValue(new Error('synthetic network failure'));
  const response = await chatWithCampusAssistant(messages, context);
  expect(response.error).not.toBe(consentMessage);
  expect(response.content).not.toBe('');
  expect(buildThinkingChain).toHaveBeenCalledTimes(1);
  expect(fetchMock).not.toHaveBeenCalled();
});

test('a successful managed response still returns without another provider', async () => {
  configureProvider('gemini');
  mockCampusCallable.mockResolvedValue({ data: { content: '合成後端回覆', suggestions: [] } });
  await expect(chatWithCampusAssistant(messages, context)).resolves.toMatchObject({
    content: '合成後端回覆',
  });
  expect(fetchMock).not.toHaveBeenCalled();
  expect(toGeminiToolsPayload).not.toHaveBeenCalled();
  expect(buildThinkingChain).not.toHaveBeenCalled();
});
