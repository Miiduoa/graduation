import { expect, it } from 'vitest';
import {
  foodCustomerNextStep,
  isFoodOrderInProgress,
  merchantOrderBucket,
  merchantOrderNextStep,
} from './foodOrderGuidance';

it('treats fulfilled and canceled orders as finished while refunds stay active', () => {
  expect(isFoodOrderInProgress('payment-pending')).toBe(true);
  expect(isFoodOrderInProgress('ready')).toBe(true);
  expect(isFoodOrderInProgress('cancellation-pending-refund')).toBe(true);
  expect(isFoodOrderInProgress('rejection-pending-refund')).toBe(true);
  expect(isFoodOrderInProgress('fulfilled')).toBe(false);
  expect(isFoodOrderInProgress('canceled')).toBe(false);
  expect(isFoodOrderInProgress('payment-expired')).toBe(false);
});

it('uses summary-ready copy without requiring pickup credential data', () => {
  expect(
    foodCustomerNextStep({
      state: 'ready',
      allowedActions: [],
      mode: 'summary',
    }),
  ).toBe('餐點好了，查看訂單並出示取餐憑證。');
});

it('does not infer a fresh payment is needed from a summary without payment-session data', () => {
  expect(
    foodCustomerNextStep({
      state: 'payment-pending',
      allowedActions: ['create-payment-session'],
      mode: 'summary',
    }),
  ).toBe('查看訂單，確認付款進度與方式。');
});

it('names the customer next step from state and allowed actions only', () => {
  expect(
    foodCustomerNextStep({
      state: 'payment-pending',
      allowedActions: ['create-payment-session', 'cancel'],
    }),
  ).toBe('請選擇付款方式，完成線上結帳。');
  expect(
    foodCustomerNextStep({
      state: 'payment-pending',
      allowedActions: ['create-payment-session'],
      payment: {
        progress: 'authorized-awaiting-settlement',
        allowedActions: [],
        expiresAt: '2099-01-01T00:00:00.000Z',
      },
    }),
  ).toBe('付款確認中，請稍候或更新這筆訂單。');
  expect(
    foodCustomerNextStep({
      state: 'payment-pending',
      allowedActions: ['create-payment-session'],
      payment: {
        progress: 'paid',
        allowedActions: [],
        expiresAt: '2099-01-01T00:00:00.000Z',
      },
    }),
  ).toBe('付款確認中，請稍候或更新這筆訂單。');
  expect(
    foodCustomerNextStep({
      state: 'ready',
      allowedActions: ['show-pickup-credential'],
      pickup: {
        allowedActions: ['present-one-time-token'],
        credential: { expiresAt: '2099-01-01T00:00:00.000Z' },
      },
      now: Date.parse('2026-10-24T00:00:00.000Z'),
    }),
  ).toBe('餐點好了。請到店出示取餐憑證。');
  expect(
    foodCustomerNextStep({
      state: 'ready',
      allowedActions: ['show-pickup-credential'],
      pickup: { allowedActions: [] },
    }),
  ).toBe('餐點好了。請先更新這筆訂單，再出示取餐憑證。');
  expect(foodCustomerNextStep({ state: 'fulfilled', allowedActions: [] })).toBe(
    '這筆訂單已取餐完成。',
  );
  expect(foodCustomerNextStep({ state: 'payment-expired', allowedActions: [] })).toBe(
    '這筆訂單已結束。',
  );
  expect(foodCustomerNextStep({ state: 'cancellation-pending-refund', allowedActions: [] })).toBe(
    '退款處理中，完成後會更新這筆訂單。',
  );
});

it('splits merchant queue work into incoming desk tasks versus prep and pickup', () => {
  expect(
    merchantOrderBucket({
      state: 'payment-pending',
      allowedActions: ['record-counter-payment'],
    }),
  ).toBe('incoming');
  expect(
    merchantOrderBucket({
      state: 'paid',
      allowedActions: ['accept', 'reject'],
    }),
  ).toBe('incoming');
  expect(
    merchantOrderBucket({
      state: 'ready',
      allowedActions: ['fulfill-pickup'],
    }),
  ).toBe('active');
  expect(
    merchantOrderNextStep({
      state: 'payment-pending',
      allowedActions: ['record-counter-payment'],
    }),
  ).toBe('先登記櫃檯已收款項');
  expect(
    merchantOrderNextStep({
      state: 'ready',
      allowedActions: ['fulfill-pickup'],
    }),
  ).toBe('核對取餐憑證並交付');
});
