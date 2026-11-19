import type { Model } from '../../../apps/web/src/lib/nuni/assistantV2/contracts';
import { current } from './serverBoundary';
export { fallbackReady, PROVIDER_USER_MESSAGES, providerUserMessage } from '../../../apps/web/src/lib/nuni/assistantV2/groq';

/** Count and reject model boundary calls, even when credentials are absent. */
export function createProviderModel(): Model {
  return async () => {
    current().modelCalls++;
    throw new Error('A selected pickup must not invoke any model');
  };
}
