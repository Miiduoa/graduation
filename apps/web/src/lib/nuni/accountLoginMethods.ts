import { NuniError, nuniId, nuniRecord } from '@campus/shared/src/nuni';

export type AccountLoginMethod = 'google' | 'apple';
export type AccountLoginMethods = {
  platformAccountId: string;
  currentMethod: AccountLoginMethod;
  methods: AccountLoginMethod[];
  googleLink: 'available' | 'linked' | 'reauth-required' | 'restricted' | 'unavailable';
};

const methods = ['google', 'apple'] as const;
const linkStates = ['available', 'linked', 'reauth-required', 'restricted', 'unavailable'] as const;

/** Project the authenticated inventory; provider subjects, email and tokens never cross this boundary. */
export function parseAccountLoginMethods(value: unknown): AccountLoginMethods {
  const input = nuniRecord(value);
  const platformAccountId = nuniId(input.platformAccountId, 'pa');
  if (
    !methods.includes(input.currentMethod as AccountLoginMethod) ||
    !Array.isArray(input.methods) ||
    input.methods.length < 1 ||
    input.methods.length > methods.length ||
    input.methods.some((method) => !methods.includes(method)) ||
    new Set(input.methods).size !== input.methods.length ||
    !input.methods.includes(input.currentMethod) ||
    !linkStates.includes(input.googleLink as AccountLoginMethods['googleLink'])
  ) {
    throw new NuniError(502, 'INVALID_RESPONSE');
  }
  const hasGoogle = input.methods.includes('google');
  if (
    (input.googleLink === 'linked' && !hasGoogle) ||
    (hasGoogle && input.googleLink !== 'linked' && input.googleLink !== 'unavailable')
  ) {
    throw new NuniError(502, 'INVALID_RESPONSE');
  }
  return {
    platformAccountId,
    currentMethod: input.currentMethod as AccountLoginMethod,
    methods: methods.filter((method) => (input.methods as unknown[]).includes(method)),
    googleLink: input.googleLink as AccountLoginMethods['googleLink'],
  };
}
