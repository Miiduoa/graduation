import {
  answerWithOnlineSearch,
  buildWebGroundedAnswer,
  shouldUseWebSearch,
  type WebSearchSource,
} from '../../services/webSearch';

describe('web search grounding', () => {
  it('uses web search for current external facts', () => {
    expect(shouldUseWebSearch('美國總統是誰', 'general')).toBe(true);
    expect(shouldUseWebSearch('現在台中天氣如何', 'weather')).toBe(true);
    expect(shouldUseWebSearch('最新 AI 新聞', 'general')).toBe(true);
    expect(shouldUseWebSearch('怎麼去台中車站', 'transport')).toBe(true);
    expect(shouldUseWebSearch('Python 裝飾器是什麼', 'general')).toBe(true);
    expect(shouldUseWebSearch('台中市長是誰', 'general')).toBe(true);
  });

  it('does not send personal campus questions to web search', () => {
    expect(shouldUseWebSearch('今天有什麼課', 'course')).toBe(false);
    expect(shouldUseWebSearch('我有什麼作業', 'course')).toBe(false);
    expect(shouldUseWebSearch('幫我寫請假信', 'general')).toBe(false);
    expect(shouldUseWebSearch('圖書館在哪', 'library')).toBe(false);
  });

  it('builds an answer with visible sources and query time', () => {
    const sources: WebSearchSource[] = [
      {
        title: '美国总统',
        url: 'https://zh.wikipedia.org/wiki/美国总统',
        snippet: '现任（第47任）美国总统是唐納·川普，于2025年1月20日上任。',
        source: 'Wikipedia 中文',
        updatedAt: '2026-04-07T10:08:57Z',
      },
    ];

    const answer = buildWebGroundedAnswer('美國總統是誰', sources, '2026-04-30T00:00:00.000Z');

    expect(answer?.content).toContain('唐納·川普');
    expect(answer?.content).toContain('我用到的依據');
    expect(answer?.content).toContain('資料來源');
    expect(answer?.content).toContain('https://zh.wikipedia.org/wiki/美国总统');
    expect(answer?.content).toContain('查詢時間');
  });

  it('answers PU to Taichung Station route with grounded transit sources', async () => {
    const answer = await answerWithOnlineSearch('怎麼去台中車站');

    expect(answer?.content).toContain('300');
    expect(answer?.content).toContain('臺中市公車即時動態');
    expect(answer?.content).toContain('Google Maps');
    expect(
      answer?.sources.some((source) => source.url.includes('citybus-free.taichung.gov.tw')),
    ).toBe(true);
  });
});
