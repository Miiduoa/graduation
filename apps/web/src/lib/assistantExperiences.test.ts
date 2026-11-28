import { describe, expect, it } from 'vitest';
import {
  ASSISTANT_EXPERIENCES,
  filterAssistantExperiences,
} from '@campus/shared/src/assistantExperiences';
import { getAssistantService } from '@campus/shared/src/assistantServices';

describe('shared workspace discovery', () => {
  it('keeps public campus tasks available while filtering work contexts', () => {
    const merchant = filterAssistantExperiences({ workContext: 'merchant' });
    expect(merchant.some((entry) => entry.id === 'merchant-overview')).toBe(true);
    expect(merchant.some((entry) => entry.id === 'campus-bus')).toBe(true);
    expect(merchant.some((entry) => entry.workContext === 'teacher')).toBe(false);
    expect(merchant.some((entry) => entry.workContext === 'student')).toBe(false);
    expect(filterAssistantExperiences({ workContext: 'student', category: 'work' })).toEqual([]);
  });

  it('matches mixed-language queries with full-width letters and extra spaces', () => {
    expect(filterAssistantExperiences({ query: '  ＬＩＢＲＡＲＹ   館藏 ' }).map((entry) => entry.id))
      .toEqual(['library']);
    expect(filterAssistantExperiences({ query: 'merchant 營運' }).map((entry) => entry.id))
      .toEqual(['merchant-overview', 'merchant-campus']);
  });

  it('does not silently fall back to another role or category when no task matches', () => {
    expect(filterAssistantExperiences({ workContext: 'teacher', query: '門市' })).toEqual([]);
    expect(filterAssistantExperiences({ category: 'study', query: '公車' })).toEqual([]);
    expect(filterAssistantExperiences({ query: '沒有這個任務' })).toEqual([]);
  });

  it('resolves every direct handoff through the existing service registry', () => {
    for (const experience of ASSISTANT_EXPERIENCES) {
      expect(getAssistantService(experience.serviceId)?.href).toMatch(/^\/(?!\/)/);
    }
    expect(new Set(ASSISTANT_EXPERIENCES.map((entry) => entry.id)).size)
      .toBe(ASSISTANT_EXPERIENCES.length);
  });
});
