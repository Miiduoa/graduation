import { describe, expect, it } from 'vitest';
import { canAnswerTronClassQuestion, parseTronClassAgentIntent, tronClassExplicitNavigationQuestion, tronClassCompoundClauses, TRONCLASS_NEGATORS, classifyTronClassSentence } from './tronClassAgentIntent';

/** Unknown leftover tokens now make a sentence ambiguous (confirmation), which is acceptable. */
function expectAuthorizedOrAmbiguous(
  question: string,
  expected: { intent: string; pendingOnly: boolean; unsupportedReason?: string },
): void {
  const parsed = parseTronClassAgentIntent(question);
  const classified = classifyTronClassSentence(question);
  if (parsed == null) {
    expect(classified?.outcome === 'ambiguous' || classified == null).toBe(true);
    expect(canAnswerTronClassQuestion(question)).toBe(false);
    return;
  }
  expect(parsed).toEqual(expected);
  expect(canAnswerTronClassQuestion(question)).toBe(true);
}

/** A write with leftover unknown tokens may go to confirmation instead of auto-write. */
function expectWriteOrAmbiguous(question: string): void {
  const parsed = parseTronClassAgentIntent(question);
  const classified = classifyTronClassSentence(question);
  if (parsed == null) {
    expect(classified?.outcome === 'ambiguous' || classified == null).toBe(true);
    expect(canAnswerTronClassQuestion(question)).toBe(false);
  } else {
    expect(parsed.intent).toBe('unsupported');
  }
  expect(tronClassCompoundClauses(question)).toEqual([]);
}

describe('explicit TronClass navigation', () => {
  it.each(['開啟玩課雲作業', '前往玩課雲作業頁', '進入 TronClass 頁面', 'open TronClass 作業'])(
    'preserves the existing navigation command %s',
    question => {
      expect(tronClassExplicitNavigationQuestion(question)).toBe(question);
      expect(canAnswerTronClassQuestion(question)).toBe(false);
    },
  );

  it.each(['打開玩課雲', '幫我開玩課雲', 'open 玩課雲頁面'])(
    'resolves the shortcut %s to the LMS command',
    question => expect(tronClassExplicitNavigationQuestion(question)).toBe('開啟玩課雲作業'),
  );

  it.each([
    '打開玩課雲看有幾份作業',
    '前往玩課雲查作業截止',
    '進入 TronClass 看成績',
    'open TronClass 看有什麼作業',
    '玩課雲作業',
  ])('keeps the single-clause query %s eligible for Agent routing', question => {
    expect(tronClassExplicitNavigationQuestion(question)).toBeNull();
    expect(canAnswerTronClassQuestion(question)).toBe(true);
  });
});

describe('explicit TronClass command routing', () => {
  it.each([
    ['幫我查 TronClass 未繳作業', 'homework', true],
    ['TronClass 尚未提交的作業有哪些', 'homework', true],
    ['幫我查 TronClass 未交作業不要繳交', 'homework', true],
    ['請再查一下 TronClass 尚未提交的作業', 'homework', true],
    ['列出 tron class 課程', 'courses', false],
    ['玩課雲的公告', 'announcements', false],
    ['創課教材', 'materials', false],
    ['幫我下載 TronClass 講義', 'download', false],
    ['TronClass Agent 可以做什麼', 'capabilities', false],
    ['TronClass 作業繳交狀態', 'homework', false],
    ['幫我繳交 TronClass 未交作業', 'unsupported', false],
    ['幫我把 TronClass 未交作業全部繳交', 'unsupported', false],
    ['幫我準備 TronClass 作業並送出', 'unsupported', false],
    ['TronClass 查作業狀態：上傳附件', 'unsupported', false],
    ['TronClass 是否已繳交的作業', 'homework', false],
    ['TronClass 我的作業繳交紀錄', 'homework', false],
    ['幫我回覆 TronClass 討論', 'unsupported', false],
    ['TronClass 問卷填答', 'unsupported', false],
  ] as const)('routes %s without model-chosen tools', (question, intent, pendingOnly) => {
    expect(parseTronClassAgentIntent(question)).toEqual({ intent, pendingOnly });
    expect(canAnswerTronClassQuestion(question)).toBe(true);
  });

  it('routes a prepare request or asks for confirmation when a course name is unknown', () => {
    expectAuthorizedOrAmbiguous('幫我準備 TronClass 資料庫作業', { intent: 'prepare', pendingOnly: false });
  });

  it.each([
    '我有哪些作業',
    '翻譯「下載 TronClass 教材」',
    '教我如何使用 TronClass',
    '不要讀取我的 TronClass 作業',
    '不要看玩課雲作業',
    '不要顯示玩課雲作業',
    '不要確認玩課雲作業',
    '不用幫我下載 TronClass 講義',
    'TronClass 怎麼登入',
    '如何下載 TronClass 教材',
    'How to download TronClass files',
    '「幫我下載 TronClass 講義」',
    `TronClass ${'a'.repeat(1000)}`,
    '',
  ])('does not authorize private retrieval from %s', (question) => {
    expect(parseTronClassAgentIntent(question)).toBeNull();
    expect(canAnswerTronClassQuestion(question)).toBe(false);
  });

  it('does not automatically dispatch two different requested operations', () => {
    expect(parseTronClassAgentIntent('幫我下載 TronClass 教材並準備作業')).toEqual({ intent: 'unsupported', pendingOnly: false, unsupportedReason: 'multiple_actions' });
  });

  it.each([
    '玩課雲作業，查公車',
    '開啟玩課雲作業，查公車資訊',
    '玩課雲，查今天課表',
    '打開玩課雲然後查社團',
    '玩課雲作業順便查公車',
    '玩課雲作業，查交通',
    '玩課雲作業，開啟設定',
    '玩課雲作業和查公車',
    '玩課雲作業，查校園公告',
    '玩課雲作業，查成績',
    '開啟玩課雲作業，有哪些還沒交',
    '開啟玩課雲作業，查一下還沒交的有哪些',
    '玩課雲作業和教材有哪些',
    '玩課雲作業，下載講義',
    'TronClass 查未交作業，不要繳交',
    '開啟玩課雲作業，安排今天下午作業準備30分鐘',
  ])(
    'leaves the multi-clause request %s on the existing cross-service plan',
    question => {
      expect(parseTronClassAgentIntent(question)).toBeNull();
      expect(canAnswerTronClassQuestion(question)).toBe(false);
    },
  );
});

