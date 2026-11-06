import { expect, it } from 'vitest';
import type { PersonalImportRow } from '@campus/shared';
import {
  nextReviewRow,
  reviewPeriods,
  rowsOutsideReviewGrid,
} from '@campus/shared/src/imports/reviewGrid';

it('合併僅接受選取集合內的目前列與相鄰列', () => {
  const first: PersonalImportRow = {
    id: 'first',
    source: { type: 'file', line: 2, rawText: '數學,一,1,1,A101' },
    kind: 'timetable',
    title: '數學',
    schoolId: 'ntut',
    academicYear: '115',
    semester: '1',
    dayOfWeek: 1,
    startPeriod: 1,
    endPeriod: 1,
    location: 'A101',
  };
  const second = { ...first, id: 'second', startPeriod: 2, endPeriod: 2 };
  const english = {
    ...first,
    id: 'english',
    title: '英文',
    dayOfWeek: 2 as const,
    startPeriod: 3,
    endPeriod: 3,
  };
  expect(nextReviewRow([second, english], first)).toBeUndefined();
  expect(nextReviewRow([first, english], first)).toBeUndefined();
  expect(nextReviewRow([first, second, english], first)).toBe(second);
});

it('週格以外仍保留鐘點課、缺星期和不在該校節次內的課程', () => {
  const row: PersonalImportRow = {
    id: 'clock',
    kind: 'timetable',
    title: '羽球',
    schoolId: 'pu',
    academicYear: '115',
    semester: '1',
    source: { type: 'screenshot', line: 1, rawText: '週三 12:10–12:55 羽球' },
    dayOfWeek: 3,
    startTime: '12:10',
    endTime: '12:55',
    location: '體育館',
  };
  const slot = { ...row, startTime: undefined, endTime: undefined, startPeriod: 1, endPeriod: 2 };
  const rows = [
    row,
    { ...slot, id: 'placed' },
    { ...slot, id: 'missing', dayOfWeek: undefined },
    { ...slot, id: 'late', startPeriod: 16, endPeriod: 16 },
    { ...row, id: 'grade', kind: 'grades' as const },
  ];
  expect(
    rowsOutsideReviewGrid(rows, reviewPeriods(rows, 'ncku')).map(({ row, detail }) => [
      row.id,
      detail,
    ]),
  ).toEqual([
    ['clock', '星期三 · 12:10–12:55 · 體育館'],
    ['missing', '星期待補 · 第 0–1 節 · 體育館'],
    ['late', '星期三 · 第 16 節 · 體育館'],
  ]);
});
