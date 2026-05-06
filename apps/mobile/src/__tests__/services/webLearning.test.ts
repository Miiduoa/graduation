import AsyncStorage from "@react-native-async-storage/async-storage";

import {
  buildAnswerFromLearnedWebItem,
  buildWebLearningTrainingText,
  clearWebLearningItems,
  findRelevantWebLearningItem,
  listWebLearningItems,
  normalizeWebLearningQuery,
  saveWebLearningAnswer,
  type WebLearningItem,
} from "../../services/webLearning";
import type { WebGroundedAnswer } from "../../services/webSearch";

const answer: WebGroundedAnswer = {
  content: "我先連網查公開來源，再把證據整理後回答：\n\n結論：300 路線可從靜宜大學到臺中車站。\n\n資料來源：臺中市公車即時動態",
  confidence: "high",
  fetchedAt: "2026-04-30T12:00:00.000Z",
  sources: [
    {
      title: "臺中市友善公車到站時間查詢：300 靜宜大學 - 臺中車站",
      url: "https://citybus-free.taichung.gov.tw/driving-map?route=300",
      source: "臺中市公車即時動態",
      snippet: "300 路線為靜宜大學 - 臺中車站。",
    },
  ],
};

describe("web learning knowledge base", () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  it("normalizes and stores source-grounded answers", async () => {
    const item = await saveWebLearningAnswer("怎麼去台中車站？", answer);

    expect(item.normalizedQuery).toBe(normalizeWebLearningQuery("怎麼去台中車站？"));
    expect(item.tags).toContain("transport");
    expect(await listWebLearningItems()).toHaveLength(1);
  });

  it("finds similar learned questions and keeps training text source-grounded", async () => {
    await saveWebLearningAnswer("怎麼去台中車站", answer);

    const item = await findRelevantWebLearningItem("靜宜到臺中車站怎麼走", { allowStale: true });
    expect(item?.query).toBe("怎麼去台中車站");

    const trainingText = buildWebLearningTrainingText(item as WebLearningItem);
    expect(trainingText).toContain("只能根據來源回答");
    expect(trainingText).toContain("臺中市友善公車");

    const learnedAnswer = buildAnswerFromLearnedWebItem("靜宜到臺中車站怎麼走", item as WebLearningItem);
    expect(learnedAnswer.content).toContain("本機先前連網學到");
    expect(learnedAnswer.content).toContain("保留來源");
  });

  it("can clear learned web items", async () => {
    await saveWebLearningAnswer("怎麼去台中車站", answer);
    await clearWebLearningItems();

    expect(await listWebLearningItems()).toEqual([]);
  });
});
