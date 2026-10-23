import { describe, expect, it } from 'vitest';
import { filterSchools } from './SchoolSelector.search';

const schools = [
  { id: 'pu', name: '靜宜大學', shortName: '靜宜', code: 'PU' },
  { id: 'ntu', name: '國立臺灣大學', shortName: '臺大', code: 'NTU' },
  { id: 'ntust', name: '國立臺灣科技大學', shortName: '臺科大', code: 'NTUST' },
  { id: 'empty', name: '測試學院' },
];

describe('school directory search', () => {
  it.each([
    ['台灣', ['ntu', 'ntust']],
    ['臺大', ['ntu']],
    ['台大', ['ntu']],
    ['ＰＵ', ['pu']],
    [' pu ', ['pu']],
    ['靜宜 pu', ['pu']],
    ['臺灣 科技', ['ntust']],
    ['臺灣\u3000科技', ['ntust']],
    ['靜宜 NTU', []],
    ['missing', []],
    ['', ['pu', 'ntu', 'ntust', 'empty']],
    ['\t \u3000', ['pu', 'ntu', 'ntust', 'empty']],
  ])('matches %s without changing school membership', (query, expected) => {
    expect(filterSchools(schools, query).map((school) => school.id)).toEqual(expected);
  });
  it('does not reorder or mutate the directory', () => {
    const original = JSON.stringify(schools);
    expect(filterSchools(schools, 'pu')[0]).toBe(schools[0]);
    expect(JSON.stringify(schools)).toBe(original);
  });
});
