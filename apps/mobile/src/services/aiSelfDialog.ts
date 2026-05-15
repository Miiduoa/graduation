/* eslint-disable */
/**
 * AI Self-Dialog Evaluation：以 autonomousQuery + mockDataSource 對口語情境句做離線輪詢壓力測試。
 * 提示句集合與 aiConversationSim.test.ts 對齊並補上多行場景句。
 */

import { mockSource } from '../data/mockSource';
import type { CampusActorRole } from '../data/types';
import { setDataSource } from '../data/source';
import { autonomousQuery, type AgentQueryResult } from './aiLocalAgent';
import { generateDynamicNaturalLanguagePrompt } from './aiDynamicTraining';

export type AISelfDialogScenario = {
  id: string;
  description: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  expectedTopics?: string[];
  /** intents／executed／results 至少須出現其一（寬鬆驗收） */
  expectAnyTools?: string[];
  /** contextText 須包含的子字串（選填） */
  expectContextIncludes?: string[];
  role?: CampusActorRole;
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
  "我人卡在圖書館晚點還有課可是肚子狂叫該先幹嘛",
  "幫我續借人工智慧那本",
  "還書要把程式設計那本歸還",
  "算了圖書館自習座位預約我要取消",
  "我去宿舍領包裹了確認取件",
  "便當雞腿飯超讚給五顆星啦",
  "加入讀書會群組 cs-read-99",
  "小組發文問大家期末要不要一起念",
  "報告作業我都寫完了幫我繳交一下",
  "幫我加讀書會行程進明天下午三點行事曆",
  "刪除行程期中考複習那個我不需要了",
  "修改行程讀書會改到晚上七點好不好",
  "這堂微積分課開始點名吧",
  "幫我出作業期末專題提案截止下週",
  "批改作業幫學生小明的繳交打88分寫得不錯",
  "發布公告停課因為颱風來了緊急通知",
  "呃那個啦明天那個課然後我又餓又想看公告你随意",
  "not 飯 ok I need 成績 bus route 失物錢包",
  "退選啦干不想修微積分了啦幫我退",
  "幫我私訊阿銘跟他說錢還你了不要再已讀不回",
  "………算了你直接 comprehensive 我整個人爆炸塞車遲到又有作業 due",
  "Orz 簽到簽倒簽道三選一要幫我打卡啦",
  "早安我還沒醒先給我懶人包",
  "等等我其實只想知道今天第一堂在哪",
  "幹趕不上簽到了",
  "下課想吃素的路線規劃一下",
  "下午請假頭痛一整個爆炸",
  "順便預約洗衣機不然沒內褲穿",
  "後悔不想去了可以嗎",
  "印論文一式兩份黑白雙面感恩",
  "期中考啥時侯啦我真的會謝 quiz schedule",
  "這課配分佔比到底怎麼蒜…會不會被當啊",
  "tronclass 討論區有沒有新串啊救命",
  "老師上船的講義ppt在哪下載啊找不到",
  "微積分課誰在修啦同學名單給我瞄一眼",
  "作業繳交狀態跟詳請帮我看一下行不行",
  "課堂公告是不是又發新的了我漏看了",
  "论坛有没有新帖子啊我慌了",
  "讲义课件在哪下载急死了",
  "帮我查挂号预约记录谢谢",
  "幫我查預約健康檢查的紀錄好不好",
  "明天牙痛幫我预约挂号好不好啦",
  "幫我把面試加到行事曆明天下午兩點好不好",
  "改一下行程面試換到晚上七點啦干",
  "刪掉行程面試那個我不去了",
  "幫我din訂晚餐啦随便啦快",
  "把這週行程sync到我的brain裡啦（行事曆）",
  "今天有啥活動我就廢不想動腦",
  "餐廳老闆：今天便當線上單幫我對一下有沒有漏單",
  "行政端：麻煩發全校公告飲水機清洗那種口吻正式一點",
  "我想跟主管談加薪，幫我整理一個不尷尬的開場白",
  "這段英文 email 聽起來太硬，幫我改得自然一點",
  "我想買筆電但預算有限，怎麼比較規格才不會被話術帶走",
  "租屋合約看起來怪怪的，先提醒我可能要注意什麼",
  "明天要面試，幫我模擬三題追問",
  "我想寫一個 JS 小遊戲，先幫我拆功能",
  "如果朋友一直已讀不回，我要怎麼講才不尷尬？",
  "今天晚餐想自己煮，冰箱只有蛋跟青菜，幫我想一下怎麼配",
  "我想練英文口說，但不知道每天要怎麼安排",
  "幫我把這段抱怨改成比較成熟的說法",
  "我跟室友溝通清潔分工一直卡住，怎麼開口比較好",
  "家裡長輩一直催我找工作，我要怎麼回比較不吵架",
  "我想開始運動但很容易放棄，幫我設計低門檻版本",
  "我想整理房間但完全不知道從哪裡開始",
  "幫我想一個週末小旅行的大概規劃，不用訂票",
  "我要準備作品集，先幫我排優先順序",
  "我想學投資但怕被騙，先告訴我怎麼辨識風險",
  "手機照片太亂了，怎麼分類比較不痛苦",
  "我想把日記寫得自然一點，不要像作文",
  "我最近拖延很嚴重，幫我拆一個今天就能做的版本",
  "我想學做菜，冰箱常備食材應該怎麼買",
  "朋友生日快到但我預算不高，禮物怎麼挑",
  "想做個簡單網站放作品，先幫我想頁面架構",
  "我想把履歷第一段改得比較有重點",
  "我要向客服反映問題，但不想語氣太兇",
  "我想跟朋友道歉，但不知道怎麼說比較真誠",
  "我覺得最近壓力很大，只想先把事情排出先後",
  "我想戒掉睡前滑手機，幫我想一個不痛苦的方法",
  "我想買二手相機，檢查時要注意哪些坑",
  "幫我把一個模糊的創業點子拆成可驗證假設"
];

