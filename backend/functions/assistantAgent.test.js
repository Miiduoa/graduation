const {
  answerWithServerWebSearch,
  callAssistantModel,
  normalizeAssistantActions,
  resolvePermissionScope,
  shouldUseServerWebSearch,
} = require("./assistantAgent");

function mockResponse({ ok = true, status = 200, json = {}, text = "", retryAfter = null }) {
  return {
    ok,
    status,
    headers: {
      get(name) {
        return name.toLowerCase() === "retry-after" ? retryAfter : null;
      },
    },
    async json() {
      return json;
    },
    async text() {
      return text;
    },
  };
}

describe("assistant agent policy", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    jest.restoreAllMocks();
  });

  test("keeps personal data intents away from public web search", () => {
    expect(shouldUseServerWebSearch("今天有什麼作業要交？", "assignment_status")).toBe(false);
    expect(shouldUseServerWebSearch("最新公告是什麼？", "announcements")).toBe(false);
    expect(shouldUseServerWebSearch("靜宜今天會下雨嗎？", "general")).toBe(true);
    expect(resolvePermissionScope("assignment_status", true)).toBe("user_private");
    expect(resolvePermissionScope("credit_audit", true)).toBe("academic_private");
  });

  test("normalizes action allowlist and forces sensitive actions into confirmation", () => {
    const actions = normalizeAssistantActions(
      [
        { label: "提醒", action: "schedule_reminder", params: { title: "作業" } },
        { label: "未知", action: "delete_everything" },
        { label: "導頁", action: "navigate", requiresConfirmation: false },
      ],
      "user_private",
    );

    expect(actions).toHaveLength(2);
    expect(actions[0]).toMatchObject({
      action: "schedule_reminder",
      requiresConfirmation: true,
      status: "pending_confirmation",
      permissionScope: "user_private",
    });
    expect(actions[1]).toMatchObject({
      action: "navigate",
      requiresConfirmation: false,
      status: "proposed",
    });
  });

  test("retries Groq 429 with retry-after before returning model output", async () => {
    process.env.GROQ_API_KEY = "test-key";
    process.env.GROQ_MODEL = "qwen/qwen3-32b";
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(mockResponse({ ok: false, status: 429, retryAfter: "0.001" }))
      .mockResolvedValueOnce(
        mockResponse({
          json: {
            choices: [{ message: { content: "後端模型回答" } }],
            usage: { total_tokens: 12 },
          },
        }),
      );

    const result = await callAssistantModel({
      providerOrder: ["groq"],
      fetchImpl,
      messages: [{ role: "user", content: "hi" }],
    });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({
      provider: "groq",
      model: "qwen/qwen3-32b",
      content: "後端模型回答",
      usage: { total_tokens: 12 },
    });
  });

  test("falls back from Groq to Gemini when the first provider fails", async () => {
    process.env.GROQ_API_KEY = "groq-key";
    process.env.GEMINI_API_KEY = "gemini-key";
    process.env.GEMINI_MODEL = "gemini-2.0-flash";
    const fetchImpl = jest.fn(async (url) => {
      if (String(url).includes("groq.com")) {
        return mockResponse({ ok: false, status: 400, text: "bad request" });
      }
      return mockResponse({
        json: {
          candidates: [{ content: { parts: [{ text: "Gemini 後端回答" }] } }],
          usageMetadata: { totalTokenCount: 8 },
        },
      });
    });

    const result = await callAssistantModel({
      providerOrder: ["groq", "gemini"],
      fetchImpl,
      messages: [{ role: "user", content: "hi" }],
    });

    expect(result).toMatchObject({
      provider: "gemini",
      model: "gemini-2.0-flash",
      content: "Gemini 後端回答",
      usage: { totalTokenCount: 8 },
    });
  });

  test("defaults to free Groq then Gemini provider order", async () => {
    delete process.env.ASSISTANT_MODEL_PROVIDERS;
    process.env.GROQ_API_KEY = "groq-key";
    process.env.GEMINI_API_KEY = "gemini-key";
    const fetchImpl = jest.fn(async (url) => {
      if (String(url).includes("groq.com")) {
        return mockResponse({ ok: false, status: 400, text: "bad request" });
      }
      return mockResponse({
        json: {
          candidates: [{ content: { parts: [{ text: "Gemini fallback" }] } }],
          usageMetadata: { totalTokenCount: 5 },
        },
      });
    });

    const result = await callAssistantModel({
      fetchImpl,
      messages: [{ role: "user", content: "hi" }],
    });

    expect(result.provider).toBe("gemini");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls.map(([url]) => String(url)).join("\n")).not.toContain("api.openai.com");
  });

  test("answers route questions with grounded sources without model calls", async () => {
    const result = await answerWithServerWebSearch("從靜宜大學怎麼去台中車站？");
    expect(result.content).toContain("Google Maps");
    expect(result.sources.some((source) => source.source.includes("公車"))).toBe(true);
  });
});
