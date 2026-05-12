/* eslint-disable */
/**
 * AI Self-Dialog Evaluation：以 autonomousQuery + mockDataSource 對口語情境句做離線輪詢壓力測試。
 * 提示句集合與 aiConversationSim.test.ts 對齊並補上多行場景句。
 */

import { setDataSource } from '../data/source';
import { mockSource } from '../data/mockSource';
import { autonomousQuery } from './aiLocalAgent';

export type AISelfDialogScenario = {
  id: string;
  description: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  expectedTopics?: string[];
};

export type AISelfDialogFailure = {
  scenarioId: string;
  reason: string;
  actual: string;
};

export type AISelfDialogReport = {
  total: number;
  passed: number;
  failed: number;
  failures: AISelfDialogFailure[];
  durationMs: number;
};

/** 預設口語句（對齊對話模擬測資） */
export const DEFAULT_SELF_DIALOG_PROMPTS: string[] = [
  "幫我訂午餐",
  "隨便幫我點",
  "我想吃點清淡的",
  "幫我點第一個",
  "不是炸的，要素的",
  "幫我點滷肉飯",
  "查看我的訂單",
  "取消最後一筆訂單",
  "我明天頭痛要請假",
  "幫我請病假",
  "我要幫今天的微積分課簽到",
  "我已經簽到了",
  "我想預約自習座位",
  "第一個就好",
  "幫我借《人工智慧》這本書",
  "隨便借一本相關的",
  "宿舍冷氣壞掉了幫我報修",
  "在 B302",
  "我要預約洗衣機",
  "有人領我的包裹嗎",
  "我好餓",
  "今天吃什麼好",
  "便宜一點的",
  "對對對就那個",
  "我明天忙嗎",
  "趕快幫我把未讀通知看一下啦",
  "幫我把所有通知都標為已讀",
  "通知小敏明天的會議改到 10 點",
  "今天我有什麼活動",
  "嗨",
  "你會啥",
  "asdfghjkl",
  "😊",
  "我要點 ZZZ 一份",
  "是雞腿飯啦",
  "幹我好餓喔有沒有東西吃",
  "肚餓扁了啦快救我",
  "欸幫我搞個晚餐好不好懒得想",
  "不要辣不要油這種啦你懂",
  "隨便啦你決定快一點",
  "那…最後一個好了",
  "欸我今天到底有什麼課啊超混亂",
  "下禮拜會不會很忙",
  "我作業是不是快爆了",
  "成績爛不爛啊",
  "還差多少學分才能畢業",
  "校車怎麼搭啊我完全沒概念",
  "學校最近有發什麼公告",
  "我這週行程表長怎樣",
  "今天下午有空嗎…大概",
  "幫我看一下有沒有通知",
  "私訊誰找過我",
  "我聊天列表亂掉了啦",
  "身體不太舒服想掛個號",
  "幫我預約健康檢查",
  "我錢包不見了哭啊",
  "撿到一隻 AirPods",
  "幫我印一下期中報告.pdf 黑白兩份",
  "我現在整個人狀態超糟你大概查一下",
  "最近有沒有什麼好玩的活動啊",
  "第一個我想去",
  "算了我還是不去了",
  "欸欸欸我忘記今天要幹嘛了",
  "你就…隨便幫我處理一下可以嗎",
  "我是誰我在哪我在幹嘛",
  "今天會不會被當",
  "算了先隨便來點能吃的啦不要想",
  "欸我剛剛是不是已經簽到啦還是沒",
  "那個行政大樓旁邊公車站到底在哪我路痴",
  "我覺得我完蛋了課業壓力好大",
  "欸 today 我到底有什麼課啦干",
  "幫我看一下有沒有 unread notification 好嗎",
  "校門口附近有 bus 嗎還是都要走过去",
  "幫我 book 一下圖書館位子啦拜託",
  "this week 的 schedule 幫我瞄一眼",
  "I lost my wallet 在圖書館附近…",
  "gg 了期末 draft 到底要交沒",
  "完蛋我要簽倒啦遲到爆",
  "請假單還沒過欸想查一下",
  "hhh我忘記今天要幹嘛了救命",
  "成績在哪看啊🥺期末已經來了",
  "我不是要吃飯我是想看成績好嗎",
  "就是…呃…公告啦學校有沒有發新的",
  "算了睡不著先掛個號好了",
  "靠邀誰剛剛一直密我啦很煩欸",
  "已讀不回是不是欠揍啦開玩笑的",
  "宵夜到底要吃啥啊選擇困難",
  "想喝手搖可是不知道哪家開著",
  "待會有課嗎我還想睡",
  "等一下要上啥啦",
  "包裹到了沒啊前天說出貨",
  "洗衣機現在有空嗎",
  "列印店在學校哪裡啊",
  "超怕二一啦你幫我看下成績趨勢",
  "學分到底還差多少我真的會癱",
  "校慶有啥活動不無聊的那種",
  "我現在心很累需要一鍵總覽",
  "雨大到會不會停課啊干",
  "幹嘛又要交作業了我還沒動筆",
  "到底哪堂課最會點名啦靠",
  "wifi 爛到爆宿舍能不能修",
  "借的書過期了會罰多少",
  "deadline 是明天還是後天我忘了",
  "其實我也不確定要不要退選",
  "算了還是先看我口袋還有多少錢",
  "要不然你直接給我今日懶人包",
  "不管了先說颱風有沒有放假好了",
  "欸你很急先幫我看通知未讀有哪些",
  "我想多修一門通識要怎麼加選",
  "教室在牛頓大樓到底是幾樓啊",
  "影印多少張以內免費這種規定在哪看",
  "煩死了啦肚子又餓又有通知未讀到底要先幹嘛",
  "你會什麼",
  "我人卡在圖書館晚點還有課可是肚子狂叫該先幹嘛"
];

