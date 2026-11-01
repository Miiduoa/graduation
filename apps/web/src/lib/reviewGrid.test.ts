import { expect, it } from 'vitest';
import type { PersonalImportRow } from '@campus/shared';
import { nextReviewRow } from '@campus/shared/src/imports/reviewGrid';

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