describe('TronClass clauses inside a multi-clause request', () => {
  it.each([
    ['開啟玩課雲作業，查一下還沒交的有哪些', ['玩課雲查一下還沒交的有哪些']],
    ['玩課雲作業和教材有哪些', ['玩課雲教材有哪些']],
    ['玩課雲作業，下載講義', ['玩課雲下載講義']],
    ['TronClass 查未交作業，不要繳交', ['TronClass 查未交作業']],
    ['查玩課雲未交作業和校園公告', ['查玩課雲未交作業']],
    ['查玩課雲未交作業，查交通資訊', ['查玩課雲未交作業']],
    ['幫我查 TronClass 未交作業，然後查公車', ['幫我查 TronClass 未交作業']],
    ['TronClass 未交作業，還沒交的作業', ['TronClass 未交作業']],
  ])('answers the TronClass part of %s with the Agent', (question, expected) => {
    expect(canAnswerTronClassQuestion(question)).toBe(false);
    expect(tronClassCompoundClauses(question)).toEqual(expected);
  });

  it.each([
    '開啟玩課雲作業，安排今天下午作業準備30分鐘',
    '玩課雲作業，查公車',
    '玩課雲作業和查公車',
    '玩課雲作業，查校園公告',
    '玩課雲作業，查成績',
    '玩課雲，查今天課表',
    '打開玩課雲然後查社團',
    '玩課雲作業順便查公車',
    '玩課雲作業，開啟設定',
    '玩課雲作業',
    'TronClass 有哪些未交作業',
    '查公車，然後看校園公告',
    '請幫我打開玩課雲作業與教材頁面，可以嗎？',
    '開啟玩課雲作業，教材頁面',
    '請把這句翻成英文，下載玩課雲講義',
    '翻譯成英文：玩課雲作業，查公車',
    '「玩課雲作業，下載講義」',
    '這段怎麼說，玩課雲作業',
    '不要查玩課雲，查公車',
    '不要讀取，玩課雲作業和講義',
    '下載玩課雲講義，然後幫我繳交',
    '玩課雲作業，幫我上傳附件',
    '「查玩課雲未交作業和講義」，查校園公告',
    '他說『玩課雲作業』，查公車',
    '查玩課雲未交作業，繳交附件',
    '下載玩課雲講義，上傳報告',
    '玩課雲作業，submit it',
    '查玩課雲未交作業，刪除舊紀錄',
    "校園公告，'查玩課雲未交作業，下載教材'",
    '查玩課雲未交作業，不要上傳附件然後繳交附件',
    '查玩課雲未交作業，刪除繳交紀錄',
    '查玩課雲未交作業，繳交包含目前狀態的報告',
    '查玩課雲未交作業，繳交作業狀態報告',
    '查玩課雲未交作業，不要上傳附件同時刪除草稿',
    '查玩課雲未交作業，不要繳交附件順便刪除草稿',
    '查玩課雲未交作業，不要繳交附件另外提交報告',
    '查玩課雲未交作業，不要上傳附件！刪除草稿',
    '查玩課雲未交作業，不要上傳附件!刪除草稿',
    '查玩課雲未交作業，不要上傳附件？刪除草稿',
    '查玩課雲未交作業，不要上傳附件?刪除草稿',
    '查玩課雲未交作業，不要繳交附件：刪除草稿',
    '查玩課雲未交作業，不要繳交附件\n刪除草稿',
    '查玩課雲未交作業，不要繳交附件後刪除草稿',
    '查玩課雲未交作業和查看作業狀態後上傳附件',
    '查玩課雲未交作業和查看作業狀態之後再上傳附件',
    '查玩課雲作業繳交狀態：繳交附件，校園公告',
    '查玩課雲作業繳交狀態:提交報告，校園公告',
    '查玩課雲作業繳交狀態，然後查看狀態並上傳附件',
    '查玩課雲作業狀態後把附件上傳，查校園公告',
    '查玩課雲作業繳交狀態後把附件上傳，看看校園公告',
    '查玩課雲作業狀態後將附件提交，校園公告',
    '查玩課雲作業狀態後請幫我把附件上傳，校園公告',
    '查玩課雲作業狀態並把附件上傳，校園公告',
    '查玩課雲作業狀態順便上傳附件，校園公告',
  ])('adds no Agent read to %s', question => {
    expect(tronClassCompoundClauses(question)).toEqual([]);
  });

  it('never turns a continuation clause into a TronClass write or schedule', () => {
    expect(tronClassCompoundClauses('查玩課雲作業，安排明天作業時段')).toEqual(['查玩課雲作業']);
    expect(tronClassCompoundClauses('查玩課雲作業，不要上傳附件')).toEqual(['查玩課雲作業']);
    const fineCompounds = tronClassCompoundClauses("it's fine，查玩課雲作業，和校園公告");
    expect(fineCompounds).toEqual(fineCompounds.length === 0 ? [] : ['查玩課雲作業']);
    expect(tronClassCompoundClauses('查玩課雲作業繳交狀態，和校園公告')).toEqual(['查玩課雲作業繳交狀態']);
    expect(tronClassCompoundClauses('查玩課雲未交作業，不要繳交附件！校園公告')).toEqual(['查玩課雲未交作業']);
    expect(tronClassCompoundClauses('查玩課雲作業繳交狀態，校園公告')).toEqual(['查玩課雲作業繳交狀態']);
    expect(tronClassCompoundClauses('查玩課雲是否已繳交的作業，校園公告')).toEqual(['查玩課雲是否已繳交的作業']);
    expect(tronClassCompoundClauses('查玩課雲作業的繳交紀錄和校園公告')).toEqual(['查玩課雲作業的繳交紀錄']);
  });
});

