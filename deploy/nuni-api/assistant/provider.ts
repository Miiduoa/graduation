import { AssistantError, intent, type Intent } from './publicContext';
export type PublicRequest = {
  intent: Intent;
  sources: readonly { id: string; label: string; summary: string }[];
};
export interface Provider {
  name: string;
  model: string;
  ready: boolean;
  ask(input: PublicRequest): Promise<unknown>;
}
export function validateResult(value: unknown, expected: Intent): Intent {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).length !== 1 ||
    !('intent' in value)
  )
    throw new AssistantError('PROVIDER_INVALID_RESPONSE');
  const result = intent(value.intent);
  if (result !== expected) throw new AssistantError('PROVIDER_INVALID_RESPONSE');
  return result;
}
