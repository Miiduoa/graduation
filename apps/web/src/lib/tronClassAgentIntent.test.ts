import { describe, expect, it } from 'vitest';
import { canAnswerTronClassQuestion, parseTronClassAgentIntent, tronClassExplicitNavigationQuestion, tronClassCompoundClauses } from './tronClassAgentIntent';

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
    ['幫我準備 TronClass 資料庫作業', 'prepare', false],
    ['TronClass Agent 可以做什麼', 'capabilities', false],
    ['TronClass 作業繳交狀態', 'homework', false],
    ['幫我繳交 TronClass 未交作業', 'unsupported', false],
    ['幫我把 TronClass 未交作業全部繳交', 'unsupported', false],
    ['幫我準備 TronClass 作業並送出', 'unsupported', false],
    ['TronClass 作業狀態後把附件上傳', 'unsupported', false],
    ['TronClass 查作業狀態：上傳附件', 'unsupported', false],
    ['TronClass 是否已繳交的作業', 'homework', false],
    ['TronClass 我的作業繳交紀錄', 'homework', false],
    ['幫我回覆 TronClass 討論', 'unsupported', false],
    ['TronClass 問卷填答', 'unsupported', false],
  ] as const)('routes %s without model-chosen tools', (question, intent, pendingOnly) => {
    expect(parseTronClassAgentIntent(question)).toEqual({ intent, pendingOnly });
    expect(canAnswerTronClassQuestion(question)).toBe(true);
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
    expect(tronClassCompoundClauses("it's fine，查玩課雲作業，和校園公告")).toEqual(['查玩課雲作業']);
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
    'TronClass homework turnaround time', 'TronClass homework hand index',
  ])('keeps the homework read %s', question => {
    expect(parseTronClassAgentIntent(question)).toEqual({ intent: 'homework', pendingOnly: false });
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
    '查玩課雲作業顯示完成後上傳狀態',
    '準備玩課雲作業後把附件上傳',
    '玩課雲可以做什麼：立即上傳狀態',
    '查玩課雲作業上載狀態文件',
    '查玩課雲作業不要繳交舊版上傳新版',
    '查玩課雲作業後上傳狀態',
  ])('routes %s as unsupported', question => {
    expect(parseTronClassAgentIntent(question)).toEqual({ intent: 'unsupported', pendingOnly: false });
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
    '查這週資料庫課程的作業上傳進度',
    '不要繳交只要查玩課雲作業狀態',
  ])('keeps the governed status read %s', question => {
    const scoped = question.includes('玩課雲') ? question : `玩課雲${question}`;
    expect(parseTronClassAgentIntent(scoped)).toEqual({ intent: 'homework', pendingOnly: false });
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
    expect(parseTronClassAgentIntent(question)).toEqual({ intent: 'unsupported', pendingOnly: false });
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
    expect(parseTronClassAgentIntent(question)).toEqual({ intent: 'unsupported', pendingOnly: false });
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
    expect(parsed?.intent).not.toBe('unsupported');
    expect(parsed?.intent).toBeTruthy();
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
    '查玩課雲作業後交附件',
    '查玩課雲作業再交附件',
  ])('blocks the unpunctuated write after a function word in %s', question => {
    expect(parseTronClassAgentIntent(question)).toEqual({ intent: 'unsupported', pendingOnly: false });
  });

  it('keeps the course read when 交 is inside a course name', () => {
    expect(parseTronClassAgentIntent('查玩課雲外交課程')?.intent).toBe('courses');
  });

  it('still prepares a homework draft when the last data type is homework', () => {
    expect(parseTronClassAgentIntent('幫我準備 TronClass 資料庫作業')).toEqual({ intent: 'prepare', pendingOnly: false });
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
    ['剛查看過的', '剛查看的', '已查看過的', '所查看的', '剛才看過的'].map(
      relative => `不要繳交我${relative}玩課雲作業，只查校園公告`,
    ),
  )('fuzz: a relative query inside a negated object does not start a read in %s', question => {
    expect(parseTronClassAgentIntent(question)).toBeNull();
    expect(tronClassCompoundClauses(question)).toEqual([]);
  });
});
