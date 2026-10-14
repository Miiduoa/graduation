import { describe, expect, it } from 'vitest';

import { resolveSchoolPageContext } from './pageContext';

describe('resolveSchoolPageContext', () => {
  it('follows schoolId when a listed school is selected', () => {
    const context = resolveSchoolPageContext({
      school: 'TCU',
      schoolId: 'tw-taichung-uni-b',
    });

    expect(context.schoolId).toBe('tw-taichung-uni-b');
    expect(context.schoolCode).toBe('TCU');
    expect(context.schoolName).toBe('台中大學（示範B）');
    expect(context.schoolSearch).toBe('?school=TCU&schoolId=tw-taichung-uni-b');
  });

  it('follows campus when schoolId is missing so browse-campus updates take effect', () => {
    const context = resolveSchoolPageContext({
      campus: 'cgu',
    });

    expect(context.schoolId).toBe('cgu');
    expect(context.schoolCode).toBe('CGU');
    expect(context.schoolName).toBe('長庚大學');
  });

  it('falls back to Providence University when no usable school context is provided', () => {
    const context = resolveSchoolPageContext({
      school: 'TCU',
    });

    expect(context.schoolId).toBe('pu');
    expect(context.schoolName).toBe('靜宜大學');
    expect(context.schoolSearch).toBe('?school=PU&schoolId=pu');
  });
  it('uses the explicit campus before an old schoolId or code', () => {
    const context = resolveSchoolPageContext({
      campus: 'cgu',
      schoolId: 'pu',
      school: 'PU',
    });
    expect(context.schoolId).toBe('cgu');
    expect(context.schoolName).toBe('長庚大學');
  });

  it('preserves a remote directory school identity instead of reading Providence data', () => {
    const context = resolveSchoolPageContext({
      campus: 'remote-university-12',
      schoolId: 'pu',
      school: 'PU',
    });
    expect(context.schoolId).toBe('remote-university-12');
    expect(context.schoolName).toBe('所選校園尚未接入');
    expect(context.schoolCode).toBe('');
    expect(context.schoolSearch).toBe('?school=&schoolId=remote-university-12');
  });

  it('does not reinterpret all-campus browsing as a Providence selection', () => {
    const context = resolveSchoolPageContext({
      campus: 'all',
      schoolId: 'pu',
      school: 'PU',
    });
    expect(context.schoolId).toBe('unavailable-campus');
    expect(context.schoolName).toBe('請先選擇校園');
  });

  it('does not pass an unsafe campus identifier through to database paths', () => {
    const context = resolveSchoolPageContext({ campus: '../pu', schoolId: 'pu' });
    expect(context.schoolId).toBe('unavailable-campus');
    expect(context.schoolId).not.toBe('pu');
  });

});
