import {
  observeInteraction,
  recordToolOutcome,
} from './aiContinualLearning';
import type { AgentQueryResult } from './aiLocalAgent';

type Pickable = readonly string[];

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T extends string>(items: readonly T[], rand: () => number): T {
  return items[Math.floor(rand() * items.length)]!;
}

const LIFE_TOPICS = [
  '跟主管談加薪',
  '把英文 email 改自然',
  '比較筆電規格',
  '檢查租屋合約風險',
  '準備面試追問',
  '設計 JS 小遊戲',
  '挑朋友生日禮物',
  '跟室友談清潔分工',
  '建立低門檻運動習慣',
  '拆創業點子成假設',
  '寫客服申訴但不太兇',
  '整理作品集網站架構',
  '跟朋友道歉',
  '戒睡前滑手機',
  '買二手相機避坑',
  '整理房間第一步',
  '安排週末小旅行',
  '做菜常備食材',
  '把抱怨改成熟',
  '排壓力事項優先順序',
  '判斷網路賣場是不是詐騙',
  '規劃搬家前兩週清單',
  '把會議記錄改成可執行待辦',
  '跟家人談照護分工',
  '整理研究摘要給非本科的人看',
  '寫履歷專案描述',
  '比較健身房方案',
  '估算小型活動預算',
  '把社群貼文改得不尷尬',
  '準備第一次接案報價',
  '整理旅行行李但不要帶太多',
  '規劃省錢但不痛苦的飲食',
  '跟客服要求退費',
  '判斷二手車或機車風險',
  '把焦慮的訊息改成穩一點',
  '幫長輩設定手機流程',
  '規劃搬出宿舍後的採買',
  '整理投資記帳但不做買賣建議',
  '比較手機續約和空機方案',
  '處理朋友臨時取消約定',
  '準備社團幹部交接',
  '把資料表欄位命名得清楚',
  '寫短影音腳本但不要浮誇',
  '安排一週讀書和打工時間',
  '分析產品訪談重點',
  '把失禮的訊息改成有界線',
  '幫忙規劃小型展覽動線',
  '整理保險條款問題清單',
  '設計新手可完成的烘焙流程',
  '評估要不要接一個低預算案子',
] as const;

const CAMPUS_TOPICS = [
  '查今天課表和教室',
  '拆最近作業步驟',
  '判斷成績風險',
  '查未讀通知',
  '預約圖書館座位',
  '借書或續借',
  '宿舍報修',
  '查包裹狀態',
  '安排讀書會行事曆',
  '查校車和公車',
  '查活動報名',
  '查健康預約紀錄',
  '整理期中考讀書順序',
  '問教授信件草稿',
  '查社團會議時間',
  '處理分組報告有人沒回',
  '確認畢業門檻還缺什麼',
  '整理選課衝堂問題',
  '詢問實習申請期限',
  '查獎學金文件',
  '安排補交作業說明',
  '整理校內打工班表',
  '查實驗室安全規範',
  '處理教室臨時更換',
  '規劃專題展示流程',
  '確認學分抵免資料',
  '準備校內競賽提案',
] as const;

const CAPABILITY_GAP_TOPICS = [
  '幫我打電話給房東催修水管',
  '幫我登入銀行確認帳單',
  '幫我直接轉帳給同學',
  '幫我訂機票但我還沒給日期',
  '幫我操作 IG 發文',
  '幫我在外部網站改密碼',
  '幫我叫車去高鐵站',
  '幫我付款買演唱會票',
  '幫我寄出正式 email 但先不要真的送',
  '幫我操作 LINE 回覆家人',
  '幫我查即時股價並直接下單',
  '幫我刪掉外部帳號',
] as const;