describe('write occurrences in TronClass requests', () => {
  const submissionCues = ['也', '順便', '再', '並', '另外', '同時'];
  const submissionCommands = [
    ...['繳', '交'].flatMap(verb => [
      '作業', '報告', '附件', '檔案', '作品', '心得', '講義', '考卷', '表單',
      '玩課雲作業', ' TronClass 作業', '出去', '上去', '給老師', '這份報告',
    ].map(object => verb + object)),
    ...[
      '補交', '補繳', '遲交', '重交', '重新繳交', '重新上傳', '上繳', '遞交',
      '呈交', '交付', '繳回', '交回', '回傳', '附上', '夾帶', '送件', '寄出',
    ].flatMap(verb => ['附件', '檔案'].map(object => verb + object)),
    ...['hand in', 'turn in', 'resubmit'].flatMap(verb =>
      ['the assignment', 'the attachment'].map(object => `${verb} ${object}`)),
  ];

  it.each(submissionCommands)('blocks the standalone submission %s', command => {
    expect(parseTronClassAgentIntent(`玩課雲幫我${command}`)).toEqual({ intent: 'unsupported', pendingOnly: false });
  });

  it.each(submissionCues.flatMap(cue => submissionCommands.map(command => [cue, command] as const)))(
    'blocks a private read before %s %s even after a negated submission',
    (cue, command) => {
      expect(parseTronClassAgentIntent(`查玩課雲作業${cue}${command}`)?.intent ?? 'planner')
        .toBe(['順便', '另外', '同時'].includes(cue) ? 'planner' : 'unsupported');
      expect(tronClassCompoundClauses(`查玩課雲作業${cue}${command}`)).toEqual([]);
      expect(tronClassCompoundClauses(`查玩課雲作業，${cue}${command}`)).toEqual([]);
      expect(tronClassCompoundClauses(`查玩課雲作業，不要補交舊版${cue}${command}`)).toEqual([]);
      expect(parseTronClassAgentIntent(`查玩課雲作業不要補交舊版${command}`))
        .toEqual({ intent: 'unsupported', pendingOnly: false });
    },
  );

  it.each(['幫我繳玩課雲作業', 'TronClass 附件請補交'])('blocks %s', question => {
    expect(parseTronClassAgentIntent(question)).toEqual({ intent: 'unsupported', pendingOnly: false });
  });

  it.each(['查玩課雲作業，順便繳作業', '查玩課雲作業，補交附件'])(
    'suppresses the compound read for %s',
    question => expect(tronClassCompoundClauses(question)).toEqual([]),
  );

  it.each([
    '查玩課雲尚未提交的作業', '查玩課雲未交作業', '查玩課雲還沒交的作業',
    '查玩課雲沒交作業', '查玩課雲尚未繳交的作業', '查玩課雲待繳作業', '查玩課雲有哪些待繳',
  ])('keeps the pending homework filter in %s', question => {
    expect(parseTronClassAgentIntent(question)).toEqual({ intent: 'homework', pendingOnly: true });
    expect(tronClassCompoundClauses(`${question}和校園公告`)).toEqual([question]);
  });

  it.each([
    '玩課雲作業交了嗎', '查玩課雲交作業期限', '玩課雲交作業截止日',
    '查玩課雲作業繳交期限', '玩課雲作業上傳截止日是哪天',
    '查玩課雲繳交截止日期', '查玩課雲上傳期限', '玩課雲繳交截止時間',
    '查玩課雲作業上傳 deadline', '查玩課雲作業已交的',
    '不要補交附件只要查玩課雲作業狀態', '不要繳作業只查玩課雲作業狀態',
  ])('keeps the homework read %s', question => {
    expect(parseTronClassAgentIntent(question)).toEqual({ intent: 'homework', pendingOnly: false });
  });

  it.each([
    'TronClass homework turnaround time', 'TronClass homework hand index',
  ])('keeps or confirms the homework phrasing %s when leftover English is unknown', question => {
    expectAuthorizedOrAmbiguous(question, { intent: 'homework', pendingOnly: false });
  });

  it.each(
    ['交', '繳', '上傳'].flatMap(verb =>
      ['', '掉', '出去', '上去', '了', '一下', '給老師', '完'].flatMap(complement =>
        ['附件', '這份報告', '修訂稿'].map(object => `把${object}${verb}${complement}`),
      ),
    ),
  )('blocks %s in direct and compound requests', command => {
    expect(parseTronClassAgentIntent(`玩課雲請幫我${command}`))
      .toEqual({ intent: 'unsupported', pendingOnly: false });
    expect(parseTronClassAgentIntent(`查玩課雲作業再${command}`))
      .toEqual({ intent: 'unsupported', pendingOnly: false });
    expect(tronClassCompoundClauses(`查玩課雲作業，請幫我${command}`)).toEqual([]);
    expect(tronClassCompoundClauses(`查玩課雲作業順便${command}，查校園公告`)).toEqual([]);
  });

  it.each([
    '交', '繳了', '交一下', '交完', '繳修訂稿', '交出去', '交交通資訊',
    '把附件交了嗎', '把附件繳交狀態', '把附件上傳截止日',
  ])('blocks the ungoverned submission %s', command => {
    expect(parseTronClassAgentIntent(`玩課雲作業${command}`))
      .toEqual({ intent: 'unsupported', pendingOnly: false });
    expect(tronClassCompoundClauses(`查玩課雲作業，${command}`)).toEqual([]);
  });

  it.each([
    '查玩課雲作業繳交期限', '玩課雲作業上傳截止日是哪天', '查玩課雲交作業期限',
  ])('preserves the deadline read %s and checks added commands independently', question => {
    expect(tronClassCompoundClauses(`${question}，校園公告`)).toEqual([question]);
    expect(parseTronClassAgentIntent(`${question}前幫我上傳`))
      .toEqual({ intent: 'unsupported', pendingOnly: false });
    expect(tronClassCompoundClauses(`${question}，校園公告，幫我把附件交掉`)).toEqual([]);
  });

  it.each([
    '查玩課雲作業，也上傳狀態，以及校園公告',
    '查玩課雲作業，也上傳狀態和附件，以及校園公告',
    '查玩課雲作業，也上傳狀態：截圖，以及校園公告',
    '查玩課雲作業，也上傳狀態截圖，以及校園公告',
    '查玩課雲作業，繳交狀態表給老師',
    '查玩課雲作業繳交狀態後記得上傳狀態報告，查校園公告',
    '查玩課雲作業後立即上傳狀態報告，以及校園公告',
    '查玩課雲作業，不要繳交舊版接下來上傳新版',
  ])('suppresses private compound reads for %s', question => {
    expect(parseTronClassAgentIntent(question)).toBeNull();
    expect(tronClassCompoundClauses(question)).toEqual([]);
  });

  it('keeps an unpunctuated additive write in the planner', () => {
    const question = '查玩課雲作業也上傳狀態';
    expect(parseTronClassAgentIntent(question)).toBeNull();
    expect(canAnswerTronClassQuestion(question)).toBe(false);
  });

  it.each([
    '查玩課雲作業上傳狀態：截圖',
    '玩課雲可以做什麼：立即上傳狀態',
    '查玩課雲作業上載狀態文件',
    '查玩課雲作業不要繳交舊版上傳新版',
  ])('routes %s as unsupported', question => {
    expect(parseTronClassAgentIntent(question)).toEqual({ intent: 'unsupported', pendingOnly: false });
  });

  it.each([
    'TronClass 作業狀態後把附件上傳',
    '查玩課雲作業顯示完成後上傳狀態',
    '準備玩課雲作業後把附件上傳',
    '查玩課雲作業後上傳狀態',
  ])('sends a write after 後 to the planner in %s', question => {
    expect(parseTronClassAgentIntent(question)).toBeNull();
    expect(canAnswerTronClassQuestion(question)).toBe(false);
    expect(tronClassCompoundClauses(question)).toEqual([]);
  });

  const cues = ['記得', '立即', '馬上', '再', '然後', '接著', '接下來', '之後', '後', '請', '幫我'];
  const verbs = ['繳交', '提交', '送出', '交出', '上傳', '上載', 'submit ', 'upload '];
  const objects = ['報告', '檔', '文件', '版', '附件', '作業內容'];

  const additiveCues = ['也', '還', '並', '並且', '順便', '同時', '再', '另外', '以及', '和', '跟'];
  const statusNouns = ['狀態', '紀錄', '情況', '進度'];
  const endings = [
    '', '？', '?', '。', '！', '!', '嗎', '呢', '如何', '怎樣', '怎麼樣', '了沒', '有沒有',
    '和附件', '與附件', '及附件', '：截圖', '，截圖', '；截圖',
  ];

  it.each(additiveCues.flatMap(cue => verbs.flatMap(verb => statusNouns.flatMap(noun =>
    endings.map(ending => `下載玩課雲講義，查作業${cue}${verb}${noun}${ending}`),
  ))))('keeps the additive write in the planner in %s', question => {
    expect(tronClassCompoundClauses(question)).toEqual([]);
  });

  it.each([
    '查作業繳交狀態',
    '查玩課雲作業繳交狀態？',
    '作業交了沒',
    '查作業交了沒',
    '作業交過了嗎',
    '我的作業上傳狀態如何',
    '查作業提交進度怎麼樣',
    '不要繳交只要查玩課雲作業狀態',
  ])('keeps the governed status read %s', question => {
    const scoped = question.includes('玩課雲') ? question : `玩課雲${question}`;
    expect(parseTronClassAgentIntent(scoped)).toEqual({ intent: 'homework', pendingOnly: false });
  });

  it('keeps or confirms a status read when a course name is unknown', () => {
    expectAuthorizedOrAmbiguous('查這週資料庫課程的作業上傳進度', { intent: 'homework', pendingOnly: false });
  });

  it.each(['和附件', '與附件', '及附件', '：截圖', '，截圖', '；截圖'])(
    'does not end a governed status query before %s',
    ending => expect(tronClassCompoundClauses(`下載玩課雲講義，查作業上傳狀態${ending}`)).toEqual([]),
  );

  it.each(cues.flatMap(cue => verbs.flatMap(verb => objects.map(object =>
    `查玩課雲作業繳交狀態${cue}${verb}狀態${object}，查校園公告`,
  ))))('suppresses compound reads for a command with a status-like object in %s', question => {
    expect(tronClassCompoundClauses(question)).toEqual([]);
  });

  it.each(verbs.flatMap(verb => objects.map(object =>
    `查玩課雲作業${verb}狀態${object}，查校園公告`,
  )))('recognizes the object without a command cue in %s', question => {
    expect(tronClassCompoundClauses(question)).toEqual([]);
  });

  it.each(['狀態', '紀錄', '情況', '進度'].flatMap(noun =>
    ['截圖', '表', '報告', '清單', '摘要', '給老師', '到學系', '至系辦', '一下給老師', '查詢表'].map(tail =>
      `查玩課雲作業繳交${noun}${tail}`,
    ),
  ))('treats trailing text outside the status allowlist as a write in %s', question => {
    expectWriteOrAmbiguous(question);
    expect(tronClassCompoundClauses(`${question}，校園公告`)).toEqual([]);
  });

  it.each(['和解書', '與會名單'])('does not treat the start of %s as a conjunction', tail => {
    expect(tronClassCompoundClauses(`查玩課雲作業繳交狀態${tail}，校園公告`)).toEqual([]);
  });

  it.each(['', '嗎？', '呢', '了沒', '如何', '怎樣', '是什麼', '有沒有', '查詢', '一下', '給我看'].map(tail =>
    `玩課雲顯示一下我的作業繳交進度${tail}`,
  ))('allows the complete status query %s', question => {
    expect(parseTronClassAgentIntent(question)).toEqual({ intent: 'homework', pendingOnly: false });
    expect(tronClassCompoundClauses(`${question}，校園公告`)).toEqual([question.replace(/？$/, '')]);
  });

  it.each([
    '玩課雲作業上傳情況',
    '玩課雲作業查一下繳交進度',
    '玩課雲看我的作業提交紀錄',
    '玩課雲列出作業上載狀態',
    '玩課雲確認作業繳交進度',
  ])('keeps the status query %s eligible for homework reads', question => {
    expect(tronClassCompoundClauses(`${question}，校園公告`)).toEqual([question]);
  });

  it.each([
    '不要繳交只要查玩課雲作業狀態',
    '不要繳交舊版只查玩課雲作業狀態',
    '不要繳交附件改查玩課雲作業狀態',
    '不要上傳截圖改成顯示玩課雲作業狀態',
    '不要上傳截圖而是列出玩課雲作業',
  ])('preserves an adjacent read after a negated write in %s', question => {
    expect(parseTronClassAgentIntent(question)).toEqual({ intent: 'homework', pendingOnly: false });
    expect(parseTronClassAgentIntent(`${question}上傳新版`)).toEqual({ intent: 'unsupported', pendingOnly: false });
  });

  it.each(['不要', '別', '勿', '不用'].flatMap(negation =>
    ['', '接下來', '後立即', '，'].flatMap(separator => verbs.map(verb =>
      `查玩課雲作業，${negation}繳交舊版${separator}${verb}新版`,
    )),
  ))('limits negation to its own action in %s', question => {
    expect(tronClassCompoundClauses(question)).toEqual([]);
  });

  it.each(['查玩課雲作業繳交狀態', '玩課雲我的作業交了沒', '查玩課雲上傳紀錄', '查玩課雲作業不要上傳附件'])(
    'preserves the read-only request %s',
    question => {
      expect(parseTronClassAgentIntent(question)?.intent).toBe(question.includes('作業') ? 'homework' : 'capabilities');
    },
  );

  it('distinguishes negated writes, status reads and translations', () => {
    expect(tronClassCompoundClauses('不要繳交，只要查玩課雲作業狀態')).toEqual(['只要查玩課雲作業狀態']);
    expect(tronClassCompoundClauses('玩課雲我的作業交了沒，查校園公告')).toEqual(['玩課雲我的作業交了沒']);
    expect(parseTronClassAgentIntent('玩課雲 翻譯 submit 這個字')).toBeNull();
    expect(tronClassCompoundClauses('翻譯 submit 這個字，查玩課雲作業')).toEqual([]);
    expect(parseTronClassAgentIntent('玩課雲不要上傳附件')?.intent).toBe('capabilities');
  });

  it.each([
    '玩課雲請把附件回傳到作業區',
    '玩課雲請幫我把附件傳給老師',
    '玩課雲請將截圖轉給助教',
    '玩課雲把檔案送到作業區',
    '玩課雲把附件回傳',
    '玩課雲請回傳附件到作業區',
    '玩課雲請傳給老師這份附件',
    '玩課雲把作業寄到學系',
    '玩課雲把附件放到作業區',
  ])('blocks object-fronted transfer in %s', question => {
    expectWriteOrAmbiguous(question);
  });

  it.each([
    '查玩課雲作業，請把附件回傳到作業區',
    '查玩課雲作業，請幫我把附件傳給老師',
    '查玩課雲作業，請將截圖轉給助教',
    '查玩課雲作業，把檔案送到作業區',
    '查玩課雲作業，把附件回傳',
    '查玩課雲作業，請回傳附件到作業區',
  ])('suppresses a compound read for the transfer in %s', question => {
    expect(parseTronClassAgentIntent(question)).toBeNull();
    expect(tronClassCompoundClauses(question)).toEqual([]);
  });

  it.each([
    '不要繳交玩課雲作業只查校園公告',
    '別繳交玩課雲作業只查校園公告',
    '不要提交玩課雲作業改查校園公告',
    '不要上傳玩課雲附件而是查校園公告',
    '不用繳交玩課雲作業只查校園公告',
  ])('does not authorize a private read when the only TronClass cue is inside a negated write in %s', question => {
    expect(parseTronClassAgentIntent(question)).toBeNull();
    expect(canAnswerTronClassQuestion(question)).toBe(false);
    expect(tronClassCompoundClauses(question)).toEqual([]);
  });

  it.each([
    '不要繳交只要查玩課雲作業狀態',
    '不要繳交玩課雲作業只查玩課雲作業狀態',
    '不要上傳截圖只要查玩課雲作業狀態',
  ])('keeps the TronClass status read when a source cue remains after negation in %s', question => {
    expect(parseTronClassAgentIntent(question)).toEqual({ intent: 'homework', pendingOnly: false });
  });

  it.each([
    '玩課雲請把附件放入作業區',
    '玩課雲請把附件：放到作業區',
    '玩課雲請將附件：貼上作業區',
    '玩課雲把檔案塞進作業區',
    '玩課雲把報告投入作業區',
  ])('blocks placement of a submission object in %s', question => {
    expect(parseTronClassAgentIntent(question)).toEqual({ intent: 'unsupported', pendingOnly: false });
  });

  it.each([
    '查玩課雲作業，請把附件放入作業區',
    '查玩課雲作業，請把附件：放到作業區',
    '查玩課雲作業，請將附件：貼上作業區',
  ])('suppresses a compound read for placement in %s', question => {
    expect(parseTronClassAgentIntent(question)).toBeNull();
    expect(tronClassCompoundClauses(question)).toEqual([]);
  });

  it.each([
    '不要把玩課雲作業貼上，只要校園公告',
    '不要繳交玩課雲作業，查作業狀態',
    '不要繳交這份和玩課雲作業附件，只查校園公告',
    '不要將玩課雲附件放入，只要校園公告',
    '不要提交這份與玩課雲作業，改查校園公告',
  ])('does not inherit a TronClass source from a negated write in %s', question => {
    expect(parseTronClassAgentIntent(question)).toBeNull();
    expect(canAnswerTronClassQuestion(question)).toBe(false);
    expect(tronClassCompoundClauses(question)).toEqual([]);
  });

  it('does not turn a negated object into a homework read beside another TronClass clause', () => {
    expect(tronClassCompoundClauses('查玩課雲公告，不要繳交這份和作業附件')).toEqual(['查玩課雲公告']);
    expect(tronClassCompoundClauses('不要繳交這份和玩課雲作業附件，只查校園公告，查創課教材')).toEqual(['查創課教材']);
  });

  it.each([
    '請解釋「玩課雲作業」',
    '備註：「查玩課雲作業」',
    '這句「玩課雲作業」是什麼意思',
  ])('does not authorize a private read from a quoted or explained mention in %s', question => {
    expect(parseTronClassAgentIntent(question)).toBeNull();
    expect(canAnswerTronClassQuestion(question)).toBe(false);
  });

  it.each([
    '查玩課雲跨文化交流課程',
    '查玩課雲交流區公告',
    '查玩課雲交通資訊作業說明',
    '查玩課雲交響樂課程',
    '查玩課雲交換生課程',
    '查玩課雲外交課程',
  ])('keeps the course or notice read in %s', question => {
    const parsed = parseTronClassAgentIntent(question);
    const classified = classifyTronClassSentence(question);
    if (parsed == null) {
      expect(classified?.outcome === 'ambiguous' || classified == null).toBe(true);
      expect(canAnswerTronClassQuestion(question)).toBe(false);
      return;
    }
    expect(parsed.intent).not.toBe('unsupported');
    expect(parsed.intent).toBeTruthy();
  });

  it.each([
    '不要繳交調查報告和玩課雲作業附件，只查校園公告',
    '不要繳交我剛查看的玩課雲作業，只查校園公告',
    '不要繳交我剛查看的玩課雲作業',
  ])('does not treat a query character inside a negated object as a new read in %s', question => {
    expect(parseTronClassAgentIntent(question)).toBeNull();
    expect(canAnswerTronClassQuestion(question)).toBe(false);
    expect(tronClassCompoundClauses(question)).toEqual([]);
  });

  it('keeps a legitimate later TronClass read after a negated object that contains 查 or 看', () => {
    expect(tronClassCompoundClauses('不要繳交調查報告和玩課雲作業附件，只查校園公告，查創課教材')).toEqual(['查創課教材']);
  });

  it.each([
    '原文是 ‘查玩課雲作業’',
    '`查玩課雲作業`',
    '備註：「查玩課雲作業」',
    '請解釋「玩課雲作業」',
  ])('does not authorize a private read from a quoted mention in %s', question => {
    expect(parseTronClassAgentIntent(question)).toBeNull();
    expect(canAnswerTronClassQuestion(question)).toBe(false);
  });

  it.each([
    '不要繳交審查過的玩課雲作業，只查校園公告',
    '不要繳交這份和交換報告以及玩課雲作業附件，只查校園公告',
  ])('does not treat 查 or 交 inside a word as a clause or write boundary in %s', question => {
    expect(parseTronClassAgentIntent(question)).toBeNull();
    expect(canAnswerTronClassQuestion(question)).toBe(false);
    expect(tronClassCompoundClauses(question)).toEqual([]);
  });

  it('keeps a later TronClass read after a negated object that contains 審查 or 交換', () => {
    expect(tronClassCompoundClauses('不要繳交審查過的玩課雲作業，只查校園公告，查創課教材')).toEqual(['查創課教材']);
    expect(tronClassCompoundClauses('不要繳交這份和交換報告以及玩課雲作業附件，只查校園公告，查創課教材')).toEqual(['查創課教材']);
  });

  it.each([
    '查玩課雲標題含「作業」的公告',
    '查玩課雲標題含『作業』的公告',
    '查玩課雲標題含“作業”的公告',
    '查玩課雲標題含`作業`的公告',
    '查玩課雲關於作業的公告',
    '查玩課雲公告「作業繳交提醒」',
  ])('classifies a notice by its head word even when homework is mentioned in %s', question => {
    expect(parseTronClassAgentIntent(question)).toEqual({ intent: 'announcements', pendingOnly: false });
  });

  it('does not treat 查 inside 檢查 as a new read after a negated write', () => {
    expect(parseTronClassAgentIntent('不要繳交檢查玩課雲作業用的附件，只查校園公告')).toBeNull();
    expect(tronClassCompoundClauses('不要繳交檢查玩課雲作業用的附件，只查校園公告，查創課教材')).toEqual(['查創課教材']);
  });
});

