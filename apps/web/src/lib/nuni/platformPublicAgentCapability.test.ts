import { describe, expect, it } from 'vitest';
import { projectPlatformPublicAgent } from './platformPublicAgentProjector';

const input = { schoolId: 'pu' };
const source = { date: '2026-10-19', label: 'OpenStreetMap' };
const project = (value: unknown) => projectPlatformPublicAgent('capability', value, input);

describe('school-scoped capability projection', () => {
  it('allows supported modes and the server-owned source', () => {
    expect(project({ schoolId: 'pu', modes: ['deterministic', 'groq'], source })).toEqual({
      schoolId: 'pu',
      modes: ['deterministic', 'groq'],
      source,
    });
    expect(project({ schoolId: 'pu', modes: [], source: null })).toEqual({
      schoolId: 'pu',
      modes: [],
      source: null,
    });
  });
  it('rejects cross-school, duplicate or unknown modes, missing sources and extra fields', () => {
    for (const value of [
      { schoolId: 'other', modes: ['groq'], source },
      { schoolId: 'pu', modes: ['groq', 'groq'], source },
      { schoolId: 'pu', modes: ['local'], source },
      { schoolId: 'pu', modes: ['groq'], source: null },
      { schoolId: 'pu', modes: [], source: null, secret: 'synthetic' },
      { schoolId: 'pu', modes: ['groq'], source: { ...source, date: '2026-02-29' } },
      { schoolId: 'pu', modes: ['groq'], source: { ...source, label: 'x\nunsafe' } },
      { schoolId: 'pu', modes: ['groq'], source: { ...source, extra: 'x' } },
    ])
      expect(() => project(value)).toThrow('PUBLIC_AGENT_INVALID_RESPONSE');
  });
});
