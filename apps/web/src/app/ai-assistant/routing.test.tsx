import { afterEach, expect, it, vi } from 'vitest';
import AssistantPage, { dynamic } from './page';
import LegacyAssistant from './LegacyAssistant';
import { Assistant } from '@/features/nuni/Assistant';
vi.mock('./LegacyAssistant', () => ({ default: () => null }));
vi.mock('@/features/nuni/Assistant', () => ({ Assistant: () => null }));
afterEach(() => vi.unstubAllEnvs());
it('chooses the nuni session page at request time', () => {
  vi.stubEnv('CAMPUS_BACKEND', 'nuni');
  expect(dynamic).toBe('force-dynamic');
  expect(AssistantPage().type).toBe(Assistant);
});
it('retains the established page outside the nuni backend gate', () => {
  vi.stubEnv('CAMPUS_BACKEND', '');
  vi.stubEnv('NUNI_CLASSROOM_ENABLED', '');
  expect(AssistantPage().type).toBe(LegacyAssistant);
});
