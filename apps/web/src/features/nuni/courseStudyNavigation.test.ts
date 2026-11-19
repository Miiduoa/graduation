// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { adjacentStudyPassage } from './courseStudyNavigation';

const sections = [['page-2-a', 'page-2-b'], [], ['page-5-a'], ['page-9-a', 'page-9-b']] as const;

describe('ordinary source reading across pages', () => {
  it('reads within a page before crossing into the next readable PDF page', () => {
    expect(adjacentStudyPassage(sections, { sectionNumber: 0, partNumber: 0 }, 'next'))
      .toEqual({ sectionNumber: 0, partNumber: 1 });
    expect(adjacentStudyPassage(sections, { sectionNumber: 0, partNumber: 1 }, 'next'))
      .toEqual({ sectionNumber: 2, partNumber: 0 });
    expect(adjacentStudyPassage(sections, { sectionNumber: 2, partNumber: 0 }, 'next'))
      .toEqual({ sectionNumber: 3, partNumber: 0 });
  });

  it('returns to the last passage of the previous readable page without wrapping', () => {
    expect(adjacentStudyPassage(sections, { sectionNumber: 3, partNumber: 0 }, 'previous'))
      .toEqual({ sectionNumber: 2, partNumber: 0 });
    expect(adjacentStudyPassage(sections, { sectionNumber: 2, partNumber: 0 }, 'previous'))
      .toEqual({ sectionNumber: 0, partNumber: 1 });
    expect(adjacentStudyPassage(sections, { sectionNumber: 0, partNumber: 0 }, 'previous')).toBeNull();
    expect(adjacentStudyPassage(sections, { sectionNumber: 3, partNumber: 1 }, 'next')).toBeNull();
  });

  it('refuses invalid or missing locations instead of silently choosing another passage', () => {
    for (const current of [
      { sectionNumber: -1, partNumber: 0 }, { sectionNumber: 1, partNumber: 0 },
      { sectionNumber: 3, partNumber: 9 }, { sectionNumber: 4, partNumber: 0 },
      { sectionNumber: 0.5, partNumber: 0 }, { sectionNumber: 0, partNumber: NaN },
    ]) {
      expect(adjacentStudyPassage(sections, current, 'next')).toBeNull();
      expect(adjacentStudyPassage(sections, current, 'previous')).toBeNull();
    }
    expect(adjacentStudyPassage([], { sectionNumber: 0, partNumber: 0 }, 'next')).toBeNull();
  });

  it('does not change source sections, their contents or the passed position', () => {
    const location = { sectionNumber: 0, partNumber: 1 };
    const before = JSON.stringify({ sections, location });
    adjacentStudyPassage(sections, location, 'next');
    adjacentStudyPassage(sections, location, 'previous');
    expect(JSON.stringify({ sections, location })).toBe(before);
  });
});