const AGENT_PROCESS_REQUESTS = [
  '先判斷要不要用工具，不確定就追問',
  '如果需要寫入，先幫我查資料再決定',
  '不要直接執行危險動作，先說你缺什麼',
  '把你會做的步驟拆開，不要只給結論',
  '如果資料不夠，告訴我下一句該回什麼',
  '先處理最急的，其他列成待辦',
  '用我的語氣改成自然但不要亂送出',
  '先給草稿，不要幫我真的發出去',
  '先辨認這是查詢、建議、草稿還是寫入',
  '如果一句話裡有兩個任務，先拆開再處理',
  '如果你只是推測，請標出不確定的地方',
  '先判斷哪些能在 APP 內做，哪些只能給建議',
  '如果需要人名、時間、地點或數量，先檢查有沒有缺',
  '先給我最小可行下一步，不要一次塞太多',
  '把可能誤觸工具的詞先排除掉',
  '如果工具回來空資料，請改成下一步詢問',
  '如果超出你的能力，先說清限制，再做能做的部分',
  '不能代辦的外部動作要改成草稿、檢查清單或操作步驟',
  '不要假裝已經操作外部 APP 或帳號',
] as const;

const AMBIGUITY_CONTEXTS = [
  '我前面講得很跳，可能有兩件事混在一起',
  '對方只回了「嗯」，我不知道要不要繼續',
  '時間有點模糊，只知道大概下週',
  '名字可能同音，我不確定是哪個人',
  '其中一段只是抱怨，不一定要執行',
  '我剛剛可能講錯條件，請先幫我抓矛盾',
  '我希望你不要把例子當成真的指令',
  '我可能是在問建議，不是在請你代辦',
  '資料可能過期，請不要假裝很確定',
  '如果像是高風險決定，請提醒我找專業人士',
] as const;

const OUTPUT_EXPECTATIONS = [
  '先一句話抓重點，再列 3 個下一步',
  '用可以直接貼給對方的口吻',
  '分成「能做、要確認、不要做」',
  '先問最多兩個關鍵問題',
  '用短句，不要講得像制式客服',
  '列出你判斷是否要用工具的理由',
  '先給保守版本，再給自然版本',
  '用台灣日常語氣，不要太正式',
  '如果不該執行，請明確說只提供草稿',
  '最後補一句我下一步可以怎麼回',
] as const;

const ACTION_BOUNDARIES = [
  '沒有明確對象不要送出',
  '沒有明確餐點或數量不要下單',
  '沒有明確日期時間不要建立行事曆',
  '沒有確認是校園資料就不要查校園工具',
  '如果只是買東西建議，不要誤判成訂餐',
  '如果只是朋友聊天，不要誤判成站內訊息',
  '如果只是提到通知，不要直接標成已讀',
  '如果只是晚餐靈感，不要直接查學餐',
  '如果查無資料，請回報缺口而不是編答案',
  '如果使用者情緒很急，也不能跳過確認',
] as const;

const USER_FRAMES = [
  '我是第一次遇到這種狀況',
  '我正在通勤，只能回很短',
  '我剛下課，腦袋有點亂',
  '我在打工前五分鐘才想到',
  '我手機快沒電',
  '我現在有點生氣但不想失禮',
  '我只記得一半資訊',
  '我先用語音亂講，可能有錯字',
  '我在幫朋友問，不確定細節',
  '我希望先不要驚動其他人',
  '我在趕時間，但可以接受先問一題',
  '我不想讓事情變複雜',
] as const;

const MESSY_INPUTS = [
  '可能有同音字打錯',
  '中間穿插一句抱怨，不一定是指令',
  '有一個條件可能跟前面矛盾',
  '我可能把例子和真需求混在一起',
  '上一句沒有主詞',
  '時間只說大概，沒有精準日期',
  '人名或地點可能不完整',
  '有些詞是英文縮寫',
  '我可能把要查詢和要執行混在一起',
  '我講得像命令，但其實只是想先討論',
  '我故意講得很模糊，想看你會不會亂猜',
  '我只丟關鍵字，沒有完整句子',
] as const;

