const mockGetInfo = jest.fn();
const mockMakeDirectory = jest.fn(async () => undefined);
const mockDelete = jest.fn(async () => undefined);
const mockDownloadStart = jest.fn();
const mockCancelNative = jest.fn(async () => undefined);
const mockCreateDownload = jest.fn(() => ({
  downloadAsync: mockDownloadStart,
  cancelAsync: mockCancelNative,
}));
const mockInitLlama = jest.fn();

jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: 'file:///sandbox/',
  getInfoAsync: (...args: unknown[]) => mockGetInfo(...args),
  makeDirectoryAsync: (...args: unknown[]) => mockMakeDirectory(...args),
  deleteAsync: (...args: unknown[]) => mockDelete(...args),
  createDownloadResumable: (...args: unknown[]) => mockCreateDownload(...args),
}));

// The native React Native module cannot be loaded by Jest: it expects DevMenu
// to exist in a device binary. Only the three RN APIs used by this unit's
// engine are mocked, so test failures come from engine behaviour, not DevMenu.
jest.mock('react-native', () => ({
  Platform: { OS: 'ios', select: (values: Record<string, unknown>) => values.ios ?? values.default },
  NativeModules: { RNLlama: {} },
  TurboModuleRegistry: { get: () => ({}) },
}));
// The global Jest setup resets the legacy agent between tests. This suite
// does not use that agent, and loading it would import unrelated RN modules.
jest.mock('../../services/aiLocalAgent', () => ({
  resetAdaptiveLearnedPatternsForTests: jest.fn(),
}));
jest.mock('llama.rn', () => ({ initLlama: (...args: unknown[]) => mockInitLlama(...args) }));

let engine: typeof import('../../services/localLLMInference').localLLM;
let resolveDownload!: (value: undefined) => void;
let mockStopNative: jest.Mock;
let mockContextRelease: jest.Mock;
let mockCompletion: jest.Mock;

beforeEach(async () => {
  jest.resetModules();
  jest.clearAllMocks();
  mockGetInfo.mockImplementation(async (uri: string) =>
    uri.endsWith('models/') ? { exists: true, isDirectory: true } : { exists: false });
  mockDownloadStart.mockImplementation(
    () => new Promise<undefined>((resolve) => { resolveDownload = resolve; }),
  );
  mockCancelNative.mockImplementation(async () => { resolveDownload(undefined); });
  mockStopNative = jest.fn(async () => undefined);
  mockContextRelease = jest.fn(async () => undefined);
  mockCompletion = jest.fn(async () => ({
    text: '生成成功', tokens_predicted: 3, timings: { predicted_per_second: 10 },
  }));
  mockInitLlama.mockImplementation(async () => ({
    completion: mockCompletion,
    release: mockContextRelease,
    stopCompletion: mockStopNative,
  }));
  global.fetch = jest.fn(async () => ({
    ok: true,
    status: 200,
    url: 'https://cdn.example.test/model.gguf',
  })) as never;
  const storageModule = require('@react-native-async-storage/async-storage');
  const storage = storageModule.default ?? storageModule;
  await storage.clear();
  engine = require('../../services/localLLMInference').localLLM;
});