export const AI_SELF_DIALOG_SCENARIOS: AISelfDialogScenario[] = [];

export function evaluateSelfDialogResponse(
  scenario: AISelfDialogScenario,
  result: AgentQueryResult,
): AISelfDialogFailure | null {
  const tools = new Set<string>();
  for (const i of result.intents ?? []) tools.add(i.tool);
  for (const e of result.executedActions ?? []) tools.add(e.tool);
  for (const r of result.results ?? []) tools.add(r.tool);

  if (scenario.expectAnyTools?.length) {
    const hit = scenario.expectAnyTools.some((t) => tools.has(t));
    if (!hit) {
      return {
        scenarioId: scenario.id,
        reason: `missing_any_tool:${scenario.expectAnyTools.join(',')}`,
        actual: [...tools].join(','),
      };
    }
  }

  if (scenario.expectContextIncludes?.length) {
    const ctx = String(result.contextText ?? '');
    for (const kw of scenario.expectContextIncludes) {
      if (!ctx.includes(kw)) {
        return {
          scenarioId: scenario.id,
          reason: `context_missing:${kw}`,
          actual: ctx.slice(0, 280),
        };
      }
    }
  }

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

function shufflePrompts(prompts: string[], rand: () => number): string[] {
  const shuffled = [...prompts];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

function varyPrompt(prompt: string, rand: () => number): string {
  if (prompt.trim().length <= 6 || /^[😊👍👌✅.。…\s]+$/.test(prompt)) return prompt;

  const prefixes = ['', '', '欸，', '我說得有些亂：', 'quick question，', '先用自然語言理解一下：'];
  const suffixes = ['', '', '，有些急', '，但不要亂執行', '，先抓重心', ' thanks'];
  const prefix = prefixes[Math.floor(rand() * prefixes.length)] ?? '';
  const suffix = suffixes[Math.floor(rand() * suffixes.length)] ?? '';
  return `${prefix}${prompt}${suffix}`;
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

  const useDynamicPrompts = fromScenarios.length === 0;
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
  const maxFailureDetails = 48;
  let passed = 0;
  let failed = 0;
  const rand = mulberry32(seed >>> 0);
  let shuffledPrompts = shufflePrompts(promptsPool, rand);

  for (let i = 0; i < rounds; i++) {
    if (i > 0 && i % promptsPool.length === 0) {
      shuffledPrompts = shufflePrompts(promptsPool, rand);
    }
    const baseMsg =
      useDynamicPrompts && i % 2 === 0
        ? generateDynamicNaturalLanguagePrompt(seed, i)
        : shuffledPrompts[i % promptsPool.length]!;
    const msg = varyPrompt(baseMsg, rand);
    try {
      await autonomousQuery(msg, ctx, undefined, []);
      passed += 1;
    } catch (e: unknown) {
      failed += 1;
      if (failures.length < maxFailureDetails) {
        failures.push({
          scenarioId: `round-${i}`,
          reason: 'throw',
          actual: e instanceof Error ? e.message : String(e),
        });
      }
      if (failed >= maxFailures) break;
    }
  }

  return {
    total: passed + failed,
    passed,
    failed,
    failures,
    durationMs: Date.now() - t0,
  };
}