const CONSTRAINT_TWISTS = [
  '請先分辨哪些能在 APP 內完成，哪些只能提供草稿',
  '如果要用到外部帳號，請改成操作步驟',
  '如果像是高風險決定，請不要替我下決定',
  '如果是寫入或送出，請先卡住確認',
  '如果資料不足，請不要編故事',
  '如果有兩個任務，請先拆優先順序',
  '如果工具查不到，請改問下一個必要資訊',
  '如果只是聊天，不要硬導向工具',
  '如果需要今天/明天，請先確認日期',
  '如果我要求你做不到的事，請說能做的替代方案',
  '請把可執行和不可執行分開講',
  '請保留不確定性，不要裝成已完成',
] as const;

const STYLES = [
  '我說得很亂：{topic}，{process}。{context}。{output}。{boundary}',
  'quick question，{topic}，{process}。{context}。{output}。{boundary}',
  '欸我有點卡住，{topic}，{process}。{context}。{output}。{boundary}',
  '{topic}這件事我不確定怎麼辦，{process}。{context}。{output}。{boundary}',
  '先不要急著下結論，{topic}，{process}。{context}。{output}。{boundary}',
  '我可能講不清楚，但大概是{topic}，{process}。{context}。{output}。{boundary}',
  '用很白話的方式幫我處理：{topic}，{process}。{context}。{output}。{boundary}',
  '中英混著說也可以，{topic}，{process}。{context}。{output}。{boundary}',
  '假設我是第一次遇到這種事：{topic}。{process}。{context}。{output}。{boundary}',
  '我只丟關鍵字給你：{topic}；{process}。{context}。{output}。{boundary}',
  '這句話可能有歧義：{topic}。{process}。{context}。{output}。{boundary}',
  '幫我像真正助理一樣判斷：{topic}。{process}。{context}。{output}。{boundary}',
] as const;

const NOISE = [
  '',
  '，有些急',
  '，但不要亂執行',
  '，先抓重心',
  ' thanks',
  '，如果聽不懂先問我',
] as const;

export function generateDynamicNaturalLanguagePrompt(seed: number, index: number): string {
  const rand = mulberry32((seed + index * 2654435761) >>> 0);
  const topicPool: Pickable =
    index % 4 === 0
      ? LIFE_TOPICS
      : index % 4 === 1
        ? CAMPUS_TOPICS
        : index % 4 === 2
          ? CAPABILITY_GAP_TOPICS
          : [...LIFE_TOPICS, ...CAMPUS_TOPICS, ...CAPABILITY_GAP_TOPICS];
  const topic = pick(topicPool, rand);
  const process = pick(AGENT_PROCESS_REQUESTS, rand);
  const context = pick(AMBIGUITY_CONTEXTS, rand);
  const output = pick(OUTPUT_EXPECTATIONS, rand);
  const boundary = pick(ACTION_BOUNDARIES, rand);
  const frame = pick(USER_FRAMES, rand);
  const messy = pick(MESSY_INPUTS, rand);
  const twist = pick(CONSTRAINT_TWISTS, rand);
  const style = pick(STYLES, rand);
  const noise = pick(NOISE, rand);
  const prompt = style
    .replace('{topic}', topic)
    .replace('{process}', process)
    .replace('{context}', context)
    .replace('{output}', output)
    .replace('{boundary}', boundary) + noise;
  const scenario = `背景：${frame}。輸入狀態：${messy}。額外限制：${twist}。`;
  return `${prompt}。${scenario}（訓練情境 ${seed.toString(36)}-${index.toString(36)}）`;
}

export function buildBroadNaturalLanguageRuntimeGuide(): string {
  return [
    '## 廣域自然語言與代理訓練策略',
    '- 使用者不一定只聊校園；生活、職涯、寫作、購物、租屋、感情溝通、程式設計、旅行、習慣養成等一般問題，也要正常理解並回答。',
    '- 不要因為句子含「點、買、訂、已讀、通知、晚餐」就硬套校園工具；必須先判斷語境是否真的是點餐、訊息、通知或校園任務。',
    '- 代理流程要分清楚：讀取查詢、寫入動作、草稿建議、一般聊天。資料不足時先追問或給草稿，不能假裝已完成。',
    '- 寫入型動作要先確認真實目標與必要參數；找不到人、課程、訂單、座位、作業或包裹時，要說明缺口並給下一步。',
    '- 每次工具成功或失敗都視為代理訓練樣本：學到使用者說法、工具選擇、缺參數原因與更好的下一步。',
    '- 訓練資料要持續換 seed、換語氣、換領域、換模糊條件與工具邊界；不要長時間重刷同一批句型。',
    '- 遇到能力外問題時，不要只拒絕或假裝完成；先說清楚不能直接代辦的部分，再用推理提供草稿、檢查清單、操作步驟、風險提醒或需要的外部權限。',
  ].join('\n');
}