describe('r28 structural regressions and function-word variants', () => {
  it.each([
    '請勿讀玩課雲作業',
    '不要讀玩課雲作業',
    '別讀玩課雲作業',
    '不要看玩課雲作業',
    '不要顯示玩課雲作業',
    '不要確認玩課雲作業',
  ])('does not authorize a negated read in %s', question => {
    expect(parseTronClassAgentIntent(question)).toBeNull();
    expect(canAnswerTronClassQuestion(question)).toBe(false);
  });

  it.each([
    '查玩課雲作業準備區公告',
    '查玩課雲關於作業的公告',
    '查玩課雲公告「作業，繳交提醒」',
    '查玩課雲公告「作業繳交提醒」',
  ])('classifies %s as a notice after resolving the data type', question => {
    expect(parseTronClassAgentIntent(question)).toEqual({ intent: 'announcements', pendingOnly: false });
  });

  it('keeps a later notice or material read after a relative query inside a negated write', () => {
    expect(parseTronClassAgentIntent('不要繳交我剛查看過的玩課雲作業，只查校園公告')).toBeNull();
    expect(tronClassCompoundClauses('不要繳交我剛查看過的玩課雲作業，只查校園公告')).toEqual([]);
    expect(tronClassCompoundClauses('不要繳交我剛查看過的玩課雲作業，只查校園公告，查創課教材')).toEqual(['查創課教材']);
  });

  it.each([
    '查玩課雲作業，最後交附件',
    '查玩課雲作業，後交附件',
    '查玩課雲作業，再交附件',
  ])('keeps a write after a function word with the planner in %s', question => {
    expect(parseTronClassAgentIntent(question)).toBeNull();
    expect(tronClassCompoundClauses(question)).toEqual([]);
  });

  it.each([
    '查玩課雲作業最後交附件',
    '查玩課雲作業再交附件',
  ])('blocks the unpunctuated write after a function word in %s', question => {
    expect(parseTronClassAgentIntent(question)).toEqual({ intent: 'unsupported', pendingOnly: false });
  });

  it('sends a later write after 後 to the planner as its own clause', () => {
    expect(parseTronClassAgentIntent('查玩課雲作業後交附件')).toBeNull();
    expect(tronClassCompoundClauses('查玩課雲作業後交附件')).toEqual([]);
  });

  it('keeps the course read when 交 is inside a course name', () => {
    expect(parseTronClassAgentIntent('查玩課雲外交課程')?.intent).toBe('courses');
  });

  it('still prepares a homework draft when the last data type is homework', () => {
    expectAuthorizedOrAmbiguous('幫我準備 TronClass 資料庫作業', { intent: 'prepare', pendingOnly: false });
  });

  const functionPrefixes = ['剛', '剛才', '已經', '已', '最後', '後', '所'];
  const functionSuffixes = ['過', '了', '的'];
  const queryVerbs = ['查', '看', '讀'];
  const negations = ['不要', '請勿', '別'];

  it.each(
    negations.flatMap(negation => queryVerbs.flatMap(verb => [
      `${negation}${verb}玩課雲作業`,
      ...functionPrefixes.map(prefix => `${negation}${prefix}${verb}玩課雲作業`),
      ...functionSuffixes.map(suffix => `${negation}${verb}${suffix}玩課雲作業`),
    ])),
  )('fuzz: a negated query with a function word does not authorize %s', question => {
    expect(parseTronClassAgentIntent(question)).toBeNull();
    expect(canAnswerTronClassQuestion(question)).toBe(false);
  });

  it.each(
    ['最後', '後', '再', '也', '並', '已'].flatMap(prefix =>
      ['交', '繳'].map(verb => `查玩課雲作業，${prefix}${verb}附件`)),
  )('fuzz: a write after a function word stays with the planner in %s', question => {
    expect(parseTronClassAgentIntent(question)).toBeNull();
    expect(tronClassCompoundClauses(question)).toEqual([]);
  });

  it.each(
    ['剛查看過的', '剛查看的', '已查看過的', '所查看的', '剛才看過的', '正在查看中的'].map(
      relative => `不要繳交我${relative}玩課雲作業，只查校園公告`,
    ),
  )('fuzz: a relative query inside a negated object does not start a read in %s', question => {
    expect(parseTronClassAgentIntent(question)).toBeNull();
    expect(tronClassCompoundClauses(question)).toEqual([]);
  });

  it.each([
    '請勿調閱玩課雲作業',
    '不要繳交供確認玩課雲作業用的資料，只查校園公告',
  ])('does not authorize a negated or attributive read in %s', question => {
    expect(parseTronClassAgentIntent(question)).toBeNull();
    expect(tronClassCompoundClauses(question)).toEqual([]);
  });

  it.each([
    '查玩課雲作業，務必交 PDF',
    '查玩課雲作業，快交最新版',
  ])('does not let a later write inherit a previous clause query in %s', question => {
    expect(parseTronClassAgentIntent(question)).toBeNull();
    expect(tronClassCompoundClauses(question)).toEqual([]);
  });

  it('keeps a homework read when 交 is inside a course name', () => {
    expect(parseTronClassAgentIntent('查玩課雲外交作業')).toEqual({ intent: 'homework', pendingOnly: false });
  });

  it('classifies a notice that mentions a download area by the last data type', () => {
    expectAuthorizedOrAmbiguous('查玩課雲資料庫課程下載區公告', { intent: 'announcements', pendingOnly: false });
  });

  it('tokenizes a long write-heavy string without exponential work', () => {
    const question = `查玩課雲${'必交必繳'.repeat(80)}作業`;
    const started = Date.now();
    parseTronClassAgentIntent(question);
    expect(Date.now() - started).toBeLessThan(200);
  });

  it.each([
    '查玩課雲作業以及記得交最新版',
    '查玩課雲作業後記得交 PDF',
  ])('does not let a later write inherit a query across 以及 or 後 in %s', question => {
    expect(parseTronClassAgentIntent(question)).toBeNull();
    expect(tronClassCompoundClauses(question)).toEqual([]);
  });

  it('keeps negation around a 供…用的 modifier span that contains a query verb', () => {
    const question = '不要繳交供老師確認玩課雲作業用的資料，只查校園公告';
    expect(parseTronClassAgentIntent(question)).toBeNull();
    expect(tronClassCompoundClauses(question)).toEqual([]);
  });

  it('reads a notice field noun instead of treating 發布 as a write', () => {
    expect(parseTronClassAgentIntent('查玩課雲公告發布時間')).toEqual({ intent: 'announcements', pendingOnly: false });
  });

  it('classifies by the last data type before 準備 or 下載', () => {
    expect(parseTronClassAgentIntent('查玩課雲作業準備區教材下載公告')).toEqual({
      intent: 'announcements', pendingOnly: false,
    });
  });

  it('still blocks a genuine prepare-and-download request', () => {
    expect(parseTronClassAgentIntent('幫我準備玩課雲作業並下載教材')).toEqual({
      intent: 'unsupported', pendingOnly: false, unsupportedReason: 'multiple_actions',
    });
  });

  it('keeps 最後 and 之後 from becoming clause cuts', () => {
    expect(parseTronClassAgentIntent('查玩課雲最後作業')).toEqual({ intent: 'homework', pendingOnly: false });
    expect(parseTronClassAgentIntent('查玩課雲之後的作業')).toEqual({ intent: 'homework', pendingOnly: false });
    expect(parseTronClassAgentIntent('查玩課雲作業後面的附件')).toEqual({ intent: 'materials', pendingOnly: false });
  });

  it('tokenizes a long mixed write string in linear time with a cached pass', () => {
    // Stay within the 1,000-character router limit so this actually exercises tokenize.
    const question = `查玩課雲${'必交必繳發布時間務必轉交'.repeat(80)}作業`;
    expect(question.length).toBeLessThanOrEqual(1000);
    const started = Date.now();
    parseTronClassAgentIntent(question);
    parseTronClassAgentIntent(question);
    expect(Date.now() - started).toBeLessThan(200);
  });

  it.each([
    '查玩課雲作業，記得轉交 PDF',
    '查玩課雲作業及記得交 PDF',
  ])('treats a write compound or 及-clause write as a write in %s', question => {
    expect(parseTronClassAgentIntent(question)).toBeNull();
    expect(tronClassCompoundClauses(question)).toEqual([]);
  });

  it('keeps negation around a 供…用的 span that contains 和', () => {
    const question = '不要繳交供老師和助教確認玩課雲作業用的資料，只查校園公告';
    expect(parseTronClassAgentIntent(question)).toBeNull();
    expect(tronClassCompoundClauses(question)).toEqual([]);
  });

  it('classifies a preparation-area or download-area read by the last data type', () => {
    expect(parseTronClassAgentIntent('查玩課雲作業準備區下載說明教材')).toEqual({
      intent: 'materials', pendingOnly: false,
    });
    expect(parseTronClassAgentIntent('查玩課雲課程下載區教材')).toEqual({
      intent: 'materials', pendingOnly: false,
    });
  });

  it.each([
    '查玩課雲作業記得交 PDF',
    '查玩課雲作業立即交附件',
    '查玩課雲作業接下來交最新版',
  ])('treats an unpunctuated write after a write cue as a write in %s', question => {
    expectWriteOrAmbiguous(question);
  });

  it('keeps negation around every 供…用的 span, not only the last opening', () => {
    const question = '不要繳交供老師確認玩課雲作業以及供助教確認教材用的資料，只查校園公告';
    expect(parseTronClassAgentIntent(question)).toBeNull();
    expect(tronClassCompoundClauses(question)).toEqual([]);
  });

  it('scans a long negated modifier span in linear time', () => {
    const question = `不要繳交供${'確認'.repeat(450)}玩課雲作業用的資料，只查校園公告`;
    expect(question.length).toBeLessThanOrEqual(1000);
    const started = Date.now();
    expect(parseTronClassAgentIntent(question)).toBeNull();
    expect(tronClassCompoundClauses(question)).toEqual([]);
    expect(Date.now() - started).toBeLessThan(200);
  });

  it.each([
    '查玩課雲作業務必速交 PDF',
    '查玩課雲作業務必先行交 PDF',
  ])('resets query context after an urgency cue so the later write is visible in %s', question => {
    expectWriteOrAmbiguous(question);
  });

  it('does not close 正在…中 at 中文, and keeps the later 中的 span', () => {
    const question = '不要繳交我正在用中文確認玩課雲作業中的筆記，只查校園公告';
    expect(parseTronClassAgentIntent(question)).toBeNull();
    expect(tronClassCompoundClauses(question)).toEqual([]);
  });

  it('scans many overlapping 供 spans and two negated writes in linear time', () => {
    const question = `不要繳交${'供老師確認'.repeat(40)}玩課雲作業用的資料，也不要繳交供助教確認玩課雲教材用的附件，只查校園公告`;
    expect(question.length).toBeLessThanOrEqual(1000);
    const started = Date.now();
    expect(parseTronClassAgentIntent(question)).toBeNull();
    expect(tronClassCompoundClauses(question)).toEqual([]);
    expect(Date.now() - started).toBeLessThan(200);
  });

  it.each([
    '查玩課雲作業務必速交學習單',
    '查玩課雲作業務必先行交學習單',
    '查玩課雲作業務必速交課堂報告',
  ])('does not treat a write plus a known object noun as an in-word noun in %s', question => {
    expectWriteOrAmbiguous(question);
  });

  it.each([
    '查玩課雲作業，務必速交學習單',
    '查玩課雲作業，務必先行交課堂報告',
  ])('hands a later write after a known object noun to the planner without a compound read in %s', question => {
    expect(parseTronClassAgentIntent(question)).toBeNull();
    expect(tronClassCompoundClauses(question)).toEqual([]);
  });

  it('keeps 外交作業 and 外交課程 as lexicon nouns under a query', () => {
    expect(parseTronClassAgentIntent('查玩課雲外交作業')).toEqual({ intent: 'homework', pendingOnly: false });
    expect(parseTronClassAgentIntent('查玩課雲外交課程')?.intent).toBe('courses');
  });

  it('closes only the inner 供…用的 and keeps the outer span for later 確認', () => {
    const question = '不要繳交供老師參考供助教審閱用的範本並確認玩課雲作業用的資料，只查校園公告';
    expect(parseTronClassAgentIntent(question)).toBeNull();
    expect(tronClassCompoundClauses(question)).toEqual([]);
  });

  it('closes only the inner 正在…中 and keeps the outer span for later 確認', () => {
    const question = '不要繳交我正在閱讀助教正在編輯中的筆記並確認玩課雲作業中的摘要，只查校園公告';
    expect(parseTronClassAgentIntent(question)).toBeNull();
    expect(tronClassCompoundClauses(question)).toEqual([]);
  });

  it('scans a long write-command request in a single token pass', () => {
    const question = `查玩課雲${'外交作業'.repeat(180)}務必速交課堂報告`;
    expect(question.length).toBeLessThanOrEqual(1000);
    const started = Date.now();
    expectWriteOrAmbiguous(question);
    expect(Date.now() - started).toBeLessThan(200);
  });

  it.each([
    '查玩課雲作業速交課堂報告',
    '查玩課雲作業速交 PDF',
  ])('does not turn an unlisted write plus an object into a noun under a query in %s', question => {
    expectWriteOrAmbiguous(question);
  });

  it('keeps a 供…用的 span across 並且', () => {
    const question = '不要繳交供老師參考並且確認玩課雲作業用的資料，只查校園公告';
    expect(parseTronClassAgentIntent(question)).toBeNull();
    expect(tronClassCompoundClauses(question)).toEqual([]);
  });

  it.each([
    '不要繳交我正在用滑鼠確認玩課雲作業中 的筆記，只查校園公告',
    '不要繳交供老師確認玩課雲作業用 的資料，只查校園公告',
  ])('closes 用的／中的 even when a space sits before 的 in %s', question => {
    expect(parseTronClassAgentIntent(question)).toBeNull();
    expect(tronClassCompoundClauses(question)).toEqual([]);
  });

  it('scans many status-filtered writes in a single token pass', () => {
    const question = `查玩課雲${'未交的作業，'.repeat(90)}務必速交課堂報告`;
    expect(question.length).toBeLessThanOrEqual(1000);
    const started = Date.now();
    expect(parseTronClassAgentIntent(question)).toBeNull();
    expect(tronClassCompoundClauses(question)).toEqual([]);
    expect(Date.now() - started).toBeLessThan(200);
  });
});

