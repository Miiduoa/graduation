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
});
