import { afterEach, expect, it, vi } from 'vitest';
import { foodPageSubtitle } from '@campus/shared/src/foodPageCopy';
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

it.each(['圖書館怎麼走', '今天菜單有什麼', '幫我點一份雞腿飯', ''])(
  '「%s」不是訂單狀態問題',
  (text) => {
    expect(isWebOrderStatusQuestion(text)).toBe(false);
  },
);

it('drops confirm-to-submit copy on the food page when ordering is off', () => {
  expect(foodPageSubtitle(false)).toBe('目前還不能線上點餐');
  expect(foodPageSubtitle(false)).not.toContain('確認後才送出訂單');
  expect(foodPageSubtitle(true)).toBe('先看菜單與金額，確認後才送出訂單。');
});