describe('lexicon negators and token-only write checks', () => {
  it.each([...TRONCLASS_NEGATORS])('does not authorize a private read after the lexicon negator %s', negation => {
    const question = /[A-Za-z']/.test(negation) ? `${negation} 查玩課雲作業` : `${negation}查玩課雲作業`;
    expect(parseTronClassAgentIntent(question)).toBeNull();
    expect(canAnswerTronClassQuestion(question)).toBe(false);
    expect(tronClassCompoundClauses(`${question}，只查校園公告`)).toEqual([]);
  });

  it.each([
    '不必查玩課雲作業',
    '無需查玩課雲作業，只查校園公告',
    '不需查玩課雲作業',
    '不得查玩課雲作業',
    '毋須查玩課雲作業',
    '先不查玩課雲作業',
    '暫不查玩課雲作業',
    '沒有查玩課雲作業',
  ])('does not authorize a private read from the speech-act negation in %s', question => {
    expect(parseTronClassAgentIntent(question)).toBeNull();
    expect(canAnswerTronClassQuestion(question)).toBe(false);
    expect(tronClassCompoundClauses(question.includes('只查') ? question : `${question}，只查校園公告`)).toEqual([]);
  });

  it('still treats 未 and 沒 as homework status filters under a query', () => {
    expect(parseTronClassAgentIntent('幫我查 TronClass 未繳作業')).toEqual({ intent: 'homework', pendingOnly: true });
    expect(parseTronClassAgentIntent('查玩課雲沒交的作業')).toEqual({ intent: 'homework', pendingOnly: true });
    expect(parseTronClassAgentIntent('查玩課雲未交的作業')).toEqual({ intent: 'homework', pendingOnly: true });
  });

  it.each([
    '把玩課雲外交作業列出',
    '將玩課雲外交作業列出',
    '請將玩課雲外交作業列出',
  ])('does not treat 交 inside 外交 as a write after 把／將 in %s', question => {
    expect(parseTronClassAgentIntent(question)).toEqual({ intent: 'homework', pendingOnly: false });
  });

  it.each([
    '把玩課雲附件回傳',
    '將玩課雲作業繳交',
    '把附件：放到玩課雲作業區',
  ])('still blocks a 把／將 write in %s', question => {
    expect(parseTronClassAgentIntent(question)).toEqual({ intent: 'unsupported', pendingOnly: false });
    expect(tronClassCompoundClauses(question)).toEqual([]);
  });

  it('scans many 把／將 read clauses in a single token pass', () => {
    const question = `把玩課雲外交作業列出${'並把玩課雲外交作業列出'.repeat(30)}`;
    expect(question.length).toBeLessThanOrEqual(1000);
    const started = Date.now();
    expect(parseTronClassAgentIntent(question)).toEqual({ intent: 'homework', pendingOnly: false });
    expect(Date.now() - started).toBeLessThan(200);
  });

  it.each([
    '不要把玩課雲外交作業列出',
    '無需將玩課雲作業列出',
    '不必把玩課雲作業列出，只查校園公告',
  ])('does not authorize a negated 把／將 query in %s', question => {
    expect(parseTronClassAgentIntent(question)).toBeNull();
    expect(canAnswerTronClassQuestion(question)).toBe(false);
    expect(tronClassCompoundClauses(question.includes('只查') ? question : `${question}，只查校園公告`)).toEqual([]);
  });

  it('scans repeated negated 把／將 phrases in linear time', () => {
    const question = `${'不要把玩課雲外交作業列出，'.repeat(25)}只查校園公告`;
    expect(question.length).toBeLessThanOrEqual(1000);
    const started = Date.now();
    expect(parseTronClassAgentIntent(question)).toBeNull();
    expect(tronClassCompoundClauses(question)).toEqual([]);
    expect(Date.now() - started).toBeLessThan(200);
  });
});

describe('three-way sentence classification', () => {
  function expectCorrectOrAmbiguous(
    question: string,
    expected: { parse: ReturnType<typeof parseTronClassAgentIntent>; compounds: string[] },
  ) {
    const classified = classifyTronClassSentence(question);
    const parsed = parseTronClassAgentIntent(question);
    const compounds = tronClassCompoundClauses(question);
    if (classified?.outcome === 'ambiguous') {
      expect(parsed).toBeNull();
      expect(canAnswerTronClassQuestion(question)).toBe(false);
      // A whole-sentence confirmation may still leave proven-read clauses, but
      // it must never invent a different auto-read than the correct one.
      if (compounds.length > 0) expect(compounds).toEqual(expected.compounds);
      return;
    }
    expect(parsed).toEqual(expected.parse);
    expect(compounds).toEqual(expected.compounds);
  }

  it('auto-reads a clearly pending homework request', () => {
    expect(classifyTronClassSentence('幫我查 TronClass 未繳作業')).toEqual({
      outcome: 'clearly-read',
      intent: { intent: 'homework', pendingOnly: true },
    });
    expect(parseTronClassAgentIntent('幫我查 TronClass 未繳作業')).toEqual({ intent: 'homework', pendingOnly: true });
    expect(parseTronClassAgentIntent('查玩課雲沒交的作業')).toEqual({ intent: 'homework', pendingOnly: true });
  });

  it('keeps a clearly requested write on the existing write path', () => {
    expect(classifyTronClassSentence('幫我繳交 TronClass 未交作業')?.outcome).toBe('clearly-write');
    expect(parseTronClassAgentIntent('幫我繳交 TronClass 未交作業')).toEqual({ intent: 'unsupported', pendingOnly: false });
    expect(parseTronClassAgentIntent('把玩課雲附件回傳')).toEqual({ intent: 'unsupported', pendingOnly: false });
    expect(parseTronClassAgentIntent('查玩課雲作業，貼入附件')).toBeNull();
    expect(tronClassCompoundClauses('查玩課雲作業，貼入附件')).toEqual([]);
    expect(classifyTronClassSentence('查玩課雲作業，貼入附件')?.outcome).not.toBe('clearly-read');
  });

  it.each([
    ['幫我查 TronClass 未繳作業', { parse: { intent: 'homework' as const, pendingOnly: true }, compounds: [] }],
    ['查玩課雲沒交的作業', { parse: { intent: 'homework' as const, pendingOnly: true }, compounds: [] }],
    ['查玩課雲外交作業', { parse: { intent: 'homework' as const, pendingOnly: false }, compounds: [] }],
    ['把玩課雲外交作業列出', { parse: { intent: 'homework' as const, pendingOnly: false }, compounds: [] }],
    ['將玩課雲外交作業列出', { parse: { intent: 'homework' as const, pendingOnly: false }, compounds: [] }],
    ['請將玩課雲外交作業列出', { parse: { intent: 'homework' as const, pendingOnly: false }, compounds: [] }],
    ['不必查玩課雲作業', { parse: null, compounds: [] }],
    ['無需查玩課雲作業，只查校園公告', { parse: null, compounds: [] }],
    ['不要把玩課雲外交作業列出', { parse: null, compounds: [] }],
    ['無需將玩課雲作業列出', { parse: null, compounds: [] }],
    ['不必把玩課雲作業列出，只查校園公告', { parse: null, compounds: [] }],
    ['不要繳交，只要查玩課雲作業狀態', { parse: null, compounds: ['只要查玩課雲作業狀態'] }],
    ['查玩課雲作業，不要上傳附件', { parse: null, compounds: ['查玩課雲作業'] }],
    ['把玩課雲附件回傳', { parse: { intent: 'unsupported' as const, pendingOnly: false }, compounds: [] }],
    ['將玩課雲作業繳交', { parse: { intent: 'unsupported' as const, pendingOnly: false }, compounds: [] }],
    ['查玩課雲作業速交課堂報告', { parse: { intent: 'unsupported' as const, pendingOnly: false }, compounds: [] }],
    ['查玩課雲作業速交 PDF', { parse: { intent: 'unsupported' as const, pendingOnly: false }, compounds: [] }],
    ['不要繳交我正在用滑鼠確認玩課雲作業中 的筆記，只查校園公告', { parse: null, compounds: [] }],
    ['不要繳交供老師確認玩課雲作業用 的資料，只查校園公告', { parse: null, compounds: [] }],
    ['不要繳交供老師參考並且確認玩課雲作業用的資料，只查校園公告', { parse: null, compounds: [] }],
    ['這不重要不要把玩課雲外交作業列出，只查校園公告', { parse: null, compounds: [] }],
    ['不急不要把玩課雲作業列出，只查校園公告', { parse: null, compounds: [] }],
    ['查玩課雲作業，貼入附件', { parse: null, compounds: [] }],
    ['不想查玩課雲作業', { parse: null, compounds: [] }],
    ['不能查玩課雲作業', { parse: null, compounds: [] }],
    ['不再查玩課雲作業', { parse: null, compounds: [] }],
    ['我不打算查玩課雲作業', { parse: null, compounds: [] }],
    ['我不願意查詢玩課雲作業', { parse: null, compounds: [] }],
    ['查玩課雲作業，寄附件給老師', { parse: null, compounds: [] }],
    ['下載 TronClass 不存在.pdf', { parse: { intent: 'download' as const, pendingOnly: false }, compounds: [] }],
    ['下載 TronClass「不存在.pdf」', { parse: { intent: 'download' as const, pendingOnly: false }, compounds: [] }],
  ])('classifies the r30–r40 example %s as correct or ambiguous, never wrong', (question, expected) => {
    expectCorrectOrAmbiguous(question, expected);
    const classified = classifyTronClassSentence(question);
    if (classified?.outcome === 'clearly-read') {
      expect(classified.intent.intent).not.toBe('unsupported');
    }
    if (expected.parse?.intent === 'homework') {
      expect(classified?.outcome === 'ambiguous' || parseTronClassAgentIntent(question)?.intent === 'homework').toBe(true);
    }
  });

  it.each(['不想查玩課雲作業', '不能查玩課雲作業', '不再查玩課雲作業'])(
    'does not auto-read homework from a modal negation in %s',
    question => {
      expect(classifyTronClassSentence(question)?.outcome).not.toBe('clearly-read');
      expect(parseTronClassAgentIntent(question)).toBeNull();
      expect(tronClassCompoundClauses(question)).toEqual([]);
      expect(canAnswerTronClassQuestion(question)).toBe(false);
    },
  );

  it('still auto-reads a download whose file name contains a lone 不', () => {
    expect(classifyTronClassSentence('下載 TronClass 不存在.pdf')).toEqual({
      outcome: 'clearly-read',
      intent: { intent: 'download', pendingOnly: false },
    });
    expect(parseTronClassAgentIntent('下載 TronClass 不存在.pdf')).toEqual({
      intent: 'download', pendingOnly: false,
    });
  });

  it('treats an unresolved prefix negator as confirmation, not an auto-read', () => {
    for (const question of [
      '這不重要不要把玩課雲外交作業列出，只查校園公告',
      '不急不要把玩課雲作業列出，只查校園公告',
    ]) {
      expect(classifyTronClassSentence(question)?.outcome).toBe('ambiguous');
      expect(parseTronClassAgentIntent(question)).toBeNull();
      expect(tronClassCompoundClauses(question)).toEqual([]);
    }
  });

  it('scans a clause of unresolved 把 phrases in linear time', () => {
    const question = `不急${'不要把這份'.repeat(40)}，只查玩課雲公告`;
    expect(question.length).toBeLessThanOrEqual(1000);
    const started = Date.now();
    expect(classifyTronClassSentence(question)?.outcome).toBe('ambiguous');
    expect(parseTronClassAgentIntent(question)).toBeNull();
    expect(tronClassCompoundClauses(question)).toEqual([]);
    expect(Date.now() - started).toBeLessThan(200);
  });

  it('does not auto-read after 不 plus an unknown word or an unknown transfer verb', () => {
    for (const question of [
      '我不打算查玩課雲作業',
      '我不願意查詢玩課雲作業',
      '查玩課雲作業，寄附件給老師',
    ]) {
      expect(classifyTronClassSentence(question)?.outcome).not.toBe('clearly-read');
      expect(parseTronClassAgentIntent(question)).toBeNull();
      expect(tronClassCompoundClauses(question)).toEqual([]);
      expect(canAnswerTronClassQuestion(question)).toBe(false);
    }
  });

  it('keeps a quoted or extension-bearing 不 in a file name as a download read', () => {
    expect(classifyTronClassSentence('下載 TronClass（不存在.pdf）')).toEqual({
      outcome: 'clearly-read',
      intent: { intent: 'download', pendingOnly: false },
    });
  });

  it('moves a clearly-read sentence to ambiguous when an unknown token is inserted, never to a write or auto-read', () => {
    const seeds = [
      '幫我查 TronClass 未繳作業',
      '查玩課雲沒交的作業',
      '查玩課雲外交作業',
      '把玩課雲外交作業列出',
      '下載 TronClass 不存在.pdf',
      '查玩課雲尚未提交的作業',
    ];
    for (const seed of seeds) {
      expect(classifyTronClassSentence(seed)?.outcome).toBe('clearly-read');
    }
    const unknowns = ['鎕', 'xyz', '願', '打', '寄', 'foo', '槑'];
    let seedValue = 0xC0FFEE;
    const next = () => {
      seedValue = (Math.imul(1664525, seedValue) + 1013904223) >>> 0;
      return seedValue;
    };
    for (let trial = 0; trial < 80; trial += 1) {
      const seed = seeds[next() % seeds.length]!;
      const unknown = unknowns[next() % unknowns.length]!;
      const at = next() % (seed.length + 1);
      const question = `${seed.slice(0, at)}${unknown}${seed.slice(at)}`;
      if (question.length > 1000) continue;
      const classified = classifyTronClassSentence(question);
      const parsed = parseTronClassAgentIntent(question);
      const compounds = tronClassCompoundClauses(question);
      expect(classified?.outcome).not.toBe('clearly-write');
      if (classified?.outcome === 'clearly-read') {
        // An unknown letter may be absorbed into a file name or quote; it must
        // keep the original read intent and never become a different auto-read.
        expect(parsed).toEqual(parseTronClassAgentIntent(seed));
        expect(compounds).toEqual([]);
      } else {
        // A broken keyword may fall out of the TronClass classifier entirely.
        expect(classified?.outcome === 'ambiguous' || classified == null).toBe(true);
        expect(parsed).toBeNull();
        expect(canAnswerTronClassQuestion(question)).toBe(false);
        expect(compounds).toEqual([]);
      }
    }
  });
});