export function detectCapabilityGap(userMessage: string): string | null {
  const msg = userMessage.replace(/[\u200B-\u200D\uFEFF]/g, '').normalize('NFKC').toLowerCase();
  if (/打電話|撥電話|phone call|call\b/.test(msg)) return 'phone_call';
  if (/登入|登錄|外部網站|外部 app|操作.*(?:ig|instagram|line|瀏覽器|browser|銀行|bank)/i.test(msg)) return 'external_app_or_account';
  if (/轉帳|匯款|付款|刷卡|買票|下單(?:股票|基金|加密貨幣|幣)|買(?:股票|基金|加密貨幣|幣)/.test(msg)) return 'financial_or_purchase_action';
  if (/訂機票|買機票|機票|訂飯店|訂旅館|叫車|預約.*(?:外部|第三方)|刪掉外部帳號|改密碼/.test(msg)) return 'external_booking_or_account_action';
  if (/能力以外|做不到|不能直接|沒有權限|沒有工具/.test(msg)) return 'explicit_capability_gap';
  return null;
}

export function summarizeAgentProcessTrace(result: AgentQueryResult): string {
  const intents = result.intents.map((i) => `${i.tool}:${i.reason}`).slice(0, 5);
  const reads = result.results.map((r) => `${r.tool}:${r.result.success ? 'ok' : 'fail'}`).slice(0, 5);
  const writes = result.executedActions.map((a) => `${a.tool}:${a.result.success ? 'ok' : 'fail'}`).slice(0, 5);
  const gaps = result.failedActions.map((a) => `${a.tool}:${a.missingInfo}`).slice(0, 5);

  return [
    intents.length ? `意圖=${intents.join(' | ')}` : '意圖=none',
    reads.length ? `讀取=${reads.join(' | ')}` : '讀取=none',
    writes.length ? `寫入=${writes.join(' | ')}` : '寫入=none',
    gaps.length ? `缺口=${gaps.join(' | ')}` : '缺口=none',
    `耗時=${result.totalTimeMs}ms`,
  ].join('；');
}

export function recordAgentProcessTraining(userMessage: string, result: AgentQueryResult): void {
  const capabilityGap = detectCapabilityGap(userMessage);
  const summary = summarizeAgentProcessTrace(result);

  try {
    observeInteraction({
      kind: 'observation',
      userMessage,
      summary: `代理流程訓練${capabilityGap ? `；能力缺口=${capabilityGap}` : ''}：${summary}`,
      tags: [
        'agent_process',
        ...(capabilityGap ? ['capability_gap', capabilityGap] : []),
        ...result.intents.map((i) => i.tool).slice(0, 6),
      ],
    });
  } catch (e) {
    console.warn('[AIDynamicTraining] observe agent process failed:', e);
  }

  for (const action of result.executedActions) {
    try {
      recordToolOutcome(
        action.tool,
        ((action.result as any).data ?? {}) as Record<string, unknown>,
        action.result.success ? 'success' : 'failure',
        action.result.error,
        userMessage,
      );
    } catch (e) {
      console.warn('[AIDynamicTraining] record executed action failed:', e);
    }
  }

  for (const failed of result.failedActions) {
    try {
      observeInteraction({
        kind: 'tool_failure',
        tool: failed.tool,
        outcome: 'failure',
        userMessage,
        error: failed.missingInfo,
        summary: `代理缺參數：${failed.reason}；${failed.missingInfo}`,
        tags: ['agent_gap', failed.tool],
      });
    } catch (e) {
      console.warn('[AIDynamicTraining] record failed action failed:', e);
    }
  }
}
