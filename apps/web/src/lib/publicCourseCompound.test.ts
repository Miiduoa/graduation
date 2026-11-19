// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { publicCourseCompoundRequest as compound } from '@campus/shared/src/publicCourseCompound';
import { resolvePublicCourseAssistantIntent as resolve } from '@campus/shared/src/publicCourseAssistant';
import { answerPublicCourseQuestion } from '@campus/shared/src/publicCourseAssistantClient';

describe('public course compound routing', () => {
  it.each(['，另外查公車', '，然後查公車', '，查公車', '；查公車', '和查公車', '與公車'])(
    'retains both independent requests with %s', (suffix) => {
      const question = '查清大資料庫課程' + suffix;
      expect(compound(question, 'pu')).toEqual({ clauses: [
        { question: '查清大資料庫課程', publicCourseIntent: { kind: 'search', schoolId: 'nthu', query: '資料庫' } },
        { question: suffix.endsWith('與公車') ? '公車' : '查公車', publicCourseIntent: null },
      ] });
      expect(resolve(question, 'pu')?.kind).toBe('clarify');
    },
  );

  it('keeps separate campuses and complete filter conditions', () => {
    const result = compound('查清大星期三3學分資料庫課程，另外查暨大2.5學分管理學課程，查我的行程', 'pu');
    expect(result?.clauses.map(clause => clause.publicCourseIntent)).toEqual([
      { kind: 'search', schoolId: 'nthu', query: '資料庫', filters: { weekday: 3, credits: 3 } },
      { kind: 'search', schoolId: 'ncnu', query: '管理學', filters: { credits: 2.5 } },
      null,
    ]);
    expect(result?.clauses[2].question).toBe('查我的行程');
  });

  it.each(['星期三查公車', '星期三比較兩種讀書策略', '3學分查公車'])(
    'does not reinterpret an independent tail as a public course filter: %s', (tail) => {
      const question = '查清大資料庫課程，' + tail;
      expect(compound(question, 'pu')?.clauses).toEqual([
        { question: '查清大資料庫課程', publicCourseIntent: { kind: 'search', schoolId: 'nthu', query: '資料庫' } },
        { question: tail, publicCourseIntent: null },
      ]);
      expect(resolve(question, 'pu')?.kind).toBe('clarify');
    },
  );

  it.each([
    '查清大星期三，3學分資料庫課程，另外查公車',
    '查清大資料庫課程，星期三3學分，另外查公車',
  ])('keeps punctuation within verified course filters: %s', (question) => {
    expect(compound(question, 'pu')?.clauses.map(clause => clause.publicCourseIntent)).toEqual([
      { kind: 'search', schoolId: 'nthu', query: '資料庫', filters: { weekday: 3, credits: 3 } },
      null,
    ]);
  });

  it('retains an unknown clause instead of adding it to the course keyword', () => {
    const result = compound('查清大資料庫課程，另外比較兩種讀書策略', 'pu');
    expect(result?.clauses[0].publicCourseIntent).toMatchObject({ query: '資料庫' });
    expect(result?.clauses[1]).toEqual({ question: '比較兩種讀書策略', publicCourseIntent: null });
  });

  it('keeps unsupported course constraints as an unresolved public step', () => {
    const result = compound('查清大下午不衝堂的3學分課程，另外查公車', 'pu');
    expect(result?.clauses[0].question).toBe('查清大下午不衝堂的3學分課程');
    expect(result?.clauses[0].publicCourseIntent?.kind).toBe('clarify');
    expect(result?.clauses[1].question).toBe('查公車');
  });

  it.each([
    ['查清大資料庫與人工智慧課程', '資料庫與人工智慧'],
    ['查清大「資料庫，然後與人工智慧」課程', '資料庫,然後與人工智慧'],
    ['幫我查資料庫課程，清大的', '資料庫'],
    ['幫我查資料庫課程（清大）', '資料庫'],
  ])('preserves a complete single lookup: %s', (question, query) => {
    expect(compound(question, 'pu')).toBeNull();
    expect(resolve(question, 'pu')).toEqual({ kind: 'search', schoolId: 'nthu', query });
  });

  it('preserves quoted punctuation while separating the next task', () => {
    const result = compound('查清大「資料庫與人工智慧，實作」課程，另外查公車', 'pu');
    expect(result?.clauses).toHaveLength(2);
    expect(result?.clauses[0].publicCourseIntent).toMatchObject({ query: '資料庫與人工智慧,實作' });
    expect(result?.clauses[1].question).toBe('查公車');
  });

  it.each(['資料庫與查詢最佳化', '思考與規劃', '資料和搜尋引擎'])(
    'does not mistake a verb inside the course name for another task: %s', (title) => {
      const result = compound(`查清大${title}課程，另外查公車`, 'pu');
      expect(result?.clauses).toHaveLength(2);
      expect(result?.clauses[0].publicCourseIntent).toEqual({ kind: 'search', schoolId: 'nthu', query: title });
      expect(result?.clauses[1].question).toBe('查公車');
    },
  );

  it('recognizes a clear service command after an implicit course lookup or before another public lookup', () => {
    expect(compound('查清大資料庫和查公車', 'pu')?.clauses.map(clause => clause.question))
      .toEqual(['查清大資料庫', '查公車']);
    expect(compound('查公車和查清大資料庫課程', 'pu')?.clauses.map(clause => clause.question))
      .toEqual(['查公車', '查清大資料庫課程']);
  });

  it('accepts an explicit English second command without splitting a course title at and', () => {
    expect(compound('find NTHU database courses and check buses', 'pu')?.clauses).toEqual([
      { question: 'find NTHU database courses', publicCourseIntent: { kind: 'search', schoolId: 'nthu', query: 'database' } },
      { question: 'check buses', publicCourseIntent: null },
    ]);
    expect(compound('find NTHU Data and Society courses', 'pu')).toBeNull();
    expect(compound('find NTHU Search and Find courses', 'pu')).toBeNull();
  });

  it('keeps private homework distinct from the public Operating Systems course name', () => {
    expect(compound('查明天功課，查餐廳', 'pu')).toBeNull();
    expect(resolve('查明天功課', 'nthu')).toBeNull();
    expect(compound('查清大作業系統課程，另外查明天功課', 'pu')?.clauses.map(clause => clause.publicCourseIntent))
      .toEqual([{ kind: 'search', schoolId: 'nthu', query: '作業系統' }, null]);
  });

  it.each([
    '查清大「資料庫課程，另外查公車',
    '查清大資料庫課程，另外',
    '查清大資料庫課程\n另外查公車',
    '查清大資料庫課程，' + Array.from({ length: 12 }, () => '查公車').join('，'),
    '查公車，另外查餐廳',
  ])('does not invent a partial plan for invalid or unrelated input: %s', (question) => {
    expect(compound(question, 'pu')).toBeNull();
  });

  it('keeps other clients from sending a compound request as one public keyword', async () => {
    const fetcher = vi.fn<typeof fetch>();
    const answer = await answerPublicCourseQuestion({ question: '查清大資料庫課程，另外查公車',
      schoolId: 'pu', origin: 'mobile', fetcher });
    expect(answer?.content).toContain('其他需求尚未執行');
    expect(answer?.read).toBeUndefined();
    expect(fetcher).not.toHaveBeenCalled();
  });
});
