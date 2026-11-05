import { describe, expect, it } from 'vitest';
import { filterSchools } from './SchoolSelector.search';

const schools = [
  { id: 'pu', name: '靜宜大學', shortName: '靜宜', code: 'PU' },
  { id: 'ntu', name: '國立臺灣大學', shortName: '臺大', code: 'NTU' },
  { id: 'ntust', name: '國立臺灣科技大學', shortName: '臺科大', code: 'NTUST' },
  { id: 'empty', name: '測試學院' },
  { id: 'nccu', name: '國立政治大學', shortName: '政大' },
];

describe('school directory search', () => {
  it.each([
    ['台灣', ['ntu', 'ntust']],
    ['臺大', ['ntu']],
    ['台大', ['ntu']],
    ['ＰＵ', ['pu']],
    ['PU', ['pu']],
    ['p u', ['pu']],
    ['NcCu', ['nccu']],
    ['政大', ['nccu']],
    ['國立政治大學', ['nccu']],
    ['政治', ['nccu']],
    ['靜 宜', ['pu']],
    [' pu ', ['pu']],
    ['靜宜 pu', ['pu']],
    ['臺灣 科技', ['ntust']],
    ['臺灣\u3000科技', ['ntust']],
    ['靜宜 NTU', []],
    ['missing', []],
    ['', ['pu', 'ntu', 'ntust', 'empty', 'nccu']],
    ['\t \u3000', ['pu', 'ntu', 'ntust', 'empty', 'nccu']],
  ])('matches %s without changing school membership', (query, expected) => {
    expect(filterSchools(schools, query).map((school) => school.id)).toEqual(expected);
  });
  it('ranks exact ids and codes before partial matches', () => {
    const directory = [
      { id: 'puli', name: '埔里學院', code: 'PULI' },
      { id: 'pu', name: '靜宜大學', status: 'not-open' },
      { id: 'other', name: '其他學院', code: 'PU' },
    ];
    const original = JSON.stringify(directory);
    expect(filterSchools(directory, ' P U ')).toEqual([directory[1], directory[2], directory[0]]);
    expect(filterSchools(directory, 'PU')[0]).toBe(directory[1]);
    expect(JSON.stringify(directory)).toBe(original);
  });
  it('preserves order within each match group and does not mutate the directory', () => {
    const original = JSON.stringify(schools);
    expect(filterSchools(schools, 'pu')[0]).toBe(schools[0]);
    expect(JSON.stringify(schools)).toBe(original);
  });
});
