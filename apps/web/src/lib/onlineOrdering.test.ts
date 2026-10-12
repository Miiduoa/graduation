import { afterEach, expect, it, vi } from 'vitest';
import { isWebOnlineOrderingEnabled, isWebOrderStatusQuestion } from './onlineOrdering';

afterEach(() => {
  vi.unstubAllEnvs();
});

it('線上點餐沒設就是關，明確打開才算開', () => {
  expect(isWebOnlineOrderingEnabled(undefined)).toBe(false);
  expect(isWebOnlineOrderingEnabled('')).toBe(false);
  expect(isWebOnlineOrderingEnabled('false')).toBe(false);
  expect(isWebOnlineOrderingEnabled('true')).toBe(true);
  vi.stubEnv('NEXT_PUBLIC_ONLINE_ORDERING', 'true');
  expect(isWebOnlineOrderingEnabled()).toBe(true);
});

it.each(['餐點好了沒', '我的取餐號碼', '訂單狀態', '我的訂單', '餐好了沒', '訂單好了沒'])(
  '「%s」是在問訂單進度或取餐號碼',
  (text) => {
    expect(isWebOrderStatusQuestion(text)).toBe(true);
  },
);

it.each(['圖書館怎麼走', '今天菜單有什麼', '幫我點一份雞腿飯', ''])('「%s」不是訂單狀態問題', (text) => {
  expect(isWebOrderStatusQuestion(text)).toBe(false);
});
