import { describe, expect, it } from 'vitest';
import { normalizeCampusSemanticResult } from '@campus/shared/src/campusSemantic';

describe('cross-platform semantic navigation contract', () => {
  it('accepts multiple safe route suggestions', () => {
    expect(normalizeCampusSemanticResult({
      status: 'understood', source: 'model', summary: '先查空堂，再找書和餐廳。',
      destinations: ['/timetable', '/library', '/cafeteria'], clarifyingQuestion: null,
    })).toMatchObject({ status: 'understood', destinations: ['/timetable', '/library', '/cafeteria'] });
  });

  it('never allows model-supplied URLs or write routes to bypass navigation', () => {
    for (const route of ['https://example.com', '/api/submit', '/submit-homework']) {
      expect(normalizeCampusSemanticResult({
        status: 'understood', source: 'model', summary: '完成操作',
        destinations: [route], clarifyingQuestion: null,
      })).toBeNull();
    }
  });

  it('rejects model fallback masquerading as semantic understanding', () => {
    expect(normalizeCampusSemanticResult({
      status: 'understood', source: 'fallback', summary: '我懂了',
      destinations: ['/map'], clarifyingQuestion: null,
    })).toBeNull();
  });
});
