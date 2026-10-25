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


it('only shows authenticated-source previews for the exact selected destination', () => {
  expect(normalizeCampusSemanticResult({
    status: 'understood', source: 'model', summary: '查看待辦',
    destinations: ['/classroom'], clarifyingQuestion: null,
    previews: [{ destination: '/classroom', status: 'available', source: 'campus-platform',
      message: '已讀取平台待辦', items: [{ title: '期末報告', detail: '專題' }] }],
  })?.previews?.[0]).toMatchObject({ destination: '/classroom', items: [{ title: '期末報告' }] });
  expect(normalizeCampusSemanticResult({
    status: 'understood', source: 'model', summary: '查看待辦',
    destinations: ['/classroom'], clarifyingQuestion: null,
    previews: [{ destination: '/grades', status: 'available', source: 'campus-platform',
      message: '不可讀', items: [{ title: '私密成績', detail: '' }] }],
  })).toBeNull();
});

it('rejects fake official data or unbounded previews', () => {
  expect(normalizeCampusSemanticResult({
    status: 'understood', source: 'model', summary: '查課表',
    destinations: ['/timetable'], clarifyingQuestion: null,
    previews: [{ destination: '/timetable', status: 'available', source: 'untrusted-official',
      message: '有課', items: [] }],
  })).toBeNull();
});