export const AI_SELF_DIALOG_SCENARIOS: AISelfDialogScenario[] = [];

export function evaluateSelfDialogResponse(
  _scenario: AISelfDialogScenario,
  _response: string,
): AISelfDialogFailure | null {
  return null;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export async function runAISelfDialogEvaluation(options?: {
  scenarios?: AISelfDialogScenario[];
  concurrency?: number;
  rounds?: number;
  batchSize?: number;
  seed?: number;
  maxFailures?: number;
}): Promise<AISelfDialogReport> {
  const rounds = Math.max(1, Math.floor(Number(options?.rounds ?? 500)));
  const seed = Number(options?.seed ?? 411211325);
  const maxFailures = Math.max(1, Math.floor(Number(options?.maxFailures ?? 10)));

  const fromScenarios =
    options?.scenarios?.flatMap((sc) =>
      sc.messages.filter((m) => m.role === 'user').map((m) => m.content),
    ) ?? [];

  const promptsPool = fromScenarios.length > 0 ? fromScenarios : DEFAULT_SELF_DIALOG_PROMPTS;

  const t0 = Date.now();
  if (promptsPool.length === 0) {
    return {
      total: rounds,
      passed: 0,
      failed: 1,
      failures: [{ scenarioId: 'init', reason: 'no_prompts_pool', actual: '' }],
      durationMs: Date.now() - t0,
    };
  }

  void options?.batchSize;
  void options?.concurrency;

  setDataSource(mockSource as any);

  const ctx = {
    userId: 'self-dialog-eval',
    schoolId: 'pu',
    role: 'student' as const,
    isOnline: true,
  };

  const failures: AISelfDialogFailure[] = [];
  let passed = 0;
  const rand = mulberry32(seed >>> 0);

  for (let i = 0; i < rounds; i++) {
    const msg = promptsPool[Math.floor(rand() * promptsPool.length)]!;
    try {
      await autonomousQuery(msg, ctx, undefined, []);
      passed += 1;
    } catch (e: unknown) {
      failures.push({
        scenarioId: `round-${i}`,
        reason: 'throw',
        actual: e instanceof Error ? e.message : String(e),
      });
      if (failures.length >= maxFailures) break;
    }
  }

  return {
    total: rounds,
    passed,
    failed: failures.length,
    failures,
    durationMs: Date.now() - t0,
  };
}
