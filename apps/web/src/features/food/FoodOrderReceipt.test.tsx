import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { FoodOrderReceipt, type FoodOrderReceiptData } from './FoodOrderReceipt';

const receipt = (): FoodOrderReceiptData => ({
  id: 'order-20261101-001',
  locationName: '校園便當店',
  lines: [
    {
      menuItemId: 'rice',
      nameSnapshot: '蔬菜便當',
      quantity: 2,
      selectedOptions: [
        {
          optionId: 'large',
          nameSnapshot: '加飯',
          priceDelta: { amountMinor: 20, currency: 'TWD' },
        },
      ],
      unitPrice: { amountMinor: 120, currency: 'TWD' },
      lineTotal: { amountMinor: 240, currency: 'TWD' },
      customerNote: '醬汁分開',
    },
  ],
  total: { amountMinor: 1234, currency: 'TWD' },
  createdAt: '2026-11-01T03:05:00.000Z',
  updatedAt: '2026-11-01T03:08:00.000Z',
});

describe('FoodOrderReceipt', () => {
  it('labels the record and formats integer TWD totals without recomputing fees or options', () => {
    render(<FoodOrderReceipt order={receipt()} />);
    const paper = screen.getByRole('region', { name: '訂單紙本明細' });
    expect(within(paper).getByRole('heading', { name: 'Campus One 訂單明細' })).toBeTruthy();
    expect(within(paper).getByText('非統一發票')).toBeTruthy();
    expect(within(paper).getByText('訂單總額')).toBeTruthy();
    expect(within(paper).getByText('NT$1,234').closest('details')).toBeNull();
    expect(within(paper).queryByText('NT$12.34')).toBeNull();
    fireEvent.click(within(paper).getByText('品項明細 · 1 項'));
    expect(within(paper).getByText('數量 2')).toBeTruthy();
    expect(within(paper).getByText('品項金額 NT$240')).toBeTruthy();
    expect(within(paper).queryByText(/稅額|服務費|付款成功|已付款|條碼|QR/)).toBeNull();
    expect(paper.querySelector('svg, canvas, img, button, a')).toBeNull();
    expect(
      within(paper).getByText('依店家訂單資料整理，付款與取餐請以本頁最新狀態為準。'),
    ).toBeTruthy();
  });

  it('shows source timestamps in Taipei time with their original machine-readable values', () => {
    const order = receipt();
    const view = render(<FoodOrderReceipt order={order} />);
    const times = view.container.querySelectorAll('time');
    expect(times).toHaveLength(2);
    expect(times[0].dateTime).toBe(order.createdAt);
    expect(times[0].textContent?.replace(/\s+/gu, ' ')).toBe('2026年 11/1 11:05');
    expect(times[1].dateTime).toBe(order.updatedAt);
    expect(times[1].textContent?.replace(/\s+/gu, ' ')).toBe('2026年 11/1 11:08');
    expect(screen.getByText('時間皆為臺灣時間（UTC+8）')).toBeTruthy();
  });

  it('uses the next Taipei year when UTC is still on December 31', () => {
    const order = {
      ...receipt(),
      createdAt: '2026-12-31T15:59:00.000Z',
      updatedAt: '2026-12-31T16:00:00.000Z',
    };
    const view = render(<FoodOrderReceipt order={order} />);
    const times = view.container.querySelectorAll('time');
    expect(times[0].textContent?.replace(/\s+/gu, ' ')).toBe('2026年 12/31 23:59');
    expect(times[1].textContent?.replace(/\s+/gu, ' ')).toBe('2027年 1/1 00:00');
    expect(times[1].dateTime).toBe('2026-12-31T16:00:00.000Z');
  });

  it('distinguishes matching month, day and time from different years', () => {
    const order = {
      ...receipt(),
      createdAt: '2025-11-01T03:05:00.000Z',
      updatedAt: '2026-11-01T03:05:00.000Z',
    };
    const view = render(<FoodOrderReceipt order={order} />);
    const times = view.container.querySelectorAll('time');
    expect(times[0].textContent?.replace(/\s+/gu, ' ')).toBe('2025年 11/1 11:05');
    expect(times[1].textContent?.replace(/\s+/gu, ' ')).toBe('2026年 11/1 11:05');
  });

  it('preserves complete long names, options, notes and order identifiers as text', () => {
    const order = receipt();
    order.id = 'order-' + '1234567890abcdef'.repeat(12);
    order.locationName = '校園現做蔬食餐點與學生生活補給站'.repeat(5);
    order.lines[0].nameSnapshot = '當季鮮蔬雙主餐便當'.repeat(16);
    order.lines[0].selectedOptions[0].nameSnapshot = '白飯更換五穀飯並加一份時蔬'.repeat(10);
    order.lines[0].customerNote = '請將醬料另外包裝'.repeat(16) + '\n<取餐時再確認內容>';
    render(<FoodOrderReceipt order={order} />);
    fireEvent.click(screen.getByText('品項明細 · 1 項'));
    expect(screen.getByText(order.id)).toBeTruthy();
    expect(screen.getByText(order.locationName)).toBeTruthy();
    expect(screen.getByRole('heading', { name: order.lines[0].nameSnapshot })).toBeTruthy();
    expect(
      screen.getByText('選項：' + order.lines[0].selectedOptions[0].nameSnapshot),
    ).toBeTruthy();
    expect(screen.getByText(/<取餐時再確認內容>/).textContent).toBe(
      '備註：' + order.lines[0].customerNote,
    );
  });

  it('starts collapsed and preserves the reader choice as polling updates the same record', () => {
    const order = receipt();
    const view = render(<FoodOrderReceipt order={order} />);
    const details = view.container.querySelector('details')!;
    expect(details.open).toBe(false);
    expect(screen.getByText('NT$1,234').closest('details')).toBeNull();
    fireEvent.click(screen.getByText('品項明細 · 1 項'));
    expect(details.open).toBe(true);
    view.rerender(
      <FoodOrderReceipt
        order={{
          ...order,
          updatedAt: '2026-11-01T03:09:00.000Z',
          total: { amountMinor: 1299, currency: 'TWD' },
        }}
      />,
    );
    expect(view.container.querySelector('details')).toBe(details);
    expect(details.open).toBe(true);
    expect(screen.getByText('NT$1,299').closest('details')).toBeNull();
    expect(view.container.querySelectorAll('time')[1].dateTime).toBe('2026-11-01T03:09:00.000Z');
    fireEvent.click(screen.getByText('品項明細 · 1 項'));
    expect(details.open).toBe(false);
    view.rerender(<FoodOrderReceipt order={{ ...order, updatedAt: '2026-11-01T03:10:00.000Z' }} />);
    expect(details.open).toBe(false);
  });

  it('opens line items by default when expandLines is set for an in-progress order', () => {
    const order = receipt();
    const view = render(<FoodOrderReceipt order={order} expandLines />);
    const details = view.container.querySelector('details')!;
    expect(details.open).toBe(true);
    expect(screen.getByText('數量 2')).toBeTruthy();
    expect(screen.getByRole('heading', { name: '蔬菜便當' })).toBeTruthy();
    fireEvent.click(screen.getByText('品項明細 · 1 項'));
    expect(details.open).toBe(false);
    view.rerender(
      <FoodOrderReceipt
        order={{ ...order, updatedAt: '2026-11-01T03:09:00.000Z' }}
        expandLines
      />,
    );
    expect(details.open).toBe(false);
  });

  it('keeps line items collapsed when expandLines is omitted for a finished order', () => {
    const view = render(<FoodOrderReceipt order={receipt()} expandLines={false} />);
    const details = view.container.querySelector('details')!;
    expect(details.open).toBe(false);
    expect(screen.getByText('品項明細 · 1 項')).toBeTruthy();
    expect(screen.getByText('NT$1,234').closest('details')).toBeNull();
  });

  it('explains missing line data without inventing products or replacing the server total', () => {
    const order = { ...receipt(), lines: [] };
    const view = render(<FoodOrderReceipt order={order} />);
    expect(screen.getByText('這筆訂單尚未提供品項明細。').closest('details')).toBeNull();
    expect(screen.getByText('NT$1,234').closest('details')).toBeNull();
    expect(view.container.querySelector('details, li')).toBeNull();
    expect(screen.queryByText('蔬菜便當')).toBeNull();
  });
});