async function waitForDownload(): Promise<void> {
  for (let index = 0; index < 30 && mockDownloadStart.mock.calls.length === 0; index += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  expect(mockDownloadStart).toHaveBeenCalledTimes(1);
}

test('cancel stops the native transfer, cleans the incomplete GGUF and leaves no ready marker', async () => {
  const progress = jest.fn();
  const pending = engine.downloadModel('qwen2.5-0.5b', progress);
  await waitForDownload();
  expect(engine.getState().status).toBe('downloading');
  expect(await engine.cancelDownload('qwen2.5-7b')).toBe(false);
  expect(mockCancelNative).not.toHaveBeenCalled();
  expect(await engine.cancelDownload('qwen2.5-0.5b')).toBe(true);
  await expect(pending).resolves.toBe(false);
  expect(mockCancelNative).toHaveBeenCalledTimes(1);
  expect(mockDelete).toHaveBeenCalledWith(
    expect.stringContaining('Qwen2.5-0.5B-Instruct-Q4_K_M.gguf'), { idempotent: true },
  );
  expect(engine.getState()).toMatchObject({ status: 'uninitialized', error: undefined });
  const storageModule = require('@react-native-async-storage/async-storage');
  const storage = storageModule.default ?? storageModule;
  await expect(storage.getItem('@local_llm:model_ready')).resolves.toBeNull();
  expect(progress).not.toHaveBeenCalled();
});

test('parallel model downloads and context loading are rejected instead of racing the filesystem', async () => {
  const pending = engine.downloadModel('qwen2.5-0.5b');
  await waitForDownload();
  await expect(engine.downloadModel('qwen2.5-7b')).resolves.toBe(false);
  await expect(engine.loadModel('qwen2.5-7b')).resolves.toBe(false);
  await expect(engine.release()).rejects.toThrow('正在執行其他工作');
  await expect(engine.deleteModel('qwen2.5-0.5b')).rejects.toThrow('正在使用中');
  expect(mockCreateDownload).toHaveBeenCalledTimes(1);
  await engine.cancelDownload('qwen2.5-0.5b');
  await expect(pending).resolves.toBe(false);
});

test('loading a model is idempotent and never releases the native context during generation', async () => {
  mockGetInfo.mockImplementation(async (uri: string) =>
    uri.endsWith('.gguf')
      ? { exists: true, size: 5_000_000_000 }
      : { exists: true, isDirectory: true });
  await expect(engine.loadModel('qwen2.5-0.5b')).resolves.toBe(true);
  await expect(engine.loadModel('qwen2.5-0.5b')).resolves.toBe(true);
  expect(mockInitLlama).toHaveBeenCalledTimes(1);
  expect(mockContextRelease).not.toHaveBeenCalled();

  let finish!: (result: unknown) => void;
  mockCompletion.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  const generating = engine.generate({
    messages: [{ role: 'user', content: '今天要做什麼？' }],
  });
  expect(engine.getState().status).toBe('generating');
  await expect(engine.loadModel('qwen2.5-7b')).resolves.toBe(false);
  await expect(engine.deleteModel('qwen2.5-0.5b')).rejects.toThrow('正在使用中');
  expect(mockContextRelease).not.toHaveBeenCalled();

  engine.abort();
  expect(mockStopNative).toHaveBeenCalledTimes(1);
  finish({ text: '不應顯示取消前結果', tokens_predicted: 6, timings: { predicted_per_second: 10 } });
  await expect(generating).resolves.toMatchObject({ content: '', finishReason: 'error' });
  expect(engine.getState().status).toBe('ready');
  expect(mockContextRelease).not.toHaveBeenCalled();
});

test('a failed filesystem check resets loading state instead of leaving a permanent busy indicator', async () => {
  mockGetInfo.mockRejectedValueOnce(new Error('storage unavailable'));
  await expect(engine.loadModel('qwen2.5-0.5b')).resolves.toBe(false);
  expect(engine.getState()).toMatchObject({ status: 'error', modelId: 'qwen2.5-0.5b' });
  expect(engine.getState().error).toContain('storage unavailable');
});

test('a pre-cancelled external signal never returns a generated answer', async () => {
  mockGetInfo.mockResolvedValue({ exists: true, size: 5_000_000_000 });
  await engine.loadModel('qwen2.5-0.5b');
  const controller = new AbortController();
  controller.abort();
  const result = await engine.generate({
    messages: [{ role: 'user', content: '不能生成的題目' }],
    signal: controller.signal,
  });
  expect(result.content).toBe('');
  expect(mockCompletion).not.toHaveBeenCalled();
  expect(engine.getState().status).toBe('ready');
});

test('changing the saved model preference cannot impersonate an already loaded context', async () => {
  mockGetInfo.mockResolvedValue({ exists: true, size: 5_000_000_000 });
  await expect(engine.loadModel('qwen2.5-0.5b')).resolves.toBe(true);
  const before = engine.getState();
  expect(before).toMatchObject({ status: 'ready', modelId: 'qwen2.5-0.5b' });
  await expect(engine.setActiveModel('qwen2.5-7b')).resolves.toBe(true);
  await expect(engine.getSavedModelId()).resolves.toBe('qwen2.5-7b');
  expect(engine.getState()).toMatchObject({ status: 'ready', modelId: 'qwen2.5-0.5b' });
  expect(mockInitLlama).toHaveBeenCalledTimes(1);
});

test('generates with the token format of the actually loaded GGUF model', async () => {
  mockGetInfo.mockResolvedValue({ exists: true, size: 5_000_000_000 });
  const messages = [
    { role: 'system' as const, content: 'Answer in Chinese' },
    { role: 'user' as const, content: "Plan today's tasks" },
  ];

  await expect(engine.loadModel('mistral-7b-v0.3')).resolves.toBe(true);
  await engine.generate({ messages });
  const mistralParams = mockCompletion.mock.calls.at(-1)?.[0];
  expect(mistralParams.prompt).toContain('[INST]Answer in Chinese');
  expect(mistralParams.prompt).toContain("Plan today's tasks[/INST]");
  expect(mistralParams.stop).toEqual(['</s>', '[INST]']);

  await expect(engine.loadModel('phi-3.5-mini')).resolves.toBe(true);
  await engine.generate({ messages });
  const phiParams = mockCompletion.mock.calls.at(-1)?.[0];
  expect(phiParams.prompt).toContain('<|system|>\nAnswer in Chinese<|end|>');
  expect(phiParams.prompt).toContain('<|user|>\nPlan today');
  expect(phiParams.stop).toContain('<|end|>');

  await expect(engine.loadModel('qwen2.5-0.5b')).resolves.toBe(true);
  await engine.generate({ messages });
  const qwenParams = mockCompletion.mock.calls.at(-1)?.[0];
  expect(qwenParams.prompt).toContain('<|im_start|>user\nPlan today');
  expect(qwenParams.stop).toEqual(['<|im_end|>', '<|im_start|>']);
});

test('Qwen3 1.7B uses the verified free GGUF endpoint and non-thinking local prompt', async () => {
  const { MODEL_REGISTRY } = require('../../services/localLLMInference');
  expect(MODEL_REGISTRY['qwen3-1.7b']).toMatchObject({
    modelFileName: 'Qwen3-1.7B-Q4_K_M.gguf',
    modelUrl: 'https://huggingface.co/ggml-org/Qwen3-1.7B-GGUF/resolve/main/Qwen3-1.7B-Q4_K_M.gguf',
    modelSize: 1_280_000_000,
  });
  mockGetInfo.mockResolvedValue({ exists: true, size: 1_280_000_000 });
  await expect(engine.loadModel('qwen3-1.7b')).resolves.toBe(true);
  await engine.generate({
    messages: [
      { role: 'system', content: '請用繁體中文回答' },
      { role: 'user', content: '幫我整理本週行程' },
    ],
  });
  const params = mockCompletion.mock.calls.at(-1)?.[0];
  expect(params.prompt).toContain('幫我整理本週行程\n/no_think<|im_end|>');
  expect(params.stop).toEqual(['<|im_end|>', '<|im_start|>']);
  expect(mockInitLlama).toHaveBeenCalledWith(expect.objectContaining({
    n_ctx: 4096,
    n_gpu_layers: 99,
  }));
});
