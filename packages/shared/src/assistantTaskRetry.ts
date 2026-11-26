import { parseAssistantTaskPlan } from './assistantTaskPlan';

/** A short-lived read-only continuation. The server still verifies its signature and scope. */
export type AssistantTaskRetry = {
  version: 1;
  token: string;
  stepIds: string[];
  expiresAt: number;
};

export function parseAssistantTaskRetry(raw: unknown, plan?: unknown): AssistantTaskRetry | null {
  try {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) ||
        ![Object.prototype, null].includes(Object.getPrototypeOf(raw))) return null;
    const keys = ['version', 'token', 'stepIds', 'expiresAt'];
    const descriptors = Object.getOwnPropertyDescriptors(raw);
    const names = Reflect.ownKeys(descriptors);
    if (names.length !== keys.length || names.some(key => typeof key !== 'string' || !keys.includes(key))) return null;
    const value: Record<string, unknown> = Object.create(null);
    for (const key of keys) {
      const descriptor = descriptors[key];
      if (!descriptor?.enumerable || !('value' in descriptor)) return null;
      value[key] = descriptor.value;
    }
    if (value.version !== 1 || typeof value.token !== 'string' || value.token.length > 8192 ||
        !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(value.token) ||
        !Number.isSafeInteger(value.expiresAt) || (value.expiresAt as number) <= 0 ||
        (value.expiresAt as number) > 8640000000000000) return null;
    const ids = value.stepIds;
    if (!Array.isArray(ids) || Object.getPrototypeOf(ids) !== Array.prototype || !ids.length || ids.length > 16 ||
        Reflect.ownKeys(ids).length !== ids.length + 1) return null;
    const stepIds: string[] = [];
    for (let index = 0; index < ids.length; index++) {
      const descriptor = Object.getOwnPropertyDescriptor(ids, String(index));
      if (!descriptor?.enumerable || !('value' in descriptor) || typeof descriptor.value !== 'string' ||
          !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/.test(descriptor.value) || stepIds.includes(descriptor.value)) return null;
      stepIds.push(descriptor.value);
    }
    if (plan !== undefined) {
      const parsed = parseAssistantTaskPlan(plan);
      if (!parsed || stepIds.some(id => !parsed.steps.some(step => step.id === id &&
          ['blocked', 'partial'].includes(step.status) && !step.cardIds?.length))) return null;
    }
    return { version: 1, token: value.token, stepIds, expiresAt: value.expiresAt as number };
  } catch {
    return null;
  }
}

/** Only an explicit retry phrase may select an earlier continuation. No compound commands. */
export function isAssistantTaskRetryQuestion(question: string): boolean {
  if (typeof question !== 'string' || question.length > 100 || /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(question)) return false;
  const value = question.normalize('NFKC').trim().replace(/\s+/g, '');
  const prefix = '(?:(?:請|麻煩)(?:你)?|幫我|替我)*只?';
  const unresolved = '(?:(?:還)?(?:沒|未)(?:有)?(?:完成|查到|查完)|失敗)的?(?:項目|步驟|查詢|任務)?';
  return new RegExp(`^${prefix}(?:重試|重查|重新查(?:詢)?|再查(?:詢)?(?:一次)?|繼續查(?:詢)?)${unresolved}(?:一次)?[。.!！?？]?$`).test(value) ||
    new RegExp(`^${prefix}(?:把)?${unresolved}(?:再查一次|重新查詢|重試一次)[。.!！?？]?$`).test(value);
}
