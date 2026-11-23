import { describe, expect, it } from 'vitest';
import { canAnswerTronClassQuestion, parseTronClassAgentIntent, tronClassExplicitNavigationQuestion } from './tronClassAgentIntent';

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
    '開啟玩課雲作業，有哪些還沒交',
    '打開玩課雲看有幾份作業',
    '前往玩課雲查作業截止',
    '進入 TronClass 看成績',
    'open TronClass 看有什麼作業',
    '玩課雲作業',
  ])('keeps %s eligible for Agent routing', question => {
    expect(tronClassExplicitNavigationQuestion(question)).toBeNull();
    expect(canAnswerTronClassQuestion(question)).toBe(true);
  });
});

describe('explicit TronClass command routing', () => {
  it.each([
    ['幫我查 TronClass 未繳作業', 'homework', true],
    ['TronClass 尚未提交的作業有哪些', 'homework', true],
    ['幫我查 TronClass 未交作業，不要繳交', 'homework', true],
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
    ['幫我準備 TronClass 作業然後送出', 'unsupported', false],
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

  it.each(['玩課雲作業，查公車', '開啟玩課雲作業，查公車資訊', '玩課雲，查今天課表', '打開玩課雲然後查社團'])(
    'leaves the compound LMS handoff %s on the existing cross-service plan',
    question => expect(canAnswerTronClassQuestion(question)).toBe(false),
  );

  it.each(['開啟玩課雲作業，查一下還沒交的有哪些', '玩課雲作業，看成績'])(
    'still sends the TronClass-only query %s to the Agent',
    question => expect(canAnswerTronClassQuestion(question)).toBe(true),
  );
});
