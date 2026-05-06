jest.mock("../../firebase", () => ({
  getFirebaseApp: jest.fn(() => ({})),
  hasUsableFirebaseConfig: jest.fn(() => false),
}));

import {
  buildAssistantCapabilityPrompt,
  getAssistantIdentityAnswer,
  getAssistantProfileTrainingSeeds,
} from "../../data/aiAssistantProfile";
import {
  exportTrainingInsights,
  getDefaultTrainingDB,
} from "../../data/puAIAgentData";
import { chatWithCampusAssistant } from "../../services/ai";

describe("AI assistant capability profile", () => {
  beforeEach(() => {
    process.env.EXPO_PUBLIC_AI_PROVIDER = "offline";
    process.env.EXPO_PUBLIC_AI_TEST_FAST = "1";
    delete process.env.APP_ENV;
    delete process.env.EXPO_PUBLIC_API_ENV;
  });

  it("injects agent behavior without pretending model parameters changed", () => {
    const prompt = buildAssistantCapabilityPrompt({
      role: "student",
      provider: "offline",
      hasSignedInUser: true,
      hasSchoolId: true,
      isOnline: false,
    });

    expect(prompt).toContain("不能把模型權重或參數量變成 ChatGPT/Codex 等級");
    expect(prompt).toContain("確認卡");
    expect(prompt).toContain("草稿");
    expect(prompt).toContain("不偽造完成");
  });

  it("seeds local training examples for parameter honesty and confirmed execution", () => {
    const seeds = getAssistantProfileTrainingSeeds();
    expect(seeds.goodExamples.length).toBeGreaterThanOrEqual(8);
    expect(seeds.goodExamples.some((example) => example.q.includes("參數"))).toBe(true);
    expect(seeds.goodExamples.some((example) => example.a.includes("確認卡"))).toBe(true);

    const db = getDefaultTrainingDB();
    const insights = exportTrainingInsights(db);
    expect(db.goodExamples.length).toBeGreaterThanOrEqual(8);
    expect(insights).toContain("讓你的參數跟 ChatGPT 一樣多");
    expect(insights).toContain("不能改變 App 端模型權重");
  });

  it("answers parameter requests honestly in offline chat", async () => {
    const response = await chatWithCampusAssistant(
      [{ role: "user", content: "繼續訓練你，讓你的參數跟 Codex 一樣多" }],
      { schoolId: "tw-pu", userId: "u1", userName: "測試同學" },
    );

    expect(response.content).toContain("不能把 App 端模型參數量");
    expect(response.content).toContain("不會假裝");
    expect(response.content).toContain("DataSource");
  });

  it("exposes the same identity policy for non-offline providers", () => {
    const answer = getAssistantIdentityAnswer("gemini");
    expect(answer).toContain("不能把 App 端模型參數量");
    expect(answer).toContain("雲端或本地 LLM");
    expect(answer).toContain("工具權限");
  });

  it("does not call client-side Gemini in release builds", async () => {
    process.env.APP_ENV = "production";
    process.env.EXPO_PUBLIC_AI_PROVIDER = "gemini";
    process.env.EXPO_PUBLIC_GEMINI_API_KEY = "client-key-should-not-be-used";

    const originalFetch = global.fetch;
    const fetchMock = jest.fn();
    (global as any).fetch = fetchMock;

    try {
      const response = await chatWithCampusAssistant(
        [{ role: "user", content: "幫我查最新公告" }],
        { schoolId: "tw-pu", userId: "u1", userName: "測試同學" },
      );

      expect(fetchMock).not.toHaveBeenCalled();
      expect(response.error).toContain("後端代理");
    } finally {
      (global as any).fetch = originalFetch;
    }
  });
});
