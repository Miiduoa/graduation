import type { Provider } from './provider';
import { AssistantError } from './publicContext';
export function fakeProvider(mode = 'ok'): Provider {
  if (process.env.NODE_ENV === 'production') throw new AssistantError('FAKE_PROVIDER_FORBIDDEN');
  return {
    name: 'fake',
    model: 'public-fixture-v1',
    ready: true,
    async ask(input) {
      if (mode === 'timeout') throw new AssistantError('PROVIDER_TIMEOUT');
      if (mode === '429') throw new AssistantError('PROVIDER_RATE_LIMITED', 429);
      if (mode === 'schema') return { text: 'invalid' };
      if (mode === 'tool') return { tool_calls: [{ name: 'createOrder' }] };
      return { intent: input.intent };
    },
  };
}
