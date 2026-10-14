import { describe, expect, it } from 'vitest';
import { browsingSchoolSearch } from './navigation';

describe('browsingSchoolSearch', () => {
  it('keeps a browsing school on subsequent public pages', () => {
    expect(browsingSchoolSearch(new URLSearchParams('tab=boards'), 'nthu'))
      .toBe('?school=NTHU&schoolId=nthu&campus=nthu');
  });
  it('honors a shared deep link ahead of a stored preference', () => {
    expect(browsingSchoolSearch(new URLSearchParams('schoolId=nccu'), 'pu'))
      .toBe('?school=NCCU&schoolId=nccu&campus=nccu');
  });
  it('keeps school IDs from the connected directory even if not bundled locally', () => {
    expect(browsingSchoolSearch(new URLSearchParams(), 'tw-new-university'))
      .toBe('?schoolId=tw-new-university&campus=tw-new-university');
  });
  it('keeps an explicit all-schools choice', () => {
    expect(browsingSchoolSearch(new URLSearchParams('campus=all'), 'pu')).toBe('?campus=all');
    expect(browsingSchoolSearch(new URLSearchParams(), null)).toBe('');
  });
});
